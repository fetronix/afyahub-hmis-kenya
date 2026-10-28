/**
 * JaliCare HMIS — Private Insurance Preauthorization Workflow Service
 *
 * Manages draft creation, clinical indication & diagnosis capture, multi-item
 * requested services, supporting attachments, submission through a supported
 * adapter OR explicit manual recording of insurer authorization references,
 * and valid state transitions. Never fabricates approval codes.
 */

import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { formatCents } from '../../billing/settlement.ts';
import { getPayerAdapter, inspectSecretEnvPresence } from '../core/adapter-registry.ts';
import {
  canTransitionPrivatePreauthStatus,
  moneyToCentsStrict,
  PrivateInsuranceError,
  type PrivatePreauthStatus,
} from '../core/types.ts';
import {
  recordIntegrationDiagnostic,
  recordPrivateInsuranceAudit,
} from '../audit/diagnostics.service.ts';
import { getPayerRowScoped, toPayerRuntimeConfig } from '../payers/payer-config.service.ts';

async function nextPreauthNumber(payerCode: string): Promise<string> {
  const res = await db.execute(sql`SELECT nextval('private_insurance_preauth_number_seq') AS seq`);
  const rows = (res as unknown as { rows?: Array<{ seq: string | number }> }).rows ?? [];
  const seq = Number(rows[0]?.seq ?? Date.now() % 100000);
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `PA-${payerCode}-${datePart}-${String(seq).padStart(5, '0')}`;
}

export async function listPrivatePreauthorizations(params: {
  tenantId: number;
  facilityId: number;
  payerCode?: string;
  patientId?: number;
  status?: string;
  limit?: number;
}) {
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));
  const conditions = [
    eq(schema.insurancePreauthorizations.tenantId, params.tenantId),
    eq(schema.insurancePreauthorizations.facilityId, params.facilityId),
  ];

  if (params.payerCode) {
    conditions.push(
      eq(schema.insurancePreauthorizations.payerCode, params.payerCode.trim().toUpperCase()),
    );
  } else {
    conditions.push(ne(schema.insurancePreauthorizations.payerCode, 'SHA'));
  }

  if (params.patientId) {
    conditions.push(eq(schema.insurancePreauthorizations.patientId, params.patientId));
  }
  if (params.status) {
    conditions.push(
      eq(schema.insurancePreauthorizations.status, params.status.trim().toUpperCase()),
    );
  }

  const rows = await db
    .select({
      preauth: schema.insurancePreauthorizations,
      patientFirstName: schema.patients.firstName,
      patientLastName: schema.patients.lastName,
    })
    .from(schema.insurancePreauthorizations)
    .innerJoin(schema.patients, eq(schema.patients.id, schema.insurancePreauthorizations.patientId))
    .where(and(...conditions))
    .orderBy(desc(schema.insurancePreauthorizations.updatedAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r.preauth,
    patientName: `${r.patientFirstName} ${r.patientLastName}`.trim(),
  }));
}

export async function getPrivatePreauthorizationById(params: {
  tenantId: number;
  facilityId: number;
  preauthId: number;
}) {
  const [row] = await db
    .select({
      preauth: schema.insurancePreauthorizations,
      patientFirstName: schema.patients.firstName,
      patientLastName: schema.patients.lastName,
    })
    .from(schema.insurancePreauthorizations)
    .innerJoin(schema.patients, eq(schema.patients.id, schema.insurancePreauthorizations.patientId))
    .where(
      and(
        eq(schema.insurancePreauthorizations.id, params.preauthId),
        eq(schema.insurancePreauthorizations.tenantId, params.tenantId),
        eq(schema.insurancePreauthorizations.facilityId, params.facilityId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new PrivateInsuranceError('PREAUTH_NOT_FOUND', 'Preauthorization record not found.', 404);
  }

  const attachments = await db
    .select()
    .from(schema.insurancePreauthorizationAttachments)
    .where(
      and(
        eq(schema.insurancePreauthorizationAttachments.preauthorizationId, row.preauth.id),
        eq(schema.insurancePreauthorizationAttachments.tenantId, params.tenantId),
        eq(schema.insurancePreauthorizationAttachments.facilityId, params.facilityId),
      ),
    )
    .orderBy(desc(schema.insurancePreauthorizationAttachments.uploadedAt));

  return {
    ...row.preauth,
    patientName: `${row.patientFirstName} ${row.patientLastName}`.trim(),
    attachments,
  };
}

export async function createPrivatePreauthorization(params: {
  tenantId: number;
  facilityId: number;
  actorUserId: number;
  actorUserUid: string;
  actorRole?: string;
  input: Record<string, unknown>;
}) {
  const patientId = Number(params.input.patientId);
  if (!Number.isInteger(patientId) || patientId <= 0) {
    throw new PrivateInsuranceError('INVALID_PATIENT_ID', 'Valid patientId is required.', 400);
  }

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

  let memberPolicyId: number | null = null;
  if (params.input.memberPolicyId) {
    const [mp] = await db
      .select()
      .from(schema.insuranceMemberPolicies)
      .where(
        and(
          eq(schema.insuranceMemberPolicies.id, Number(params.input.memberPolicyId)),
          eq(schema.insuranceMemberPolicies.tenantId, params.tenantId),
          eq(schema.insuranceMemberPolicies.facilityId, params.facilityId),
          eq(schema.insuranceMemberPolicies.patientId, patientId),
        ),
      )
      .limit(1);
    if (!mp) {
      throw new PrivateInsuranceError(
        'MEMBER_POLICY_NOT_FOUND',
        'Member policy does not belong to this patient/facility.',
        404,
      );
    }
    memberPolicyId = mp.id;
  }

  const clinicalIndication = String(params.input.clinicalIndication ?? '').trim();
  const primaryDiagnosisCode = String(params.input.primaryDiagnosisCode ?? '').trim();
  const primaryDiagnosisDisplay = String(params.input.primaryDiagnosisDisplay ?? '').trim();

  if (!clinicalIndication || !primaryDiagnosisCode || !primaryDiagnosisDisplay) {
    throw new PrivateInsuranceError(
      'CLINICAL_DETAILS_REQUIRED',
      'clinicalIndication, primaryDiagnosisCode, and primaryDiagnosisDisplay are required.',
      400,
    );
  }

  const rawItems = Array.isArray(params.input.requestedItems)
    ? (params.input.requestedItems as Array<Record<string, unknown>>)
    : [];

  let totalEstimatedCents = 0;
  const normalizedItems: Array<{
    serviceCode: string;
    serviceName: string;
    quantity: number;
    unitPrice: string;
    estimatedTotal: string;
    tariffId?: number | null;
  }> = [];

  if (rawItems.length > 0) {
    for (const item of rawItems) {
      const code = String(item.serviceCode ?? '').trim();
      const name = String(item.serviceName ?? '').trim();
      const qty = Math.max(1, Math.trunc(Number(item.quantity ?? 1)));
      const unitCents = moneyToCentsStrict(item.unitPrice as string | number, 'Item unit price');
      const lineTotalCents = unitCents * qty;
      totalEstimatedCents += lineTotalCents;
      normalizedItems.push({
        serviceCode: code || 'UNMAPPED',
        serviceName: name || 'Requested Clinical Service',
        quantity: qty,
        unitPrice: formatCents(unitCents),
        estimatedTotal: formatCents(lineTotalCents),
        tariffId: item.tariffId ? Number(item.tariffId) : null,
      });
    }
  } else {
    const requestedServiceCode = String(params.input.requestedServiceCode ?? '').trim();
    const requestedServiceName = String(params.input.requestedServiceName ?? '').trim();
    if (!requestedServiceCode || !requestedServiceName) {
      throw new PrivateInsuranceError(
        'REQUESTED_SERVICE_REQUIRED',
        'Provide requestedItems or requestedServiceCode and requestedServiceName.',
        400,
      );
    }
    const qty = Math.max(1, Math.trunc(Number(params.input.quantity ?? 1)));
    totalEstimatedCents = moneyToCentsStrict(
      params.input.estimatedAmount as string | number,
      'Estimated amount',
    );
    const unitCents = Math.floor(totalEstimatedCents / qty);
    normalizedItems.push({
      serviceCode: requestedServiceCode,
      serviceName: requestedServiceName,
      quantity: qty,
      unitPrice: formatCents(unitCents),
      estimatedTotal: formatCents(totalEstimatedCents),
      tariffId: params.input.tariffId ? Number(params.input.tariffId) : null,
    });
  }

  const firstItem = normalizedItems[0];
  const preauthNumber = await nextPreauthNumber(payerRow.payerCode);

  const [created] = await db
    .insert(schema.insurancePreauthorizations)
    .values({
      tenantId: params.tenantId,
      facilityId: params.facilityId,
      patientId,
      memberPolicyId,
      encounterId: params.input.encounterId ? Number(params.input.encounterId) : null,
      invoiceId: params.input.invoiceId ? Number(params.input.invoiceId) : null,
      tariffId: firstItem.tariffId ?? null,
      payerCode: payerRow.payerCode,
      preauthNumber,
      externalBundleId: randomUUID(),
      category:
        typeof params.input.category === 'string' && params.input.category.trim()
          ? params.input.category.trim().toUpperCase()
          : 'GENERAL',
      status: 'DRAFT',
      source: 'LOCAL_DRAFT',
      isSimulated: false,
      clinicalIndication,
      primaryDiagnosisCode,
      primaryDiagnosisDisplay,
      codingSystem:
        typeof params.input.codingSystem === 'string' && params.input.codingSystem.trim()
          ? params.input.codingSystem.trim()
          : payerRow.defaultCodingSystem,
      requestedServiceCode: firstItem.serviceCode,
      requestedServiceName: firstItem.serviceName,
      requestedItems: normalizedItems,
      quantity: normalizedItems.reduce((sum, i) => sum + i.quantity, 0),
      estimatedAmount: formatCents(totalEstimatedCents),
      supportingNotes:
        typeof params.input.supportingNotes === 'string' ? params.input.supportingNotes : null,
      createdByUserId: params.actorUserId,
    })
    .returning();

  await recordPrivateInsuranceAudit({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    actorUserUid: params.actorUserUid,
    actorRole: params.actorRole,
    action: 'PRIVATE_INSURANCE_PREAUTH_CREATED',
    entityType: 'insurance_preauthorization',
    entityId: created.id,
    details: {
      payerCode: created.payerCode,
      preauthNumber: created.preauthNumber,
      estimatedAmount: created.estimatedAmount,
    },
  });

  return getPrivatePreauthorizationById({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    preauthId: created.id,
  });
}

export async function addPrivatePreauthAttachment(params: {
  tenantId: number;
  facilityId: number;
  preauthId: number;
  actorUserId: number;
  actorUserUid: string;
  actorRole?: string;
  input: Record<string, unknown>;
}) {
  const preauth = await getPrivatePreauthorizationById({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    preauthId: params.preauthId,
  });

  const documentType = String(params.input.documentType ?? '')
    .trim()
    .toUpperCase();
  const fileName = String(params.input.fileName ?? '').trim();
  const storageReference = String(params.input.storageReference ?? '').trim();

  if (!documentType || !fileName || !storageReference) {
    throw new PrivateInsuranceError(
      'ATTACHMENT_FIELDS_REQUIRED',
      'documentType, fileName, and storageReference are required.',
      400,
    );
  }

  const checksum =
    typeof params.input.checksumSha256 === 'string' && params.input.checksumSha256.trim()
      ? params.input.checksumSha256.trim()
      : createHash('sha256').update(`${fileName}:${storageReference}`).digest('hex');

  const [created] = await db
    .insert(schema.insurancePreauthorizationAttachments)
    .values({
      tenantId: params.tenantId,
      facilityId: params.facilityId,
      preauthorizationId: preauth.id,
      documentType,
      fileName,
      mimeType:
        typeof params.input.mimeType === 'string' && params.input.mimeType.trim()
          ? params.input.mimeType.trim()
          : 'application/pdf',
      fileSizeBytes: Math.max(0, Math.trunc(Number(params.input.fileSizeBytes ?? 0))),
      storageReference,
      checksumSha256: checksum,
      notes: typeof params.input.notes === 'string' ? params.input.notes : null,
      uploadedByUserId: params.actorUserId,
    })
    .returning();

  await recordPrivateInsuranceAudit({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    actorUserUid: params.actorUserUid,
    actorRole: params.actorRole,
    action: 'PRIVATE_INSURANCE_PREAUTH_ATTACHMENT_ADDED',
    entityType: 'insurance_preauthorization',
    entityId: preauth.id,
    details: { attachmentId: created.id, documentType, fileName },
  });

  return created;
}

export async function submitPrivatePreauthorization(params: {
  tenantId: number;
  facilityId: number;
  preauthId: number;
  actorUserId: number;
  actorUserUid: string;
  actorRole?: string;
  input: Record<string, unknown>;
}) {
  const preauth = await getPrivatePreauthorizationById({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    preauthId: params.preauthId,
  });

  const payerRow = await getPayerRowScoped({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    payerCode: preauth.payerCode,
  });

  const submissionMode = String(params.input.submissionMode ?? 'ADAPTER')
    .trim()
    .toUpperCase();
  const correlationId = randomUUID();

  if (submissionMode === 'MANUAL') {
    const manualDispatchReference = String(params.input.manualDispatchReference ?? '').trim();
    if (!manualDispatchReference) {
      throw new PrivateInsuranceError(
        'MANUAL_DISPATCH_REF_REQUIRED',
        'Manual preauthorization dispatch requires manualDispatchReference (e.g. insurer email/portal ticket reference).',
        400,
      );
    }

    if (!canTransitionPrivatePreauthStatus(preauth.status as PrivatePreauthStatus, 'REQUESTED')) {
      throw new PrivateInsuranceError(
        'INVALID_PREAUTH_TRANSITION',
        `Cannot submit preauthorization from status ${preauth.status}.`,
        409,
      );
    }

    await db
      .update(schema.insurancePreauthorizations)
      .set({
        status: 'REQUESTED',
        source: 'MANUAL_DISPATCH',
        mediatorId: manualDispatchReference,
        submittedByUserId: params.actorUserId,
        submittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.insurancePreauthorizations.id, preauth.id));

    await recordPrivateInsuranceAudit({
      tenantId: params.tenantId,
      facilityId: params.facilityId,
      actorUserUid: params.actorUserUid,
      actorRole: params.actorRole,
      action: 'PRIVATE_INSURANCE_PREAUTH_MANUAL_SUBMITTED',
      entityType: 'insurance_preauthorization',
      entityId: preauth.id,
      details: {
        payerCode: preauth.payerCode,
        preauthNumber: preauth.preauthNumber,
        manualDispatchReference,
      },
    });

    return getPrivatePreauthorizationById({
      tenantId: params.tenantId,
      facilityId: params.facilityId,
      preauthId: preauth.id,
    });
  }

  // Adapter submission
  const runtime = toPayerRuntimeConfig(payerRow);
  const secrets = inspectSecretEnvPresence(runtime.secretEnvPrefix, runtime.authMethod);
  const adapter = getPayerAdapter(runtime.adapterKey) ?? getPayerAdapter('manual')!;

  let memberNumber = String(params.input.memberNumber ?? '').trim();
  let policyNumber: string | null = null;
  if (preauth.memberPolicyId) {
    const [mp] = await db
      .select()
      .from(schema.insuranceMemberPolicies)
      .where(eq(schema.insuranceMemberPolicies.id, preauth.memberPolicyId))
      .limit(1);
    if (mp) {
      memberNumber = memberNumber || mp.memberNumber;
      policyNumber = mp.policyNumber;
    }
  }

  const adapterRes = await adapter.submitPreauthorization(
    {
      correlationId,
      payer: runtime,
      preauthNumber: preauth.preauthNumber,
      memberNumber: memberNumber || 'UNSPECIFIED',
      policyNumber,
      clinicalIndication: preauth.clinicalIndication,
      diagnosisCode: preauth.primaryDiagnosisCode,
      diagnosisDisplay: preauth.primaryDiagnosisDisplay,
      codingSystem: preauth.codingSystem,
      requestedItems: (preauth.requestedItems ?? []).map((i) => ({
        payerServiceCode: i.serviceCode,
        serviceName: i.serviceName,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        estimatedTotal: i.estimatedTotal,
      })),
      estimatedAmount: preauth.estimatedAmount,
    },
    secrets,
  );

  if (!adapterRes.supported) {
    await recordIntegrationDiagnostic({
      tenantId: params.tenantId,
      facilityId: params.facilityId,
      payerCode: preauth.payerCode,
      adapterKey: runtime.adapterKey,
      environment: runtime.environment,
      operation: 'PREAUTHORIZATION_SUBMIT',
      outcome: adapterRes.code,
      correlationId,
      summary: adapterRes.message,
      actorUserId: params.actorUserId,
    });

    throw new PrivateInsuranceError(adapterRes.code, adapterRes.message, 422, {
      requiredFromInsurer: adapterRes.requiredFromInsurer,
    });
  }

  await db
    .update(schema.insurancePreauthorizations)
    .set({
      status: adapterRes.status,
      source: adapterRes.source,
      payerAuthReference: adapterRes.payerAuthReference,
      approvedAmount: adapterRes.approvedAmount,
      conditions: adapterRes.conditions,
      validFrom: adapterRes.validFrom,
      validUntil: adapterRes.validUntil,
      rejectionReason: adapterRes.rejectionReason,
      submittedByUserId: params.actorUserId,
      submittedAt: new Date(),
      decidedAt:
        adapterRes.status === 'APPROVED' ||
        adapterRes.status === 'PARTIALLY_APPROVED' ||
        adapterRes.status === 'REJECTED'
          ? new Date()
          : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.insurancePreauthorizations.id, preauth.id));

  await recordIntegrationDiagnostic({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    payerCode: preauth.payerCode,
    adapterKey: runtime.adapterKey,
    environment: runtime.environment,
    operation: 'PREAUTHORIZATION_SUBMIT',
    outcome: adapterRes.status,
    httpStatus: adapterRes.httpStatus ?? null,
    durationMs: adapterRes.durationMs,
    correlationId,
    summary: adapterRes.summary,
    actorUserId: params.actorUserId,
  });

  return getPrivatePreauthorizationById({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    preauthId: preauth.id,
  });
}

export async function recordPrivatePreauthDecision(params: {
  tenantId: number;
  facilityId: number;
  preauthId: number;
  actorUserId: number;
  actorUserUid: string;
  actorRole?: string;
  input: Record<string, unknown>;
}) {
  const preauth = await getPrivatePreauthorizationById({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    preauthId: params.preauthId,
  });

  const nextStatus = String(params.input.status ?? '')
    .trim()
    .toUpperCase() as PrivatePreauthStatus;

  if (!canTransitionPrivatePreauthStatus(preauth.status as PrivatePreauthStatus, nextStatus)) {
    throw new PrivateInsuranceError(
      'INVALID_PREAUTH_TRANSITION',
      `Invalid preauthorization transition from ${preauth.status} to ${nextStatus}.`,
      409,
    );
  }

  const payerAuthReference =
    typeof params.input.payerAuthReference === 'string' && params.input.payerAuthReference.trim()
      ? params.input.payerAuthReference.trim()
      : preauth.payerAuthReference;

  // Never mark APPROVED or PARTIALLY_APPROVED without an explicit insurer authorization reference!
  if ((nextStatus === 'APPROVED' || nextStatus === 'PARTIALLY_APPROVED') && !payerAuthReference) {
    throw new PrivateInsuranceError(
      'PAYER_AUTH_REFERENCE_REQUIRED',
      'Cannot mark preauthorization APPROVED or PARTIALLY_APPROVED without an authentic insurer authorization reference.',
      400,
    );
  }

  let approvedAmount = preauth.approvedAmount;
  if (
    params.input.approvedAmount !== undefined &&
    params.input.approvedAmount !== null &&
    params.input.approvedAmount !== ''
  ) {
    approvedAmount = formatCents(
      moneyToCentsStrict(params.input.approvedAmount as string | number, 'Approved amount'),
    );
  }

  await db
    .update(schema.insurancePreauthorizations)
    .set({
      status: nextStatus,
      source: 'MANUAL_INSURER_DECISION',
      payerAuthReference,
      approvedAmount,
      conditions:
        typeof params.input.conditions === 'string' ? params.input.conditions : preauth.conditions,
      validFrom:
        typeof params.input.validFrom === 'string' && params.input.validFrom.trim()
          ? params.input.validFrom.trim()
          : preauth.validFrom,
      validUntil:
        typeof params.input.validUntil === 'string' && params.input.validUntil.trim()
          ? params.input.validUntil.trim()
          : preauth.validUntil,
      rejectionReason:
        typeof params.input.rejectionReason === 'string'
          ? params.input.rejectionReason
          : preauth.rejectionReason,
      decidedByUserId: params.actorUserId,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.insurancePreauthorizations.id, preauth.id));

  await recordPrivateInsuranceAudit({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    actorUserUid: params.actorUserUid,
    actorRole: params.actorRole,
    action: 'PRIVATE_INSURANCE_PREAUTH_DECISION_RECORDED',
    entityType: 'insurance_preauthorization',
    entityId: preauth.id,
    details: {
      payerCode: preauth.payerCode,
      fromStatus: preauth.status,
      toStatus: nextStatus,
      payerAuthReference,
      approvedAmount,
    },
  });

  return getPrivatePreauthorizationById({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    preauthId: preauth.id,
  });
}
