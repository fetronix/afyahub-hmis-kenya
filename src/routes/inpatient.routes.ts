/**
 * Inpatient care: wards, beds, admissions, transfers, discharge and the
 * nursing record.
 *
 * These twenty-two routes sat inside `createApp` interleaved with the
 * prescriptions section, under a banner that had been pasted twice and
 * named only part of what followed it. They are pulled out together
 * because they share one facility-module gate (`inpatient`) and one set of
 * rules about occupancy, so a change to any of them is really a change to
 * all of them.
 *
 * The rules that matter here, unchanged by the move:
 *
 *   - Tenant and facility scope come from `req.authContext`. A tenantId or
 *     facilityId supplied by the client is never trusted for scoping.
 *   - Occupancy is created only by admitting a patient and released only
 *     by discharging one, so a bed's status cannot be forged by writing to
 *     it directly.
 *   - Bed-day charges accrue through `accrueBedDaysScoped`, which is
 *     idempotent: running it repeatedly bills each night once, so a
 *     scheduled job and a discharge cannot both bill the same night.
 *
 * Paths are relative because the router is mounted at `/api`.
 */

import { Router, type Response } from 'express';

import type { AuthRequest } from '../auth/auth.middleware.ts';
import { requireAnyPermission, requirePermission } from '../auth/authorization.middleware.ts';
import { ScopeAccessError } from '../auth/scope.service.ts';
import { eq } from 'drizzle-orm';

import * as billing from '../billing/billing.service.ts';
import { billingServiceKeys } from '../billing/tariff-codes.ts';
import { codesForFamily } from '../billing/tariff-matching.ts';
import { db } from '../db/index.ts';
import * as queries from '../db/queries.ts';
import * as schema from '../db/schema.ts';
import * as wardBed from '../inpatient/ward-bed.service.ts';
import * as bedBilling from '../inpatient/bed-billing.service.ts';
import * as nursing from '../nursing/nursing.service.ts';
import { chargeSafely } from './shared/charges.ts';
import { admissionChargeRequest } from '../billing/service-charges.ts';
import { handleInpatientError } from './shared/errors.ts';
import { parseOptionalPositiveId, requireAuthContext } from './shared/request.ts';

const router = Router();

/** Read the same validated facility hint used by the inpatient module gate. */
function requestedAdmissionFacility(req: AuthRequest): number | undefined {
  const queryId = parseOptionalPositiveId(req.query.facilityId, 'facility ID');
  const rawBodyId = req.body?.facilityId;
  const bodyId =
    typeof rawBodyId === 'number'
      ? Number.isSafeInteger(rawBodyId) && rawBodyId > 0
        ? rawBodyId
        : NaN
      : parseOptionalPositiveId(rawBodyId, 'facility ID');
  if (
    (queryId !== undefined && !Number.isSafeInteger(queryId)) ||
    (bodyId !== undefined && !Number.isSafeInteger(bodyId))
  )
    throw new queries.InpatientDomainError(
      'INVALID_INPUT',
      'A valid facility ID is required.',
      400,
    );
  if (queryId !== undefined && bodyId !== undefined && queryId !== bodyId)
    throw new ScopeAccessError(
      'The requested facility identifiers do not match.',
      'FACILITY_SCOPE_MISMATCH',
    );
  return bodyId ?? queryId;
}

// =========================================================
// INPATIENT: WARDS, BEDS AND ADMISSIONS
// =========================================================
//
// Tenant and facility scope are derived from req.authContext.
// Client-supplied tenantId / facilityId are never trusted.
//
// Occupancy is created only by admitting a patient and released
// only by discharging one, so bed status cannot forge a bed.

router.get(
  '/inpatient/bed-billing-policy',
  requirePermission('inpatient.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    try {
      res.json(
        await bedBilling.getBedBillingPolicy(
          context,
          parseOptionalPositiveId(req.query.facilityId, 'facility ID'),
        ),
      );
    } catch (error) {
      if (handleInpatientError(error, res)) return;
      console.error('Bed policy read failed.');
      res.status(500).json({ error: 'BED_POLICY_READ_FAILED' });
    }
  },
);

router.put(
  '/inpatient/bed-billing-policy',
  requirePermission('inpatient.wards.update', 'billing.update'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    try {
      res.json(
        await bedBilling.setBedBillingPolicy(context, {
          ...(req.body ?? {}),
          facilityId: requestedAdmissionFacility(req),
        }),
      );
    } catch (error) {
      if (handleInpatientError(error, res)) return;
      console.error('Bed policy update failed.');
      res.status(500).json({ error: 'BED_POLICY_UPDATE_FAILED' });
    }
  },
);

router.get(
  '/inpatient/bed-billing-unresolved',
  requirePermission('inpatient.read'),
  requireAnyPermission('billing.read', 'billing.create', 'billing.update'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    try {
      const rawOffset = req.query.offset;
      if (
        rawOffset !== undefined &&
        (typeof rawOffset !== 'string' || !/^(0|[1-9]\d*)$/.test(rawOffset))
      )
        throw new queries.InpatientDomainError(
          'INVALID_INPUT',
          'Enter a valid bed billing page offset.',
          400,
        );
      res.json(
        await bedBilling.getUnresolvedBedBilling(
          context,
          parseOptionalPositiveId(req.query.facilityId, 'facility ID'),
          rawOffset === undefined ? 0 : Number(rawOffset),
        ),
      );
    } catch (error) {
      if (handleInpatientError(error, res)) return;
      console.error('Unresolved bed billing read failed.');
      res.status(500).json({ error: 'BED_BILLING_UNRESOLVED_READ_FAILED' });
    }
  },
);

router.get(
  '/admissions/:id/bed-occupancy',
  requirePermission('inpatient.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    try {
      res.json(
        await bedBilling.getBedBillingView(
          context,
          Number(req.params.id),
          requestedAdmissionFacility(req),
        ),
      );
    } catch (error) {
      if (handleInpatientError(error, res)) return;
      console.error('Bed occupancy read failed.');
      res.status(500).json({ error: 'BED_OCCUPANCY_READ_FAILED' });
    }
  },
);

router.post(
  '/admissions/:id/bed-billing-encounter',
  requirePermission('inpatient.read', 'clinical.read', 'billing.update'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    try {
      res.json(
        await bedBilling.linkBedBillingEncounter(
          context,
          Number(req.params.id),
          req.body?.encounterId,
          req.body?.reason,
          req.body?.evidenceReference,
          req.body?.affirmRelationship,
          requestedAdmissionFacility(req),
        ),
      );
    } catch (error) {
      if (handleInpatientError(error, res)) return;
      console.error('Admission encounter link failed.');
      res.status(500).json({ error: 'BED_ENCOUNTER_LINK_FAILED' });
    }
  },
);

router.post(
  '/admissions/:id/bed-history-review',
  requirePermission('inpatient.read', 'clinical.read', 'billing.update'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    try {
      res
        .status(201)
        .json(
          await bedBilling.reviewBedHistory(
            context,
            Number(req.params.id),
            req.body ?? {},
            requestedAdmissionFacility(req),
          ),
        );
    } catch (error) {
      if (handleInpatientError(error, res)) return;
      console.error('Bed history review failed.');
      res.status(500).json({ error: 'BED_HISTORY_REVIEW_FAILED' });
    }
  },
);

router.post(
  '/admissions/:id/bed-billing-retry',
  requirePermission('inpatient.read', 'billing.create'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    try {
      res.json(
        await queries.accrueBedDaysScoped(
          context,
          Number(req.params.id),
          undefined,
          requestedAdmissionFacility(req),
        ),
      );
    } catch (error) {
      if (handleInpatientError(error, res)) return;
      console.error('Bed billing retry failed.');
      res.status(500).json({ error: 'BED_BILLING_RETRY_FAILED' });
    }
  },
);

router.get(
  '/wards',
  requirePermission('inpatient.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const facilityId = parseOptionalPositiveId(req.query.facilityId, 'facility ID');

      const list = await queries.getWardsScoped(context, facilityId);

      res.json(list);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Ward list error:', err);
      res.status(500).json({
        success: false,
        error: 'WARD_LIST_FAILED',
      });
    }
  },
);

/*
 * Ward set-up.
 *
 * The board was read-only before this: wards could only exist if the
 * demo seed had been run, so a real facility had an empty dropdown and
 * nowhere to fill it from. These are the write paths, each with its
 * own permission so a facility can decide who configures the ward
 * while keeping admission rights separate.
 */
router.post(
  '/wards',
  requirePermission('inpatient.wards.create'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      // The ward and its audit entries commit together inside the service.
      const created = await wardBed.createWard(context, {
        ...(req.body ?? {}),
        facilityId: requestedAdmissionFacility(req),
      });
      res.status(201).json(created);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Ward creation error:', err);
      res.status(500).json({
        success: false,
        error: 'WARD_CREATION_FAILED',
      });
    }
  },
);

router.put(
  '/wards/:id',
  requirePermission('inpatient.wards.update'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      // The ward and its audit entries commit together inside the service.
      const updated = await wardBed.updateWard(
        context,
        req.params.id,
        req.body ?? {},
        requestedAdmissionFacility(req),
      );
      res.json(updated);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Ward update error:', err);
      res.status(500).json({
        success: false,
        error: 'WARD_UPDATE_FAILED',
      });
    }
  },
);

router.delete(
  '/wards/:id',
  requirePermission('inpatient.wards.delete'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const result = await wardBed.deleteWard(
        context,
        req.params.id,
        requestedAdmissionFacility(req),
      );

      await queries.logAuditEvent(
        context.tenantId,
        context.facilityId,
        String(context.userId),
        'DELETE',
        'Ward',
        String(result.wardId),
        `Deleted unused ward ${result.code}`,
      );

      res.json(result);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Ward deletion error:', err);
      res.status(500).json({
        success: false,
        error: 'WARD_DELETION_FAILED',
      });
    }
  },
);

/*
 * Bed set-up. Beds are created in a batch because a ward is set up in
 * one sitting: a prefix, a first number and a count, or an explicit
 * list of numbers.
 */
router.post(
  '/beds',
  requirePermission('inpatient.beds.create'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const result = await wardBed.createBeds(
        context,
        req.body ?? {},
        requestedAdmissionFacility(req),
      );

      await queries.logAuditEvent(
        context.tenantId,
        context.facilityId,
        String(context.userId),
        'CREATE',
        'Bed',
        String(result.wardId),
        `Added ${result.totalBeds} bed(s) to ward ${result.wardId}`,
      );

      res.status(201).json(result);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Bed creation error:', err);
      res.status(500).json({
        success: false,
        error: 'BED_CREATION_FAILED',
      });
    }
  },
);

router.put(
  '/beds/:id',
  requirePermission('inpatient.beds.update'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const updated = await wardBed.updateBed(
        context,
        req.params.id,
        req.body ?? {},
        requestedAdmissionFacility(req),
      );

      await queries.logAuditEvent(
        context.tenantId,
        context.facilityId,
        String(context.userId),
        'UPDATE',
        'Bed',
        String(updated.id),
        `Updated bed ${updated.bedNumber}`,
      );

      res.json(updated);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Bed update error:', err);
      res.status(500).json({
        success: false,
        error: 'BED_UPDATE_FAILED',
      });
    }
  },
);

router.delete(
  '/beds/:id',
  requirePermission('inpatient.beds.delete'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const result = await wardBed.deleteBed(
        context,
        req.params.id,
        requestedAdmissionFacility(req),
      );

      await queries.logAuditEvent(
        context.tenantId,
        context.facilityId,
        String(context.userId),
        'DELETE',
        'Bed',
        String(result.bedId),
        `Deleted unused bed ${result.bedNumber}`,
      );

      res.json(result);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Bed deletion error:', err);
      res.status(500).json({
        success: false,
        error: 'BED_DELETION_FAILED',
      });
    }
  },
);

router.get(
  '/beds',
  requirePermission('inpatient.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const wardId = parseOptionalPositiveId(req.query.wardId, 'ward ID');
      const facilityId = requestedAdmissionFacility(req);

      const list = await queries.getBedsScoped(context, wardId, facilityId);

      res.json(list);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Bed list error:', err);
      res.status(500).json({
        success: false,
        error: 'BED_LIST_FAILED',
      });
    }
  },
);

/*
 * Change a bed's housekeeping status.
 *
 * 'Occupied' is rejected by the query layer: occupancy must come
 * from an admission. A bed holding a patient cannot be changed
 * until that patient is discharged or transferred.
 */
router.put(
  '/beds/:id/status',
  requirePermission('inpatient.admit'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const bed = await queries.setBedStatusScoped(
        context,
        Number(req.params.id),
        req.body?.status,
      );

      await queries.logAuditEvent(
        context.tenantId,
        context.facilityId,
        String(context.userId),
        'UPDATE',
        'Bed',
        String(bed?.id ?? req.params.id),
        `Bed status set to ${String(req.body?.status)}`,
      );

      res.json(bed);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Bed status update error:', err);
      res.status(500).json({
        success: false,
        error: 'BED_STATUS_UPDATE_FAILED',
      });
    }
  },
);

/*
 * Release a cleaned bed back into service (Cleaning -> Available).
 *
 * Without this, every discharge permanently removes a bed from the
 * usable board because nothing else restores 'Available'.
 */
router.put(
  '/beds/:id/release',
  requirePermission('inpatient.admit'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const bed = await queries.releaseBedScoped(
        context,
        Number(req.params.id),
        requestedAdmissionFacility(req),
      );

      res.json(bed);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Bed release could not be committed.');
      res.status(500).json({
        success: false,
        error: 'BED_RELEASE_FAILED',
      });
    }
  },
);

router.get(
  '/admissions',
  requirePermission('inpatient.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const facilityId = parseOptionalPositiveId(req.query.facilityId, 'facility ID');

      const status = typeof req.query.status === 'string' ? req.query.status : undefined;

      const list = await queries.getAdmissionsScoped(context, facilityId, status);

      res.json(list);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Admission list error:', err);
      res.status(500).json({
        success: false,
        error: 'ADMISSION_LIST_FAILED',
      });
    }
  },
);

router.post(
  '/admissions',
  requirePermission('inpatient.admit'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const admission = await queries.createAdmissionScoped(context, {
        ...(req.body ?? {}),
        facilityId: requestedAdmissionFacility(req),
      });

      const charge = await chargeSafely(admissionChargeRequest(admission));

      res.status(201).json({ ...admission, billing: charge });
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Admission could not be committed.');
      res.status(500).json({
        success: false,
        error: 'ADMISSION_CREATION_FAILED',
      });
    }
  },
);

router.post(
  '/admissions/:id/discharge',
  requirePermission('inpatient.discharge'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const facilityId = requestedAdmissionFacility(req);
      const admission = await queries.dischargeAdmissionScoped(context, Number(req.params.id), {
        ...(req.body ?? {}),
        facilityId,
      });

      // Clinical discharge and a durable billing-work marker have committed.
      // A staging or invoice failure must not be reported as a failed discharge.
      try {
        const accrual = await queries.accrueBedDaysScoped(
          context,
          admission.id,
          undefined,
          facilityId,
        );
        res.json({
          ...admission,
          billing: { nights: accrual.nights, bedDays: accrual.charges, review: accrual.review },
        });
      } catch {
        console.error('Bed billing after committed discharge needs review.');
        res.json({
          ...admission,
          billing: {
            nights: null,
            bedDays: [],
            review: {
              code: 'BED_BILLING_STATUS_UNKNOWN',
              message:
                'Discharge succeeded and the bed is in Cleaning; billing status could not be confirmed. Inspect the admission’s pending bed billing work before retrying.',
            },
          },
        });
      }
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Discharge could not be committed.');
      res.status(500).json({
        success: false,
        error: 'DISCHARGE_FAILED',
      });
    }
  },
);

// =========================================================
// INPATIENT EXTRAS: TRANSFER, BED-DAYS, NURSING NOTES
// =========================================================

router.post(
  '/admissions/:id/transfer',
  requirePermission('inpatient.admit'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const facilityId = requestedAdmissionFacility(req);
      const { admission, transfer, bedBillingReadiness } = await queries.transferAdmissionScoped(
        context,
        Number(req.params.id),
        {
          facilityId,
          toWardId: req.body?.toWardId,
          toBedId: req.body?.toBedId,
          reason: req.body?.reason,
          transferredBy:
            typeof req.body?.transferredBy === 'string'
              ? req.body.transferredBy
              : (req.user?.fullName ?? 'Unknown'),
        },
      );

      // Transfer has committed; the estimate is not a charge and a read
      // failure must not make a completed transfer appear to have failed.
      try {
        const accrual = await queries.accrueBedDaysScoped(
          context,
          admission.id,
          undefined,
          facilityId,
        );
        res.json({ admission, transfer, bedBillingReadiness, billing: accrual });
      } catch {
        console.error('Bed estimate after committed transfer unavailable.');
        res.json({
          admission,
          transfer,
          bedBillingReadiness,
          billing: {
            estimateOnly: true,
            nights: null,
            charges: [],
            review: {
              code: 'BED_ESTIMATE_UNAVAILABLE',
              message: 'Transfer succeeded; the estimate is unavailable.',
            },
          },
        });
      }
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Admission transfer error:', err);
      res.status(500).json({
        success: false,
        error: 'ADMISSION_TRANSFER_FAILED',
      });
    }
  },
);

router.get(
  '/admissions/:id/transfers',
  requirePermission('inpatient.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const list = await queries.getAdmissionTransfersScoped(context, Number(req.params.id));

      res.json(list);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Admission transfer list error:', err);
      res.status(500).json({
        success: false,
        error: 'ADMISSION_TRANSFERS_FETCH_FAILED',
      });
    }
  },
);

/**
 * Accrue bed-day charges on demand.
 *
 * Active admissions return an estimate only. After discharge the saved
 * occupancy evidence is staged and billed with idempotent night identities.
 */
router.post(
  '/admissions/:id/accrue-bed-days',
  requirePermission('billing.create'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const accrual = await queries.accrueBedDaysScoped(
        context,
        Number(req.params.id),
        typeof req.body?.untilDate === 'string' ? req.body.untilDate : undefined,
        requestedAdmissionFacility(req),
      );

      res.json(accrual);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Bed-day accrual error:', err);
      res.status(500).json({
        success: false,
        error: 'BED_DAY_ACCRUAL_FAILED',
      });
    }
  },
);

/**
 * Ward board: occupancy, per-admission vitals status and note counts.
 * One scoped call so the ward screen and dashboard do not fan out.
 */
router.get(
  '/inpatient/board',
  requirePermission('inpatient.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const facilityId = parseOptionalPositiveId(req.query.facilityId, 'facility ID');

      const board = await nursing.getInpatientBoardScoped(context, facilityId);

      res.json(board);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Inpatient board error:', err);
      res.status(500).json({
        success: false,
        error: 'INPATIENT_BOARD_FAILED',
      });
    }
  },
);

/**
 * Vitals history for one admission, with abnormality flags derived
 * from adult reference ranges.
 */
router.get(
  '/admissions/:id/vitals',
  requirePermission('inpatient.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const vitals = await nursing.getVitalsForAdmissionScoped(
        context,
        Number(req.params.id),
        req.query.limit ? Number(req.query.limit) : 20,
      );

      res.json(
        vitals.map((observation) => ({
          ...observation,
          flags: nursing.assessVitals(observation),
        })),
      );
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Admission vitals error:', err);
      res.status(500).json({
        success: false,
        error: 'ADMISSION_VITALS_FETCH_FAILED',
      });
    }
  },
);

/**
 * Record ward vitals against an admission.
 *
 * Separate from POST /api/observations so that ward care does not
 * depend on the OPD module being enabled for the facility.
 */
router.post(
  '/admissions/:id/vitals',
  requirePermission('clinical.create'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const observation = await nursing.recordVitalsScoped(context, {
        ...req.body,
        admissionId: Number(req.params.id),
        recordedBy:
          typeof req.body?.recordedBy === 'string'
            ? req.body.recordedBy
            : (req.user?.fullName ?? null),
      });

      await queries.logAuditEvent(
        context.tenantId,
        context.facilityId,
        String(context.userId),
        'CREATE',
        'Observation',
        String(observation.id ?? ''),
        `Ward vitals recorded for admission ${req.params.id}`,
      );

      res.status(201).json(observation);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Ward vitals error:', err);
      res.status(500).json({
        success: false,
        error: 'WARD_VITALS_CREATION_FAILED',
      });
    }
  },
);

/**
 * Shift handover: notes for a day grouped by shift.
 * Defaults to today; pass ?date=YYYY-MM-DD&shift=Morning to narrow.
 */
router.get(
  '/nursing-notes/handover',
  requirePermission('inpatient.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const handover = await nursing.getShiftHandoverScoped(context, {
        date: typeof req.query.date === 'string' ? req.query.date : undefined,
        shift: typeof req.query.shift === 'string' ? req.query.shift : undefined,
      });

      res.json(handover);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Shift handover error:', err);
      res.status(500).json({
        success: false,
        error: 'SHIFT_HANDOVER_FAILED',
      });
    }
  },
);

router.get(
  '/nursing-notes',
  requirePermission('inpatient.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const admissionId = req.query.admissionId ? Number(req.query.admissionId) : undefined;

      const patientId = req.query.patientId ? Number(req.query.patientId) : undefined;

      const list = await queries.getNursingNotesScoped(context, {
        admissionId,
        patientId,
      });

      res.json(list);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Nursing note list error:', err);
      res.status(500).json({
        success: false,
        error: 'NURSING_NOTES_FETCH_FAILED',
      });
    }
  },
);

router.post(
  '/nursing-notes',
  requirePermission('clinical.create'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const note = await queries.createNursingNoteScoped(context, {
        admissionId: req.body?.admissionId,
        patientId: req.body?.patientId,
        encounterId: req.body?.encounterId,
        noteType: req.body?.noteType,
        shift: req.body?.shift,
        note: req.body?.note,
        recordedBy:
          typeof req.body?.recordedBy === 'string'
            ? req.body.recordedBy
            : (req.user?.fullName ?? 'Unknown'),
      });

      await queries.logAuditEvent(
        note.tenantId,
        note.facilityId,
        String(context.userId),
        'CREATE',
        'NursingNote',
        String(note.id),
        `Nursing note recorded for patient ${note.patientId}`,
      );

      res.status(201).json(note);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Nursing note creation error:', err);
      res.status(500).json({
        success: false,
        error: 'NURSING_NOTE_CREATION_FAILED',
      });
    }
  },
);

export default router;
