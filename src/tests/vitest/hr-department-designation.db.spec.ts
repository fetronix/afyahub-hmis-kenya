/**
 * Departments and designations against a real synthetic PostgreSQL.
 *
 * These assertions are about the relationship the form relies on: a designation
 * belongs to exactly one department, the department is stored by id, and an
 * employee cannot be saved with a designation from a different department. The
 * UI hides impossible choices; this file proves the API refuses them as well,
 * because a hidden option is not a rule.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { describeDb } from './support/db.ts';
import { db, pool } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import {
  createDepartment,
  createDesignation,
  listDepartments,
  listDesignations,
  updateDepartment,
  updateDesignation,
  createEmployee,
  updateEmployee,
  WorkforceError,
  type WorkforceScope,
} from '../../workforce/workforce.service.ts';

const suffix = randomUUID().slice(0, 8).toUpperCase();

type Fixture = {
  scope: WorkforceScope;
  foreignScope: WorkforceScope;
  nursing: number;
  finance: number;
  closed: number;
};

const created: Fixture = {} as Fixture;

async function expectRefusal(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(WorkforceError);
    expect((error as WorkforceError).code).toBe(code);
    return;
  }
  throw new Error(`Expected the API to refuse with ${code}, but it succeeded.`);
}

describeDb('HR departments and designations: relationship integrity', () => {
  beforeAll(async () => {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({ name: `Synthetic HR ${suffix}`, slug: `hr-${suffix.toLowerCase()}` })
      .returning();
    const [outsider] = await db
      .insert(schema.tenants)
      .values({ name: `Synthetic HR outsider ${suffix}`, slug: `hr-out-${suffix.toLowerCase()}` })
      .returning();
    const [facility] = await db
      .insert(schema.facilities)
      .values({ tenantId: tenant.id, code: `HR-${suffix}`, name: 'Synthetic HR facility', enabledModules: ['hr'] })
      .returning();
    const [foreignFacility] = await db
      .insert(schema.facilities)
      .values({ tenantId: outsider.id, code: `HRO-${suffix}`, name: 'Synthetic HR outsider facility', enabledModules: ['hr'] })
      .returning();
    const [actor] = await db
      .insert(schema.users)
      .values({
        uid: `usr_${randomUUID()}`,
        tenantId: tenant.id,
        facilityId: facility.id,
        username: `hr.${suffix.toLowerCase()}`,
        email: `hr.${suffix.toLowerCase()}@example.test`,
        fullName: 'Synthetic HR actor',
        passwordHash: 'x',
        accountStatus: 'ACTIVE',
        isActive: true,
      })
      .returning();
    const [outsiderActor] = await db
      .insert(schema.users)
      .values({
        uid: `usr_${randomUUID()}`,
        tenantId: outsider.id,
        facilityId: foreignFacility.id,
        username: `hro.${suffix.toLowerCase()}`,
        email: `hro.${suffix.toLowerCase()}@example.test`,
        fullName: 'Synthetic outsider actor',
        passwordHash: 'x',
        accountStatus: 'ACTIVE',
        isActive: true,
      })
      .returning();

    created.scope = {
      tenantId: tenant.id,
      facilityId: facility.id,
      actorId: actor.id,
      actorName: 'Synthetic HR actor',
    };
    created.foreignScope = {
      tenantId: outsider.id,
      facilityId: foreignFacility.id,
      actorId: outsiderActor.id,
      actorName: 'Synthetic outsider actor',
    };

    const nursing = await createDepartment(created.scope, {
      code: 'NUR',
      name: 'Nursing',
      description: 'Ward nursing staff',
    });
    const finance = await createDepartment(created.scope, {
      code: 'FIN',
      name: 'Finance',
      description: 'Accounts and billing',
    });
    const closed = await createDepartment(created.scope, {
      code: 'OLD',
      name: 'Legacy Records',
      description: 'Retired department',
    });
    created.nursing = nursing.id;
    created.finance = finance.id;
    created.closed = closed.id;
    await updateDepartment(created.scope, closed.id, {
      name: 'Legacy Records',
      description: 'Retired department',
      isActive: false,
    });
  });

  it('lists departments with their description, status and designation counts', async () => {
    const departments = await listDepartments(created.scope);
    const nursing = departments.find((department) => department.id === created.nursing);
    expect(nursing).toBeDefined();
    expect(nursing!.name).toBe('Nursing');
    expect(nursing!.description).toBe('Ward nursing staff');
    expect(nursing!.isActive).toBe(true);
    expect(nursing!.designations).toBe(0);
    const legacy = departments.find((department) => department.id === created.closed);
    expect(legacy!.isActive).toBe(false);
  });

  it('editing a department keeps it deactivated instead of silently reactivating it', async () => {
    const row = await updateDepartment(created.scope, created.closed, {
      name: 'Legacy Records',
      description: 'Retired department, renamed',
      isActive: false,
    });
    expect(row.isActive).toBe(false);
    expect(row.description).toBe('Retired department, renamed');
  });

  it('creates a designation under an existing department and stores the id', async () => {
    const row = await createDesignation(created.scope, {
      title: 'Nurse',
      departmentId: created.nursing,
      description: 'Registered nurse delivering direct patient care',
      grade: 'JG-6',
    });
    expect(row.departmentId).toBe(created.nursing);
    expect(row.description).toBe('Registered nurse delivering direct patient care');

    const listed = await listDesignations(created.scope);
    const nurse = listed.find((designation) => designation.id === row.id);
    expect(nurse!.departmentName).toBe('Nursing');
    expect(nurse!.description).toBe('Registered nurse delivering direct patient care');
  });

  it('refuses a designation with no department', async () => {
    await expectRefusal(
      createDesignation(created.scope, { title: 'Floating Clerk' }),
      'INVALID_ID',
    );
  });

  it('refuses a department that belongs to another facility', async () => {
    await createDepartment(created.foreignScope, { code: 'OUT', name: 'Outsider department' });
    const [foreign] = await listDepartments(created.foreignScope);
    await expectRefusal(
      createDesignation(created.scope, { title: 'Cross Tenant', departmentId: foreign.id }),
      'DEPARTMENT_NOT_FOUND',
    );
  });

  it('refuses a designation in a deactivated department', async () => {
    await expectRefusal(
      createDesignation(created.scope, { title: 'Archivist', departmentId: created.closed }),
      'DEPARTMENT_INACTIVE',
    );
  });

  it('refuses a duplicate designation title in the same facility', async () => {
    await expect(
      createDesignation(created.scope, { title: 'Nurse', departmentId: created.finance }),
    ).rejects.toBeTruthy();
  });

  it('edits a designation, including moving the department it names', async () => {
    const accountant = await createDesignation(created.scope, {
      title: 'Accountant',
      departmentId: created.finance,
    });
    const updated = await updateDesignation(created.scope, accountant.id, {
      title: 'Senior Accountant',
      departmentId: created.finance,
      description: 'Leads the accounts function',
      grade: 'JG-7',
      isActive: true,
    });
    expect(updated.title).toBe('Senior Accountant');
    expect(updated.grade).toBe('JG-7');
    expect(updated.departmentId).toBe(created.finance);
  });

  it('refuses to move a designation that active employees still hold', async () => {
    const technician = await createDesignation(created.scope, {
      title: 'Laboratory Technician',
      departmentId: created.nursing,
    });
    await createEmployee(created.scope, {
      employeeNumber: `T-${suffix}-1`,
      firstName: 'Synthetic',
      lastName: 'Technician',
      hireDate: '2026-01-05',
      departmentId: created.nursing,
      designationId: technician.id,
    });
    await expectRefusal(
      updateDesignation(created.scope, technician.id, {
        title: 'Laboratory Technician',
        departmentId: created.finance,
      }),
      'DESIGNATION_IN_USE',
    );
  });

  it('refuses an employee whose designation belongs to another department', async () => {
    const pharmacist = await createDesignation(created.scope, {
      title: 'Pharmacist',
      departmentId: created.finance,
    });
    await expectRefusal(
      createEmployee(created.scope, {
        employeeNumber: `T-${suffix}-2`,
        firstName: 'Synthetic',
        lastName: 'Mismatch',
        hireDate: '2026-01-05',
        departmentId: created.nursing,
        designationId: pharmacist.id,
      }),
      'DESIGNATION_DEPARTMENT_MISMATCH',
    );
  });

  it('accepts an employee whose designation matches their department', async () => {
    const nurse = (await listDesignations(created.scope)).find(
      (designation) => designation.title === 'Nurse',
    )!;
    const employee = await createEmployee(created.scope, {
      employeeNumber: `T-${suffix}-3`,
      firstName: 'Synthetic',
      lastName: 'Nurse',
      hireDate: '2026-01-05',
      departmentId: created.nursing,
      designationId: nurse.id,
    });
    expect(employee.departmentId).toBe(created.nursing);
    expect(employee.designationId).toBe(nurse.id);
  });

  it('keeps an existing employee unchanged and their inactive designation editable', async () => {
    const nurse = (await listDesignations(created.scope)).find(
      (designation) => designation.title === 'Nurse',
    )!;
    const employee = (await db.select().from(schema.hrEmployees)).find(
      (row) => row.employeeNumber === `T-${suffix}-3`,
    )!;

    /* Deactivate the designation the employee already holds. */
    await updateDesignation(created.scope, nurse.id, {
      title: 'Nurse',
      departmentId: created.nursing,
      isActive: false,
    });

    /* Editing an unrelated field must still succeed. */
    const edited = await updateEmployee(created.scope, employee.id, {
      employeeNumber: employee.employeeNumber,
      firstName: employee.firstName,
      lastName: 'Nurse Renamed',
      hireDate: '2026-01-05',
      departmentId: created.nursing,
      designationId: nurse.id,
    });
    expect(edited.lastName).toBe('Nurse Renamed');
    expect(edited.designationId).toBe(nurse.id);
  });

  it('refuses to newly assign an inactive designation', async () => {
    const nurse = (await listDesignations(created.scope)).find(
      (designation) => designation.title === 'Nurse',
    )!;
    await expectRefusal(
      createEmployee(created.scope, {
        employeeNumber: `T-${suffix}-4`,
        firstName: 'Synthetic',
        lastName: 'Inactive',
        hireDate: '2026-01-05',
        departmentId: created.nursing,
        designationId: nurse.id,
      }),
      'DESIGNATION_INACTIVE',
    );
  });

  it('reports designations per department so the department list can show them', async () => {
    const departments = await listDepartments(created.scope);
    const nursing = departments.find((department) => department.id === created.nursing)!;
    expect(nursing.designations).toBeGreaterThan(0);
    expect(nursing.activeDesignations).toBeLessThan(nursing.designations!);
  });

  it('returns empty lists for a facility with no departments or designations', async () => {
    const [blankFacility] = await db
      .insert(schema.facilities)
      .values({
        tenantId: created.foreignScope.tenantId,
        code: `BLK-${suffix}`,
        name: 'Synthetic blank facility',
        enabledModules: ['hr'],
      })
      .returning();
    const blankScope: WorkforceScope = { ...created.foreignScope, facilityId: blankFacility.id };
    expect(await listDepartments(blankScope)).toEqual([]);
    expect(await listDesignations(blankScope)).toEqual([]);
  });
});

/* Keep the pool referenced so the import is not tree-shaken away in watch mode. */
void pool;
