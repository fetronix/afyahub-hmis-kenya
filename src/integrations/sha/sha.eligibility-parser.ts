/** SHA gateway concern: eligibility parser. */
import { asObj, readStr, normalizeIsoDate } from './sha.values.ts';
import { isPomsfSchemeCode } from './sha.fhir.ts';
import type { ShaSchemeDetail, EligibilityGatewayResult } from './sha.types.ts';

/**
 * Strict, non-guessing eligibility payload parser for DHA HIE v1 `/patients/eligibility`
 * and AfyaLink `/v2/eligibility`.
 *
 * Enforces official DHA HIE rules:
 *   1. Check `isAlive` BEFORE anything else — a deceased beneficiary (`isAlive === false`
 *      or `deceased_datetime` present) MUST be blocked (`CONFIRMED_DECEASED`), regardless
 *      of scheme array entries.
 *   2. Match POMSF schemes by prefix (`POMSF*`, `TSC`, `USALAMA`), never exact `"POMSF"` equality.
 *   3. HTTP 5xx, malformed JSON, or ambiguous 200 payload NEVER converts to `Eligible` or `Ineligible`.
 */
export function interpretShaEligibilityPayload(
  httpStatus: number,
  body: unknown,
): Omit<EligibilityGatewayResult, 'source' | 'mode' | 'isSimulated' | 'correlationId'> {
  if (httpStatus < 200 || httpStatus >= 300) {
    return {
      outcome: 'Unable to verify',
      payerReference: null,
      memberCrNumber: null,
      memberStatus: null,
      isAlive: null,
      facilityBiometricsEnforced: null,
      whitelistedForOtp: null,
      hasPomsfScheme: false,
      schemes: [],
      schemeDetails: [],
      coverageStartDate: null,
      coverageEndDate: null,
      restrictions: [],
      reason: `SHA gateway returned HTTP ${httpStatus}; eligibility could not be confirmed.`,
      possibleSolution: 'Retry verification once SHA gateway connectivity recovers.',
      responseClassification: 'UPSTREAM_ERROR',
    };
  }

  const root = asObj(body);
  if (!root) {
    return {
      outcome: 'Unable to verify',
      payerReference: null,
      memberCrNumber: null,
      memberStatus: null,
      isAlive: null,
      facilityBiometricsEnforced: null,
      whitelistedForOtp: null,
      hasPomsfScheme: false,
      schemes: [],
      schemeDetails: [],
      coverageStartDate: null,
      coverageEndDate: null,
      restrictions: [],
      reason: 'SHA gateway returned an empty or non-JSON eligibility payload.',
      possibleSolution: 'Inspect gateway diagnostics and retry verification.',
      responseClassification: 'UNPARSEABLE_RESPONSE',
    };
  }

  const payload = asObj(root.message) ?? asObj(root.data) ?? root;

  const payerReference = readStr(
    payload,
    'verification_id',
    'verificationId',
    'reference',
    'request_id',
    'requestIdNumber',
    'transactionId',
  );
  const memberCrNumber = readStr(
    payload,
    'memberCrNumber',
    'cr_id',
    'crNumber',
    'id',
    'member_number',
    'sha_number',
  );
  const memberStatus = readStr(
    payload,
    'member_status',
    'memberStatus',
    'status',
    'statusDesc',
    'coverage_status',
  );
  const statusCode = readStr(payload, 'statusCode', 'status_code');
  const reason = readStr(payload, 'reason', 'statusDesc', 'statusReason', 'message', 'detail');
  const possibleSolution = readStr(payload, 'possible_solution', 'possibleSolution');

  const isAlive =
    typeof payload.isAlive === 'boolean'
      ? payload.isAlive
      : typeof payload.is_alive === 'boolean'
        ? payload.is_alive
        : readStr(payload, 'deceased_datetime', 'deceasedDateTime')
          ? false
          : null;

  const facilityBiometricsEnforced =
    typeof payload.facilityBiometricsEnforced === 'boolean'
      ? payload.facilityBiometricsEnforced
      : typeof payload.facility_biometrics_enforced === 'boolean'
        ? payload.facility_biometrics_enforced
        : null;

  const whitelistedForOtp =
    typeof payload.whitelistedForOTP === 'boolean'
      ? payload.whitelistedForOTP
      : typeof payload.whitelisted_for_otp === 'boolean'
        ? payload.whitelisted_for_otp
        : null;

  let coverageStartDate = normalizeIsoDate(
    readStr(payload, 'coverageStartDate', 'coverage_start_date', 'validFrom', 'periodStart'),
  );
  let coverageEndDate = normalizeIsoDate(
    readStr(payload, 'coverageEndDate', 'coverage_end_date', 'validTo', 'periodEnd'),
  );

  const schemes: string[] = [];
  const schemeDetails: ShaSchemeDetail[] = [];

  if (Array.isArray(payload.schemes)) {
    for (const s of payload.schemes) {
      if (typeof s === 'string' && s.trim()) {
        const code = s.trim();
        schemes.push(code);
        schemeDetails.push({
          schemeCode: code,
          schemeName: code,
          eligible: true,
          isPomsf: isPomsfSchemeCode(code),
        });
      } else if (asObj(s)) {
        const sObj = s as Record<string, unknown>;
        const code = readStr(sObj, 'schemeCode', 'scheme_code', 'code', 'name');
        if (code) {
          const name = readStr(sObj, 'schemeName', 'scheme_name', 'name') ?? code;
          const covObj = asObj(sObj.coverage);
          const sStart = normalizeIsoDate(
            covObj ? readStr(covObj, 'startDate', 'start_date') : readStr(sObj, 'startDate'),
          );
          const sEnd = normalizeIsoDate(
            covObj ? readStr(covObj, 'endDate', 'end_date') : readStr(sObj, 'endDate'),
          );
          if (!coverageStartDate && sStart) coverageStartDate = sStart;
          if (!coverageEndDate && sEnd) coverageEndDate = sEnd;

          const covStatusUpper = (readStr(covObj ?? sObj, 'status') ?? '').toUpperCase();
          const schemeElig =
            typeof sObj.eligible === 'boolean'
              ? sObj.eligible
              : sObj.eligible === 1 || sObj.eligible === '1'
                ? true
                : sObj.eligible === 0 || sObj.eligible === '0'
                  ? false
                  : covStatusUpper === 'ACTIVE' || covStatusUpper === 'ELIGIBLE';

          if (schemeElig || payload.eligible !== undefined) {
            schemes.push(code);
          }
          schemeDetails.push({
            schemeCode: code,
            schemeName: name,
            memberType: readStr(sObj, 'memberType', 'member_type'),
            eligible: schemeElig,
            isPomsf: isPomsfSchemeCode(code),
            statusCode: readStr(sObj, 'statusCode', 'status_code'),
            statusDesc: readStr(sObj, 'statusDesc', 'status_desc'),
            coverageStartDate: sStart,
            coverageEndDate: sEnd,
          });
        }
      }
    }
  } else {
    const singleScheme = readStr(payload, 'scheme', 'package', 'fund');
    if (singleScheme) {
      schemes.push(singleScheme);
      schemeDetails.push({
        schemeCode: singleScheme,
        schemeName: singleScheme,
        eligible: true,
        isPomsf: isPomsfSchemeCode(singleScheme),
      });
    }
  }

  const hasPomsfScheme =
    schemeDetails.some((sd) => sd.isPomsf && sd.eligible) ||
    schemes.some((sc) => isPomsfSchemeCode(sc));

  const restrictions: string[] = Array.isArray(payload.restrictions)
    ? payload.restrictions.filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
    : [];

  // CRITICAL DHA HIE RULE: Check `isAlive` BEFORE anything else!
  if (isAlive === false) {
    return {
      outcome: 'Ineligible',
      payerReference,
      memberCrNumber,
      memberStatus: 'DECEASED',
      isAlive: false,
      facilityBiometricsEnforced,
      whitelistedForOtp,
      hasPomsfScheme: false,
      schemes,
      schemeDetails,
      coverageStartDate,
      coverageEndDate,
      restrictions: [
        'Beneficiary is marked deceased in DHA Client Registry (isAlive=false); admission and billing are blocked.',
        ...restrictions,
      ],
      reason:
        reason ??
        'Beneficiary is recorded as deceased in the DHA Client Registry (isAlive=false); SHA transactions are blocked.',
      possibleSolution:
        'Verify patient identity against DHA Client Registry; deceased beneficiaries cannot be admitted or billed.',
      responseClassification: 'CONFIRMED_DECEASED',
    };
  }

  const rawEligible = payload.eligible ?? payload.isEligible;
  const normalizedStatus = (memberStatus ?? statusCode ?? '').toUpperCase();
  const hasAnyEligibleScheme =
    schemeDetails.length > 0 && schemeDetails.some((sd) => sd.eligible === true);
  const allSchemesExplicitlyIneligible =
    schemeDetails.length > 0 && schemeDetails.every((sd) => sd.eligible === false);

  if (
    normalizedStatus === 'PENDING' ||
    normalizedStatus === 'AWAITING_CONTRIBUTION' ||
    normalizedStatus === 'IN_TRANSITION'
  ) {
    return {
      outcome: 'Pending',
      payerReference,
      memberCrNumber,
      memberStatus,
      isAlive,
      facilityBiometricsEnforced,
      whitelistedForOtp,
      hasPomsfScheme,
      schemes,
      schemeDetails,
      coverageStartDate,
      coverageEndDate,
      restrictions,
      reason: reason ?? 'SHA membership activation or contribution posting is pending.',
      possibleSolution,
      responseClassification: 'CONFIRMED_PENDING',
    };
  }

  if (
    normalizedStatus === 'MANUAL_REVIEW' ||
    normalizedStatus === 'REVIEW_REQUIRED' ||
    normalizedStatus === 'IDENTITY_CONFLICT'
  ) {
    return {
      outcome: 'Manual review required',
      payerReference,
      memberCrNumber,
      memberStatus,
      isAlive,
      facilityBiometricsEnforced,
      whitelistedForOtp,
      hasPomsfScheme,
      schemes,
      schemeDetails,
      coverageStartDate,
      coverageEndDate,
      restrictions,
      reason: reason ?? 'Payer flagged member identity or household record for manual review.',
      possibleSolution,
      responseClassification: 'MANUAL_REVIEW',
    };
  }

  if (
    rawEligible === true ||
    rawEligible === 1 ||
    rawEligible === '1' ||
    normalizedStatus === 'ELIGIBLE' ||
    normalizedStatus === 'ACTIVE' ||
    (rawEligible === undefined && hasAnyEligibleScheme)
  ) {
    const eligibleSchemeCodes = schemeDetails
      .filter((sd) => sd.eligible)
      .map((sd) => sd.schemeCode);
    const finalSchemes =
      eligibleSchemeCodes.length > 0
        ? eligibleSchemeCodes
        : schemes.length > 0
          ? schemes
          : ['SHIF'];

    return {
      outcome: 'Eligible',
      payerReference,
      memberCrNumber,
      memberStatus: memberStatus ?? 'ACTIVE',
      isAlive,
      facilityBiometricsEnforced,
      whitelistedForOtp,
      hasPomsfScheme,
      schemes: finalSchemes,
      schemeDetails,
      coverageStartDate,
      coverageEndDate,
      restrictions,
      reason: reason ?? 'Confirmed eligible by SHA payer response.',
      possibleSolution,
      responseClassification: 'CONFIRMED_ELIGIBLE',
    };
  }

  if (
    rawEligible === false ||
    rawEligible === 0 ||
    rawEligible === '0' ||
    normalizedStatus === 'INELIGIBLE' ||
    normalizedStatus === 'INACTIVE' ||
    normalizedStatus === 'SUSPENDED' ||
    normalizedStatus === 'EXPIRED' ||
    (rawEligible === undefined && allSchemesExplicitlyIneligible)
  ) {
    return {
      outcome: 'Ineligible',
      payerReference,
      memberCrNumber,
      memberStatus: memberStatus ?? 'INELIGIBLE',
      isAlive,
      facilityBiometricsEnforced,
      whitelistedForOtp,
      hasPomsfScheme: false,
      schemes,
      schemeDetails,
      coverageStartDate,
      coverageEndDate,
      restrictions,
      reason: reason ?? 'Confirmed ineligible by SHA payer response.',
      possibleSolution,
      responseClassification: 'CONFIRMED_INELIGIBLE',
    };
  }

  // Ambiguous or unrecognised payload structure -> NEVER assume Eligible or Ineligible!
  return {
    outcome: 'Unable to verify',
    payerReference,
    memberCrNumber,
    memberStatus,
    isAlive,
    facilityBiometricsEnforced,
    whitelistedForOtp,
    hasPomsfScheme: false,
    schemes,
    schemeDetails,
    coverageStartDate,
    coverageEndDate,
    restrictions,
    reason: 'SHA response did not contain an unambiguous eligibility indicator.',
    possibleSolution: 'Verify member details or perform manual portal verification.',
    responseClassification: 'UNPARSEABLE_RESPONSE',
  };
}
