import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import {
  changePortalPassword,
  portalLogin,
  resolvePortalSession,
  revokePortalSession,
} from '../../portal/portal-auth.service.ts';
import { hashPassword } from '../../utils/password.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('Phase 1 patient portal isolation (synthetic PostgreSQL)', () => {
  const suffix = randomUUID().slice(0, 8);
  const password = randomBytes(24).toString('base64url');
  const wrongPassword = randomBytes(24).toString('base64url');
  let tenant: number, foreignTenant: number;
  let registration: number, accountFacility: number, otherFacility: number, foreignFacility: number;
  let patient: number, otherPatient: number, foreignPatient: number, lockPatient: number;
  let token: string, otherToken: string, foreignToken: string;
  let staffToken: string, foreignStaffToken: string, limitedStaffToken: string;
  let lockAccount: number, lockIdentifier: string;
  let base: string, close: () => Promise<void>;

  const contains = (value: unknown, marker: string) => JSON.stringify(value).includes(marker);
  const call = (path: string, bearer?: string) =>
    httpJson(base, 'GET', path, bearer ? { token: bearer } : {});
  const post = (path: string, body: unknown, bearer?: string) =>
    httpJson(base, 'POST', path, { body, ...(bearer ? { token: bearer } : {}) });

  async function staff(tenantId: number, facilityId: number, label: string, canRead: boolean) {
    const role = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [tenantId, `SYN-PORTAL-${label}-${suffix}`],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO permissions(code,name,module) VALUES('patients.read','patients.read','synthetic') ON CONFLICT(code) DO NOTHING`,
    );
    if (canRead) {
      await pool.query(
        "INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code='patients.read'",
        [role],
      );
    }
    const id = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
         VALUES($1,$1,$2,'Synthetic staff',$3,'ACTIVE',$4,$5) RETURNING id`,
        [
          `syn-portal-${label}-${suffix}`,
          `syn-portal-${label}-${suffix}@example.test`,
          randomBytes(24).toString('hex'),
          tenantId,
          facilityId,
        ],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
    return (await createSession({ userId: id, securityVersion: 1 })).sessionToken;
  }

  async function newPatient(tenantId: number, facilityId: number, label: string) {
    const result = await pool.query(
      `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
       VALUES($1,$2,$3,'Synthetic',$4,'2000-01-01','Other') RETURNING id`,
      [tenantId, facilityId, `SYN-P1-${label}-${suffix}`, label],
    );
    return result.rows[0].id as number;
  }

  async function account(tenantId: number, facilityId: number, patientId: number, label: string) {
    const identifier = `synthetic-${label}-${suffix}@example.test`;
    const result = await pool.query(
      `INSERT INTO patient_portal_accounts(tenant_id,facility_id,patient_id,login_identifier,login_type,password_hash,status)
       VALUES($1,$2,$3,$4,'EMAIL',$5,'ACTIVE') RETURNING id`,
      [tenantId, facilityId, patientId, identifier, await hashPassword(password)],
    );
    return { id: result.rows[0].id as number, identifier };
  }

  async function result(
    tenantId: number,
    facilityId: number,
    orderPatient: number,
    resultPatient: number,
    marker: string,
    status = 'Verified',
  ) {
    const order = await pool.query(
      `INSERT INTO lab_orders(tenant_id,facility_id,patient_id,test_name,status)
       VALUES($1,$2,$3,'Synthetic order','Completed') RETURNING id`,
      [tenantId, facilityId, orderPatient],
    );
    await pool.query(
      `INSERT INTO lab_results(order_id,patient_id,parameter_name,measured_value,status,verified_at)
       VALUES($1,$2,$3,'synthetic', $4, CASE WHEN $4 = 'Verified' THEN NOW() ELSE NULL END)`,
      [order.rows[0].id, resultPatient, marker, status],
    );
  }

  beforeAll(async () => {
    [tenant, foreignTenant] = (
      await pool.query(`INSERT INTO tenants(name,slug) VALUES($1,$2),($3,$4) RETURNING id`, [
        `Synthetic phase 1 ${suffix}`,
        `syn-p1-${suffix}`,
        `Synthetic foreign ${suffix}`,
        `syn-p1-x-${suffix}`,
      ])
    ).rows.map((row) => row.id as number);
    [registration, accountFacility, otherFacility] = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules)
         VALUES($1,$2,'Synthetic registration','[]'),($1,$3,'Synthetic account','[]'),($1,$4,'Synthetic other','[]') RETURNING id`,
        [tenant, `P1-R-${suffix}`, `P1-A-${suffix}`, `P1-O-${suffix}`],
      )
    ).rows.map((row) => row.id as number);
    foreignFacility = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules)
         VALUES($1,$2,'Synthetic foreign','[]') RETURNING id`,
        [foreignTenant, `P1-X-${suffix}`],
      )
    ).rows[0].id;
    patient = await newPatient(tenant, registration, 'A');
    otherPatient = await newPatient(tenant, registration, 'B');
    foreignPatient = await newPatient(foreignTenant, foreignFacility, 'C');
    lockPatient = await newPatient(tenant, registration, 'Lock');

    const a = await account(tenant, accountFacility, patient, 'a');
    const b = await account(tenant, registration, otherPatient, 'b');
    const c = await account(foreignTenant, foreignFacility, foreignPatient, 'c');
    const locked = await account(tenant, registration, lockPatient, 'lock');
    lockAccount = locked.id;
    lockIdentifier = locked.identifier;
    token = (await portalLogin({ identifier: a.identifier, password })).sessionToken;
    otherToken = (await portalLogin({ identifier: b.identifier, password })).sessionToken;
    foreignToken = (await portalLogin({ identifier: c.identifier, password })).sessionToken;
    staffToken = await staff(tenant, accountFacility, 'reader', true);
    limitedStaffToken = await staff(tenant, accountFacility, 'limited', false);
    foreignStaffToken = await staff(foreignTenant, foreignFacility, 'foreign', true);

    await result(tenant, registration, patient, patient, 'VISIBLE_REGISTRATION');
    await result(tenant, accountFacility, patient, patient, 'VISIBLE_ACCOUNT');
    await result(tenant, otherFacility, patient, patient, 'DENY_OTHER_FACILITY');
    await result(foreignTenant, foreignFacility, patient, patient, 'DENY_FOREIGN_TENANT');
    await result(tenant, registration, otherPatient, otherPatient, 'VISIBLE_OTHER_PATIENT');
    await result(tenant, registration, patient, otherPatient, 'DENY_RESULT_PATIENT_MISMATCH');
    await result(tenant, registration, otherPatient, patient, 'DENY_ORDER_PATIENT_MISMATCH');
    await result(
      tenant,
      registration,
      patient,
      patient,
      'DENY_PENDING_RESULT',
      'Pending Verification',
    );
    await result(foreignTenant, registration, patient, patient, 'DENY_INCONSISTENT_ORDER_TENANT');

    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });

  afterAll(async () => {
    if (close) await close();
  });

  it('requires a portal session and scopes overview, laboratory and download results', async () => {
    expect((await call('/api/portal/overview')).status).toBe(401);
    const overview = await call('/api/portal/overview', token);
    const laboratory = await call('/api/portal/laboratory', token);
    const download = await call('/api/portal/records/download', token);
    for (const response of [overview, laboratory, download]) {
      expect(response.status).toBe(200);
      expect(contains(response.body, 'VISIBLE_REGISTRATION')).toBe(true);
      expect(contains(response.body, 'VISIBLE_ACCOUNT')).toBe(true);
      for (const marker of [
        'DENY_OTHER_FACILITY',
        'DENY_FOREIGN_TENANT',
        'VISIBLE_OTHER_PATIENT',
        'DENY_RESULT_PATIENT_MISMATCH',
        'DENY_ORDER_PATIENT_MISMATCH',
        'DENY_PENDING_RESULT',
        'DENY_INCONSISTENT_ORDER_TENANT',
      ]) {
        expect(contains(response.body, marker)).toBe(false);
      }
    }
  });

  it('does not transfer another patient or tenant result through a valid session', async () => {
    const b = await call('/api/portal/laboratory', otherToken);
    const foreign = await call('/api/portal/overview', foreignToken);
    expect(b.status).toBe(200);
    expect(contains(b.body, 'VISIBLE_OTHER_PATIENT')).toBe(true);
    for (const response of [b, foreign]) {
      expect(response.status).toBe(200);
      expect(contains(response.body, 'VISIBLE_REGISTRATION')).toBe(false);
      expect(contains(response.body, 'VISIBLE_ACCOUNT')).toBe(false);
      expect(contains(response.body, 'DENY_RESULT_PATIENT_MISMATCH')).toBe(false);
      expect(contains(response.body, 'DENY_ORDER_PATIENT_MISMATCH')).toBe(false);
    }
  });

  it('honours the existing account-facility laboratory switch in all three responses', async () => {
    await pool.query(
      `INSERT INTO patient_portal_settings(tenant_id,facility_id,show_lab_results)
       VALUES($1,$2,false) ON CONFLICT(facility_id) DO UPDATE SET show_lab_results=false`,
      [tenant, accountFacility],
    );
    try {
      const overview = await call('/api/portal/overview', token);
      const laboratory = await call('/api/portal/laboratory', token);
      const download = await call('/api/portal/records/download', token);
      expect(overview.status).toBe(200);
      expect(laboratory.status).toBe(403);
      expect(download.status).toBe(200);
      expect(contains(overview.body, 'VISIBLE_REGISTRATION')).toBe(false);
      expect(contains(download.body, 'VISIBLE_REGISTRATION')).toBe(false);
      expect(contains(overview.body, 'VISIBLE_ACCOUNT')).toBe(false);
      expect(contains(download.body, 'VISIBLE_ACCOUNT')).toBe(false);
    } finally {
      await pool.query(
        'UPDATE patient_portal_settings SET show_lab_results=true WHERE facility_id=$1',
        [accountFacility],
      );
    }
  });

  describe('sharing requests', () => {
    async function createGrant() {
      const response = await post(
        '/api/portal/sharing',
        {
          recipientName: `Synthetic recipient ${suffix}`,
          purpose: 'Synthetic care coordination',
          categories: ['laboratory'],
          hours: 2,
        },
        token,
      );
      expect(response.status).toBe(201);
      expect(response.body.message).toContain('recipient name is not verified');
      return { id: response.body.grantId as number, code: response.body.code as string };
    }

    it('denies unauthorized and foreign redemption, and permits exactly one concurrent use', async () => {
      const grant = await createGrant();
      const path = '/api/portal/admin/sharing/redeem';
      expect((await post(path, { code: grant.code })).status).toBe(401);
      expect((await post(path, { code: grant.code }, limitedStaffToken)).status).toBe(403);
      expect((await post(path, { code: grant.code }, foreignStaffToken)).status).toBe(404);
      const both = await Promise.all([
        post(path, { code: grant.code }, staffToken),
        post(path, { code: grant.code }, staffToken),
      ]);
      expect(both.map((response) => response.status).sort()).toEqual([200, 410]);
      const access = await pool.query(
        `SELECT count(*)::int AS count FROM patient_record_access_logs
         WHERE record_type='PatientRecordSharingGrant' AND record_id=$1 AND action='SHARE'`,
        [grant.id],
      );
      expect(access.rows[0].count).toBe(1);
      const audit = await pool.query(
        `SELECT details FROM audit_logs WHERE resource='PatientRecordSharingGrant' AND resource_id=$1`,
        [String(grant.id)],
      );
      expect(
        audit.rows.filter((row) => row.details === 'Staff redeemed a sharing request'),
      ).toHaveLength(1);
      expect(
        audit.rows.some((row) => String(row.details).includes(`Synthetic recipient ${suffix}`)),
      ).toBe(false);
    });

    it('prevents cross-patient revocation and refuses a grant revoked by its owner', async () => {
      const grant = await createGrant();
      const revokePath = `/api/portal/sharing/${grant.id}/revoke`;
      expect((await post(revokePath, {}, otherToken)).status).toBe(404);
      expect((await post(revokePath, {}, token)).status).toBe(200);
      const redeem = await post(
        '/api/portal/admin/sharing/redeem',
        { code: grant.code },
        staffToken,
      );
      expect(redeem.status).toBe(410);
      expect(redeem.body.error).toBe('GRANT_REVOKED');
    });

    it('serializes a concurrent owner revocation and redemption', async () => {
      const grant = await createGrant();
      const [revocation, redemption] = await Promise.all([
        post(`/api/portal/sharing/${grant.id}/revoke`, {}, token),
        post('/api/portal/admin/sharing/redeem', { code: grant.code }, staffToken),
      ]);
      expect(revocation.status).toBe(200);
      expect([200, 410]).toContain(redemption.status);
      const row = (
        await pool.query(
          'SELECT revoked_at,redeemed_at FROM patient_record_sharing_grants WHERE id=$1',
          [grant.id],
        )
      ).rows[0];
      expect(row.revoked_at).not.toBeNull();
      if (redemption.status === 410) {
        expect(row.redeemed_at).toBeNull();
        expect(redemption.body.error).toBe('GRANT_REVOKED');
      } else {
        expect(row.redeemed_at).not.toBeNull();
        expect(row.redeemed_at.getTime()).toBeLessThanOrEqual(row.revoked_at.getTime());
      }
    });

    it('rolls back redemption when its security audit cannot be recorded', async () => {
      const grant = await createGrant();
      const functionName = `phase1_share_audit_${suffix}`;
      const triggerName = `phase1_share_audit_trigger_${suffix}`;
      await pool.query(
        `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN IF NEW.resource='PatientRecordSharingGrant' AND NEW.resource_id='${grant.id}'
           AND NEW.action='VIEW' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF;
         RETURN NEW; END $$`,
      );
      await pool.query(
        `CREATE TRIGGER ${triggerName} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
      );
      try {
        expect(
          (await post('/api/portal/admin/sharing/redeem', { code: grant.code }, staffToken)).status,
        ).toBe(500);
        const row = (
          await pool.query('SELECT redeemed_at FROM patient_record_sharing_grants WHERE id=$1', [
            grant.id,
          ])
        ).rows[0];
        expect(row.redeemed_at).toBeNull();
        const access = await pool.query(
          `SELECT count(*)::int AS count FROM patient_record_access_logs WHERE record_type='PatientRecordSharingGrant' AND record_id=$1 AND action='SHARE'`,
          [grant.id],
        );
        expect(access.rows[0].count).toBe(0);
      } finally {
        await pool.query(`DROP TRIGGER ${triggerName} ON audit_logs`);
        await pool.query(`DROP FUNCTION ${functionName}()`);
      }
      expect(
        (await post('/api/portal/admin/sharing/redeem', { code: grant.code }, staffToken)).status,
      ).toBe(200);
    });
  });

  describe('password-change session invalidation', () => {
    async function identity(label: string) {
      const id = await newPatient(tenant, registration, `Password-${label}`);
      return account(tenant, registration, id, `password-${label}`);
    }

    it('atomically changes the password and revokes all existing sessions', async () => {
      const identityA = await identity('change');
      const first = await portalLogin({ identifier: identityA.identifier, password });
      const second = await portalLogin({ identifier: identityA.identifier, password });
      const nextPassword = randomBytes(24).toString('base64url');
      const changed = await post(
        '/api/portal/password',
        {
          currentPassword: password,
          newPassword: nextPassword,
          confirmPassword: nextPassword,
        },
        first.sessionToken,
      );
      expect(changed.status).toBe(200);
      expect(changed.body.sessionsRevoked).toBe(2);
      expect(changed.body.message).toContain('including this one');
      expect((await call('/api/portal/overview', first.sessionToken)).status).toBe(401);
      expect((await call('/api/portal/overview', second.sessionToken)).status).toBe(401);
      await expect(
        portalLogin({ identifier: identityA.identifier, password }),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      expect(
        (await portalLogin({ identifier: identityA.identifier, password: nextPassword })).account
          .id,
      ).toBe(identityA.id);
    });

    it('rejects an incorrect current password without revoking the session', async () => {
      const identityA = await identity('incorrect');
      const existing = await portalLogin({ identifier: identityA.identifier, password });
      const nextPassword = randomBytes(24).toString('base64url');
      const changed = await post(
        '/api/portal/password',
        {
          currentPassword: 'not-the-current-password',
          newPassword: nextPassword,
          confirmPassword: nextPassword,
        },
        existing.sessionToken,
      );
      expect(changed.status).toBe(400);
      expect(changed.body.error).toBe('INVALID_PASSWORD');
      expect((await call('/api/portal/overview', existing.sessionToken)).status).toBe(200);
      expect((await portalLogin({ identifier: identityA.identifier, password })).account.id).toBe(
        identityA.id,
      );
    });

    it('revalidates a resolved session after a concurrent logout', async () => {
      const identityA = await identity('logged-out');
      const existing = await portalLogin({ identifier: identityA.identifier, password });
      const resolved = await resolvePortalSession(existing.sessionToken);
      expect(resolved).not.toBeNull();
      if (!resolved) throw new Error('Synthetic portal session was not resolved.');
      await revokePortalSession(existing.sessionToken, 'Synthetic test logout');
      const nextPassword = randomBytes(24).toString('base64url');
      await expect(
        changePortalPassword(resolved, {
          currentPassword: password,
          newPassword: nextPassword,
          confirmPassword: nextPassword,
        }),
      ).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
      expect((await portalLogin({ identifier: identityA.identifier, password })).account.id).toBe(
        identityA.id,
      );
    });

    it('does not leave a usable old-password session after a concurrent password change', async () => {
      const identityA = await identity('race');
      const existing = await portalLogin({ identifier: identityA.identifier, password });
      const nextPassword = randomBytes(24).toString('base64url');
      const [loginAttempt, changeAttempt] = await Promise.allSettled([
        portalLogin({ identifier: identityA.identifier, password }),
        post(
          '/api/portal/password',
          {
            currentPassword: password,
            newPassword: nextPassword,
            confirmPassword: nextPassword,
          },
          existing.sessionToken,
        ),
      ]);
      expect(changeAttempt.status).toBe('fulfilled');
      if (changeAttempt.status !== 'fulfilled') return;
      expect(changeAttempt.value.status).toBe(200);
      if (loginAttempt.status === 'fulfilled') {
        expect((await call('/api/portal/overview', loginAttempt.value.sessionToken)).status).toBe(
          401,
        );
      } else {
        expect(loginAttempt.reason.code).toBe('INVALID_CREDENTIALS');
      }
      expect(
        (await portalLogin({ identifier: identityA.identifier, password: nextPassword })).account
          .id,
      ).toBe(identityA.id);
    });

    it('rolls back the password and session changes if the security audit fails', async () => {
      const identityA = await identity('audit-failure');
      const existing = await portalLogin({ identifier: identityA.identifier, password });
      const nextPassword = randomBytes(24).toString('base64url');
      const before = (
        await pool.query(
          'SELECT password_hash,security_version FROM patient_portal_accounts WHERE id=$1',
          [identityA.id],
        )
      ).rows[0];
      const functionName = `phase1_password_audit_fail_${suffix}`;
      const triggerName = `phase1_password_audit_trigger_${suffix}`;
      await pool.query(
        `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN IF NEW.resource='PatientPortalAccount' AND NEW.action='UPDATE' AND NEW.resource_id='${identityA.id}'
           THEN RAISE EXCEPTION 'Synthetic password audit failure'; END IF;
         RETURN NEW; END $$`,
      );
      await pool.query(
        `CREATE TRIGGER ${triggerName} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
      );
      try {
        const changed = await post(
          '/api/portal/password',
          {
            currentPassword: password,
            newPassword: nextPassword,
            confirmPassword: nextPassword,
          },
          existing.sessionToken,
        );
        expect(changed.status).toBe(500);
        const after = (
          await pool.query(
            'SELECT password_hash,security_version FROM patient_portal_accounts WHERE id=$1',
            [identityA.id],
          )
        ).rows[0];
        expect(after.password_hash === before.password_hash).toBe(true);
        expect(after.security_version).toBe(before.security_version);
        expect((await call('/api/portal/overview', existing.sessionToken)).status).toBe(200);
      } finally {
        await pool.query(`DROP TRIGGER ${triggerName} ON audit_logs`);
        await pool.query(`DROP FUNCTION ${functionName}()`);
      }
      expect((await portalLogin({ identifier: identityA.identifier, password })).account.id).toBe(
        identityA.id,
      );
    });

    it('rolls back the password and session changes if revocation fails', async () => {
      const identityA = await identity('failure');
      const existing = await portalLogin({ identifier: identityA.identifier, password });
      const nextPassword = randomBytes(24).toString('base64url');
      const before = (
        await pool.query(
          'SELECT password_hash,security_version FROM patient_portal_accounts WHERE id=$1',
          [identityA.id],
        )
      ).rows[0];
      const functionName = `phase1_session_fail_${suffix}`;
      const triggerName = `phase1_session_fail_trigger_${suffix}`;
      await pool.query(
        `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN IF NEW.account_id=${identityA.id} AND NEW.revoked_at IS NOT NULL
           THEN RAISE EXCEPTION 'Synthetic session revocation failure'; END IF;
         RETURN NEW; END $$`,
      );
      await pool.query(
        `CREATE TRIGGER ${triggerName} BEFORE UPDATE ON patient_portal_sessions FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
      );
      try {
        const changed = await post(
          '/api/portal/password',
          {
            currentPassword: password,
            newPassword: nextPassword,
            confirmPassword: nextPassword,
          },
          existing.sessionToken,
        );
        expect(changed.status).toBe(500);
        const after = (
          await pool.query(
            'SELECT password_hash,security_version FROM patient_portal_accounts WHERE id=$1',
            [identityA.id],
          )
        ).rows[0];
        expect(after.password_hash === before.password_hash).toBe(true);
        expect(after.security_version).toBe(before.security_version);
        expect((await call('/api/portal/overview', existing.sessionToken)).status).toBe(200);
      } finally {
        await pool.query(`DROP TRIGGER ${triggerName} ON patient_portal_sessions`);
        await pool.query(`DROP FUNCTION ${functionName}()`);
      }
      expect((await portalLogin({ identifier: identityA.identifier, password })).account.id).toBe(
        identityA.id,
      );
      await expect(
        portalLogin({ identifier: identityA.identifier, password: nextPassword }),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });
  });

  describe('per-account lockout', () => {
    it('serializes concurrent failures, retains the active lock, and allows sign-in only after expiry', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          portalLogin({ identifier: lockIdentifier, password: wrongPassword }),
        ),
      );
      expect(
        results.every(
          (entry) => entry.status === 'rejected' && entry.reason.code === 'INVALID_CREDENTIALS',
        ),
      ).toBe(true);
      const first = (
        await pool.query(
          'SELECT failed_login_attempts,locked_until FROM patient_portal_accounts WHERE id=$1',
          [lockAccount],
        )
      ).rows[0];
      expect(first.failed_login_attempts).toBe(0);
      expect(first.locked_until).not.toBeNull();
      const lockTime = first.locked_until.getTime();
      await expect(
        portalLogin({ identifier: lockIdentifier, password: wrongPassword }),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      const after = (
        await pool.query(
          'SELECT failed_login_attempts,locked_until FROM patient_portal_accounts WHERE id=$1',
          [lockAccount],
        )
      ).rows[0];
      expect(after.failed_login_attempts).toBe(0);
      expect(after.locked_until.getTime()).toBe(lockTime);
      await expect(portalLogin({ identifier: lockIdentifier, password })).rejects.toMatchObject({
        code: 'ACCOUNT_LOCKED',
      });
      await pool.query('UPDATE patient_portal_accounts SET locked_until=$2 WHERE id=$1', [
        lockAccount,
        new Date(Date.now() - 60_000).toISOString(),
      ]);
      const signedIn = await portalLogin({ identifier: lockIdentifier, password });
      expect(signedIn.account.id).toBe(lockAccount);
      const reset = (
        await pool.query(
          'SELECT failed_login_attempts,locked_until FROM patient_portal_accounts WHERE id=$1',
          [lockAccount],
        )
      ).rows[0];
      expect(reset.failed_login_attempts).toBe(0);
      expect(reset.locked_until).toBeNull();
    });
  });
});
