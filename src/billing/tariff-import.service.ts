/** Facility-approved batch intake, with no price generation or historical edits. */
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/index.ts';
import { transaction } from '../accounting/accounting.service.ts';
import { validateTariffInput, facilityHasTariffModule } from '../routes/shared/tariffs.ts';

export class TariffImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly issues?: Array<{ row: number; reasons: string[] }>,
  ) {
    super(message);
  }
}
type Facility = { id: number; tenantId: number; enabledModules: unknown };
type Normalized = NonNullable<ReturnType<typeof validateTariffInput>>;
type Issue = { row: number; reasons: string[] };

function normalize(rows: unknown): { rows: Normalized[]; issues: Issue[] } {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 200)
    throw new TariffImportError('INVALID_BATCH_SIZE', 'Provide between 1 and 200 tariff rows.');
  const normalized: Normalized[] = [];
  const issues: Issue[] = [];
  const allowed = new Set([
    'code',
    'description',
    'department',
    'unit',
    'fee',
    'shaStatus',
    'shaNotes',
    'billingKey',
    'effectiveFrom',
    'effectiveTo',
    'autoBill',
  ]);
  for (const [index, row] of rows.entries()) {
    const reasons: string[] = [];
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      Object.keys(row).some((key) => !allowed.has(key))
    ) {
      issues.push({ row: index + 1, reasons: ['INVALID_FIELDS'] });
      continue;
    }
    const value = row as Record<string, unknown>;
    if (!Object.hasOwn(value, 'fee') || value.fee === '' || value.fee === null)
      reasons.push('MISSING_PRICE');
    if (typeof value.autoBill !== 'boolean') reasons.push('EXPLICIT_AUTO_BILL_REQUIRED');
    const parsed = validateTariffInput(value);
    if (!parsed) reasons.push('INVALID_TARIFF');
    else if (Number(parsed.fee) <= 0) reasons.push('PRICE_MUST_BE_POSITIVE');
    if (reasons.length || !parsed) issues.push({ row: index + 1, reasons });
    else normalized.push(parsed);
  }
  return { rows: normalized, issues };
}

async function conflicts(
  client: PoolClient | typeof pool,
  facility: Facility,
  rows: Normalized[],
): Promise<Issue[]> {
  const issues: Issue[] = [];
  const codes = rows.map((row) => row.code);
  const keys = rows.map((row) => row.billingKey).filter((key): key is string => !!key);
  const existing = await client.query<{
    code: string;
    billing_key: string | null;
    is_active: boolean;
  }>(
    `SELECT upper(trim(code)) AS code,upper(trim(billing_key)) AS billing_key,is_active FROM facility_service_tariffs
     WHERE tenant_id=$1 AND facility_id=$2 AND (upper(trim(code))=ANY($3::text[]) OR (is_active AND upper(trim(billing_key))=ANY($4::text[])))`,
    [facility.tenantId, facility.id, codes, keys],
  );
  for (const [index, row] of rows.entries()) {
    const reasons: string[] = [];
    if (!facilityHasTariffModule(facility, row.moduleId))
      reasons.push('DEPARTMENT_MODULE_DISABLED');
    if (codes.filter((code) => code === row.code).length > 1)
      reasons.push('DUPLICATE_CODE_IN_BATCH');
    if (existing.rows.some((current) => current.code === row.code))
      reasons.push('CODE_ALREADY_EXISTS');
    if (row.billingKey && keys.filter((key) => key === row.billingKey).length > 1)
      reasons.push('DUPLICATE_BILLING_KEY_IN_BATCH');
    if (
      row.billingKey &&
      existing.rows.some((current) => current.is_active && current.billing_key === row.billingKey)
    )
      reasons.push('BILLING_KEY_ALREADY_EXISTS');
    if (reasons.length) issues.push({ row: index + 1, reasons });
  }
  return issues;
}

/** Dry-run always rechecks persisted facility configuration and never writes. */
export async function previewTariffImport(facility: Facility, input: unknown) {
  const parsed = normalize(input);
  if (parsed.issues.length)
    return {
      valid: false,
      rowCount: Array.isArray(input) ? input.length : 0,
      issues: parsed.issues,
    };
  const issues = await conflicts(pool, facility, parsed.rows);
  return { valid: !issues.length, rowCount: parsed.rows.length, issues };
}

export async function importTariffs(
  facility: Facility,
  actorUserId: number,
  input: Record<string, unknown>,
) {
  const key = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
  const approval =
    typeof input.approvalReference === 'string' ? input.approvalReference.trim() : '';
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key))
    throw new TariffImportError(
      'INVALID_IDEMPOTENCY_KEY',
      'Use an 8–128 character retry identity.',
    );
  if (
    input.confirmed !== true ||
    approval.length < 3 ||
    approval.length > 200 ||
    [...approval].some((character) => character.charCodeAt(0) < 32)
  )
    throw new TariffImportError(
      'APPROVAL_REFERENCE_REQUIRED',
      'Explicit facility confirmation and a documented approval reference are required.',
    );
  const parsed = normalize(input.rows);
  if (parsed.issues.length)
    throw new TariffImportError(
      'INVALID_BATCH',
      'The import contains invalid rows.',
      400,
      parsed.issues,
    );
  const hash = createHash('sha256')
    .update(JSON.stringify({ rows: parsed.rows, approvalReference: approval }))
    .digest('hex');
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,$2))', [
      `tariff-import:${key}`,
      facility.id,
    ]);
    const previous = await client.query(
      `SELECT id,request_hash,result,row_count FROM facility_tariff_import_batches
      WHERE tenant_id=$1 AND facility_id=$2 AND idempotency_key=$3`,
      [facility.tenantId, facility.id, key],
    );
    if (previous.rows.length) {
      if (previous.rows[0].request_hash !== hash)
        throw new TariffImportError(
          'IDEMPOTENCY_CONFLICT',
          'This import identity belongs to different rows or approval.',
          409,
        );
      return {
        idempotentReplay: true,
        batchId: previous.rows[0].id,
        rowCount: previous.rows[0].row_count,
        tariffs: previous.rows[0].result,
      };
    }
    // Serialize batches for this facility and re-read module enablement before writing.
    const locked = await client.query(
      'SELECT enabled_modules FROM facilities WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
      [facility.id, facility.tenantId],
    );
    if (!locked.rows.length)
      throw new TariffImportError('FACILITY_NOT_FOUND', 'Facility not found.', 404);
    const current = { ...facility, enabledModules: locked.rows[0].enabled_modules };
    if (!facilityHasTariffModule(current, 'finance'))
      throw new TariffImportError(
        'FACILITY_MODULE_DISABLED',
        'Finance is not enabled for this facility.',
        403,
      );
    const issues = await conflicts(client, current, parsed.rows);
    if (issues.length)
      throw new TariffImportError(
        'BATCH_CONFLICT',
        'Review the import conflicts; nothing was imported.',
        409,
        issues,
      );
    const created: Array<{ id: number; code: string }> = [];
    for (const row of parsed.rows) {
      const result = await client.query(
        `INSERT INTO facility_service_tariffs
        (tenant_id,facility_id,code,description,department,unit,fee,sha_status,sha_notes,billing_key,effective_from,effective_to,auto_bill,is_active)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true) RETURNING id,code`,
        [
          facility.tenantId,
          facility.id,
          row.code,
          row.description,
          row.department,
          row.unit,
          row.fee,
          row.shaStatus,
          row.shaNotes,
          row.billingKey,
          row.effectiveFrom,
          row.effectiveTo,
          row.autoBill,
        ],
      );
      created.push(result.rows[0]);
      await client.query(
        `INSERT INTO audit_logs(tenant_id,facility_id,user_id,action,resource,resource_id,details)
        VALUES($1,$2,$3,'CREATE','FACILITY_SERVICE_TARIFF',$4,$5)`,
        [
          facility.tenantId,
          facility.id,
          String(actorUserId),
          String(result.rows[0].id),
          JSON.stringify({
            code: row.code,
            department: row.department,
            unit: row.unit,
            fee: row.fee,
            billingKey: row.billingKey,
            effectiveFrom: row.effectiveFrom,
            effectiveTo: row.effectiveTo,
            autoBill: row.autoBill,
            importBatch: true,
          }),
        ],
      );
    }
    const batch = await client.query(
      `INSERT INTO facility_tariff_import_batches
      (tenant_id,facility_id,idempotency_key,request_hash,approval_reference,result,row_count,actor_user_id)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING id`,
      [
        facility.tenantId,
        facility.id,
        key,
        hash,
        approval,
        JSON.stringify(created),
        created.length,
        actorUserId,
      ],
    );
    await client.query(
      `INSERT INTO audit_logs(tenant_id,facility_id,user_id,action,resource,resource_id,details)
      VALUES($1,$2,$3,'IMPORT','FACILITY_TARIFF_IMPORT',$4,$5)`,
      [
        facility.tenantId,
        facility.id,
        String(actorUserId),
        String(batch.rows[0].id),
        JSON.stringify({ approvalReference: approval, rowCount: created.length, tariffs: created }),
      ],
    );
    return {
      idempotentReplay: false,
      batchId: batch.rows[0].id,
      rowCount: created.length,
      tariffs: created,
    };
  });
}
/** Status is a snapshot; NOT_FOUND cannot exclude a delayed import request. */
export async function tariffImportStatus(facility: Facility, key: unknown) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(key.trim()))
    throw new TariffImportError('INVALID_IDEMPOTENCY_KEY', 'A valid retry identity is required.');
  const result = await pool.query(
    `SELECT id,row_count,result FROM facility_tariff_import_batches
    WHERE tenant_id=$1 AND facility_id=$2 AND idempotency_key=$3`,
    [facility.tenantId, facility.id, key.trim()],
  );
  if (!result.rows.length) return { status: 'NOT_FOUND' as const };
  return {
    status: 'RECORDED' as const,
    batchId: result.rows[0].id,
    rowCount: result.rows[0].row_count,
    tariffs: result.rows[0].result,
  };
}
