import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { createMockDbState } from './support/drizzle-mock.ts';

const mockDb = vi.hoisted(() => ({ state: null as ReturnType<typeof createMockDbState> | null }));
const queriesMocks = vi.hoisted(() => ({
  getFacilityByIdScoped: vi.fn(),
  getAdmissionByIdScoped: vi.fn(),
  getEncounterByIdScoped: vi.fn(),
  getWardsScoped: vi.fn(),
  getAdmissionsScoped: vi.fn(),
  getBedsScoped: vi.fn(),
  getObservationsByPatientScoped: vi.fn(),
}));
const verificationMocks = vi.hoisted(() => ({
  assertInvitationCredential: vi.fn(),
  linkInvitationCredentialToUser: vi.fn(),
}));

vi.mock('../../db/index.ts', async () => {
  const { createMockDbState: make } = await import('./support/drizzle-mock.ts');
  mockDb.state = make();
  return {
    db: mockDb.state.executor,
    pool: { query: vi.fn() },
  };
});

vi.mock('../../db/index', async () => {
  const { createMockDbState: make } = await import('./support/drizzle-mock.ts');
  if (!mockDb.state) mockDb.state = make();
  return {
    db: mockDb.state.executor,
    pool: { query: vi.fn() },
  };
});

vi.mock('../../db/queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db/queries.ts')>();
  return {
    ...actual,
    getFacilityByIdScoped: queriesMocks.getFacilityByIdScoped,
    getAdmissionByIdScoped: queriesMocks.getAdmissionByIdScoped,
    getEncounterByIdScoped: queriesMocks.getEncounterByIdScoped,
    getWardsScoped: queriesMocks.getWardsScoped,
    getAdmissionsScoped: queriesMocks.getAdmissionsScoped,
    getBedsScoped: queriesMocks.getBedsScoped,
    getObservationsByPatientScoped: queriesMocks.getObservationsByPatientScoped,
  };
});

vi.mock(
  '../../integrations/professional/professional-verification.service.ts',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../integrations/professional/professional-verification.service.ts')
      >();
    return {
      ...actual,
      assertInvitationCredential: verificationMocks.assertInvitationCredential,
      linkInvitationCredentialToUser: verificationMocks.linkInvitationCredentialToUser,
    };
  },
);

const invitations = await import('../../auth/staff-invitation.service.ts');
const wardBeds = await import('../../inpatient/ward-bed.service.ts');
const nursing = await import('../../nursing/nursing.service.ts');
const reporting = await import('../../reporting/reporting.service.ts');

const ctx: AuthorizationContext = {
  userId: 10,
  tenantId: 1,
  facilityId: 10,
  roles: ['FACILITY_ADMIN'],
  permissions: ['inpatient.read', 'inpatient.write', 'nursing.write', 'analytics.read'],
  isSuperAdmin: false,
};

describe('Staff Invitations, Ward/Bed Capacity, Nursing Vitals & Operations Reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.state?.reset();
    queriesMocks.getFacilityByIdScoped.mockImplementation(
      async (_context: AuthorizationContext, facilityId: number) =>
        facilityId === 10
          ? { id: 10, tenantId: 1, enabledModules: ['inpatient', 'analytics'] }
          : null,
    );
    verificationMocks.assertInvitationCredential.mockResolvedValue({
      required: false,
      credentialId: null,
    });
    verificationMocks.linkInvitationCredentialToUser.mockResolvedValue(undefined);
  });

  it('creates, validates, lists, reissues, revokes, and accepts staff invitations securely', async () => {
    await expect(
      invitations.createStaffInvitation({
        tenantId: 1,
        facilityId: 10,
        email: 'bad-email',
        fullName: 'Nurse Grace',
        roleId: 3,
        invitedBy: '10',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_EMAIL', statusCode: 400 });

    // Create invitation (non-admin assignable role)
    mockDb.state!.queueSelect(
      [{ id: 10, tenantId: 1, isActive: true }], // facility
      [
        {
          roleId: 3,
          roleName: 'RECEPTIONIST',
          roleDescription: 'Front desk',
          permissionCode: 'patients.read',
          permissionModule: 'patients',
        },
      ], // loadAssignableRoleCatalogue
    );
    mockDb.state!.queueInsert([
      {
        id: 501,
        email: 'grace@nyeri.test',
        fullName: 'Grace Njeri',
        facilityId: 10,
        roleId: 3,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdAt: new Date(),
      },
    ]);

    const created = await invitations.createStaffInvitation({
      tenantId: 1,
      facilityId: 10,
      email: 'Grace@Nyeri.Test',
      fullName: 'Grace Njeri',
      roleId: 3,
      invitedBy: '10',
    });
    expect(created.invitation.email).toBe('grace@nyeri.test');
    expect(created.token.length).toBeGreaterThanOrEqual(30);

    // Validate invitation token
    mockDb.state!.queueSelect([
      {
        id: 501,
        tenantId: 1,
        facilityId: 10,
        email: 'grace@nyeri.test',
        fullName: 'Grace Njeri',
        designation: 'Receptionist',
        roleName: 'RECEPTIONIST',
        expiresAt: new Date(Date.now() + 86_400_000),
        acceptedAt: null,
        revokedAt: null,
      },
    ]);
    const valid = await invitations.validateStaffInvitation(created.token);
    expect(valid.roleName).toBe('RECEPTIONIST');

    // List invitations maps status across pending / accepted / revoked / expired
    mockDb.state!.queueSelect([
      {
        id: 501,
        email: 'grace@nyeri.test',
        fullName: 'Grace Njeri',
        designation: null,
        roleId: 3,
        roleName: 'RECEPTIONIST',
        expiresAt: new Date(Date.now() + 86_400_000),
        acceptedAt: null,
        revokedAt: null,
        createdAt: new Date(),
        invitedBy: '10',
      },
      {
        id: 502,
        email: 'expired@nyeri.test',
        fullName: 'Old Invite',
        designation: null,
        roleId: 3,
        roleName: 'RECEPTIONIST',
        expiresAt: new Date(Date.now() - 10_000),
        acceptedAt: null,
        revokedAt: null,
        createdAt: new Date(),
        invitedBy: '10',
      },
    ]);
    const list = await invitations.listStaffInvitations(1, 10);
    expect(list.map((r) => r.status)).toEqual(['pending', 'expired']);

    // Reissue & revoke
    mockDb.state!.queueSelect([
      {
        id: 501,
        tenantId: 1,
        facilityId: 10,
        email: 'grace@nyeri.test',
        fullName: 'Grace Njeri',
        acceptedAt: null,
        revokedAt: null,
      },
    ]);
    mockDb.state!.queueUpdate([
      {
        id: 501,
        email: 'grace@nyeri.test',
        fullName: 'Grace Njeri',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    ]);
    const reissued = await invitations.reissueStaffInvitation(501, 1, 10);
    expect(reissued.token.length).toBeGreaterThanOrEqual(30);

    mockDb.state!.queueSelect([
      { id: 501, tenantId: 1, facilityId: 10, acceptedAt: null, revokedAt: null },
    ]);
    mockDb.state!.queueUpdate([{ id: 501 }]);
    expect(await invitations.revokeStaffInvitation(501, 1, 10)).toEqual({
      id: 501,
      revoked: true,
    });
  });

  it('creates, updates, and deletes wards and beds while deriving capacity and guarding history', async () => {
    // Create ward
    mockDb.state!.queueInsert([
      {
        id: 1,
        facilityId: 10,
        name: 'Female Medical Ward',
        code: 'FMW-1',
        wardType: 'Medical',
        genderAllocation: 'Female',
        totalBeds: 0,
        dailyRate: '2000.00',
        isActive: true,
      },
    ]);
    const ward = await wardBeds.createWard(ctx, {
      name: 'Female Medical Ward',
      code: 'fmw 1',
      wardType: 'Medical',
      genderAllocation: 'Female',
      dailyRate: '2000',
    });
    expect(ward.code).toBe('FMW-1');
    expect(ward.totalBeds).toBe(0);

    // Update ward
    mockDb.state!.queueSelect([{ id: 1, facilityId: 10, code: 'FMW-1', isActive: true }]);
    mockDb.state!.queueUpdate([{ id: 1, facilityId: 10, name: 'Female Ward A', isActive: true }]);
    const updatedWard = await wardBeds.updateWard(ctx, 1, { name: 'Female Ward A' });
    expect(updatedWard.name).toBe('Female Ward A');

    // Delete ward refused when admission history exists -> 409 WARD_HAS_HISTORY
    mockDb.state!.queueSelect(
      [{ id: 1, facilityId: 10, code: 'FMW-1', isActive: true }],
      [{ value: 3 }],
    );
    await expect(wardBeds.deleteWard(ctx, 1)).rejects.toMatchObject({
      code: 'WARD_HAS_HISTORY',
      status: 409,
    });

    // Delete empty ward succeeds
    mockDb.state!.queueSelect(
      [{ id: 1, facilityId: 10, code: 'FMW-1', isActive: true }],
      [{ value: 0 }], // admissions
      [{ value: 0 }], // occupied beds
    );
    mockDb.state!.queueDelete([], []);
    expect(await wardBeds.deleteWard(ctx, 1)).toEqual({
      deleted: true,
      wardId: 1,
      code: 'FMW-1',
    });

    // Create beds via prefix + count and sync ward capacity
    mockDb.state!.queueSelect(
      [{ id: 1, facilityId: 10, code: 'FMW-1', isActive: true }],
      [], // no existing bed number collision
      [{ value: 3 }], // syncWardCapacity count
    );
    mockDb.state!.queueInsert([
      { id: 101, bedNumber: 'B-1' },
      { id: 102, bedNumber: 'B-2' },
      { id: 103, bedNumber: 'B-3' },
    ]);
    mockDb.state!.queueUpdate([]);
    const createdBeds = await wardBeds.createBeds(ctx, {
      wardId: 1,
      prefix: 'B-',
      startNumber: 1,
      count: 3,
      bedType: 'General',
      dailyCharge: '1500',
    });
    expect(createdBeds.totalBeds).toBe(3);
  });

  it('records nursing vitals with NEWS2/BMI validation and generates inpatient operations reports', async () => {
    queriesMocks.getAdmissionByIdScoped.mockResolvedValue({
      id: 77,
      patientId: 42,
      facilityId: 10,
      wardId: 1,
      bedId: 101,
      encounterId: 300,
      status: 'Admitted',
    });

    // Empty observation rejected
    await expect(nursing.recordVitalsScoped(ctx, { admissionId: 77 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      status: 400,
    });

    // Systolic <= diastolic rejected
    await expect(
      nursing.recordVitalsScoped(ctx, { admissionId: 77, systolicBp: 80, diastolicBp: 85 }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400 });

    // Valid vitals computes BMI and stores observation
    mockDb.state!.queueInsert([
      {
        id: 901,
        encounterId: 300,
        patientId: 42,
        systolicBp: 120,
        diastolicBp: 78,
        pulseRate: 76,
        temperatureC: '36.8',
        respiratoryRate: 16,
        spo2Percent: 98,
        weightKg: '64.0',
        heightCm: '160.0',
        bmi: '25.0',
      },
    ]);
    const vitals = await nursing.recordVitalsScoped(ctx, {
      admissionId: 77,
      systolicBp: 120,
      diastolicBp: 78,
      pulseRate: 76,
      temperatureC: 36.8,
      respiratoryRate: 16,
      spo2Percent: 98,
      weightKg: 64,
      heightCm: 160,
      recordedBy: 'Nurse Faith',
    });
    expect(vitals.bmi).toBe('25.0');
    expect(vitals.flags).toBeDefined();

    // Operations report computes occupancy & length-of-stay stats
    queriesMocks.getWardsScoped.mockResolvedValue([
      {
        id: 1,
        facilityId: 10,
        name: 'Female Ward',
        code: 'FW',
        wardType: 'General',
        isActive: true,
      },
    ]);
    queriesMocks.getAdmissionsScoped.mockResolvedValue([
      {
        id: 77,
        facilityId: 10,
        patientId: 42,
        wardId: 1,
        bedId: 101,
        status: 'Admitted',
        admissionDate: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        dischargeDate: null,
      },
      {
        id: 78,
        facilityId: 10,
        patientId: 43,
        wardId: 1,
        bedId: 102,
        status: 'Discharged',
        admissionDate: new Date(Date.now() - 10 * 86_400_000).toISOString(),
        dischargeDate: new Date(Date.now() - 6 * 86_400_000).toISOString(),
      },
    ]);
    mockDb.state!.queueSelect(
      [
        { id: 101, wardId: 1, bedNumber: 'B-1', status: 'Occupied', currentPatientId: 42 },
        { id: 102, wardId: 1, bedNumber: 'B-2', status: 'Available', currentPatientId: null },
      ],
      [
        { id: 101, wardId: 1, bedNumber: 'B-1', status: 'Occupied', currentPatientId: 42 },
        { id: 102, wardId: 1, bedNumber: 'B-2', status: 'Available', currentPatientId: null },
      ],
    );

    const opsReport = await reporting.getOperationsReportScoped(ctx, 10);
    expect(opsReport.facilityId).toBe(10);
    expect(opsReport.wards).toHaveLength(1);
    expect(opsReport.wards[0]?.occupiedBeds).toBe(1);

    const trend = await reporting.getOccupancyTrendScoped(ctx, 10, 7);
    expect(trend).toHaveLength(7);

    // Inpatient board & shift handover
    queriesMocks.getAdmissionsScoped.mockResolvedValue([
      {
        id: 77,
        facilityId: 10,
        patientId: 42,
        wardId: 1,
        bedId: 101,
        status: 'Admitted',
        admissionDate: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        dischargeDate: null,
      },
    ]);
    queriesMocks.getBedsScoped.mockResolvedValue([
      { id: 101, wardId: 1, bedNumber: 'B-1', status: 'Occupied', currentPatientId: 42 },
    ]);
    mockDb.state!.queueSelect(
      [{ id: 42, firstName: 'Amina', middleName: null, lastName: 'Ali', mrn: 'MRN-42' }],
      [
        {
          id: 901,
          encounterId: 300,
          patientId: 42,
          systolicBp: 85,
          diastolicBp: 50,
          pulseRate: 132,
          temperatureC: '38.8',
          respiratoryRate: 26,
          spo2Percent: 91,
          recordedAt: new Date(),
        },
      ],
      [{ id: 1, patientId: 42, admissionId: 77, shift: 'Morning', recordedAt: new Date() }],
    );
    const board = await nursing.getInpatientBoardScoped(ctx, 10);
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0]?.patientName).toBe('Amina Ali');

    // Shift handover calls getInpatientBoardScoped + 2 more selects (notes + transfers)
    mockDb.state!.queueSelect(
      [{ id: 42, firstName: 'Amina', middleName: null, lastName: 'Ali', mrn: 'MRN-42' }],
      [
        {
          id: 901,
          encounterId: 300,
          patientId: 42,
          systolicBp: 120,
          diastolicBp: 78,
          pulseRate: 76,
          temperatureC: '36.8',
          respiratoryRate: 16,
          spo2Percent: 98,
          recordedAt: new Date(),
        },
      ],
      [],
      [],
      [],
    );
    const handover = await nursing.getShiftHandoverScoped(ctx, { shift: 'Morning' });
    expect(handover.groups.length).toBeGreaterThanOrEqual(1);
  });
});
