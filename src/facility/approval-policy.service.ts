/**
 * Delegated approval authority.
 *
 * A facility can raise the authority needed for larger commitments. Policies
 * are thresholds: a policy applies to amounts at or above its minimum, and the
 * highest matching threshold wins. That ordering matters — it means a large
 * purchase can never be approved under a small-value rule, and adding a lower
 * threshold cannot accidentally weaken a higher one.
 *
 * The service is deliberately conservative:
 *  - a facility with no active policy keeps the existing permission gate;
 *  - a policy may only name a permission that exists in the catalogue;
 *  - two policies for the same scope cannot share a threshold;
 *  - approvals record the rule that applied, so the decision can be explained.
 */

import { and, asc, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';

import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { optionalOrderText } from '../procurement/order-items.ts';

export type ApprovalScopeKey = 'REQUISITION' | 'PURCHASE_ORDER';

export const APPROVAL_SCOPES: ApprovalScopeKey[] = ['REQUISITION', 'PURCHASE_ORDER'];

export type FacilityScope = {
  tenantId: number;
  facilityId: number;
  actorId: number;
  actorName: string;
};

export class ApprovalPolicyError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApprovalPolicyError';
  }
}

function fail(
  statusCode: number,
  code: string,
  message: string,
  detail?: Record<string, unknown>,
): never {
  throw new ApprovalPolicyError(statusCode, code, message, detail);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(value: unknown, label: string, required: boolean): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    if (required) fail(400, 'INVALID_INPUT', `${label} is required.`);
    return null;
  }
  if (!ISO_DATE.test(raw)) fail(400, 'INVALID_INPUT', `${label} must be YYYY-MM-DD.`);
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw)
    fail(400, 'INVALID_INPUT', `${label} must be a real calendar date.`);
  return raw;
}

function scopeKey(value: unknown): ApprovalScopeKey {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!APPROVAL_SCOPES.includes(raw as ApprovalScopeKey))
    fail(400, 'INVALID_SCOPE', `Scope must be one of ${APPROVAL_SCOPES.join(', ')}.`);
  return raw as ApprovalScopeKey;
}

/** Amounts arrive as integer cents. A float or a string with a decimal is refused. */
function amountCents(value: unknown, label: string): number {
  const parsed = typeof value === 'string' ? Number(value) : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    fail(400, 'INVALID_AMOUNT', `${label} must be a whole number of cents, zero or more.`);
  return parsed;
}

/** The read surface shared by the pool and a transaction client. */
type Executor = Pick<typeof db, 'select'>;

export type ResolvedApprovalRule = {
  policyId: number;
  policyName: string;
  requiredPermission: string;
  minAmountCents: number;
};

/**
 * Find the rule that governs an amount, as at `onDate`.
 *
 * Returns null when the facility has no active policy at or below the amount,
 * which keeps the existing permission gate in force rather than weakening it.
 */
export async function resolveApprovalRule(
  facilityId: number,
  scope: ApprovalScopeKey,
  amountCents: number,
  onDate: string,
  executor: Executor = db,
): Promise<ResolvedApprovalRule | null> {
  const [policy] = await executor
    .select()
    .from(schema.approvalPolicies)
    .where(
      and(
        eq(schema.approvalPolicies.facilityId, facilityId),
        eq(schema.approvalPolicies.policyScope, scope),
        eq(schema.approvalPolicies.isActive, true),
        lte(schema.approvalPolicies.minAmountCents, amountCents),
        lte(schema.approvalPolicies.effectiveFrom, onDate),
        or(
          isNull(schema.approvalPolicies.effectiveTo),
          gte(schema.approvalPolicies.effectiveTo, onDate),
        ),
      ),
    )
    .orderBy(desc(schema.approvalPolicies.minAmountCents))
    .limit(1);
  if (!policy) return null;
  return {
    policyId: policy.id,
    policyName: policy.policyName,
    requiredPermission: policy.requiredPermission,
    minAmountCents: policy.minAmountCents,
  };
}

/**
 * Refuse an approval that does not carry the authority the facility requires.
 * The caller must already have passed the route-level permission gate.
 */
export async function assertApprovalAuthority(
  facilityId: number,
  scope: ApprovalScopeKey,
  amountCents: number,
  onDate: string,
  permissions: string[],
  executor: Executor = db,
): Promise<ResolvedApprovalRule | null> {
  const rule = await resolveApprovalRule(facilityId, scope, amountCents, onDate, executor);
  if (!rule) return null;
  if (!permissions.includes(rule.requiredPermission))
    fail(
      403,
      'APPROVAL_AUTHORITY_REQUIRED',
      `This amount needs "${rule.requiredPermission}" under the facility rule "${rule.policyName}".`,
      { policyId: rule.policyId, requiredPermission: rule.requiredPermission },
    );
  return rule;
}

export async function listPolicies(scope: FacilityScope) {
  return db
    .select()
    .from(schema.approvalPolicies)
    .where(
      and(
        eq(schema.approvalPolicies.tenantId, scope.tenantId),
        eq(schema.approvalPolicies.facilityId, scope.facilityId),
      ),
    )
    .orderBy(
      asc(schema.approvalPolicies.policyScope),
      asc(schema.approvalPolicies.minAmountCents),
      desc(schema.approvalPolicies.id),
    );
}

async function permissionExists(code: string): Promise<boolean> {
  const [permission] = await db
    .select({ id: schema.permissions.id })
    .from(schema.permissions)
    .where(eq(schema.permissions.code, code))
    .limit(1);
  return Boolean(permission);
}

export async function createPolicy(scope: FacilityScope, body: Record<string, unknown>) {
  const key = scopeKey(body.policyScope ?? body.scope);
  const name = String(body.policyName ?? body.name ?? '').trim();
  if (!name || name.length > 120)
    fail(400, 'INVALID_INPUT', 'Policy name is required (120 characters or fewer).');
  const minAmountCents = amountCents(body.minAmountCents ?? 0, 'Minimum amount');
  const requiredPermission = String(body.requiredPermission ?? '').trim();
  if (!requiredPermission)
    fail(400, 'INVALID_INPUT', 'A required permission is needed.');
  if (!(await permissionExists(requiredPermission)))
    fail(400, 'UNKNOWN_PERMISSION', 'That permission is not in the catalogue.');
  const effectiveFrom = isoDate(body.effectiveFrom, 'Effective from', true)!;
  const effectiveTo = isoDate(body.effectiveTo, 'Effective to', false);
  if (effectiveTo && effectiveTo < effectiveFrom)
    fail(400, 'INVALID_INPUT', 'The end date cannot be before the start date.');
  const notes = optionalOrderText(body.notes, 'Notes', 500);

  const [existing] = await db
    .select({ id: schema.approvalPolicies.id, name: schema.approvalPolicies.policyName })
    .from(schema.approvalPolicies)
    .where(
      and(
        eq(schema.approvalPolicies.facilityId, scope.facilityId),
        eq(schema.approvalPolicies.policyScope, key),
        eq(schema.approvalPolicies.minAmountCents, minAmountCents),
      ),
    )
    .limit(1);
  if (existing)
    fail(
      409,
      'APPROVAL_THRESHOLD_IN_USE',
      `Threshold ${minAmountCents} already has the rule "${existing.name}".`,
    );

  const [created] = await db
    .insert(schema.approvalPolicies)
    .values({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      policyScope: key,
      policyName: name,
      minAmountCents,
      requiredPermission,
      effectiveFrom,
      effectiveTo,
      isActive: true,
      notes,
      createdByUserId: scope.actorId,
      createdByName: scope.actorName,
    })
    .returning();

  await db.insert(schema.auditLogs).values({
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    userId: String(scope.actorId),
    resource: 'ApprovalPolicy',
    resourceId: String(created.id),
    action: 'CREATE',
    details: `${key} threshold from ${minAmountCents} cents requires ${requiredPermission} ("${name}").`,
  });

  return created;
}

export async function updatePolicy(
  scope: FacilityScope,
  id: number,
  body: Record<string, unknown>,
) {
  const [current] = await db
    .select()
    .from(schema.approvalPolicies)
    .where(
      and(
        eq(schema.approvalPolicies.id, id),
        eq(schema.approvalPolicies.tenantId, scope.tenantId),
        eq(schema.approvalPolicies.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  if (!current) fail(404, 'APPROVAL_POLICY_NOT_FOUND', 'Approval policy not found.');

  const isActive =
    body.isActive === undefined ? current.isActive : body.isActive === true || body.isActive === 'true';
  const name =
    body.policyName === undefined ? current.policyName : String(body.policyName).trim();
  if (!name || name.length > 120) fail(400, 'INVALID_INPUT', 'Policy name is invalid.');
  const effectiveTo =
    body.effectiveTo === undefined
      ? current.effectiveTo
      : isoDate(body.effectiveTo, 'Effective to', false);
  if (effectiveTo && effectiveTo < current.effectiveFrom)
    fail(400, 'INVALID_INPUT', 'The end date cannot be before the start date.');

  const [updated] = await db
    .update(schema.approvalPolicies)
    .set({
      policyName: name,
      effectiveTo,
      isActive,
      notes: body.notes === undefined ? current.notes : optionalOrderText(body.notes, 'Notes', 500),
      updatedAt: new Date(),
    })
    .where(eq(schema.approvalPolicies.id, id))
    .returning();

  await db.insert(schema.auditLogs).values({
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    userId: String(scope.actorId),
    resource: 'ApprovalPolicy',
    resourceId: String(id),
    action: isActive === current.isActive ? 'UPDATE' : isActive ? 'ACTIVATE' : 'DEACTIVATE',
    details: `Approval policy "${name}" ${isActive ? 'active' : 'inactive'}.`,
  });

  return updated;
}

/** What the caller would need in order to approve this amount right now. */
export async function previewRequirement(
  scope: FacilityScope,
  rawScope: unknown,
  rawAmount: unknown,
  permissions: string[],
  onDate = new Date().toISOString().slice(0, 10),
) {
  const key = scopeKey(rawScope);
  const amount = amountCents(rawAmount, 'Amount');
  const rule = await resolveApprovalRule(scope.facilityId, key, amount, onDate);
  return {
    scope: key,
    amountCents: amount,
    onDate,
    rule,
    satisfied: rule ? permissions.includes(rule.requiredPermission) : true,
    note: rule
      ? `Amounts from ${(rule.minAmountCents / 100).toFixed(2)} KES need ${rule.requiredPermission}.`
      : 'No facility rule covers this amount; the standard approval permission applies.',
  };
}

/** Count of active rules, used by the configuration screen summary. */
export async function activePolicyCount(scope: FacilityScope) {
  const rows = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(schema.approvalPolicies)
    .where(
      and(
        eq(schema.approvalPolicies.tenantId, scope.tenantId),
        eq(schema.approvalPolicies.facilityId, scope.facilityId),
        eq(schema.approvalPolicies.isActive, true),
      ),
    );
  return rows[0]?.count ?? 0;
}
