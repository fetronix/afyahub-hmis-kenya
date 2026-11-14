/** Shared reset payloads. Monthly rows are inseparable dependencies of selected items. */
export type ResetSelection = {
  planIds: number[];
  stationery: boolean;
  branding: boolean;
  uniforms: boolean;
  deleteEmptyPlans: boolean;
  provenance: 'ALL' | 'IMPORTED' | 'MANUAL';
};
export type ResetCounts = {
  stationery: number;
  branding: number;
  uniforms: number;
  months: number;
  categories: number;
  plans: number;
  imported: number;
  manual: number;
};
export type ResetPlan = {
  id: number;
  name: string;
  financial_year: number;
  status: string;
  version: number;
  stationery: number;
  branding: number;
  uniforms: number;
  months: number;
  imported: number;
  manual: number;
  eligible: boolean;
  disposable: boolean;
  retentionReason: string;
};
export type ResetInventory = {
  facility: { id: number; name: string };
  plans: ResetPlan[];
  batches: Array<{ id: number; filename: string; status: string; created_at: string }>;
};
export type ResetPreview = {
  facility: ResetInventory['facility'];
  selection: ResetSelection;
  reason: string;
  counts: ResetCounts;
  planIdsToDelete: number[];
  retainedPlans: Array<{ id: number; reason: string }>;
  token: string;
  expiresAt: string;
};
export type ResetReceipt = {
  eventId: number;
  facilityId: number;
  actorId: number;
  committedAt: string;
  counts: ResetCounts;
};
