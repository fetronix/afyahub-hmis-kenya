/**
 * Billing charge helper shared by the API routers.
 *
 * `chargeAndRecord` prices a clinical event and, when it cannot, writes a
 * row to `billing_charge_attempts`. That row is what makes a skipped
 * charge recoverable: the price list can be corrected after the clinic
 * closes and the visit billed then, instead of the money disappearing with
 * nothing to show it was ever due.
 *
 * The wrapper takes the database handle from the module rather than from
 * its caller, so a route cannot accidentally charge against a different
 * connection than the one it read the encounter from.
 */

import type * as billing from '../../billing/billing.service.ts';
import * as chargeAttempts from '../../billing/charge-attempts.ts';
import { db } from '../../db/index.ts';

export async function chargeSafely(
  request: billing.ChargeRequest,
): Promise<billing.ChargeResult | null> {
  return chargeAttempts.chargeAndRecord(db, request);
}
