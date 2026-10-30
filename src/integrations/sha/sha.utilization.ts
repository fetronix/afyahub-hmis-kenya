/** SHA gateway concern: utilization. */
import { randomUUID } from 'node:crypto';
import { asObj, readStr, readNumMoney } from './sha.values.ts';
import type { ShaGatewayContext } from './sha.context.ts';
import type {
  HieUtilizationLookupRequest,
  HieUtilizationItem,
  HieUtilizationLookupResult,
} from './sha.types.ts';

export async function fetchBenefitUtilizationAndBalances(
  context: ShaGatewayContext,
  req: HieUtilizationLookupRequest,
): Promise<HieUtilizationLookupResult> {
  const cfg = context.resolveConfig(req.facilityRegistryOverride);
  const correlationId = req.correlationId ?? randomUUID();
  const crId = req.memberCrNumber.trim();
  const code = req.interventionCode.trim().toUpperCase();

  if (cfg.mode === 'mock') {
    const isExhausted = crId.endsWith('0099') || code.endsWith('999');
    const indMax = 50000;
    const indUsed = isExhausted ? 50000 : 12000;
    const hhMax = 150000;
    const hhUsed = isExhausted ? 150000 : 28000;

    return {
      reachable: true,
      source: 'SANDBOX_SIMULATION',
      mode: 'mock',
      isSimulated: true,
      utilization: [
        {
          crId,
          code,
          limitScope: 'HOUSEHOLD_AND_INDIVIDUAL',
          individualMaxLimitKes: indMax.toFixed(2),
          individualUtilisedLimitKes: indUsed.toFixed(2),
          individualRemainingLimitKes: Math.max(0, indMax - indUsed).toFixed(2),
          householdMaxLimitKes: hhMax.toFixed(2),
          householdUtilisedLimitKes: hhUsed.toFixed(2),
          householdRemainingLimitKes: Math.max(0, hhMax - hhUsed).toFixed(2),
          utilizationDays: 3,
          nextAvailability: isExhausted ? '2027-01-01' : null,
        },
      ],
      pomsfBalances: req.includePomsfBalances
        ? [
            {
              schemeCode: 'POMSF-CIVIL',
              policyYear: String(req.policyYear ?? new Date().getFullYear()),
              annualAllocationKes: '200000.00',
              utilisedAmountKes: '35000.00',
              remainingBalanceKes: '165000.00',
            },
          ]
        : [],
      bedOccupancy: req.includeBedOccupancy
        ? {
            facilityCode: cfg.facilityRegistryCode ?? 'SIM-FID-001',
            facilityName: 'Simulated Facility',
            bpLevel: 'LEVEL_4',
            occupancyRatePercent: 62.5,
            totalBeds: 80,
            occupiedBeds: 50,
          }
        : null,
      errorMessage: null,
      correlationId,
    };
  }

  if (!cfg.enabled || !cfg.middlewareBaseUrl) {
    return {
      reachable: false,
      source: 'UNAVAILABLE',
      mode: cfg.mode,
      isSimulated: false,
      utilization: [],
      pomsfBalances: [],
      bedOccupancy: null,
      errorMessage: cfg.disabledReason ?? 'SHA HIE credentials are not configured.',
      correlationId,
    };
  }

  try {
    const token = await context.obtainAccessToken(cfg, correlationId);
    const headers = context.buildServiceAccountHeaders(cfg, token, correlationId);

    const utilUrl = new URL(`${cfg.middlewareBaseUrl}${cfg.utilizationPath}`);
    utilUrl.searchParams.set('patient_id', crId);
    utilUrl.searchParams.set('intervention_code', code);

    const utilRes = await context.fetchGetWithBoundedRetry(
      utilUrl.toString(),
      headers,
      cfg.timeoutMs,
      cfg.maxGetRetries,
    );

    if (!utilRes.ok) {
      return {
        reachable: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        utilization: [],
        pomsfBalances: [],
        bedOccupancy: null,
        errorMessage: `SHA HIE utilization endpoint returned HTTP ${utilRes.status}.`,
        correlationId,
      };
    }

    const rawUtil = await utilRes.json().catch(() => null);
    const utilArr = Array.isArray(rawUtil)
      ? rawUtil
      : Array.isArray(asObj(rawUtil)?.results)
        ? (asObj(rawUtil)!.results as unknown[])
        : Array.isArray(asObj(rawUtil)?.data)
          ? (asObj(rawUtil)!.data as unknown[])
          : [];

    const utilization: HieUtilizationItem[] = utilArr
      .map((u) => asObj(u))
      .filter((u): u is Record<string, unknown> => u !== null)
      .map((u) => {
        const indMax = readNumMoney(u.individualMaxLimit);
        const indUsed = readNumMoney(u.individualUtilisedLimit);
        const hhMax = readNumMoney(u.householdMaxLimit);
        const hhUsed = readNumMoney(u.householdUtilisedLimit);
        return {
          crId: readStr(u, 'crId') ?? crId,
          code: readStr(u, 'code') ?? code,
          limitScope: readStr(u, 'limitScope'),
          individualMaxLimitKes: indMax,
          individualUtilisedLimitKes: indUsed,
          individualRemainingLimitKes:
            indMax !== null && indUsed !== null
              ? Math.max(0, Number(indMax) - Number(indUsed)).toFixed(2)
              : null,
          householdMaxLimitKes: hhMax,
          householdUtilisedLimitKes: hhUsed,
          householdRemainingLimitKes:
            hhMax !== null && hhUsed !== null
              ? Math.max(0, Number(hhMax) - Number(hhUsed)).toFixed(2)
              : null,
          utilizationDays: typeof u.utilizationDays === 'number' ? u.utilizationDays : null,
          nextAvailability: readStr(u, 'nextAvailability'),
        };
      });

    const pomsfBalances: HieUtilizationLookupResult['pomsfBalances'] = [];
    if (req.includePomsfBalances) {
      const pomsfUrl = new URL(`${cfg.middlewareBaseUrl}${cfg.pomsfBalancesPath}`);
      pomsfUrl.searchParams.set('patient_id', crId);
      pomsfUrl.searchParams.set('policy_year', String(req.policyYear ?? new Date().getFullYear()));
      pomsfUrl.searchParams.set('principal_member_number', req.principalMemberCrNumber ?? crId);
      const pomsfRes = await context.fetchGetWithBoundedRetry(
        pomsfUrl.toString(),
        headers,
        cfg.timeoutMs,
        cfg.maxGetRetries,
      );
      if (pomsfRes.ok) {
        const rawPomsf = await pomsfRes.json().catch(() => null);
        const pJson = asObj(rawPomsf);
        const pRows = Array.isArray(rawPomsf)
          ? rawPomsf
          : Array.isArray(pJson?.results)
            ? pJson.results
            : Array.isArray(pJson?.data)
              ? pJson.data
              : pJson
                ? [pJson]
                : [];
        for (const pr of pRows) {
          const pObj = asObj(pr);
          if (!pObj) continue;
          pomsfBalances.push({
            schemeCode: readStr(pObj, 'schemeCode', 'scheme_code') ?? 'POMSF',
            policyYear: String(req.policyYear ?? new Date().getFullYear()),
            annualAllocationKes: readNumMoney(pObj.annualAllocation ?? pObj.maxLimit),
            utilisedAmountKes: readNumMoney(pObj.utilisedAmount ?? pObj.utilisedLimit),
            remainingBalanceKes: readNumMoney(pObj.remainingBalance ?? pObj.availableBalance),
          });
        }
      }
    }

    let bedOccupancy: HieUtilizationLookupResult['bedOccupancy'] = null;
    if (req.includeBedOccupancy && cfg.facilityRegistryCode) {
      const occPath = cfg.bedOccupancyPathTemplate.replace(
        '{facilityCode}',
        encodeURIComponent(cfg.facilityRegistryCode),
      );
      const occRes = await context.fetchGetWithBoundedRetry(
        `${cfg.middlewareBaseUrl}${occPath}`,
        headers,
        cfg.timeoutMs,
        cfg.maxGetRetries,
      );
      if (occRes.ok) {
        const occObj = asObj(await occRes.json().catch(() => null));
        const rateObj = occObj ? asObj(occObj.bed_occupancy_rate) : null;
        bedOccupancy = {
          facilityCode: cfg.facilityRegistryCode,
          facilityName: occObj ? readStr(occObj, 'name') : null,
          bpLevel: occObj ? readStr(occObj, 'bp_level') : null,
          occupancyRatePercent: rateObj && typeof rateObj.rate === 'number' ? rateObj.rate : null,
          totalBeds: rateObj && typeof rateObj.total_beds === 'number' ? rateObj.total_beds : null,
          occupiedBeds:
            rateObj && typeof rateObj.occupied_beds === 'number' ? rateObj.occupied_beds : null,
        };
      }
    }

    return {
      reachable: true,
      source: 'AUTHORITATIVE_PAYER',
      mode: cfg.mode,
      isSimulated: false,
      utilization,
      pomsfBalances,
      bedOccupancy,
      errorMessage: null,
      correlationId,
    };
  } catch (error) {
    return {
      reachable: false,
      source: 'UNAVAILABLE',
      mode: cfg.mode,
      isSimulated: false,
      utilization: [],
      pomsfBalances: [],
      bedOccupancy: null,
      errorMessage:
        error instanceof Error
          ? `SHA utilization lookup failed: ${error.message}`
          : 'SHA utilization lookup failed.',
      correlationId,
    };
  }
}
