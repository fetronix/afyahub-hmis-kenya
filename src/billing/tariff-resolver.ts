/**
 * JaliCare HMIS
 * Tariff resolver — one place that answers "what does this cost?"
 *
 * ------------------------------------------------------------------
 * The problem this reconstructs
 * ------------------------------------------------------------------
 * The engine used to resolve a service to a price by comparing strings.
 * A laboratory order for a test called "Blood" produced the candidates
 * `LAB-BLOOD`, `BLOOD`, `LAB-GENERAL`, `LABORATORY`; the facility's
 * price list held `LAB-001` (Malaria RDT, 300) … `LAB-008` (Specimen
 * collection, 150) and one row coded `LAB-BLOOD` at 800 whose
 * description is literally "LAB-BLOOD". The order reached the
 * laboratory queue, the charge was skipped, and every one of the
 * following produced the same sentence:
 *
 *   - no row matches at all;
 *   - a row matches but is inactive;
 *   - a row matches but is outside its effective dates;
 *   - a row matches at a different facility;
 *   - a row matches but is meant for manual pricing only;
 *   - two rows match and the first one won by row order.
 *
 * A string match cannot distinguish those, which is exactly why the
 * message told nobody anything.
 *
 * ------------------------------------------------------------------
 * What a resolution is
 * ------------------------------------------------------------------
 * A service is a *catalogue record* — `lab_tests.id`, not a test name.
 * A tariff is a *row id* in `facility_service_tariffs`. The strongest
 * statement a facility can make is therefore an id-to-id link, stored
 * in `service_tariff_links` (migration 0021). Everything else is a
 * fallback, in descending order of certainty:
 *
 *   1. LINK          service_tariff_links row for this catalogue id
 *   2. FAMILY_LINK   service_tariff_links row for the whole type
 *   3. ALIAS         an approved billing key (`LABORATORY:LAB-CBC`)
 *   4. CODE          exact code equality, trimmed and case-insensitive
 *   5. CATALOGUE     the tariff's own description names the service,
 *                    inside the right department, exactly one candidate
 *
 * A step that *finds* a row but rejects it stops the ladder and reports
 * why. Falling through would mean a deactivated link silently bills a
 * different price — the failure mode this module exists to remove.
 *
 * Nothing here decides money. The amount is always the matched row's
 * `fee`, in that row's `unit`.
 */

import { and, eq, inArray, ne, sql } from 'drizzle-orm';

import * as schema from '../db/schema.ts';
import type { BillingFamily } from './tariff-codes.ts';
import {
  isGeneralBedType,
  matchTariff,
  type MatchOutcome,
  type TariffLike,
} from './tariff-matching.ts';

/* ============================================================
   VOCABULARY
   ============================================================ */

/**
 * The catalogue types a charge can point at.
 *
 * `LAB_TEST` is the only one with a catalogue table (`lab_tests`) and
 * therefore the only one that can carry a `service_id` today. The rest
 * resolve through a family link or a code, and the type is still
 * recorded so the same diagnostics work for them.
 */
export const CATALOGUE_SERVICE_TYPES = [
  'LAB_TEST',
  'CONSULTATION',
  'RADIOLOGY',
  'PROCEDURE',
  'PHARMACY',
  'ADMISSION',
  'BED_DAY',
  'DELIVERY',
] as const;

export type CatalogueServiceType = (typeof CATALOGUE_SERVICE_TYPES)[number];

const SERVICE_TYPE_SET = new Set<string>(CATALOGUE_SERVICE_TYPES);

export function isCatalogueServiceType(value: unknown): value is CatalogueServiceType {
  return typeof value === 'string' && SERVICE_TYPE_SET.has(value);
}

/** Which billing family a catalogue type belongs to. */
export function familyForServiceType(
  serviceType: CatalogueServiceType,
): BillingFamily {
  return serviceType === 'LAB_TEST' ? 'LABORATORY' : (serviceType as BillingFamily);
}

/* ============================================================
   WHY A RESOLUTION FAILED
   ============================================================ */

export type ResolutionFailureCode =
  | 'NO_TARIFF'
  | 'NOT_LINKED'
  | 'INACTIVE'
  | 'EXPIRED'
  | 'NOT_YET_EFFECTIVE'
  | 'AUTOMATIC_BILLING_DISABLED'
  | 'AMBIGUOUS'
  | 'UNIT_INCOMPATIBLE'
  | 'NO_UNIT'
  | 'ZERO_PRICE';

/** Codes that mean "the facility has not configured this yet". */
export const CONFIGURATION_FAILURES: readonly ResolutionFailureCode[] = [
  'NO_TARIFF',
  'NOT_LINKED',
  'INACTIVE',
  'EXPIRED',
  'NOT_YET_EFFECTIVE',
  'AUTOMATIC_BILLING_DISABLED',
  'AMBIGUOUS',
  'NO_UNIT',
];

export interface ResolutionFailure {
  code: ResolutionFailureCode;
  /** A sentence an administrator can act on. */
  message: string;
  /** Codes the engine tried, when it was looking by code. */
  codesTried?: string[];
  /** When ambiguous, the tariffs that both claim the service. */
  candidates?: string[];
}

/* ============================================================
   TARIFF ROWS
   ============================================================ */

export interface ResolvableTariff extends TariffLike {
  id: number;
  code: string;
  description: string;
  fee: string;
  unit: string;
  department?: string | null;
  billingKey?: string | null;
  isActive?: boolean;
  /** `YYYY-MM-DD` or null. */
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  autoBill?: boolean;
}

export interface TariffLink {
  id: number;
  serviceType: string;
  serviceId: number | null;
  tariffId: number;
  autoBill: boolean;
  isActive: boolean;
}

export type ResolutionRule =
  | 'LINK'
  | 'FAMILY_LINK'
  | 'ALIAS'
  | 'CODE'
  | 'CATALOGUE';

export interface ResolutionInput {
  serviceType: CatalogueServiceType;
  /** Catalogue row id, when the service has one (`lab_tests.id`). */
  serviceId?: number | null;
  serviceName?: string | null;
  serviceCode?: string | null;

  /** Codes the engine would try for this service, in priority order. */
  codes?: readonly string[];
  /** Approved aliases (billing keys), most specific first. */
  serviceKeys?: readonly string[];

  /** Family used for the description rule. */
  family?: BillingFamily;

  /**
   * Bed category, for a bed-night (`General`, `ICU`, …).
   *
   * A family-level bed-day link says "this is my ward bed rate". It must
   * not answer for an ICU or maternity bed, so it is applied only when
   * the bed is general — or when the facility says nothing about the
   * category at all.
   */
  wardType?: string | null;
  /** Phrases to look for in the facility's own descriptions. */
  phrases?: readonly string[];

  links: readonly TariffLink[];
  tariffs: readonly ResolvableTariff[];

  /** `YYYY-MM-DD`. Passed in so tests are deterministic. */
  today: string;

  /**
   * AUTO enforces `auto_bill` on both link and tariff. MANUAL is used
   * when a person is explicitly pricing an invoice line by hand.
   */
  mode?: 'AUTO' | 'MANUAL';
}

export interface TariffResolution {
  tariff: ResolvableTariff | null;
  rule: ResolutionRule | null;
  linkId: number | null;
  failure: ResolutionFailure | null;
  /** Every row with a verdict, for the configuration screen. */
  rows: Array<{
    tariff: ResolvableTariff;
    verdict:
      | 'RESOLVED_LINK'
      | 'RESOLVED_FAMILY_LINK'
      | 'RESOLVED_ALIAS'
      | 'RESOLVED_CODE'
      | 'RESOLVED_DESCRIPTION'
      | 'INACTIVE'
      | 'EXPIRED'
      | 'NOT_YET_EFFECTIVE'
      | 'AUTOMATIC_BILLING_DISABLED'
      | 'WRONG_DEPARTMENT'
      | 'UNIT_INCOMPATIBLE'
      | 'NO_UNIT'
      | 'ZERO_PRICE'
      | 'AMBIGUOUS'
      | 'NOT_THIS_SERVICE';
    note: string;
  }>;
  codesTried: string[];
  phrasesTried: string[];
}

/* ============================================================
   UNIT OF CHARGE
   ============================================================ */

/**
 * Units that cannot price a given kind of service.
 *
 * A laboratory test priced "Per day" is a configuration mistake that
 * would multiply a charge by a length of stay. Catching it here means
 * the invoice never carries a number nobody meant.
 */
const IMPOSSIBLE_UNITS: Record<CatalogueServiceType, readonly RegExp[]> = {
  LAB_TEST: [
    /per\s*(day|night|hour|visit|admission|stay)/i,
    /^(day|night|hour|visit|admission)$/i,
  ],
  CONSULTATION: [
    /per\s*(day|night|hour|test|sample|specimen)/i,
    /^(day|night|hour)$/i,
  ],
  RADIOLOGY: [
    /per\s*(day|night|hour|visit|admission|stay|test)/i,
    /^(day|night|hour|visit)$/i,
  ],
  PROCEDURE: [/per\s*(day|night|hour|visit)/i, /^(day|night|hour)$/i],
  PHARMACY: [/per\s*(day|night|hour|visit|admission)/i, /^(day|night|hour)$/i],
  /*
   * An admission fee is charged once. A row priced per day or per night
   * is a bed rate, whatever it is called, and must not be applied here.
   */
  ADMISSION: [
    /per\s*(hour|test|sample|specimen|day|night|stay|bed)/i,
    /^(hour|test|day|night|stay|bed)$/i,
  ],
  /*
   * A bed-night priced "per admission" or "per procedure" is the wrong
   * charge entirely — it would bill the admission fee once per night.
   * This is the IP-001 / IP-002 confusion, caught rather than billed.
   */
  BED_DAY: [
    /per\s*(test|sample|specimen|visit|admission|procedure|session|case)/i,
    /^(test|visit|admission|procedure|session|case)$/i,
  ],
  DELIVERY: [/per\s*(day|night|hour|test|sample|specimen)/i, /^(hour|test)$/i],
};

export type UnitVerdict = 'OK' | 'MISSING' | 'INCOMPATIBLE';

export function unitVerdict(
  serviceType: CatalogueServiceType,
  unit: string | null | undefined,
): UnitVerdict {
  const trimmed = typeof unit === 'string' ? unit.trim() : '';

  if (trimmed === '') return 'MISSING';

  const impossible = IMPOSSIBLE_UNITS[serviceType] ?? [];

  if (impossible.some((pattern) => pattern.test(trimmed))) return 'INCOMPATIBLE';

  return 'OK';
}

/* ============================================================
   EFFECTIVE DATES
   ============================================================ */

/** Compare ISO dates as strings: `YYYY-MM-DD` sorts lexicographically. */
export function dateVerdict(
  effectiveFrom: string | null | undefined,
  effectiveTo: string | null | undefined,
  today: string,
): 'OK' | 'EXPIRED' | 'NOT_YET_EFFECTIVE' {
  const from = typeof effectiveFrom === 'string' ? effectiveFrom.slice(0, 10) : '';
  const to = typeof effectiveTo === 'string' ? effectiveTo.slice(0, 10) : '';

  if (to !== '' && today > to) return 'EXPIRED';
  if (from !== '' && today < from) return 'NOT_YET_EFFECTIVE';

  return 'OK';
}

export function todayKey(now: Date = new Date()): string {
  // Local calendar date; effective dates are calendar facts, not UTC ones.
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/* ============================================================
   VALIDATION OF ONE ROW
   ============================================================ */

/** Failures that can apply to a single row. */
type RowRejectionCode =
  | 'INACTIVE'
  | 'EXPIRED'
  | 'NOT_YET_EFFECTIVE'
  | 'AUTOMATIC_BILLING_DISABLED'
  | 'UNIT_INCOMPATIBLE'
  | 'NO_UNIT'
  | 'ZERO_PRICE';

type RowRejection =
  | null
  | {
      code: RowRejectionCode;
      note: string;
    };

function rejectionFor(
  tariff: ResolvableTariff,
  input: Pick<ResolutionInput, 'serviceType' | 'today' | 'mode'>,
): RowRejection {
  if (tariff.isActive === false) {
    return { code: 'INACTIVE', note: 'Deactivated. Reactivate it to use it again.' };
  }

  const dates = dateVerdict(tariff.effectiveFrom, tariff.effectiveTo, input.today);

  if (dates === 'EXPIRED') {
    return {
      code: 'EXPIRED',
      note: `Its price period ended on ${String(tariff.effectiveTo).slice(0, 10)}.`,
    };
  }

  if (dates === 'NOT_YET_EFFECTIVE') {
    return {
      code: 'NOT_YET_EFFECTIVE',
      note: `Its price period starts on ${String(tariff.effectiveFrom).slice(0, 10)}.`,
    };
  }

  if (input.mode !== 'MANUAL' && tariff.autoBill === false) {
    return {
      code: 'AUTOMATIC_BILLING_DISABLED',
      note: 'Excluded from automatic billing. Enable automatic billing to use it.',
    };
  }

  const unit = unitVerdict(input.serviceType, tariff.unit);

  if (unit === 'MISSING') {
    return { code: 'NO_UNIT', note: 'It has no unit of charge.' };
  }

  if (unit === 'INCOMPATIBLE') {
    return {
      code: 'UNIT_INCOMPATIBLE',
      note: `Its unit “${tariff.unit}” cannot price this kind of service.`,
    };
  }

  return null;
}

/* ============================================================
   RESOLUTION
   ============================================================ */

function zeroOrNegative(fee: string | null | undefined): boolean {
  const value = Number(fee ?? 0);

  return !Number.isFinite(value) || value <= 0;
}

/**
 * Resolve against already-loaded rows.
 *
 * Pure, so every branch — inactive, expired, another facility, two
 * candidates, a unit that cannot price a test — is tested without a
 * database. `resolveServiceTariff` is only the query wrapper.
 */
export function resolveFromRows(input: ResolutionInput): TariffResolution {
  const mode = input.mode ?? 'AUTO';
  const codesTried = [...(input.codes ?? [])];
  const phrasesTried = [...(input.phrases ?? [])];

  const byId = new Map(input.tariffs.map((row) => [row.id, row]));

  const rows: TariffResolution['rows'] = [];

  const linkForTariff = new Map<number, TariffLink>();

  for (const link of input.links) {
    if (link.isActive) linkForTariff.set(link.tariffId, link);
  }

  const finish = (
    tariff: ResolvableTariff | null,
    rule: ResolutionRule | null,
    linkId: number | null,
    failure: ResolutionFailure | null,
  ): TariffResolution => {
    for (const row of input.tariffs) {
      if (tariff && row.id === tariff.id) {
        const verdict =
          rule === 'LINK'
            ? 'RESOLVED_LINK'
            : rule === 'FAMILY_LINK'
              ? 'RESOLVED_FAMILY_LINK'
              : rule === 'ALIAS'
                ? 'RESOLVED_ALIAS'
                : rule === 'CODE'
                  ? 'RESOLVED_CODE'
                  : 'RESOLVED_DESCRIPTION';

        rows.push({
          tariff: row,
          verdict,
          note: `This is the price that will be charged (${row.fee} / ${row.unit}).`,
        });

        continue;
      }

      const rejection = rejectionFor(row, { serviceType: input.serviceType, today: input.today, mode });

      if (rejection) {
        rows.push({ tariff: row, verdict: rejection.code, note: rejection.note });
        continue;
      }

      const note =
        skippedFamilyLink && skippedFamilyLink.tariffId === row.id
          ? skippedFamilyLink.note
          : rule === 'LINK' || rule === 'FAMILY_LINK'
            ? 'Not the linked tariff for this service.'
            : failure?.code === 'AMBIGUOUS'
              ? 'Also describes this service — that is the ambiguity.'
              : 'Does not price this service.';

      rows.push({
        tariff: row,
        verdict: failure?.code === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'NOT_THIS_SERVICE',
        note,
      });
    }

    return {
      tariff,
      rule,
      linkId,
      failure,
      rows,
      codesTried,
      phrasesTried,
    };
  };

  /* ---- 1/2. Explicit links, by id ------------------------------- */

  const linkSteps: Array<{ link: TariffLink | undefined; rule: ResolutionRule }> = [];

  if (typeof input.serviceId === 'number' && Number.isSafeInteger(input.serviceId)) {
    linkSteps.push({
      link: input.links.find(
        (entry) =>
          entry.isActive &&
          entry.serviceType === input.serviceType &&
          entry.serviceId === input.serviceId,
      ),
      rule: 'LINK',
    });
  }

  linkSteps.push({
    link: input.links.find(
      (entry) =>
        entry.isActive &&
        entry.serviceType === input.serviceType &&
        entry.serviceId === null,
    ),
    rule: 'FAMILY_LINK',
  });

  /*
   * A blanket bed-day link is a general-ward decision. Skipping it for
   * a special bed leaves the ward-specific link, the code and the
   * facility's own description free to price it — and if none of them
   * does, the night is reported as unconfigured instead of being billed
   * at the general rate.
   */
  const skippedFamilyLink =
    input.family === 'BED_DAY' &&
    !isGeneralBedType(input.wardType) &&
    linkSteps[linkSteps.length - 1]?.rule === 'FAMILY_LINK' &&
    linkSteps[linkSteps.length - 1]?.link
      ? {
          tariffId: linkSteps[linkSteps.length - 1].link!.tariffId,
          note: `This is a family-wide bed-day link and cannot price a ${input.wardType} bed. Link this ward specifically, or add a tariff for the category.`,
        }
      : null;

  for (const step of linkSteps) {
    if (!step.link) continue;

    if (step.rule === 'FAMILY_LINK' && skippedFamilyLink) {
      /* Recorded on the tariff below, so the screen explains the skip. */
      continue;
    }

    if (mode !== 'MANUAL' && step.link.autoBill === false) {
      return finish(null, null, step.link.id, {
        code: 'AUTOMATIC_BILLING_DISABLED',
        message:
          'This service is linked to a tariff that is excluded from automatic billing. Enable automatic billing on the link, or price the invoice line by hand.',
        candidates: [],
      });
    }

    const tariff = byId.get(step.link.tariffId);

    if (!tariff) {
      return finish(null, null, step.link.id, {
        code: 'NO_TARIFF',
        message:
          'This service is linked to a tariff that no longer exists in this facility. Point the link at a current tariff.',
      });
    }

    const rejection = rejectionFor(tariff, {
      serviceType: input.serviceType,
      today: input.today,
      mode,
    });

    if (rejection) {
      /*
       * Stop here on purpose. A link is the facility's explicit
       * statement; silently using a different tariff because the linked
       * one lapsed would bill a price nobody chose.
       */
      return finish(null, null, step.link.id, {
        code: rejection.code,
        message: `This service is linked to ${tariff.code}, but ${rejection.note.charAt(0).toLowerCase()}${rejection.note.slice(1)}`,
        candidates: [tariff.code],
      });
    }

    if (zeroOrNegative(tariff.fee)) {
      return finish(null, null, step.link.id, {
        code: 'ZERO_PRICE',
        message: `This service is linked to ${tariff.code}, which is priced at zero. Set a fee on that tariff.`,
        candidates: [tariff.code],
      });
    }

    return finish(tariff, step.rule, step.link.id, null);
  }

  /* ---- 3. Approved aliases -------------------------------------- */

  const keys = (input.serviceKeys ?? [])
    .map((key) => (typeof key === 'string' ? key.trim().toUpperCase() : ''))
    .filter((key) => key !== '');

  const valid = input.tariffs.filter(
    (row) => rejectionFor(row, { serviceType: input.serviceType, today: input.today, mode }) === null,
  );

  for (const key of keys) {
    const matches = input.tariffs.filter(
      (row) => (row.billingKey ?? '').trim().toUpperCase() === key,
    );

    if (matches.length === 0) continue;

    const usable = matches.find((row) =>
      valid.some((entry) => entry.id === row.id),
    );

    if (usable) {
      const rejection = rejectionFor(usable, {
        serviceType: input.serviceType,
        today: input.today,
        mode,
      });

      if (rejection) {
        return finish(null, null, null, {
          code: rejection.code,
          message: `The tariff linked to ${key} (${usable.code}) ${rejection.note.charAt(0).toLowerCase()}${rejection.note.slice(1)}`,
          candidates: [usable.code],
        });
      }

      if (zeroOrNegative(usable.fee)) {
        return finish(null, null, null, {
          code: 'ZERO_PRICE',
          message: `The tariff linked to ${key} (${usable.code}) is priced at zero.`,
          candidates: [usable.code],
        });
      }

      return finish(usable, 'ALIAS', null, null);
    }

    /* The alias exists but every row carrying it is unusable. */
    const first = matches[0];
    const rejection = rejectionFor(first, {
      serviceType: input.serviceType,
      today: input.today,
      mode,
    });

    return finish(null, null, null, {
      code: rejection?.code ?? 'NO_TARIFF',
      message: `The tariff linked to ${key} (${first.code}) cannot be used: ${rejection?.note ?? 'no usable price.'}`,
      candidates: matches.map((row) => row.code),
    });
  }

  /* ---- 4. Exact codes ------------------------------------------- */

  const codeKey = (value: string | null | undefined): string =>
    typeof value === 'string' ? value.trim().toUpperCase() : '';

  const rejectedByCode: Array<{ row: ResolvableTariff; rejection: NonNullable<RowRejection> }> = [];

  for (const code of codesTried) {
    const wanted = codeKey(code);

    if (wanted === '') continue;

    const matches = input.tariffs.filter((row) => codeKey(row.code) === wanted);

    if (matches.length === 0) continue;

    const usable = matches.find((row) => valid.some((entry) => entry.id === row.id));

    if (usable) {
      if (zeroOrNegative(usable.fee)) continue;

      return finish(usable, 'CODE', null, null);
    }

    for (const row of matches) {
      const rejection = rejectionFor(row, {
        serviceType: input.serviceType,
        today: input.today,
        mode,
      });

      if (rejection) rejectedByCode.push({ row, rejection });
    }
  }

  /*
   * A code matched, but every row carrying it was rejected. Say which,
   * instead of the flat "nothing matched" that hid the reason before.
   */
  if (rejectedByCode.length > 0) {
    const first = rejectedByCode[0];

    return finish(null, null, null, {
      code: first.rejection.code,
      message: `${first.row.code} matches this service but ${first.rejection.note.charAt(0).toLowerCase()}${first.rejection.note.slice(1)}`,
      codesTried,
      candidates: rejectedByCode.map((entry) => entry.row.code),
    });
  }

  /* ---- 5. The facility's own description ------------------------ */

  if (input.family && phrasesTried.length > 0) {
    const outcome: MatchOutcome<ResolvableTariff> = matchTariff({
      rows: valid,
      codes: [],
      family: input.family,
      phrases: phrasesTried,
    });

    if (outcome.tariff) {
      if (!zeroOrNegative(outcome.tariff.fee)) {
        return finish(outcome.tariff, 'CATALOGUE', null, null);
      }
    }

    if (outcome.ambiguity) {
      return finish(null, null, null, {
        code: 'AMBIGUOUS',
        message: `Two active tariffs both describe this service — ${outcome.ambiguity.codes.join(' and ')}. JaliCare will not choose between them: link the right one under “Use an existing tariff”.`,
        candidates: outcome.ambiguity.codes,
      });
    }
  }

  /*
   * Nothing usable answered, but something *did* describe the service.
   * Saying "no tariff matched" here is the failure this whole module
   * replaces: the row exists, it is simply not usable, and the
   * administrator needs to know which one and why.
   */
  if (input.family && phrasesTried.length > 0) {
    /*
     * `matchTariff` only ever considers active rows — correctly, since
     * it decides prices. This diagnostic pass asks a different question
     * ("which row *describes* this service?"), so it presents the rows
     * as active purely to get an answer about them. Nothing here can
     * return a tariff: the result is used only to name the rejection.
     */
    const everything = matchTariff({
      rows: input.tariffs.map((row) => ({ ...row, isActive: true })),
      codes: [],
      family: input.family,
      phrases: phrasesTried,
    });

    /*
     * The clone exists only to let the matcher see the row; the
     * rejection must be computed from the stored row, which still knows
     * it is inactive.
     */
    const described = everything.tariff
      ? input.tariffs.find((row) => row.id === everything.tariff?.id) ?? null
      : null;

    if (described && everything.rule === 'CATALOGUE') {
      const rejection = rejectionFor(described, {
        serviceType: input.serviceType,
        today: input.today,
        mode,
      });

      if (rejection) {
        return finish(null, null, null, {
          code: rejection.code,
          message: `${described.code} describes this service but ${rejection.note.charAt(0).toLowerCase()}${rejection.note.slice(1)}`,
          candidates: [described.code],
          codesTried,
        });
      }

      if (zeroOrNegative(described.fee)) {
        return finish(null, null, null, {
          code: 'ZERO_PRICE',
          message: `${described.code} describes this service but is priced at zero.`,
          candidates: [described.code],
          codesTried,
        });
      }
    }
  }

  /* ---- Nothing --------------------------------------------------- */

  return finish(null, null, null, {
    code: 'NO_TARIFF',
    message:
      'No active tariff in this facility prices this service. Add the price, or link this service to a tariff you already have.',
    codesTried,
  });
}

/* ============================================================
   DIAGNOSTIC LABELS
   ============================================================ */

const FAILURE_LABELS: Record<ResolutionFailureCode, string> = {
  NO_TARIFF: 'No tariff linked',
  NOT_LINKED: 'No tariff linked',
  INACTIVE: 'Inactive tariff',
  EXPIRED: 'Expired tariff',
  NOT_YET_EFFECTIVE: 'Tariff not yet in effect',
  AUTOMATIC_BILLING_DISABLED: 'Automatic billing disabled',
  AMBIGUOUS: 'Ambiguous tariff mapping',
  UNIT_INCOMPATIBLE: 'Incompatible unit',
  NO_UNIT: 'Missing unit',
  ZERO_PRICE: 'Tariff priced at zero',
};

export function failureLabel(code: ResolutionFailureCode): string {
  return FAILURE_LABELS[code] ?? code;
}

/** True when the failure needs an administrator, not a cashier. */
export function needsConfiguration(code: ResolutionFailureCode): boolean {
  return CONFIGURATION_FAILURES.includes(code);
}

/* ============================================================
   DATABASE
   ============================================================ */

/** Anything that can run a query: the pool, a transaction, a test double. */
type Executor = any;

let warnedMissingLinkTable = false;
let warnedMissingValidityColumns = false;

/** True when the database predates a table/column this module needs. */
export function isMissingSchemaObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const code = (error as { code?: unknown }).code;

  return code === '42P01' || code === '42703';
}

/**
 * Every tariff of one facility, active or not.
 *
 * Inactive, expired and excluded rows are loaded deliberately: a
 * resolver that only saw usable rows could say "no tariff matched" but
 * never "your row is inactive", which is the difference between a
 * useless message and a fixable one.
 *
 * A database that has not applied 0019 or 0021 still works — the
 * columns are simply absent and the corresponding checks are skipped.
 */
export async function loadFacilityTariffs(
  executor: Executor,
  facilityId: number,
): Promise<ResolvableTariff[]> {
  const base = {
    id: schema.facilityServiceTariffs.id,
    code: schema.facilityServiceTariffs.code,
    description: schema.facilityServiceTariffs.description,
    fee: schema.facilityServiceTariffs.fee,
    unit: schema.facilityServiceTariffs.unit,
    department: schema.facilityServiceTariffs.department,
    isActive: schema.facilityServiceTariffs.isActive,
  };

  const where = eq(schema.facilityServiceTariffs.facilityId, facilityId);

  try {
    const rows = await executor
      .select({
        ...base,
        billingKey: schema.facilityServiceTariffs.billingKey,
        effectiveFrom: schema.facilityServiceTariffs.effectiveFrom,
        effectiveTo: schema.facilityServiceTariffs.effectiveTo,
        autoBill: schema.facilityServiceTariffs.autoBill,
      })
      .from(schema.facilityServiceTariffs)
      .where(where);

    return rows.map((row: Record<string, unknown>) => ({
      ...(row as unknown as ResolvableTariff),
      effectiveFrom: (row.effectiveFrom as string | null) ?? null,
      effectiveTo: (row.effectiveTo as string | null) ?? null,
      autoBill: row.autoBill !== false,
      billingKey: (row.billingKey as string | null) ?? null,
    }));
  } catch (error) {
    if (!isMissingSchemaObject(error)) throw error;

    if (!warnedMissingValidityColumns) {
      warnedMissingValidityColumns = true;

      console.warn(
        'Billing: facility_service_tariffs is missing the validity columns from migration 0021. Run `npm run db:migrate`. Effective dates and the automatic-billing flag are not being checked until then.',
      );
    }
  }

  /* 0021 not applied: fall back to the 0019 shape. */
  try {
    const rows = await executor
      .select({
        ...base,
        billingKey: schema.facilityServiceTariffs.billingKey,
      })
      .from(schema.facilityServiceTariffs)
      .where(where);

    return rows.map((row: Record<string, unknown>) => ({
      ...(row as unknown as ResolvableTariff),
      effectiveFrom: null,
      effectiveTo: null,
      autoBill: true,
      billingKey: (row.billingKey as string | null) ?? null,
    }));
  } catch (error) {
    if (!isMissingSchemaObject(error)) throw error;
  }

  /* Neither 0019 nor 0021: codes and descriptions only. */
  const rows = await executor
    .select(base)
    .from(schema.facilityServiceTariffs)
    .where(where);

  return rows.map((row: Record<string, unknown>) => ({
    ...(row as unknown as ResolvableTariff),
    effectiveFrom: null,
    effectiveTo: null,
    autoBill: true,
    billingKey: null,
  }));
}

/**
 * The links this facility has made, for one service type and its
 * family-level fallback.
 *
 * A database without migration 0021 returns no links: the resolver then
 * behaves exactly as it did before the table existed, which is the
 * correct degradation for a schema one migration behind.
 */
export async function loadServiceTariffLinks(
  executor: Executor,
  input: { facilityId: number; serviceType: string },
): Promise<TariffLink[]> {
  try {
    const rows = await executor
      .select({
        id: schema.serviceTariffLinks.id,
        serviceType: schema.serviceTariffLinks.serviceType,
        serviceId: schema.serviceTariffLinks.serviceId,
        tariffId: schema.serviceTariffLinks.tariffId,
        autoBill: schema.serviceTariffLinks.autoBill,
        isActive: schema.serviceTariffLinks.isActive,
      })
      .from(schema.serviceTariffLinks)
      .where(
        and(
          eq(schema.serviceTariffLinks.facilityId, input.facilityId),
          eq(schema.serviceTariffLinks.serviceType, input.serviceType),
          eq(schema.serviceTariffLinks.isActive, true),
        ),
      );

    return rows as TariffLink[];
  } catch (error) {
    if (!isMissingSchemaObject(error)) throw error;

    if (!warnedMissingLinkTable) {
      warnedMissingLinkTable = true;

      console.warn(
        'Billing: service_tariff_links is missing. Run `npm run db:migrate` (migration 0021) to link catalogue services to tariffs by id. Falling back to code and description matching.',
      );
    }

    return [];
  }
}

/**
 * Resolve a catalogue service to this facility's tariff.
 *
 * This is the function every charge site calls, directly or through
 * `chargeForService`. It performs no writes.
 */
export async function resolveServiceTariff(
  executor: Executor,
  input: {
    facilityId: number;
    serviceType: CatalogueServiceType;
    serviceId?: number | null;
    serviceName?: string | null;
    serviceCode?: string | null;
    codes?: readonly string[];
    serviceKeys?: readonly string[];
    family?: BillingFamily;
    phrases?: readonly string[];
    wardType?: string | null;
    today?: string;
    mode?: 'AUTO' | 'MANUAL';
  },
): Promise<TariffResolution> {
  const [tariffs, links] = await Promise.all([
    loadFacilityTariffs(executor, input.facilityId),
    loadServiceTariffLinks(executor, {
      facilityId: input.facilityId,
      serviceType: input.serviceType,
    }),
  ]);

  return resolveFromRows({
    serviceType: input.serviceType,
    serviceId: input.serviceId ?? null,
    serviceName: input.serviceName ?? null,
    serviceCode: input.serviceCode ?? null,
    codes: input.codes ?? [],
    serviceKeys: input.serviceKeys ?? [],
    family: input.family ?? familyForServiceType(input.serviceType),
    phrases: input.phrases ?? [],
    wardType: input.wardType ?? null,
    links,
    tariffs,
    today: input.today ?? todayKey(),
    mode: input.mode ?? 'AUTO',
  });
}

/**
 * Does a tariff with this code exist at *another* facility?
 *
 * Used only by diagnostics, never by the charger. A facility that sees
 * "LAB-BLOOD: no tariff linked" while looking at a row it created at
 * its other branch deserves to be told that, without the other
 * facility's price being revealed and without any chance of billing it.
 */
export async function findTariffAtOtherFacility(
  executor: Executor,
  input: { tenantId: number; facilityId: number; codes: readonly string[] },
): Promise<Array<{ code: string; facilityId: number; isActive: boolean }>> {
  const wanted = input.codes
    .map((code) => (typeof code === 'string' ? code.trim().toUpperCase() : ''))
    .filter((code) => code !== '');

  if (wanted.length === 0) return [];

  try {
    const rows = await executor
      .select({
        code: schema.facilityServiceTariffs.code,
        facilityId: schema.facilityServiceTariffs.facilityId,
        isActive: schema.facilityServiceTariffs.isActive,
      })
      .from(schema.facilityServiceTariffs)
      .where(
        and(
          eq(schema.facilityServiceTariffs.tenantId, input.tenantId),
          ne(schema.facilityServiceTariffs.facilityId, input.facilityId),
          inArray(
            sql`upper(${schema.facilityServiceTariffs.code})`,
            wanted,
          ),
        ),
      )
      .limit(10);

    return rows as Array<{ code: string; facilityId: number; isActive: boolean }>;
  } catch (error) {
    if (isMissingSchemaObject(error)) return [];

    throw error;
  }
}
