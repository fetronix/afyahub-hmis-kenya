/**
 * JaliCare HMIS
 * Tariff words — the vocabulary a price list is written in
 *
 * No imports, no database, no policy. Just the question "do these two
 * pieces of text describe the same service?", which both the code
 * generator and the description matcher need to answer the same way.
 *
 * The distinction that matters:
 *
 *   "Haemoglobin test"        names a service
 *   "Blood"                   names a category
 *   "Laboratory test"         names a department
 *   "General"                 names nothing at all
 *
 * Case, spacing, punctuation and accents are formatting. "Follow-up"
 * and "general" are meaning, and are preserved.
 */

/** Lower-case word tokens. Formatting disappears; words do not. */
export function words(value: string | null | undefined): string[] {
  if (typeof value !== 'string') return [];

  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 0);
}

/** Words that carry no meaning when matching a service description. */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'and',
  'of',
  'the',
  'per',
  'for',
  'with',
  'a',
  'an',
  'to',
  'in',
  'on',
]);

/** Tokens that identify a service, without the filler. */
export function serviceWords(value: string | null | undefined): string[] {
  return words(value).filter((word) => !STOP_WORDS.has(word));
}

/**
 * Words that qualify a service without identifying it.
 *
 * They are allowed as *extra* words in a description — "Consultation
 * fee" is still a consultation — but they cannot carry a match alone.
 */
export const NEUTRAL_WORDS: ReadonlySet<string> = new Set([
  'general',
  'opd',
  'outpatient',
  'inpatient',
  'clinical',
  'clinic',
  'fee',
  'fees',
  'charge',
  'charges',
  'service',
  'services',
  'patient',
  'adult',
  'normal',
  'standard',
  'basic',
  'simple',
  'routine',
  'hospital',
  'health',
  'centre',
  'center',
  'price',
  'rate',
  /*
   * "Inpatient admission administration" is the admission fee; the
   * word "administration" says it is a charge, not which service it is.
   */
  'administration',
  'admin',
  'visit',
  'session',
  'day',
]);

/**
 * Words that name no particular service.
 *
 * "Blood", "laboratory", "test", "general", "profile" say where a price
 * belongs, not what it prices. A rule built on them lets any blood test
 * match any blood-priced row: `LAB-BLOOD` at 800 would start pricing a
 * haemoglobin test the facility prices at 300.
 *
 * They are therefore refused as *match phrases* and refused as the
 * source of a *generated code*. They are still perfectly valid as stored
 * codes: a facility that deliberately creates `LAB-GENERAL` to price any
 * test gets exactly that, because the code then exists rather than being
 * inferred from a word.
 */
export const VAGUE_WORDS: ReadonlySet<string> = new Set([
  'blood',
  'lab',
  'laboratory',
  'general',
  'test',
  'tests',
  'testing',
  'investigation',
  'investigations',
  'sample',
  'specimen',
  'screening',
  'profile',
  'panel',
  'full',
  'basic',
  'misc',
  'others',
  'other',
  'service',
  'services',
]);

/**
 * Does this text say anything specific enough to identify a service?
 *
 * "Blood" → no. "Full blood count" → yes, because "count" is specific.
 */
export function isVaguePhrase(value: string | null | undefined): boolean {
  const meaningful = serviceWords(value).filter(
    (word) => !NEUTRAL_WORDS.has(word),
  );

  if (meaningful.length === 0) return true;

  return meaningful.every((word) => VAGUE_WORDS.has(word));
}
