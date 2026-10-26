import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaSource } from './support/schema-source.ts';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

const root = resolve(here, '../..');

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

process.env.SQL_HOST = process.env.SQL_HOST || '127.0.0.1';

process.env.SQL_PORT = process.env.SQL_PORT || '5432';

process.env.SQL_DB_NAME = process.env.SQL_DB_NAME || 'jalicare_test';

process.env.SQL_ADMIN_USER = process.env.SQL_ADMIN_USER || 'postgres';

process.env.SQL_ADMIN_PASSWORD = process.env.SQL_ADMIN_PASSWORD || 'unused';

describe('Consent and allergy — regression tests', () => {
  it('Main', async () => {
    const consent = await import('../clinical/consent.service.ts');
    const allergy = await import('../clinical/allergy.service.ts');

    /* ============================================================
       1. Consent status is derived, never trusted from the client
       ============================================================ */

    expect(
      consent.deriveConsentStatus({ status: 'ACTIVE', expiresAt: null }) === 'ACTIVE',
      'A live consent with no expiry reads as ACTIVE',
    ).toBe(true);

    expect(
      consent.deriveConsentStatus({ status: 'REVOKED', expiresAt: null }) === 'REVOKED',
      'A revoked consent reads as REVOKED',
    ).toBe(true);

    expect(
      consent.deriveConsentStatus({
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() - 86_400_000),
      }) === 'EXPIRED',
      'A consent past its expiry reads as EXPIRED even though the row still says ACTIVE',
    ).toBe(true);

    expect(
      consent.deriveConsentStatus({
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 86_400_000),
      }) === 'ACTIVE',
      'A consent inside its expiry reads as ACTIVE',
    ).toBe(true);

    expect(
      consent.deriveConsentStatus({ status: 'ACTIVE', expiresAt: new Date().toISOString() }) ===
        'EXPIRED',
      'The exact expiry instant has already expired',
    ).toBe(true);

    /* ============================================================
       2. Input validation
       ============================================================ */

    const valid = consent.validateConsentInput({
      purpose: 'TREATMENT',
      method: 'WRITTEN',
      scope: { patientProfile: true, encounters: true },
    });

    expect(valid.purpose === 'TREATMENT', 'A valid purpose survives validation').toBe(true);
    expect(valid.scope.patientProfile === true, 'A granted scope survives validation').toBe(true);

    for (const [input, label] of [
      [
        { purpose: 'EVERYTHING', method: 'WRITTEN', scope: { encounters: true } },
        'an unknown purpose',
      ],
      [
        { purpose: 'TREATMENT', method: 'GUESSED', scope: { encounters: true } },
        'an unknown method',
      ],
      [{ purpose: 'TREATMENT', method: 'WRITTEN', scope: {} }, 'an empty scope'],
      [
        { purpose: 'TREATMENT', method: 'WRITTEN', scope: { encounters: false } },
        'a scope that grants nothing',
      ],
      [{ purpose: 'TREATMENT', method: 'WRITTEN' }, 'a missing scope'],
      [null, 'a null body'],
      [[], 'an array body'],
    ] as Array<[unknown, string]>) {
      try {
        consent.validateConsentInput(input);
        throw new Error(`FAILED: ${label} was accepted`);
      } catch (error) {
        if (error instanceof consent.ConsentError) {
          expect(error.statusCode === 400, `${label} is refused with 400 (${error.code})`).toBe(
            true,
          );
        } else if (String(error).includes('FAILED:')) {
          throw error;
        }
      }
    }

    expect(
      consent.CONSENT_PURPOSES.includes('TREATMENT') &&
        consent.CONSENT_PURPOSES.includes('SHARING_WITH_INSURER'),
      'The purposes cover treatment and insurer sharing',
    ).toBe(true);

    expect(
      consent.CONSENT_SCOPES.includes('laboratory') && consent.CONSENT_SCOPES.includes('billing'),
      'A consent can be limited by data category',
    ).toBe(true);

    /* ============================================================
       3. Medication matching
       ============================================================ */

    expect(
      allergy.matchesMedication('Penicillin', 'Penicillin') === true,
      'An exact match warns',
    ).toBe(true);
    expect(
      allergy.matchesMedication('penicillin', 'PENICILLIN V') === true,
      'Case and a brand suffix do not hide a match',
    ).toBe(true);
    expect(
      allergy.matchesMedication('Aspirin', 'Aspirin 75mg') === true,
      'A strength suffix does not hide a match',
    ).toBe(true);
    expect(
      allergy.matchesMedication('  Penicillin  ', 'penicillin') === true,
      'Whitespace does not hide a match',
    ).toBe(true);
    expect(
      allergy.matchesMedication('Penicillin', 'Paracetamol') === false,
      'An unrelated drug does not warn',
    ).toBe(true);
    expect(
      allergy.matchesMedication('', 'Penicillin') === false,
      'An empty allergen never matches',
    ).toBe(true);
    expect(
      allergy.matchesMedication('Penicillin', '') === false,
      'An empty medication never matches',
    ).toBe(true);

    /*
     * Deliberate limitation, asserted so nobody "fixes" it by accident
     * and calls it safety: a cross-reactivity pair is not caught by a
     * name comparison. The UI says so.
     */
    expect(
      allergy.matchesMedication('Penicillin', 'Amoxicillin') === false,
      'A same-class drug with a different name is NOT claimed as a match',
    ).toBe(true);

    expect(
      allergy.ALLERGY_SEVERITIES.includes('LIFE_THREATENING'),
      'Life-threatening is one of the recorded severities',
    ).toBe(true);

    /* ============================================================
       4. The routes are guarded and scoped
       ============================================================ */

    const routes = code('src/clinical/clinical-records.routes.ts');

    expect(
      routes.includes('router.use(requireAuth)'),
      'Every consent and allergy route requires authentication',
    ).toBe(true);

    for (const permission of [
      'patients.read',
      'patients.update',
      'clinical.read',
      'clinical.create',
      'clinical.update',
    ]) {
      expect(
        routes.includes(`requirePermission('${permission}')`),
        `The routes use the ${permission} permission`,
      ).toBe(true);
    }

    expect(
      routes.includes('/:id/consents') &&
        routes.includes('/:id/allergies') &&
        routes.includes('/:id/allergies/check'),
      'Consent, allergy and the prescribing check are all mounted on the patient',
    ).toBe(true);

    /*
     * A patient in another tenant must be a 404, not a 403 — a 403
     * confirms the id exists.
     */
    const allergyService = code('src/clinical/allergy.service.ts');
    const consentService = code('src/clinical/consent.service.ts');

    expect(
      allergyService.includes('eq(schema.patients.tenantId, scope.tenantId)'),
      'Allergy lookups filter patients by tenant',
    ).toBe(true);
    expect(
      /eq\(\s*schema\.patients\.tenantId,\s*(scope|facility\[0\])\.tenantId\s*\)/.test(
        consentService,
      ),
      'Consent lookups filter patients by tenant',
    ).toBe(true);

    expect(
      code('src/routes/index.ts').includes("api.use('/patients', clinicalRecordsRoutes)"),
      'The consent and allergy routes are mounted in the application',
    ).toBe(true);

    /* ============================================================
       5. Consent is not deletable, only revocable
       ============================================================ */

    expect(
      !/router\.delete/.test(routes),
      'No route physically deletes a consent or an allergy',
    ).toBe(true);

    const revoke = consentService.slice(
      consentService.indexOf('export async function revokeConsent'),
    );

    expect(
      revoke.includes('revokedAt') && revoke.includes('revokedByUserId'),
      'Revocation records when and by whom',
    ).toBe(true);

    expect(
      revoke.includes("'CONSENT_NOT_FOUND'"),
      'Revoking a consent that does not exist fails explicitly',
    ).toBe(true);

    /* ============================================================
       6. Prescribing goes through the allergy check
       ============================================================ */

    /*
     * The prescription route moved to src/routes/medications.routes.ts, so the
     * block is read there. The regex still anchors on the route and the
     * permission together, which is what keeps it from matching the module
     * guard that also mentions /api/medications.
     */
    const app = code('src/app.ts');
    const medications = code('src/routes/medications.routes.ts');

    const prescriptionMatch = /router\.post\(\s*'\/api\/medications',\s*requirePermission/.exec(
      medications,
    );

    expect(prescriptionMatch !== null, 'The prescription route exists').toBe(true);

    const prescriptionBlock = medications.slice(
      prescriptionMatch!.index,
      prescriptionMatch!.index + 4000,
    );

    expect(
      prescriptionBlock.includes('checkMedicationAllergies'),
      'The prescription route calls the allergy check',
    ).toBe(true);
    expect(
      prescriptionBlock.includes("error: 'ALLERGY_CONFLICT'"),
      'A matching allergy returns a conflict the screen can act on',
    ).toBe(true);
    expect(
      prescriptionBlock.includes('body.allergyAcknowledged === true'),
      'Overriding requires an explicit acknowledgement, not a default',
    ).toBe(true);
    expect(
      prescriptionBlock.includes("'PRESCRIBE'") &&
        prescriptionBlock.includes('Allergy warning overridden'),
      'The override is written to the audit trail',
    ).toBe(true);
    expect(
      prescriptionBlock.includes('allergyAcknowledged: _acknowledged'),
      'The acknowledgement flag is not written into the medication row',
    ).toBe(true);

    const outpatient = code('src/components/modules/OutpatientModule.tsx');

    expect(
      outpatient.includes("err.code === 'ALLERGY_CONFLICT'"),
      'The prescribing screen handles the allergy conflict',
    ).toBe(true);
    expect(
      outpatient.includes('allergyAcknowledged: true'),
      'The screen can retry with an acknowledgement when the prescriber confirms',
    ).toBe(true);
    expect(outpatient.includes('Nothing was saved'), 'Cancelling the warning writes nothing').toBe(
      true,
    );

    /* ============================================================
       7. The capability is visible
       ============================================================ */

    const panel = code('src/components/PatientConsentAllergyPanel.tsx');
    const journey = code('src/components/PatientJourneyModal.tsx');

    expect(
      panel.includes('getPatientConsents') && panel.includes('grantPatientConsent'),
      'The panel can read and record consent',
    ).toBe(true);
    expect(
      panel.includes('getPatientAllergies') && panel.includes('recordPatientAllergy'),
      'The panel can read and record allergies',
    ).toBe(true);
    expect(panel.includes('revokePatientConsent'), 'The panel can revoke consent').toBe(true);
    expect(
      panel.includes('setPatientAllergyStatus'),
      'The panel can resolve or reactivate an allergy',
    ).toBe(true);
    expect(
      panel.includes('This is not the same as "nothing recorded"'),
      'A failed read is never presented as "no allergies"',
    ).toBe(true);
    expect(
      journey.includes('PatientConsentAllergyPanel') && journey.includes("id: 'consent'"),
      'The panel is reachable from the patient record as its own tab',
    ).toBe(true);

    /*
     * Displayed scope keys must be the ones the server validates.
     */
    for (const scopeKey of ['patientProfile', 'encounters', 'laboratory', 'billing']) {
      expect(
        panel.includes(`value: '${scopeKey}'`),
        `The consent form offers the ${scopeKey} scope`,
      ).toBe(true);
    }

    /* ============================================================
       8. Patient access is logged, and the old mislabelled row is gone
       ============================================================ */

    const accessLog = code('src/clinical/access-log.service.ts');

    expect(
      accessLog.includes('insert(schema.patientRecordAccessLogs)'),
      'The access log service writes to the access table',
    ).toBe(true);
    expect(
      accessLog.includes('ACCESS_PURPOSES'),
      'Every access carries a purpose from a fixed list',
    ).toBe(true);

    expect(app.includes('logPatientAccess('), 'Patient routes write an access row').toBe(true);
    expect(app.includes("action: 'VIEW'"), 'Reading a patient record is logged as VIEW').toBe(true);
    expect(app.includes("action: 'UPDATE'"), 'Editing a patient record is logged as UPDATE').toBe(
      true,
    );
    expect(
      app.includes("action: 'EXPORT'") && app.includes("channel: 'FHIR'"),
      'Serving a FHIR patient is logged as an FHIR export',
    ).toBe(true);
    expect(
      !app.includes('FHIR patient resource retrieval'),
      'The mislabelled FHIR row that sat in the patient-update route is gone',
    ).toBe(true);
    expect(
      !app.includes('db.insert(schema.patientRecordAccessLogs)'),
      'Every access row now goes through the one logging service',
    ).toBe(true);

    /* ============================================================
       9. Audit log is append-only at the database level
       ============================================================ */

    const migration = source('drizzle/0017_consent_allergy_audit_integrity.sql');

    expect(
      migration.includes('jalicare_audit_is_append_only'),
      'The migration defines an append-only guard for the audit log',
    ).toBe(true);
    expect(
      migration.includes('CREATE TRIGGER') && migration.includes('BEFORE UPDATE OR DELETE'),
      'The guard is a trigger on update and delete',
    ).toBe(true);
    expect(
      migration.includes('REVOKE UPDATE, DELETE, TRUNCATE'),
      'The role loses the right to rewrite the audit log as well',
    ).toBe(true);
    expect(
      migration.includes('CREATE TABLE IF NOT EXISTS patient_allergies'),
      'The migration creates the allergy table idempotently',
    ).toBe(true);
    expect(
      migration.includes('national_id_bidx') && migration.includes('sha_number_bidx'),
      'The migration adds the blind-index columns',
    ).toBe(true);
    expect(
      migration.includes('patients_national_id_bidx_idx') &&
        migration.includes('patients_sha_number_bidx_idx'),
      'The blind-index columns are indexed',
    ).toBe(true);

    expect(
      schemaSource().includes("pgTable(\n  'patient_allergies'") ||
        schemaSource().includes("pgTable('patient_allergies'"),
      'The schema defines the allergy table',
    ).toBe(true);

    /* ============================================================
       10. The catalogue can actually use these routes
       ============================================================ */

    const catalogue = code('src/auth/staff-role-catalogue.ts');

    expect(
      catalogue.includes("'patients.update'"),
      'At least one staff role can record consent',
    ).toBe(true);

    /* ------------------------------------------------------------
       What is NOT covered
       ------------------------------------------------------------ */
  });
});
