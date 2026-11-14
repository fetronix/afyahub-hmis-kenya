/**
 * Facility approval-policy API client.
 *
 * Approval policies are amount thresholds: a policy applies to amounts at or
 * above its minimum, and the highest matching threshold wins. The facility id is
 * a hint — the server re-resolves it from the session and refuses a facility the
 * caller is not entitled to.
 */

import { API_BASE, fetchJson } from './http.ts';

export type ApprovalScopeKey = 'REQUISITION' | 'PURCHASE_ORDER';

export type ApprovalPolicyRow = {
  id: number;
  tenantId: number;
  facilityId: number;
  policyScope: ApprovalScopeKey;
  policyName: string;
  /** Integer cents. Whole currency units are formatted for display only. */
  minAmountCents: number;
  requiredPermission: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  notes: string | null;
  createdByUserId: number | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalPolicyList = {
  policies: ApprovalPolicyRow[];
  activeCount: number;
};

/** The rule that would govern a proposed amount, and whether the caller meets it. */
export type ApprovalPreview = {
  scope: ApprovalScopeKey;
  amountCents: number;
  onDate: string;
  rule: {
    policyId: number;
    policyName: string;
    requiredPermission: string;
    minAmountCents: number;
  } | null;
  satisfied: boolean;
  note: string;
};

function withFacility(path: string, facilityId: number): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${API_BASE}${path}${separator}facilityId=${encodeURIComponent(String(facilityId))}`;
}

export const approvalPolicyClient = {
  listApprovalPolicies: (facilityId: number) =>
    fetchJson<ApprovalPolicyList>(withFacility('/approval-policies', facilityId)),

  /**
   * What would an amount of this size require? `amountCents` is an integer; the
   * form converts from currency before it gets here so no float reaches the
   * server's integer check.
   */
  previewApprovalRequirement: (
    facilityId: number,
    params: { scope: ApprovalScopeKey; amountCents: number },
  ) => {
    /* Evaluated as at today, which is what the server does. */
    const search = new URLSearchParams({
      facilityId: String(facilityId),
      scope: params.scope,
      amountCents: String(params.amountCents),
    });
    return fetchJson<ApprovalPreview>(`${API_BASE}/approval-policies/preview?${search.toString()}`);
  },

  createApprovalPolicy: (
    facilityId: number,
    body: {
      policyScope: ApprovalScopeKey;
      policyName: string;
      minAmountCents: number;
      requiredPermission: string;
      effectiveFrom: string;
      effectiveTo?: string | null;
      notes?: string | null;
    },
  ) =>
    fetchJson<{ policy: ApprovalPolicyRow }>(withFacility('/approval-policies', facilityId), {
      method: 'POST',
      body: JSON.stringify({ ...body, facilityId }),
    }),

  /**
   * Only the mutable fields are sent. Threshold, scope and required permission
   * are immutable once created: rewriting them would silently restate the rule
   * that previous approvals were judged against. To move a threshold, retire the
   * old policy and create a new one.
   */
  updateApprovalPolicy: (
    facilityId: number,
    id: number,
    body: {
      policyName?: string;
      effectiveTo?: string | null;
      isActive?: boolean;
      notes?: string | null;
    },
  ) =>
    fetchJson<{ policy: ApprovalPolicyRow }>(withFacility(`/approval-policies/${id}`, facilityId), {
      method: 'PUT',
      body: JSON.stringify({ ...body, facilityId }),
    }),
};
