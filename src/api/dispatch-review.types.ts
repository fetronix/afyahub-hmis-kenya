/**
 * Shared types for the claim dispatch reconciliation queue.
 *
 * These values describe a *local* reservation and a human reviewer's finding.
 * They are not payer acknowledgements, adjudications or payments, and the UI
 * must not present them as such.
 */

export type DispatchReconciliationOutcome =
  'PAYER_CONFIRMED_RECEIVED' | 'PAYER_CONFIRMED_NOT_RECEIVED' | 'STILL_UNRESOLVED';

export interface DispatchReviewSummary {
  id?: number;
  state: string;
  createdAt: string;
  attemptNumber?: number;
  correlationId?: string;
}

export interface DispatchReviewQueueItem {
  guardId: number;
  workflow: 'SHA' | 'PRIVATE';
  claimId: number;
  claimNumber: string;
  patientName: string | null;
  payerCode: string | null;
  claimStatus: string;
  amount: string | null;
  state: string;
  attemptNumber: number;
  correlationId: string;
  reservedAt: string;
  updatedAt: string;
  ageMinutes: number;
  lastReconciliation: {
    outcome: DispatchReconciliationOutcome;
    evidenceNote: string;
    payerReference: string | null;
    checkedAt: string;
  } | null;
}

export interface DispatchReviewQueueResponse {
  reviews?: DispatchReviewQueueItem[];
  limitations?: { source: string; notice: string };
}

export interface DispatchReconciliationRecord {
  id: number;
  outcome: DispatchReconciliationOutcome;
  payerReference: string | null;
  evidenceNote: string;
  attemptNumber: number;
  correlationId: string;
  guardStateAtCheck: string;
  reconciledByUserId: number | null;
  createdAt: string;
}

export interface RecordDispatchReviewInput {
  outcome: DispatchReconciliationOutcome;
  payerReference?: string | null;
  evidenceNote: string;
  guardId?: number;
}

export interface RecordDispatchReviewResult {
  claimId: number;
  workflow: 'SHA' | 'PRIVATE';
  outcome: DispatchReconciliationOutcome;
  claimStatus: string;
  guardReleased: boolean;
  payerReference: string | null;
  reconciledAt: string;
}
