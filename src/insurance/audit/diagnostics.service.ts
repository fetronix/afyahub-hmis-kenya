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

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === 'object')
    return sanitizeAuditMetadata(value as Record<string, unknown>);
  return value;
}

export function sanitizeAuditMetadata(input: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    clean[key] = REDACTED_KEYS.test(key) ? '[REDACTED]' : sanitizeValue(value);
  }
  return clean;
}

const SAFE_DIAGNOSTIC_OPERATIONS = new Set([
  'ELIGIBILITY_VERIFY',
  'PREAUTHORIZATION_SUBMIT',
  'CLAIM_SUBMIT',
  'CLAIM_RESUBMIT',
  'CLAIM_STATUS',
  'CONNECTION_STATUS_PROBE',
  'REMITTANCE_PULL',
]);
const SAFE_DIAGNOSTIC_OUTCOMES = new Set([
  'NOT_CONFIGURED',
  'AWAITING_DOCUMENTATION',
  'SANDBOX_CONFIGURED',
  'DEGRADED',
  'CAPABILITY_UNAVAILABLE',
  'ELIGIBLE',
  'INELIGIBLE',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'FAILED_TRANSPORT',
  'PENDING',
  'ACCEPTED',
  'FAILED',
  'UNKNOWN',
  'NOT_SENT',
  'VALID',
  'INVALID',
  'ERROR',
  'SUCCESS',
  'MANUAL',
  'UNVERIFIED',
]);
function safeOperation(value: string): string {
  return SAFE_DIAGNOSTIC_OPERATIONS.has(value) ? value : 'OTHER';
}
function safeOutcome(value: string): string {
  return SAFE_DIAGNOSTIC_OUTCOMES.has(value) ? value : 'OTHER';
}
const SAFE_SUMMARY = 'Provider details are withheld; this entry does not establish authorization.';

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
    operation: safeOperation(params.operation),
    direction: params.direction ?? 'OUTBOUND',
    outcome: safeOutcome(params.outcome),
    httpStatus: params.httpStatus ?? null,
    durationMs: Math.max(0, Math.trunc(params.durationMs ?? 0)),
    correlationId:
      params.correlationId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.correlationId)
        ? params.correlationId
        : randomUUID(),
    errorCode: null,
    summary: SAFE_SUMMARY,
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
    .where(
      and(
        eq(schema.auditLogs.tenantId, params.tenantId),
        eq(schema.auditLogs.facilityId, params.facilityId),
      ),
    )
    .orderBy(desc(schema.auditLogs.timestamp))
    .limit(200);

  const insuranceAudits = audits
    .filter(
      (row) => row.action.startsWith('INSURANCE_') || row.action.startsWith('PRIVATE_INSURANCE_'),
    )
    .slice(0, limit);

  return {
    diagnostics: diagnostics.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      facilityId: row.facilityId,
      payerCode: row.payerCode,
      environment: ['SANDBOX', 'PRODUCTION', 'UNCONFIGURED'].includes(row.environment)
        ? row.environment
        : 'UNKNOWN',
      operation: safeOperation(row.operation),
      direction: ['OUTBOUND', 'INBOUND', 'INTERNAL'].includes(row.direction)
        ? row.direction
        : 'INTERNAL',
      outcome: safeOutcome(row.outcome),
      httpStatus: row.httpStatus,
      durationMs: row.durationMs,
      summary: SAFE_SUMMARY,
      actorUserId: row.actorUserId,
      createdAt: row.createdAt,
    })),
    auditEvents: insuranceAudits.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      facilityId: row.facilityId,
      userId: row.userId,
      action: row.action,
      resource: row.resource,
      resourceId: row.resourceId,
      timestamp: row.timestamp,
    })),
  };
}
