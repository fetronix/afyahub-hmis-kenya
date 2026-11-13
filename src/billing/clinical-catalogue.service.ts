import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { calendarDateInZone, validTimezone } from '../dashboard/timezone.ts';
import { resolveConfiguredService, type MasterChargeResolution } from './master-charge-resolver.ts';

type Family = 'CONSULTATION' | 'LABORATORY' | 'RADIOLOGY';
type Facility = { id: number; tenantId: number };

/** Current indicative price only; completion rechecks the tariff at the service date. */
function price(resolution: MasterChargeResolution | null) {
  if (!resolution)
    return {
      unitPrice: null,
      priceStatus: 'TIMEZONE_REQUIRED',
      priceMessage: 'Facility timezone is not configured.',
    };
  if ('failure' in resolution)
    return {
      unitPrice: null,
      priceStatus: resolution.failure.code,
      priceMessage: resolution.failure.message,
    };
  return {
    unitPrice: resolution.tariff.fee,
    priceStatus: 'AVAILABLE',
    priceMessage: null,
    tariffCode: resolution.tariff.code,
    approvedAt: resolution.tariff.approvedAt,
    effectiveFrom: resolution.tariff.effectiveFrom,
    effectiveTo: resolution.tariff.effectiveTo,
  };
}

export async function listClinicalCatalogue(facility: Facility, family: Family) {
  const [zone] = await db
    .select({ facility: schema.facilities.timezone, tenant: schema.tenants.timezone })
    .from(schema.facilities)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.facilities.tenantId))
    .where(
      and(eq(schema.facilities.id, facility.id), eq(schema.facilities.tenantId, facility.tenantId)),
    )
    .limit(1);
  const timezone = zone?.facility ?? zone?.tenant;
  const today = validTimezone(timezone) ? calendarDateInZone(timezone) : null;

  if (family === 'LABORATORY') {
    const tests = await db
      .select({
        id: schema.labTests.id,
        code: schema.labTests.code,
        description: schema.labTests.name,
        category: schema.labTests.category,
      })
      .from(schema.labTests)
      .where(and(eq(schema.labTests.facilityId, facility.id), eq(schema.labTests.isActive, true)))
      .orderBy(asc(schema.labTests.name), asc(schema.labTests.id));
    const options = await db
      .select({
        id: schema.labTestSpecimenOptions.id,
        testId: schema.labTestSpecimenOptions.testId,
        specimenType: schema.labTestSpecimenOptions.specimenType,
      })
      .from(schema.labTestSpecimenOptions)
      .where(
        and(
          eq(schema.labTestSpecimenOptions.tenantId, facility.tenantId),
          eq(schema.labTestSpecimenOptions.facilityId, facility.id),
          isNull(schema.labTestSpecimenOptions.retiredAt),
        ),
      )
      .orderBy(asc(schema.labTestSpecimenOptions.specimenType));
    return Promise.all(
      tests.map(async (test) => {
        const resolved = today
          ? await resolveConfiguredService(db, {
              tenantId: facility.tenantId,
              facilityId: facility.id,
              sourceType: 'LAB_ORDER',
              sourceKind: 'LAB_TEST',
              sourceId: test.id,
              sourceCode: test.code,
              sourceUnit: 'Test',
              eventDate: today,
            })
          : null;
        return {
          ...test,
          testId: test.id,
          family,
          department: 'laboratory',
          unit: 'Test',
          masterServiceId: resolved && !('failure' in resolved) ? resolved.master.id : null,
          specimenOptions: options
            .filter((option) => option.testId === test.id)
            .map(({ id, specimenType }) => ({ id, specimenType })),
          ...price(resolved),
        };
      }),
    );
  }
  const masters = await db
    .select({
      id: schema.masterServices.id,
      code: schema.masterServices.code,
      description: schema.masterServices.description,
      department: schema.masterServices.department,
      unit: schema.masterServices.unit,
      clinicalSource: schema.masterServices.clinicalSource,
    })
    .from(schema.masterServices)
    .innerJoin(
      schema.facilityServiceTariffs,
      and(
        eq(schema.facilityServiceTariffs.masterServiceId, schema.masterServices.id),
        eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
        eq(schema.facilityServiceTariffs.facilityId, facility.id),
      ),
    )
    .where(
      and(
        eq(schema.masterServices.billingFamily, family),
        eq(schema.masterServices.isActive, true),
        or(
          isNull(schema.masterServices.tenantId),
          eq(schema.masterServices.tenantId, facility.tenantId),
        ),
        or(
          isNull(schema.masterServices.originFacilityId),
          eq(schema.masterServices.originFacilityId, facility.id),
        ),
      ),
    )
    .orderBy(asc(schema.masterServices.description), asc(schema.masterServices.id));
  return Promise.all(
    masters.map(async (master) => ({
      ...master,
      family,
      ...price(
        today
          ? await resolveConfiguredService(db, {
              tenantId: facility.tenantId,
              facilityId: facility.id,
              sourceType: family,
              masterId: master.id,
              eventDate: today,
            })
          : null,
      ),
    })),
  );
}
