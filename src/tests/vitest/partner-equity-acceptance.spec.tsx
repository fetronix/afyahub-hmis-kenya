// @vitest-environment jsdom
import React from 'react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { baselineEquity, baselinePartners } from '../../partner-equity/model.ts';
import { PartnerEquityWorkspace } from '../../components/modules/accounting/PartnerEquityWorkspace.tsx';
const api = vi.hoisted(() => ({ get: vi.fn(), send: vi.fn(), download: vi.fn() }));
vi.mock('../../api/clients/equity.client.ts', () => ({ equityApi: api }));
let currency = 'KES';
beforeEach(() => {
  vi.clearAllMocks();
  currency = 'KES';
  api.get.mockImplementation(async (path: string) =>
    path === '/partners'
      ? { version: 0, partners: baselinePartners() }
      : path.startsWith('/statements?')
        ? [
            {
              id: 41,
              period_name: 'July 2025 – June 2026',
              start_date: '2025-07-01',
              end_date: '2026-06-30',
              status: 'DRAFT',
              revision: 1,
            },
          ]
        : {
            id: 41,
            version: 1,
            revision: 1,
            model: baselineEquity(),
            financial_year: 2026,
            period_name: 'July 2025 – June 2026',
            start_date: '2025-07-01',
            end_date: '2026-06-30',
            status: 'DRAFT',
            facility_name: 'Authenticated fixture facility',
            facility_currency: currency,
            prepared_name: 'Fixture preparer',
            prepared_at: '2026-10-27',
            prepared_by: 1,
          },
  );
});
afterEach(cleanup);
const show = () =>
  render(
    <PartnerEquityWorkspace
      facilityId={7}
      facilityName="Stale cached label"
      permissions={['accounting.equity.read', 'accounting.equity.manage']}
    />,
  );
it('uses scoped authenticated facility metadata and exposes the facility identity and configured currency', async () => {
  show();
  await screen.findByText('Authenticated fixture facility · KES');
  expect(screen.getByText(/Authenticated facility #7/)).toHaveTextContent(
    'Facility currency (tenant setting): KES',
  );
  expect(screen.queryByText('Stale cached label · KES')).toBeNull();
});
it('discloses a non-KES tenant setting without silently converting or relabelling source amounts', async () => {
  currency = 'USD';
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'No currency conversion has been performed',
  );
  expect(screen.getByText(/Authenticated facility #7/)).toHaveTextContent('USD');
  expect(screen.getByText('Authenticated fixture facility · KES')).toBeInTheDocument();
});
it('labels the depreciation ownership row explicitly provisional while preserving fourteen rows', async () => {
  show();
  const table = await screen.findByRole('table', { name: 'Partner equity statement' });
  expect(table.querySelectorAll('tbody tr')).toHaveLength(14);
  expect(
    screen.getByRole('rowheader', {
      name: /Percentage Ownership adjusted for depreciation — PROVISIONAL/,
    }),
  ).toHaveTextContent('formula unverified');
});
it('starts with an empty reason and asks for a financial explanation rather than a username', async () => {
  show();
  await screen.findByRole('table', { name: 'Partner equity statement' });
  expect(screen.getByLabelText('Equity audit reason')).toHaveValue('');
  expect(screen.getByLabelText('Equity audit reason')).toHaveAttribute(
    'placeholder',
    expect.stringContaining('reviewed bank advice'),
  );
  expect(screen.getByText(/Your identity is recorded separately/)).toBeInTheDocument();
  expect(api.send).not.toHaveBeenCalled();
});
