import { describe, expect, it } from 'vitest';
import {
  evaluatePrivateClaimValidation,
  type PrivateClaimValidationInput,
} from '../insurance/claims/private-claims.service.ts';

// Test-only policy, codes and monetary values: not payer approval or official tariff data.
function validClaim(): PrivateClaimValidationInput {
  return {
    payerCode: 'TEST_ONLY',
    memberStatus: 'ACTIVE',
    memberNumber: 'TEST-MEMBER',
    policyNumber: 'TEST-POLICY',
    policyValidFrom: '2026-01-01',
    policyValidTo: '2026-12-31',
    requireVerifiedEligibility: true,
    eligibilityOutcome: 'Eligible',
    serviceDateStart: '2026-06-01',
    serviceDateEnd: '2026-06-01',
    encounterType: 'OPD',
    currency: 'KES',
    diagnoses: [{ code: 'TEST-ONLY', display: 'Synthetic diagnosis', system: 'TEST-CODING' }],
    attachments: [
      {
        documentType: 'ITEMIZED_INVOICE',
        fileName: 'invoice.test',
        storageReference: 'test://invoice',
      },
      { documentType: 'SIGNED_CLAIM_FORM', fileName: 'form.test', storageReference: 'test://form' },
    ],
    claimRequirements: {
      requirePolicyNumber: true,
      requireInvoiceAttachment: true,
      requireSignedClaimForm: true,
      maxSubmissionDays: 30,
      allowedCodingSystems: ['TEST-CODING'],
      codingPolicyVerified: true,
      codingPolicyEvidence: 'synthetic fixture evidence',
    },
    preauthRequirements: {},
    preauthStatus: null,
    preauthReference: null,
    hasDuplicateActiveClaim: false,
    grossCents: 10000,
    discountCents: 1000,
    copayCents: 500,
    proposedClaimCents: 8500,
    lines: [
      {
        lineNumber: 1,
        itemDescription: 'Synthetic service',
        serviceCategory: 'OTHER',
        mappingStatus: 'MAPPED',
        payerServiceCode: 'TEST-SERVICE',
        requiresPreauth: false,
        grossCents: 10000,
        discountCents: 1000,
        copayCents: 500,
        proposedClaimCents: 8500,
      },
    ],
    nowIsoDate: '2026-06-30',
  };
}
const codes = (input: PrivateClaimValidationInput) =>
  evaluatePrivateClaimValidation(input).map((issue) => issue.code);

describe('private claim validation (pure synthetic inputs)', () => {
  it('accepts internally consistent inputs without mutating them or implying payer approval', () => {
    const input = validClaim();
    const original = structuredClone(input);
    expect(evaluatePrivateClaimValidation(input)).toEqual([]);
    expect(input).toEqual(original);
  });

  it.each([null, 'Ineligible', 'Pending', 'Unable to verify', 'Manual review required'])(
    'does not treat %s as confirmed eligibility',
    (outcome) => {
      const input = validClaim();
      input.eligibilityOutcome = outcome;
      expect(codes(input)).toContain('MISSING_CONFIRMED_ELIGIBILITY');
    },
  );

  it('checks membership, dates, duplicate claim and currency independently', () => {
    const input = validClaim();
    Object.assign(input, {
      memberStatus: 'INACTIVE',
      memberNumber: ' x ',
      policyNumber: ' ',
      serviceDateStart: '2025-12-31',
      serviceDateEnd: '2025-12-30',
      currency: 'USD',
      hasDuplicateActiveClaim: true,
    });
    expect(codes(input)).toEqual(
      expect.arrayContaining([
        'DUPLICATE_ACTIVE_CLAIM',
        'INACTIVE_MEMBER_POLICY',
        'MISSING_MEMBER_NUMBER',
        'MISSING_POLICY_NUMBER',
        'SERVICE_BEFORE_POLICY_START',
        'INVALID_SERVICE_DATE_RANGE',
        'UNSUPPORTED_CURRENCY',
      ]),
    );
  });

  it('uses an inclusive policy and filing-window boundary, warning only after the configured window', () => {
    const input = validClaim();
    input.serviceDateStart = input.serviceDateEnd = input.policyValidFrom!;
    input.nowIsoDate = '2026-01-31';
    expect(codes(input)).not.toContain('SERVICE_BEFORE_POLICY_START');
    expect(codes(input)).not.toContain('LATE_CLAIM_SUBMISSION_WINDOW');
    input.nowIsoDate = '2026-02-01';
    expect(evaluatePrivateClaimValidation(input)).toContainEqual(
      expect.objectContaining({ code: 'LATE_CLAIM_SUBMISSION_WINDOW', severity: 'WARNING' }),
    );
    input.serviceDateStart = input.serviceDateEnd = '2027-01-01';
    expect(codes(input)).toContain('SERVICE_AFTER_POLICY_EXPIRY');
  });

  it('requires documented coding policy, a coded diagnosis and a permitted coding system', () => {
    const input = validClaim();
    input.claimRequirements.codingPolicyEvidence = ' ';
    input.diagnoses = [{ code: 'UNCODED', display: 'Synthetic', system: 'UNVERIFIED' }];
    expect(codes(input)).toEqual(
      expect.arrayContaining([
        'PAYER_CODING_POLICY_UNVERIFIED',
        'DIAGNOSIS_CODE_REQUIRED',
        'UNSUPPORTED_DIAGNOSIS_CODING_SYSTEM',
      ]),
    );
    input.diagnoses = [];
    expect(codes(input)).toContain('MISSING_CLINICAL_DIAGNOSIS');
    input.claimRequirements.requireDiagnosis = false;
    expect(codes(input)).not.toContain('MISSING_CLINICAL_DIAGNOSIS');
  });

  it('requires both a file name and a storage reference for required documents', () => {
    const input = validClaim();
    input.attachments = [
      { documentType: 'itemized_invoice', fileName: ' ', storageReference: 'test://invoice' },
      { documentType: 'SIGNED_CLAIM_FORM', fileName: 'form.test', storageReference: ' ' },
    ];
    expect(codes(input)).toEqual(
      expect.arrayContaining(['MISSING_INVOICE_ATTACHMENT', 'MISSING_SIGNED_CLAIM_FORM']),
    );
    input.attachments = [
      {
        documentType: 'itemized_invoice',
        fileName: 'invoice.test',
        storageReference: 'test://invoice',
      },
      { documentType: 'signed_claim_form', fileName: 'form.test', storageReference: 'test://form' },
    ];
    expect(codes(input)).not.toContain('MISSING_INVOICE_ATTACHMENT');
    expect(codes(input)).not.toContain('MISSING_SIGNED_CLAIM_FORM');
  });

  it('detects line mapping, line arithmetic, header arithmetic and non-positive totals', () => {
    const input = validClaim();
    input.lines[0] = {
      ...input.lines[0],
      mappingStatus: 'UNMAPPED',
      payerServiceCode: null,
      proposedClaimCents: 0,
    };
    input.proposedClaimCents = 0;
    expect(codes(input)).toEqual(
      expect.arrayContaining([
        'UNMAPPED_SERVICE_LINE',
        'LINE_CALCULATION_MISMATCH',
        'ZERO_OR_NEGATIVE_CLAIM_AMOUNT',
      ]),
    );
    input.grossCents += 1;
    expect(codes(input)).toContain('CLAIM_HEADER_TOTAL_MISMATCH');
    input.lines = [];
    expect(codes(input)).toContain('NO_CLAIM_LINES');
  });

  it.each([
    ['line rule', { requiresPreauth: true }, {}, 'OPD'],
    ['imaging rule', { serviceCategory: 'IMAGING' }, { requirePreauthForImaging: true }, 'OPD'],
    [
      'surgery rule',
      { serviceCategory: 'THEATRE_SPECIALIST' },
      { requirePreauthForSurgery: true },
      'OPD',
    ],
    ['inpatient rule', {}, { requirePreauthForInpatient: true }, 'IPD'],
    ['amount rule', {}, { amountThresholdKes: 84 }, 'OPD'],
  ] as const)('requires approved preauthorization for the %s', (_name, line, rules, encounter) => {
    const input = validClaim();
    input.lines[0] = { ...input.lines[0], ...line };
    input.preauthRequirements = rules;
    input.encounterType = encounter;
    for (const [status, reference] of [
      [null, null],
      ['PENDING', 'test-ref'],
      ['APPROVED', ' '],
    ] as const) {
      input.preauthStatus = status;
      input.preauthReference = reference;
      expect(codes(input)).toContain('MISSING_APPROVED_PREAUTHORIZATION');
    }
    input.preauthStatus = 'PARTIALLY_APPROVED';
    input.preauthReference = 'synthetic-reference';
    expect(codes(input)).not.toContain('MISSING_APPROVED_PREAUTHORIZATION');
  });
});
