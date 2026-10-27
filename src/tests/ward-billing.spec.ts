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

import { describe, expect, it } from 'vitest';
import { queriesSource } from './support/schema-source.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

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

const IP_001 = tariff(1, 'IP-001', 'Inpatient admission administration', '500.00', 'Admission');

const IP_002 = tariff(2, 'IP-002', 'General ward bed charge', '1500.00', 'Per day');

const priceList = [IP_001, IP_002];

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

describe('Inpatient ward billing — the discharge that billed the bed at nothing', () => {
  it('1. THE REPORTED FAILURE, REPRODUCED', async () => {
    /*
     * The exact six codes from the warning. The first four words of the
     * message were a symptom of the engine reading the ward's name and
     * generating candidates from it — correct — while never describing
     * the charge in the words the price list uses.
     */
    expect(
      JSON.stringify(bedDayTariffCodes('FMW001')),
      'the six candidates in the reported warning are unchanged',
    ).toBe(
      JSON.stringify([
        'BED-FMW001',
        'WARD-FMW001',
        'BED-DAY',
        'INPATIENT-BED-DAY',
        'WARD-DAY',
        'BED',
      ]),
    );

    /*
     * Before this round the bed-day family had no vocabulary of its own:
     * the only phrase was the service name. "bed day" does not describe
     * "General ward bed charge", so IP-002 was never seen.
     */
    const oldVocabulary = resolveFromRows(bedDay({ phrases: ['bed day'] }));

    expect(JSON.stringify(oldVocabulary.tariff), 'the old vocabulary priced nothing').toBe(
      JSON.stringify(null),
    );
    expect(
      JSON.stringify(oldVocabulary.failure?.code),
      'and reported it as no tariff — the reported warning',
    ).toBe(JSON.stringify('NO_TARIFF'));
    expect(
      oldVocabulary.failure?.message?.includes('IP-002') === false,
      'without naming the row that would have priced it',
    ).toBe(true);

    /* The candidates were tried; the row was never described. */
    expect(JSON.stringify(oldVocabulary.codesTried), 'every candidate code was tried').toBe(
      JSON.stringify(bedDayTariffCodes('FMW001')),
    );
    expect(
      (oldVocabulary.phrasesTried ?? []).length === 1,
      'and exactly one phrase, which could not match the price list',
    ).toBe(true);
  });

  it('2. A GENERAL BED PRICES FROM THE EXISTING IP-002 ROW', async () => {
    const resolution = resolveFromRows(bedDay({}));

    expect(resolution.failure === null, 'the general ward bed resolves').toBe(true);
    expect(JSON.stringify(resolution.tariff?.code), 'it is priced by IP-002').toBe(
      JSON.stringify('IP-002'),
    );
    expect(
      JSON.stringify(resolution.tariff?.fee),
      'at the existing 1,500 a day — no price was changed',
    ).toBe(JSON.stringify('1500.00'));
    expect(JSON.stringify(resolution.tariff?.unit), 'with its per-day unit').toBe(
      JSON.stringify('Per day'),
    );
    expect(
      JSON.stringify(resolution.rule),
      'found by the facility’s own description, not by a new code',
    ).toBe(JSON.stringify('CATALOGUE'));
    expect(
      JSON.stringify(resolution.phrasesTried[0]),
      'the exact words on the price list are offered first',
    ).toBe(JSON.stringify('general ward bed charge'));

    /*
     * The phrase the engine now offers is the row's own text. That is why
     * no tariff had to be added: the mapping was missing, not the row.
     */
    expect(
      resolution.phrasesTried.includes('general ward bed charge'),
      'the general-bed vocabulary includes the price-list wording',
    ).toBe(true);
    expect(
      resolution.phrasesTried.includes('bed day'),
      'and keeps the generic bed-day wording beneath it',
    ).toBe(true);
  });

  it('3. THE NIGHTLY RATE AND THE ONE-OFF ADMISSION FEE', async () => {
    /*
     * IP-001 is charged once when the patient is admitted. It must not be
     * reachable from a night: 500 repeated for a week is a wrong bill.
     */
    const bedDayAgainstAdmissionTariff = resolveFromRows(
      bedDay({ tariffs: [IP_001], links: [link(1)] }),
    );

    expect(
      JSON.stringify(bedDayAgainstAdmissionTariff.tariff),
      'IP-001 cannot price a bed-night',
    ).toBe(JSON.stringify(null));
    expect(
      JSON.stringify(bedDayAgainstAdmissionTariff.failure?.code),
      'the per-admission unit is refused for a night, not billed at 500',
    ).toBe(JSON.stringify('UNIT_INCOMPATIBLE'));

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

    expect(JSON.stringify(admission.tariff?.code), 'the admission fee resolves to IP-001').toBe(
      JSON.stringify('IP-001'),
    );
    expect(JSON.stringify(admission.tariff?.fee), 'at its existing 500').toBe(
      JSON.stringify('500.00'),
    );
    expect(
      JSON.stringify(admission.rule),
      'by its own words, never by the bed-day vocabulary',
    ).toBe(JSON.stringify('CATALOGUE'));

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

    expect(
      JSON.stringify(admissionAgainstBedTariff.tariff),
      'IP-002 cannot price the admission fee',
    ).toBe(JSON.stringify(null));
    expect(
      JSON.stringify(admissionAgainstBedTariff.failure?.code),
      'a per-day row is refused for a one-off admission charge',
    ).toBe(JSON.stringify('UNIT_INCOMPATIBLE'));

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

    expect(
      !admissionRoute.includes('aliases: [ward?.name'),
      'the admission fee does not offer the ward name as a phrase',
    ).toBe(true);
  });

  it('4. A SPECIAL BED IS REPORTED, NEVER PADDED AT THE GENERAL RATE', async () => {
    const icu = resolveFromRows(bedDay({ wardCode: 'ICU', wardName: 'ICU', wardType: 'ICU' }));

    expect(JSON.stringify(icu.tariff), 'an ICU night is not priced by the general row').toBe(
      JSON.stringify(null),
    );
    expect(JSON.stringify(icu.failure?.code), 'it is reported as unconfigured').toBe(
      JSON.stringify('NO_TARIFF'),
    );
    expect(icu.phrasesTried.includes('icu bed charge'), 'the ICU vocabulary is tried').toBe(true);
    expect(
      !icu.phrasesTried.includes('general ward bed charge'),
      'the general vocabulary is never offered to an ICU bed',
    ).toBe(true);

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

    expect(
      JSON.stringify(withFamilyLink.tariff),
      'a family-wide bed-day link does not price an ICU bed',
    ).toBe(JSON.stringify(null));
    expect(JSON.stringify(withFamilyLink.failure?.code), 'the night is reported').toBe(
      JSON.stringify('NO_TARIFF'),
    );

    const explanation = withFamilyLink.rows.find((row) => row.tariff.id === 2);

    expect(
      explanation?.note.includes('family-wide bed-day link') === true,
      'the screen explains why the general link was skipped',
    ).toBe(true);

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

    expect(JSON.stringify(wardLinked.tariff?.code), 'a ward-specific link prices that ward').toBe(
      JSON.stringify('IP-002'),
    );
    expect(JSON.stringify(wardLinked.rule), 'by explicit link, not by a guess').toBe(
      JSON.stringify('LINK'),
    );

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

    expect(JSON.stringify(icuPriced.tariff?.code), 'an ICU row prices the ICU night').toBe(
      JSON.stringify('BED-ICU'),
    );
    expect(JSON.stringify(icuPriced.tariff?.fee), 'at the ICU rate, not 1,500').toBe(
      JSON.stringify('5000.00'),
    );
    expect(JSON.stringify(icuPriced.rule), 'by its exact ward code').toBe(JSON.stringify('CODE'));

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

    expect(
      JSON.stringify(misfiled.tariff),
      'a bed-day row outside the inpatient department is not selected',
    ).toBe(JSON.stringify(null));
  });

  it('5. BED-DAY MATH: STAYS, TRANSFERS AND DISCHARGE', async () => {
    /*
     * The existing rule, unchanged: admission date to discharge date
     * inclusive, and a same-day stay is one day. This round fixes the
     * mapping, not the counting.
     */
    const stay = bedDayDates('2026-10-20', '2026-10-22');

    expect(JSON.stringify(stay), 'three nights').toBe(
      JSON.stringify(['2026-10-20', '2026-10-21', '2026-10-22']),
    );
    expect(
      JSON.stringify(bedDayDates('2026-10-20 09:00', '2026-10-20 18:00').length),
      'a same-day stay is one night',
    ).toBe(JSON.stringify(1));

    const home = { id: 1, code: 'FMW001', name: 'General Ward', wardType: 'General' };
    const icu = { id: 2, code: 'ICU', name: 'ICU', wardType: 'ICU' };

    /* No transfer: one segment covering the whole stay. */
    const plain = bedDaySegments({
      admissionDate: '2026-10-20',
      dischargeDate: '2026-10-22',
      homeWard: home,
    });

    expect(JSON.stringify(plain.length), 'a stay without transfers is one segment').toBe(
      JSON.stringify(1),
    );
    expect(JSON.stringify(plain[0].dates), 'covering every night').toBe(JSON.stringify(stay));
    expect(JSON.stringify(plain[0].ward?.id), 'at the admission ward').toBe(JSON.stringify(1));

    /* A transfer on the 21st: the 20th stays with the old ward. */
    const transferred = bedDaySegments({
      admissionDate: '2026-10-20',
      dischargeDate: '2026-10-22',
      homeWard: home,
      transfers: [{ toWardId: 2, transferredAt: '2026-10-21T14:30:00', ward: icu }],
    });

    expect(JSON.stringify(transferred.length), 'the stay splits at the transfer').toBe(
      JSON.stringify(2),
    );
    expect(
      JSON.stringify(transferred[0].dates),
      'the night before the move stays on the old ward',
    ).toBe(JSON.stringify(['2026-10-20']));
    expect(JSON.stringify(transferred[0].ward?.code), 'at the general rate').toBe(
      JSON.stringify('FMW001'),
    );
    expect(
      JSON.stringify(transferred[1].dates),
      'the transfer date and after belong to the new ward',
    ).toBe(JSON.stringify(['2026-10-21', '2026-10-22']));
    expect(JSON.stringify(transferred[1].ward?.code), 'at the ICU rate').toBe(
      JSON.stringify('ICU'),
    );

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

    expect(
      JSON.stringify(afterTheMove[0].ward?.code),
      'the opening ward is the transfer’s origin, not the current ward',
    ).toBe(JSON.stringify('FMW001'));
    expect(
      JSON.stringify(afterTheMove[0].dates),
      'so the first night keeps the general rate after a move to ICU',
    ).toBe(JSON.stringify(['2026-10-20']));

    /*
     * The invariant that makes the invoice safe: every night appears
     * exactly once across the segments, and the total is the stay length.
     * No overlap means two wards cannot claim one date; no gap means no
     * night is free.
     */
    const all = transferred.flatMap((segment) => segment.dates);

    expect(JSON.stringify(all.length), 'the total number of nights is unchanged').toBe(
      JSON.stringify(stay.length),
    );
    expect(JSON.stringify(new Set(all).size), 'no night is billed twice').toBe(
      JSON.stringify(all.length),
    );
    expect(JSON.stringify([...all].sort()), 'and no night is missed').toBe(
      JSON.stringify([...stay]),
    );

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

    expect(
      JSON.stringify(twice.map((segment) => segment.dates)),
      'each move starts a new segment on its own date',
    ).toBe(JSON.stringify([['2026-10-20'], ['2026-10-21', '2026-10-22'], ['2026-10-23']]));

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

    expect(
      JSON.stringify(sameDay.flatMap((segment) => segment.dates)),
      'two moves on one date still bill each night once',
    ).toBe(JSON.stringify(stay));
    expect(
      JSON.stringify(sameDay[sameDay.length - 1].ward?.id),
      'the ward the patient ended the day in holds the night',
    ).toBe(JSON.stringify(1));

    /* Leaving on the transfer day. */
    const leaveOnTransfer = bedDaySegments({
      admissionDate: '2026-10-20',
      dischargeDate: '2026-10-21',
      homeWard: home,
      transfers: [{ toWardId: 2, transferredAt: '2026-10-21T10:00:00', ward: icu }],
    });

    expect(
      JSON.stringify(leaveOnTransfer.map((segment) => segment.dates)),
      'the discharge day is billed to the ward that held it',
    ).toBe(JSON.stringify([['2026-10-20'], ['2026-10-21']]));

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

    expect(
      JSON.stringify(yesterday.flatMap((segment) => segment.dates)),
      'a partial run stops at its date',
    ).toBe(JSON.stringify(['2026-10-20', '2026-10-21']));
    expect(
      JSON.stringify(yesterday.every((segment) => segment.ward?.id === 1)),
      'and is priced at the ward the patient was in then',
    ).toBe(JSON.stringify(true));

    /* Never past the discharge, even when asked for a later date. */
    const capped = bedDaySegments({
      admissionDate: '2026-10-20',
      dischargeDate: '2026-10-21',
      untilDate: '2026-10-31',
      homeWard: home,
    });

    expect(
      JSON.stringify(capped.flatMap((segment) => segment.dates)),
      'the discharge closes the period',
    ).toBe(JSON.stringify(['2026-10-20', '2026-10-21']));

    /* An unparseable admission date bills nothing rather than guessing. */
    expect(
      JSON.stringify(bedDaySegments({ admissionDate: '', homeWard: home })),
      'a broken admission date yields no charges',
    ).toBe(JSON.stringify([]));
  });

  it('6. ONE KEY PER NIGHT — RETRIES CANNOT DUPLICATE', async () => {
    const first = buildIdempotencyKey({
      sourceType: 'BED_DAY',
      sourceId: 42,
      idempotencySuffix: '2026-10-20',
    });

    expect(JSON.stringify(first), 'the night has one stable key').toBe(
      JSON.stringify('BED_DAY:42:2026-10-20'),
    );

    const retry = buildIdempotencyKey({
      sourceType: 'BED_DAY',
      sourceId: 42,
      idempotencySuffix: '2026-10-20',
    });

    expect(JSON.stringify(retry), 'a retry of the same night produces the same key').toBe(
      JSON.stringify(first),
    );

    const nextNight = buildIdempotencyKey({
      sourceType: 'BED_DAY',
      sourceId: 42,
      idempotencySuffix: '2026-10-21',
    });

    expect(nextNight !== first, 'a different night is a different charge').toBe(true);

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

    expect(JSON.stringify(new Set(keys).size), 'each night has exactly one key').toBe(
      JSON.stringify(keys.length),
    );
    expect(JSON.stringify(keys.length), 'a three-night stay is three charges').toBe(
      JSON.stringify(3),
    );

    /*
     * The amount is the tariff times the nights — 1,500 a day, not a
     * flat fee and not a doubled one.
     */
    const nights = bedDayDates('2026-10-20', '2026-10-22').length;

    expect(JSON.stringify(nights), 'three nights').toBe(JSON.stringify(3));
    expect(JSON.stringify(toCents(IP_002.fee) * nights), 'three nights at 1,500 is 4,500.00').toBe(
      JSON.stringify(450000),
    );
  });

  it('7. THE UNPRICED NIGHT CAN BE REPROCESSED AFTER CONFIGURATION', async () => {
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

    expect(
      JSON.stringify(request.idempotencySuffix),
      'the replay knows which night it is billing',
    ).toBe(JSON.stringify('2026-10-20'));
    expect(JSON.stringify(request.wardType), 'and which bed category').toBe(
      JSON.stringify('General'),
    );
    expect(JSON.stringify(request.wardName), 'and which ward').toBe(JSON.stringify('General Ward'));
    expect(JSON.stringify(request.family), 'as a bed-day charge').toBe(JSON.stringify('BED_DAY'));
    expect(JSON.stringify(request.sourceId), 'against the same admission').toBe(JSON.stringify(42));
    expect(
      JSON.stringify(buildIdempotencyKey(request)),
      'the replay reuses the original key, so a night billed meanwhile is a duplicate',
    ).toBe(
      JSON.stringify(
        buildIdempotencyKey({
          sourceType: 'BED_DAY',
          sourceId: 42,
          idempotencySuffix: '2026-10-20',
        }),
      ),
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

    expect(JSON.stringify(replayed.tariff?.code), 'the replay now bills the night').toBe(
      JSON.stringify('IP-002'),
    );
    expect(JSON.stringify(replayed.tariff?.fee), 'at the configured rate').toBe(
      JSON.stringify('1500.00'),
    );

    /*
     * The columns exist on the table and in the migration, so a deployed
     * database can store what the replay needs.
     */
    expect(
      schema.billingChargeAttempts.idempotencySuffix !== undefined,
      'billing_charge_attempts stores the night',
    ).toBe(true);
    expect(
      schema.billingChargeAttempts.wardType !== undefined,
      'billing_charge_attempts stores the bed category',
    ).toBe(true);

    const migration = source('drizzle/0022_bed_day_charge_attempts.sql');

    expect(migration.includes('"idempotency_suffix"'), 'migration 0022 adds the night column').toBe(
      true,
    );
    expect(
      migration.includes('coalesce("idempotency_suffix", \'\')'),
      'and keeps one open row per charge for non-night charges',
    ).toBe(true);

    const attempts = source('src/billing/charge-attempts.ts');

    expect(
      attempts.includes('idempotencySuffix: suffix') &&
        attempts.includes('request.idempotencySuffix'),
      'the skipped night is recorded with its date',
    ).toBe(true);
    expect(
      attempts.includes('wardType: request.wardType ?? null'),
      'and with the bed category it was accrued in',
    ).toBe(true);
    expect(
      attempts.includes('supportsBedNightIdentity'),
      'a database without migration 0022 keeps recording skips',
    ).toBe(true);
    expect(
      attempts.includes(
        '...(row.idempotencySuffix ? { idempotencySuffix: row.idempotencySuffix } : {})',
      ),
      'and replayed with it',
    ).toBe(true);
  });

  it('8. ONE ENGINE: DISCHARGE, TRANSFER AND THE NIGHTLY JOB', async () => {
    /*
     * The discharge and transfer handlers moved out of app.ts into the
     * inpatient router. They are read from there now; reading app.ts would
     * find neither route and the slice below would silently be empty, which
     * would make every assertion in this function vacuous. The claims are
     * unchanged.
     */
    const app = source('src/routes/inpatient.routes.ts');
    const queries = queriesSource();
    const resolver = source('src/billing/tariff-resolver.ts');

    const dischargeRoute = app.slice(
      app.indexOf("'/admissions/:id/discharge'"),
      app.indexOf("'/admissions/:id/transfer'"),
    );

    expect(dischargeRoute.length > 100, 'the discharge route was found, not an empty slice').toBe(
      true,
    );

    expect(
      dischargeRoute.includes('queries.accrueBedDaysScoped('),
      'discharge bills through the shared accrual',
    ).toBe(true);
    expect(
      !dischargeRoute.includes("family: 'BED_DAY'"),
      'discharge has no bed-day loop of its own',
    ).toBe(true);
    expect(
      dischargeRoute.indexOf('dischargeAdmissionScoped') <
        dischargeRoute.indexOf('accrueBedDaysScoped'),
      'the discharge is committed before any billing runs',
    ).toBe(true);
    expect(
      dischargeRoute.includes('bedDays: accrual.charges'),
      'the discharge response reports each night, priced or not',
    ).toBe(true);

    const transferRoute = app.slice(
      app.indexOf("'/admissions/:id/transfer'"),
      app.indexOf("'/admissions/:id/transfers'"),
    );

    expect(
      transferRoute.includes('queries.accrueBedDaysScoped('),
      'transfer bills through the same accrual',
    ).toBe(true);

    const accrual = queries.slice(
      queries.indexOf('export async function accrueBedDaysScoped'),
      queries.indexOf('/* Bed-night tariff code precedence'),
    );

    expect(accrual.includes('bedDaySegments({'), 'the accrual prices by occupancy segment').toBe(
      true,
    );
    expect(
      accrual.includes('chargeAndRecord(db,'),
      'a missing tariff is recorded for reprocessing, not thrown',
    ).toBe(true);
    expect(accrual.includes("family: 'BED_DAY'"), 'the night is charged as a bed-day').toBe(true);
    expect(
      accrual.includes('wardType: ward?.wardType ?? null'),
      'the bed category reaches the resolver',
    ).toBe(true);
    expect(
      accrual.includes('idempotencySuffix: date'),
      'each night keeps its date in the key',
    ).toBe(true);
    expect(
      accrual.includes('sourceId: admission.id'),
      'the charge stays attached to the admission',
    ).toBe(true);
    expect(
      accrual.includes('encounterId: admission.encounterId ?? null'),
      'and to the encounter when there is one',
    ).toBe(true);
    expect(
      !accrual.includes('.insert(schema.admissionTransfers)'),
      'billing never creates an occupancy event',
    ).toBe(true);
    expect(!accrual.includes('.insert(schema.admissions)'), 'and never re-admits the patient').toBe(
      true,
    );

    /*
     * Facility isolation: the resolver loads this facility's rows only,
     * which is what keeps another branch's price out of this invoice.
     */
    expect(
      resolver.includes('const where = eq(schema.facilityServiceTariffs.facilityId, facilityId);'),
      'the resolver loads one facility’s price list',
    ).toBe(true);
    expect(
      accrual.includes('facilityId: admission.facilityId'),
      'the night is billed to the admitting facility',
    ).toBe(true);
    expect(
      accrual.includes('patientId: admission.patientId'),
      'and to the patient who occupied the bed',
    ).toBe(true);
  });

  it('9. LABORATORY AND OPD BILLING ARE UNCHANGED', async () => {
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

    expect(JSON.stringify(lab.tariff?.code), 'a laboratory test still bills').toBe(
      JSON.stringify('LAB-001'),
    );
    expect(JSON.stringify(lab.tariff?.fee), 'at its existing fee').toBe(JSON.stringify('300.00'));

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

    expect(JSON.stringify(opd.tariff?.code), 'an OPD consultation still bills').toBe(
      JSON.stringify('OPD-001'),
    );
    expect(JSON.stringify(opd.tariff?.fee), 'at its existing fee').toBe(JSON.stringify('150.00'));

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

    expect(
      !consultationPhrases.includes('general ward bed charge'),
      'bed-day words never leak into a consultation',
    ).toBe(true);
  });
});
