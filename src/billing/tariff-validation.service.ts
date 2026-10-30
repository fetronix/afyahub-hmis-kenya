import { pool } from '../db/index.ts';
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
  kind: 'CATALOGUE' | 'FAMILY_SCENARIO' | 'TARIFF' | 'LINK';
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
    if (tariff.isActive === false) continue;
    const reasons: string[] = [];
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
        ['INVALID_PRICE', 'NO_UNIT', 'INVALID_DATE_RANGE', 'INVALID_BILLING_KEY'].includes(r) ||
        r.startsWith('UNIT_INCOMPATIBLE'),
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
  for (const link of input.links.filter((l) => l.isActive)) {
    const reasons: string[] = [];
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
  const [t, l, la, w, i] = await Promise.all([
    pool.query<ResolvableTariff>(
      `SELECT id,code,description,department,unit,fee::text,billing_key AS "billingKey",is_active AS "isActive",auto_bill AS "autoBill",effective_from::text AS "effectiveFrom",effective_to::text AS "effectiveTo" FROM facility_service_tariffs WHERE tenant_id=$1 AND facility_id=$2 ORDER BY id`,
      [tenantId, facilityId],
    ),
    pool.query<StoredLink>(
      `SELECT id,service_type AS "serviceType",service_id AS "serviceId",service_code AS "serviceCode",service_name AS "serviceName",tariff_id AS "tariffId",auto_bill AS "autoBill",is_active AS "isActive" FROM service_tariff_links WHERE tenant_id=$1 AND facility_id=$2 ORDER BY id`,
      [tenantId, facilityId],
    ),
    pool.query<CatalogueRow>(
      `SELECT id,code,name,is_active AS "isActive" FROM lab_tests WHERE facility_id=$1 AND is_active IS DISTINCT FROM false ORDER BY id`,
      [facilityId],
    ),
    pool.query<CatalogueRow>(
      `SELECT id,code,name,ward_type AS "wardType",is_active AS "isActive" FROM wards WHERE facility_id=$1 AND is_active IS DISTINCT FROM false ORDER BY id`,
      [facilityId],
    ),
    pool.query<CatalogueRow>(
      `SELECT id,item_code AS code,name,is_active AS "isActive" FROM inventory_items WHERE facility_id=$1 AND is_active IS DISTINCT FROM false ORDER BY id`,
      [facilityId],
    ),
  ]);
  const today = todayKey();
  const checks = evaluateTariffConfiguration({
    tariffs: t.rows,
    links: l.rows,
    labs: la.rows,
    wards: w.rows,
    inventory: i.rows,
    today,
  });
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
      'Results use the current server calendar date and may change with configuration or effective dates.',
    ],
  };
}
