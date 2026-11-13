// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { assessPayrollAccounts, assessPayrollRules } from '../../workforce/payroll-readiness.ts';
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../api/client.ts', () => ({ fetchJson: mocks.get }));
import {
  PayrollReadinessPanel,
  VerifyPayrollRule,
} from '../../components/modules/payroll/PayrollReadiness.tsx';
import type {
  PayrollReadiness,
  PayrollStatutoryVersion,
} from '../../api/clients/workforce.client.ts';
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const period = { startDate: '2026-06-01', endDate: '2026-06-30', payDate: '2026-06-30' };
const blocked = () =>
  ({
    facilityId: 7,
    period,
    chartOfAccounts: { status: 'NO_ACTIVE_ACCOUNTS', activeCount: 0, totalCount: 0 },
    mapping: assessPayrollAccounts(null, []),
    rules: assessPayrollRules([], period, '2026-10-27'),
    accountingPeriod: { ready: false, status: 'MISSING' },
    configurationReady: false,
    canCalculate: false,
    canFinalize: false,
    productionReady: false,
    status: 'BLOCKED',
    nextActions: [
      'Ask Accounting to create or reactivate approved facility accounts.',
      'Record, verify and activate cited rules.',
    ],
    notice: 'Configuration checks only, not production certification.',
    periodId: null,
    assessmentMode: 'TODAY_PREVIEW_ONLY',
  }) as PayrollReadiness;
const panelProps = () => ({
  facilityId: 7,
  periods: [],
  periodId: null,
  onPeriodChange: vi.fn(),
  refreshKey: '1',
  onResult: vi.fn(),
});
describe('payroll readiness and verification UI', () => {
  it('shows chart, mappings, all four statutes and concrete next actions without production-ready claims', async () => {
    mocks.get.mockResolvedValue(blocked());
    render(<PayrollReadinessPanel {...panelProps()} />);
    await screen.findByText('0 active / 0 total');
    for (const text of [
      'PAYE configuration',
      'NSSF configuration',
      'SHIF configuration',
      'AHL configuration',
      'Payroll account mappings',
      'Configure next',
    ])
      expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByText('Production sign-off not certified')).toBeInTheDocument();
    expect(
      screen.getByText('Ask Accounting to create or reactivate approved facility accounts.'),
    ).toBeInTheDocument();
  });
  it('requests the selected historical period, not a guessed current version', async () => {
    mocks.get.mockResolvedValue({ ...blocked(), periodId: 3 });
    render(<PayrollReadinessPanel {...panelProps()} periodId={3} />);
    await screen.findByText('0 active / 0 total');
    expect(mocks.get).toHaveBeenCalledWith('/api/payroll/readiness?facilityId=7&periodId=3');
  });
  it('does not turn an API failure into a ready state or invented empty configuration', async () => {
    mocks.get.mockRejectedValue(new Error('Synthetic API failure'));
    const props = panelProps();
    render(<PayrollReadinessPanel {...props} />);
    await screen.findByRole('alert');
    expect(screen.queryByText('0 active / 0 total')).not.toBeInTheDocument();
    expect(props.onResult).toHaveBeenCalledWith(null);
  });
  it('discards a late response after facility scope changes', async () => {
    let resolveFirst: (v: PayrollReadiness) => void = () => {};
    mocks.get
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveFirst = r;
          }),
      )
      .mockResolvedValueOnce({ ...blocked(), facilityId: 8 });
    const props = panelProps();
    const view = render(<PayrollReadinessPanel {...props} />);
    view.rerender(<PayrollReadinessPanel {...props} facilityId={8} />);
    await screen.findByText('0 active / 0 total');
    resolveFirst({ ...blocked(), facilityId: 7 });
    await waitFor(() =>
      expect(
        props.onResult.mock.calls.filter((c) => c[0]).every((c) => c[0].facilityId === 8),
      ).toBe(true),
    );
  });
  it('requires deliberate date, evidence, purpose and source-review attestation before recording verification', async () => {
    const submit = vi.fn();
    const version = {
      id: 2,
      statute: 'SHIF',
      label: 'Synthetic fixture',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
      authority: 'TEST ONLY',
      sourceReference: 'Synthetic arithmetic evidence',
      status: 'DRAFT',
      notes: null,
      bands: [],
      calculationConfig: null,
    } as PayrollStatutoryVersion;
    render(
      <VerifyPayrollRule version={version} saving={false} onClose={() => {}} onSubmit={submit} />,
    );
    expect(screen.getByRole('button', { name: 'Record verification' })).toBeDisabled();
    expect(submit).not.toHaveBeenCalled();
    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText('Verification date'), {
      target: { value: '2026-10-27' },
    });
    await user.type(
      screen.getByLabelText('Verification evidence / review reference'),
      'Synthetic review evidence, not operational authority',
    );
    await user.selectOptions(screen.getByLabelText('Verification purpose'), 'SYNTHETIC_TEST');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Record verification' }));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        verificationPurpose: 'SYNTHETIC_TEST',
        verifiedOn: '2026-10-27',
        confirmSourceReviewed: true,
      }),
    );
  });
});
