import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  labOrderChargeRequest,
  radiologyChargeRequest,
  tariffCodeCandidates,
} from '../billing/service-charges.ts';
import { schemaSource, queriesSource, appSource } from './support/schema-source.ts';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

const root = resolve(here, '../..');

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

function squashed(haystack: string): string {
  return haystack.replace(/\s+/g, '');
}

function containsCode(haystack: string, needle: string): boolean {
  return squashed(haystack).includes(squashed(needle));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function routeBody(file: string, method: string, path: string): string | null {
  const inline = file.indexOf(`${method}('${path}'`);

  const multiline = new RegExp(`${escapeRegExp(method)}\\(\\s*'${escapeRegExp(path)}'`).exec(file);

  const start = Math.min(
    ...[inline, multiline ? multiline.index : -1].filter((index) => index >= 0),
  );

  if (!Number.isFinite(start)) return null;

  /* Routes now live on either `app` or a mounted router; stop at whichever
     handler declaration comes next. */
  const end = Math.min(
    ...['\n  app.', '\n  router.'].map((marker) => {
      const found = file.indexOf(marker, start);

      return found >= 0 ? found : Number.POSITIVE_INFINITY;
    }),
  );

  return file.slice(start, Number.isFinite(end) ? end : undefined);
}

describe('The outpatient journey — contract tests', () => {
  it('1. TARIFF CODE CANDIDATES', async () => {
    expect(
      JSON.stringify(tariffCodeCandidates('LAB', 'Complete blood count', ['LAB-GENERAL'])),
      'a test name becomes a LAB- code first',
    ).toBe(JSON.stringify(['LAB-COMPLETE-BLOOD-COUNT', 'COMPLETE-BLOOD-COUNT', 'LAB-GENERAL']));

    expect(
      JSON.stringify(tariffCodeCandidates('RAD', 'Chest X-ray', ['RADIOLOGY'])),
      'punctuation becomes dashes in radiology codes',
    ).toBe(JSON.stringify(['RAD-CHEST-X-RAY', 'CHEST-X-RAY', 'RADIOLOGY']));

    expect(
      JSON.stringify(tariffCodeCandidates('PROC', '  ', ['PROCEDURE'])),
      'a blank name leaves only the defaults',
    ).toBe(JSON.stringify(['PROCEDURE']));

    expect(
      JSON.stringify(tariffCodeCandidates('DRUG', 'paracetamol', ['DRUG', 'DRUG'])),
      'codes are upper-cased and de-duplicated',
    ).toBe(JSON.stringify(['DRUG-PARACETAMOL', 'PARACETAMOL', 'DRUG']));
  });

  it('2. THE LAB BATCH IS BILLED', async () => {
    const request = labOrderChargeRequest({
      id: 7,
      tenantId: 1,
      facilityId: 2,
      patientId: 3,
      encounterId: 4,
      testName: 'Complete blood count',
      testId: 11,
    });

    expect(request.sourceType, 'laboratory source type').toBe('LAB_ORDER');
    expect(request.sourceId, 'the order id keys the charge').toBe(7);
    expect(request.encounterId, 'the charge carries the encounter').toBe(4);
    expect(request.codes[0], 'the order name is tried first').toBe('LAB-COMPLETE-BLOOD-COUNT');

    /* The laboratory routes moved to src/routes/laboratory.routes.ts. */
    const app = source('src/routes/laboratory.routes.ts');
    const route = app.slice(
      app.indexOf("'/api/lab-orders/batch'"),
      app.indexOf("'/api/lab-orders',", app.indexOf("'/api/lab-orders/batch'")),
    );

    expect(
      route.includes('chargeLabOrderBatch(result.orders, db)'),
      'the batch route prices every order',
    ).toBe(true);
    expect(route.includes('billing: billed'), 'the batch route returns what was billed').toBe(true);
    expect(
      !route.includes("sourceType: 'LAB_ORDER'"),
      'the batch route does not re-implement the charge request inline',
    ).toBe(true);
  });

  it('3. RADIOLOGY PRICES FROM THE COLUMN THAT EXISTS', async () => {
    const schema = schemaSource();
    const radiologyTable = schema.slice(schema.indexOf('radiologyOrders = pgTable'));

    expect(
      radiologyTable.includes("procedureName: text('procedure_name')"),
      'radiology_orders has procedure_name',
    ).toBe(true);
    expect(
      !radiologyTable.slice(0, 1800).includes("testName: text('test_name')"),
      'radiology_orders has no test_name column',
    ).toBe(true);

    const request = radiologyChargeRequest({
      id: 9,
      tenantId: 1,
      facilityId: 2,
      patientId: 3,
      encounterId: null,
      procedureName: 'Chest X-ray',
    });

    expect(request.codes[0], 'radiology prices by procedure name').toBe('RAD-CHEST-X-RAY');
    expect(request.description, 'the line names the study').toBe('Chest X-ray');
    expect(request.encounterId, 'an order without an encounter is allowed').toBe(null);

    /* The radiology routes moved to src/routes/radiology.routes.ts. */
    const app = source('src/routes/radiology.routes.ts');
    /*
     * The route is matched by shape rather than by exact formatting: it
     * was reformatted onto several lines when the audit added permission
     * and scope guards, and this assertion is about the charge request,
     * not about where the line breaks fell.
     */
    const routeStart = app.search(/router\.post\(\s*'\/api\/radiology-orders'/);
    const routeEnd = app.search(/router\.put\(\s*'\/api\/radiology-orders\/:id\/report'/);

    const route = routeStart === -1 || routeEnd === -1 ? '' : app.slice(routeStart, routeEnd);

    expect(
      route.includes('radiologyChargeRequest'),
      'the radiology route uses the shared request',
    ).toBe(true);
    expect(!route.includes('testName'), 'the radiology route no longer looks for testName').toBe(
      true,
    );
  });

  it('4. THE BILL SURVIVES EVERY STAGE', async () => {
    const app = appSource();

    /*
     * Discharge moved to src/routes/inpatient.routes.ts with the inpatient
     * routes, so each stage names the file that now owns it. The claim is
     * unchanged: this endpoint charges this source type.
     */
    const inpatient = source('src/routes/inpatient.routes.ts');
    const diagnoses = source('src/routes/diagnoses.routes.ts');
    const radiology = source('src/routes/radiology.routes.ts');
    const pharmacy = source('src/routes/pharmacy.routes.ts');
    const serviceTariffs = source('src/routes/service-tariffs.routes.ts');

    const stages: Array<[string, string, string, string, string]> = [
      ["'/api/encounters'", 'CONSULTATION', app, 'router.post', '/api/encounters'],
      ["'/api/procedures'", 'PROCEDURE', diagnoses, 'router.post', '/api/procedures'],
      ["'/api/radiology-orders'", 'RADIOLOGY', radiology, 'router.post', '/api/radiology-orders'],
      ["'/api/pharmacy/dispense'", 'PHARMACY', pharmacy, 'router.post', '/api/pharmacy/dispense'],
      /* The router is mounted at /api, so it registers the path without it. */
      [
        "'/api/admissions/:id/discharge'",
        'BED_DAY',
        inpatient,
        'router.post',
        '/admissions/:id/discharge',
      ],
    ];

    for (const [route, sourceType, file, method, path] of stages) {
      const body = routeBody(file, method, path);

      expect(body !== null, `${route} exists`).toBe(true);

      expect(body!.includes(sourceType), `${sourceType} is charged by ${route}`).toBe(true);
    }

    /*
     * The one endpoint that cannot be checked by a literal is the lab
     * batch: its request is built in service-charges.ts.
     */
    const charges = source('src/billing/service-charges.ts');
    expect(charges.includes("sourceType: 'LAB_ORDER'"), 'laboratory charges are built once').toBe(
      true,
    );

    /*
     * A charge that cannot be priced must never stop the clinical act,
     * and the screen is told what happened.
     */
    const billing = source('src/billing/billing.service.ts');
    const matching = source('src/billing/tariff-matching.ts');
    expect(
      billing.includes("reason: 'TARIFF_NOT_CONFIGURED'"),
      'a missing tariff is reported, not invented',
    ).toBe(true);

    /*
     * The failure the tariff screen exists to prevent: a code that is
     * stored in one case and looked up in another bills nothing, silently.
     * Both ends are held here so neither can regress alone.
     */
    expect(
      matching.includes('codeKey(row.code) === upper'),
      'tariff lookup compares upper-cased codes',
    ).toBe(true);
    expect(
      billing.includes('summariseCodes(request.codes)') &&
        billing.includes('function summariseCodes'),
      'the failure names the codes that were tried, and counts the rest',
    ).toBe(true);

    /* The tariff validators moved to their own module; read them there. */
    const tariffs = source('src/routes/shared/tariffs.ts');
    const tariffInput = tariffs.slice(
      tariffs.indexOf('const validateTariffInput'),
      tariffs.indexOf('const facilityHasTariffModule'),
    );
    expect(
      tariffInput.includes('.trim().toUpperCase()'),
      'tariff codes are stored in capitals, whatever the caller sends',
    ).toBe(true);

    const panel = source('src/components/modules/FacilityServiceTariffsPanel.tsx');
    const validationPanel = source('src/components/modules/TariffValidationPanel.tsx');
    const validationService = source('src/billing/tariff-validation.service.ts');
    expect(
      panel.includes('TariffValidationPanel') &&
        validationPanel.includes('getFacilityTariffValidation') &&
        validationService.includes('resolveFromRows') &&
        validationService.includes("'NO_TARIFF'"),
      'the tariff screen exposes resolver-based missing and invalid configuration review',
    ).toBe(true);

    /*
     * Laboratory billing by catalogue code. The batch route carried only
     * the test name, so a facility that priced LAB-CBC — the code its own
     * catalogue shows — billed nothing for a full blood count.
     */
    /*
     * The candidate list moved to one place (`codesForFamily`) so the
     * charge, the diagnostic screen and this test cannot disagree. The
     * behaviour asserted here is unchanged: the charge asks for the
     * catalogue code first, because that is the code the facility sees in
     * its own laboratory catalogue.
     */
    expect(
      charges.includes('codesForFamily'),
      'the laboratory charge asks the shared rule for its candidates',
    ).toBe(true);
    expect(
      matching.includes('labTariffCodeCandidates({ code: input.code ?? null, name })'),
      'and that rule asks for the catalogue code',
    ).toBe(true);

    const queries = queriesSource();
    expect(
      queries.includes('orders.push({') && queries.includes('testCode: test.code'),
      'the batch carries each test code to the charging step',
    ).toBe(true);
    expect(
      queries.includes('testCode = test?.code ?? null'),
      'the single-order route resolves the code too',
    ).toBe(true);

    expect(
      containsCode(app, "codes: codesForFamily({ family: 'LABORATORY',"),
      'the one-by-one laboratory route prices like the batch does',
    ).toBe(true);

    expect(
      validationService.includes('input.labs') && validationPanel.includes('check.name'),
      'the tariff screen names the assessed laboratory tests',
    ).toBe(true);
    expect(
      validationService.includes('codesForFamily') && validationService.includes('resolveFromRows'),
      'the screen and the engine share the charging candidate and resolver rules',
    ).toBe(true);

    expect(
      containsCode(diagnoses, "codes: codesForFamily({ family: 'PROCEDURE',"),
      'a procedure is priced from its own code as well as its name',
    ).toBe(true);

    /*
     * The consultation that billed nothing because the facility numbered
     * its tariffs OPD-001. Every automatic charge now offers the link the
     * facility made on the tariff screen, and the engine tries it before
     * the codes.
     */
    /*
     * Each key is checked in the file that now owns its route. The delivery
     * moved to src/routes/maternal-health.routes.ts when the maternity and
     * immunisation routes were extracted from createApp, and the procedure
     * to src/routes/diagnoses.routes.ts when the diagnosis and procedure
     * routes followed. Naming the file per key keeps the assertion as tight
     * as it was, instead of loosening it to "somewhere in the sources".
     */
    for (const [label, key, file] of [
      [
        'the consultation',
        "billingServiceKeys('CONSULTATION'",
        'src/routes/domains/encounters.routes.ts',
      ],
      ['the admission', "billingServiceKeys('ADMISSION'", 'src/routes/inpatient.routes.ts'],
      ['the delivery', "billingServiceKeys('DELIVERY'", 'src/routes/maternal-health.routes.ts'],
      ['the prescription', "billingServiceKeys('PHARMACY'", 'src/routes/pharmacy.routes.ts'],
      ['the procedure', "billingServiceKeys('PROCEDURE'", 'src/routes/diagnoses.routes.ts'],
    ] as const) {
      expect(source(file).includes(key), `${label} offers a billing link`).toBe(true);
    }

    /*
     * The bed-day link moved with the bed-day engine: discharge, transfer
     * and the nightly job all charge from `accrueBedDaysScoped`, so that
     * is where the ward's link key has to be offered.
     */
    expect(
      queriesSource().includes("billingServiceKeys('BED_DAY'"),
      'the bed-day offers a billing link',
    ).toBe(true);

    expect(
      charges.includes("billingServiceKeys('LABORATORY'"),
      'a laboratory order offers a billing link',
    ).toBe(true);
    expect(
      charges.includes("billingServiceKeys('RADIOLOGY'"),
      'a radiology order offers a billing link',
    ).toBe(true);

    /*
     * The order is now one rule in one module: LINK → CODE → DESCRIPTION.
     * The assertion follows the code, so the guarantee survives the move:
     * a link the facility made still beats a code the engine guessed, and
     * both still beat a description match.
     */
    expect(
      billing.includes('resolveTariffForCharge(') &&
        matching.indexOf('/* ---- 1. Explicit link') < matching.indexOf('/* ---- 2. Exact code') &&
        matching.indexOf('/* ---- 2. Exact code') <
          matching.indexOf("/* ---- 3. The facility's own description"),
      'a link the facility made is tried before a code, and a code before a description',
    ).toBe(true);

    /*
     * A development database one migration behind must not turn every
     * charge into a 500.
     */
    expect(
      billing.includes("code === '42703'") && billing.includes('warnedMissingBillingKey'),
      'a database without migration 0019 degrades to code matching, once, with a warning',
    ).toBe(true);

    /* The write path stores the link, and refuses a duplicate. */
    expect(
      serviceTariffs.includes('billingKey: input.billingKey'),
      'the tariff write stores the link',
    ).toBe(true);
    expect(
      tariffs.includes('TARIFF_BILLING_KEY_TAKEN'),
      'two active tariffs cannot answer the same automatic charge',
    ).toBe(true);
    expect(
      tariffs.includes('TARIFF_MIGRATION_REQUIRED') && tariffs.includes('migrations 0019 and 0021'),
      'a database without the column says which migration is missing',
    ).toBe(true);
  });

  it('5. A VISIT CAN END', async () => {
    const queries = queriesSource();

    expect(
      queries.includes("safeData.status === 'Completed'"),
      'completing a visit is recognised',
    ).toBe(true);
    expect(
      queries.includes('safeData.endedAt = safeData.endedAt ?? new Date()'),
      'the server stamps the end time',
    ).toBe(true);

    const ui = source('src/components/modules/OutpatientModule.tsx');

    expect(ui.includes('handleCompleteVisit'), 'the OPD screen can end a visit').toBe(true);
    expect(ui.includes("status: 'Completed'"), 'it sends the completed status').toBe(true);
    expect(!ui.includes('endedAt'), 'it does not send a timestamp the server should own').toBe(
      true,
    );

    /*
     * The second visit must not reuse the first encounter: the consult
     * charge is keyed on the encounter, so reuse silently skips the fee.
     */
    expect(
      ui.includes('encs.find') || ui.includes("status === 'Active'"),
      'the screen only resumes an Active encounter',
    ).toBe(true);
  });

  it('6. IDENTIFIERS ARE ALLOCATED ON THE SERVER', async () => {
    const queries = queriesSource();

    expect(
      queries.includes('export async function nextPatientMrn'),
      'MRNs are allocated in the database layer',
    ).toBe(true);
    expect(
      queries.includes('export async function nextQueueToken'),
      'queue tokens are allocated in the database layer',
    ).toBe(true);
    expect(
      queries.includes('export class PatientMrnConflictError'),
      'a duplicate MRN has a named refusal',
    ).toBe(true);

    const registration = source('src/components/modules/PatientRegistrationModule.tsx');
    const opd = source('src/components/modules/OutpatientModule.tsx');

    expect(
      !registration.includes('Math.random()'),
      'the registration screen no longer invents an MRN or a token',
    ).toBe(true);
    expect(
      !opd.includes('Math.random()'),
      'the clinician screen no longer invents a pharmacy token',
    ).toBe(true);

    /* The API route turns the named refusal into 409, not 500. */
    const app = appSource();
    expect(
      app.includes('err instanceof queries.PatientMrnConflictError'),
      'a duplicate MRN answers 409',
    ).toBe(true);

    expect(
      registration.includes('triageEntry.tokenNumber'),
      'the registration receipt shows the token the server allocated',
    ).toBe(true);
  });

  it('7. THE QUEUE IS THE ROAD, NOT A WALL', async () => {
    /*
     * The queue routes moved to src/routes/queues.routes.ts. The unscoped
     * update must be absent from both files: checking only the one that holds
     * the routes today would go quiet the moment they move again.
     */
    const app = appSource();
    const queues = source('src/routes/queues.routes.ts');
    const pharmacy = source('src/routes/pharmacy.routes.ts');
    const serviceTariffs = source('src/routes/service-tariffs.routes.ts');
    const queries = queriesSource();
    const opd = source('src/components/modules/OutpatientModule.tsx');

    expect(
      queues.includes('queries.updateQueueStatusScoped'),
      'moving a token is scoped to the facility',
    ).toBe(true);
    for (const source_ of [app, queues]) {
      expect(
        !source_.includes('queries.updateQueueStatus('),
        'the unscoped update is gone from the routes',
      ).toBe(true);
    }
    expect(
      queries.includes('export async function completeQueueTokensForPatient'),
      'a served patient can have their token closed',
    ).toBe(true);
    expect(pharmacy.includes("'Pharmacy'"), 'dispensing closes the pharmacy token').toBe(true);

    expect(
      opd.includes("api.getQueues(currentFacility.id, 'Triage')"),
      'the clinician sees the triage queue',
    ).toBe(true);
    expect(opd.includes("'In-Progress'"), 'starting a visit moves the token').toBe(true);
    expect(opd.includes('Waiting in Triage'), 'the queue is visible on the OPD screen').toBe(true);
  });

  it('8. THE TARIFF SCREEN NAMES THE CODES', async () => {
    const panel = source('src/components/modules/FacilityServiceTariffsPanel.tsx');

    for (const code of ['OPD-CONSULT', 'LAB-', 'RAD-', 'PROC-', 'DRUG-', 'ADMISSION', 'BED-DAY']) {
      expect(panel.includes(code), `the tariff screen names ${code}`).toBe(true);
    }

    expect(
      panel.includes('service without a valid match is not automatically billed'),
      'it says that an unmatched service is not billed',
    ).toBe(true);
  });
});
