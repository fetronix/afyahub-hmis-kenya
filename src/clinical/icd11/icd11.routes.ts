import { and, eq } from 'drizzle-orm';
import { Router, type Response } from 'express';
import type { AuthRequest } from '../../auth/auth.middleware.ts';
import { requireAnyPermission, requirePermission } from '../../auth/authorization.middleware.ts';
import { ScopeAccessError, resolveFacilityScope } from '../../auth/scope.service.ts';
import { db } from '../../db/index.ts';
import * as queries from '../../db/queries.ts';
import * as schema from '../../db/schema.ts';
import {
  describeWhoIcd11Configuration,
  getIcd11EntryByCode,
  getWhoRelease,
  Icd11Error,
  searchIcd11Catalogue,
} from './icd11.service.ts';

const router = Router();

function fail(res: Response, error: unknown) {
  if (error instanceof Icd11Error) {
    res.status(error.status).json({ success: false, error: error.code, message: error.message });
  } else if (error instanceof ScopeAccessError) {
    res.status(403).json({ success: false, error: error.code, message: 'Facility access denied.' });
  } else {
    res.status(500).json({
      success: false,
      error: 'ICD11_OPERATION_FAILED',
      message: 'ICD-11 operation failed.',
    });
  }
}

async function scopedFacility(req: AuthRequest) {
  if (!req.authContext) throw new ScopeAccessError('Authorization context required.');
  const raw = req.body?.facilityId ?? req.query.facilityId;
  const id = raw === undefined || raw === '' ? undefined : Number(raw);
  if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0)) {
    throw new Icd11Error('INVALID_FACILITY_ID', 'facilityId must be a positive integer.');
  }
  const facility = await queries.getFacilityByIdScoped(
    req.authContext,
    resolveFacilityScope(req.authContext, id),
  );
  if (!facility) throw new Icd11Error('FACILITY_NOT_FOUND', 'Facility not found.', 404);
  return facility;
}

router.get('/status', requireAnyPermission('clinical.read', 'clinical.icd11.read'), (_req, res) => {
  try {
    res.json({ success: true, ...describeWhoIcd11Configuration() });
  } catch (error) {
    fail(res, error);
  }
});

router.get(
  '/search',
  requireAnyPermission('clinical.read', 'clinical.icd11.read'),
  async (req, res) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 25;
      res.json({ success: true, ...(await searchIcd11Catalogue(query, limit)) });
    } catch (error) {
      fail(res, error);
    }
  },
);

// Mappings are facility-specific clinician reviews, never automatic conversions.
router.get(
  '/mappings/:code',
  requireAnyPermission('clinical.read', 'clinical.icd11.read'),
  async (req: AuthRequest, res) => {
    try {
      const facility = await scopedFacility(req);
      const code = String(req.params.code).trim().toUpperCase();
      if (!/^[A-Z][0-9]{2}(?:\.[A-Z0-9]{1,4})?$/.test(code)) {
        throw new Icd11Error('INVALID_ICD10_CODE', 'Provide an ICD-10 code.');
      }
      const [mapping] = await db
        .select()
        .from(schema.icd10ToIcd11Mappings)
        .where(
          and(
            eq(schema.icd10ToIcd11Mappings.facilityId, facility.id),
            eq(schema.icd10ToIcd11Mappings.tenantId, facility.tenantId),
            eq(schema.icd10ToIcd11Mappings.icd10Code, code),
            eq(schema.icd10ToIcd11Mappings.releaseId, getWhoRelease()),
          ),
        )
        .limit(1);
      res.json({
        success: true,
        mapping: mapping ?? null,
        status: mapping ? mapping.reviewStatus : 'UNMAPPED_OR_NOT_LOADED',
        message: 'Mappings are review aids only and do not recode historical diagnoses.',
      });
    } catch (error) {
      fail(res, error);
    }
  },
);

router.post(
  '/mappings/:code/review',
  requirePermission('clinical.icd11.manage'),
  async (req: AuthRequest, res) => {
    try {
      const facility = await scopedFacility(req);
      const code = String(req.params.code).trim().toUpperCase();
      const icd10Title = typeof req.body?.icd10Title === 'string' ? req.body.icd10Title.trim() : '';
      const source =
        typeof req.body?.mappingSource === 'string' ? req.body.mappingSource.trim() : '';
      const codes: unknown[] = Array.isArray(req.body?.icd11Codes) ? req.body.icd11Codes : [];
      if (
        !/^[A-Z][0-9]{2}(?:\.[A-Z0-9]{1,4})?$/.test(code) ||
        !icd10Title ||
        icd10Title.length > 500 ||
        source.length < 5 ||
        source.length > 500 ||
        codes.length < 1 ||
        codes.length > 10 ||
        !codes.every((c) => typeof c === 'string')
      ) {
        throw new Icd11Error(
          'INVALID_MAPPING_REVIEW',
          'ICD-10 code and title, mapping source and 1–10 selected ICD-11 codes are required.',
        );
      }
      const releaseId = getWhoRelease();
      const uniqueCodes = [...new Set((codes as string[]).map((c) => c.trim().toUpperCase()))];
      const targets: Array<NonNullable<Awaited<ReturnType<typeof getIcd11EntryByCode>>>> = [];
      for (const candidate of uniqueCodes) {
        const entry = await getIcd11EntryByCode(candidate, releaseId);
        if (!entry)
          throw new Icd11Error(
            'ICD11_CODE_NOT_VERIFIED',
            'Each target must be selected from cached WHO results for the configured release.',
          );
        targets.push(entry);
      }
      const primary = targets[0];
      const row = await db.transaction(async (tx) => {
        const [saved] = await tx
          .insert(schema.icd10ToIcd11Mappings)
          .values({
            tenantId: facility.tenantId,
            facilityId: facility.id,
            icd10Code: code,
            icd10Title,
            icd11Code: primary.code,
            icd11Title: primary.title,
            icd11Chapter: primary.chapterCode,
            foundationUri: primary.foundationUri,
            linearizationUri: primary.linearizationUri,
            releaseId,
            mappingType: targets.length > 1 ? 'ONE_TO_MANY' : 'ONE_TO_ONE',
            reviewStatus: 'CLINICALLY_REVIEWED',
            mappingSource: source,
            alternatives: targets.slice(1).map((entry) => ({
              code: entry.code,
              title: entry.title,
              releaseId: entry.releaseId,
            })),
            notes:
              typeof req.body?.notes === 'string' ? req.body.notes.trim().slice(0, 2000) : null,
            reviewedByUserId: req.authContext!.userId,
            reviewedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              schema.icd10ToIcd11Mappings.facilityId,
              schema.icd10ToIcd11Mappings.icd10Code,
              schema.icd10ToIcd11Mappings.releaseId,
            ],
            set: {
              icd10Title,
              icd11Code: primary.code,
              icd11Title: primary.title,
              icd11Chapter: primary.chapterCode,
              foundationUri: primary.foundationUri,
              linearizationUri: primary.linearizationUri,
              mappingType: targets.length > 1 ? 'ONE_TO_MANY' : 'ONE_TO_ONE',
              reviewStatus: 'CLINICALLY_REVIEWED',
              mappingSource: source,
              alternatives: targets.slice(1).map((entry) => ({
                code: entry.code,
                title: entry.title,
                releaseId: entry.releaseId,
              })),
              notes:
                typeof req.body?.notes === 'string' ? req.body.notes.trim().slice(0, 2000) : null,
              reviewedByUserId: req.authContext!.userId,
              reviewedAt: new Date(),
            },
          })
          .returning();
        await tx.insert(schema.auditLogs).values({
          tenantId: facility.tenantId,
          facilityId: facility.id,
          userId: String(req.authContext!.userId),
          action: 'UPDATE',
          resource: 'icd_mapping_review',
          resourceId: String(saved.id),
          details: JSON.stringify({ icd10Code: code, releaseId, targetCount: targets.length }),
        });
        return saved;
      });
      res.json({ success: true, mapping: row, historicalDiagnosesChanged: false });
    } catch (error) {
      fail(res, error);
    }
  },
);

export default router;
