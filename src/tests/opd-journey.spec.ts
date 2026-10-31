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
    ...['\n  app.', '\n  router.', '\napp.', '\nrouter.'].map((marker) => {
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

  it('2. LAB ORDERS WAIT FOR VERIFIED COMPLETION', () => {
    const request = labOrderChargeRequest({
      id: 7,
      tenantId: 1,
      facilityId: 2,
      patientId: 3,
      encounterId: 4,
      testName: 'Complete blood count',
      testId: 11,
    });
    expect(request).toMatchObject({ sourceType: 'LAB_ORDER', sourceId: 7, encounterId: 4 });
    const routes = source('src/routes/laboratory.routes.ts');
    const batch = routeBody(routes, 'router.post', '/api/lab-orders/batch')!;
    expect(batch).not.toContain('chargeSafely');
    expect(batch).not.toContain('chargeLabOrderBatch');
    const complete = routeBody(routes, 'router.post', '/api/lab-orders/:id/complete')!;
    expect(complete).toContain('completeLabInvestigation');
    expect(complete).toContain('chargeSafely(labOrderChargeRequest');
    const queries = source('src/db/queries/laboratory.ts');
    expect(queries).toContain('recordChargeAttempt(tx, labOrderChargeRequest');
    expect(queries).toContain("status !== 'Verified'");
  });

  it('3. RADIOLOGY BILLS THE REPORTED EXAMINATION, NOT THE MODALITY', () => {
    const schema = schemaSource();
    const radiologyTable = schema.slice(schema.indexOf('radiologyOrders = pgTable'));
    expect(radiologyTable).toContain("procedureName: text('procedure_name')");
    expect(radiologyTable.slice(0, 1800)).not.toContain("testName: text('test_name')");
    const request = radiologyChargeRequest({
      id: 9,
      tenantId: 1,
      facilityId: 2,
      patientId: 3,
      encounterId: null,
      procedureName: 'Chest X-ray',
    });
    expect(request).toMatchObject({ sourceType: 'RADIOLOGY', sourceId: 9, encounterId: null });
    const routes = source('src/routes/radiology.routes.ts');
    const order = routeBody(routes, 'router.post', '/api/radiology-orders')!;
    const report = routeBody(routes, 'router.put', '/api/radiology-orders/:id/report')!;
    expect(order).not.toContain('chargeSafely');
    expect(report).toContain('chargeSafely(radiologyChargeRequest(order))');
    const resolver = source('src/billing/master-charge-resolver.ts');
    expect(resolver).toContain('row.masterServiceId');
    expect(resolver).toContain("row.status !== 'Reported'");
    expect(resolver).not.toContain('row.modality');
  });

  it('4. CLINICAL SOURCES USE THE STRICT RESOLVER AND DURABLE QUEUE', () => {
    const encounterQueries = source('src/db/queries/encounters.ts');
    const radiologyQueries = source('src/db/queries/laboratory.ts');
    const inventory = source('src/inventory/inventory.service.ts');
    const inpatient = source('src/db/queries/inpatient.ts');
    const resolver = source('src/billing/master-charge-resolver.ts');
    const billing = source('src/billing/billing.service.ts');
    expect(encounterQueries).toContain('recordChargeAttempt(tx, consultationChargeRequest');
    expect(radiologyQueries).toContain('recordChargeAttempt(tx, radiologyChargeRequest');
    expect(inventory).toContain("sourceType: 'PHARMACY'");
    expect(inpatient).toContain('recordChargeAttempt(tx, admissionChargeRequest');
    expect(resolver).toContain('schema.masterServiceSources');
    expect(resolver).toContain('schema.masterServiceAliases');
    expect(resolver).toContain('MASTER_CODE_AMBIGUOUS');
    expect(resolver).toContain("tariff.approvalStatus !== 'APPROVED'");
    expect(resolver).toContain('cents <= 0');
    expect(resolver).toContain('dateVerdict(');
    expect(resolver).not.toContain('resolveFromRows');
    expect(billing).toContain('resolveMasterCharge(');
    expect(billing).toContain('idempotencyKey');
    expect(billing).toContain('masterServiceId: master.id');
    const panel = source('src/components/modules/MasterTariffPriceList.tsx');
    expect(panel).toContain('retryChargeAttempt');
  });

  it('5. A VISIT CAN END', async () => {
    const queries = queriesSource();

    expect(
      queries.includes("safeData.status === 'Completed'"),
      'completing a visit is recognised',
    ).toBe(true);
    expect(
      queries.includes('safeData.endedAt = locked.endedAt ?? new Date()'),
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
