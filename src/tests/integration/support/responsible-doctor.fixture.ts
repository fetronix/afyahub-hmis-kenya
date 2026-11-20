/** Additive, independently attested disposable fixtures; never use deployment credentials. */
import { randomBytes, randomUUID } from 'node:crypto';
import { pool } from '../../../db/index.ts';
import { hashPassword } from '../../../utils/password.ts';
import { createSession } from '../../../auth/session.service.ts';

export async function assertDoctorScratch() {
  if (
    process.env.SQL_HOST !== '127.0.0.1' ||
    process.env.SQL_DB_NAME !== 'clinical_documents_synthetic_test' ||
    !/^\d{1,20}$/.test(process.env.SYRONA_TEST_PG_SYSTEM_IDENTIFIER ?? '') ||
    !process.env.CLINICAL_TEST_PG_DATA_DIRECTORY
  )
    throw Error('Explicit independently attested disposable clinical database required');
  const row = (
    await pool.query(
      "SELECT current_database() AS name,inet_server_addr()::text AS address,system_identifier::text AS cluster,current_setting('data_directory') AS directory FROM pg_control_system()",
    )
  ).rows[0];
  if (
    row.name !== process.env.SQL_DB_NAME ||
    !['127.0.0.1', '127.0.0.1/32'].includes(row.address) ||
    row.cluster !== process.env.SYRONA_TEST_PG_SYSTEM_IDENTIFIER ||
    row.directory !== process.env.CLINICAL_TEST_PG_DATA_DIRECTORY
  )
    throw Error('Disposable clinical cluster identity mismatch');
}
export async function createResponsibleDoctorFixture() {
  await assertDoctorScratch();
  const suffix = randomUUID().slice(0, 8),
    password = randomBytes(24).toString('base64url');
  const tenant = (
    await pool.query(
      "INSERT INTO tenants(name,slug) VALUES('Synthetic responsible doctor test',$1) RETURNING id",
      ['doctor-' + suffix],
    )
  ).rows[0].id as number;
  const facilities = (
    await pool.query(
      'INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,\'Synthetic doctor main\',\'["registration","radiology","opd","laboratory","pharmacy","finance"]\'),($1,$3,\'Synthetic doctor sibling\',\'["registration","radiology","opd","laboratory","pharmacy","finance"]\') RETURNING id',
      [tenant, 'doctor-a-' + suffix, 'doctor-b-' + suffix],
    )
  ).rows;
  const facility = facilities[0].id as number,
    sibling = facilities[1].id as number;
  // Read-only prerequisites for the existing patient journey loader; no unrelated write grants.
  const base = [
    'patients.read',
    'patients.documents.read',
    'patients.documents.upload',
    'clinical.read',
    'laboratory.read',
    'pharmacy.read',
    'billing.read',
  ];
  for (const code of [...base, 'patients.update', 'patients.documents.release'])
    await pool.query(
      "INSERT INTO permissions(code,name,module) VALUES($1,$1,'patients') ON CONFLICT(code) DO NOTHING",
      [code],
    );
  async function role(name: string, codes: string[]) {
    const id = (
      await pool.query('INSERT INTO roles(tenant_id,name) VALUES($1,$2) RETURNING id', [
        tenant,
        name,
      ])
    ).rows[0].id as number;
    await pool.query(
      'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=ANY($2::text[])',
      [id, codes],
    );
    return id;
  }
  const doctorRole = await role('DOCTOR', base),
    staffRole = await role('RECORDS_' + suffix, [
      ...base,
      'patients.update',
      'patients.documents.release',
    ]),
    uploaderRole = await role('UPLOADER_' + suffix, base);
  const hash = await hashPassword(password);
  async function user(
    label: string,
    roleId: number,
    fac = facility,
    status = 'ACTIVE',
    active = true,
  ) {
    const username = `doctor_${label}_${suffix}`.toLowerCase(),
      name = `Synthetic ${label.replaceAll('_', ' ')}`;
    const id = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,designation,password_hash,tenant_id,facility_id,account_status,is_active) VALUES($1,$1,$2,$3,'Medical officer',$4,$5,$6,$7,$8) RETURNING id",
        [username, username + '@example.test', name, hash, tenant, fac, status, active],
      )
    ).rows[0].id as number;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, roleId]);
    const token = (await createSession({ userId: id, securityVersion: 1 })).sessionToken;
    return { id, username, name, token };
  }
  const doctorA = await user('Doctor_A', doctorRole),
    doctorB = await user('Doctor_B', doctorRole),
    staff = await user('Records', staffRole),
    unauthorized = await user('Uploader', uploaderRole);
  const inactive = await user('Inactive', doctorRole, facility, 'ACTIVE', false),
    suspended = await user('Suspended', doctorRole, facility, 'SUSPENDED'),
    cross = await user('Cross_facility', doctorRole, sibling),
    revoked = await user('Revoked', doctorRole),
    deactivated = await user('Deactivated', doctorRole),
    locked = await user('Locked', doctorRole);
  await pool.query('UPDATE user_roles SET revoked_at=now() WHERE user_id=$1', [revoked.id]);
  await pool.query('UPDATE users SET deactivated_at=now() WHERE id=$1', [deactivated.id]);
  await pool.query("UPDATE users SET locked_until=now()+interval '1 hour' WHERE id=$1", [
    locked.id,
  ]);
  const patient = (
    await pool.query(
      "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Doctor Assignment','2000-01-01','Other') RETURNING id",
      [tenant, facility, 'DOC-' + suffix],
    )
  ).rows[0].id as number;
  return {
    tenant,
    facility,
    sibling,
    patient,
    password,
    doctorRole,
    doctorA,
    doctorB,
    staff,
    unauthorized,
    inactive,
    suspended,
    cross,
    revoked,
    deactivated,
    locked,
  };
}
