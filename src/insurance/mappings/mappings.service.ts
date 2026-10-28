/**
 * JaliCare HMIS — Insurer Service-Code Mapping Service
 *
 * Maps facility JaliCare tariffs and service items (OPD consultation,
 * laboratory, pharmacy, imaging, procedures, inpatient/bed, theatre/specialist)
 * to each insurer's distinct service codes with effective dates.
 */

import { and, desc, eq, ne } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { formatCents } from '../../billing/settlement.ts';
import {
  inferPrivateServiceCategory,
  moneyToCentsStrict,
  PrivateInsuranceError,
} from '../core/types.ts';
import { recordPrivateInsuranceAudit } from '../audit/diagnostics.service.ts';
import { getPayerRowScoped } from '../payers/payer-config.service.ts';

export function isEffectiveOnDate(
  effectiveFrom: string | null | undefined,
  effectiveTo: string | null | undefined,
  serviceDate: string,
): boolean {
  if (effectiveFrom && serviceDate < effectiveFrom) return false;
  if (effectiveTo && serviceDate > effectiveTo) return false;
  return true;
}

export async function listPayerServiceMappings(params: {
  tenantId: number;
  facilityId: number;
  payerCode?: string;
  serviceArea?: string;
  activeOnly?: boolean;
}) {
  const conditions = [
    eq(schema.payerServiceCodeMappings.tenantId, params.tenantId),
    eq(schema.payerServiceCodeMappings.facilityId, params.facilityId),
  ];

  if (params.payerCode) {
    conditions.push(
      eq(schema.payerServiceCodeMappings.payerCode, params.payerCode.trim().toUpperCase()),
    );
  } else {
    conditions.push(ne(schema.payerServiceCodeMappings.payerCode, 'SHA'));
  }

  if (params.serviceArea) {
    conditions.push(
      eq(schema.payerServiceCodeMappings.serviceArea, params.serviceArea.trim().toUpperCase()),
    );
  }

  if (params.activeOnly) {
    conditions.push(eq(schema.payerServiceCodeMappings.isActive, true));
  }

  return db
    .select()
    .from(schema.payerServiceCodeMappings)
    .where(and(...conditions))
    .orderBy(desc(schema.payerServiceCodeMappings.updatedAt));
}

export async function createPayerServiceMapping(params: {
  tenantId: number;
  facilityId: number;
  actorUserId: number;
  actorUserUid: string;
  actorRole?: string;
  input: Record<string, unknown>;
}) {
  const payerCode = String(params.input.payerCode ?? '')
    .trim()
    .toUpperCase();
  if (!payerCode) {
    throw new PrivateInsuranceError('PAYER_CODE_REQUIRED', 'payerCode is required.', 400);
  }

  const payerRow = await getPayerRowScoped({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    payerCode,
  });

  let tariff: typeof schema.facilityServiceTariffs.$inferSelect | null = null;
  if (
    params.input.tariffId !== undefined &&
    params.input.tariffId !== null &&
    params.input.tariffId !== ''
  ) {
    const tId = Number(params.input.tariffId);
    const [found] = await db
      .select()
      .from(schema.facilityServiceTariffs)
      .where(
        and(
          eq(schema.facilityServiceTariffs.id, tId),
          eq(schema.facilityServiceTariffs.tenantId, params.tenantId),
          eq(schema.facilityServiceTariffs.facilityId, params.facilityId),
        ),
      )
      .limit(1);
    if (!found) {
      throw new PrivateInsuranceError(
        'TARIFF_NOT_FOUND',
        'Selected JaliCare facility service tariff was not found.',
        404,
      );
    }
    tariff = found;
  }

  const localCode = String(params.input.localCode ?? tariff?.code ?? '').trim();
  const localDescription = String(
    params.input.localDescription ?? tariff?.description ?? '',
  ).trim();

  if (!localCode || !localDescription) {
    throw new PrivateInsuranceError(
      'LOCAL_SERVICE_REQUIRED',
      'localCode and localDescription (or a valid tariffId) are required.',
      400,
    );
  }

  const payerServiceCode = String(params.input.payerServiceCode ?? '').trim();
  const payerServiceName = String(params.input.payerServiceName ?? localDescription).trim();

  if (!payerServiceCode) {
    throw new PrivateInsuranceError(
      'PAYER_SERVICE_CODE_REQUIRED',
      'Insurer-specific payerServiceCode is required.',
      400,
    );
  }

  const serviceArea =
    typeof params.input.serviceArea === 'string' && params.input.serviceArea.trim()
      ? params.input.serviceArea.trim().toUpperCase()
      : inferPrivateServiceCategory(tariff?.department ?? localDescription);

  let reimbursementTariff: string | null = null;
  if (
    params.input.reimbursementTariff !== undefined &&
    params.input.reimbursementTariff !== null &&
    params.input.reimbursementTariff !== ''
  ) {
    const cents = moneyToCentsStrict(
      params.input.reimbursementTariff as string | number,
      'Reimbursement tariff',
    );
    reimbursementTariff = formatCents(cents);
  }

  const effectiveFrom =
    typeof params.input.effectiveFrom === 'string' && params.input.effectiveFrom.trim()
      ? params.input.effectiveFrom.trim()
      : null;
  const effectiveTo =
    typeof params.input.effectiveTo === 'string' && params.input.effectiveTo.trim()
      ? params.input.effectiveTo.trim()
      : null;
  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
    throw new PrivateInsuranceError(
      'INVALID_EFFECTIVE_DATES',
      'effectiveTo cannot precede effectiveFrom.',
      400,
    );
  }

  const [created] = await db
    .insert(schema.payerServiceCodeMappings)
    .values({
      tenantId: params.tenantId,
      facilityId: params.facilityId,
      payerCode: payerRow.payerCode,
      tariffId: tariff?.id ?? null,
      localCode,
      localDescription,
      serviceArea,
      payerServiceCode,
      payerServiceName,
      fund:
        typeof params.input.schemeCode === 'string' && params.input.schemeCode.trim()
          ? params.input.schemeCode.trim()
          : 'GENERAL_MEDICAL',
      accessPoint:
        serviceArea === 'INPATIENT_BED' || serviceArea === 'THEATRE_SPECIALIST' ? 'IP' : 'OP',
      paymentMechanism: 'FEE_FOR_SERVICE',
      reimbursementTariff,
      isPhcZeroTariff: false,
      requiresPreauth: Boolean(params.input.requiresPreauth),
      preauthCategory:
        typeof params.input.preauthCategory === 'string' && params.input.preauthCategory.trim()
          ? params.input.preauthCategory.trim()
          : null,
      requiresReferral: Boolean(params.input.requiresReferral),
      requiresClinicalNotes: params.input.requiresClinicalNotes !== false,
      effectiveFrom,
      effectiveTo,
      isActive: params.input.isActive !== false,
      notes: typeof params.input.notes === 'string' ? params.input.notes : null,
      createdByUserId: params.actorUserId,
      updatedByUserId: params.actorUserId,
    })
    .returning();

  await recordPrivateInsuranceAudit({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    actorUserUid: params.actorUserUid,
    actorRole: params.actorRole,
    action: 'PRIVATE_INSURANCE_MAPPING_CREATED',
    entityType: 'payer_service_code_mapping',
    entityId: created.id,
    details: {
      payerCode: created.payerCode,
      localCode: created.localCode,
      payerServiceCode: created.payerServiceCode,
      serviceArea: created.serviceArea,
    },
  });

  return created;
}

export async function updatePayerServiceMapping(params: {
  tenantId: number;
  facilityId: number;
  mappingId: number;
  actorUserId: number;
  actorUserUid: string;
  actorRole?: string;
  input: Record<string, unknown>;
}) {
  const [existing] = await db
    .select()
    .from(schema.payerServiceCodeMappings)
    .where(
      and(
        eq(schema.payerServiceCodeMappings.id, params.mappingId),
        eq(schema.payerServiceCodeMappings.tenantId, params.tenantId),
        eq(schema.payerServiceCodeMappings.facilityId, params.facilityId),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new PrivateInsuranceError('MAPPING_NOT_FOUND', 'Service-code mapping not found.', 404);
  }

  const updates: Partial<typeof schema.payerServiceCodeMappings.$inferInsert> = {
    updatedByUserId: params.actorUserId,
    updatedAt: new Date(),
  };

  if (typeof params.input.payerServiceCode === 'string' && params.input.payerServiceCode.trim()) {
    updates.payerServiceCode = params.input.payerServiceCode.trim();
  }
  if (typeof params.input.payerServiceName === 'string' && params.input.payerServiceName.trim()) {
    updates.payerServiceName = params.input.payerServiceName.trim();
  }
  if (typeof params.input.serviceArea === 'string' && params.input.serviceArea.trim()) {
    updates.serviceArea = params.input.serviceArea.trim().toUpperCase();
  }
  if (params.input.reimbursementTariff !== undefined) {
    if (params.input.reimbursementTariff === null || params.input.reimbursementTariff === '') {
      updates.reimbursementTariff = null;
    } else {
      updates.reimbursementTariff = formatCents(
        moneyToCentsStrict(
          params.input.reimbursementTariff as string | number,
          'Reimbursement tariff',
        ),
      );
    }
  }
  if (typeof params.input.requiresPreauth === 'boolean') {
    updates.requiresPreauth = params.input.requiresPreauth;
  }
  if (typeof params.input.requiresReferral === 'boolean') {
    updates.requiresReferral = params.input.requiresReferral;
  }
  if (typeof params.input.requiresClinicalNotes === 'boolean') {
    updates.requiresClinicalNotes = params.input.requiresClinicalNotes;
  }
  if (params.input.effectiveFrom !== undefined) {
    updates.effectiveFrom =
      params.input.effectiveFrom && String(params.input.effectiveFrom).trim()
        ? String(params.input.effectiveFrom).trim()
        : null;
  }
  if (params.input.effectiveTo !== undefined) {
    updates.effectiveTo =
      params.input.effectiveTo && String(params.input.effectiveTo).trim()
        ? String(params.input.effectiveTo).trim()
        : null;
  }
  if (typeof params.input.isActive === 'boolean') {
    updates.isActive = params.input.isActive;
  }
  if (params.input.notes !== undefined) {
    updates.notes = typeof params.input.notes === 'string' ? params.input.notes : null;
  }

  const [updated] = await db
    .update(schema.payerServiceCodeMappings)
    .set(updates)
    .where(eq(schema.payerServiceCodeMappings.id, existing.id))
    .returning();

  await recordPrivateInsuranceAudit({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    actorUserUid: params.actorUserUid,
    actorRole: params.actorRole,
    action: 'PRIVATE_INSURANCE_MAPPING_UPDATED',
    entityType: 'payer_service_code_mapping',
    entityId: updated.id,
    details: {
      payerCode: updated.payerCode,
      localCode: updated.localCode,
      payerServiceCode: updated.payerServiceCode,
      isActive: updated.isActive,
    },
  });

  return updated;
}
