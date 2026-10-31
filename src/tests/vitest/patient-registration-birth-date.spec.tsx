// @vitest-environment jsdom
import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BirthDatePicker } from '../../components/modules/patient-registration/BirthDatePicker.tsx';

const mocks = vi.hoisted(() => ({
  getPatients: vi.fn(),
  createPatient: vi.fn(),
  createQueueItem: vi.fn(),
  showToast: vi.fn(),
  triggerRefresh: vi.fn(),
}));

vi.mock('../../api/client.ts', () => ({
  api: {
    getPatients: mocks.getPatients,
    createPatient: mocks.createPatient,
    createQueueItem: mocks.createQueueItem,
  },
}));
vi.mock('../../context/HmisContext.tsx', () => ({
  useHmis: () => ({
    currentTenant: { id: 17 },
    currentFacility: { id: 21 },
    authenticatedUser: { permissions: [] },
    setSelectedPatient: vi.fn(),
    setIsJourneyModalOpen: vi.fn(),
    showToast: mocks.showToast,
    refreshKey: 0,
    triggerRefresh: mocks.triggerRefresh,
  }),
}));
vi.mock('../../components/portal/PortalInviteDialog.tsx', () => ({
  PortalInviteDialog: () => null,
}));

import { PatientRegistrationModule } from '../../components/modules/PatientRegistrationModule.tsx';

function TestForm({
  initial = '',
  onSubmit = vi.fn(),
}: {
  initial?: string;
  onSubmit?: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <BirthDatePicker value={value} onChange={setValue} />
      <button type="submit">Register</button>
      <button type="button">Outside picker</button>
    </form>
  );
}

const input = () => screen.getByLabelText('Date of Birth *') as HTMLInputElement;
const dialog = (stage: 'year' | 'month' | 'day') =>
  screen.getByRole('dialog', { name: `Select ${stage}` });

function openAndChooseYear(year: number) {
  fireEvent.click(input());
  expect(dialog('year')).toBeInTheDocument();
  fireEvent.click(within(dialog('year')).getByRole('button', { name: String(year) }));
  expect(dialog('month')).toBeInTheDocument();
}

function chooseMonth(month: string) {
  fireEvent.click(within(dialog('month')).getByRole('button', { name: month }));
  expect(dialog('day')).toBeInTheDocument();
}

beforeEach(() => {
  // Freeze only Date; Testing Library's asynchronous timers still run normally.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 29, 12));
  vi.clearAllMocks();
  mocks.getPatients.mockResolvedValue([]);
  mocks.createPatient.mockResolvedValue({
    id: 42,
    firstName: 'Test',
    lastName: 'Patient',
    mrn: 'TEST-42',
  });
  mocks.createQueueItem.mockResolvedValue({ tokenNumber: 'T-1' });
});

afterEach(() => vi.useRealTimers());

describe('registration date of birth picker', () => {
  it('opens on year, selects 1985 → March → 14 and emits an unchanged ISO calendar date', () => {
    render(<TestForm />);
    expect(input()).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Date of Birth *' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    openAndChooseYear(1985);
    expect(
      within(dialog('month')).getAllByRole('button', {
        name: /^(January|February|March|April|May|June|July|August|September|October|November|December)$/,
      }),
    ).toHaveLength(12);
    chooseMonth('March');
    fireEvent.click(within(dialog('day')).getByRole('button', { name: '14 March 1985' }));
    expect(input()).toHaveValue('1985-03-14');
    expect(input()).toHaveFocus();
    expect(input().checkValidity()).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('can jump to a decade, page to earlier centuries, and change stages without overwriting the prior date', () => {
    render(<TestForm initial="1992-08-11" />);
    fireEvent.click(input());
    fireEvent.change(screen.getByLabelText('Jump to decade'), { target: { value: '1980' } });
    expect(screen.getByRole('button', { name: '1989' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '1985' }));
    chooseMonth('March');
    expect(input()).toHaveValue('1992-08-11');
    fireEvent.click(screen.getByRole('button', { name: 'Change month' }));
    expect(dialog('month')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change year' }));
    expect(dialog('year')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Earlier years' }));
    fireEvent.click(screen.getByRole('button', { name: '1800' }));
    chooseMonth('April');
    fireEvent.click(screen.getByRole('button', { name: '9 April 1800' }));
    expect(input()).toHaveValue('1800-04-09');
  });

  it('leaves the existing date untouched on Escape, outside click, and the dismiss button', () => {
    render(<TestForm initial="1985-03-14" />);
    fireEvent.click(input());
    fireEvent.click(screen.getByRole('button', { name: '1990' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(input()).toHaveValue('1985-03-14');
    expect(input()).toHaveFocus();

    fireEvent.click(input());
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside picker' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(input()).toHaveValue('1985-03-14');

    fireEvent.click(input());
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss date picker' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(input()).toHaveValue('1985-03-14');
  });

  it('shows February 29 only in Gregorian leap years, including century rules', () => {
    render(<TestForm />);
    openAndChooseYear(2024);
    chooseMonth('February');
    const february = screen.getByRole('group', { name: 'Days in February 2024' });
    expect(within(february).getAllByRole('button')).toHaveLength(29);
    expect(february.children[4]).toHaveAccessibleName('1 February 2024'); // Thursday
    fireEvent.click(within(february).getByRole('button', { name: '29 February 2024' }));
    expect(input()).toHaveValue('2024-02-29');

    openAndChooseYear(2023);
    chooseMonth('February');
    expect(screen.queryByRole('button', { name: '29 February 2023' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change year' }));
    fireEvent.click(screen.getByRole('button', { name: '2000' }));
    chooseMonth('February');
    expect(screen.getByRole('button', { name: '29 February 2000' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Change year' }));
    fireEvent.click(screen.getByRole('button', { name: 'Earlier years' }));
    fireEvent.click(screen.getByRole('button', { name: '1900' }));
    chooseMonth('February');
    expect(screen.queryByRole('button', { name: '29 February 1900' })).not.toBeInTheDocument();
  });

  it('excludes future years, months and days while allowing today', () => {
    render(<TestForm />);
    fireEvent.click(input());
    expect(screen.queryByRole('button', { name: '2027' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Later years' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '2026' }));
    expect(screen.getByRole('button', { name: 'November' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'December' })).toBeDisabled();
    chooseMonth('October');
    expect(screen.getByRole('button', { name: '29 October 2026' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '30 October 2026' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '29 October 2026' }));
    expect(input()).toHaveValue('2026-10-29');
  });

  it('supports manual ISO entry and blocks invalid, non-leap, future and empty dates', () => {
    const submitted = vi.fn();
    render(<TestForm onSubmit={submitted} />);
    expect(input()).toBeRequired();
    expect(input().checkValidity()).toBe(false);
    fireEvent.change(input(), { target: { value: '1985-03-14' } });
    expect(input().checkValidity()).toBe(true);
    fireEvent.change(input(), { target: { value: '2024-02-29' } });
    expect(input().checkValidity()).toBe(true);
    fireEvent.change(input(), { target: { value: '2023-02-29' } });
    fireEvent.blur(input());
    expect(input().checkValidity()).toBe(false);
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid date in YYYY-MM-DD format.');
    fireEvent.change(input(), { target: { value: '2026-10-30' } });
    expect(input().checkValidity()).toBe(false);
    expect(screen.getByRole('alert')).toHaveTextContent('Date of birth cannot be in the future.');
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    expect(submitted).not.toHaveBeenCalled();
    fireEvent.change(input(), { target: { value: '1985-3-14' } });
    expect(input().checkValidity()).toBe(false);
  });

  it('uses the local calendar date near midnight, not the corresponding UTC date', () => {
    vi.setSystemTime(new Date(2026, 9, 29, 0, 15));
    render(<TestForm />);
    fireEvent.change(input(), { target: { value: '2026-10-29' } });
    expect(input().checkValidity()).toBe(true);
    vi.setSystemTime(new Date(2026, 9, 29, 23, 45));
    fireEvent.change(input(), { target: { value: '2026-10-30' } });
    expect(input().checkValidity()).toBe(false);
  });

  it('can complete all three stages using the keyboard', async () => {
    const user = userEvent.setup();
    render(<TestForm />);
    await user.tab();
    expect(input()).toHaveFocus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(screen.getByRole('button', { name: '2026' })).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(dialog('month')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'January' })).toHaveFocus();
    await user.keyboard('{ArrowRight}{Enter}');
    expect(dialog('day')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 February 2022' })).toHaveFocus();
    await user.keyboard('{ArrowRight}{Enter}');
    expect(input()).toHaveValue('2022-02-02');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('supports keyboard opening, arrow navigation, stage focus and Escape', () => {
    render(<TestForm />);
    input().focus();
    fireEvent.keyDown(input(), { key: 'ArrowDown', altKey: true });
    const currentYear = screen.getByRole('button', { name: '2026' });
    expect(currentYear).toHaveFocus();
    fireEvent.keyDown(currentYear, { key: 'ArrowDown' });
    const nextYear = screen.getByRole('button', { name: '2022' });
    expect(nextYear).toHaveFocus();
    fireEvent.click(nextYear);
    const january = screen.getByRole('button', { name: 'January' });
    expect(january).toHaveFocus();
    fireEvent.keyDown(january, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'February' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'February' }), { key: 'Escape' });
    expect(input()).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('patient registration compatibility', () => {
  function openRegistration() {
    render(<PatientRegistrationModule />);
    fireEvent.click(screen.getByRole('button', { name: 'New Patient Registration' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Juma'), { target: { value: 'Test' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Otieno'), { target: { value: 'Patient' } });
    fireEvent.change(screen.getByDisplayValue('Select gender'), { target: { value: 'Female' } });
  }

  it('submits the chosen date in the existing payload and routes the registered patient to triage', async () => {
    openRegistration();
    openAndChooseYear(1985);
    chooseMonth('March');
    fireEvent.click(screen.getByRole('button', { name: '14 March 1985' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Complete Registration & Route to Triage' }),
    );
    await waitFor(() => expect(mocks.createPatient).toHaveBeenCalledTimes(1));
    expect(mocks.createPatient).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Test',
        lastName: 'Patient',
        gender: 'Female',
        dateOfBirth: '1985-03-14',
        registrationFacilityId: 21,
        payerType: 'Self-Pay',
      }),
    );
    await waitFor(() =>
      expect(mocks.createQueueItem).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 42,
          tenantId: 17,
          facilityId: 21,
          queueType: 'Triage',
        }),
      ),
    );
  });

  it('keeps manual entry compatible with age-dependent guardian fields and the registration payload', async () => {
    openRegistration();
    fireEvent.change(input(), { target: { value: '2020-02-29' } });
    expect(screen.getByText(/Guardian details recommended/)).toBeInTheDocument();
    expect(screen.getByText('Parent / Guardian Details')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Complete Registration & Route to Triage' }),
    );
    await waitFor(() => expect(mocks.createPatient).toHaveBeenCalledTimes(1));
    expect(mocks.createPatient).toHaveBeenCalledWith(
      expect.objectContaining({ dateOfBirth: '2020-02-29', guardianName: null }),
    );
  });

  it('reports a saved patient separately when triage routing cannot be confirmed', async () => {
    mocks.createQueueItem.mockRejectedValueOnce(new Error('synthetic response loss'));
    openRegistration();
    fireEvent.change(input(), { target: { value: '1985-03-14' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Complete Registration & Route to Triage' }),
    );
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        expect.stringContaining(
          'Patient registered (MRN: TEST-42), but triage routing could not be confirmed',
        ),
      ),
    );
    expect(mocks.createPatient).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: 'Complete Registration & Route to Triage' }),
    ).not.toBeInTheDocument();
  });

  it('warns against blind resubmission when the registration response is lost', async () => {
    mocks.createPatient.mockRejectedValueOnce(new Error('synthetic response loss'));
    openRegistration();
    fireEvent.change(input(), { target: { value: '1985-03-14' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Complete Registration & Route to Triage' }),
    );
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('may have been saved')),
    );
    expect(mocks.createQueueItem).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Complete Registration & Route to Triage' }),
    ).not.toBeInTheDocument();
  });

  it('shows a directory outage instead of an empty patient list and supports retry', async () => {
    mocks.getPatients.mockRejectedValueOnce(new Error('synthetic outage'));
    render(<PatientRegistrationModule />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Do not assume no patients exist');
    expect(screen.queryByText(/No patients found matching/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry patient directory' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(mocks.getPatients).toHaveBeenCalledTimes(2);
  });

  it('does not submit a manually entered future birth date', () => {
    openRegistration();
    fireEvent.change(input(), { target: { value: '2026-10-30' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Complete Registration & Route to Triage' }),
    );
    expect(input().checkValidity()).toBe(false);
    expect(mocks.createPatient).not.toHaveBeenCalled();
  });
});
