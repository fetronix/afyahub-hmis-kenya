// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaimsAndReconciliationSection } from '../../components/modules/private-insurance/ClaimsAndReconciliationSection.tsx';
import { BenefitsMappingsPreauthSection } from '../../components/modules/private-insurance/BenefitsMappingsPreauthSection.tsx';
import {
  privateInsuranceApi,
  type PrivateClaimDetail,
  type PrivateClaimSummary,
  type PrivatePayerConfig,
  type PrivatePreauthRecord,
} from '../../api/private-insurance.client.ts';

const payer = { payerCode: 'BRITAM', payerName: 'Britam' } as PrivatePayerConfig;
const claim = {
  id: 1,
  claimNumber: 'TEST-CLAIM-1',
  patientName: 'Synthetic Patient',
  payerCode: 'BRITAM',
  invoiceNumber: 'TEST-INV',
  originalInvoiceStatus: 'Unpaid',
  proposedClaimAmount: '2500.00',
  approvedAmount: '0.00',
  paidAmount: '0.00',
  status: 'READY',
  submissionCount: 0,
} as PrivateClaimSummary;
const details = {
  ...claim,
  status: 'SUBMITTED',
  validationIssues: [],
  lines: [],
  submissions: [],
  statusHistory: [],
  attachmentsManifest: [],
  originalInvoice: { id: 1, invoiceNumber: 'TEST-INV', status: 'Unpaid', balanceAmount: '2500.00' },
} as unknown as PrivateClaimDetail;
const common = {
  selectedPayerFilter: 'BRITAM',
  payers: [payer],
  invoices: [],
  encounters: [],
  members: [],
  preauthorizations: [],
  claims: [claim],
  remittances: [],
  reconciliation: null,
  diagnostics: null,
  canPrepareClaims: true,
  canSubmitClaims: true,
  canReconcileRemittances: true,
  onRefresh: vi.fn().mockResolvedValue(undefined),
  showToast: vi.fn(),
};

afterEach(() => vi.restoreAllMocks());

describe('manual insurance controls', () => {
  it('requires the actual manual dispatch reference rather than inventing one', async () => {
    const submit = vi.spyOn(privateInsuranceApi, 'submitClaim').mockResolvedValue(details);
    render(<ClaimsAndReconciliationSection {...common} activeScreen="claim_tracking" />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    const reference = screen.getByLabelText(/actual insurer portal/i) as HTMLInputElement;
    expect(reference.value).toBe('');
    expect(reference.required).toBe(true);
    fireEvent.change(reference, { target: { value: 'ACTUAL-SYNTHETIC-REFERENCE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record dispatch' }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(1, {
        submissionMode: 'MANUAL',
        dispatchReference: 'ACTUAL-SYNTHETIC-REFERENCE',
      }),
    );
  });

  it('does not copy estimated amount into an insurer preauthorization decision', () => {
    const preauth = {
      id: 1,
      preauthNumber: 'TEST-PA-1',
      payerCode: 'BRITAM',
      status: 'REQUESTED',
      estimatedAmount: '9000.00',
      patientName: 'Synthetic Patient',
      requestedServiceName: 'Consultation',
    } as PrivatePreauthRecord;
    render(
      <BenefitsMappingsPreauthSection
        activeScreen="preauthorizations"
        selectedPayerFilter="BRITAM"
        payers={[payer]}
        patients={[]}
        encounters={[]}
        invoices={[]}
        tariffs={[]}
        members={[]}
        rules={[]}
        validations={[]}
        mappings={[]}
        preauthorizations={[preauth]}
        canManageMappings
        canValidateBenefits
        canManagePreauth
        onRefresh={common.onRefresh}
        showToast={common.showToast}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Decision' }));
    expect(
      (screen.getByDisplayValue('— Select actual decision —') as HTMLSelectElement).value,
    ).toBe('');
    expect(
      (screen.getByPlaceholderText('Enter actual payer-approved amount') as HTMLInputElement).value,
    ).toBe('');
  });

  it('starts remittance date, channel and claim allocation blank', () => {
    render(
      <ClaimsAndReconciliationSection
        {...common}
        claims={[{ ...claim, status: 'SUBMITTED' }]}
        activeScreen="remittances"
      />,
    );
    expect((screen.getByLabelText('Actual advice payment date') as HTMLInputElement).value).toBe(
      '',
    );
    expect((screen.getByLabelText('Actual payment channel') as HTMLSelectElement).value).toBe('');
    const claimSelect = screen.getByDisplayValue('Import batch only (allocate later)...');
    fireEvent.change(claimSelect, { target: { value: '1' } });
    const amountInputs = screen.getAllByPlaceholderText('2500.00') as HTMLInputElement[];
    expect(amountInputs.map((input) => input.value)).toEqual(['', '']);
  });
});
