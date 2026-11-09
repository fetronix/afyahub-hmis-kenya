/**
 * JaliCare HMIS
 * Pharmacy stock contracts: expiry and FEFO allocation.
 *
 * First-Expiry-First-Out is the rule that keeps near-expiry stock
 * moving out of the store before it is written off, and it is the rule
 * a pharmacy auditor checks against a dispensing record.
 *
 * This module is pure: no database, no clock. Every function takes the
 * date it should reason about, so a test can pin 2026-10-21 and get the
 * same answer forever.
 */

import { parseMoneyToCents } from '../billing/settlement.ts';

export type BatchExpiryStatus = 'Expired' | 'Expiring' | 'OK';

/**
 * Receipt costs must fit numeric(10, 2) exactly. Missing, negative and
 * fractional-cent inputs are not prices and must never be rounded to one.
 */
export function parseReceiptCostCents(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(text)) return null;
  const cents = parseMoneyToCents(text);
  return cents !== null && cents <= 9_999_999_999 ? cents : null;
}

export interface BatchLot {
  id: number;
  batchNumber: string;
  /** YYYY-MM-DD as stored in inventory_batches.expiry_date. */
  expiryDate: string;
  quantityRemaining: number;
}

export interface BatchAllocation {
  batchId: number;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
}

export interface FefoPlan {
  allocations: BatchAllocation[];
  /** Units the plan will take from usable batches. */
  allocated: number;
  /** Units that could not be filled. Zero means the plan is complete. */
  shortfall: number;
  /** Units sitting in non-expired batches. */
  usableUnits: number;
  /** Units sitting in expired batches, deliberately excluded. */
  expiredUnits: number;
}

/** Local calendar date as YYYY-MM-DD. */
export function todayKey(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');

  return [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join('-');
}

/**
 * Strict YYYY-MM-DD parser.
 *
 * Rejects 2026-02-31 rather than letting Date roll it into March, which
 * would silently give a batch a month of extra shelf life.
 */
export function parseIsoDate(value: string | null | undefined): Date | null {
  if (typeof value !== 'string') return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
}

/** Whole days from `today` to `expiryDate`; negative once expired. */
export function daysUntilExpiry(expiryDate: string, today: string): number | null {
  const expiry = parseIsoDate(expiryDate);
  const start = parseIsoDate(today);

  if (!expiry || !start) return null;

  return Math.round((expiry.getTime() - start.getTime()) / 86_400_000);
}

/**
 * Classify a batch.
 *
 * The expiry date is the last day the stock may be used, so a batch
 * expiring today is still dispensable and reports as "Expiring", not
 * "Expired".
 */
export function expiryStatus(
  expiryDate: string,
  today: string,
  horizonDays = 30,
): BatchExpiryStatus {
  const days = daysUntilExpiry(expiryDate, today);

  if (days === null) return 'Expired';
  if (days < 0) return 'Expired';
  if (days <= horizonDays) return 'Expiring';

  return 'OK';
}

/** True when a batch may still be dispensed on `today`. */
export function isUsable(expiryDate: string, today: string): boolean {
  return expiryStatus(expiryDate, today) !== 'Expired';
}

function compareLots(a: BatchLot, b: BatchLot): number {
  /* ISO dates sort lexicographically, which is also chronological. */
  if (a.expiryDate !== b.expiryDate) {
    return a.expiryDate < b.expiryDate ? -1 : 1;
  }

  /* Same expiry: consume the lower id first so the result is stable. */
  return a.id - b.id;
}

/**
 * Plan a FEFO draw of `quantity` units.
 *
 * Expired batches are never touched. If the usable lots cannot cover
 * the request the plan still returns what it could take, plus the
 * shortfall, so the caller can fail the whole transaction with a message
 * that says how many units are expired versus simply absent.
 */
export function planFefo(lots: BatchLot[], quantity: number, today: string): FefoPlan {
  const requested = Number.isFinite(quantity) ? Math.floor(quantity) : 0;

  const plan: FefoPlan = {
    allocations: [],
    allocated: 0,
    shortfall: 0,
    usableUnits: 0,
    expiredUnits: 0,
  };

  if (requested <= 0) {
    plan.shortfall = Math.max(requested, 0);
    return plan;
  }

  const usable: BatchLot[] = [];

  for (const lot of lots) {
    const remaining = Number.isFinite(lot.quantityRemaining) ? lot.quantityRemaining : 0;

    if (remaining <= 0) continue;

    if (isUsable(lot.expiryDate, today)) {
      plan.usableUnits += remaining;
      usable.push(lot);
    } else {
      plan.expiredUnits += remaining;
    }
  }

  usable.sort(compareLots);

  let outstanding = requested;

  for (const lot of usable) {
    if (outstanding <= 0) break;

    const take = Math.min(outstanding, lot.quantityRemaining);

    if (take <= 0) continue;

    plan.allocations.push({
      batchId: lot.id,
      batchNumber: lot.batchNumber,
      expiryDate: lot.expiryDate,
      quantity: take,
    });

    plan.allocated += take;
    outstanding -= take;
  }

  plan.shortfall = Math.max(requested - plan.allocated, 0);

  return plan;
}

/**
 * Exact stock value in cents, or null when a positive quantity is unpriced,
 * ambiguous, invalid, or too large to represent safely.
 */
export function stockValueCents(
  lots: Array<{ quantityRemaining: number; costPerUnit: string | number | null }>,
): number | null {
  let total = 0;
  for (const lot of lots) {
    if (!Number.isSafeInteger(lot.quantityRemaining) || lot.quantityRemaining < 0) return null;
    if (lot.quantityRemaining === 0) continue;
    const cents = parseReceiptCostCents(lot.costPerUnit);
    // Legacy rows cannot distinguish a confirmed free item from an unpriced
    // item stored as zero, so a positive stock quantity at zero is ambiguous.
    if (cents === null || cents === 0) return null;
    total += cents * lot.quantityRemaining;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}
