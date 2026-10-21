/**
 * JaliCare HMIS
 * Charges raised by the clinical screens
 *
 * The route handlers used to build these requests inline, which meant a
 * wrong field name could only be caught by reading the handler. The two
 * that matter most are here instead, so a test can call exactly what
 * the route calls:
 *
 *   - a laboratory batch charges every order, not just the first
 *   - radiology prices from `procedure_name`, the column that exists
 *
 * Nothing here decides money. `chargeForService` does, from the
 * facility's own tariffs.
 */

import type * as schema from '../db/schema.ts';

import {
  chargeForService,
  type ChargeRequest,
  type ChargeResult,
} from './billing.service.ts';

/* ============================================================
   TARIFF CODE CANDIDATES
   ============================================================ */

/**
 * Turn a clinical record into the tariff codes that might price it.
 *
 * The tariff table is free text per facility, so several plausible
 * codes are offered and the first configured one wins:
 *   PROCEDURE-WOUND-DRESSING, WOUND-DRESSING, PROCEDURE, PROC-GENERAL
 */
export function tariffCodeCandidates(
  prefix: string,
  value: string | null | undefined,
  defaults: readonly string[],
): string[] {
  const codes: string[] = [];

  const cleaned =
    typeof value === 'string'
      ? value
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
      : '';

  if (cleaned) {
    codes.push(`${prefix}-${cleaned}`, cleaned);
  }

  codes.push(...defaults);

  return [...new Set(codes)];
}

/* ============================================================
   LABORATORY
   ============================================================ */

export type ChargeableLabOrder = Pick<
  typeof schema.labOrders.$inferSelect,
  'id' | 'tenantId' | 'facilityId' | 'patientId' | 'encounterId' | 'testName'
>;

export function labOrderChargeRequest(
  order: ChargeableLabOrder,
): ChargeRequest {
  return {
    tenantId: order.tenantId,
    facilityId: order.facilityId,
    patientId: order.patientId,
    encounterId: order.encounterId ?? null,
    codes: tariffCodeCandidates('LAB', order.testName, [
      'LAB-GENERAL',
      'LABORATORY',
    ]),
    sourceType: 'LAB_ORDER',
    sourceId: order.id,
    itemType: 'Laboratory',
    description: order.testName,
  };
}

export interface LabOrderChargeResult {
  orderId: number;
  testName: string;
  billing: ChargeResult | null;
}

/**
 * Price every order in a batch.
 *
 * A failure on one order must not stop the others being billed, and a
 * missing tariff must not fail the ordering at all: the order is
 * recorded either way, and the result says which were billed.
 */
export async function chargeLabOrderBatch(
  orders: readonly ChargeableLabOrder[],
  executor: Parameters<typeof chargeForService>[0],
): Promise<LabOrderChargeResult[]> {
  const results: LabOrderChargeResult[] = [];

  for (const order of orders) {
    try {
      results.push({
        orderId: order.id,
        testName: order.testName,
        billing: await chargeForService(executor, labOrderChargeRequest(order)),
      });
    } catch (error) {
      console.error('Laboratory charge failed:', error);

      results.push({
        orderId: order.id,
        testName: order.testName,
        billing: {
          charged: false,
          reason: 'INVALID_INPUT',
          message: 'The test was recorded but could not be billed.',
        },
      });
    }
  }

  return results;
}

/* ============================================================
   RADIOLOGY
   ============================================================ */

export type ChargeableRadiologyOrder = Pick<
  typeof schema.radiologyOrders.$inferSelect,
  'id' | 'tenantId' | 'facilityId' | 'patientId' | 'encounterId' | 'procedureName'
>;

export function radiologyChargeRequest(
  order: ChargeableRadiologyOrder,
): ChargeRequest {
  return {
    tenantId: order.tenantId,
    facilityId: order.facilityId,
    patientId: order.patientId,
    encounterId: order.encounterId ?? null,
    codes: tariffCodeCandidates('RAD', order.procedureName, [
      'RADIOLOGY',
      'RAD-GENERAL',
      'IMAGING',
    ]),
    sourceType: 'RADIOLOGY',
    sourceId: order.id,
    itemType: 'Radiology',
    description: order.procedureName,
  };
}
