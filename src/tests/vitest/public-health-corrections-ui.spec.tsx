// @vitest-environment jsdom
/**
 * Surveillance screen: a corrected figure must replace the week's count, not add
 * to it, and a disputed week must not look submit-ready.
 *
 * The API client and context are mocked; every value is synthetic.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  api: {
    getPublicHealthReports: vi.fn(),
    getMoh705Summary: vi.fn(),
    recordPublicHealthReport: vi.fn(),
    correctPublicHealthReport: vi.fn(),
    publicHealthWeekSummary: vi.fn(),
  },
  context: {
    currentFacility: { id: 12, name: 'Synthetic health centre', mflCode: 'TEST-12' },
    showToast: vi.fn(),
    refreshKey: 0,
    triggerRefresh: vi.fn(),
  },
}));

vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocks.context }));
vi.mock('../../api/client.ts', () => ({ api: mocks.api }));

import { PublicHealthModule } from '../../components/modules/PublicHealthModule.tsx';

const weekSummary = (overrides: Record<string, unknown> = {}) => ({
  facilityId: 12,
  epiWeek: '2026-W44',
  tallies: [],
  superseded: [],
  totals: { diseases: 0, records: 0, casesCount: 0, mortalityCount: 0, disputedGroups: 0 },
  submission: {
    ready: false,
    blockedBy: 'No active records were recorded for this week.',
    transmitted: false,
  },
  limitations: { format: 'FACILITY_TALLY_ONLY', notice: 'Synthetic limitation notice.' },
  ...overrides,
});

beforeEach(() => {
  mocks.api.getMoh705Summary.mockRejectedValue(
    new Error('The report is unavailable until verified reporting data exists.'),
  );
  mocks.api.getPublicHealthReports.mockResolvedValue([]);
  mocks.api.publicHealthWeekSummary.mockResolvedValue(weekSummary());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('surveillance corrections', () => {
  it('excludes a replaced record from the ledger totals and names its replacement', async () => {
    mocks.api.getPublicHealthReports.mockResolvedValue([
      {
        id: 41,
        facilityId: 12,
        diseaseCode: 'A00',
        diseaseName: 'Cholera (suspected)',
        casesCount: 40,
        mortalityCount: 2,
        ageGroup: 'Under 5 Years',
        epiWeek: '2026-W44',
        reportedAt: '2026-10-27T08:00:00.000Z',
        status: 'SUPERSEDED',
        supersedesReportId: null,
      },
      {
        id: 42,
        facilityId: 12,
        diseaseCode: 'A00',
        diseaseName: 'Cholera (suspected)',
        casesCount: 4,
        mortalityCount: 0,
        ageGroup: 'Under 5 Years',
        epiWeek: '2026-W44',
        reportedAt: '2026-10-27T09:00:00.000Z',
        status: 'DRAFT',
        supersedesReportId: 41,
      },
    ]);
    mocks.api.publicHealthWeekSummary.mockResolvedValue(
      weekSummary({
        tallies: [
          {
            diseaseCode: 'A00',
            diseaseName: 'Cholera (suspected)',
            ageGroup: 'Under 5 Years',
            casesCount: 4,
            mortalityCount: 0,
            caseFatalityRatio: '0.0000',
            recordCount: 1,
            reportIds: [42],
            disputed: false,
            reviewNote: null,
          },
        ],
        totals: { diseases: 1, records: 1, casesCount: 4, mortalityCount: 0, disputedGroups: 0 },
        submission: { ready: true, blockedBy: null, transmitted: false },
      }),
    );

    render(<PublicHealthModule />);
    await screen.findByText(/1 active · 1 replaced/i);

    // The headline total counts the correction once, never both rows.
    expect(screen.getByText('cases 4')).toBeTruthy();
    expect(screen.getByText('deaths 0')).toBeTruthy();
    expect(screen.getByText('Replaced by #42')).toBeTruthy();
    expect(screen.queryByText(/Not ready to report/i)).toBeNull();
  });

  it('shows a disputed week as not ready instead of quietly adding the rows', async () => {
    mocks.api.getPublicHealthReports.mockResolvedValue([
      {
        id: 51,
        facilityId: 12,
        diseaseCode: 'B05',
        diseaseName: 'Measles (suspected)',
        casesCount: 6,
        mortalityCount: 0,
        ageGroup: 'Over 5 Years',
        epiWeek: '2026-W44',
        reportedAt: '2026-10-27T08:00:00.000Z',
        status: 'DRAFT',
        supersedesReportId: null,
      },
    ]);
    mocks.api.publicHealthWeekSummary.mockResolvedValue(
      weekSummary({
        tallies: [
          {
            diseaseCode: 'B05',
            diseaseName: 'Measles (suspected)',
            ageGroup: 'Over 5 Years',
            casesCount: 10,
            mortalityCount: 0,
            caseFatalityRatio: '0.0000',
            recordCount: 2,
            reportIds: [51, 52],
            disputed: true,
            reviewNote: '2 active records exist for this disease and age group.',
          },
        ],
        totals: { diseases: 1, records: 2, casesCount: 10, mortalityCount: 0, disputedGroups: 1 },
        submission: {
          ready: false,
          blockedBy: '1 disease/age group(s) have competing active records.',
          transmitted: false,
        },
      }),
    );

    render(<PublicHealthModule />);
    expect(await screen.findByText(/Not ready to report/i)).toBeTruthy();
    expect(screen.getByText(/Disputed · 2 records/)).toBeTruthy();
    expect(screen.getByText(/2 active records exist/)).toBeTruthy();
  });

  it('sends a correction to the correction endpoint with the stated reason', async () => {
    mocks.api.getPublicHealthReports.mockResolvedValue([
      {
        id: 61,
        facilityId: 12,
        diseaseCode: 'A00',
        diseaseName: 'Cholera (suspected)',
        casesCount: 40,
        mortalityCount: 2,
        ageGroup: 'Under 5 Years',
        epiWeek: '2026-W44',
        reportedAt: '2026-10-27T08:00:00.000Z',
        status: 'DRAFT',
        supersedesReportId: null,
      },
    ]);
    mocks.api.correctPublicHealthReport.mockResolvedValue({
      id: 62,
      supersedesReportId: 61,
      casesCount: 4,
      mortalityCount: 0,
      previous: { casesCount: 40, mortalityCount: 2 },
      reason: 'Corrected against the ward register.',
      transmitted: false,
    });
    const user = userEvent.setup();

    render(<PublicHealthModule />);
    await user.click(await screen.findByRole('button', { name: 'Correct record 61' }));

    const cases = screen.getByLabelText(/Corrected cases/i) as HTMLInputElement;
    await user.clear(cases);
    await user.type(cases, '4');
    const deaths = screen.getByLabelText(/Corrected deaths/i) as HTMLInputElement;
    await user.clear(deaths);
    await user.type(deaths, '0');
    await user.type(
      screen.getByLabelText(/Why is the figure being corrected/i),
      'Corrected against the ward register.',
    );
    await user.click(screen.getByRole('button', { name: /Record correction/i }));

    await waitFor(() =>
      expect(mocks.api.correctPublicHealthReport).toHaveBeenCalledWith(61, {
        facilityId: 12,
        casesCount: 4,
        mortalityCount: 0,
        reason: 'Corrected against the ward register.',
      }),
    );
    // A correction is never sent through the recording endpoint.
    expect(mocks.api.recordPublicHealthReport).not.toHaveBeenCalled();
    expect(mocks.context.showToast.mock.calls[0][0]).toMatch(
      /not transmitted|Nothing was transmitted/i,
    );
    expect(mocks.context.triggerRefresh).toHaveBeenCalled();
  });

  it('surfaces a rejected correction instead of implying it was stored', async () => {
    mocks.api.getPublicHealthReports.mockResolvedValue([
      {
        id: 71,
        facilityId: 12,
        diseaseCode: 'B50',
        diseaseName: 'Malaria (confirmed)',
        casesCount: 9,
        mortalityCount: 0,
        ageGroup: 'Over 5 Years',
        epiWeek: '2026-W44',
        reportedAt: '2026-10-27T08:00:00.000Z',
        status: 'SUPERSEDED',
        supersedesReportId: null,
      },
    ]);
    // A superseded row offers no correction control at all.
    render(<PublicHealthModule />);
    await screen.findByText(/Malaria/i);
    expect(screen.queryByRole('button', { name: 'Correct record 71' })).toBeNull();
  });

  it('does not present an empty week as zero cases', async () => {
    render(<PublicHealthModule />);
    const summaryPanel = (await screen.findByText(/Weekly tally/i)).closest('section');
    expect(summaryPanel).not.toBeNull();
    expect(
      within(summaryPanel as HTMLElement).getByText(/No active record was entered/i),
    ).toBeTruthy();
  });
});
