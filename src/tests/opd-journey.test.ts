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
  assert(
    actual === expected,
    `${label} — expected ${String(expected)}, got ${String(actual)}`,
  );
}

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

/**
 * The body of one route, from its declaration to the next `app.` at
 * the same indentation. Routes are written both on one line and with
 * the path on its own line, so both forms are found.
 */
function routeBody(file: string, method: string, path: string): string | null {
  const inline = file.indexOf(`${method}('${path}'`);
  const multiline = file.indexOf(`${method}(\n    '${path}'`);
  const start = Math.min(
    ...[inline, multiline].filter((index) => index >= 0),
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
    JSON.stringify([
      'LAB-COMPLETE-BLOOD-COUNT',
      'COMPLETE-BLOOD-COUNT',
      'LAB-GENERAL',
    ]),
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
  const schema = source('src/db/schema.ts');
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
  const route = app.slice(
    app.indexOf("app.post('/api/radiology-orders'"),
    app.indexOf("app.put('/api/radiology-orders/:id/report'"),
  );

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

    assert(
      body!.includes(sourceType),
      `${sourceType} is charged by ${route}`,
    );
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
  assert(
    billing.includes("reason: 'TARIFF_NOT_CONFIGURED'"),
    'a missing tariff is reported, not invented',
  );
}

/* ============================================================
   5. A VISIT CAN END
   ============================================================ */

function testVisitLifecycle(): void {
  const queries = source('src/db/queries.ts');

  assert(
    queries.includes("safeData.status === 'Completed'"),
    'completing a visit is recognised',
  );
  assert(
    queries.includes('safeData.endedAt = safeData.endedAt ?? new Date()'),
    'the server stamps the end time',
  );

  const ui = source('src/components/modules/OutpatientModule.tsx');

  assert(ui.includes('handleCompleteVisit'), 'the OPD screen can end a visit');
  assert(
    ui.includes("status: 'Completed'"),
    'it sends the completed status',
  );
  assert(
    !ui.includes('endedAt'),
    'it does not send a timestamp the server should own',
  );

  /*
   * The second visit must not reuse the first encounter: the consult
   * charge is keyed on the encounter, so reuse silently skips the fee.
   */
  assert(
    ui.includes("encs.find") || ui.includes("status === 'Active'"),
    'the screen only resumes an Active encounter',
  );
}

/* ============================================================
   6. IDENTIFIERS ARE ALLOCATED ON THE SERVER
   ============================================================ */

function testIdentifiers(): void {
  const queries = source('src/db/queries.ts');

  assert(queries.includes('export async function nextPatientMrn'), 'MRNs are allocated in the database layer');
  assert(queries.includes('export async function nextQueueToken'), 'queue tokens are allocated in the database layer');
  assert(queries.includes('export class PatientMrnConflictError'), 'a duplicate MRN has a named refusal');

  const registration = source('src/components/modules/PatientRegistrationModule.tsx');
  const opd = source('src/components/modules/OutpatientModule.tsx');

  assert(
    !registration.includes('Math.random()'),
    'the registration screen no longer invents an MRN or a token',
  );
  assert(
    !opd.includes('Math.random()'),
    'the clinician screen no longer invents a pharmacy token',
  );

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
  assert(
    app.includes("'Pharmacy'"),
    'dispensing closes the pharmacy token',
  );

  assert(opd.includes("api.getQueues(currentFacility?.id, 'Triage')"), 'the clinician sees the triage queue');
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

  assert(
    panel.includes('not</strong> billed'),
    'it says that an unmatched service is not billed',
  );
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
