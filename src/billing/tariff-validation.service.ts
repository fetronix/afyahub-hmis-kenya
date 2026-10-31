import { transaction } from '../accounting/accounting.service.ts';
import { billingServiceKeys, isValidBillingKey, type BillingFamily } from './tariff-codes.ts';
import { codesForFamily, phrasesForCharge } from './tariff-matching.ts';
import {
  CATALOGUE_SERVICE_TYPES,
  dateVerdict,
  familyForServiceType,
  isCatalogueServiceType,
  resolveFromRows,
  todayKey,
  unitVerdict,
  type CatalogueServiceType,
  type ResolvableTariff,
  type TariffLink,
} from './tariff-resolver.ts';
import { parseMoneyToCents } from './settlement.ts';

type CatalogueRow = {
  id: number;
  code: string;
  name: string;
  wardType?: string | null;
  isActive?: boolean | null;
};
type StoredLink = TariffLink & { serviceCode: string | null; serviceName: string | null };
export type TariffCheck = {
  key: string;
  kind: 'CATALOGUE' | 'FAMILY_SCENARIO' | 'TARIFF' | 'LINK' | 'BILLED_SERVICE';
  serviceType: string | null;
  name: string;
  code: string | null;
  result: 'RESOLVED' | 'REVIEW' | 'INVALID' | 'MANUAL_ONLY';
  reasons: string[];
  tariffId: number | null;
  tariffCode: string | null;
};

/**
 * Read-only assessment using the same automatic resolver as charge creation.
 * A result is not evidence that a facility has approved a price or unit.
 */
export function evaluateTariffConfiguration(input: {
  tariffs: ResolvableTariff[];
  links: StoredLink[];
  labs: CatalogueRow[];
  wards: CatalogueRow[];
  inventory: CatalogueRow[];
  today: string;
}): TariffCheck[] {
  const checks: TariffCheck[] = [];
  const resolvedTariffs = new Set<number>();
  const codeCounts = new Map<string, number>();
  for (const row of input.tariffs) {
    const code = typeof row.code === 'string' ? row.code.trim().toUpperCase() : '';
    if (code) codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
  }
  const linkCounts = new Map<string, number>();
  for (const link of input.links.filter((row) => row.isActive)) {
    const key = `${link.serviceType}:${link.serviceId ?? 'FAMILY'}`;
    linkCounts.set(key, (linkCounts.get(key) ?? 0) + 1);
  }
  const run = (
    kind: TariffCheck['kind'],
    key: string,
    type: CatalogueServiceType,
    family: BillingFamily,
    row?: CatalogueRow,
  ) => {
    if (row?.isActive === null) {
      checks.push({
        key,
        kind,
        serviceType: type,
        name: row.name,
        code: row.code,
        result: 'REVIEW',
        reasons: ['UNKNOWN_ACTIVITY'],
        tariffId: null,
        tariffCode: null,
      });
      return;
    }
    const isWard = type === 'BED_DAY';
    const name = isWard ? 'bed day' : (row?.name ?? null);
    const code = row?.code ?? null;
    const serviceId = type === 'LAB_TEST' || isWard ? (row?.id ?? null) : null;
    // Pharmacy billing uses the prescription name. Inventory names are only a catalogue proxy.
    const details = isWard ? [code, row?.name] : type === 'PHARMACY' ? [name] : [code, name];
    const outcome = resolveFromRows({
      serviceType: type,
      serviceId,
      serviceName: name,
      serviceCode: code,
      family,
      codes: codesForFamily({ family, code, name, wardCode: isWard ? code : null }),
      serviceKeys: billingServiceKeys(family, details),
      phrases: phrasesForCharge({
        family,
        serviceName: name,
        aliases: type === 'LAB_TEST' && code ? [code] : [],
        wardType: row?.wardType ?? null,
        wardName: isWard ? row?.name : null,
      }),
      wardType: row?.wardType ?? null,
      links: input.links,
      tariffs: input.tariffs,
      today: input.today,
      mode: 'AUTO',
    });
    if (outcome.tariff) resolvedTariffs.add(outcome.tariff.id);
    checks.push({
      key,
      kind,
      serviceType: type,
      name: row?.name ?? `${family} generic scenario`,
      code,
      result: outcome.tariff ? 'RESOLVED' : 'REVIEW',
      reasons: outcome.tariff ? [String(outcome.rule)] : [outcome.failure?.code ?? 'NO_TARIFF'],
      tariffId: outcome.tariff?.id ?? null,
      tariffCode: outcome.tariff?.code ?? null,
    });
  };
  for (const row of input.labs)
    run('CATALOGUE', `LAB_TEST:${row.id}`, 'LAB_TEST', 'LABORATORY', row);
  for (const row of input.wards) run('CATALOGUE', `BED_DAY:${row.id}`, 'BED_DAY', 'BED_DAY', row);
  for (const row of input.inventory)
    run('CATALOGUE', `INVENTORY_PROXY:${row.id}`, 'PHARMACY', 'PHARMACY', row);
  for (const type of CATALOGUE_SERVICE_TYPES)
    run('FAMILY_SCENARIO', `FAMILY:${type}`, type, familyForServiceType(type));

  for (const tariff of input.tariffs) {
    const reasons: string[] = [];
    if (tariff.isActive === false) reasons.push('INACTIVE_TARIFF');
    if (tariff.isActive === null) reasons.push('UNKNOWN_ACTIVITY');
    if (!tariff.code || !tariff.code.trim()) reasons.push('MISSING_TARIFF_CODE');
    else if ((codeCounts.get(tariff.code.trim().toUpperCase()) ?? 0) > 1)
      reasons.push('DUPLICATE_TARIFF_CODE');
    const fee = parseMoneyToCents(tariff.fee);
    if (fee === null || fee <= 0) reasons.push('INVALID_PRICE');
    if (!tariff.unit || !tariff.unit.trim()) reasons.push('NO_UNIT');
    const date = dateVerdict(tariff.effectiveFrom, tariff.effectiveTo, input.today);
    if (date !== 'OK') reasons.push(date);
    if (tariff.effectiveFrom && tariff.effectiveTo && tariff.effectiveFrom > tariff.effectiveTo)
      reasons.push('INVALID_DATE_RANGE');
    if (tariff.billingKey && !isValidBillingKey(tariff.billingKey))
      reasons.push('INVALID_BILLING_KEY');
    for (const link of input.links.filter((l) => l.isActive && l.tariffId === tariff.id)) {
      if (
        isCatalogueServiceType(link.serviceType) &&
        unitVerdict(link.serviceType, tariff.unit) === 'INCOMPATIBLE'
      )
        reasons.push(`UNIT_INCOMPATIBLE:${link.serviceType}`);
    }
    if (tariff.autoBill === false) reasons.push('AUTOMATIC_BILLING_DISABLED');
    if (!resolvedTariffs.has(tariff.id)) reasons.push('NOT_RESOLVED_BY_CHECKED_SCENARIOS');
    const invalid = reasons.some(
      (r) =>
        [
          'INVALID_PRICE',
          'NO_UNIT',
          'INVALID_DATE_RANGE',
          'INVALID_BILLING_KEY',
          'MISSING_TARIFF_CODE',
          'DUPLICATE_TARIFF_CODE',
        ].includes(r) || r.startsWith('UNIT_INCOMPATIBLE'),
    );
    checks.push({
      key: `TARIFF:${tariff.id}`,
      kind: 'TARIFF',
      serviceType: null,
      name: tariff.description,
      code: tariff.code,
      result: invalid
        ? 'INVALID'
        : tariff.autoBill === false
          ? 'MANUAL_ONLY'
          : reasons.length
            ? 'REVIEW'
            : 'RESOLVED',
      reasons,
      tariffId: tariff.id,
      tariffCode: tariff.code,
    });
  }
  const labs = new Set(input.labs.map((r) => r.id));
  const wards = new Set(input.wards.map((r) => r.id));
  const tariffs = new Set(input.tariffs.map((r) => r.id));
  for (const link of input.links) {
    const reasons: string[] = [];
    if (!link.isActive) reasons.push('INACTIVE_LINK');
    if (
      link.isActive &&
      (linkCounts.get(`${link.serviceType}:${link.serviceId ?? 'FAMILY'}`) ?? 0) > 1
    )
      reasons.push('CONFLICTING_ACTIVE_LINKS');
    if (!isCatalogueServiceType(link.serviceType)) reasons.push('UNKNOWN_SERVICE_TYPE');
    if (!tariffs.has(link.tariffId)) reasons.push('TARIFF_NOT_IN_FACILITY');
    const linkedTariff = input.tariffs.find((t) => t.id === link.tariffId);
    if (linkedTariff) {
      if (linkedTariff.isActive === false) reasons.push('TARIFF_INACTIVE');
      if (linkedTariff.autoBill === false) reasons.push('TARIFF_AUTOMATIC_BILLING_DISABLED');
      const fee = parseMoneyToCents(linkedTariff.fee);
      if (fee === null || fee <= 0) reasons.push('INVALID_PRICE');
      if (isCatalogueServiceType(link.serviceType)) {
        const unit = unitVerdict(link.serviceType, linkedTariff.unit);
        if (unit !== 'OK') reasons.push(unit === 'MISSING' ? 'NO_UNIT' : 'UNIT_INCOMPATIBLE');
      }
      const date = dateVerdict(linkedTariff.effectiveFrom, linkedTariff.effectiveTo, input.today);
      if (date !== 'OK') reasons.push(date);
    }
    if (link.serviceId !== null && link.serviceType === 'LAB_TEST' && !labs.has(link.serviceId))
      reasons.push('MISSING_OR_INACTIVE_LAB_TEST');
    if (link.serviceId !== null && link.serviceType === 'BED_DAY' && !wards.has(link.serviceId))
      reasons.push('MISSING_OR_INACTIVE_WARD');
    if (
      link.serviceId !== null &&
      link.serviceType !== 'LAB_TEST' &&
      link.serviceType !== 'BED_DAY'
    )
      reasons.push('SPECIFIC_LINK_NOT_USED_BY_CURRENT_CHARGE_PATH');
    if (!link.autoBill) reasons.push('AUTOMATIC_BILLING_DISABLED');
    checks.push({
      key: `LINK:${link.id}`,
      kind: 'LINK',
      serviceType: link.serviceType,
      name: link.serviceName ?? `${link.serviceType} link`,
      code: link.serviceCode,
      result: reasons.length ? 'REVIEW' : 'RESOLVED',
      reasons,
      tariffId: link.tariffId,
      tariffCode: input.tariffs.find((t) => t.id === link.tariffId)?.code ?? null,
    });
  }
  return checks;
}

/** All queries are facility scoped and intentionally fail if the schema is unavailable. */
export async function inspectTariffConfiguration(
  tenantId: number,
  facilityId: number,
  offset: number,
  limit: number,
) {
  return transaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const t = await client.query<ResolvableTariff>(
      `SELECT id,code,description,department,unit,fee::text,billing_key AS "billingKey",is_active AS "isActive",auto_bill AS "autoBill",effective_from::text AS "effectiveFrom",effective_to::text AS "effectiveTo" FROM facility_service_tariffs WHERE tenant_id=$1 AND facility_id=$2 ORDER BY id`,
      [tenantId, facilityId],
    );
    const l = await client.query<StoredLink>(
      `SELECT id,service_type AS "serviceType",service_id AS "serviceId",service_code AS "serviceCode",service_name AS "serviceName",tariff_id AS "tariffId",auto_bill AS "autoBill",is_active AS "isActive" FROM service_tariff_links WHERE tenant_id=$1 AND facility_id=$2 ORDER BY id`,
      [tenantId, facilityId],
    );
    const la = await client.query<CatalogueRow>(
      `SELECT id,code,name,is_active AS "isActive" FROM lab_tests WHERE facility_id=$1 AND is_active IS DISTINCT FROM false ORDER BY id`,
      [facilityId],
    );
    const w = await client.query<CatalogueRow>(
      `SELECT id,code,name,ward_type AS "wardType",is_active AS "isActive" FROM wards WHERE facility_id=$1 AND is_active IS DISTINCT FROM false ORDER BY id`,
      [facilityId],
    );
    const i = await client.query<CatalogueRow>(
      `SELECT id,item_code AS code,name,is_active AS "isActive" FROM inventory_items WHERE facility_id=$1 AND is_active IS DISTINCT FROM false ORDER BY id`,
      [facilityId],
    );
    // Aggregate only service codes/types, not invoices, patients or free-text descriptions.
    const billed = await client.query<{
      id: number;
      itemType: string;
      tariffId: number | null;
      tariffCode: string | null;
      count: number;
    }>(
      `SELECT min(b.id)::int AS id,b.item_type AS "itemType",b.tariff_id AS "tariffId",b.tariff_code AS "tariffCode",count(*)::int AS count
       FROM billing_items b JOIN billing_invoices inv ON inv.id=b.invoice_id
       WHERE inv.tenant_id=$1 AND inv.facility_id=$2 GROUP BY b.item_type,b.tariff_id,b.tariff_code ORDER BY min(b.id)`,
      [tenantId, facilityId],
    );
    const today = todayKey();
    const checks = evaluateTariffConfiguration({
      tariffs: t.rows,
      links: l.rows,
      labs: la.rows,
      wards: w.rows,
      inventory: i.rows,
      today,
    });
    const tariffsById = new Map(t.rows.map((row) => [row.id, row]));
    const tariffCodes = new Set(t.rows.map((row) => row.code.trim().toUpperCase()));
    for (const row of billed.rows) {
      const reasons: string[] = [];
      const current = row.tariffId === null ? undefined : tariffsById.get(row.tariffId);
      if (row.tariffId === null) reasons.push('BILLED_WITHOUT_TARIFF_REFERENCE');
      else if (!current) reasons.push('BILLED_TARIFF_NOT_IN_FACILITY_CATALOGUE');
      if (!row.tariffCode || !row.tariffCode.trim()) reasons.push('BILLED_WITHOUT_TARIFF_CODE');
      else if (!tariffCodes.has(row.tariffCode.trim().toUpperCase()))
        reasons.push('BILLED_CODE_NOT_IN_CURRENT_TARIFF_CATALOGUE');
      if (
        current &&
        row.tariffCode &&
        current.code.trim().toUpperCase() !== row.tariffCode.trim().toUpperCase()
      )
        reasons.push('HISTORICAL_CODE_DIFFERS_FROM_CURRENT');
      if (current?.isActive === false) reasons.push('BILLED_TARIFF_NOW_INACTIVE');
      if (!reasons.length) continue;
      checks.push({
        key: `BILLED_SERVICE:${row.id}`,
        kind: 'BILLED_SERVICE',
        serviceType: null,
        name: `${row.count} billed ${row.itemType} line(s)`,
        code: row.tariffCode,
        result: 'REVIEW',
        reasons,
        tariffId: row.tariffId,
        tariffCode: current?.code ?? null,
      });
    }
    return {
      facilityId,
      asOfDate: today,
      summary: {
        examined: checks.length,
        review: checks.filter((c) => c.result === 'REVIEW').length,
        invalid: checks.filter((c) => c.result === 'INVALID').length,
        manualOnly: checks.filter((c) => c.result === 'MANUAL_ONLY').length,
      },
      checks: checks.slice(offset, offset + limit),
      nextOffset: offset + limit < checks.length ? offset + limit : null,
      limitations: [
        'Resolution is not facility approval of a price, unit, payer tariff, or clinical suitability.',
        'Active and unknown-activity lab tests, wards and inventory items are assessed; inventory names are a proxy and may differ from prescription names.',
        'Other family checks are generic scenarios, not an exhaustive catalogue of free-text procedures, studies, consultations, or deliveries.',
        'Billed-service checks aggregate tariff codes and references, not every clinical catalogue; old codes can be legitimate snapshots. They do not change historical charges.',
        'Results use the current server calendar date and may change with configuration or effective dates.',
      ],
    };
  });
}
