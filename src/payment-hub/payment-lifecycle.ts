import type { QueryOutcome } from './adapters/contracts.ts';

/**
 * Provider request/query lifecycle. PROVIDER_CONFIRMED is a reported query
 * result, not authenticated payment evidence. Accounting settlement states
 * are derived separately from immutable receipts, postings and reversals.
 */
export const requestStates = [
  'INITIATING',
  'PENDING',
  'UNKNOWN',
  'FAILED',
  'PROVIDER_CONFIRMED',
  'REVIEW_REQUIRED',
] as const;
export type RequestState = (typeof requestStates)[number];

const transitions: Record<RequestState, readonly RequestState[]> = {
  INITIATING: ['PENDING', 'UNKNOWN'],
  PENDING: ['PROVIDER_CONFIRMED', 'FAILED', 'REVIEW_REQUIRED'],
  UNKNOWN: ['PROVIDER_CONFIRMED', 'FAILED', 'REVIEW_REQUIRED'],
  FAILED: ['REVIEW_REQUIRED'],
  PROVIDER_CONFIRMED: ['REVIEW_REQUIRED'],
  REVIEW_REQUIRED: [],
};

export function validRequestTransition(from: RequestState, to: RequestState): boolean {
  return from === to || transitions[from].includes(to);
}

export function queryState(
  previous: { status: RequestState; resultCode: string | null },
  result: { outcome: QueryOutcome; resultCode: string | null },
): { status: RequestState; resultCode: string | null } {
  let status = previous.status;
  if (
    (result.outcome === 'CONFIRMED' && result.resultCode !== '0') ||
    (result.outcome === 'CANCELLED' && (!result.resultCode || result.resultCode === '0'))
  ) {
    status = 'REVIEW_REQUIRED';
  } else if (result.outcome === 'CONFIRMED') {
    status =
      status === 'FAILED' || status === 'REVIEW_REQUIRED'
        ? 'REVIEW_REQUIRED'
        : 'PROVIDER_CONFIRMED';
  } else if (result.outcome === 'CANCELLED') {
    status =
      status === 'PROVIDER_CONFIRMED' || status === 'REVIEW_REQUIRED'
        ? 'REVIEW_REQUIRED'
        : 'FAILED';
  } else if (
    status === 'PROVIDER_CONFIRMED' &&
    result.resultCode !== null &&
    result.resultCode !== '0'
  ) {
    status = 'REVIEW_REQUIRED';
  }
  // Historical records may predate the database guard. Conflicting/missing
  // terminal evidence is never silently repaired by a later query.
  if (
    (previous.status === 'PROVIDER_CONFIRMED' && previous.resultCode !== '0') ||
    (previous.status === 'FAILED' && (!previous.resultCode || previous.resultCode === '0'))
  )
    status = 'REVIEW_REQUIRED';
  if (!validRequestTransition(previous.status, status)) {
    throw new Error('Invalid request state transition');
  }
  // An inconclusive query does not erase the evidence for a terminal result.
  const resultCode =
    result.outcome === 'UNKNOWN' &&
    status === previous.status &&
    ['FAILED', 'REVIEW_REQUIRED', 'PROVIDER_CONFIRMED'].includes(previous.status)
      ? previous.resultCode
      : result.resultCode;
  return { status, resultCode };
}
