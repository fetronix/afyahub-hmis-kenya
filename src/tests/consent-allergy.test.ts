/**
 * JaliCare HMIS
 * Consent and allergy — regression tests
 *
 * Two of the audit's critical gaps were FN-06 (no consent capture) and
 * FN-15 (allergies kept as free text). These assertions cover what can
 * be proven without a live database:
 *
 *   - the pure decisions (status derivation, input validation,
 *     medication matching) run against the real functions;
 *   - the wiring (routes, permissions, UI, prescribing gate, access
 *     logging) is checked against the source, with comments stripped so
 *     that documentation cannot satisfy an assertion;
 *   - the migration is checked for the safety properties it claims.
 *
 * The database-backed paths (grantConsent, recordAllergy) are not
 * exercised here: this environment has no PostgreSQL. The test says so
 * rather than pretending.
 *
 * Run with: npx tsx src/tests/consent-allergy.test.ts
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) {
    throw new Error(`FAILED: ${label}`);
  }
}

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

/** Source with comments removed — assertions are about behaviour. */
function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/*
 * The services import the database module, which validates its
 * environment at import time. These values let the module load; no
 * connection is opened because no query runs.
 */
process.env.SQL_HOST = process.env.SQL_HOST || '127.0.0.1';
process.env.SQL_PORT = process.env.SQL_PORT || '5432';
process.env.SQL_DB_NAME = process.env.SQL_DB_NAME || 'jalicare_test';
process.env.SQL_ADMIN_USER = process.env.SQL_ADMIN_USER || 'postgres';
process.env.SQL_ADMIN_PASSWORD = process.env.SQL_ADMIN_PASSWORD || 'unused';

async function main(): Promise<void> {
  const consent = await import('../clinical/consent.service.ts');
  const allergy = await import('../clinical/allergy.service.ts');

  /* ============================================================
     1. Consent status is derived, never trusted from the client
     ============================================================ */

  assert(
    consent.deriveConsentStatus({ status: 'ACTIVE', expiresAt: null }) === 'ACTIVE',
    'A live consent with no expiry reads as ACTIVE',
  );

  assert(
    consent.deriveConsentStatus({ status: 'REVOKED', expiresAt: null }) === 'REVOKED',
    'A revoked consent reads as REVOKED',
  );

  assert(
    consent.deriveConsentStatus({
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() - 86_400_000),
    }) === 'EXPIRED',
    'A consent past its expiry reads as EXPIRED even though the row still says ACTIVE',
  );

  assert(
    consent.deriveConsentStatus({
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 86_400_000),
    }) === 'ACTIVE',
    'A consent inside its expiry reads as ACTIVE',
  );

  assert(
    consent.deriveConsentStatus({ status: 'ACTIVE', expiresAt: new Date().toISOString() }) ===
      'EXPIRED',
    'The exact expiry instant has already expired',
  );

  /* ============================================================
     2. Input validation
     ============================================================ */

  const valid = consent.validateConsentInput({
    purpose: 'TREATMENT',
    method: 'WRITTEN',
    scope: { patientProfile: true, encounters: true },
  });

  assert(valid.purpose === 'TREATMENT', 'A valid purpose survives validation');
  assert(
    valid.scope.patientProfile === true,
    'A granted scope survives validation',
  );

  for (const [input, label] of [
    [{ purpose: 'EVERYTHING', method: 'WRITTEN', scope: { encounters: true } }, 'an unknown purpose'],
    [{ purpose: 'TREATMENT', method: 'GUESSED', scope: { encounters: true } }, 'an unknown method'],
    [{ purpose: 'TREATMENT', method: 'WRITTEN', scope: {} }, 'an empty scope'],
    [{ purpose: 'TREATMENT', method: 'WRITTEN', scope: { encounters: false } }, 'a scope that grants nothing'],
    [{ purpose: 'TREATMENT', method: 'WRITTEN' }, 'a missing scope'],
    [null, 'a null body'],
    [[], 'an array body'],
  ] as Array<[unknown, string]>) {
    checks += 1;

    try {
      consent.validateConsentInput(input);
      throw new Error(`FAILED: ${label} was accepted`);
    } catch (error) {
      if (error instanceof consent.ConsentError) {
        assert(
          error.statusCode === 400,
          `${label} is refused with 400 (${error.code})`,
        );
      } else if (String(error).includes('FAILED:')) {
        throw error;
      }
    }
  }

  assert(
    consent.CONSENT_PURPOSES.includes('TREATMENT') &&
      consent.CONSENT_PURPOSES.includes('SHARING_WITH_INSURER'),
    'The purposes cover treatment and insurer sharing',
  );

  assert(
    consent.CONSENT_SCOPES.includes('laboratory') &&
      consent.CONSENT_SCOPES.includes('billing'),
    'A consent can be limited by data category',
  );

  /* ============================================================
     3. Medication matching
     ============================================================ */

  assert(
    allergy.matchesMedication('Penicillin', 'Penicillin') === true,
    'An exact match warns',
  );
  assert(
    allergy.matchesMedication('penicillin', 'PENICILLIN V') === true,
    'Case and a brand suffix do not hide a match',
  );
  assert(
    allergy.matchesMedication('Aspirin', 'Aspirin 75mg') === true,
    'A strength suffix does not hide a match',
  );
  assert(
    allergy.matchesMedication('  Penicillin  ', 'penicillin') === true,
    'Whitespace does not hide a match',
  );
  assert(
    allergy.matchesMedication('Penicillin', 'Paracetamol') === false,
    'An unrelated drug does not warn',
  );
  assert(
    allergy.matchesMedication('', 'Penicillin') === false,
    'An empty allergen never matches',
  );
  assert(
    allergy.matchesMedication('Penicillin', '') === false,
    'An empty medication never matches',
  );

  /*
   * Deliberate limitation, asserted so nobody "fixes" it by accident
   * and calls it safety: a cross-reactivity pair is not caught by a
   * name comparison. The UI says so.
   */
  assert(
    allergy.matchesMedication('Penicillin', 'Amoxicillin') === false,
    'A same-class drug with a different name is NOT claimed as a match',
  );

  assert(
    allergy.ALLERGY_SEVERITIES.includes('LIFE_THREATENING'),
    'Life-threatening is one of the recorded severities',
  );

  /* ============================================================
     4. The routes are guarded and scoped
     ============================================================ */

  const routes = code('src/clinical/clinical-records.routes.ts');

  assert(
    routes.includes("router.use(requireAuth)"),
    'Every consent and allergy route requires authentication',
  );

  for (const permission of [
    'patients.read',
    'patients.update',
    'clinical.read',
    'clinical.create',
    'clinical.update',
  ]) {
    assert(
      routes.includes(`requirePermission('${permission}')`),
      `The routes use the ${permission} permission`,
    );
  }

  assert(
    routes.includes('/:id/consents') &&
      routes.includes('/:id/allergies') &&
      routes.includes('/:id/allergies/check'),
    'Consent, allergy and the prescribing check are all mounted on the patient',
  );

  /*
   * A patient in another tenant must be a 404, not a 403 — a 403
   * confirms the id exists.
   */
  const allergyService = code('src/clinical/allergy.service.ts');
  const consentService = code('src/clinical/consent.service.ts');

  assert(
    allergyService.includes("eq(schema.patients.tenantId, scope.tenantId)"),
    'Allergy lookups filter patients by tenant',
  );
  assert(
    /eq\(\s*schema\.patients\.tenantId,\s*(scope|facility\[0\])\.tenantId\s*\)/.test(
      consentService,
    ),
    'Consent lookups filter patients by tenant',
  );

  assert(
    code('src/app.ts').includes("app.use('/api/patients', clinicalRecordsRoutes)"),
    'The consent and allergy routes are mounted in the application',
  );

  /* ============================================================
     5. Consent is not deletable, only revocable
     ============================================================ */

  assert(
    !/router\.delete/.test(routes),
    'No route physically deletes a consent or an allergy',
  );

  const revoke = consentService.slice(consentService.indexOf('export async function revokeConsent'));

  assert(
    revoke.includes('revokedAt') && revoke.includes('revokedByUserId'),
    'Revocation records when and by whom',
  );

  assert(
    revoke.includes("'CONSENT_NOT_FOUND'"),
    'Revoking a consent that does not exist fails explicitly',
  );

  /* ============================================================
     6. Prescribing goes through the allergy check
     ============================================================ */

  const app = code('src/app.ts');

  /*
   * Locate the POST by its route, not by the first string match: an
   * earlier module guard also mentions /api/medications.
   */
  const prescriptionMatch =
    /app\.post\(\s*'\/api\/medications',\s*requirePermission/.exec(app);

  assert(prescriptionMatch !== null, 'The prescription route exists');

  const prescriptionBlock = app.slice(
    prescriptionMatch!.index,
    prescriptionMatch!.index + 4000,
  );

  assert(
    prescriptionBlock.includes('checkMedicationAllergies'),
    'The prescription route calls the allergy check',
  );
  assert(
    prescriptionBlock.includes("error: 'ALLERGY_CONFLICT'"),
    'A matching allergy returns a conflict the screen can act on',
  );
  assert(
    prescriptionBlock.includes('body.allergyAcknowledged === true'),
    'Overriding requires an explicit acknowledgement, not a default',
  );
  assert(
    prescriptionBlock.includes("'PRESCRIBE'") &&
      prescriptionBlock.includes('Allergy warning overridden'),
    'The override is written to the audit trail',
  );
  assert(
    prescriptionBlock.includes('allergyAcknowledged: _acknowledged'),
    'The acknowledgement flag is not written into the medication row',
  );

  const outpatient = code('src/components/modules/OutpatientModule.tsx');

  assert(
    outpatient.includes("err.code === 'ALLERGY_CONFLICT'"),
    'The prescribing screen handles the allergy conflict',
  );
  assert(
    outpatient.includes('allergyAcknowledged: true'),
    'The screen can retry with an acknowledgement when the prescriber confirms',
  );
  assert(
    outpatient.includes('Nothing was saved'),
    'Cancelling the warning writes nothing',
  );

  /* ============================================================
     7. The capability is visible
     ============================================================ */

  const panel = code('src/components/PatientConsentAllergyPanel.tsx');
  const journey = code('src/components/PatientJourneyModal.tsx');

  assert(
    panel.includes('getPatientConsents') && panel.includes('grantPatientConsent'),
    'The panel can read and record consent',
  );
  assert(
    panel.includes('getPatientAllergies') && panel.includes('recordPatientAllergy'),
    'The panel can read and record allergies',
  );
  assert(
    panel.includes('revokePatientConsent'),
    'The panel can revoke consent',
  );
  assert(
    panel.includes('setPatientAllergyStatus'),
    'The panel can resolve or reactivate an allergy',
  );
  assert(
    panel.includes('This is not the same as "nothing recorded"'),
    'A failed read is never presented as "no allergies"',
  );
  assert(
    journey.includes('PatientConsentAllergyPanel') &&
      journey.includes("id: 'consent'"),
    'The panel is reachable from the patient record as its own tab',
  );

  /*
   * Displayed scope keys must be the ones the server validates.
   */
  for (const scopeKey of ['patientProfile', 'encounters', 'laboratory', 'billing']) {
    assert(
      panel.includes(`value: '${scopeKey}'`),
      `The consent form offers the ${scopeKey} scope`,
    );
  }

  /* ============================================================
     8. Patient access is logged, and the old mislabelled row is gone
     ============================================================ */

  const accessLog = code('src/clinical/access-log.service.ts');

  assert(
    accessLog.includes('insert(schema.patientRecordAccessLogs)'),
    'The access log service writes to the access table',
  );
  assert(
    accessLog.includes('ACCESS_PURPOSES'),
    'Every access carries a purpose from a fixed list',
  );

  assert(
    app.includes('logPatientAccess('),
    'Patient routes write an access row',
  );
  assert(
    app.includes("action: 'VIEW'"),
    'Reading a patient record is logged as VIEW',
  );
  assert(
    app.includes("action: 'UPDATE'"),
    'Editing a patient record is logged as UPDATE',
  );
  assert(
    app.includes("action: 'EXPORT'") && app.includes("channel: 'FHIR'"),
    'Serving a FHIR patient is logged as an FHIR export',
  );
  assert(
    !app.includes('FHIR patient resource retrieval'),
    'The mislabelled FHIR row that sat in the patient-update route is gone',
  );
  assert(
    !app.includes('db.insert(schema.patientRecordAccessLogs)'),
    'Every access row now goes through the one logging service',
  );

  /* ============================================================
     9. Audit log is append-only at the database level
     ============================================================ */

  const migration = source('drizzle/0017_consent_allergy_audit_integrity.sql');

  assert(
    migration.includes('jalicare_audit_is_append_only'),
    'The migration defines an append-only guard for the audit log',
  );
  assert(
    migration.includes('CREATE TRIGGER') &&
      migration.includes('BEFORE UPDATE OR DELETE'),
    'The guard is a trigger on update and delete',
  );
  assert(
    migration.includes('REVOKE UPDATE, DELETE, TRUNCATE'),
    'The role loses the right to rewrite the audit log as well',
  );
  assert(
    migration.includes('CREATE TABLE IF NOT EXISTS patient_allergies'),
    'The migration creates the allergy table idempotently',
  );
  assert(
    migration.includes('national_id_bidx') &&
      migration.includes('sha_number_bidx'),
    'The migration adds the blind-index columns',
  );
  assert(
    migration.includes('patients_national_id_bidx_idx') &&
      migration.includes('patients_sha_number_bidx_idx'),
    'The blind-index columns are indexed',
  );

  assert(
    code('src/db/schema.ts').includes("pgTable(\n  'patient_allergies'") ||
      code('src/db/schema.ts').includes("pgTable('patient_allergies'"),
    'The schema defines the allergy table',
  );

  /* ============================================================
     10. The catalogue can actually use these routes
     ============================================================ */

  const catalogue = code('src/auth/staff-role-catalogue.ts');

  assert(
    catalogue.includes("'patients.update'"),
    'At least one staff role can record consent',
  );

  /* ------------------------------------------------------------
     What is NOT covered
     ------------------------------------------------------------ */

  console.log(
    '\nNOT RUN: grantConsent, revokeConsent, recordAllergy, listAllergies and' +
      '\n  checkMedicationAllergies against PostgreSQL — no database in this' +
      '\n  environment. Migration 0017 has not been executed.',
  );

  console.log(`\nConsent and allergy: ${checks} assertions passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
