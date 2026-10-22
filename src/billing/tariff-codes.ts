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

  codes.push(
    ...tariffCodeCandidates(prefix, record.name, defaults),
  );

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
  return codedTariffCodeCandidates('LAB', test, [
    'LAB-GENERAL',
    'LABORATORY',
  ]);
}

/**
 * Codes the billing engine tries for a procedure.
 *
 * `PROC-WOUND-DRESSING` (from the name) and the procedure's own code are
 * both tried, so a facility that priced `PROC-004` is not ignored.
 */
export function procedureTariffCodeCandidates(
  procedure: CodedRecordIdentity,
): string[] {
  return codedTariffCodeCandidates('PROC', procedure, [
    'PROCEDURE',
    'PROC-GENERAL',
  ]);
}

/**
 * Codes the billing engine tries for a radiology order.
 * Kept here so the configuration screen can explain both.
 */
export function radiologyTariffCodeCandidates(procedureName: string): string[] {
  return tariffCodeCandidates('RAD', procedureName, [
    'RADIOLOGY',
    'RAD-GENERAL',
    'IMAGING',
  ]);
}
