import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { MasterCatalogueError } from './master-catalogue.service.ts';

type Facility = { id: number; tenantId: number };

export async function listReviewedSpecimens(facility: Facility) {
  return db
    .select({
      id: schema.labTestSpecimenOptions.id,
      testId: schema.labTestSpecimenOptions.testId,
      specimenType: schema.labTestSpecimenOptions.specimenType,
      reviewReference: schema.labTestSpecimenOptions.reviewReference,
      createdAt: schema.labTestSpecimenOptions.createdAt,
      retiredAt: schema.labTestSpecimenOptions.retiredAt,
      retirementReference: schema.labTestSpecimenOptions.retirementReference,
    })
    .from(schema.labTestSpecimenOptions)
    .where(
      and(
        eq(schema.labTestSpecimenOptions.tenantId, facility.tenantId),
        eq(schema.labTestSpecimenOptions.facilityId, facility.id),
      ),
    );
}

function reference(value: unknown) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (result.length < 3 || result.length > 500)
    throw new MasterCatalogueError(
      'REVIEW_REFERENCE_REQUIRED',
      'Enter a clinical review reference of 3–500 characters.',
    );
  return result;
}

/** Records an external clinical review; this does not assert that software approved a protocol. */
export async function addReviewedSpecimen(
  facility: Facility,
  actor: number,
  input: { testId?: unknown; specimenType?: unknown; reviewReference?: unknown },
) {
  const testId = input.testId;
  const specimen = typeof input.specimenType === 'string' ? input.specimenType.trim() : '';
  const review = reference(input.reviewReference);
  if (
    typeof testId !== 'number' ||
    !Number.isSafeInteger(testId) ||
    testId <= 0 ||
    !specimen ||
    specimen.length > 120 ||
    /[,;\n\r]/.test(specimen)
  )
    throw new MasterCatalogueError(
      'INVALID_SPECIMEN_OPTION',
      'Select a facility test and enter one specimen per option.',
    );
  return db.transaction(async (tx) => {
    const [test] = await tx
      .select({ id: schema.labTests.id })
      .from(schema.labTests)
      .where(
        and(
          eq(schema.labTests.id, testId),
          eq(schema.labTests.facilityId, facility.id),
          eq(schema.labTests.isActive, true),
        ),
      )
      .limit(1)
      .for('share');
    if (!test)
      throw new MasterCatalogueError(
        'TEST_NOT_FOUND',
        'Active test not found in this facility.',
        404,
      );
    const [inserted] = await tx
      .insert(schema.labTestSpecimenOptions)
      .values({
        tenantId: facility.tenantId,
        facilityId: facility.id,
        testId,
        specimenType: specimen,
        reviewReference: review,
        createdByUserId: actor,
      })
      .onConflictDoNothing()
      .returning();
    if (!inserted)
      throw new MasterCatalogueError(
        'SPECIMEN_ALREADY_EXISTS',
        'This reviewed specimen is already active for this test.',
        409,
      );
    await tx.insert(schema.auditLogs).values({
      tenantId: facility.tenantId,
      facilityId: facility.id,
      userId: String(actor),
      action: 'CREATE',
      resource: 'LAB_SPECIMEN_OPTION',
      resourceId: String(inserted.id),
      details: `Test ${testId}; specimen ${specimen}; clinical review: ${review}`,
    });
    return inserted;
  });
}

export async function retireReviewedSpecimen(
  facility: Facility,
  actor: number,
  id: number,
  reason: unknown,
) {
  const review = reference(reason);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new MasterCatalogueError('INVALID_ID', 'Invalid option ID.');
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.labTestSpecimenOptions)
      .set({
        retiredAt: new Date(),
        retiredByUserId: actor,
        retirementReference: review,
      })
      .where(
        and(
          eq(schema.labTestSpecimenOptions.id, id),
          eq(schema.labTestSpecimenOptions.tenantId, facility.tenantId),
          eq(schema.labTestSpecimenOptions.facilityId, facility.id),
          isNull(schema.labTestSpecimenOptions.retiredAt),
        ),
      )
      .returning();
    if (!updated)
      throw new MasterCatalogueError(
        'SPECIMEN_NOT_FOUND',
        'Active reviewed specimen not found.',
        404,
      );
    await tx.insert(schema.auditLogs).values({
      tenantId: facility.tenantId,
      facilityId: facility.id,
      userId: String(actor),
      action: 'RETIRE',
      resource: 'LAB_SPECIMEN_OPTION',
      resourceId: String(id),
      details: `Test ${updated.testId}; clinical review: ${review}`,
    });
    return updated;
  });
}
