/**
 * JaliCare HMIS — Private Insurance Audit & Integration Diagnostics
 *
 * Writes append-only audit trail entries (`audit_logs`) and integration
 * diagnostic rows (`insurance_integration_diagnostics`) with strict
 * secret and PHI minimization.
 */

import { desc, eq, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';

const REDACTED_KEYS = /secret|token|password|authorization|bearer|api_key|apikey|client_secret/i;

export function sanitizeAuditMetadata(input: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (REDACTED_KEYS.test(key)) {
      clean[key] = '[REDACTED]';
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      clean[key] = sanitizeAuditMetadata(value as Record<string, unknown>);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

export async function recordPrivateInsuranceAudit(params: {
  tenantId: number;
  facilityId: number;
  actorUserUid: string;
  actorRole?: string;
  action: string;
  entityType: string;
  entityId: string | number;
  details: Record<string, unknown>;
  ipAddress?: string | null;
}): Promise<void> {
  const safeDetails = sanitizeAuditMetadata({
    facilityId: params.facilityId,
    entityType: params.entityType,
    entityId: String(params.entityId),
    ...params.details,
  });

  await db.insert(schema.auditLogs).values({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    userId: params.actorUserUid,
    action: params.action,
    resource: params.entityType,
    resourceId: String(params.entityId),
    details: JSON.stringify(safeDetails),
    ipAddress: params.ipAddress ?? null,
  });
}

export async function recordIntegrationDiagnostic(params: {
  tenantId: number;
  facilityId: number;
  payerCode: string;
  adapterKey: string;
  environment: string;
  operation: string;
  direction?: 'OUTBOUND' | 'INBOUND' | 'INTERNAL';
  outcome: string;
  httpStatus?: number | null;
  durationMs?: number;
  correlationId?: string;
  errorCode?: string | null;
  summary: string;
  actorUserId?: number | null;
}): Promise<void> {
  await db.insert(schema.insuranceIntegrationDiagnostics).values({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    payerCode: params.payerCode.toUpperCase(),
    adapterKey: params.adapterKey,
    environment: params.environment,
    operation: params.operation,
    direction: params.direction ?? 'OUTBOUND',
    outcome: params.outcome,
    httpStatus: params.httpStatus ?? null,
    durationMs: Math.max(0, Math.trunc(params.durationMs ?? 0)),
    correlationId: params.correlationId ?? randomUUID(),
    errorCode: params.errorCode ?? null,
    summary: params.summary.slice(0, 500),
    actorUserId: params.actorUserId ?? null,
  });
}

export async function listIntegrationDiagnostics(params: {
  tenantId: number;
  facilityId: number;
  payerCode?: string;
  limit?: number;
}) {
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));
  const filters = [
    eq(schema.insuranceIntegrationDiagnostics.tenantId, params.tenantId),
    eq(schema.insuranceIntegrationDiagnostics.facilityId, params.facilityId),
  ];
  if (params.payerCode) {
    filters.push(
      eq(schema.insuranceIntegrationDiagnostics.payerCode, params.payerCode.toUpperCase()),
    );
  }

  const diagnostics = await db
    .select()
    .from(schema.insuranceIntegrationDiagnostics)
    .where(and(...filters))
    .orderBy(desc(schema.insuranceIntegrationDiagnostics.createdAt))
    .limit(limit);

  const audits = await db
    .select()
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.tenantId, params.tenantId))
    .orderBy(desc(schema.auditLogs.timestamp))
    .limit(200);

  const insuranceAudits = audits
    .filter(
      (row) => row.action.startsWith('INSURANCE_') || row.action.startsWith('PRIVATE_INSURANCE_'),
    )
    .slice(0, limit);

  return {
    diagnostics,
    auditEvents: insuranceAudits,
  };
}
