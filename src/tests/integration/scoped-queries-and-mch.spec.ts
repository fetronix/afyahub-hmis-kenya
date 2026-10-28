import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import type { PortalSession } from '../../portal/portal-auth.service.ts';
import { createMockDbState } from './support/drizzle-mock.ts';

const mockDb = vi.hoisted(() => ({ state: null as ReturnType<typeof createMockDbState> | null }));

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

const queries = await import('../../db/queries.ts');
const sharedQueries = await import('../../db/queries/shared.ts');
const postnatal = await import('../../maternity/postnatal.service.ts');
const immunisation = await import('../../immunisation/immunisation.service.ts');
const qrService = await import('../../portal/qr.service.ts');
const sharingService = await import('../../portal/portal-sharing.service.ts');
const portalAuth = await import('../../portal/portal-auth.service.ts');

const ctx: AuthorizationContext = {
  userId: 10,
  tenantId: 1,
  facilityId: 10,
  roles: ['FACILITY_ADMIN'],
  permissions: [
    'patients.read',
    'patients.write',
    'inpatient.read',
    'inpatient.write',
    'maternity.read',
    'maternity.write',
    'immunisation.read',
    'immunisation.write',
    'billing.read',
    'billing.write',
    'laboratory.read',
    'laboratory.write',
  ],
  isSuperAdmin: false,
};

const portalSession: PortalSession = {
  sessionId: 1,
  accountId: 200,
  patientId: 42,
  tenantId: 1,
  facilityId: 10,
  loginIdentifier: 'MRN-2026-0001',
};

describe('Scoped DB Queries, Postnatal/Immunisation MCH Services & Patient Portal Services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.state?.reset();
  });

  it('exercises shared query helpers, patient registration/encryption scoping, clinical diagnoses/procedures, and billing queries', async () => {
    expect(sharedQueries.requirePositiveId('42', 'patient ID')).toBe(42);
    expect(() => sharedQueries.requirePositiveId('0', 'patient ID')).toThrow();
    expect(sharedQueries.optionalText('  hello  ')).toBe('hello');
    expect(sharedQueries.optionalText('   ')).toBeNull();
    expect(sharedQueries.normaliseCatalogueKey('  Full  Blood-Count (FBC) ')).toBe(
      'full blood count fbc',
    );
    expect(sharedQueries.toCentsPositive('150.25')).toBe(15_025);
    expect(
      sharedQueries.pickEncounterWritableFields({
        chiefComplaint: 'Headache',
        tenantId: 999,
        id: 777,
      }),
    ).toEqual({ chiefComplaint: 'Headache' });

    // createPatientScoped seals National ID / SHA and opens on return
    mockDb.state!.queueSelect([{ id: 10, tenantId: 1, isActive: true }]); // getFacilityByIdScoped
    mockDb.state!.queueInsert([
      {
        id: 42,
        tenantId: 1,
        registrationFacilityId: 10,
        mrn: 'MRN-2026-0001',
        firstName: 'Amina',
        lastName: 'Ali',
        nationalId: '31234567',
        shaNumber: 'SHA-9988',
      },
    ]);
    const createdPatient = await queries.createPatientScoped(ctx, {
      tenantId: 1,
      registrationFacilityId: 10,
      mrn: 'MRN-2026-0001',
      firstName: 'Amina',
      lastName: 'Ali',
      gender: 'Female',
      dateOfBirth: '1995-04-12',
      nationalId: '31234567',
      shaNumber: 'SHA-9988',
    });
    expect(createdPatient.id).toBe(42);

    // getPatientByIdScoped & getPatientsScoped
    mockDb.state!.queueSelect([
      {
        id: 42,
        tenantId: 1,
        registrationFacilityId: 10,
        mrn: 'MRN-2026-0001',
        firstName: 'Amina',
      },
    ]);
    const byId = await queries.getPatientByIdScoped(ctx, 42);
    expect(byId?.id).toBe(42);

    mockDb.state!.queueSelect([
      {
        id: 42,
        tenantId: 1,
        registrationFacilityId: 10,
        mrn: 'MRN-2026-0001',
        firstName: 'Amina',
      },
    ]);
    const list = await queries.getPatientsScoped(ctx, 1, 10, 'Amina');
    expect(list).toHaveLength(1);

    // Clinical scoped diagnoses & procedures
    mockDb.state!.queueSelect(
      [{ id: 300, patientId: 42, facilityId: 10, tenantId: 1 }],
      [{ id: 10, tenantId: 1 }],
    );
    mockDb.state!.queueInsert([{ id: 1, encounterId: 300, icd10Code: 'J06.9' }]);
    const diag = await queries.recordDiagnosisScoped(ctx, {
      encounterId: 300,
      patientId: 42,
      icd10Code: 'J06.9',
      icd10Description: 'Acute URTI',
      diagnosisType: 'Primary',
    } as any);
    expect(diag.id).toBe(1);
    expect(mockDb.state!.calls).toContainEqual({
      op: 'insert',
      values: expect.objectContaining({
        resource: 'diagnosis',
        action: 'CREATE',
        tenantId: 1,
        facilityId: 10,
      }),
    });

    mockDb.state!.queueSelect(
      [{ id: 300, patientId: 42, facilityId: 10, tenantId: 1 }],
      [{ id: 10, tenantId: 1 }],
    );
    mockDb.state!.queueInsert([{ id: 2, encounterId: 300, procedureName: 'Nebulisation' }]);
    const proc = await queries.recordProcedureScoped(ctx, {
      encounterId: 300,
      patientId: 42,
      procedureName: 'Nebulisation',
    } as any);
    expect(proc.id).toBe(2);

    // Billing scoped invoice detail & void refusal when paid
    mockDb.state!.queueSelect(
      [
        {
          id: 900,
          tenantId: 1,
          facilityId: 10,
          invoiceNumber: 'INV-900',
          paidAmount: '500.00',
          status: 'Partially Paid',
          voidedAt: null,
        },
      ],
      [{ id: 1, invoiceId: 900, description: 'OPD', totalAmount: '1500.00' }],
      [{ id: 1, invoiceId: 900, amount: '500.00' }],
    );
    const invDetail = await queries.getInvoiceDetailScoped(ctx, 900);
    expect(invDetail?.items).toHaveLength(1);

    mockDb.state!.queueSelect([
      {
        id: 900,
        tenantId: 1,
        facilityId: 10,
        invoiceNumber: 'INV-900',
        paidAmount: '500.00',
        status: 'Partially Paid',
        voidedAt: null,
      },
    ]);
    await expect(queries.voidInvoiceScoped(ctx, 900, 'Duplicate')).rejects.toThrow();
  });

  it('exercises inpatient admission/discharge/nursing-notes and laboratory order/result/verification queries', async () => {
    // getWardsScoped & getBedsScoped
    mockDb.state!.queueSelect(
      [{ id: 10, tenantId: 1 }], // facility check
      [{ id: 1, facilityId: 10, name: 'General Ward' }],
    );
    expect(await queries.getWardsScoped(ctx, 10)).toHaveLength(1);

    mockDb.state!.queueSelect(
      [{ id: 1, facilityId: 10 }], // ward
      [{ id: 10, tenantId: 1 }], // getFacilityByIdScoped
      [{ id: 101, wardId: 1, bedNumber: 'B-1', status: 'Available' }],
    );
    expect(await queries.getBedsScoped(ctx, 1)).toHaveLength(1);

    // createNursingNoteScoped validates shift & note type
    mockDb.state!.queueSelect([
      { id: 77, patientId: 42, tenantId: 1, facilityId: 10, status: 'Admitted' },
    ]);
    mockDb.state!.queueInsert([
      {
        id: 55,
        facilityId: 10,
        patientId: 42,
        admissionId: 77,
        shift: 'Morning',
        noteType: 'Progress',
        content: 'Patient afebrile and tolerating oral fluids.',
      },
    ]);
    const note = await queries.createNursingNoteScoped(ctx, {
      patientId: 42,
      admissionId: 77,
      shift: 'Morning',
      noteType: 'Progress',
      note: 'Patient afebrile and tolerating oral fluids.',
      recordedBy: 'Nurse Faith',
    });
    expect(note.id).toBe(55);

    // Laboratory queries: getLabTests, getLabOrders, getRadiologyOrders
    mockDb.state!.queueSelect([{ id: 1, facilityId: 10, testName: 'Malaria RDT' }]);
    expect(await queries.getLabTests(10)).toHaveLength(1);

    mockDb.state!.queueSelect(
      [{ id: 10, tenantId: 1 }],
      [{ id: 1, facilityId: 10, status: 'Pending' }],
    );
    expect(await queries.getLabOrders(ctx, 10)).toHaveLength(1);

    mockDb.state!.queueSelect([{ id: 1, facilityId: 10, modality: 'X-Ray' }]);
    expect(await queries.getRadiologyOrders(10)).toHaveLength(1);
  });

  it('exercises postnatal maternal-newborn contact checks and KEPI immunisation schedule/due-list rules', async () => {
    const deliveredPregnancy = {
      id: 100,
      tenantId: 1,
      facilityId: 10,
      patientId: 42,
      status: 'Delivered',
    };

    // Postnatal visit derives dayPostpartum from delivery date
    mockDb.state!.queueSelect(
      [deliveredPregnancy],
      [{ id: 10, tenantId: 1 }], // getFacilityByIdScoped inside resolvePregnancy
      [{ id: 501, pregnancyId: 100, deliveredAt: '2026-10-20T08:00:00Z' }],
    );
    mockDb.state!.queueInsert([{ id: 701, pregnancyId: 100, dayPostpartum: 6 }]);

    const pnc = await postnatal.recordPostnatalVisit(ctx, {
      pregnancyId: 100,
      deliveryId: 501,
      visitDate: '2026-10-26',
      visitNumber: 2,
      bpSystolic: 116,
      bpDiastolic: 74,
      temperatureC: 36.7,
      involution: 'Normal',
      lochia: 'Serosa',
      breastfeeding: 'Exclusive',
      babyWeightGrams: 3350,
    });
    expect(pnc.id).toBe(701);

    // Immunisation: unknown antigen -> 400 UNKNOWN_ANTIGEN
    mockDb.state!.queueSelect([
      { id: 99, tenantId: 1, registrationFacilityId: 10, dateOfBirth: '2026-10-01' },
    ]);
    await expect(
      immunisation.recordImmunisation(ctx, {
        patientId: 99,
        antigenCode: 'NOT-REAL',
        administeredOn: '2026-10-20',
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_ANTIGEN', statusCode: 400 });

    // Immunisation: administered before birth -> 400 BEFORE_BIRTH
    mockDb.state!.queueSelect([
      { id: 99, tenantId: 1, registrationFacilityId: 10, dateOfBirth: '2026-10-15' },
    ]);
    await expect(
      immunisation.recordImmunisation(ctx, {
        patientId: 99,
        antigenCode: 'BCG',
        administeredOn: '2026-10-01',
      }),
    ).rejects.toMatchObject({ code: 'BEFORE_BIRTH', statusCode: 400 });

    // Valid BCG dose + immunisation card
    mockDb.state!.queueSelect([
      { id: 99, tenantId: 1, registrationFacilityId: 10, dateOfBirth: '2026-10-15' },
    ]);
    mockDb.state!.queueInsert([
      { id: 1, patientId: 99, antigenCode: 'BCG', doseNumber: 1, administeredOn: '2026-10-16' },
    ]);
    const vax = await immunisation.recordImmunisation(ctx, {
      patientId: 99,
      antigenCode: 'BCG',
      doseNumber: 1,
      administeredOn: '2026-10-16',
      batchNumber: 'BCG-77',
    });
    expect(vax.antigenCode).toBe('BCG');

    mockDb.state!.queueSelect(
      [
        {
          id: 99,
          tenantId: 1,
          registrationFacilityId: 10,
          firstName: 'Baby',
          lastName: 'Wambui',
          dateOfBirth: '2026-08-01',
        },
      ],
      [{ id: 1, patientId: 99, antigenCode: 'BCG', doseNumber: 1, administeredOn: '2026-08-02' }],
    );
    const card = await immunisation.immunisationCard(ctx, 99);
    expect(card.statuses.length).toBeGreaterThan(5);
  });

  it('exercises patient portal QR card issuance, time-bounded sharing grants, and session revocation', async () => {
    // Issue digital QR card -> updates account, renders SVG, writes audit event
    mockDb.state!.queueUpdate([]);
    mockDb.state!.queueSelect([
      { mrn: 'MRN-42', firstName: 'Amina', lastName: 'Ali', dateOfBirth: '1995-04-12' },
    ]);
    mockDb.state!.queueInsert([]);
    const card = await qrService.issueDigitalCard(portalSession);
    expect(card.svg).toContain('<svg');

    // Create & list sharing grants
    mockDb.state!.queueInsert([{ id: 301 }]);
    mockDb.state!.queueInsert([]); // audit log
    const grant = await sharingService.createSharingGrant(portalSession, {
      recipientName: 'Dr. Mwangi',
      purpose: 'Second opinion consultation',
      categories: ['encounters', 'laboratory'],
      hours: 24,
    });
    expect(grant.grantId).toBe(301);
    expect(grant.code.length).toBeGreaterThan(10);

    mockDb.state!.queueSelect([
      {
        id: 301,
        recipientName: 'Dr. Mwangi',
        purpose: 'Second opinion',
        categories: ['VISITS'],
        expiresAt: new Date(Date.now() + 3600_000),
        revokedAt: null,
        redeemedAt: null,
        createdAt: new Date(),
      },
    ]);
    const grants = await sharingService.listSharingGrants(portalSession);
    expect(grants[0]?.state).toBe('OPEN');

    // Revoke portal sessions
    mockDb.state!.queueUpdate([{ id: 1 }, { id: 2 }]);
    expect(await portalAuth.revokeAllPortalSessions(200, 'Password reset')).toBe(2);
  });
});
