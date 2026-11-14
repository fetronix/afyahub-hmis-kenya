import type { z } from 'zod';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import {
  createFacilityServiceInput,
  requireFacilityServiceModule,
  type FacilityServiceScope,
} from './facility-service-input.ts';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type FacilityTariffRow = typeof schema.facilityServiceTariffs.$inferSelect;
type ServiceCreation = z.output<typeof createFacilityServiceInput> & {
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
};

export async function auditFacilityService(
  tx: Transaction,
  facility: FacilityServiceScope,
  actor: number,
  action: string,
  resource: string,
  resourceId: number,
  details: unknown,
) {
  await tx.insert(schema.auditLogs).values({
    tenantId: facility.tenantId,
    facilityId: facility.id,
    userId: String(actor),
    action,
    resource,
    resourceId: String(resourceId),
    details: JSON.stringify(details),
  });
}

export function tariffAuditSnapshot(row: FacilityTariffRow) {
  return {
    code: row.code,
    description: row.description,
    serviceId: row.facilityServiceId,
    fee: row.fee,
    unit: row.unit,
    department: row.department,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    isActive: row.isActive,
    autoBill: row.autoBill,
    archivedAt: row.archivedAt,
    revision: row.revision,
  };
}

/**
 * Create one facility-owned service and its linked initial tariff in the caller's
 * transaction. Both normal and batch intake use the same checks and audit writes.
 */
export async function createFacilityServiceWithTariff(
  tx: Transaction,
  facility: FacilityServiceScope,
  actor: number,
  data: ServiceCreation,
) {
  const department = requireFacilityServiceModule(facility, data.department, data.category);
  const [service] = await tx
    .insert(schema.facilityServices)
    .values({
      tenantId: facility.tenantId,
      facilityId: facility.id,
      code: data.code,
      name: data.name,
      description: data.description,
      department,
      category: data.category,
      unit: data.unit,
      isActive: data.isActive,
      autoBill: data.autoBill,
    })
    .returning();
  const [tariff] = await tx
    .insert(schema.facilityServiceTariffs)
    .values({
      tenantId: facility.tenantId,
      facilityId: facility.id,
      facilityServiceId: service.id,
      code: data.initialTariffCode ?? data.code,
      description: data.description,
      department,
      unit: data.unit,
      fee: data.initialPrice,
      effectiveFrom: data.effectiveFrom ?? null,
      effectiveTo: data.effectiveTo ?? null,
      isActive: true,
      autoBill: data.autoBill,
    })
    .returning();
  await auditFacilityService(tx, facility, actor, 'CREATE', 'FACILITY_SERVICE', service.id, {
    code: service.code,
    department,
    category: service.category,
    initialTariffId: tariff.id,
    fee: tariff.fee,
  });
  // Record the complete initial tariff fields for future history. Older events
  // remain incomplete; this must never be treated as a reconstructed history.
  await auditFacilityService(
    tx,
    facility,
    actor,
    'CREATE',
    'FACILITY_SERVICE_TARIFF',
    tariff.id,
    tariffAuditSnapshot(tariff),
  );
  return { service, tariff };
}
