/**
 * JaliCare HMIS
 * Tariff matching
 *
 * Pure functions with no database import. The rule that decides which
 * tariff prices a service lives here so that:
 *
 *   - the server and the configuration screen run the *same* code, and
 *   - the rule can be tested without PostgreSQL.
 *
 * ---------------------------------------------------------------
 * The problem this solves
 * ---------------------------------------------------------------
 * A facility types its own price list. JaliCare's engine has historically
 * looked for codes it chose (`OPD-CONSULT`, `LAB-CBC`). A facility that
 * numbers its tariffs (`OPD-001`, `LAB-006`) therefore has a correct price
 * list and bills nothing, with an error naming codes that do not appear
 * anywhere in its configuration.
 *
 * Renaming the facility's catalogue to suit the engine is not acceptable,
 * and guessing is worse: `OPD-001 General outpatient consultation` is 150
 * while `OPD-002 Follow-up consultation` is 300. Picking between them by
 * text similarity would put a price on a patient invoice that nobody
 * chose.
 *
 * ---------------------------------------------------------------
 * The resolution ladder
 * ---------------------------------------------------------------
 *   1. LINK       the facility explicitly attached the tariff to the
 *                 charge (`billing_key`, migration 0019). Authoritative.
 *   2. CODE       the tariff's code equals one of the candidates the
 *                 engine derives. Unchanged behaviour.
 *   3. CATALOGUE  the tariff's own description names the service, inside
 *                 the department that service belongs to, and **exactly
 *                 one** active tariff matches.
 *
 * Step 3 fails closed. If two tariffs claim the same service the result is
 * an ambiguity, reported to the user with both codes, never a pick. That
 * is the difference between a rule and a guess.
 */

import {
  type BillingFamily,
  buildBillingKey,
  labTariffCodeCandidates,
  normaliseTariffCode,
  procedureTariffCodeCandidates,
  radiologyTariffCodeCandidates,
  tariffCodeCandidates,
} from './tariff-codes.ts';

/* ============================================================
   Normalisation
   ============================================================ */

export {
  words,
  serviceWords,
  isVaguePhrase,
  STOP_WORDS,
  NEUTRAL_WORDS,
  VAGUE_WORDS,
} from './tariff-words.ts';

import {
  NEUTRAL_WORDS,
  isVaguePhrase,
  serviceWords,
  words,
} from './tariff-words.ts';

/** A stable comparison key for a code or a key: ` opd-001 ` → `OPD-001`. */
export function codeKey(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

/**
 * Is every extra word in `description` a word that does not change the
 * service?
 *
 * Only used when the phrase being matched is a single word — the last
 * resort of every family ("consultation"). A tariff described as
 * "Follow-up consultation" contains "consultation" too, and matching it
 * for a general visit would charge 300 where the facility's own list
 * says 150.
 */
function extraWordsAreNeutral(
  description: string,
  phraseWords: readonly string[],
): boolean {
  const wanted = new Set(phraseWords);

  return serviceWords(description).every(
    (word) => wanted.has(word) || NEUTRAL_WORDS.has(word),
  );
}

/* ============================================================
   Departments
   ============================================================ */

/**
 * The `department` column holds a facility-module id, because that is
 * what the write path validates against. Rows created by an import or an
 * older build can hold the human label instead ("OPD / Outpatient"), so
 * both spellings resolve to the same family bucket.
 */
export function normaliseDepartment(value: string | null | undefined): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';

  if (raw === '') return '';

  const head = raw.split(/[/|,]/)[0].trim();

  const aliases: Record<string, string> = {
    opd: 'opd',
    outpatient: 'opd',
    'opd outpatient': 'opd',
    registration: 'registration',
    reception: 'reception',
    laboratory: 'laboratory',
    lab: 'laboratory',
    radiology: 'radiology',
    imaging: 'radiology',
    theatre: 'theatre',
    theater: 'theatre',
    specialty: 'specialty',
    specialist: 'specialty',
    inpatient: 'inpatient',
    pharmacy: 'pharmacy',
    insurance: 'insurance',
    finance: 'finance',
  };

  return aliases[head] ?? aliases[raw] ?? head;
}

/**
 * Which departments a family's price may live in.
 *
 * Consultation is deliberately broad: a facility may price it under OPD,
 * specialty, reception or registration, and all four are the same act of
 * care. Laboratory is narrow, because a `LAB-…` tariff filed under
 * pharmacy must not price a blood test.
 */
const FAMILY_DEPARTMENTS: Record<BillingFamily, readonly string[]> = {
  CONSULTATION: ['opd', 'specialty', 'registration', 'reception', 'finance'],
  LABORATORY: ['laboratory'],
  RADIOLOGY: ['radiology'],
  PROCEDURE: ['theatre', 'specialty', 'opd'],
  ADMISSION: ['inpatient'],
  BED_DAY: ['inpatient'],
  DELIVERY: ['inpatient', 'specialty'],
  PHARMACY: ['pharmacy'],
};

export function departmentsForFamily(
  family: BillingFamily,
): readonly string[] {
  return FAMILY_DEPARTMENTS[family] ?? [];
}

/* ============================================================
   Service phrases
   ============================================================ */

/** Remove bracketed detail: `Full Blood Count (CBC/FBC 5-Part Diff)`. */
function withoutParentheses(value: string): string {
  return value.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Names a service is likely to appear under in a price list.
 *
 * Most specific first. A pathology catalogue names a test
 * `Full Blood Count (CBC/FBC 5-Part Diff)` while the tariff says
 * `Full blood count`; both describe one test, and the shorter form is
 * what a person types into a price list.
 */
export function serviceNamePhrases(
  name: string | null | undefined,
): string[] {
  if (typeof name !== 'string') return [];

  const trimmed = name.trim();

  if (trimmed === '') return [];

  const phrases = [trimmed, withoutParentheses(trimmed)];

  /*
   * A long name with a trailing qualifier: `Chest X-Ray PA View` is
   * ordered, `Plain X-ray` is priced. Neither contains the other's words,
   * so this does not manufacture a match — it only gives the matcher a
   * shorter, more specific phrase to try before giving up.
   */
  const bare = withoutParentheses(trimmed);
  const bareWords = serviceWords(bare);

  if (bareWords.length >= 2) {
    phrases.push(bareWords.join(' '));
    phrases.push(bareWords.slice(0, 3).join(' '));
  }

  return [...new Set(phrases.filter((phrase) => serviceWords(phrase).length > 0))];
}

/**
 * What a consultation is called, by visit type.
 *
 * `Follow-up` must never resolve to the general consultation price: those
 * are 300 and 150 in the facility's own list. The general phrase is kept
 * for the default outpatient visit.
 */
export function consultationPhrases(
  encounterType: string | null | undefined,
): string[] {
  const type = codeKey(encounterType).replace(/[^A-Z0-9]+/g, '_');

  switch (type) {
    case 'FOLLOW_UP':
    case 'FOLLOWUP':
      return ['follow-up consultation', 'follow up consultation', 'review consultation'];

    case 'EMERGENCY':
      return [
        'emergency clinical assessment',
        'emergency consultation',
        'emergency triage assessment',
      ];

    case 'SPECIALIST':
    case 'SPECIALTY':
      return ['specialist consultation', 'specialty consultation', 'consultation'];

    case 'ANC':
    case 'MATERNITY':
      return ['antenatal care consultation', 'antenatal consultation'];

    case 'TELEMEDICINE':
      return ['telemedicine consultation', 'teleconsultation'];

    case 'OUTPATIENT':
    case 'OPD':
    default:
      return [
        'general outpatient consultation',
        'outpatient consultation',
        'opd consultation',
        'consultation',
      ];
  }
}

/* ============================================================
   Matching
   ============================================================ */

export type MatchRule = 'LINK' | 'CODE' | 'CATALOGUE';

export interface TariffLike {
  id: number;
  code: string;
  description: string;
  fee: string;
  unit: string;
  department?: string | null;
  billingKey?: string | null;
  isActive?: boolean;
}

export interface Ambiguity {
  phrase: string;
  codes: string[];
}

export interface MatchInput<T extends TariffLike = TariffLike> {
  rows: readonly T[];
  /** Codes derived by the engine, in priority order. */
  codes?: readonly string[];
  /** Linked keys the facility set, in priority order (migration 0019). */
  serviceKeys?: readonly string[];
  /** Which family this charge belongs to; scopes the catalogue rule. */
  family?: BillingFamily;
  /** Phrases to look for in tariff descriptions, most specific first. */
  phrases?: readonly string[];
  /** Override the family's department scope. */
  departments?: readonly string[];
}

export interface MatchOutcome<T extends TariffLike = TariffLike> {
  tariff: T | null;
  rule: MatchRule | null;
  phrase?: string;
  ambiguity?: Ambiguity;
  triedCodes: string[];
  triedPhrases: string[];
}

/** Rows that may be used: active, and inside the family's departments. */
function usableRows<T extends TariffLike>(
  rows: readonly T[],
  departments: readonly string[] | undefined,
): T[] {
  const active = rows.filter((row) => row.isActive !== false);

  if (!departments || departments.length === 0) return active;

  const allowed = new Set(departments.map((entry) => normaliseDepartment(entry)));

  return active.filter((row) => {
    const department = normaliseDepartment(row.department);

    /*
     * An empty department is allowed through: a tariff created before the
     * column was populated is still the facility's price, and rejecting it
     * would reproduce the bug this module exists to fix.
     */
    return department === '' || allowed.has(department);
  });
}

export type RowVerdict =
  | 'MATCHED_LINK'
  | 'MATCHED_CODE'
  | 'MATCHED_DESCRIPTION'
  | 'INACTIVE'
  | 'WRONG_DEPARTMENT'
  | 'DESCRIPTION_ALSO_MATCHES'
  | 'NO_MATCH';

export interface ExplainedRow<T extends TariffLike = TariffLike> {
  tariff: T;
  verdict: RowVerdict;
  note: string;
}

export interface Explanation<T extends TariffLike = TariffLike> {
  outcome: MatchOutcome<T>;
  rows: Array<ExplainedRow<T>>;
}

/**
 * Resolve, and then explain every row.
 *
 * This is what the configuration screen shows when an administrator
 * asks "why was my consultation not billed?" — each tariff in the
 * facility gets a verdict, so the answer is a statement about their own
 * price list rather than a list of codes they have never seen.
 */
export function explainMatch<T extends TariffLike>(
  input: MatchInput<T>,
): Explanation<T> {
  const outcome = matchTariff(input);

  const departments =
    input.departments ??
    (input.family ? departmentsForFamily(input.family) : []);

  const allowed = new Set(
    (departments ?? []).map((entry) => normaliseDepartment(entry)),
  );

  const phraseWordSets = (input.phrases ?? [])
    .map((phrase) => serviceWords(phrase))
    .filter((set) => set.length > 0);

  const rows = input.rows.map((tariff) => {
    if (tariff.isActive === false) {
      return {
        tariff,
        verdict: 'INACTIVE' as const,
        note: 'Deactivated. Reactivate it, or link another tariff.',
      };
    }

    if (outcome.tariff && outcome.tariff.id === tariff.id) {
      const verdict: RowVerdict =
        outcome.rule === 'LINK'
          ? 'MATCHED_LINK'
          : outcome.rule === 'CODE'
            ? 'MATCHED_CODE'
            : 'MATCHED_DESCRIPTION';

      return {
        tariff,
        verdict,
        note:
          outcome.rule === 'LINK'
            ? `Linked to ${codeKey(tariff.billingKey ?? '')}. This is the price that will be charged.`
            : outcome.rule === 'CODE'
              ? `Code ${tariff.code} is one the engine tries for this service.`
              : `Its description names this service and no other active tariff does.`,
      };
    }

    if (!input.family) {
      return {
        tariff,
        verdict: 'NO_MATCH' as const,
        note: 'No link and no matching code.',
      };
    }

    const department = normaliseDepartment(tariff.department);

    if (allowed.size > 0 && department !== '' && !allowed.has(department)) {
      return {
        tariff,
        verdict: 'WRONG_DEPARTMENT' as const,
        note: `Filed under “${tariff.department}”; this charge is only priced from ${[...allowed].join(', ')}.`,
      };
    }

    const have = new Set(serviceWords(tariff.description));

    const speaksToService = phraseWordSets.some(
      (wanted) =>
        wanted.every((word) => have.has(word)) &&
        /*
         * The same rule the resolver applies: a one-word phrase only
         * speaks for a description with nothing but neutral extras, so
         * "Follow-up consultation" is not reported as a second candidate
         * for a general visit.
         */
        (wanted.length > 1 || extraWordsAreNeutral(tariff.description, wanted)),
    );

    if (speaksToService) {
      return {
        tariff,
        verdict: 'DESCRIPTION_ALSO_MATCHES' as const,
        note:
          'Its description also names this service. JaliCare will not choose between two such rows — link the right one.',
      };
    }

    return {
      tariff,
      verdict: 'NO_MATCH' as const,
      note: 'Does not describe this service.',
    };
  });

  return { outcome, rows };
}

/**
 * Resolve one charge to a tariff.
 *
 * Never returns a tariff it is not confident about. When the catalogue
 * rule finds more than one candidate the outcome carries the ambiguity so
 * the caller can tell the user which codes to choose between, instead of
 * charging the wrong amount.
 */
export function matchTariff<T extends TariffLike>(
  input: MatchInput<T>,
): MatchOutcome<T> {
  const codes = (input.codes ?? [])
    .map((code) => (typeof code === 'string' ? code.trim() : ''))
    .filter((code) => code.length > 0);

  const keys = (input.serviceKeys ?? [])
    .map((key) => (typeof key === 'string' ? key.trim() : ''))
    .filter((key) => key.length > 0);

  const phrases = (input.phrases ?? [])
    .map((phrase) => (typeof phrase === 'string' ? phrase.trim() : ''))
    .filter((phrase) => phrase.length > 0);

  const outcome: MatchOutcome<T> = {
    tariff: null,
    rule: null,
    triedCodes: codes,
    triedPhrases: phrases,
  };

  const rows = input.rows.filter((row) => row && typeof row.code === 'string');

  /* ---- 1. Explicit link ---------------------------------------- */

  const linkedPool = rows.filter((row) => row.isActive !== false);

  for (const key of keys) {
    const upper = codeKey(key);
    const match = linkedPool.find(
      (row) => codeKey(row.billingKey ?? '') === upper,
    );

    if (match) {
      outcome.tariff = match;
      outcome.rule = 'LINK';
      return outcome;
    }
  }

  /* ---- 2. Exact code ------------------------------------------- */

  for (const code of codes) {
    const upper = codeKey(code);
    const match = rows.find((row) => codeKey(row.code) === upper);

    if (match) {
      outcome.tariff = match;
      outcome.rule = 'CODE';
      return outcome;
    }
  }

  /* ---- 3. The facility's own description ------------------------ */

  if (!input.family || phrases.length === 0) return outcome;

  const pool = usableRows(rows, input.departments ?? departmentsForFamily(input.family));

  for (const phrase of phrases) {
    const wanted = serviceWords(phrase);

    if (wanted.length === 0) continue;

    /*
     * A phrase made only of vague words ("Blood", "Laboratory test")
     * cannot identify a service. Matching on it would pick a price by
     * accident, which is the bug this module exists to remove.
     */
    if (isVaguePhrase(phrase)) continue;

    const matches = pool.filter((row) => {
      const have = new Set(serviceWords(row.description));

      if (!wanted.every((word) => have.has(word))) return false;

      /*
       * A one-word phrase is a fallback, so it must not match a tariff
       * that names a *different* kind of the same service.
       */
      if (wanted.length === 1) {
        return extraWordsAreNeutral(row.description, wanted);
      }

      return true;
    });

    if (matches.length === 1) {
      outcome.tariff = matches[0];
      outcome.rule = 'CATALOGUE';
      outcome.phrase = phrase;
      return outcome;
    }

    if (matches.length > 1) {
      /*
       * Fail closed. The next phrase is shorter, so it would match at
       * least these rows as well — there is no less ambiguous answer
       * underneath, only a different wrong one.
       */
      outcome.ambiguity = {
        phrase,
        codes: matches.map((row) => row.code).sort(),
      };

      return outcome;
    }
  }

  return outcome;
}

/* ============================================================
   What a charge asks for
   ============================================================ */

/**
 * The phrases a charge should look for, given what is known about it.
 *
 * Kept here rather than at each call site so a new charge cannot invent
 * its own vocabulary and quietly disagree with the configuration screen.
 */
export function phrasesForCharge(input: {
  family: BillingFamily;
  serviceName?: string | null;
  encounterType?: string | null;
  aliases?: readonly string[];
  /** Bed category, for a bed-day charge (`General`, `ICU`, …). */
  wardType?: string | null;
  /** Ward name, for a ward-specific tariff. */
  wardName?: string | null;
}): string[] {
  const phrases: string[] = [];

  for (const alias of input.aliases ?? []) {
    if (typeof alias === 'string' && alias.trim() !== '') phrases.push(alias.trim());
  }

  if (input.family === 'CONSULTATION') {
    phrases.push(...consultationPhrases(input.encounterType));
  }

  if (input.family === 'BED_DAY') {
    /*
     * The bed category decides the vocabulary, so a general ward rate
     * can never be selected for an ICU bed.
     */
    phrases.push(
      ...bedDayPhrases({
        wardName: input.wardName ?? input.serviceName ?? null,
        wardType: input.wardType ?? null,
      }),
    );

    return [...new Set(phrases)];
  }

  if (input.family === 'ADMISSION') {
    phrases.push(...admissionPhrases());

    return [...new Set(phrases)];
  }

  phrases.push(...serviceNamePhrases(input.serviceName));

  return [...new Set(phrases)];
}

/**
 * The linked keys a charge should offer, most specific first.
 *
 * `LABORATORY:LAB-CBC`, `LABORATORY:FULL-BLOOD-COUNT`, `LABORATORY`.
 */
export function linkedKeysForCharge(input: {
  family: BillingFamily;
  details?: ReadonlyArray<string | null | undefined>;
}): string[] {
  const keys: string[] = [];

  for (const detail of input.details ?? []) {
    const key = buildBillingKey(input.family, detail ?? null);

    if (key && key.includes(':')) keys.push(key);
  }

  keys.push(input.family);

  return [...new Set(keys)];
}

/**
 * What a bed-night is called in a price list, by bed category.
 *
 * A general ward bed may be priced by a row such as "General ward bed
 * charge" (IP-002). A special bed — ICU, HDU, maternity — must **not**
 * be priced by that row: the words match, the service does not. So the
 * category gates the vocabulary:
 *
 *   General  → "general ward bed charge", "ward bed charge", "bed charge"
 *   ICU      → "icu bed charge", "icu ward bed charge", "icu bed"
 *
 * A special ward with no matching row therefore resolves to nothing and
 * is reported as a missing configuration, rather than being billed at
 * the general rate. The explicit link is always available and always
 * wins.
 */
/**
 * Is this bed an ordinary ward bed, rather than a special-care one?
 *
 * `General` is the schema default and an empty category means the
 * facility did not classify the bed; both are the general case. ICU,
 * HDU, maternity, isolation and paediatric beds are not, and a general
 * ward rate must never price them.
 */
export function isGeneralBedType(wardType: string | null | undefined): boolean {
  const type = codeKey(wardType);

  return type === '' || type === 'GENERAL' || type === 'NORMAL';
}

export function bedDayPhrases(input: {
  wardName?: string | null;
  wardType?: string | null;
}): string[] {
  const type = codeKey(input.wardType);
  const name = typeof input.wardName === 'string' ? input.wardName.trim() : '';

  const phrases: string[] = [];

  /*
   * A ward's name only ever appears in front of "bed": a ward called
   * "Maternity" must not reach a "Maternity package" row, and a ward
   * called "Medical" must not reach a medical consultation.
   */
  if (name !== '') {
    const lowerName = name.toLowerCase();

    phrases.push(`${lowerName} bed charge`, `${lowerName} bed`);
  }

  /*
   * `General` is the ward default in the schema, and an empty category
   * means the facility did not classify the bed — both are the general
   * case, not a special one.
   */
  const isGeneral = isGeneralBedType(input.wardType);

  if (isGeneral) {
    phrases.push(
      'general ward bed charge',
      'general ward bed',
      'ward bed charge',
      'bed charge',
      'bed day charge',
      'bed day',
    );

    return [...new Set(phrases)];
  }

  const lower = type.toLowerCase();

  phrases.push(
    `${lower} bed charge`,
    `${lower} ward bed charge`,
    `${lower} bed day`,
    `${lower} bed`,
  );

  return [...new Set(phrases)];
}

/**
 * What an inpatient admission is called.
 *
 * "Inpatient admission administration" is the one-off admission fee
 * (IP-001), which is a different charge from the nightly bed rate. It
 * must never be reached by a bed-day charge.
 */
export function admissionPhrases(): string[] {
  return [
    'inpatient admission administration',
    'admission administration',
    'inpatient admission',
    'admission',
  ];
}

/**
 * Every code the engine tries for a charge of this family, in order.
 *
 * This is the single list. The charge sites call it, the diagnostic
 * screen calls it, and the test asserts it against
 * `bedDayTariffCodes`. When the two lived separately, the error message
 * could name codes the engine never tried — which is exactly how a
 * facility with `OPD-001` on its price list got told to add
 * `CONSULT-OUTPATIENT`.
 */
export function codesForFamily(input: {
  family: BillingFamily;
  /** Catalogue code, when the service has one (`LAB-CBC`, `PROC-004`). */
  code?: string | null;
  /** Service name as ordered (`Full blood count`, `Abdominal ultrasound`). */
  name?: string | null;
  /** Ward code, for admission and bed-day charges. */
  wardCode?: string | null;
  /** Encounter type, for a consultation. */
  encounterType?: string | null;
}): string[] {
  const name = input.name ?? null;

  switch (input.family) {
    case 'CONSULTATION':
      return tariffCodeCandidates('CONSULT', input.encounterType, [
        'OPD-CONSULT',
        'CONSULTATION',
        'CONSULT',
      ]);

    case 'LABORATORY':
      return labTariffCodeCandidates({ code: input.code ?? null, name });

    case 'RADIOLOGY':
      return radiologyTariffCodeCandidates(name ?? '');

    case 'PROCEDURE':
      return procedureTariffCodeCandidates({
        code: input.code ?? null,
        name,
      });

    case 'ADMISSION':
      return tariffCodeCandidates('ADMIT', input.wardCode, [
        'ADMISSION',
        'INPATIENT-ADMISSION',
      ]);

    case 'BED_DAY': {
      const cleaned =
        typeof input.wardCode === 'string'
          ? input.wardCode
              .trim()
              .toUpperCase()
              .replace(/[^A-Z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
          : '';

      /*
       * Same order as `bedDayTariffCodes`: the ward's own price, then
       * the generic day rate.
       */
      return [
        ...(cleaned ? [`BED-${cleaned}`, `WARD-${cleaned}`] : []),
        'BED-DAY',
        'INPATIENT-BED-DAY',
        'WARD-DAY',
        'BED',
      ];
    }

    case 'DELIVERY':
      return tariffCodeCandidates('DELIVERY', name, [
        'DELIVERY',
        'MATERNITY-DELIVERY',
      ]);

    case 'PHARMACY':
      return tariffCodeCandidates('DRUG', name, ['PHARMACY', 'MEDICATION']);

    default:
      return [];
  }
}

/** The bare code for a family, used when reporting a match. */
export function familyLabel(family: BillingFamily): string {
  const labels: Record<BillingFamily, string> = {
    CONSULTATION: 'consultation',
    LABORATORY: 'laboratory test',
    RADIOLOGY: 'radiology study',
    PROCEDURE: 'procedure',
    ADMISSION: 'admission',
    BED_DAY: 'bed-day charge',
    DELIVERY: 'delivery',
    PHARMACY: 'prescription',
  };

  return labels[family] ?? family;
}

/**
 * A short, human explanation of a match, for the charge result and the
 * configuration screen.
 */
export function describeMatch(outcome: MatchOutcome): string {
  if (outcome.tariff && outcome.rule === 'LINK') {
    return `linked to this charge (${codeKey(outcome.tariff.billingKey ?? '') || 'link'})`;
  }

  if (outcome.tariff && outcome.rule === 'CODE') {
    return `matched by code ${outcome.tariff.code}`;
  }

  if (outcome.tariff && outcome.rule === 'CATALOGUE') {
    return `matched on the description “${outcome.tariff.description}”`;
  }

  if (outcome.ambiguity) {
    return `ambiguous: ${outcome.ambiguity.codes.join(' and ')} both describe this service`;
  }

  return 'no tariff matched';
}

export { normaliseTariffCode };
