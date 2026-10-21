/**
 * JaliCare HMIS
 * DHA / AfyaConnect — mock fixtures
 *
 * Deterministic responses for local development. Nothing in this file is
 * a real patient, a real facility or a real code list; every value is
 * synthetic and every response is marked `simulated: true` by the client
 * so a screen can label it.
 *
 * The fixtures are chosen to exercise the rules the documentation calls
 * out, not just the happy path:
 *
 *   - a beneficiary with POMSF-047 (scheme matching must use a prefix)
 *   - a beneficiary with no schemes (not eligible)
 *   - a beneficiary recorded as deceased (must block transactions)
 */

import type {
  DhaAuthorizationResponse,
  DhaEligibilityResponse,
  DhaIntervention,
  DhaPaginated,
  DhaVisitResponse,
} from './dha.contracts.ts';

const MOCKABLE = new Set([
  'patients.search',
  'eligibility.check',
  'coverage.benefits',
  'coverage.interventions',
  'coverage.subBenefits',
  'coverage.utilization',
  'coverage.pomsf',
  'consent.authorize',
  'claim.startVisit',
  'practitioner.search',
]);

export function isMockableOperation(operation: string): boolean {
  return MOCKABLE.has(operation);
}

function firstValue(
  source: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = source?.[key];

  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function paginated<T>(results: T[]): DhaPaginated<T> {
  return {
    count: results.length,
    currentPage: 1,
    endIndex: results.length,
    next: null,
    pageSize: results.length,
    previous: null,
    results,
    startIndex: results.length > 0 ? 1 : 0,
    totalPages: 1,
  };
}

const INTERVENTIONS: DhaIntervention[] = [
  {
    code: 'SHA-12-001',
    name: 'Outpatient consultation',
    paymentMechanism: 'FEE_FOR_SERVICE',
    needsPreauth: false,
    needsManualPreauthApproval: false,
    accessPoint: 'OP',
    fund: 'SHIF',
  },
  {
    code: 'SHA-18-005',
    name: 'Laboratory investigation',
    paymentMechanism: 'FEE_FOR_SERVICE',
    needsPreauth: false,
    needsManualPreauthApproval: false,
    accessPoint: 'OP',
    fund: 'SHIF',
  },
  {
    code: 'SHA-19-404',
    name: 'Inpatient bed day',
    paymentMechanism: 'PER_DIEM',
    needsPreauth: false,
    needsManualPreauthApproval: false,
    accessPoint: 'IP',
    fund: 'SHIF',
  },
  {
    code: 'SHA-22-010',
    name: 'Elective surgical procedure',
    paymentMechanism: 'FEE_FOR_SERVICE',
    needsPreauth: true,
    needsManualPreauthApproval: true,
    accessPoint: 'IP',
    fund: 'SHIF',
  },
];

export interface MockCall {
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
}

export function mockResponse<T>(operation: string, call: MockCall): T {
  const query = call.query as Record<string, unknown> | undefined;
  const body = call.body as Record<string, unknown> | undefined;
  const source = query ?? body;

  switch (operation) {
    case 'patients.search': {
      const id = firstValue(source, 'identification_number') ?? 'UNKNOWN';

      return {
        count: 1,
        results: [{ id: `CR-MOCK-${id}`, _simulated: true }],
        _simulated: true,
      } as unknown as T;
    }

    case 'eligibility.check': {
      const id = firstValue(source, 'identification_number') ?? '00000000';

      /* Fixed magic numbers so a tester can drive every branch. */
      if (id === '11111111') {
        return {
          requestIdNumber: id,
          requestIdType: 2,
          isAlive: false,
          schemes: [],
          statusCode: 'DECEASED',
          statusDesc: 'Beneficiary recorded as deceased (simulated fixture).',
          _simulated: true,
        } as unknown as T;
      }

      if (id === '22222222') {
        return {
          requestIdNumber: id,
          requestIdType: 2,
          isAlive: true,
          schemes: [],
          statusCode: 'NOT_ELIGIBLE',
          statusDesc: 'No active scheme (simulated fixture).',
          _simulated: true,
        } as unknown as T;
      }

      const eligible: DhaEligibilityResponse = {
        requestIdNumber: id,
        requestIdType: 2,
        age: 34,
        dateOfBirth: '1992-01-01',
        facilityBiometricsEnforced: false,
        fullName: 'SIMULATED BENEFICIARY',
        gender: 'Female',
        isAlive: true,
        memberCrNumber: `CR-MOCK-${id}`,
        schemes: [{ schemeName: 'POMSF-047' }, { schemeName: 'SHIF' }],
        statusCode: 'ELIGIBLE',
        statusDesc: 'Eligible under SHIF (simulated fixture).',
        whitelistedForOTP: true,
        _simulated: true,
      } as DhaEligibilityResponse;

      return eligible as unknown as T;
    }

    case 'coverage.benefits':
      return paginated([
        { code: 'SHA-12', name: 'Outpatient services' },
        { code: 'SHA-18', name: 'Diagnostics' },
        { code: 'SHA-19', name: 'Inpatient services' },
      ]) as unknown as T;

    case 'coverage.interventions': {
      const filter = firstValue(source, 'code');

      return paginated(
        filter ? INTERVENTIONS.filter((item) => item.code === filter) : INTERVENTIONS,
      ) as unknown as T;
    }

    case 'coverage.subBenefits':
      return paginated([
        { code: 'SHA-12-SB-01', name: 'General outpatient', tariff: null },
      ]) as unknown as T;

    case 'coverage.utilization':
      return [
        {
          code: firstValue(source, 'intervention_code') ?? 'SHA-18-005',
          crId: 'CR-MOCK-00000001',
          householdMaxLimit: 500000,
          householdUtilisedLimit: 125000,
          individualMaxLimit: 300000,
          individualUtilisedLimit: 75000,
          limitScope: 'INDIVIDUAL',
          nextAvailability: '2026-11-01',
          utilizationDays: 90,
          _simulated: true,
        },
      ] as unknown as T;

    case 'coverage.pomsf':
      return {
        memberNumber: 'CR-MOCK-00000001',
        policyCount: 1,
        schemeCount: 1,
        memberPolicies: [{ policyYear: 2026, balance: 250000 }],
        _simulated: true,
      } as unknown as T;

    case 'consent.authorize': {
      const response: DhaAuthorizationResponse = {
        authCode: 'MOCK-AUTH-0001',
        token: 'mock-consent-token',
        guid: 'mock-authorization-guid',
        status: 'AUTHORIZED',
        needsPreauth: false,
        _simulated: true,
      };

      return response as unknown as T;
    }

    case 'claim.startVisit': {
      const response: DhaVisitResponse = {
        claim_id: 900001,
        visit_number: 'VISIT-MOCK-0001',
        invoice_number: 'INV-MOCK-0001',
        authorization_code: 'MOCK-AUTH-0001',
        service_type: firstValue(source, 'service_type') ?? 'OUTPATIENT',
        scheme_name: 'SHIF',
        total_claim_amount: 0,
        total_claim_net_amount: 0,
        workflow_state: 'OPEN',
        visit_start: new Date().toISOString(),
        _simulated: true,
      };

      return response as unknown as T;
    }

    case 'practitioner.search': {
      /*
       * Deterministic fixtures for the Health Worker Registry.
       *
       * Magic registration numbers so every branch can be demonstrated:
       *
       *   KMPDC-EXPIRED-001 -> licence expired last year
       *   NCK-INACTIVE-002  -> registration withdrawn
       *   PPB-MISMATCH-003  -> record for a different person
       *   COC-MISSING-004   -> no record
       *   anything else     -> live registration, current licence
       */
      const number = firstValue(source, 'identification_number') ?? 'UNKNOWN';
      const regulator = firstValue(source, 'regulator') ?? 'KMPDC';
      const type = firstValue(source, 'identification_type') ?? 'registration_number';

      if (number === 'COC-MISSING-004') {
        return { message: null, _simulated: true } as unknown as T;
      }

      const names: Record<string, string> = {
        KMPDC: 'Dr. Amina Wanjiru Otieno',
        NCK: 'Grace Njeri Mwangi',
        COC: 'Peter Ochieng Wekesa',
        PPB: 'Samuel Kiprop Cheruiyot',
      };

      const base = {
        registrationNumber: number,
        regulator,
        profession: regulator === 'NCK' ? 'Registered Nurse' : 'Health professional',
        specialty: null as string | null,
        registrationStatus: 'Active',
        registrationDate: '2019-03-14',
        identification_type_echo: type,
        _simulated: true,
      };

      if (number === 'KMPDC-EXPIRED-001') {
        return {
          message: {
            ...base,
            regulator: 'KMPDC',
            fullName: 'Dr. Joseph Mwangi Kamau',
            licenseNumber: 'KMPDC/LIC/2019/001',
            licenseStatus: 'Expired',
            licenseExpiryDate: '2025-12-31',
          },
        } as unknown as T;
      }

      if (number === 'NCK-INACTIVE-002') {
        return {
          message: {
            ...base,
            regulator: 'NCK',
            fullName: 'Mary Atieno Odhiambo',
            registrationStatus: 'Withdrawn',
            licenseNumber: 'NCK/LIC/2018/002',
            licenseStatus: 'Expired',
            licenseExpiryDate: '2024-06-30',
          },
        } as unknown as T;
      }

      if (number === 'PPB-MISMATCH-003') {
        return {
          message: {
            ...base,
            regulator: 'PPB',
            fullName: 'Kevin Barasa Wekesa',
            licenseNumber: 'PPB/LIC/2021/003',
            licenseStatus: 'Active',
            licenseExpiryDate: '2027-01-31',
          },
        } as unknown as T;
      }

      return {
        message: {
          ...base,
          fullName: names[regulator] ?? 'Mock Practitioner',
          licenseNumber: `${regulator}/LIC/MOCK/0099`,
          licenseStatus: 'Active',
          licenseExpiryDate: '2027-12-31',
        },
      } as unknown as T;
    }

    default:
      throw new Error(`No mock fixture for operation "${operation}"`);
  }
}
