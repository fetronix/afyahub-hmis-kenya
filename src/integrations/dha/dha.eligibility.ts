/**
 * JaliCare HMIS
 * DHA / AfyaConnect — eligibility verdict
 *
 * Pure functions only: no database, no network, no environment. Kept
 * apart from dha.service.ts so the rules that decide whether a patient
 * is covered can be tested on their own.
 *
 * SOURCE OF TRUTH
 * ---------------
 * https://hie-docs.dha.go.ke/eclaims/eligibility
 *
 * Two documented rules live here:
 *
 *   * POMSF arrives suffixed (POMSF-047), so it must be matched as a
 *     prefix. Exact equality would report a civil servant as uncovered.
 *   * `isAlive: false` means the patient is deceased and the
 *     documentation requires integrators to block all subsequent
 *     transactions for that patient.
 */

import type { DhaEligibilityResponse } from './dha.contracts.ts';

/* ============================================================
   SCHEME MATCHING
   ============================================================ */

/** Schemes the documentation names as POMSF-bearing. */
const SCHEME_PREFIXES = ['POMSF', 'TSC', 'USALAMA'] as const;

export function schemeMatchesPomsf(schemeName: string): boolean {
  return /^POMSF/i.test(schemeName);
}

export function matchedSchemePrefixes(schemes: string[]): string[] {
  return SCHEME_PREFIXES.filter((prefix) =>
    schemes.some((name) => name.toUpperCase().startsWith(prefix)),
  );
}

/**
 * Show the last four characters and nothing else. Identifiers must
 * reach a log, a table or a screen in this form only.
 */
export function maskIdentifier(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length <= 4) return '*'.repeat(trimmed.length);

  return `${'*'.repeat(trimmed.length - 4)}${trimmed.slice(-4)}`;
}

export interface EligibilityVerdict {
  /** False when the beneficiary has no active scheme or is deceased. */
  eligible: boolean;
  /** True when SHA records the patient as deceased; block all activity. */
  deceased: boolean;
  /** POMSF-eligible, matching on the documented prefix rule. */
  pomsfEligible: boolean;
  schemes: string[];
  matchedPrefixes: string[];
  statusCode: string | null;
  statusDesc: string | null;
  /** Consent method the facility may use. */
  biometricsEnforced: boolean;
  otpWhitelisted: boolean;
  memberCrNumber: string | null;
}

/**
 * Turn a raw eligibility response into a decision.
 *
 * Pure, so it can be tested without a network or a database.
 */
export function interpretEligibility(
  response: DhaEligibilityResponse,
): EligibilityVerdict {
  const schemes = (response.schemes ?? [])
    .map((scheme) => scheme?.schemeName)
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);

  const deceased = response.isAlive === false;

  return {
    eligible: !deceased && schemes.length > 0,
    deceased,
    pomsfEligible: schemes.some(schemeMatchesPomsf),
    schemes,
    matchedPrefixes: matchedSchemePrefixes(schemes),
    statusCode: response.statusCode ?? null,
    statusDesc: response.statusDesc ?? null,
    biometricsEnforced: response.facilityBiometricsEnforced === true,
    otpWhitelisted: response.whitelistedForOTP === true,
    memberCrNumber: response.memberCrNumber ?? null,
  };
}
