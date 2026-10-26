/**
 * JaliCare HMIS
 * The outpatient journey — contract tests
 *
 * These assert the wiring, not the money arithmetic (that is
 * billing-engine.test.ts) and not the database (the live check in the
 * README's §3.14 covers that). They exist because each of these was
 * broken in a way no screen complained about:
 *
 *   - the batch laboratory endpoint recorded orders and billed nothing
 *   - radiology read a column that does not exist
 *   - a visit could never be completed, so the next visit reused it
 *   - patient numbers and queue tokens were minted in the browser with
 *     Math.random()
 *
 * No database required.
 *
 * Run with: npx tsx src/tests/opd-journey.test.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  labOrderChargeRequest,
  radiologyChargeRequest,
  tariffCodeCandidates,
} from '../billing/service-charges.ts';
import { schemaSource } from './support/schema-source.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) {
    throw new Error(`FAILED: ${label}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(actual === expected, `${label} — expected ${String(expected)}, got ${String(actual)}`);
}

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

/**
 * Match code without caring how it is laid out.
 *
 * Several assertions below ask "does this call site pass family PROCEDURE?"
 * and were written against the exact indentation of src/app.ts. That makes
 * them a test of the formatter, not of the behaviour: re-indenting the file
 * breaks the assertion while deleting the argument it is supposed to guard
 * would still pass.
 *
 * Stripping whitespace from both the source and the needle keeps the claim
 * ("this route asks the shared rule, with this family") and drops the
 * column numbers. It is deliberately whitespace only - `contains` still
 * fails if the argument changes, which is the thing worth protecting.
 */
function squashed(haystack: string): string {
  return haystack.replace(/\s+/g, '');
}

function containsCode(haystack: string, needle: string): boolean {
  return squashed(haystack).includes(squashed(needle));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The body of one route, from its declaration to the next `app.` at
 * the same indentation.
 *
 * Routes are written both on one line and with the path on its own line, so
 * both forms are found. The multiline form accepts any indentation: matching
 * it against four spaces meant a reformat silently turned this helper into
 * `return null`, and every call site that treats null as "not found" would
 * then have asserted nothing.
 */
function routeBody(file: string, method: string, path: string): string | null {
  const inline = file.indexOf(`${method}('${path}'`);

  const multiline = new RegExp(`${escapeRegExp(method)}\\(\\s*'${escapeRegExp(path)}'`).exec(file);

  const start = Math.min(
    ...[inline, multiline ? multiline.index : -1].filter((index) => index >= 0),
  );

  if (!Number.isFinite(start)) return null;

  const end = file.indexOf('\n  app.', start);

  return file.slice(start, end > -1 ? end : undefined);
}

/* ============================================================
   1. TARIFF CODE CANDIDATES
   ============================================================ */

function testTariffCodes(): void {
  assertEqual(
    JSON.stringify(tariffCodeCandidates('LAB', 'Complete blood count', ['LAB-GENERAL'])),
    JSON.stringify(['LAB-COMPLETE-BLOOD-COUNT', 'COMPLETE-BLOOD-COUNT', 'LAB-GENERAL']),
    'a test name becomes a LAB- code first',
  );

  assertEqual(
    JSON.stringify(tariffCodeCandidates('RAD', 'Chest X-ray', ['RADIOLOGY'])),
    JSON.stringify(['RAD-CHEST-X-RAY', 'CHEST-X-RAY', 'RADIOLOGY']),
    'punctuation becomes dashes in radiology codes',
  );

  assertEqual(
    JSON.stringify(tariffCodeCandidates('PROC', '  ', ['PROCEDURE'])),
    JSON.stringify(['PROCEDURE']),
    'a blank name leaves only the defaults',
  );

  assertEqual(
    JSON.stringify(tariffCodeCandidates('DRUG', 'paracetamol', ['DRUG', 'DRUG'])),
    JSON.stringify(['DRUG-PARACETAMOL', 'PARACETAMOL', 'DRUG']),
    'codes are upper-cased and de-duplicated',
  );
}

/* ============================================================
   2. THE LAB BATCH IS BILLED
   ============================================================ */

function testLabBatch(): void {
  const request = labOrderChargeRequest({
    id: 7,
    tenantId: 1,
    facilityId: 2,
    patientId: 3,
    encounterId: 4,
    testName: 'Complete blood count',
    testId: 11,
  });

  assertEqual(request.sourceType, 'LAB_ORDER', 'laboratory source type');
  assertEqual(request.sourceId, 7, 'the order id keys the charge');
  assertEqual(request.encounterId, 4, 'the charge carries the encounter');
  assertEqual(request.codes[0], 'LAB-COMPLETE-BLOOD-COUNT', 'the order name is tried first');

  const app = source('src/app.ts');
  const route = app.slice(
    app.indexOf("'/api/lab-orders/batch'"),
    app.indexOf("'/api/lab-orders',", app.indexOf("'/api/lab-orders/batch'")),
  );

  assert(
    route.includes('chargeLabOrderBatch(result.orders, db)'),
    'the batch route prices every order',
  );
  assert(route.includes('billing: billed'), 'the batch route returns what was billed');
  assert(
    !route.includes("sourceType: 'LAB_ORDER'"),
    'the batch route does not re-implement the charge request inline',
  );
}

/* ============================================================
   3. RADIOLOGY PRICES FROM THE COLUMN THAT EXISTS
   ============================================================ */

function testRadiology(): void {
  const schema = schemaSource();
  const radiologyTable = schema.slice(schema.indexOf('radiologyOrders = pgTable'));

  assert(
    radiologyTable.includes("procedureName: text('procedure_name')"),
    'radiology_orders has procedure_name',
  );
  assert(
    !radiologyTable.slice(0, 1800).includes("testName: text('test_name')"),
    'radiology_orders has no test_name column',
  );

  const request = radiologyChargeRequest({
    id: 9,
    tenantId: 1,
    facilityId: 2,
    patientId: 3,
    encounterId: null,
    procedureName: 'Chest X-ray',
  });

  assertEqual(request.codes[0], 'RAD-CHEST-X-RAY', 'radiology prices by procedure name');
  assertEqual(request.description, 'Chest X-ray', 'the line names the study');
  assertEqual(request.encounterId, null, 'an order without an encounter is allowed');

  const app = source('src/app.ts');
  /*
   * The route is matched by shape rather than by exact formatting: it
   * was reformatted onto several lines when the audit added permission
   * and scope guards, and this assertion is about the charge request,
   * not about where the line breaks fell.
   */
  const routeStart = app.search(/app\.post\(\s*'\/api\/radiology-orders'/);
  const routeEnd = app.search(/app\.put\(\s*'\/api\/radiology-orders\/:id\/report'/);

  const route = routeStart === -1 || routeEnd === -1 ? '' : app.slice(routeStart, routeEnd);

  assert(route.includes('radiologyChargeRequest'), 'the radiology route uses the shared request');
  assert(!route.includes('testName'), 'the radiology route no longer looks for testName');
}

/* ============================================================
   4. THE BILL SURVIVES EVERY STAGE
   ============================================================ */

function testEveryStageIsCharged(): void {
  const app = source('src/app.ts');

  const stages: Array<[string, string]> = [
    ["'/api/encounters'", 'CONSULTATION'],
    ["'/api/procedures'", 'PROCEDURE'],
    ["'/api/radiology-orders'", 'RADIOLOGY'],
    ["'/api/pharmacy/dispense'", 'PHARMACY'],
    ["'/api/admissions/:id/discharge'", 'BED_DAY'],
  ];

  for (const [route, sourceType] of stages) {
    const body = routeBody(app, 'app.post', route.replace(/'/g, ''));
    assert(body !== null, `${route} exists`);

    assert(body!.includes(sourceType), `${sourceType} is charged by ${route}`);
  }

  /*
   * The one endpoint that cannot be checked by a literal is the lab
   * batch: its request is built in service-charges.ts.
   */
  const charges = source('src/billing/service-charges.ts');
  assert(charges.includes("sourceType: 'LAB_ORDER'"), 'laboratory charges are built once');

  /*
   * A charge that cannot be priced must never stop the clinical act,
   * and the screen is told what happened.
   */
  const billing = source('src/billing/billing.service.ts');
  const matching = source('src/billing/tariff-matching.ts');
  assert(
    billing.includes("reason: 'TARIFF_NOT_CONFIGURED'"),
    'a missing tariff is reported, not invented',
  );

  /*
   * The failure the tariff screen exists to prevent: a code that is
   * stored in one case and looked up in another bills nothing, silently.
   * Both ends are held here so neither can regress alone.
   */
  assert(
    matching.includes('codeKey(row.code) === upper'),
    'tariff lookup compares upper-cased codes',
  );
  assert(
    billing.includes('summariseCodes(request.codes)') &&
      billing.includes('function summariseCodes'),
    'the failure names the codes that were tried, and counts the rest',
  );

  const tariffInput = app.slice(
    app.indexOf('const validateTariffInput'),
    app.indexOf('const facilityHasTariffModule'),
  );
  assert(
    tariffInput.includes('.trim().toUpperCase()'),
    'tariff codes are stored in capitals, whatever the caller sends',
  );

  const panel = source('src/components/modules/FacilityServiceTariffsPanel.tsx');
  assert(
    panel.includes('BILLING_FAMILIES') && panel.includes('not priced'),
    'the tariff screen shows which services will not bill',
  );

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
  assert(
    charges.includes('codesForFamily'),
    'the laboratory charge asks the shared rule for its candidates',
  );
  assert(
    matching.includes('labTariffCodeCandidates({ code: input.code ?? null, name })'),
    'and that rule asks for the catalogue code',
  );

  const queries = source('src/db/queries.ts');
  assert(
    queries.includes('orders.push({') && queries.includes('testCode: test.code'),
    'the batch carries each test code to the charging step',
  );
  assert(
    queries.includes('testCode = test?.code ?? null'),
    'the single-order route resolves the code too',
  );

  assert(
    containsCode(app, "codes: codesForFamily({ family: 'LABORATORY',"),
    'the one-by-one laboratory route prices like the batch does',
  );

  assert(
    panel.includes('unpricedLabTests'),
    'the tariff screen names the laboratory tests that would bill nothing',
  );
  assert(
    panel.includes('labTariffCodeCandidates'),
    'the screen and the engine share one rule for laboratory codes',
  );

  assert(
    containsCode(app, "codes: codesForFamily({ family: 'PROCEDURE',"),
    'a procedure is priced from its own code as well as its name',
  );

  /*
   * The consultation that billed nothing because the facility numbered
   * its tariffs OPD-001. Every automatic charge now offers the link the
   * facility made on the tariff screen, and the engine tries it before
   * the codes.
   */
  /*
   * Each key is checked in the file that now owns its route. The delivery
   * moved to src/routes/maternal-health.routes.ts when the maternity and
   * immunisation routes were extracted from createApp; naming the file per
   * key keeps the assertion as tight as it was, instead of loosening it to
   * "somewhere in the sources".
   */
  for (const [label, key, file] of [
    ['the consultation', "billingServiceKeys('CONSULTATION'", 'src/app.ts'],
    ['the admission', "billingServiceKeys('ADMISSION'", 'src/app.ts'],
    ['the delivery', "billingServiceKeys('DELIVERY'", 'src/routes/maternal-health.routes.ts'],
    ['the prescription', "billingServiceKeys('PHARMACY'", 'src/app.ts'],
    ['the procedure', "billingServiceKeys('PROCEDURE'", 'src/app.ts'],
  ] as const) {
    assert(source(file).includes(key), `${label} offers a billing link`);
  }

  /*
   * The bed-day link moved with the bed-day engine: discharge, transfer
   * and the nightly job all charge from `accrueBedDaysScoped`, so that
   * is where the ward's link key has to be offered.
   */
  assert(
    source('src/db/queries.ts').includes("billingServiceKeys('BED_DAY'"),
    'the bed-day offers a billing link',
  );

  assert(
    charges.includes("billingServiceKeys('LABORATORY'"),
    'a laboratory order offers a billing link',
  );
  assert(
    charges.includes("billingServiceKeys('RADIOLOGY'"),
    'a radiology order offers a billing link',
  );

  /*
   * The order is now one rule in one module: LINK → CODE → DESCRIPTION.
   * The assertion follows the code, so the guarantee survives the move:
   * a link the facility made still beats a code the engine guessed, and
   * both still beat a description match.
   */
  assert(
    billing.includes('resolveTariffForCharge(') &&
      matching.indexOf('/* ---- 1. Explicit link') < matching.indexOf('/* ---- 2. Exact code') &&
      matching.indexOf('/* ---- 2. Exact code') <
        matching.indexOf("/* ---- 3. The facility's own description"),
    'a link the facility made is tried before a code, and a code before a description',
  );

  /*
   * A development database one migration behind must not turn every
   * charge into a 500.
   */
  assert(
    billing.includes("code === '42703'") && billing.includes('warnedMissingBillingKey'),
    'a database without migration 0019 degrades to code matching, once, with a warning',
  );

  /* The write path stores the link, and refuses a duplicate. */
  assert(app.includes('billingKey: input.billingKey'), 'the tariff write stores the link');
  assert(
    app.includes('TARIFF_BILLING_KEY_TAKEN'),
    'two active tariffs cannot answer the same automatic charge',
  );
  assert(
    app.includes('TARIFF_MIGRATION_REQUIRED') && app.includes('migrations 0019 and 0021'),
    'a database without the column says which migration is missing',
  );
}

/* ============================================================
   5. A VISIT CAN END
   ============================================================ */

function testVisitLifecycle(): void {
  const queries = source('src/db/queries.ts');

  assert(queries.includes("safeData.status === 'Completed'"), 'completing a visit is recognised');
  assert(
    queries.includes('safeData.endedAt = safeData.endedAt ?? new Date()'),
    'the server stamps the end time',
  );

  const ui = source('src/components/modules/OutpatientModule.tsx');

  assert(ui.includes('handleCompleteVisit'), 'the OPD screen can end a visit');
  assert(ui.includes("status: 'Completed'"), 'it sends the completed status');
  assert(!ui.includes('endedAt'), 'it does not send a timestamp the server should own');

  /*
   * The second visit must not reuse the first encounter: the consult
   * charge is keyed on the encounter, so reuse silently skips the fee.
   */
  assert(
    ui.includes('encs.find') || ui.includes("status === 'Active'"),
    'the screen only resumes an Active encounter',
  );
}

/* ============================================================
   6. IDENTIFIERS ARE ALLOCATED ON THE SERVER
   ============================================================ */

function testIdentifiers(): void {
  const queries = source('src/db/queries.ts');

  assert(
    queries.includes('export async function nextPatientMrn'),
    'MRNs are allocated in the database layer',
  );
  assert(
    queries.includes('export async function nextQueueToken'),
    'queue tokens are allocated in the database layer',
  );
  assert(
    queries.includes('export class PatientMrnConflictError'),
    'a duplicate MRN has a named refusal',
  );

  const registration = source('src/components/modules/PatientRegistrationModule.tsx');
  const opd = source('src/components/modules/OutpatientModule.tsx');

  assert(
    !registration.includes('Math.random()'),
    'the registration screen no longer invents an MRN or a token',
  );
  assert(!opd.includes('Math.random()'), 'the clinician screen no longer invents a pharmacy token');

  /* The API route turns the named refusal into 409, not 500. */
  const app = source('src/app.ts');
  assert(
    app.includes('err instanceof queries.PatientMrnConflictError'),
    'a duplicate MRN answers 409',
  );

  assert(
    registration.includes('triageEntry.tokenNumber'),
    'the registration receipt shows the token the server allocated',
  );
}

/* ============================================================
   7. THE QUEUE IS THE ROAD, NOT A WALL
   ============================================================ */

function testQueueFlow(): void {
  const app = source('src/app.ts');
  const queries = source('src/db/queries.ts');
  const opd = source('src/components/modules/OutpatientModule.tsx');

  assert(
    app.includes('queries.updateQueueStatusScoped'),
    'moving a token is scoped to the facility',
  );
  assert(
    !app.includes('queries.updateQueueStatus('),
    'the unscoped update is gone from the routes',
  );
  assert(
    queries.includes('export async function completeQueueTokensForPatient'),
    'a served patient can have their token closed',
  );
  assert(app.includes("'Pharmacy'"), 'dispensing closes the pharmacy token');

  assert(
    opd.includes("api.getQueues(currentFacility?.id, 'Triage')"),
    'the clinician sees the triage queue',
  );
  assert(opd.includes("'In-Progress'"), 'starting a visit moves the token');
  assert(opd.includes('Waiting in Triage'), 'the queue is visible on the OPD screen');
}

/* ============================================================
   8. THE TARIFF SCREEN NAMES THE CODES
   ============================================================ */

function testTariffGuidance(): void {
  const panel = source('src/components/modules/FacilityServiceTariffsPanel.tsx');

  for (const code of ['OPD-CONSULT', 'LAB-', 'RAD-', 'PROC-', 'DRUG-', 'ADMISSION', 'BED-DAY']) {
    assert(panel.includes(code), `the tariff screen names ${code}`);
  }

  assert(panel.includes('not</strong> billed'), 'it says that an unmatched service is not billed');
}

/* ============================================================
   RUN
   ============================================================ */

function run(): void {
  console.log('');
  console.log('==============================================');
  console.log('THE OUTPATIENT JOURNEY — CONTRACT TESTS');
  console.log('==============================================');

  testTariffCodes();
  console.log('  1. Tariff codes');
  testLabBatch();
  console.log('  2. The laboratory batch is billed');
  testRadiology();
  console.log('  3. Radiology prices from procedure_name');
  testEveryStageIsCharged();
  console.log('  4. Every stage raises its line');
  testVisitLifecycle();
  console.log('  5. A visit can end');
  testIdentifiers();
  console.log('  6. Identifiers are allocated on the server');
  testQueueFlow();
  console.log('  7. The queue drives the journey');
  testTariffGuidance();
  console.log('  8. The tariff screen names the codes');

  console.log('');
  console.log('==============================================');
  console.log(`OPD JOURNEY TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

try {
  run();
} catch (error) {
  console.error('');
  console.error('==============================================');
  console.error('OPD JOURNEY TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
}
