/**
 * Facility depreciation policy.
 *
 * The convention that decides whether the month of acquisition receives a
 * charge is a decision an accountant signs off, so it is stored per facility
 * and copied onto each asset that overrides it. This module is the single place
 * that resolves "which convention applies to this asset" — the preview, the
 * batch preparation and the statutory schedule all call it, so they cannot
 * disagree.
 */

import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from '../db/schema.ts';
import { normaliseConvention, type CommencementConvention } from './depreciation.ts';

export type Db = NodePgDatabase<Record<string, never>>;

export interface DepreciationPolicy {
  defaultUsefulLifeMonths: number;
  defaultAnnualRateBps: number;
  depreciationCommencement: CommencementConvention;
  depreciationApprovalRequired: boolean;
  financialYearStartMonth: number;
  /** False when the facility has never saved a policy; the UI says so. */
  configured: boolean;
  updatedAt: string | null;
}

/**
 * Defaults mirror the documented policy (straight line, 10 years, 10% a year,
 * full month of service). They exist so an unconfigured facility still produces
 * a defensible schedule, and `configured: false` keeps that visible instead of
 * pretending the policy was approved.
 */
export const DEFAULT_DEPRECIATION_POLICY: DepreciationPolicy = Object.freeze({
  defaultUsefulLifeMonths: 120,
  defaultAnnualRateBps: 1000,
  depreciationCommencement: 'FULL_MONTH' as CommencementConvention,
  depreciationApprovalRequired: true,
  financialYearStartMonth: 7,
  configured: false,
  updatedAt: null,
});

export async function resolveDepreciationPolicy(
  db: Db,
  scope: { tenantId: number; facilityId: number },
): Promise<DepreciationPolicy> {
  const [row] = await db
    .select()
    .from(schema.fixedAssetSettings)
    .where(
      and(
        eq(schema.fixedAssetSettings.tenantId, scope.tenantId),
        eq(schema.fixedAssetSettings.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  if (!row) return DEFAULT_DEPRECIATION_POLICY;
  return {
    defaultUsefulLifeMonths: row.defaultUsefulLifeMonths,
    defaultAnnualRateBps: row.defaultAnnualRateBps,
    depreciationCommencement: normaliseConvention(row.depreciationCommencement, 'FULL_MONTH'),
    depreciationApprovalRequired: row.depreciationApprovalRequired,
    financialYearStartMonth: row.financialYearStartMonth,
    configured: true,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The convention actually applied to an asset: its own override, else policy. */
export function conventionForAsset(
  asset: { depreciationCommencement?: string | null },
  policy: DepreciationPolicy,
): CommencementConvention {
  return normaliseConvention(asset.depreciationCommencement, policy.depreciationCommencement);
}
