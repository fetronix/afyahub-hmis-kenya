/**
 * JaliCare HMIS
 * Inpatient ward billing — the discharge that billed the bed at nothing
 *
 * Built around the reported failure:
 *
 *   Discharge shows "No active tariff matched BED-FMW001, WARD-FMW001,
 *   BED-DAY (+3 more)…". The patient is discharged and the bed goes to
 *   Cleaning, but no bed-night charge reaches the invoice, although the
 *   facility's price list contains IP-002 "General ward bed charge" at
 *   1,500 per day.
 *
 * Two root causes are asserted here, at the level where money is
 * decided:
 *
 *   1. `chargeForService` labelled the night `BED_DAY`, but the phrase
 *      builder only knew consultations, so the engine offered the codes
 *      and the words "bed day" — and "bed day" is not how a facility
 *      writes "General ward bed charge". The row was never described.
 *   2. The stay was priced from the ward the patient was in *now*.
 *      After a transfer, every earlier night was re-priced at the new
 *      ward and the same date could be claimed by two wards.
 *
 * No database is required: every rule runs through the same
 * `resolveFromRows`, `bedDaySegments` and `buildIdempotencyKey` the
 * server calls.
 *
 * Run with: npx tsx src/tests/ward-billing.test.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  bedDayDates,
  bedDaySegments,
  bedDayTariffCodes,
  buildIdempotencyKey,
  toCents,
} from '../billing/billing.service.ts';
import {
  resolveFromRows,
  type ResolvableTariff,
  type ResolutionInput,
  type TariffLink,
} from '../billing/tariff-resolver.ts';
import { phrasesForCharge, codesForFamily } from '../billing/tariff-matching.ts';
import { billingServiceKeys } from '../billing/tariff-codes.ts';
import { toChargeRequest, type ChargeAttemptRow } from '../billing/charge-attempts.ts';
import * as schema from '../db/schema.ts';

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) {
    throw new Error(`FAILED: ${label}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`,
  );
}

const ROOT = resolve(import.meta.dirname, '..', '..');

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

/* ============================================================
   THE FACILITY'S PRICE LIST
   ============================================================ */

const TODAY = '2026-10-22';

function tariff(
  id: number,
  code: string,
  description: string,
  fee: string,
  unit: string,
  extra: Partial<ResolvableTariff> = {},
): ResolvableTariff {
  return {
    id,
    code,
    description,
    fee,
    unit,
    department: 'inpatient',
    billingKey: null,
    isActive: true,
    effectiveFrom: null,
    effectiveTo: null,
    autoBill: true,
    ...extra,
  };
}

/** The two inpatient rows the facility actually has. */
const IP_001 = tariff(1, 'IP-001', 'Inpatient admission administration', '500.00', 'Admission');

const IP_002 = tariff(2, 'IP-002', 'General ward bed charge', '1500.00', 'Per day');

const priceList = [IP_001, IP_002];

/** A ward link, as the tariff screen writes it. */
function link(tariffId: number, serviceId: number | null = null): TariffLink {
  return {
    id: tariffId + 100,
    serviceType: 'BED_DAY',
    serviceId,
    tariffId,
    autoBill: true,
    isActive: true,
  };
}

function bedDay(input: {
  wardCode?: string;
  wardType?: string;
  wardName?: string;
  tariffs?: ResolvableTariff[];
  links?: TariffLink[];
  serviceId?: number;
  /** Override the phrases, to reproduce the pre-fix vocabulary. */
  phrases?: string[];
}): ResolutionInput {
  const wardType = input.wardType ?? 'General';
  const wardCode = input.wardCode ?? 'FMW001';
  const wardName = input.wardName ?? 'General Ward';

  return {
    serviceType: 'BED_DAY',
    serviceId: input.serviceId ?? null,
    codes: codesForFamily({ family: 'BED_DAY', wardCode }),
    serviceKeys: billingServiceKeys('BED_DAY', [wardCode]),
    family: 'BED_DAY',
    phrases: input.phrases ?? phrasesForCharge({ family: 'BED_DAY', wardType, wardName }),
    wardType,
    links: input.links ?? [],
    tariffs: input.tariffs ?? priceList,
    today: TODAY,
  };
}

/* ============================================================
   1. THE REPORTED FAILURE, REPRODUCED
   ============================================================ */

function testTheReportedCodes(): void {
  /*
   * The exact six codes from the warning. The first four words of the
   * message were a symptom of the engine reading the ward's name and
   * generating candidates from it — correct — while never describing
   * the charge in the words the price list uses.
   */
  assertEqual(
    bedDayTariffCodes('FMW001'),
    ['BED-FMW001', 'WARD-FMW001', 'BED-DAY', 'INPATIENT-BED-DAY', 'WARD-DAY', 'BED'],
    'the six candidates in the reported warning are unchanged',
  );

  /*
   * Before this round the bed-day family had no vocabulary of its own:
   * the only phrase was the service name. "bed day" does not describe
   * "General ward bed charge", so IP-002 was never seen.
   */
  const oldVocabulary = resolveFromRows(bedDay({ phrases: ['bed day'] }));

  assertEqual(oldVocabulary.tariff, null, 'the old vocabulary priced nothing');
  assertEqual(
    oldVocabulary.failure?.code,
    'NO_TARIFF',
    'and reported it as no tariff — the reported warning',
  );
  assert(
    oldVocabulary.failure?.message?.includes('IP-002') === false,
    'without naming the row that would have priced it',
  );

  /* The candidates were tried; the row was never described. */
  assertEqual(
    oldVocabulary.codesTried,
    bedDayTariffCodes('FMW001'),
    'every candidate code was tried',
  );
  assert(
    (oldVocabulary.phrasesTried ?? []).length === 1,
    'and exactly one phrase, which could not match the price list',
  );

  console.log('  ✓ The reported warning is reproduced from the real codes');
}

/* ============================================================
   2. A GENERAL BED PRICES FROM THE EXISTING IP-002 ROW
   ============================================================ */

function testGeneralBedResolvesToTheExistingTariff(): void {
  const resolution = resolveFromRows(bedDay({}));

  assert(resolution.failure === null, 'the general ward bed resolves');
  assertEqual(resolution.tariff?.code, 'IP-002', 'it is priced by IP-002');
  assertEqual(
    resolution.tariff?.fee,
    '1500.00',
    'at the existing 1,500 a day — no price was changed',
  );
  assertEqual(resolution.tariff?.unit, 'Per day', 'with its per-day unit');
  assertEqual(
    resolution.rule,
    'CATALOGUE',
    'found by the facility’s own description, not by a new code',
  );
  assertEqual(
    resolution.phrasesTried[0],
    'general ward bed charge',
    'the exact words on the price list are offered first',
  );

  /*
   * The phrase the engine now offers is the row's own text. That is why
   * no tariff had to be added: the mapping was missing, not the row.
   */
  assert(
    resolution.phrasesTried.includes('general ward bed charge'),
    'the general-bed vocabulary includes the price-list wording',
  );
  assert(
    resolution.phrasesTried.includes('bed day'),
    'and keeps the generic bed-day wording beneath it',
  );

  console.log('  ✓ A general ward bed resolves to the existing IP-002');
}

/* ============================================================
   3. THE NIGHTLY RATE AND THE ONE-OFF ADMISSION FEE
   ============================================================ */

function testAdmissionAndBedDayNeverSwap(): void {
  /*
   * IP-001 is charged once when the patient is admitted. It must not be
   * reachable from a night: 500 repeated for a week is a wrong bill.
   */
  const bedDayAgainstAdmissionTariff = resolveFromRows(
    bedDay({ tariffs: [IP_001], links: [link(1)] }),
  );

  assertEqual(bedDayAgainstAdmissionTariff.tariff, null, 'IP-001 cannot price a bed-night');
  assertEqual(
    bedDayAgainstAdmissionTariff.failure?.code,
    'UNIT_INCOMPATIBLE',
    'the per-admission unit is refused for a night, not billed at 500',
  );

  /*
   * And the other direction: an admission fee priced per day is a bed
   * rate with the wrong label. It must not price the one-off fee.
   */
  const admission = resolveFromRows({
    serviceType: 'ADMISSION',
    codes: codesForFamily({ family: 'ADMISSION', wardCode: 'FMW001' }),
    serviceKeys: billingServiceKeys('ADMISSION'),
    family: 'ADMISSION',
    phrases: phrasesForCharge({ family: 'ADMISSION' }),
    links: [],
    tariffs: priceList,
    today: TODAY,
  });

  assertEqual(admission.tariff?.code, 'IP-001', 'the admission fee resolves to IP-001');
  assertEqual(admission.tariff?.fee, '500.00', 'at its existing 500');
  assertEqual(admission.rule, 'CATALOGUE', 'by its own words, never by the bed-day vocabulary');

  const admissionAgainstBedTariff = resolveFromRows({
    serviceType: 'ADMISSION',
    codes: codesForFamily({ family: 'ADMISSION', wardCode: 'FMW001' }),
    serviceKeys: billingServiceKeys('ADMISSION'),
    family: 'ADMISSION',
    phrases: phrasesForCharge({ family: 'ADMISSION' }),
    /*
     * A link can only exist inside its own family, so this is an
     * admission link pointed at the bed-day row — the configuration
     * mistake a person could actually make on the tariff screen.
     */
    links: [
      {
        id: 501,
        serviceType: 'ADMISSION',
        serviceId: null,
        tariffId: 2,
        autoBill: true,
        isActive: true,
      },
    ],
    tariffs: [IP_002],
    today: TODAY,
  });

  assertEqual(admissionAgainstBedTariff.tariff, null, 'IP-002 cannot price the admission fee');
  assertEqual(
    admissionAgainstBedTariff.failure?.code,
    'UNIT_INCOMPATIBLE',
    'a per-day row is refused for a one-off admission charge',
  );

  /*
   * The admission charge in the route no longer passes the ward name as
   * an alias. "General Ward" is two words that also describe "General
   * ward bed charge", so the alias was a path from the admission fee to
   * the nightly rate.
   */
  const app = source('src/app.ts');
  const admissionRoute = app.slice(
    app.indexOf("sourceType: 'ADMISSION'") - 900,
    app.indexOf("sourceType: 'ADMISSION'") + 200,
  );

  assert(
    !admissionRoute.includes('aliases: [ward?.name'),
    'the admission fee does not offer the ward name as a phrase',
  );

  console.log('  ✓ IP-001 and IP-002 cannot price each other’s charge');
}

/* ============================================================
   4. A SPECIAL BED IS REPORTED, NEVER PADDED AT THE GENERAL RATE
   ============================================================ */

function testSpecialBedsAreNotPricedAtTheGeneralRate(): void {
  const icu = resolveFromRows(bedDay({ wardCode: 'ICU', wardName: 'ICU', wardType: 'ICU' }));

  assertEqual(icu.tariff, null, 'an ICU night is not priced by the general row');
  assertEqual(icu.failure?.code, 'NO_TARIFF', 'it is reported as unconfigured');
  assert(icu.phrasesTried.includes('icu bed charge'), 'the ICU vocabulary is tried');
  assert(
    !icu.phrasesTried.includes('general ward bed charge'),
    'the general vocabulary is never offered to an ICU bed',
  );

  /*
   * A family-wide bed-day link — the "one rate for all wards" shortcut —
   * is still a general-bed decision. It must not silently price ICU.
   */
  const withFamilyLink = resolveFromRows(
    bedDay({
      wardCode: 'ICU',
      wardName: 'ICU',
      wardType: 'ICU',
      links: [link(2)],
    }),
  );

  assertEqual(withFamilyLink.tariff, null, 'a family-wide bed-day link does not price an ICU bed');
  assertEqual(withFamilyLink.failure?.code, 'NO_TARIFF', 'the night is reported');

  const explanation = withFamilyLink.rows.find((row) => row.tariff.id === 2);

  assert(
    explanation?.note.includes('family-wide bed-day link') === true,
    'the screen explains why the general link was skipped',
  );

  /*
   * A ward-specific link is the explicit statement the requirement
   * prefers, and it wins: the facility said this ward costs this much.
   */
  const wardLinked = resolveFromRows(
    bedDay({
      wardCode: 'ICU',
      wardName: 'ICU',
      wardType: 'ICU',
      serviceId: 7,
      links: [link(2, 7)],
    }),
  );

  assertEqual(wardLinked.tariff?.code, 'IP-002', 'a ward-specific link prices that ward');
  assertEqual(wardLinked.rule, 'LINK', 'by explicit link, not by a guess');

  /*
   * The ordinary answer for a special bed: its own row.
   */
  const icuRow = tariff(9, 'BED-ICU', 'ICU bed charge', '5000.00', 'Per day');

  const icuPriced = resolveFromRows(
    bedDay({
      wardCode: 'ICU',
      wardName: 'ICU',
      wardType: 'ICU',
      tariffs: [IP_001, IP_002, icuRow],
    }),
  );

  assertEqual(icuPriced.tariff?.code, 'BED-ICU', 'an ICU row prices the ICU night');
  assertEqual(icuPriced.tariff?.fee, '5000.00', 'at the ICU rate, not 1,500');
  assertEqual(icuPriced.rule, 'CODE', 'by its exact ward code');

  /*
   * A bed-day row filed under another department is not this family's
   * price. Choosing it would bill a price the inpatient screen never
   * showed.
   */
  const misfiled = resolveFromRows(
    bedDay({
      tariffs: [
        tariff(11, 'IP-002', 'General ward bed charge', '1500.00', 'Per day', {
          department: 'opd',
        }),
      ],
    }),
  );

  assertEqual(
    misfiled.tariff,
    null,
    'a bed-day row outside the inpatient department is not selected',
  );

  console.log('  ✓ A special bed is reported, never billed at the general rate');
}

/* ============================================================
   5. BED-DAY MATH: STAYS, TRANSFERS AND DISCHARGE
   ============================================================ */

function testBedDayPeriods(): void {
  /*
   * The existing rule, unchanged: admission date to discharge date
   * inclusive, and a same-day stay is one day. This round fixes the
   * mapping, not the counting.
   */
  const stay = bedDayDates('2026-10-20', '2026-10-22');

  assertEqual(stay, ['2026-10-20', '2026-10-21', '2026-10-22'], 'three nights');
  assertEqual(
    bedDayDates('2026-10-20 09:00', '2026-10-20 18:00').length,
    1,
    'a same-day stay is one night',
  );

  const home = { id: 1, code: 'FMW001', name: 'General Ward', wardType: 'General' };
  const icu = { id: 2, code: 'ICU', name: 'ICU', wardType: 'ICU' };

  /* No transfer: one segment covering the whole stay. */
  const plain = bedDaySegments({
    admissionDate: '2026-10-20',
    dischargeDate: '2026-10-22',
    homeWard: home,
  });

  assertEqual(plain.length, 1, 'a stay without transfers is one segment');
  assertEqual(plain[0].dates, stay, 'covering every night');
  assertEqual(plain[0].ward?.id, 1, 'at the admission ward');

  /* A transfer on the 21st: the 20th stays with the old ward. */
  const transferred = bedDaySegments({
    admissionDate: '2026-10-20',
    dischargeDate: '2026-10-22',
    homeWard: home,
    transfers: [{ toWardId: 2, transferredAt: '2026-10-21T14:30:00', ward: icu }],
  });

  assertEqual(transferred.length, 2, 'the stay splits at the transfer');
  assertEqual(
    transferred[0].dates,
    ['2026-10-20'],
    'the night before the move stays on the old ward',
  );
  assertEqual(transferred[0].ward?.code, 'FMW001', 'at the general rate');
  assertEqual(
    transferred[1].dates,
    ['2026-10-21', '2026-10-22'],
    'the transfer date and after belong to the new ward',
  );
  assertEqual(transferred[1].ward?.code, 'ICU', 'at the ICU rate');

  /*
   * `admissions.ward_id` is updated by the transfer, so by the time this
   * runs the admission points at the destination. The opening ward must
   * come from the transfer history, or the first night is re-priced at
   * the ward the patient moved *to* — the original bug.
   */
  const afterTheMove = bedDaySegments({
    admissionDate: '2026-10-20',
    dischargeDate: '2026-10-22',
    homeWard: icu,
    transfers: [
      {
        fromWardId: 1,
        toWardId: 2,
        transferredAt: '2026-10-21T14:30:00',
        fromWard: home,
        ward: icu,
      },
    ],
  });

  assertEqual(
    afterTheMove[0].ward?.code,
    'FMW001',
    'the opening ward is the transfer’s origin, not the current ward',
  );
  assertEqual(
    afterTheMove[0].dates,
    ['2026-10-20'],
    'so the first night keeps the general rate after a move to ICU',
  );

  /*
   * The invariant that makes the invoice safe: every night appears
   * exactly once across the segments, and the total is the stay length.
   * No overlap means two wards cannot claim one date; no gap means no
   * night is free.
   */
  const all = transferred.flatMap((segment) => segment.dates);

  assertEqual(all.length, stay.length, 'the total number of nights is unchanged');
  assertEqual(new Set(all).size, all.length, 'no night is billed twice');
  assertEqual([...all].sort(), [...stay], 'and no night is missed');

  /* Two moves, three segments. */
  const twice = bedDaySegments({
    admissionDate: '2026-10-20',
    dischargeDate: '2026-10-23',
    homeWard: home,
    transfers: [
      { toWardId: 2, transferredAt: '2026-10-21T08:00:00', ward: icu },
      { toWardId: 1, transferredAt: '2026-10-23T08:00:00', ward: home },
    ],
  });

  assertEqual(
    twice.map((segment) => segment.dates),
    [['2026-10-20'], ['2026-10-21', '2026-10-22'], ['2026-10-23']],
    'each move starts a new segment on its own date',
  );

  /* Two moves on one day: the last ward holds that night, once. */
  const sameDay = bedDaySegments({
    admissionDate: '2026-10-20',
    dischargeDate: '2026-10-22',
    homeWard: home,
    transfers: [
      { toWardId: 2, transferredAt: '2026-10-21T08:00:00', ward: icu },
      { toWardId: 1, transferredAt: '2026-10-21T16:00:00', ward: home },
    ],
  });

  assertEqual(
    sameDay.flatMap((segment) => segment.dates),
    stay,
    'two moves on one date still bill each night once',
  );
  assertEqual(
    sameDay[sameDay.length - 1].ward?.id,
    1,
    'the ward the patient ended the day in holds the night',
  );

  /* Leaving on the transfer day. */
  const leaveOnTransfer = bedDaySegments({
    admissionDate: '2026-10-20',
    dischargeDate: '2026-10-21',
    homeWard: home,
    transfers: [{ toWardId: 2, transferredAt: '2026-10-21T10:00:00', ward: icu }],
  });

  assertEqual(
    leaveOnTransfer.map((segment) => segment.dates),
    [['2026-10-20'], ['2026-10-21']],
    'the discharge day is billed to the ward that held it',
  );

  /*
   * A nightly job asked to run to yesterday must not be re-priced by
   * this morning's transfer.
   */
  const yesterday = bedDaySegments({
    admissionDate: '2026-10-20',
    dischargeDate: null,
    untilDate: '2026-10-21',
    homeWard: home,
    transfers: [{ toWardId: 2, transferredAt: '2026-10-22T09:00:00', ward: icu }],
  });

  assertEqual(
    yesterday.flatMap((segment) => segment.dates),
    ['2026-10-20', '2026-10-21'],
    'a partial run stops at its date',
  );
  assertEqual(
    yesterday.every((segment) => segment.ward?.id === 1),
    true,
    'and is priced at the ward the patient was in then',
  );

  /* Never past the discharge, even when asked for a later date. */
  const capped = bedDaySegments({
    admissionDate: '2026-10-20',
    dischargeDate: '2026-10-21',
    untilDate: '2026-10-31',
    homeWard: home,
  });

  assertEqual(
    capped.flatMap((segment) => segment.dates),
    ['2026-10-20', '2026-10-21'],
    'the discharge closes the period',
  );

  /* An unparseable admission date bills nothing rather than guessing. */
  assertEqual(
    bedDaySegments({ admissionDate: '', homeWard: home }),
    [],
    'a broken admission date yields no charges',
  );

  console.log('  ✓ Stays, transfers and discharge bill every night exactly once');
}

/* ============================================================
   6. ONE KEY PER NIGHT — RETRIES CANNOT DUPLICATE
   ============================================================ */

function testOneKeyPerNight(): void {
  const first = buildIdempotencyKey({
    sourceType: 'BED_DAY',
    sourceId: 42,
    idempotencySuffix: '2026-10-20',
  });

  assertEqual(first, 'BED_DAY:42:2026-10-20', 'the night has one stable key');

  const retry = buildIdempotencyKey({
    sourceType: 'BED_DAY',
    sourceId: 42,
    idempotencySuffix: '2026-10-20',
  });

  assertEqual(retry, first, 'a retry of the same night produces the same key');

  const nextNight = buildIdempotencyKey({
    sourceType: 'BED_DAY',
    sourceId: 42,
    idempotencySuffix: '2026-10-21',
  });

  assert(nextNight !== first, 'a different night is a different charge');

  /*
   * The key does not contain the ward, deliberately: the segments are
   * disjoint, so one date can only ever belong to one ward. Adding the
   * ward would make a re-run after a transfer look like a new charge.
   */
  const home = { id: 1, code: 'FMW001', name: 'General Ward', wardType: 'General' };
  const icu = { id: 2, code: 'ICU', name: 'ICU', wardType: 'ICU' };

  const segments = bedDaySegments({
    admissionDate: '2026-10-20',
    dischargeDate: '2026-10-22',
    homeWard: home,
    transfers: [{ toWardId: 2, transferredAt: '2026-10-21T14:00:00', ward: icu }],
  });

  const keys = segments.flatMap((segment) =>
    segment.dates.map((date) =>
      buildIdempotencyKey({
        sourceType: 'BED_DAY',
        sourceId: 42,
        idempotencySuffix: date,
      }),
    ),
  );

  assertEqual(new Set(keys).size, keys.length, 'each night has exactly one key');
  assertEqual(keys.length, 3, 'a three-night stay is three charges');

  /*
   * The amount is the tariff times the nights — 1,500 a day, not a
   * flat fee and not a doubled one.
   */
  const nights = bedDayDates('2026-10-20', '2026-10-22').length;

  assertEqual(nights, 3, 'three nights');
  assertEqual(toCents(IP_002.fee) * nights, 450000, 'three nights at 1,500 is 4,500.00');

  console.log('  ✓ One key per night; retries cannot duplicate a charge');
}

/* ============================================================
   7. THE UNPRICED NIGHT CAN BE REPROCESSED AFTER CONFIGURATION
   ============================================================ */

function testUnpricedNightIsRecoverable(): void {
  /*
   * What the queue stores when a night cannot be priced: the night's
   * date, and the bed category it was accrued in. Without both, fixing
   * the price list could only ever bill one night, or could bill the
   * wrong category.
   */
  const row: ChargeAttemptRow = {
    id: 77,
    patientId: 5,
    facilityId: 3,
    encounterId: 19,
    sourceType: 'BED_DAY',
    sourceId: 42,
    itemType: 'Inpatient',
    description: 'General Ward bed — 2026-10-20',
    codes: bedDayTariffCodes('FMW001'),
    serviceKeys: ['BED_DAY:FMW001'],
    family: 'BED_DAY',
    serviceName: 'bed day',
    encounterType: null,
    aliases: [],
    idempotencySuffix: '2026-10-20',
    wardType: 'General',
    wardName: 'General Ward',
    quantity: 1,
    fallbackUnitPrice: null,
    reason: 'TARIFF_NOT_CONFIGURED',
    detail: 'No active tariff matched BED-FMW001, WARD-FMW001, BED-DAY…',
    codesTried: bedDayTariffCodes('FMW001'),
    status: 'PENDING',
    attempts: 1,
    lastAttemptAt: new Date('2026-10-21T09:00:00Z'),
    resolvedItemId: null,
    resolvedInvoiceId: null,
    resolvedTariffCode: null,
    resolvedUnitPrice: null,
    resolvedAt: null,
    createdAt: new Date('2026-10-21T09:00:00Z'),
  };

  const request = toChargeRequest(row, 1);

  assertEqual(
    request.idempotencySuffix,
    '2026-10-20',
    'the replay knows which night it is billing',
  );
  assertEqual(request.wardType, 'General', 'and which bed category');
  assertEqual(request.wardName, 'General Ward', 'and which ward');
  assertEqual(request.family, 'BED_DAY', 'as a bed-day charge');
  assertEqual(request.sourceId, 42, 'against the same admission');
  assertEqual(
    buildIdempotencyKey(request),
    buildIdempotencyKey({
      sourceType: 'BED_DAY',
      sourceId: 42,
      idempotencySuffix: '2026-10-20',
    }),
    'the replay reuses the original key, so a night billed meanwhile is a duplicate',
  );

  /*
   * Configure IP-002 and the stored request prices — through the same
   * resolver, with no new engine and no price change.
   */
  const replayed = resolveFromRows({
    serviceType: 'BED_DAY',
    codes: request.codes,
    serviceKeys: request.serviceKeys,
    family: 'BED_DAY',
    phrases: phrasesForCharge({
      family: 'BED_DAY',
      wardType: request.wardType,
      wardName: request.wardName,
    }),
    wardType: request.wardType,
    links: [],
    tariffs: priceList,
    today: TODAY,
  });

  assertEqual(replayed.tariff?.code, 'IP-002', 'the replay now bills the night');
  assertEqual(replayed.tariff?.fee, '1500.00', 'at the configured rate');

  /*
   * The columns exist on the table and in the migration, so a deployed
   * database can store what the replay needs.
   */
  assert(
    schema.billingChargeAttempts.idempotencySuffix !== undefined,
    'billing_charge_attempts stores the night',
  );
  assert(
    schema.billingChargeAttempts.wardType !== undefined,
    'billing_charge_attempts stores the bed category',
  );

  const migration = source('drizzle/0022_bed_day_charge_attempts.sql');

  assert(migration.includes('"idempotency_suffix"'), 'migration 0022 adds the night column');
  assert(
    migration.includes('coalesce("idempotency_suffix", \'\')'),
    'and keeps one open row per charge for non-night charges',
  );

  const attempts = source('src/billing/charge-attempts.ts');

  assert(
    attempts.includes('idempotencySuffix: suffix') &&
      attempts.includes('request.idempotencySuffix'),
    'the skipped night is recorded with its date',
  );
  assert(
    attempts.includes('wardType: request.wardType ?? null'),
    'and with the bed category it was accrued in',
  );
  assert(
    attempts.includes('supportsBedNightIdentity'),
    'a database without migration 0022 keeps recording skips',
  );
  assert(
    attempts.includes(
      '...(row.idempotencySuffix ? { idempotencySuffix: row.idempotencySuffix } : {})',
    ),
    'and replayed with it',
  );

  console.log('  ✓ An unpriced night is reprocessable after configuration');
}

/* ============================================================
   8. ONE ENGINE: DISCHARGE, TRANSFER AND THE NIGHTLY JOB
   ============================================================ */

function testOneBedDayEngine(): void {
  const app = source('src/app.ts');
  const queries = source('src/db/queries.ts');
  const resolver = source('src/billing/tariff-resolver.ts');

  const dischargeRoute = app.slice(
    app.indexOf("'/api/admissions/:id/discharge'"),
    app.indexOf("'/api/admissions/:id/transfer'"),
  );

  assert(
    dischargeRoute.includes('queries.accrueBedDaysScoped('),
    'discharge bills through the shared accrual',
  );
  assert(!dischargeRoute.includes("family: 'BED_DAY'"), 'discharge has no bed-day loop of its own');
  assert(
    dischargeRoute.indexOf('dischargeAdmissionScoped') <
      dischargeRoute.indexOf('accrueBedDaysScoped'),
    'the discharge is committed before any billing runs',
  );
  assert(
    dischargeRoute.includes('bedDays: accrual.charges'),
    'the discharge response reports each night, priced or not',
  );

  const transferRoute = app.slice(
    app.indexOf("'/api/admissions/:id/transfer'"),
    app.indexOf("'/api/admissions/:id/transfers'"),
  );

  assert(
    transferRoute.includes('queries.accrueBedDaysScoped('),
    'transfer bills through the same accrual',
  );

  const accrual = queries.slice(
    queries.indexOf('export async function accrueBedDaysScoped'),
    queries.indexOf('/* Bed-night tariff code precedence'),
  );

  assert(accrual.includes('bedDaySegments({'), 'the accrual prices by occupancy segment');
  assert(
    accrual.includes('chargeAndRecord(db,'),
    'a missing tariff is recorded for reprocessing, not thrown',
  );
  assert(accrual.includes("family: 'BED_DAY'"), 'the night is charged as a bed-day');
  assert(
    accrual.includes('wardType: ward?.wardType ?? null'),
    'the bed category reaches the resolver',
  );
  assert(accrual.includes('idempotencySuffix: date'), 'each night keeps its date in the key');
  assert(accrual.includes('sourceId: admission.id'), 'the charge stays attached to the admission');
  assert(
    accrual.includes('encounterId: admission.encounterId ?? null'),
    'and to the encounter when there is one',
  );
  assert(
    !accrual.includes('.insert(schema.admissionTransfers)'),
    'billing never creates an occupancy event',
  );
  assert(!accrual.includes('.insert(schema.admissions)'), 'and never re-admits the patient');

  /*
   * Facility isolation: the resolver loads this facility's rows only,
   * which is what keeps another branch's price out of this invoice.
   */
  assert(
    resolver.includes('const where = eq(schema.facilityServiceTariffs.facilityId, facilityId);'),
    'the resolver loads one facility’s price list',
  );
  assert(
    accrual.includes('facilityId: admission.facilityId'),
    'the night is billed to the admitting facility',
  );
  assert(
    accrual.includes('patientId: admission.patientId'),
    'and to the patient who occupied the bed',
  );

  console.log('  ✓ Discharge, transfer and the nightly job share one engine');
}

/* ============================================================
   9. LABORATORY AND OPD BILLING ARE UNCHANGED
   ============================================================ */

function testOtherFamiliesStillBill(): void {
  const labRow = tariff(201, 'LAB-001', 'Malaria rapid diagnostic test', '300.00', 'Test', {
    department: 'laboratory',
  });

  const lab = resolveFromRows({
    serviceType: 'LAB_TEST',
    codes: codesForFamily({ family: 'LABORATORY', name: 'Malaria rapid diagnostic test' }),
    serviceKeys: billingServiceKeys('LABORATORY', ['LAB-001']),
    family: 'LABORATORY',
    phrases: phrasesForCharge({
      family: 'LABORATORY',
      serviceName: 'Malaria rapid diagnostic test',
    }),
    links: [],
    tariffs: [labRow],
    today: TODAY,
  });

  assertEqual(lab.tariff?.code, 'LAB-001', 'a laboratory test still bills');
  assertEqual(lab.tariff?.fee, '300.00', 'at its existing fee');

  const opdRow = tariff(301, 'OPD-001', 'General consultation', '150.00', 'Visit', {
    department: 'opd',
  });

  const opd = resolveFromRows({
    serviceType: 'CONSULTATION',
    codes: codesForFamily({ family: 'CONSULTATION', encounterType: 'OUTPATIENT' }),
    serviceKeys: billingServiceKeys('CONSULTATION'),
    family: 'CONSULTATION',
    phrases: phrasesForCharge({
      family: 'CONSULTATION',
      encounterType: 'OUTPATIENT',
    }),
    links: [],
    tariffs: [opdRow],
    today: TODAY,
  });

  assertEqual(opd.tariff?.code, 'OPD-001', 'an OPD consultation still bills');
  assertEqual(opd.tariff?.fee, '150.00', 'at its existing fee');

  /*
   * The new bed-day vocabulary is not offered to another family: a ward
   * name must never become a consultation phrase.
   */
  const consultationPhrases = phrasesForCharge({
    family: 'CONSULTATION',
    encounterType: 'OUTPATIENT',
    wardName: 'General Ward',
    wardType: 'General',
  });

  assert(
    !consultationPhrases.includes('general ward bed charge'),
    'bed-day words never leak into a consultation',
  );

  console.log('  ✓ Laboratory and OPD billing are unchanged');
}

/* ============================================================
   RUN
   ============================================================ */

function run(): void {
  console.log('');
  console.log('==============================================');
  console.log('WARD / BED BILLING TESTS');
  console.log('==============================================');
  console.log('');

  testTheReportedCodes();
  testGeneralBedResolvesToTheExistingTariff();
  testAdmissionAndBedDayNeverSwap();
  testSpecialBedsAreNotPricedAtTheGeneralRate();
  testBedDayPeriods();
  testOneKeyPerNight();
  testUnpricedNightIsRecoverable();
  testOneBedDayEngine();
  testOtherFamiliesStillBill();

  console.log('');
  console.log('==============================================');
  console.log(`WARD BILLING TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

try {
  run();
} catch (error) {
  console.error('');
  console.error('==============================================');
  console.error('WARD BILLING TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
}
