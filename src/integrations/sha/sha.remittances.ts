/** SHA gateway concern: remittances. */
import { randomUUID } from 'node:crypto';
import { asObj, readStr, readNumMoney, normalizeIsoDate } from './sha.values.ts';
import type { ShaGatewayContext } from './sha.context.ts';
import type {
  HieRemittancesQueryRequest,
  HieRemittanceSummaryItem,
  HieRemittancesQueryResult,
  HieRemittanceClaimsQueryRequest,
  HieRemittanceClaimLine,
  HieRemittanceClaimsQueryResult,
} from './sha.types.ts';

export async function fetchFacilityRemittances(
  context: ShaGatewayContext,
  req: HieRemittancesQueryRequest,
): Promise<HieRemittancesQueryResult> {
  const cfg = context.resolveConfig(req.facilityRegistryOverride);
  const correlationId = req.correlationId ?? randomUUID();

  if (cfg.mode === 'mock') {
    const today = new Date().toISOString().slice(0, 10);
    return {
      reachable: true,
      source: 'SANDBOX_SIMULATION',
      mode: 'mock',
      isSimulated: true,
      remittances: [
        {
          bankReference: 'SIM-BANK-REF-2026-001',
          remittanceReference: 'SIM-SHA-REM-2026-001',
          paymentDate: today,
          totalAmountKes: '25000.00',
          paymentChannel: 'EFT',
          claimCount: 2,
        },
      ],
      errorMessage: null,
      correlationId,
    };
  }

  if (!cfg.enabled || !cfg.middlewareBaseUrl || !cfg.facilityRegistryCode) {
    return {
      reachable: false,
      source: 'UNAVAILABLE',
      mode: cfg.mode,
      isSimulated: false,
      remittances: [],
      errorMessage: cfg.disabledReason ?? 'SHA HIE credentials or facility FR code missing.',
      correlationId,
    };
  }

  try {
    const token = await context.obtainAccessToken(cfg, correlationId);
    const url = new URL(`${cfg.middlewareBaseUrl}${cfg.remittancesPath}`);
    url.searchParams.set('facility_id', cfg.facilityRegistryCode);
    url.searchParams.set('facility_id_type', cfg.facilityIdType);
    if (req.fromDate) url.searchParams.set('from_date', req.fromDate);
    if (req.toDate) url.searchParams.set('to_date', req.toDate);

    const res = await context.fetchGetWithBoundedRetry(
      url.toString(),
      context.buildServiceAccountHeaders(cfg, token, correlationId),
      cfg.timeoutMs,
      cfg.maxGetRetries,
    );

    if (!res.ok) {
      return {
        reachable: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        remittances: [],
        errorMessage: `HIE Get Remittances returned HTTP ${res.status}.`,
        correlationId,
      };
    }

    const raw = await res.json().catch(() => null);
    const rows = Array.isArray(raw)
      ? raw
      : Array.isArray(asObj(raw)?.results)
        ? (asObj(raw)!.results as unknown[])
        : Array.isArray(asObj(raw)?.data)
          ? (asObj(raw)!.data as unknown[])
          : [];

    const remittances: HieRemittanceSummaryItem[] = rows
      .map((r) => asObj(r))
      .filter((r): r is Record<string, unknown> => r !== null)
      .map((r) => {
        const bankRef = readStr(r, 'bank_reference', 'bankReference', 'reference') ?? '';
        return {
          bankReference: bankRef,
          remittanceReference:
            readStr(r, 'remittance_reference', 'remittanceReference', 'id') ?? bankRef,
          paymentDate:
            normalizeIsoDate(readStr(r, 'payment_date', 'paymentDate', 'created_at')) ??
            new Date().toISOString().slice(0, 10),
          totalAmountKes: readNumMoney(r.total_amount ?? r.totalAmount ?? r.amount) ?? '0.00',
          paymentChannel: readStr(r, 'payment_channel', 'paymentChannel') ?? 'EFT',
          claimCount: typeof r.claim_count === 'number' ? r.claim_count : null,
        };
      })
      .filter((r) => r.bankReference.length > 0);

    return {
      reachable: true,
      source: 'AUTHORITATIVE_PAYER',
      mode: cfg.mode,
      isSimulated: false,
      remittances,
      errorMessage: null,
      correlationId,
    };
  } catch (error) {
    return {
      reachable: false,
      source: 'UNAVAILABLE',
      mode: cfg.mode,
      isSimulated: false,
      remittances: [],
      errorMessage: error instanceof Error ? error.message : 'Unable to query HIE remittances.',
      correlationId,
    };
  }
}

export async function fetchClaimsPaidByRemittance(
  context: ShaGatewayContext,
  req: HieRemittanceClaimsQueryRequest,
): Promise<HieRemittanceClaimsQueryResult> {
  const cfg = context.resolveConfig(req.facilityRegistryOverride);
  const correlationId = req.correlationId ?? randomUUID();
  const bankRef = req.bankReference.trim();

  if (cfg.mode === 'mock') {
    return {
      reachable: true,
      source: 'SANDBOX_SIMULATION',
      mode: 'mock',
      isSimulated: true,
      bankReference: bankRef,
      claims: [
        {
          payerClaimReference: 'SIM-CLM-0001',
          claimNumber: null,
          invoiceNumber: null,
          claimedAmountKes: '15000.00',
          approvedAmountKes: '15000.00',
          paidAmountKes: '15000.00',
          paymentStatus: 'PAID',
        },
        {
          payerClaimReference: 'SIM-CLM-0002',
          claimNumber: null,
          invoiceNumber: null,
          claimedAmountKes: '12000.00',
          approvedAmountKes: '10000.00',
          paidAmountKes: '10000.00',
          paymentStatus: 'PARTIALLY_PAID',
        },
      ],
      errorMessage: null,
      correlationId,
    };
  }

  if (!cfg.enabled || !cfg.middlewareBaseUrl || !cfg.facilityRegistryCode) {
    return {
      reachable: false,
      source: 'UNAVAILABLE',
      mode: cfg.mode,
      isSimulated: false,
      bankReference: bankRef,
      claims: [],
      errorMessage: cfg.disabledReason ?? 'SHA HIE credentials or facility FR code missing.',
      correlationId,
    };
  }

  try {
    const token = await context.obtainAccessToken(cfg, correlationId);
    const url = new URL(`${cfg.middlewareBaseUrl}${cfg.remittanceClaimsPath}`);
    url.searchParams.set('facility_id', cfg.facilityRegistryCode);
    url.searchParams.set('facility_id_type', cfg.facilityIdType);
    url.searchParams.set('bank_reference', bankRef);

    const res = await context.fetchGetWithBoundedRetry(
      url.toString(),
      context.buildServiceAccountHeaders(cfg, token, correlationId),
      cfg.timeoutMs,
      cfg.maxGetRetries,
    );

    if (!res.ok) {
      return {
        reachable: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        bankReference: bankRef,
        claims: [],
        errorMessage: `HIE Get Claims Paid by Remittance returned HTTP ${res.status}.`,
        correlationId,
      };
    }

    const raw = await res.json().catch(() => null);
    const rows = Array.isArray(raw)
      ? raw
      : Array.isArray(asObj(raw)?.results)
        ? (asObj(raw)!.results as unknown[])
        : Array.isArray(asObj(raw)?.data)
          ? (asObj(raw)!.data as unknown[])
          : Array.isArray(asObj(raw)?.claims)
            ? (asObj(raw)!.claims as unknown[])
            : [];

    const claims: HieRemittanceClaimLine[] = rows
      .map((r) => asObj(r))
      .filter((r): r is Record<string, unknown> => r !== null)
      .map((r) => {
        const paid = readNumMoney(r.payment_amount ?? r.paid_amount ?? r.paidAmount) ?? '0.00';
        const rawStat = (
          readStr(r, 'payment_status', 'paymentStatus', 'status') ?? 'PAID'
        ).toUpperCase();
        const paymentStatus: 'PAID' | 'PARTIALLY_PAID' | 'UNPAID' = rawStat.includes('PARTIAL')
          ? 'PARTIALLY_PAID'
          : rawStat.includes('UNPAID') || Number(paid) <= 0
            ? 'UNPAID'
            : 'PAID';
        return {
          payerClaimReference:
            readStr(r, 'claim_id', 'payer_claim_id', 'edi_claim_guid', 'reference') ?? '',
          claimNumber: readStr(r, 'claim_number', 'provider_claim_number'),
          invoiceNumber: readStr(r, 'invoice_number', 'invoiceNumber'),
          claimedAmountKes: readNumMoney(r.claimed_amount ?? r.claimedAmount),
          approvedAmountKes: readNumMoney(r.approved_amount ?? r.approvedAmount),
          paidAmountKes: paid,
          paymentStatus,
        };
      })
      .filter((c) => c.payerClaimReference.length > 0);

    return {
      reachable: true,
      source: 'AUTHORITATIVE_PAYER',
      mode: cfg.mode,
      isSimulated: false,
      bankReference: bankRef,
      claims,
      errorMessage: null,
      correlationId,
    };
  } catch (error) {
    return {
      reachable: false,
      source: 'UNAVAILABLE',
      mode: cfg.mode,
      isSimulated: false,
      bankReference: bankRef,
      claims: [],
      errorMessage:
        error instanceof Error ? error.message : 'Unable to query claims paid by remittance.',
      correlationId,
    };
  }
}
