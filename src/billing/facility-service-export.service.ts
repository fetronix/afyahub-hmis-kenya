import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { auditFacilityService } from './facility-service-operations.ts';
import { FacilityServiceError, type FacilityServiceScope } from './facility-service-input.ts';

const MAX_EXPORT_ROWS = 5000;
const headers = [
  'facility_id',
  'service_id',
  'service_code',
  'service_name',
  'service_description',
  'department',
  'category',
  'unit',
  'service_active',
  'service_auto_bill',
  'tariff_id',
  'tariff_code',
  'tariff_description',
  'price_kes',
  'effective_from',
  'effective_to',
  'tariff_active',
  'tariff_auto_bill',
  'tariff_archived',
  'tariff_revision',
];

/** Quote every cell and protect spreadsheet users from formula injection. */
function csvCell(input: unknown) {
  const text = input === null || input === undefined ? '' : String(input);
  const safe = /^[\t\r\n]/u.test(text) || /^\s*[=+@-]/u.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * One database statement reads the current facility services and all linked
 * tariffs, including inactive/archived ones. The audit must commit before the
 * file is returned. Unlinked historical tariffs are deliberately not imported
 * or modified by this facility-service catalogue export.
 */
export async function exportFacilityServiceCatalogue(
  facility: FacilityServiceScope,
  actor: number,
) {
  const rows = await db.transaction(async (tx) => {
    const records = await tx
      .select({ service: schema.facilityServices, tariff: schema.facilityServiceTariffs })
      .from(schema.facilityServices)
      .leftJoin(
        schema.facilityServiceTariffs,
        and(
          eq(schema.facilityServiceTariffs.facilityServiceId, schema.facilityServices.id),
          eq(schema.facilityServiceTariffs.facilityId, facility.id),
          eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
        ),
      )
      .where(
        and(
          eq(schema.facilityServices.facilityId, facility.id),
          eq(schema.facilityServices.tenantId, facility.tenantId),
        ),
      )
      .orderBy(asc(schema.facilityServices.code), asc(schema.facilityServiceTariffs.id))
      .limit(MAX_EXPORT_ROWS + 1);
    if (records.length > MAX_EXPORT_ROWS)
      throw new FacilityServiceError(
        'CATALOGUE_EXPORT_TOO_LARGE',
        'The catalogue exceeds the 5,000-row export limit. No partial export was produced.',
        400,
      );
    await auditFacilityService(
      tx,
      facility,
      actor,
      'EXPORT',
      'FACILITY_SERVICE_CATALOGUE',
      facility.id,
      {
        format: 'CSV',
        rowCount: records.length,
        coverage: 'FACILITY_SERVICES_AND_LINKED_TARIFFS',
      },
    );
    return records;
  });
  const content = [
    headers,
    ...rows.map(({ service, tariff }) => [
      service.facilityId,
      service.id,
      service.code,
      service.name,
      service.description,
      service.department,
      service.category,
      service.unit,
      service.isActive,
      service.autoBill,
      tariff?.id,
      tariff?.code,
      tariff?.description,
      tariff?.fee,
      tariff?.effectiveFrom,
      tariff?.effectiveTo,
      tariff?.isActive,
      tariff?.autoBill,
      tariff ? Boolean(tariff.archivedAt) : null,
      tariff?.revision,
    ]),
  ];
  return {
    filename: `jalicare-facility-${facility.id}-service-catalogue.csv`,
    contentType: 'text/csv; charset=utf-8',
    base64: Buffer.from(
      `\ufeff${content.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`,
      'utf8',
    ).toString('base64'),
    rowCount: rows.length,
    coverage: 'FACILITY_SERVICES_AND_LINKED_TARIFFS' as const,
  };
}
