/**
 * JaliCare HMIS
 * Professional verification tests
 *
 * These are mostly honesty tests. The interesting failures in this feature
 * are not stack traces — they are the ways a system can quietly claim
 * more than it knows:
 *
 *   - calling a registration a licence
 *   - calling a timeout a failed check
 *   - calling a mock "verified"
 *   - letting a mismatch through because the name was "close enough"
 *
 * Run with: npx tsx src/tests/professional-verification.test.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CLINICAL_STAFF_ROLES,
  REGULATORS,
  STATUS_LABELS,
  isInvitableStatus,
  regulatorByCode,
  regulatorForStaffRole,
  requiresProfessionalVerification,
  PRACTITIONER_IDENTIFICATION_TYPES,
  HWR_ENDPOINTS,
  type VerificationStatus,
} from '../integrations/professional/practitioner.contracts.ts';

import {
  namesPlausiblyMatch,
  normalisePractitioner,
} from '../integrations/professional/practitioner.normalise.ts';

import { dhaCall } from '../integrations/dha/dha.client.ts';
import { loadDhaConfig } from '../integrations/dha/dha.config.ts';
import { schemaSource } from './support/schema-source.ts';

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;
  if (!condition) throw new Error(`FAILED: ${label}`);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(actual === expected, `${label} (expected ${String(expected)}, got ${String(actual)})`);
}

function readRepoFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const NOW = new Date('2026-10-21T12:00:00Z');

function normalise(message: unknown, expectedFullName: string | null = null) {
  return normalisePractitioner({
    message,
    regulator: 'KMPDC',
    identificationNumber: 'MED12345',
    expectedFullName,
    now: NOW,
  });
}

/* ============================================================
   1. CONTRACTS
   ============================================================ */

function testContracts(): void {
  assertEqual(REGULATORS.length, 4, 'four regulators are published');
  assertEqual(
    REGULATORS.map((regulator) => regulator.code).join(','),
    'KMPDC,NCK,COC,PPB',
    'the regulator enum matches the published endpoint',
  );

  for (const regulator of REGULATORS) {
    assert(regulator.apiSupported, `${regulator.code} is API-supported`);
    assert(regulator.website.startsWith('https://'), `${regulator.code} carries an https source`);
  }

  assertEqual(regulatorForStaffRole('DOCTOR')?.code, 'KMPDC', 'doctors map to KMPDC');
  assertEqual(regulatorForStaffRole('NURSE')?.code, 'NCK', 'nurses map to NCK');
  assertEqual(regulatorForStaffRole('PHARMACIST')?.code, 'PPB', 'pharmacists map to PPB');
  assertEqual(regulatorForStaffRole('CLINICAL_OFFICER')?.code, 'COC', 'clinical officers map to COC');
  assertEqual(regulatorForStaffRole('RECEPTIONIST') ?? null, null, 'receptionists have no regulator');
  assertEqual(regulatorForStaffRole('laboratory_technician') ?? null, null, 'lab technologists have no mapped regulator');

  assert(requiresProfessionalVerification('DOCTOR'), 'doctors need verification');
  assert(requiresProfessionalVerification('nurse'), 'role matching is case-insensitive');
  assert(!requiresProfessionalVerification('BILLING_CLERK'), 'billing clerks do not');
  assert(
    !requiresProfessionalVerification('LABORATORY_TECHNICIAN'),
    'lab technologists are excluded because no authorised endpoint exists for KMLTTB',
  );
  assertEqual(CLINICAL_STAFF_ROLES.length, 4, 'four clinical roles are gated');

  /* Vocabulary */
  const statuses: VerificationStatus[] = [
    'NOT_VERIFIED', 'PENDING', 'REGISTRATION_VERIFIED', 'LICENCE_CONFIRMED',
    'LICENCE_EXPIRED', 'REGISTRATION_INACTIVE', 'IDENTITY_MISMATCH',
    'RECORD_NOT_FOUND', 'SERVICE_UNAVAILABLE', 'MANUAL_REVIEW_REQUIRED',
    'MANUALLY_VERIFIED',
  ];

  for (const status of statuses) {
    assert(Boolean(STATUS_LABELS[status]), `${status} has a label`);
  }

  assert(isInvitableStatus('REGISTRATION_VERIFIED'), 'registration verified is invitable');
  assert(isInvitableStatus('MANUALLY_VERIFIED'), 'manual verification is invitable');
  assert(!isInvitableStatus('LICENCE_EXPIRED'), 'an expired licence is not invitable');
  assert(!isInvitableStatus('SERVICE_UNAVAILABLE'), 'an outage is not an invitation gate');
  assert(!isInvitableStatus('IDENTITY_MISMATCH'), 'a mismatch is not invitable');

  assertEqual(HWR_ENDPOINTS.practitioner, '/professionals', 'the documented path is used');
  assertEqual(PRACTITIONER_IDENTIFICATION_TYPES[0], 'registration_number', 'registration number is the preferred identifier');
  assert(
    !(PRACTITIONER_IDENTIFICATION_TYPES as readonly string[]).includes('license_number'),
    'license_number is not offered because the endpoint enum does not list it',
  );

  assertEqual(regulatorByCode('kmpdc')?.code, 'KMPDC', 'regulator codes are case-insensitive');
  assertEqual(regulatorByCode('NCA') ?? null, null, 'an unknown regulator is rejected');
}

/* ============================================================
   2. NORMALISATION
   ============================================================ */

function testNormalisation(): void {
  /* A complete record with a live licence. */
  const confirmed = normalise({
    fullName: 'Amina Wanjiru Otieno',
    registrationNumber: 'MED12345',
    licenseNumber: 'KMPDC/LIC/1',
    licenseStatus: 'Active',
    licenseExpiryDate: '2027-12-31',
    registrationStatus: 'Active',
  }, 'Dr Amina Wanjiru Otieno');

  assertEqual(confirmed.status, 'LICENCE_CONFIRMED', 'a live licence is confirmed');
  assertEqual(confirmed.record.fullName, 'Amina Wanjiru Otieno', 'the name is captured');
  assertEqual(confirmed.warnings.length, 0, 'a clean record raises no warnings');

  /* Registration only — must not be promoted to a licence. */
  const registrationOnly = normalise({
    fullName: 'Amina Wanjiru Otieno',
    registrationNumber: 'MED12345',
    registrationStatus: 'Active',
  }, 'Amina Otieno');

  assertEqual(registrationOnly.status, 'REGISTRATION_VERIFIED', 'registration alone is not a licence');
  assert(
    registrationOnly.warnings.some((warning) => warning.includes('not a licence')),
    'the screen is told a registration is not a licence',
  );

  /* Expiry date in the past. */
  const expired = normalise({
    fullName: 'Joseph Mwangi Kamau',
    licenseStatus: 'Active',
    licenseExpiryDate: '2025-12-31',
  }, 'Joseph Kamau');

  assertEqual(expired.status, 'LICENCE_EXPIRED', 'a past expiry date expires the licence');

  /* Explicit expired status with no date. */
  const expiredStatus = normalise({
    fullName: 'Joseph Mwangi Kamau',
    licenseStatus: 'Expired',
  }, 'Joseph Kamau');

  assertEqual(expiredStatus.status, 'LICENCE_EXPIRED', 'an expired status expires the licence');

  /* Registration withdrawn beats any licence text. */
  const withdrawn = normalise({
    fullName: 'Mary Atieno Odhiambo',
    registrationStatus: 'Withdrawn',
    licenseStatus: 'Active',
    licenseExpiryDate: '2027-01-01',
  }, 'Mary Odhiambo');

  assertEqual(withdrawn.status, 'REGISTRATION_INACTIVE', 'a withdrawn registration wins');

  /* Identity mismatch. */
  const mismatch = normalise({
    fullName: 'Kevin Barasa Wekesa',
    licenseStatus: 'Active',
    licenseExpiryDate: '2027-01-01',
  }, 'Samuel Kiprop Cheruiyot');

  assertEqual(mismatch.status, 'IDENTITY_MISMATCH', 'a different person is a mismatch');
  assert(mismatch.warnings.length > 0, 'the mismatch is explained');

  /* Partial name match is a warning, not a verdict. */
  const partial = normalise({
    fullName: 'Amina Wanjiru Otieno',
    licenseStatus: 'Active',
    licenseExpiryDate: '2027-01-01',
  }, 'Amina Otieno');

  assertEqual(partial.status, 'LICENCE_CONFIRMED', 'a shorter but consistent name passes');
  assert(partial.warnings.length > 0, 'the difference is still surfaced');

  /* No record. */
  const notFound = normalise(null);
  assertEqual(notFound.status, 'RECORD_NOT_FOUND', 'an empty body is no record');
  assert(notFound.warnings[0].includes('MED12345'), 'the number is echoed back');

  /* Several records. */
  const multiple = normalise([{ fullName: 'A B' }, { fullName: 'C D' }]);
  assertEqual(multiple.status, 'MANUAL_REVIEW_REQUIRED', 'several matches need a human');

  /* A shape this build does not recognise must not be guessed at. */
  const unknown = normalise({ foo: 'bar', baz: 42 });
  assertEqual(unknown.status, 'MANUAL_REVIEW_REQUIRED', 'an unknown shape is not verified');
  assert(unknown.unrecognisedKeys.includes('foo'), 'unrecognised keys are reported');
  assert(!unknown.unrecognisedKeys.includes('bar'), 'values are never reported as keys');

  /* Nested envelope. */
  const nested = normalise({ data: { fullName: 'Amina Otieno', licenseStatus: 'Active', licenseExpiryDate: '2027-01-01' } }, 'Amina Otieno');
  assertEqual(nested.status, 'LICENCE_CONFIRMED', 'a nested record is unwrapped');

  /* dd/mm/yyyy. */
  const ddmm = normalise({ fullName: 'Amina Otieno', licenseStatus: 'Active', licenseExpiryDate: '31/12/2026' }, 'Amina Otieno');
  assertEqual(ddmm.status, 'LICENCE_CONFIRMED', 'dd/mm/yyyy is understood');

  /* Provisional mapping is declared. */
  assertEqual(confirmed.mapping, 'provisional', 'the response mapping is declared provisional');
}

function testNameMatching(): void {
  assert(namesPlausiblyMatch('Dr. Amina Otieno', 'Amina Wanjiru Otieno'), 'honorifics and extra names pass');
  assert(namesPlausiblyMatch('OTIENO AMINA', 'amina otieno'), 'case and order do not matter');
  assert(!namesPlausiblyMatch('Kevin Wekesa', 'Samuel Cheruiyot'), 'unrelated names fail');
  assert(namesPlausiblyMatch('A Otieno', 'Amina Otieno'), 'initials do not block a match');
}

/* ============================================================
   3. MOCK FIXTURES
   ============================================================ */

async function testMockFixture(): Promise<void> {
  const config = loadDhaConfig({ mode: 'mock', baseUrl: null, clientId: null, clientSecret: null, facilityCode: null });

  async function lookup(number: string, regulator = 'KMPDC') {
    const response = await dhaCall<{ message?: unknown }>(config, {}, {
      operation: 'practitioner.search',
      method: 'GET',
      path: HWR_ENDPOINTS.practitioner,
      query: {
        identification_number: number,
        identification_type: 'registration_number',
        regulator,
      },
    });

    return { response, result: normalisePractitioner({
      message: response.data?.message ?? null,
      regulator,
      identificationNumber: number,
      expectedFullName: null,
      now: NOW,
    }) };
  }

  const live = await lookup('KMPDC-OK-100');
  assertEqual(live.response.simulated, true, 'mock results are marked simulated');
  assertEqual(live.result.status, 'LICENCE_CONFIRMED', 'the live fixture is licence-confirmed');

  const expired = await lookup('KMPDC-EXPIRED-001');
  assertEqual(expired.result.status, 'LICENCE_EXPIRED', 'the expired fixture is expired');

  const inactive = await lookup('NCK-INACTIVE-002', 'NCK');
  assertEqual(inactive.result.status, 'REGISTRATION_INACTIVE', 'the inactive fixture is inactive');

  const missing = await lookup('COC-MISSING-004', 'COC');
  assertEqual(missing.result.status, 'RECORD_NOT_FOUND', 'the missing fixture is not found');

  const mismatch = await lookup('PPB-MISMATCH-003', 'PPB');
  const mismatched = normalisePractitioner({
    message: (mismatch.response.data as { message?: unknown }).message,
    regulator: 'PPB',
    identificationNumber: 'PPB-MISMATCH-003',
    expectedFullName: 'Samuel Kiprop Cheruiyot',
    now: NOW,
  });
  assertEqual(mismatched.status, 'IDENTITY_MISMATCH', 'the mismatch fixture disagrees by name');

  /* Determinism. */
  const again = await lookup('KMPDC-OK-100');
  assertEqual(
    JSON.stringify(live.response.data),
    JSON.stringify(again.response.data),
    'mock fixtures are deterministic',
  );
}

/* ============================================================
   4. HONESTY AND WIRING
   ============================================================ */

function testHonestyAndWiring(): void {
  const service = readRepoFile('src/integrations/professional/professional-verification.service.ts');
  const routes = readRepoFile('src/auth/staff-invitation.routes.ts');
  const invitationService = readRepoFile('src/auth/staff-invitation.service.ts');

  /* A timeout may not erase a verified credential. */
  assert(
    service.includes("normalisation.status === 'SERVICE_UNAVAILABLE' && existing"),
    'an outage preserves the previous credential status',
  );
  assert(
    service.includes('This is not a failed credential check'),
    'the outage wording says what it is not',
  );

  /* Mock can never unlock an invitation. */
  assert(
    service.includes("credential.mode === 'mock'"),
    'mock-mode credentials are refused at the invitation gate',
  );
  assert(
    service.includes('SIMULATED_VERIFICATION'),
    'the refusal has a named code',
  );
  assert(
    service.includes('!simulated && isInvitableStatus'),
    'a simulated result is never invitable',
  );

  /* The gate is wired in exactly one place. */
  assert(
    invitationService.includes('assertInvitationCredential'),
    'invitation creation calls the verification gate',
  );

  /* Secrets never reach the client. */
  assert(!/console\.log/.test(service), 'the service writes nothing to stdout');
  assert(
    !service.includes('access_token') && !service.includes('clientSecret'),
    'the service never handles a token or secret directly',
  );

  /* Routes. */
  for (const route of [
    '/regulators',
    '/verify-practitioner',
    '/manual-verification',
    '/verification-dashboard',
  ]) {
    assert(routes.includes(`"${route}"`), `${route} is registered`);
  }

  assert(
    routes.includes('requirePermission("users.invite")'),
    'verification requires the invitation permission',
  );

  /* Data minimisation: no national ID column on the credential table. */
  const schema = schemaSource();
  const tableStart = schema.indexOf("export const staffProfessionalCredentials");
  const tableEnd = schema.indexOf('export const professionalVerificationEvents');
  const table = schema.slice(tableStart, tableEnd);

  assert(!table.includes('nationalId'), 'the credential table stores no national ID');
  assert(!table.includes('dateOfBirth'), 'the credential table stores no date of birth');
  assert(table.includes("licenceExpiry"), 'the licence expiry is retained');
  assert(table.includes("registrationStatus"), 'registration status is a separate field');
  assert(table.includes("licenceStatus"), 'licence status is a separate field');
}

function testMigration(): void {
  const sql = readRepoFile('drizzle/0014_professional_verification.sql');

  assert(sql.includes('CREATE TABLE IF NOT EXISTS "staff_professional_credentials"'), 'credentials table is guarded');
  assert(sql.includes('CREATE TABLE IF NOT EXISTS "professional_verification_events"'), 'events table is guarded');
  assert(!/DROP\s+TABLE/i.test(sql), 'the migration drops nothing');
  assert(!/TRUNCATE/i.test(sql), 'the migration truncates nothing');
  assert(!/DELETE\s+FROM/i.test(sql), 'the migration deletes no rows');
  assert(sql.includes('staff_professional_credentials_facility_registration_idx'), 'a duplicate registration is prevented');

  const journal = JSON.parse(readRepoFile('drizzle/meta/_journal.json')) as {
    entries: Array<{ idx: number; tag: string }>;
  };

  assert(
    journal.entries.some((entry) => entry.tag === '0014_professional_verification'),
    'the journal lists 0014',
  );

  /*
   * The count was pinned at fifteen here, which meant every later
   * migration broke this suite for no clinical reason. What matters is
   * that 0014 is the fourteenth entry and that nothing follows it out of
   * order — the ordering itself is checked by test:migrations.
   */
  const entry = journal.entries.find(
    (candidate) => candidate.tag === '0014_professional_verification',
  );

  assertEqual(entry?.idx, 14, '0014 is the fourteenth migration');
}

/* ============================================================
   RUN
   ============================================================ */

async function run(): Promise<void> {
  console.log('');
  console.log('PROFESSIONAL VERIFICATION TESTS');
  console.log('==============================================');

  testContracts();
  console.log('  1. Regulators, roles and the status vocabulary');

  testNormalisation();
  console.log('  2. Registration is not a licence');

  testNameMatching();
  console.log('  3. Name comparison is generous but not blind');

  await testMockFixture();
  console.log('  4. Mock fixtures are deterministic and labelled');

  testHonestyAndWiring();
  console.log('  5. Outages, mock mode and data minimisation');

  testMigration();
  console.log('  6. The migration is additive');

  console.log('');
  console.log('==============================================');
  console.log(`PROFESSIONAL VERIFICATION TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

run().catch((error) => {
  console.error('');
  console.error('==============================================');
  console.error('PROFESSIONAL VERIFICATION TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
});
