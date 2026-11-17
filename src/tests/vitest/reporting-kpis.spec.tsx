// @vitest-environment jsdom
/**
 * The four headline figures on the Reporting Centre landing page.
 *
 * The rule the component has to keep: a card without a verified figure shows a
 * reason, never `0`. These tests drive that from the response the server sends,
 * including the case where the request itself fails.
 */
import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReportingOverview } from '../../reporting/report-centre.overview.ts';

const mocks = vi.hoisted(() => ({ overview: vi.fn() }));
vi.mock('../../api/report-centre.client.ts', () => ({
  reportCentreApi: { overview: mocks.overview },
}));
import { ReportingKpis } from '../../components/modules/report-centre/ReportingKpis.tsx';

function response(kpis: ReportingOverview['kpis'], currency: string | null = 'KES') {
  return {
    facilityId: 10,
    facilityName: 'Synthetic Facility',
    from: '2026-04-01',
    to: '2026-04-03',
    generatedAt: '2026-11-04T08:00:00.000Z',
    currency,
    kpis,
    notes: [],
  } satisfies ReportingOverview;
}

const definitions = {
  'patient-visits': 'Encounters with a recorded start date inside the period.',
  revenue: 'Payments recorded at the cashier during the period, less refunds.',
  'outstanding-balances': 'Positive balances currently recorded on non-voided invoices.',
  'pharmacy-stock-alerts': 'Active pharmacy items at or below their reorder level.',
} as const;

function kpi(
  id: keyof typeof definitions,
  status: ReportingOverview['kpis'][number]['status'],
  extra: Partial<ReportingOverview['kpis'][number]> = {},
): ReportingOverview['kpis'][number] {
  return {
    id,
    label: {
      'patient-visits': 'Patient visits',
      revenue: 'Revenue',
      'outstanding-balances': 'Outstanding balances',
      'pharmacy-stock-alerts': 'Pharmacy stock alerts',
    }[id],
    status,
    definition: definitions[id],
    periodScoped: id === 'patient-visits' || id === 'revenue',
    ...extra,
  } as ReportingOverview['kpis'][number];
}

const renderKpis = (requestKey = '10:2026-04-01:2026-04-03') =>
  render(
    <ReportingKpis facilityId={10} from="2026-04-01" to="2026-04-03" requestKey={requestKey} />,
  );

const card = (id: string) => document.querySelector(`[data-kpi="${id}"]`) as HTMLElement;

describe('Reporting Centre headline figures', () => {
  it('shows a figure only where the server verified one, and states what it counts', async () => {
    mocks.overview.mockReset();
    mocks.overview.mockResolvedValue(
      response([
        kpi('patient-visits', 'ok', {
          value: 12,
          series: [
            { day: '2026-04-01', value: 4 },
            { day: '2026-04-02', value: 8 },
            { day: '2026-04-03', value: 0 },
          ],
        }),
        kpi('revenue', 'ok', { amount: '1200.00', currency: 'KES' }),
        kpi('outstanding-balances', 'restricted', {
          message: 'Your account does not have permission to view this figure.',
          value: undefined,
        }),
        kpi('pharmacy-stock-alerts', 'disabled', {
          message: 'This facility does not have the inventory module enabled.',
          value: undefined,
        }),
      ]),
    );
    renderKpis();
    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByText('KES 1200.00')).toBeInTheDocument();
    expect(screen.getByText(definitions.revenue)).toBeInTheDocument();
    expect(mocks.overview).toHaveBeenCalledWith(10, '2026-04-01', '2026-04-03');

    expect(card('patient-visits').getAttribute('data-kpi-status')).toBe('ok');
    expect(
      within(card('patient-visits')).getByText(/By day · highest 2026-04-02 \(8\)/),
    ).toBeInTheDocument();

    for (const [id, label] of [
      ['outstanding-balances', 'Restricted'],
      ['pharmacy-stock-alerts', 'Not enabled'],
    ] as const) {
      const element = card(id);
      expect(element.getAttribute('data-kpi-status')).not.toBe('ok');
      expect(within(element).getByText(label)).toBeInTheDocument();
      // A refused figure carries a reason, never a fabricated zero.
      expect(within(element).queryByText('0')).not.toBeInTheDocument();
      expect(within(element).getByText(/does not have/)).toBeInTheDocument();
    }
    expect(
      screen.getAllByText(/A figure appears only when its source data could be read/),
    ).toHaveLength(1);
  });

  it('labels a failed figure with its reason and still shows the verified ones', async () => {
    mocks.overview.mockReset();
    mocks.overview.mockResolvedValue(
      response([
        kpi('patient-visits', 'error', {
          message: 'This figure could not be read just now.',
        }),
        kpi('revenue', 'ok', { amount: '0.00', currency: 'KES' }),
        kpi('outstanding-balances', 'error', { message: 'Some invoices require review.' }),
        kpi('pharmacy-stock-alerts', 'ok', { value: 0, asOf: '2026-11-04' }),
      ]),
    );
    renderKpis();
    await screen.findByText('KES 0.00');
    for (const id of ['patient-visits', 'outstanding-balances']) {
      const element = card(id);
      expect(element.getAttribute('data-kpi-status')).toBe('error');
      expect(within(element).getByText('Unavailable')).toBeInTheDocument();
      expect(within(element).queryByText('0')).not.toBeInTheDocument();
    }
    // A real zero is shown as a zero, and says it is a snapshot.
    expect(within(card('pharmacy-stock-alerts')).getByText('0')).toBeInTheDocument();
    expect(
      within(card('pharmacy-stock-alerts')).getByText(/Snapshot as at 2026-11-04/),
    ).toBeInTheDocument();
    expect(within(card('revenue')).getByText('KES 0.00')).toBeInTheDocument();
  });

  it('shows no figures at all when the request fails', async () => {
    mocks.overview.mockReset();
    /*
     * `mockRejectedValue` is recorded as a settled result and trips this
     * vitest version's unhandled-rejection tracker when a hook is registered;
     * the once-variant is the same rejection without that side effect.
     */
    mocks.overview.mockRejectedValueOnce(new Error('Synthetic overview unavailable'));
    renderKpis();
    expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic overview unavailable');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No figure is shown rather than an unverified one.',
    );
    expect(document.querySelectorAll('[data-kpi]')).toHaveLength(0);
  });

  it('drops a slow response for a facility or period that is no longer selected', async () => {
    mocks.overview.mockReset();
    let resolveOld: (value: ReportingOverview) => void = () => {};
    mocks.overview.mockImplementationOnce(
      () =>
        new Promise<ReportingOverview>((resolve) => {
          resolveOld = resolve;
        }),
    );
    mocks.overview.mockResolvedValueOnce(response([kpi('patient-visits', 'ok', { value: 3 })]));
    const view = renderKpis('10:2026-04-01:2026-04-03');
    view.rerender(
      <ReportingKpis
        facilityId={11}
        from="2026-04-01"
        to="2026-04-03"
        requestKey="11:2026-04-01:2026-04-03"
      />,
    );
    expect(await screen.findByText('3')).toBeInTheDocument();
    await act(async () => resolveOld(response([kpi('patient-visits', 'ok', { value: 999 })])));
    expect(screen.queryByText('999')).not.toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('does not draw a chart when the server has no positive day', async () => {
    mocks.overview.mockReset();
    mocks.overview.mockResolvedValue(
      response([
        kpi('patient-visits', 'ok', {
          value: 0,
          series: [
            { day: '2026-04-01', value: 0 },
            { day: '2026-04-02', value: 0 },
          ],
        }),
      ]),
    );
    renderKpis();
    await screen.findByText('0');
    expect(document.querySelector('svg')).toBeNull();
  });

  it('says when a facility has no recorded currency rather than guessing one', async () => {
    mocks.overview.mockReset();
    mocks.overview.mockResolvedValue(
      response([kpi('revenue', 'ok', { amount: '500.00', currency: null })], null),
    );
    renderKpis();
    expect(await screen.findByText('Currency not recorded 500.00')).toBeInTheDocument();
  });

  it('shows a loading state before the figures arrive', async () => {
    mocks.overview.mockReset();
    let resolve: (value: ReportingOverview) => void = () => {};
    mocks.overview.mockImplementation(
      () =>
        new Promise<ReportingOverview>((done) => {
          resolve = done;
        }),
    );
    renderKpis();
    expect(document.querySelectorAll('[data-kpi]')).toHaveLength(0);
    await act(async () => resolve(response([kpi('patient-visits', 'ok', { value: 5 })])));
    expect(await screen.findByText('5')).toBeInTheDocument();
    // The overview asked for exactly the selected facility and inclusive period.
    expect(mocks.overview).toHaveBeenCalledTimes(1);
    expect(mocks.overview).toHaveBeenCalledWith(10, '2026-04-01', '2026-04-03');
  });
});
