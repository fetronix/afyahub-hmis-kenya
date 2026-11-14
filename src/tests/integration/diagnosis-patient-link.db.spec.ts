/**
 * Regression: the scoped diagnosis read must not expose a mislinked diagnosis.
 *
 * THE DEFECT
 * ----------
 * A `diagnoses` row carries both its own `patient_id` and the `encounter_id` it
 * belongs to, and the schema does not force the two to agree.
 * `recordDiagnosisScoped` refuses to create a mismatch, but rows can still
 * disagree — written before that guard existed, or by any future path that
 * forgets to check. `getDiagnosesScoped` filtered only on the encounter (or
 * only on the patient plus the encounter's facility), so it returned such a
 * row anyway.
 *
 * The consequence is a cross-patient disclosure: reading patient B's encounter
 * returned patient A's diagnosis, complete with its ICD code and description.
 * The outpatient diagnosis register in the report centre already treats the
 * same row as untrustworthy and reports "Inconsistent patient link; details
 * withheld"; the read path was the weaker of the two.
 *
 * WHAT IS ASSERTED
 * ----------------
 *  1. An encounter-scoped read returns only diagnoses whose patient owns that
 *     encounter.
 *  2. A patient-scoped read returns only diagnoses attached to that patient's
 *     own encounters.
 *  3. Correctly linked diagnoses are still returned — the fix must not
 *     over-filter and break the ordinary case.
 *  4. The mislinked row is not deleted or mutated by the read.
 *  5. Facility scoping for a patient's other-facility encounters still holds.
 *
 * The mislinked rows below are inserted directly with SQL precisely because no
 * service path will create them. That is the point: the read must be safe
 * against data the application itself would refuse to write.
 *
 * Synthetic data only. No real patient or clinical data.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb(
  'Scoped diagnosis reads withhold mislinked patient records (synthetic PostgreSQL)',
  () => {
    const suffix = randomUUID().slice(0, 8);
    let tenant: number;
    let facility: number;
    let otherFacility: number;
    let base: string;
    let close: () => Promise<void>;
    let token: string;
    let serial = 0;

    /** A patient in the given facility. */
    const makePatient = async (facilityId: number, label: string) =>
      (
        await pool.query(
          `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
         VALUES($1,$2,$3,'Synthetic','Link','2000-01-01','Other') RETURNING id`,
          [tenant, facilityId, `LINK-${label}-${suffix}-${++serial}`],
        )
      ).rows[0].id as number;

    const makeEncounter = async (facilityId: number, patientId: number) =>
      (
        await pool.query(
          `INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status)
         VALUES($1,$2,$3,'OUTPATIENT','ACTIVE') RETURNING id`,
          [tenant, facilityId, patientId],
        )
      ).rows[0].id as number;

    /**
     * Insert a diagnosis directly. `patientId` and `encounterId` are given
     * independently so a caller can create the mismatch no service will write.
     */
    const makeDiagnosis = async (encounterId: number, patientId: number, code: string) =>
      (
        await pool.query(
          `INSERT INTO diagnoses(encounter_id,patient_id,coding_system,icd10_code,icd10_description,diagnosis_code,diagnosis_display)
         VALUES($1,$2,'ICD-10',$3,$4,$3,$4) RETURNING id`,
          [encounterId, patientId, code, `Synthetic ${code}`],
        )
      ).rows[0].id as number;

    /**
     * Per-test fixtures so the tests never share mutable state.
     *
     * Two mismatches are created, one in each direction, because the two read
     * paths are guarded by different conditions and a fixture that only covers
     * one direction silently passes when the other guard is missing:
     *
     *   foreignDiagnosis  patient = other,  encounter = owner's
     *                     -> must not appear when reading that encounter
     *   foreignEncounter  patient = owner,  encounter = other's
     *                     -> must not appear when reading owner as a patient
     */
    const scenario = async (facilityId = facility) => {
      const owner = await makePatient(facilityId, 'owner');
      const other = await makePatient(facilityId, 'other');
      const encounter = await makeEncounter(facilityId, owner);
      const otherEncounter = await makeEncounter(facilityId, other);

      /* Patient `other`'s diagnosis attached to `owner`'s encounter. */
      const foreignDiagnosis = await makeDiagnosis(encounter, other, `MIS-X-${++serial}`);
      /* `owner`'s diagnosis attached to `other`'s encounter. */
      const foreignEncounter = await makeDiagnosis(otherEncounter, owner, `MIS-E-${++serial}`);
      /* A legitimate diagnosis on the owner's encounter, so no test can pass by
       simply returning nothing. */
      const legitimate = await makeDiagnosis(encounter, owner, `LEG-${++serial}`);

      return {
        owner,
        other,
        encounter,
        otherEncounter,
        foreignDiagnosis,
        foreignEncounter,
        legitimate,
      };
    };

    const readDiagnoses = (query: string) =>
      httpJson<Array<{ id: number; patientId: number; encounterId: number }>>(
        base,
        'GET',
        `/api/diagnoses?${query}`,
        { token },
      );

    beforeAll(async () => {
      if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
        throw new Error('Synthetic DB required.');

      tenant = (
        await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
          `Synthetic diagnosis link tenant ${suffix}`,
          `diag-link-${suffix}`,
        ])
      ).rows[0].id as number;

      [facility, otherFacility] = (
        await pool.query(
          `INSERT INTO facilities(tenant_id,code,name,timezone,enabled_modules)
         VALUES($1,$2,'Synthetic diagnosis facility','Africa/Nairobi','["opd"]'),
               ($1,$3,'Synthetic diagnosis peer facility','Africa/Nairobi','["opd"]')
         RETURNING id`,
          [tenant, `DL-A-${suffix}`, `DL-B-${suffix}`],
        )
      ).rows.map((row) => row.id as number);

      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES('clinical.read','clinical.read','clinical') ON CONFLICT(code) DO NOTHING",
      );

      const actor = (
        await pool.query(
          `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
         VALUES($1,$1,$2,'Synthetic diagnosis reader','test-only','ACTIVE',$3,$4) RETURNING id`,
          [`diag-${suffix}`, `diag-${suffix}@example.test`, tenant, facility],
        )
      ).rows[0].id as number;

      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [tenant, `DIAG_READER_${suffix}`],
        )
      ).rows[0].id as number;

      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [actor, role]);
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [role, 'clinical.read'],
      );

      token = (await createSession({ userId: actor, securityVersion: 1 })).sessionToken;

      const { createApp } = await import('../../app.ts');
      const started = await startTestServer(await createApp());
      base = started.baseUrl;
      close = started.close;
    }, 120_000);

    afterAll(async () => {
      await close?.();
    });

    it('does not return another patient diagnosis when reading an encounter', async () => {
      const { owner, encounter, foreignDiagnosis, legitimate } = await scenario();

      const response = await readDiagnoses(`encounterId=${encounter}&facilityId=${facility}`);

      expect(response.status).toBe(200);
      const ids = response.body.map((row) => row.id);

      /* The legitimate diagnosis is still served — the fix is not a blanket deny. */
      expect(ids, 'the correctly linked diagnosis is returned').toContain(legitimate);
      /* The mislinked row is withheld. */
      expect(ids, 'another patient diagnosis is withheld from the encounter read').not.toContain(
        foreignDiagnosis,
      );
      /* Every row that is served names the patient who owns the encounter. */
      expect(
        response.body.every((row) => Number(row.patientId) === owner),
        'every served row belongs to the encounter patient',
      ).toBe(true);
    });

    it('does not return a diagnosis attached to another patient encounter when reading a patient', async () => {
      const { owner, foreignEncounter, legitimate } = await scenario();

      const response = await readDiagnoses(`patientId=${owner}&facilityId=${facility}`);

      expect(response.status).toBe(200);
      const ids = response.body.map((row) => row.id);

      expect(ids, 'the correctly linked diagnosis is returned').toContain(legitimate);
      expect(ids, 'a diagnosis anchored to another patient encounter is withheld').not.toContain(
        foreignEncounter,
      );
    });

    it('leaves the mislinked row in place rather than deleting or rewriting it', async () => {
      /* A read must not mutate clinical data, and the row must remain available
       to an authorised reviewer through the diagnosis register. */
      const { encounter, other, foreignDiagnosis } = await scenario();

      await readDiagnoses(`encounterId=${encounter}&facilityId=${facility}`);

      const row = (
        await pool.query('SELECT encounter_id, patient_id FROM diagnoses WHERE id=$1', [
          foreignDiagnosis,
        ])
      ).rows[0];

      expect(row, 'the mislinked diagnosis still exists').toBeTruthy();
      expect(Number(row.patient_id), 'its patient is unchanged').toBe(other);
      expect(Number(row.encounter_id), 'its encounter is unchanged').toBe(encounter);
    });

    it('still withholds a mislinked diagnosis when filtering by the other patient', async () => {
      /* Reading the patient the diagnosis names is not a licence to serve a row
       anchored to a different patient's encounter. */
      const { other, foreignDiagnosis } = await scenario();

      const response = await readDiagnoses(`patientId=${other}&facilityId=${facility}`);

      expect(response.status).toBe(200);
      expect(response.body.map((row) => row.id)).not.toContain(foreignDiagnosis);
    });

    it('does not expose a correct diagnosis from another facility to a facility-scoped reader', async () => {
      /* Guards the pre-existing facility rule, which the fix must not weaken. */
      const outOfFacility = await scenario(otherFacility);

      const response = await readDiagnoses(
        `patientId=${outOfFacility.owner}&facilityId=${facility}`,
      );

      /* The patient is outside this facility, so the scoped load refuses it
       rather than answering with another facility's clinical record. */
      expect([403, 404]).toContain(response.status);
    });

    it('refuses an unfiltered read rather than answering with every diagnosis', async () => {
      const response = await httpJson(base, 'GET', `/api/diagnoses?facilityId=${facility}`, {
        token,
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    });
  },
);
