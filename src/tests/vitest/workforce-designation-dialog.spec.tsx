// @vitest-environment jsdom
/*
 * The New designation dialog must offer the facility's existing departments as a
 * dropdown. The field once passed `options` without `type: 'select'`, so it
 * rendered as a free-text box and the options were silently ignored.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  getWorkforceOverview: vi.fn(),
  getHrEmployees: vi.fn(),
  getHrDepartments: vi.fn(),
  getHrDesignations: vi.fn(),
  createHrDesignation: vi.fn(),
}));

vi.mock('../../api/client.ts', () => ({ api, ApiError: class ApiError extends Error {} }));

const hmis = vi.hoisted(() => ({
  authenticatedUser: {
    id: 9,
    permissions: ['hr.read', 'hr.manage'],
    roles: ['HR_OFFICER'],
    isSuperAdmin: false,
  },
  currentFacility: { id: 3, name: 'Syrona Medical Center — Nyeri Training Facility' },
  showToast: vi.fn(),
  refreshKey: 0,
  triggerRefresh: vi.fn(),
}));

vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => hmis }));

import { WorkforceModule } from '../../components/modules/WorkforceModule.tsx';

const DEPARTMENT_ROWS = [
  { id: 11, code: 'OPS', name: 'Operations', isActive: true, activeEmployees: 1 },
  { id: 12, code: 'NUR', name: 'Nursing', isActive: true, activeEmployees: 2 },
  { id: 13, code: 'OLD', name: 'Legacy Records', isActive: false, activeEmployees: 0 },
];

beforeEach(() => {
  api.getWorkforceOverview.mockResolvedValue({
    headcount: 3,
    activeEmployees: 3,
    onLeave: 0,
    monthlyBasicCents: '0',
    departments: DEPARTMENT_ROWS.length,
    pendingLeave: 0,
    payrollPeriods: 0,
    activeStatutoryVersions: 0,
    payrollReady: true,
  });
  api.getHrEmployees.mockResolvedValue([]);
  api.getHrDepartments.mockResolvedValue(DEPARTMENT_ROWS);
  api.getHrDesignations.mockResolvedValue([]);
  api.createHrDesignation.mockResolvedValue({ id: 1, title: 'Nurse', grade: 'JG-6' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const openDesignationDialog = async () => {
  const user = userEvent.setup();
  render(<WorkforceModule />);

  await user.click(await screen.findByRole('tab', { name: 'Departments & roles' }));

  const addButton = await screen.findByRole('button', { name: /Add designation/i });
  await user.click(addButton);

  const dialog = await screen.findByRole('dialog');
  return { user, dialog };
};

describe('New designation dialog', () => {
  it('offers existing departments as a dropdown rather than a text box', async () => {
    const { dialog } = await openDesignationDialog();

    const department = within(dialog).getByLabelText(/Department/);
    expect(department.tagName).toBe('SELECT');

    const options = within(department as HTMLSelectElement)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual([
      'Unassigned',
      'Operations',
      'Nursing',
      // An inactive department stays visible so it is not silently hidden, but it is labelled.
      'Legacy Records (inactive)',
    ]);
  });

  it('shows no Department entry when the facility has no departments yet', async () => {
    api.getHrDepartments.mockResolvedValue([]);
    const { dialog } = await openDesignationDialog();

    const department = within(dialog).getByLabelText(/Department/) as HTMLSelectElement;
    expect(department.tagName).toBe('SELECT');
    expect(within(department).getAllByRole('option')).toHaveLength(1);
    expect(department).toHaveAccessibleDescription(
      /No departments recorded yet/i,
    );
  });

  it('submits the chosen department with the new designation', async () => {
    const { user, dialog } = await openDesignationDialog();

    await user.type(within(dialog).getByLabelText(/Job title/), 'Staff Nurse');
    await user.selectOptions(within(dialog).getByLabelText(/Department/), '12');
    await user.type(within(dialog).getByLabelText(/Grade/), 'JG-6');
    await user.click(within(dialog).getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(api.createHrDesignation).toHaveBeenCalledTimes(1));
    expect(api.createHrDesignation).toHaveBeenCalledWith(3, {
      title: 'Staff Nurse',
      departmentId: '12',
      grade: 'JG-6',
    });
  });

  it('leaves the designation unassigned when no department is chosen', async () => {
    const { user, dialog } = await openDesignationDialog();

    await user.type(within(dialog).getByLabelText(/Job title/), 'Records Clerk');
    await user.click(within(dialog).getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(api.createHrDesignation).toHaveBeenCalledTimes(1));
    expect(api.createHrDesignation).toHaveBeenCalledWith(3, { title: 'Records Clerk' });
  });
});
