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
import { containsCode } from './support/source-text.ts';

import { describe, expect, it } from 'vitest';

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

describe('Professional verification tests', () => {
  it('1. CONTRACTS', async () => {
    expect(REGULATORS.length, 'four regulators are published').toBe(4);
    expect(
      REGULATORS.map((regulator) => regulator.code).join(','),
      'the regulator enum matches the published endpoint',
    ).toBe('KMPDC,NCK,COC,PPB');

    for (const regulator of REGULATORS) {
      expect(regulator.apiSupported, `${regulator.code} is API-supported`).toBe(true);
      expect(
        regulator.website.startsWith('https://'),
        `${regulator.code} carries an https source`,
      ).toBe(true);
    }

    expect(regulatorForStaffRole('DOCTOR')?.code, 'doctors map to KMPDC').toBe('KMPDC');
    expect(regulatorForStaffRole('NURSE')?.code, 'nurses map to NCK').toBe('NCK');
    expect(regulatorForStaffRole('PHARMACIST')?.code, 'pharmacists map to PPB').toBe('PPB');
    expect(regulatorForStaffRole('CLINICAL_OFFICER')?.code, 'clinical officers map to COC').toBe(
      'COC',
    );
    expect(regulatorForStaffRole('RECEPTIONIST') ?? null, 'receptionists have no regulator').toBe(
      null,
    );
    expect(
      regulatorForStaffRole('laboratory_technician') ?? null,
      'lab technologists have no mapped regulator',
    ).toBe(null);

    expect(requiresProfessionalVerification('DOCTOR'), 'doctors need verification').toBe(true);
    expect(requiresProfessionalVerification('nurse'), 'role matching is case-insensitive').toBe(
      true,
    );
    expect(!requiresProfessionalVerification('BILLING_CLERK'), 'billing clerks do not').toBe(true);
    expect(
      !requiresProfessionalVerification('LABORATORY_TECHNICIAN'),
      'lab technologists are excluded because no authorised endpoint exists for KMLTTB',
    ).toBe(true);
    expect(CLINICAL_STAFF_ROLES.length, 'four clinical roles are gated').toBe(4);

    /* Vocabulary */
    const statuses: VerificationStatus[] = [
      'NOT_VERIFIED',
      'PENDING',
      'REGISTRATION_VERIFIED',
      'LICENCE_CONFIRMED',
      'LICENCE_EXPIRED',
      'REGISTRATION_INACTIVE',
      'IDENTITY_MISMATCH',
      'RECORD_NOT_FOUND',
      'SERVICE_UNAVAILABLE',
      'MANUAL_REVIEW_REQUIRED',
      'MANUALLY_VERIFIED',
    ];

    for (const status of statuses) {
      expect(Boolean(STATUS_LABELS[status]), `${status} has a label`).toBe(true);
    }

    expect(isInvitableStatus('REGISTRATION_VERIFIED'), 'registration verified is invitable').toBe(
      true,
    );
    expect(isInvitableStatus('MANUALLY_VERIFIED'), 'manual verification is invitable').toBe(true);
    expect(!isInvitableStatus('LICENCE_EXPIRED'), 'an expired licence is not invitable').toBe(true);
    expect(!isInvitableStatus('SERVICE_UNAVAILABLE'), 'an outage is not an invitation gate').toBe(
      true,
    );
    expect(!isInvitableStatus('IDENTITY_MISMATCH'), 'a mismatch is not invitable').toBe(true);

    expect(HWR_ENDPOINTS.practitioner, 'the documented path is used').toBe('/professionals');
    expect(
      PRACTITIONER_IDENTIFICATION_TYPES[0],
      'registration number is the preferred identifier',
    ).toBe('registration_number');
    expect(
      !(PRACTITIONER_IDENTIFICATION_TYPES as readonly string[]).includes('license_number'),
      'license_number is not offered because the endpoint enum does not list it',
    ).toBe(true);

    expect(regulatorByCode('kmpdc')?.code, 'regulator codes are case-insensitive').toBe('KMPDC');
    expect(regulatorByCode('NCA') ?? null, 'an unknown regulator is rejected').toBe(null);
  });

  it('2. NORMALISATION', async () => {
    /* A complete record with a live licence. */
    const confirmed = normalise(
      {
        fullName: 'Amina Wanjiru Otieno',
        registrationNumber: 'MED12345',
        licenseNumber: 'KMPDC/LIC/1',
        licenseStatus: 'Active',
        licenseExpiryDate: '2027-12-31',
        registrationStatus: 'Active',
      },
      'Dr Amina Wanjiru Otieno',
    );

    expect(confirmed.status, 'a live licence is confirmed').toBe('LICENCE_CONFIRMED');
    expect(confirmed.record.fullName, 'the name is captured').toBe('Amina Wanjiru Otieno');
    expect(confirmed.warnings.length, 'a clean record raises no warnings').toBe(0);

    /* Registration only — must not be promoted to a licence. */
    const registrationOnly = normalise(
      {
        fullName: 'Amina Wanjiru Otieno',
        registrationNumber: 'MED12345',
        registrationStatus: 'Active',
      },
      'Amina Otieno',
    );

    expect(registrationOnly.status, 'registration alone is not a licence').toBe(
      'REGISTRATION_VERIFIED',
    );
    expect(
      registrationOnly.warnings.some((warning) => warning.includes('not a licence')),
      'the screen is told a registration is not a licence',
    ).toBe(true);

    /* Expiry date in the past. */
    const expired = normalise(
      {
        fullName: 'Joseph Mwangi Kamau',
        licenseStatus: 'Active',
        licenseExpiryDate: '2025-12-31',
      },
      'Joseph Kamau',
    );

    expect(expired.status, 'a past expiry date expires the licence').toBe('LICENCE_EXPIRED');

    /* Explicit expired status with no date. */
    const expiredStatus = normalise(
      {
        fullName: 'Joseph Mwangi Kamau',
        licenseStatus: 'Expired',
      },
      'Joseph Kamau',
    );

    expect(expiredStatus.status, 'an expired status expires the licence').toBe('LICENCE_EXPIRED');

    /* Registration withdrawn beats any licence text. */
    const withdrawn = normalise(
      {
        fullName: 'Mary Atieno Odhiambo',
        registrationStatus: 'Withdrawn',
        licenseStatus: 'Active',
        licenseExpiryDate: '2027-01-01',
      },
      'Mary Odhiambo',
    );

    expect(withdrawn.status, 'a withdrawn registration wins').toBe('REGISTRATION_INACTIVE');

    /* Identity mismatch. */
    const mismatch = normalise(
      {
        fullName: 'Kevin Barasa Wekesa',
        licenseStatus: 'Active',
        licenseExpiryDate: '2027-01-01',
      },
      'Samuel Kiprop Cheruiyot',
    );

    expect(mismatch.status, 'a different person is a mismatch').toBe('IDENTITY_MISMATCH');
    expect(mismatch.warnings.length > 0, 'the mismatch is explained').toBe(true);

    /* Partial name match is a warning, not a verdict. */
    const partial = normalise(
      {
        fullName: 'Amina Wanjiru Otieno',
        licenseStatus: 'Active',
        licenseExpiryDate: '2027-01-01',
      },
      'Amina Otieno',
    );

    expect(partial.status, 'a shorter but consistent name passes').toBe('LICENCE_CONFIRMED');
    expect(partial.warnings.length > 0, 'the difference is still surfaced').toBe(true);

    /* No record. */
    const notFound = normalise(null);
    expect(notFound.status, 'an empty body is no record').toBe('RECORD_NOT_FOUND');
    expect(notFound.warnings[0].includes('MED12345'), 'the number is echoed back').toBe(true);

    /* Several records. */
    const multiple = normalise([{ fullName: 'A B' }, { fullName: 'C D' }]);
    expect(multiple.status, 'several matches need a human').toBe('MANUAL_REVIEW_REQUIRED');

    /* A shape this build does not recognise must not be guessed at. */
    const unknown = normalise({ foo: 'bar', baz: 42 });
    expect(unknown.status, 'an unknown shape is not verified').toBe('MANUAL_REVIEW_REQUIRED');
    expect(unknown.unrecognisedKeys.includes('foo'), 'unrecognised keys are reported').toBe(true);
    expect(!unknown.unrecognisedKeys.includes('bar'), 'values are never reported as keys').toBe(
      true,
    );

    /* Nested envelope. */
    const nested = normalise(
      {
        data: {
          fullName: 'Amina Otieno',
          licenseStatus: 'Active',
          licenseExpiryDate: '2027-01-01',
        },
      },
      'Amina Otieno',
    );
    expect(nested.status, 'a nested record is unwrapped').toBe('LICENCE_CONFIRMED');

    /* dd/mm/yyyy. */
    const ddmm = normalise(
      { fullName: 'Amina Otieno', licenseStatus: 'Active', licenseExpiryDate: '31/12/2026' },
      'Amina Otieno',
    );
    expect(ddmm.status, 'dd/mm/yyyy is understood').toBe('LICENCE_CONFIRMED');

    /* Provisional mapping is declared. */
    expect(confirmed.mapping, 'the response mapping is declared provisional').toBe('provisional');
  });

  it('Name Matching', async () => {
    expect(
      namesPlausiblyMatch('Dr. Amina Otieno', 'Amina Wanjiru Otieno'),
      'honorifics and extra names pass',
    ).toBe(true);
    expect(
      namesPlausiblyMatch('OTIENO AMINA', 'amina otieno'),
      'case and order do not matter',
    ).toBe(true);
    expect(!namesPlausiblyMatch('Kevin Wekesa', 'Samuel Cheruiyot'), 'unrelated names fail').toBe(
      true,
    );
    expect(namesPlausiblyMatch('A Otieno', 'Amina Otieno'), 'initials do not block a match').toBe(
      true,
    );
  });

  it('3. MOCK FIXTURES', async () => {
    const config = loadDhaConfig({
      mode: 'mock',
      baseUrl: null,
      clientId: null,
      clientSecret: null,
      facilityCode: null,
    });

    async function lookup(number: string, regulator = 'KMPDC') {
      const response = await dhaCall<{ message?: unknown }>(
        config,
        {},
        {
          operation: 'practitioner.search',
          method: 'GET',
          path: HWR_ENDPOINTS.practitioner,
          query: {
            identification_number: number,
            identification_type: 'registration_number',
            regulator,
          },
        },
      );

      return {
        response,
        result: normalisePractitioner({
          message: response.data?.message ?? null,
          regulator,
          identificationNumber: number,
          expectedFullName: null,
          now: NOW,
        }),
      };
    }

    const live = await lookup('KMPDC-OK-100');
    expect(live.response.simulated, 'mock results are marked simulated').toBe(true);
    expect(live.result.status, 'the live fixture is licence-confirmed').toBe('LICENCE_CONFIRMED');

    const expired = await lookup('KMPDC-EXPIRED-001');
    expect(expired.result.status, 'the expired fixture is expired').toBe('LICENCE_EXPIRED');

    const inactive = await lookup('NCK-INACTIVE-002', 'NCK');
    expect(inactive.result.status, 'the inactive fixture is inactive').toBe(
      'REGISTRATION_INACTIVE',
    );

    const missing = await lookup('COC-MISSING-004', 'COC');
    expect(missing.result.status, 'the missing fixture is not found').toBe('RECORD_NOT_FOUND');

    const mismatch = await lookup('PPB-MISMATCH-003', 'PPB');
    const mismatched = normalisePractitioner({
      message: (mismatch.response.data as { message?: unknown }).message,
      regulator: 'PPB',
      identificationNumber: 'PPB-MISMATCH-003',
      expectedFullName: 'Samuel Kiprop Cheruiyot',
      now: NOW,
    });
    expect(mismatched.status, 'the mismatch fixture disagrees by name').toBe('IDENTITY_MISMATCH');

    /* Determinism. */
    const again = await lookup('KMPDC-OK-100');
    expect(JSON.stringify(live.response.data), 'mock fixtures are deterministic').toBe(
      JSON.stringify(again.response.data),
    );
  });

  it('4. HONESTY AND WIRING', async () => {
    const service = readRepoFile(
      'src/integrations/professional/professional-verification.service.ts',
    );
    const routes = readRepoFile('src/auth/staff-invitation.routes.ts');
    const invitationService = readRepoFile('src/auth/staff-invitation.service.ts');

    /* A timeout may not erase a verified credential. */
    expect(
      service.includes("normalisation.status === 'SERVICE_UNAVAILABLE' && existing"),
      'an outage preserves the previous credential status',
    ).toBe(true);
    expect(
      service.includes('This is not a failed credential check'),
      'the outage wording says what it is not',
    ).toBe(true);

    /* Mock can never unlock an invitation. */
    expect(
      service.includes("credential.mode === 'mock'"),
      'mock-mode credentials are refused at the invitation gate',
    ).toBe(true);
    expect(service.includes('SIMULATED_VERIFICATION'), 'the refusal has a named code').toBe(true);
    expect(
      service.includes('!simulated && isInvitableStatus'),
      'a simulated result is never invitable',
    ).toBe(true);

    /* The gate is wired in exactly one place. */
    expect(
      invitationService.includes('assertInvitationCredential'),
      'invitation creation calls the verification gate',
    ).toBe(true);

    /* Secrets never reach the client. */
    expect(!/console\.log/.test(service), 'the service writes nothing to stdout').toBe(true);
    expect(
      !service.includes('access_token') && !service.includes('clientSecret'),
      'the service never handles a token or secret directly',
    ).toBe(true);

    /* Routes. */
    for (const route of [
      '/regulators',
      '/verify-practitioner',
      '/manual-verification',
      '/verification-dashboard',
    ]) {
      expect(containsCode(routes, `"${route}"`), `${route} is registered`).toBe(true);
    }

    expect(
      containsCode(routes, 'requirePermission("users.invite")'),
      'verification requires the invitation permission',
    ).toBe(true);

    /* Data minimisation: no national ID column on the credential table. */
    const schema = schemaSource();
    const tableStart = schema.indexOf('export const staffProfessionalCredentials');
    const tableEnd = schema.indexOf('export const professionalVerificationEvents');
    const table = schema.slice(tableStart, tableEnd);

    expect(!table.includes('nationalId'), 'the credential table stores no national ID').toBe(true);
    expect(!table.includes('dateOfBirth'), 'the credential table stores no date of birth').toBe(
      true,
    );
    expect(table.includes('licenceExpiry'), 'the licence expiry is retained').toBe(true);
    expect(table.includes('registrationStatus'), 'registration status is a separate field').toBe(
      true,
    );
    expect(table.includes('licenceStatus'), 'licence status is a separate field').toBe(true);
  });

  it('Migration', async () => {
    const sql = readRepoFile('drizzle/0014_professional_verification.sql');

    expect(
      sql.includes('CREATE TABLE IF NOT EXISTS "staff_professional_credentials"'),
      'credentials table is guarded',
    ).toBe(true);
    expect(
      sql.includes('CREATE TABLE IF NOT EXISTS "professional_verification_events"'),
      'events table is guarded',
    ).toBe(true);
    expect(!/DROP\s+TABLE/i.test(sql), 'the migration drops nothing').toBe(true);
    expect(!/TRUNCATE/i.test(sql), 'the migration truncates nothing').toBe(true);
    expect(!/DELETE\s+FROM/i.test(sql), 'the migration deletes no rows').toBe(true);
    expect(
      sql.includes('staff_professional_credentials_facility_registration_idx'),
      'a duplicate registration is prevented',
    ).toBe(true);

    const journal = JSON.parse(readRepoFile('drizzle/meta/_journal.json')) as {
      entries: Array<{ idx: number; tag: string }>;
    };

    expect(
      journal.entries.some((entry) => entry.tag === '0014_professional_verification'),
      'the journal lists 0014',
    ).toBe(true);

    /*
     * The count was pinned at fifteen here, which meant every later
     * migration broke this suite for no clinical reason. What matters is
     * that 0014 is the fourteenth entry and that nothing follows it out of
     * order — the ordering itself is checked by test:migrations.
     */
    const entry = journal.entries.find(
      (candidate) => candidate.tag === '0014_professional_verification',
    );

    expect(entry?.idx, '0014 is the fourteenth migration').toBe(14);
  });
});
