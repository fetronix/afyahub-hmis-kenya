/**
 * JaliCare HMIS
 * Tariff code candidates
 *
 * Pure functions with no database import, so the same rule that prices a
 * service on the server can be shown to an administrator in the browser.
 * If these lived beside the billing service, importing them into a screen
 * would drag `db` into the client bundle.
 *
 * A facility types its own codes into `facility_service_tariffs`. The
 * engine cannot know how they spelled a test, so it offers a short list
 * of plausible codes and the first configured one wins.
 */

import { isVaguePhrase } from './tariff-words.ts';

/* ============================================================
   NAME -> CODE
   ============================================================ */

/**
 * Turn free text into the code a person would type.
 *
 *   "Wound dressing"      -> WOUND-DRESSING
 *   "Chest X-ray"         -> CHEST-X-RAY
 *   "Full Blood Count (CBC/FBC 5-Part Diff)"
 *                         -> FULL-BLOOD-COUNT-CBC-FBC-5-PART-DIFF
 */
export function normaliseTariffCode(value: string | null | undefined): string {
  return typeof value === 'string'
    ? value
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    : '';
}

/* ============================================================
   GENERAL
   ============================================================ */

/**
 * Turn a clinical record into the tariff codes that might price it.
 *
 * The tariff table is free text per facility, so several plausible
 * codes are offered and the first configured one wins:
 *   PROCEDURE-WOUND-DRESSING, WOUND-DRESSING, PROCEDURE, PROC-GENERAL
 */
export function tariffCodeCandidates(
  prefix: string,
  value: string | null | undefined,
  defaults: readonly string[],
): string[] {
  const codes: string[] = [];

  const cleaned = normaliseTariffCode(value);

  if (cleaned) {
    codes.push(`${prefix}-${cleaned}`, cleaned);
  }

  codes.push(...defaults);

  return [...new Set(codes)];
}

/* ============================================================
   BILLING LINKS
   ============================================================ */

/**
 * The automatic charges a facility can attach a tariff to.
 *
 * A tariff's `billing_key` is one of these, optionally followed by a
 * detail: `LABORATORY:LAB-CBC` prices one test, `LABORATORY` prices any
 * test. The list is closed on purpose. A free-text key would let two
 * tariffs claim the same charge and make the amount billed depend on
 * which row the database returned first.
 */
export const BILLING_FAMILIES = [
  { key: 'CONSULTATION', label: 'Consultation — any outpatient visit' },
  { key: 'LABORATORY', label: 'Laboratory — any test' },
  { key: 'RADIOLOGY', label: 'Radiology — any study' },
  { key: 'PROCEDURE', label: 'Procedure — any procedure' },
  { key: 'ADMISSION', label: 'Inpatient admission' },
  { key: 'BED_DAY', label: 'Bed charge — per night' },
  { key: 'DELIVERY', label: 'Maternity delivery' },
  { key: 'PHARMACY', label: 'Pharmacy — dispensing' },
] as const;

export type BillingFamily = (typeof BILLING_FAMILIES)[number]['key'];

const FAMILY_KEYS = new Set<string>(BILLING_FAMILIES.map((entry) => entry.key));

/**
 * Normalise the part after the colon: `Obstetric ultrasound` and
 * `obstetric-ultrasound` must not be two different links.
 */
export function normaliseBillingDetail(value: string | null | undefined): string {
  return normaliseTariffCode(value).slice(0, 80);
}

/**
 * Build a key: `LABORATORY:LAB-CBC`, or just `CONSULTATION`.
 * Returns null when the family is not one of the known ones.
 */
export function buildBillingKey(
  family: string | null | undefined,
  detail?: string | null,
): string | null {
  const key = typeof family === 'string' ? family.trim().toUpperCase() : '';

  if (!FAMILY_KEYS.has(key)) return null;

  const suffix = normaliseBillingDetail(detail);

  return suffix ? `${key}:${suffix}` : key;
}

/**
 * Is this a key the engine understands?
 *
 * Used by the write path. A stored key the engine cannot interpret is a
 * link that silently never fires, which is the class of bug this whole
 * change exists to remove.
 */
export function isValidBillingKey(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false;

  const trimmed = value.trim();

  if (trimmed === '') return false;

  const [family, ...rest] = trimmed.split(':');
  const detail = rest.join(':');

  if (!FAMILY_KEYS.has(family)) return false;

  if (detail === '') return rest.length === 0;

  return /^[A-Z0-9][A-Z0-9._/-]{0,79}$/.test(detail);
}

/**
 * Keys the engine tries for one charge, most specific first.
 *
 * `CONSULTATION` produces `['CONSULTATION']`; a laboratory test produces
 * `['LABORATORY:LAB-CBC', 'LABORATORY:FULL-BLOOD-COUNT', 'LABORATORY']`.
 */
export function billingServiceKeys(
  family: BillingFamily,
  details: ReadonlyArray<string | null | undefined> = [],
): string[] {
  const keys: string[] = [];

  for (const detail of details) {
    const key = buildBillingKey(family, detail);

    if (key && key.includes(':')) keys.push(key);
  }

  keys.push(family);

  return [...new Set(keys)];
}

/* ============================================================
   RECORDS THAT CARRY THEIR OWN CODE
   ============================================================ */

export interface CodedRecordIdentity {
  /** The record's own code, e.g. `LAB-CBC`, `CBC`, `PROC-004`. */
  code?: string | null;
  /** The record's human name, e.g. `Full Blood Count (CBC/FBC 5-Part Diff)`. */
  name?: string | null;
}

/**
 * Candidate codes for a record that has a code of its own — a laboratory
 * test, a procedure.
 *
 * The record's code comes first because it is what the facility sees on
 * its own screens and therefore what it will price. Before this, the
 * engine used only the *name*, so a facility that priced `LAB-CBC` had a
 * full blood count bill nothing: the engine was looking for
 * `LAB-FULL-BLOOD-COUNT-CBC-FBC-5-PART-DIFF` and never asked for
 * `LAB-CBC`.
 *
 * Order, most specific first:
 *   1. the record's code as stored          LAB-CBC
 *   2. the same without the prefix          CBC
 *   3. the same, prefixed if it had none    LAB-CBC
 *   4. <PREFIX>-<normalised name>           LAB-FULL-BLOOD-COUNT-...
 *   5. <normalised name>                    FULL-BLOOD-COUNT-...
 *   6. the caller's generic codes           LAB-GENERAL, LABORATORY
 */
export function codedTariffCodeCandidates(
  prefix: string,
  record: CodedRecordIdentity,
  defaults: readonly string[],
): string[] {
  const codes: string[] = [];

  const code = normaliseTariffCode(record.code);

  if (code) {
    codes.push(code);

    if (code.startsWith(`${prefix}-`)) {
      const bare = code.slice(prefix.length + 1);

      if (bare) codes.push(bare);
    } else {
      codes.push(`${prefix}-${code}`);
    }
  }

  /*
   * A code generated from a *vague* name is a guess wearing a code's
   * clothes. `LAB-BLOOD` derived from a test called "Blood" is exactly
   * how a haemoglobin test priced at 300 would end up billed at the
   * facility's 800 blood tariff.
   *
   * The generic defaults are still offered: `LAB-GENERAL` only prices
   * anything if the facility genuinely created that row, which is a
   * deliberate statement rather than an inference.
   */
  const codeText = normaliseTariffCode(record.code);

  /*
   * Only the *name* can be vague here: a code that exists was typed by
   * a person and is a statement, not an inference.
   */
  if (!isVaguePhrase(record.name) && (codeText === '' || !isVaguePhrase(codeText))) {
    codes.push(...tariffCodeCandidates(prefix, record.name, []));
  }

  codes.push(...defaults);

  return [...new Set(codes)];
}

/* ============================================================
   LABORATORY
   ============================================================ */

export type LabTestIdentity = CodedRecordIdentity;

/**
 * Codes the billing engine tries for a laboratory order.
 *
 * The catalogue's own code comes first. Before this, only the *name* was
 * used, so a facility that priced `LAB-CBC` — the code its own catalogue
 * displays — had a full blood count bill nothing: the engine was looking
 * for `LAB-FULL-BLOOD-COUNT-CBC-FBC-5-PART-DIFF` and never asked for
 * `LAB-CBC`.
 *
 * Order, most specific first:
 *   1. the catalogue code as stored           LAB-CBC
 *   2. the code without a LAB- prefix         CBC
 *   3. the same, prefixed if it had none      LAB-CBC
 *   4. LAB-<normalised name>                  LAB-FULL-BLOOD-COUNT-...
 *   5. <normalised name>                      FULL-BLOOD-COUNT-...
 *   6. the generic laboratory codes           LAB-GENERAL, LABORATORY
 */
export function labTariffCodeCandidates(test: LabTestIdentity): string[] {
  return codedTariffCodeCandidates('LAB', test, ['LAB-GENERAL', 'LABORATORY']);
}

/**
 * Codes the billing engine tries for a procedure.
 *
 * `PROC-WOUND-DRESSING` (from the name) and the procedure's own code are
 * both tried, so a facility that priced `PROC-004` is not ignored.
 */
export function procedureTariffCodeCandidates(procedure: CodedRecordIdentity): string[] {
  return codedTariffCodeCandidates('PROC', procedure, ['PROCEDURE', 'PROC-GENERAL']);
}

/**
 * Codes the billing engine tries for a radiology order.
 * Kept here so the configuration screen can explain both.
 */
export function radiologyTariffCodeCandidates(procedureName: string): string[] {
  return tariffCodeCandidates('RAD', procedureName, ['RADIOLOGY', 'RAD-GENERAL', 'IMAGING']);
}
