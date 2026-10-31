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

import { type ChargeRequest, type ChargeResult } from './billing.service.ts';
import { chargeAndRecord } from './charge-attempts.ts';
import { billingServiceKeys } from './tariff-codes.ts';
import { codesForFamily } from './tariff-matching.ts';

/* ============================================================
   TARIFF CODE CANDIDATES
   ============================================================ */

/*
 * The rules moved to `tariff-codes.ts`, a module with no database
 * import, so the configuration screen can show an administrator the
 * same codes the engine will try. Re-exported here because this was
 * already the import site for the route handlers and the tests.
 */
export {
  normaliseTariffCode,
  tariffCodeCandidates,
  labTariffCodeCandidates,
  procedureTariffCodeCandidates,
} from './tariff-codes.ts';

/* ============================================================
   LABORATORY
   ============================================================ */

export type ChargeableLabOrder = Pick<
  typeof schema.labOrders.$inferSelect,
  'id' | 'tenantId' | 'facilityId' | 'patientId' | 'encounterId' | 'testName' | 'testId'
> & {
  /**
   * The test's code from `lab_tests`, carried alongside the order.
   *
   * It is not a column on `lab_orders`; it is read at order time and
   * passed here so the catalogue code — `LAB-CBC` — is tried before the
   * long name-derived code nobody would type.
   */
  testCode?: string | null;
};

export function labOrderChargeRequest(order: ChargeableLabOrder): ChargeRequest {
  return {
    tenantId: order.tenantId,
    facilityId: order.facilityId,
    patientId: order.patientId,
    encounterId: order.encounterId ?? null,
    codes: codesForFamily({
      family: 'LABORATORY',
      code: order.testCode ?? null,
      name: order.testName,
    }),
    serviceKeys: billingServiceKeys('LABORATORY', [order.testCode ?? null, order.testName]),
    family: 'LABORATORY',
    serviceName: order.testName,
    aliases: order.testCode ? [order.testCode] : [],
    /*
     * The catalogue row, by id.
     *
     * This is what makes an explicit link possible: the facility says
     * "lab_tests.id 42 is priced by LAB-001", not "a test whose name
     * contains the word blood is priced by LAB-BLOOD". A free-text
     * investigation has no id, and the resolver reports that rather
     * than guessing.
     */
    serviceRef: {
      type: 'LAB_TEST',
      id: typeof order.testId === 'number' ? order.testId : null,
      code: order.testCode ?? null,
    },
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
  executor: Parameters<typeof chargeAndRecord>[0],
): Promise<LabOrderChargeResult[]> {
  const results: LabOrderChargeResult[] = [];

  for (const order of orders) {
    try {
      results.push({
        orderId: order.id,
        testName: order.testName,
        billing: await chargeAndRecord(executor, labOrderChargeRequest(order)),
      });
    } catch {
      console.error('Laboratory charge failed; manual reconciliation is required.');

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

export function radiologyChargeRequest(order: ChargeableRadiologyOrder): ChargeRequest {
  return {
    tenantId: order.tenantId,
    facilityId: order.facilityId,
    patientId: order.patientId,
    encounterId: order.encounterId ?? null,
    codes: codesForFamily({
      family: 'RADIOLOGY',
      name: order.procedureName,
    }),
    serviceKeys: billingServiceKeys('RADIOLOGY', [order.procedureName]),
    family: 'RADIOLOGY',
    serviceName: order.procedureName,
    serviceRef: { type: 'RADIOLOGY', id: null },
    sourceType: 'RADIOLOGY',
    sourceId: order.id,
    itemType: 'Radiology',
    description: order.procedureName,
  };
}
