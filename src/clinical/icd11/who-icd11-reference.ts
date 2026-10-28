/**
 * WHO ICD API v2 endpoints. No catalogue or crosswalk is bundled here.
 *
 * A search result is usable only after it has actually been retrieved from
 * the WHO API and cached with its release and provenance. A cache is a
 * partial set of prior results, not a complete ICD-11 distribution.
 *
 * WHO documentation: https://icd.who.int/icdapi/docs2/
 */
export const WHO_ICD11_API_BASE = 'https://id.who.int/icd';
export const WHO_ICD11_TOKEN_URL = 'https://icdaccessmanagement.who.int/connect/token';
export const WHO_ICD11_SYSTEM_URI = 'http://id.who.int/icd/release/11/mms';
export const ICD10_SYSTEM_URI = 'http://hl7.org/fhir/sid/icd-10';
export const WHO_ICD11_DEFAULT_RELEASE = '2025-01';
