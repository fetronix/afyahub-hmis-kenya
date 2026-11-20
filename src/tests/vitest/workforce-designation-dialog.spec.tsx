// @vitest-environment jsdom
/*
 * Departments and designations in the HR module.
 *
 * The designation form used to pass `options` without `type: 'select'`, so the
 * department rendered as free text and the list was never shown. These tests pin
 * the replacement: a required, searchable dropdown fed from the backend, with
 * real loading, failure and empty-department states, and an employee form whose
 * designation list is scoped to the chosen department.
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
  updateHrDesignation: vi.fn(),
  createHrDepartment: vi.fn(),
  updateHrDepartment: vi.fn(),
  createHrEmployee: vi.fn(),
  updateHrEmployee: vi.fn(),
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
import { ApiError } from '../../api/client.ts';

const DEPARTMENTS = [
  { id: 11, code: 'NUR', name: 'Nursing', description: 'Ward staff', isActive: true, activeEmployees: 2, designations: 2, activeDesignations: 2 },
  { id: 12, code: 'FIN', name: 'Finance', description: 'Accounts', isActive: true, activeEmployees: 1, designations: 1, activeDesignations: 1 },
  { id: 13, code: 'OLD', name: 'Legacy Records', description: 'Retired', isActive: false, activeEmployees: 0, designations: 0, activeDesignations: 0 },
];

const DESIGNATIONS = [
  { id: 21, departmentId: 11, departmentName: 'Nursing', title: 'Nurse', description: 'Direct care', grade: 'JG-6', isActive: true, activeEmployees: 1 },
  { id: 22, departmentId: 11, departmentName: 'Nursing', title: 'Nursing Officer', description: null, grade: 'JG-8', isActive: true, activeEmployees: 1 },
  { id: 23, departmentId: 12, departmentName: 'Finance', title: 'Accountant', description: 'Accounts', grade: 'JG-7', isActive: true, activeEmployees: 1 },
  { id: 24, departmentId: 12, departmentName: 'Finance', title: 'Retired Cashier', description: null, grade: null, isActive: false, activeEmployees: 0 },
  { id: 25, departmentId: null, departmentName: null, title: 'Legacy Clerk', description: null, grade: null, isActive: true, activeEmployees: 0 },
];

beforeEach(() => {
  api.getWorkforceOverview.mockResolvedValue({
    headcount: 2,
    activeEmployees: 2,
    onLeave: 0,
    monthlyBasicCents: '0',
    departments: DEPARTMENTS.length,
    pendingLeave: 0,
    payrollPeriods: 0,
    activeStatutoryVersions: 0,
    payrollReady: true,
  });
  api.getHrEmployees.mockResolvedValue([]);
  api.getHrDepartments.mockResolvedValue(DEPARTMENTS);
  api.getHrDesignations.mockResolvedValue(DESIGNATIONS);
  api.createHrDesignation.mockResolvedValue({ id: 99, title: 'Pharmacist' });
  api.updateHrDesignation.mockResolvedValue({ id: 21, title: 'Nurse' });
  api.updateHrDepartment.mockResolvedValue({ id: 13, name: 'Legacy Records' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const openOrganisation = async () => {
  const user = userEvent.setup();
  render(<WorkforceModule />);
  await user.click(await screen.findByRole('tab', { name: 'Departments & roles' }));
  return user;
};

const openNewDesignation = async () => {
  const user = await openOrganisation();
  await user.click(await screen.findByRole('button', { name: /Add designation/i }));
  return { user, dialog: await screen.findByRole('dialog') };
};

/** Opens the combobox and returns the option labels currently offered. */
const openDepartmentList = async (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) => {
  const trigger = within(dialog).getByRole('combobox', { name: /Department/ });
  await user.click(trigger);
  const list = await within(dialog).findByRole('listbox');
  return {
    trigger,
    labels: within(list)
      .getAllByRole('option')
      .map((option) => option.textContent?.replace(/\s+/g, ' ').trim()),
  };
};

describe('New designation form', () => {
  it('offers existing departments in a searchable dropdown, active ones only', async () => {
    const { user, dialog } = await openNewDesignation();
    const { trigger, labels } = await openDepartmentList(user, dialog);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(labels?.length).toBe(2);
    expect(labels?.[0]).toContain('Nursing');
    expect(labels?.[1]).toContain('Finance');
    /* Deactivated departments are not offered for a new designation. */
    expect(labels?.join(' ')).not.toContain('Legacy Records');
  });

  it('filters the department list as the user types', async () => {
    const { user, dialog } = await openNewDesignation();
    await openDepartmentList(user, dialog);

    const search = within(dialog).getByRole('textbox', { name: /Search departments/i });
    await user.type(search, 'fina');

    const list = within(dialog).getByRole('listbox');
    const labels = within(list).getAllByRole('option').map((option) => option.textContent);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toContain('Finance');
  });

  it('saves the chosen department by database id, with description and status', async () => {
    const { user, dialog } = await openNewDesignation();

    await user.type(within(dialog).getByLabelText(/Designation name/), 'Pharmacist');
    await openDepartmentList(user, dialog);
    await user.click(within(dialog).getByRole('option', { name: /Finance/ }));
    await user.type(within(dialog).getByLabelText(/^Description/), 'Dispenses medicines');
    await user.type(within(dialog).getByLabelText(/^Grade/), 'JG-7');
    await user.click(within(dialog).getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(api.createHrDesignation).toHaveBeenCalledTimes(1));
    expect(api.createHrDesignation).toHaveBeenCalledWith(3, {
      title: 'Pharmacist',
      departmentId: 12,
      description: 'Dispenses medicines',
      grade: 'JG-7',
      isActive: true,
    });
  });

  it('refuses to save without a department and says which field is missing', async () => {
    const { user, dialog } = await openNewDesignation();

    await user.type(within(dialog).getByLabelText(/Designation name/), 'Pharmacist');
    await user.click(within(dialog).getByRole('button', { name: /^Save$/ }));

    expect(
      await within(dialog).findByText(/Choose the department this designation belongs to/i),
    ).toBeTruthy();
    expect(api.createHrDesignation).not.toHaveBeenCalled();
  });

  it('directs the user to create a department when none exist', async () => {
    api.getHrDepartments.mockResolvedValue([]);
    const { dialog } = await openNewDesignation();

    expect(await within(dialog).findByText(/No departments recorded yet/i)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /Create a department/i })).toBeTruthy();
    /* The department control is disabled rather than presenting an empty list. */
    expect(within(dialog).getByRole('combobox', { name: /Department/ })).toBeDisabled();
  });

  it('reports a department load failure and offers a retry', async () => {
    api.getHrDepartments.mockRejectedValue(new ApiError('Network unreachable', 0));
    const { dialog } = await openNewDesignation();

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toMatch(/Departments could not be loaded/i);
    expect(alert.textContent).toMatch(/Network unreachable/);
    expect(within(dialog).getByRole('combobox', { name: /Department/ })).toHaveAttribute(
      'aria-describedby',
      expect.stringContaining('department-error'),
    );

    api.getHrDepartments.mockResolvedValue(DEPARTMENTS);
    await userEvent.click(within(dialog).getByRole('button', { name: /Try again/i }));
    await waitFor(() => expect(api.getHrDepartments).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
  });

  it('does not leak an unexpected failure message when the error is not an API error', async () => {
    api.getHrDepartments.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.4:5432'));
    const { dialog } = await openNewDesignation();

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).not.toMatch(/ECONNREFUSED/);
    expect(alert.textContent).toMatch(/Departments could not be loaded/i);
  });

  it('explains when every department has been deactivated', async () => {
    api.getHrDepartments.mockResolvedValue([
      { ...DEPARTMENTS[2], isActive: false },
    ]);
    const { dialog } = await openNewDesignation();

    expect(await within(dialog).findByText(/Every department is inactive/i)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /^Save$/ })).toBeDisabled();
  });

  it('edits an existing designation, carrying its department through', async () => {
    const user = await openOrganisation();
    await user.click(await screen.findByRole('button', { name: 'Edit Nurse' }));

    const dialog = await screen.findByRole('dialog', { name: /Edit designation/i });
    const trigger = within(dialog).getByRole('combobox', { name: /Department/ });
    expect(trigger.textContent).toContain('Nursing');

    await user.clear(within(dialog).getByLabelText(/Designation name/));
    await user.type(within(dialog).getByLabelText(/Designation name/), 'Senior Nurse');
    await user.click(within(dialog).getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(api.updateHrDesignation).toHaveBeenCalledTimes(1));
    expect(api.updateHrDesignation).toHaveBeenCalledWith(3, 21, {
      title: 'Senior Nurse',
      departmentId: 11,
      description: 'Direct care',
      grade: 'JG-6',
      isActive: true,
    });
  });
});

describe('Department list', () => {
  it('shows each department description and how many designations it holds', async () => {
    await openOrganisation();

    const departmentsTable = (await screen.findAllByRole('table'))[0];
    const nursingRow = within(departmentsTable).getByText('Nursing').closest('tr')!;
    expect(within(nursingRow).getByText('Ward staff')).toBeTruthy();
    const cells = within(nursingRow).getAllByRole('cell');
    /* Code, name, designations, active staff, status, actions. */
    expect(cells[2].textContent).toBe('2');
    expect(cells[3].textContent).toBe('2');
    expect(within(nursingRow).getByText(/ACTIVE/i)).toBeTruthy();

    const legacyRow = within(departmentsTable).getByText('Legacy Records').closest('tr')!;
    expect(within(legacyRow).getByText(/INACTIVE/i)).toBeTruthy();
  });

  it('edits a department without forcing it back to active', async () => {
    const user = await openOrganisation();
    await user.click(await screen.findByRole('button', { name: 'Edit Legacy Records' }));

    const dialog = await screen.findByRole('dialog', { name: /Edit department/i });
    const activeToggle = within(dialog).getByRole('checkbox', { name: /Active/i });
    expect(activeToggle).not.toBeChecked();

    await user.click(within(dialog).getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(api.updateHrDepartment).toHaveBeenCalledTimes(1));
    expect(api.updateHrDepartment).toHaveBeenCalledWith(
      3,
      13,
      expect.objectContaining({ isActive: false, name: 'Legacy Records' }),
    );
  });

  it('filters designations by department', async () => {
    const user = await openOrganisation();

    const filter = document.getElementById('designation-department-filter') as HTMLSelectElement;
    await user.selectOptions(filter, '12');

    const table = screen.getAllByRole('table').at(-1)!;
    expect(within(table).getByText('Accountant')).toBeTruthy();
    expect(within(table).queryByText('Retired Cashier')).toBeTruthy();
    expect(within(table).queryByText('Nurse')).toBeNull();
    expect(screen.getByText(/2 of 5 shown/)).toBeTruthy();
  });
});

describe('Employee registration department/designation relationship', () => {
  const openEmployeeForm = async () => {
    const user = userEvent.setup();
    render(<WorkforceModule />);
    await user.click(await screen.findByRole('button', { name: /Register employee/i }));
    return { user, dialog: await screen.findByRole('dialog') };
  };

  it('only lists designations that belong to the selected department', async () => {
    const { user, dialog } = await openEmployeeForm();

    const designation = within(dialog).getByLabelText('Designation') as HTMLSelectElement;
    /* Nothing is selectable until a department is chosen. */
    expect(designation).toBeDisabled();

    await user.selectOptions(within(dialog).getByLabelText('Department'), '11');
    const options = within(designation)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['Unassigned', 'Nurse', 'Nursing Officer']);
  });

  it('clears an incompatible designation when the department changes', async () => {
    const { user, dialog } = await openEmployeeForm();

    await user.selectOptions(within(dialog).getByLabelText('Department'), '11');
    const designation = within(dialog).getByLabelText('Designation') as HTMLSelectElement;
    await user.selectOptions(designation, '21');
    expect(designation.value).toBe('21');

    await user.selectOptions(within(dialog).getByLabelText('Department'), '12');
    expect(designation.value).toBe('');
    const options = within(designation)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['Unassigned', 'Accountant']);
  });

  it('keeps the designation when the department is unchanged', async () => {
    const { user, dialog } = await openEmployeeForm();

    const department = within(dialog).getByLabelText('Department') as HTMLSelectElement;
    await user.selectOptions(department, '11');
    const designation = within(dialog).getByLabelText('Designation') as HTMLSelectElement;
    await user.selectOptions(designation, '22');

    await user.selectOptions(within(dialog).getByLabelText('Employment type'), 'CONTRACT');
    expect(designation.value).toBe('22');
  });

  it('sends the matching department id and designation id on save', async () => {
    const { user, dialog } = await openEmployeeForm();

    await user.type(within(dialog).getByLabelText(/Employee number/), 'SYNTH-9001');
    await user.type(within(dialog).getByLabelText(/First name/), 'Synthetic');
    await user.type(within(dialog).getByLabelText(/Last name/), 'Nurse');
    await user.selectOptions(within(dialog).getByLabelText('Department'), '11');
    await user.selectOptions(within(dialog).getByLabelText('Designation'), '21');
    api.createHrEmployee.mockResolvedValue({ id: 1 });
    await user.click(within(dialog).getByRole('button', { name: 'Register employee' }));

    await waitFor(() => expect(api.createHrEmployee).toHaveBeenCalledTimes(1));
    expect(api.createHrEmployee).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ departmentId: '11', designationId: '21' }),
    );
  });
});
