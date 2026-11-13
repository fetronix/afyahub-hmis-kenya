// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MaternityModule } from '../../components/modules/MaternityModule.tsx';
import {
  createEmptyBaby,
  doseStatusClass,
  errorMessage,
  formatGestation,
  isUnderFive,
  num,
  patientName,
  statusClass,
  text,
  updateBaby,
} from '../../components/modules/maternity/shared.tsx';
import { api } from '../../api/client.ts';
import type { Patient } from '../../types/index.ts';

const showToastMock = vi.fn();

vi.mock('../../context/HmisContext.tsx', () => ({
  useHmis: () => ({
    currentFacility: { id: 101, name: 'Nyeri County Referral Hospital' },
    showToast: showToastMock,
  }),
}));

const motherPatient: Patient = {
  id: 11,
  tenantId: 1,
  mrn: 'MRN-0011',
  firstName: 'Wanjiku',
  lastName: 'Kamau',
  dateOfBirth: '1997-04-12',
  gender: 'Female',
  phone: '+254712345678',
  facilityId: 101,
  payerType: 'Cash',
  createdAt: '2026-01-10T08:00:00Z',
};

const childPatient: Patient = {
  id: 22,
  tenantId: 1,
  mrn: 'MRN-0022',
  firstName: 'Baraka',
  lastName: 'Kamau',
  dateOfBirth: '2026-06-01',
  gender: 'Male',
  phone: '+254712345678',
  facilityId: 101,
  payerType: 'Cash',
  createdAt: '2026-06-01T10:00:00Z',
};

describe('Maternity shared helpers', () => {
  it('coerces blank strings to undefined rather than zero or empty string', () => {
    expect(num('')).toBeUndefined();
    expect(num('   ')).toBeUndefined();
    expect(num('not-a-number')).toBeUndefined();
    expect(num('0')).toBe(0);
    expect(num('36.8')).toBe(36.8);

    expect(text('')).toBeUndefined();
    expect(text('   ')).toBeUndefined();
    expect(text('  Cephalic  ')).toBe('Cephalic');
  });

  it('formats gestation, patient names, status badges, and baby draft updates', () => {
    expect(formatGestation(null)).toBe('—');
    expect(formatGestation({ weeks: 28, days: 4 })).toBe('28w 4d');
    expect(patientName({ firstName: 'Wanjiku', lastName: 'Kamau' })).toBe('Wanjiku Kamau');
    expect(errorMessage(new Error('Network down'), 'Fallback')).toBe('Network down');
    expect(errorMessage('raw', 'Fallback')).toBe('Fallback');

    expect(doseStatusClass('Overdue')).toContain('rose');
    expect(doseStatusClass('Due')).toContain('amber');
    expect(doseStatusClass('Given')).toContain('emerald');
    expect(doseStatusClass('Not yet due')).toContain('slate');

    expect(statusClass('Active')).toContain('teal');
    expect(statusClass('Delivered')).toContain('emerald');
    expect(statusClass('Referred')).toContain('amber');
    expect(statusClass('Closed')).toContain('slate');

    const nowMs = Date.parse('2026-10-28T00:00:00Z');
    expect(isUnderFive(childPatient, nowMs)).toBe(true);
    expect(isUnderFive(motherPatient, nowMs)).toBe(false);

    const babies = [createEmptyBaby(), createEmptyBaby()];
    const updated = updateBaby(babies, 1, { sex: 'Female', apgar5: '9' });
    expect(updated[0].sex).toBe('');
    expect(updated[1].sex).toBe('Female');
    expect(updated[1].apgar5).toBe('9');
  });
});

describe('MaternityModule clinical workflows (ANC, Labour, Delivery, Postnatal, Immunisation)', () => {
  beforeEach(() => {
    showToastMock.mockReset();

    vi.spyOn(api, 'getMaternitySummary').mockResolvedValue({
      facilityId: 101,
      asOf: '2026-10-28',
      activePregnancies: 1,
      ancVisitsThisMonth: 2,
      inLabour: 1,
      deliveriesThisMonth: 1,
      babiesThisMonth: 1,
    });
    vi.spyOn(api, 'getPregnancies').mockResolvedValue([
      {
        id: 501,
        patientId: 11,
        facilityId: 101,
        bookedAt: '2026-05-01',
        lmpDate: '2026-03-01',
        eddDate: '2026-12-06',
        eddBasis: 'LMP',
        gravida: 2,
        para: 1,
        abortions: 0,
        status: 'Active',
        riskFactors: 'Previous CS',
        gestation: { weeks: 34, days: 3 },
        patient: { id: 11, mrn: 'MRN-0011', firstName: 'Wanjiku', lastName: 'Kamau' },
      } as never,
    ]);
    vi.spyOn(api, 'getLabours').mockResolvedValue([
      {
        id: 701,
        pregnancyId: 501,
        patientId: 11,
        facilityId: 101,
        admittedAt: '2026-10-28T06:00:00Z',
        labourOnsetAt: '2026-10-28T04:30:00Z',
        status: 'In Labour',
        patient: { id: 11, mrn: 'MRN-0011', firstName: 'Wanjiku', lastName: 'Kamau' },
      } as never,
    ]);
    vi.spyOn(api, 'getDeliveries').mockResolvedValue([]);
    vi.spyOn(api, 'getPatients').mockResolvedValue([motherPatient, childPatient]);
    vi.spyOn(api, 'getPostnatalRegister').mockResolvedValue([]);
    vi.spyOn(api, 'getImmunisationSchedule').mockResolvedValue({
      antigens: [
        {
          code: 'BCG',
          name: 'BCG',
          weeks: 0,
          route: 'Intradermal',
        } as never,
      ],
      note: 'KEPI national schedule',
    });
    vi.spyOn(api, 'getImmunisationDueList').mockResolvedValue({
      asOf: '2026-10-28',
      note: 'KEPI national schedule',
      children: [
        {
          id: 22,
          mrn: 'MRN-0022',
          firstName: 'Baraka',
          lastName: 'Kamau',
          dateOfBirth: '2026-06-01',
          overdueCount: 1,
          outstandingCount: 2,
          nextDue: { code: 'BCG', name: 'BCG', weeks: 0 },
        } as never,
      ],
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('loads facility registers on mount, books a pregnancy omitting untouched numeric fields, and navigates across all 5 clinical tabs', async () => {
    const bookSpy = vi.spyOn(api, 'bookPregnancy').mockResolvedValue({
      id: 502,
      patientId: 11,
      eddDate: '2026-12-06',
    } as never);
    vi.spyOn(api, 'getPregnancy').mockResolvedValue({
      id: 502,
      patientId: 11,
      eddDate: '2026-12-06',
      eddBasis: 'LMP',
      status: 'Active',
      gravida: null,
      para: null,
      riskFactors: null,
      gestation: { weeks: 34, days: 3 },
      ancVisits: [],
      deliveries: [],
      patient: { id: 11, mrn: 'MRN-0011', firstName: 'Wanjiku', lastName: 'Kamau' },
    } as never);
    vi.spyOn(api, 'getLabour').mockResolvedValue({
      id: 701,
      pregnancyId: 501,
      patientId: 11,
      admittedAt: '2026-10-28T06:00:00Z',
      labourOnsetAt: '2026-10-28T04:30:00Z',
      status: 'In Labour',
      entries: [],
      guidance: {
        zone: 'Left of the alert line',
        hoursBeyondAlert: 0,
        note: 'Progressing normally.',
      },
      patient: { id: 11, mrn: 'MRN-0011', firstName: 'Wanjiku', lastName: 'Kamau' },
    } as never);
    const deliverySpy = vi.spyOn(api, 'recordDelivery').mockResolvedValue({
      delivery: {
        id: 801,
        patientId: 11,
        patient: { firstName: 'Wanjiku', lastName: 'Kamau' },
      },
      babies: [{ id: 901, outcome: 'Live Birth' }],
      billing: {
        charged: false,
        reason: 'TARIFF_NOT_CONFIGURED',
      },
    } as never);
    vi.spyOn(api, 'getPostnatalVisits').mockResolvedValue([]);
    vi.spyOn(api, 'getImmunisationCard').mockResolvedValue({
      patient: { id: 22, mrn: 'MRN-0022', firstName: 'Baraka', lastName: 'Kamau' },
      dateOfBirth: '2026-06-01',
      note: 'KEPI national schedule',
      statuses: [
        { antigenCode: 'BCG', name: 'BCG', scheduledWeeks: 0, status: 'Overdue', givenOn: null },
      ],
      records: [],
    } as never);

    const user = userEvent.setup();
    render(<MaternityModule />);

    await waitFor(() => {
      expect(screen.getByText('Wanjiku Kamau')).toBeTruthy();
    });
    expect(api.getMaternitySummary).toHaveBeenCalledWith(101);
    expect(api.getImmunisationDueList).toHaveBeenCalledWith(101);

    // Book pregnancy with blank gravida/para/abortions -> sent as undefined, never 0
    await user.click(screen.getByRole('button', { name: /Book pregnancy/i }));
    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[0], '11');
    const submitButtons = screen.getAllByRole('button', { name: /^Book pregnancy$/i });
    await user.click(submitButtons[submitButtons.length - 1]);

    await waitFor(() => {
      expect(bookSpy).toHaveBeenCalledTimes(1);
    });
    expect(bookSpy.mock.calls[0][0]).toMatchObject({
      patientId: 11,
      facilityId: 101,
      gravida: undefined,
      para: undefined,
      abortions: undefined,
    });
    expect(showToastMock).toHaveBeenCalledWith('Pregnancy booked.');

    // Switch to Labour & partograph tab, open labour record, and transition to Delivery
    await user.click(screen.getByRole('button', { name: /Labour & partograph/i }));
    await user.click(screen.getByRole('button', { name: /Wanjiku Kamau/i }));
    await waitFor(() => {
      expect(screen.getByText('Left of the alert line')).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: /Record the delivery for this labour/i }));

    // Now on Deliveries & billing tab with pre-filled pregnancyId=501 and labourRecordId=701
    const recordDeliveryButtons = screen.getAllByRole('button', { name: /^Record delivery$/i });
    await user.click(recordDeliveryButtons[recordDeliveryButtons.length - 1]);

    await waitFor(() => {
      expect(deliverySpy).toHaveBeenCalledTimes(1);
    });
    expect(deliverySpy.mock.calls[0][0]).toMatchObject({
      pregnancyId: 501,
      labourRecordId: 701,
      bloodLossMl: undefined,
    });
    expect(screen.getByText(/Recorded, not billed\./i)).toBeTruthy();

    // Switch to Postnatal care tab
    await user.click(screen.getByRole('button', { name: /Postnatal care/i }));
    expect(screen.getByText('Postnatal contacts')).toBeTruthy();

    // Switch to Immunisation tab and open child's card
    await user.click(screen.getByRole('button', { name: /Immunisation/i }));
    expect(screen.getByText('Doses outstanding')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Baraka Kamau/i }));
    await waitFor(() => {
      expect(api.getImmunisationCard).toHaveBeenCalledWith(22);
    });
    expect(screen.getByText('Overdue')).toBeTruthy();
  });
});
