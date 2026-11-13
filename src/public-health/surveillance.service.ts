import type { PoolClient } from 'pg';
import { pool } from '../db/index.ts';
import type { AuthorizationContext } from '../auth/authorization.types.ts';

/**
 * Facility surveillance records: recording, correcting, and totalling them.
 *
 * The table this reads and writes holds notifiable-disease counts that a
 * clinician keyed in. Three things follow from that and are load-bearing here:
 *
 *  1. A wrong count must be correctable without deleting the evidence of what
 *     was originally recorded. A correction therefore *supersedes*: a new row is
 *     inserted that points at the row it replaces, and that row keeps existing
 *     with status 'SUPERSEDED'.
 *  2. A tally must never silently add two rows that are competing records of the
 *     same thing. Where more than one active row exists for the same disease,
 *     age group and epi-week, the total is reported with an explicit duplicate
 *     flag rather than summed and presented as fact.
 *  3. Nothing here produces a KHIS, DHIS2 or MOH 705 submission document. The
 *     output is a facility-local tally and says so in its own response.
 */

export class SurveillanceError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'SurveillanceError';
    this.code = code;
    this.status = status;
  }
}

export type SurveillanceScope = {
  tenantId: number;
  facilityId: number;
  actorUserId: number;
  /**
   * True only when the caller holds public_health.reports.create. Correcting a
   * figure someone else may have entered is a separate act from recording one.
   */
  canCorrect: boolean;
};

const EPI_WEEK = /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/;

export const ACTIVE_STATUSES = ['DRAFT', 'SUBMITTED'] as const;
export const SUPERSEDED_STATUS = 'SUPERSEDED';

/**
 * Field errors keep the codes the published endpoints already return, so an
 * existing client's error handling does not silently start matching nothing.
 */
function text(value: unknown, field: string, max: number, code = 'INVALID_INPUT'): string {
  if (typeof value !== 'string') throw new SurveillanceError(code, `${field} is required.`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /\p{Cc}/u.test(trimmed))
    throw new SurveillanceError(code, `${field} is invalid.`);
  return trimmed;
}

function count(value: unknown, field: string, min: number, code = 'INVALID_INPUT'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min)
    throw new SurveillanceError(code, `${field} must be a whole number of at least ${min}.`);
  if (value > 10_000_000) throw new SurveillanceError(code, `${field} is implausibly large.`);
  return value;
}

export function validateEpiWeek(value: unknown): string {
  if (typeof value !== 'string' || !EPI_WEEK.test(value))
    throw new SurveillanceError(
      'INVALID_EPI_WEEK',
      'The epidemiological week must be an ISO week such as 2026-W44.',
    );
  return value;
}

export type RecordReportInput = {
  diseaseCode: string;
  diseaseName: string;
  casesCount: number;
  mortalityCount: number;
  ageGroup: string;
  epiWeek: string;
};

export function validateReportInput(input: Record<string, unknown>): RecordReportInput {
  // These two codes are already published by the endpoint; keep them stable.
  const fields = 'INVALID_REPORT_FIELDS';
  const counts = 'INVALID_REPORT_COUNTS';
  if (typeof input.epiWeek !== 'string' || !EPI_WEEK.test(input.epiWeek))
    throw new SurveillanceError(fields, 'A valid epiWeek is required.');
  const casesCount = count(input.casesCount, 'Cases count', 1, counts);
  const mortalityCount = count(input.mortalityCount, 'Mortality count', 0, counts);
  if (mortalityCount > casesCount)
    throw new SurveillanceError(counts, 'Deaths cannot exceed recorded cases for the same report.');
  return {
    diseaseCode: text(input.diseaseCode, 'Disease code', 50, fields),
    diseaseName: text(input.diseaseName, 'Disease name', 200, fields),
    casesCount,
    mortalityCount,
    ageGroup: text(input.ageGroup, 'Age group', 100, counts),
    epiWeek: validateEpiWeek(input.epiWeek),
  };
}

async function audit(
  client: PoolClient,
  scope: SurveillanceScope,
  action: string,
  resourceId: string,
  details: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO audit_logs(tenant_id,facility_id,user_id,action,resource,resource_id,details)
     VALUES($1,$2,$3,$4,'public_health_reports',$5,$6::text)`,
    [
      scope.tenantId,
      scope.facilityId,
      scope.actorUserId,
      action,
      resourceId,
      JSON.stringify(details),
    ],
  );
}

/** Records a new facility surveillance entry. Nothing is transmitted anywhere. */
export async function recordReportScoped(scope: SurveillanceScope, input: Record<string, unknown>) {
  const report = validateReportInput(input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialise writers for one facility so a correction and a new entry for the
    // same epi-week cannot interleave into two "active" rows unnoticed.
    await client.query('SELECT pg_advisory_xact_lock(147013, $1)', [scope.facilityId]);
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO public_health_reports
        (facility_id,disease_code,disease_name,cases_count,mortality_count,age_group,epi_week,reported_by,status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'DRAFT') RETURNING id`,
      [
        scope.facilityId,
        report.diseaseCode,
        report.diseaseName,
        report.casesCount,
        report.mortalityCount,
        report.ageGroup,
        report.epiWeek,
        String(scope.actorUserId),
      ],
    );
    const id = inserted.rows[0].id;
    const competing = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public_health_reports
       WHERE facility_id=$1 AND epi_week=$2 AND disease_code=$3 AND age_group=$4
         AND status <> $5 AND id <> $6`,
      [
        scope.facilityId,
        report.epiWeek,
        report.diseaseCode,
        report.ageGroup,
        SUPERSEDED_STATUS,
        id,
      ],
    );
    await audit(client, scope, 'CREATE', String(id), {
      epiWeek: report.epiWeek,
      diseaseCode: report.diseaseCode,
      casesCount: report.casesCount,
      mortalityCount: report.mortalityCount,
      transmitted: false,
    });
    await client.query('COMMIT');
    const duplicates = Number(competing.rows[0].count);
    return {
      id,
      ...report,
      status: 'DRAFT',
      transmitted: false,
      warning:
        duplicates > 0
          ? `${duplicates} other active record(s) already exist for ${report.diseaseCode} / ${report.ageGroup} / ${report.epiWeek}. Totals for this week will be reported as disputed until one is corrected.`
          : null,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Corrects a recorded count by superseding the original.
 *
 * The original row is never edited or deleted. A replacement row is inserted
 * that points at it, the original is marked 'SUPERSEDED', and only the
 * replacement counts towards totals. A reason is mandatory because the reason is
 * the only thing that later explains why two rows share an epi-week.
 */
export async function correctReportScoped(
  scope: SurveillanceScope,
  reportId: number,
  input: Record<string, unknown>,
) {
  if (!scope.canCorrect)
    throw new SurveillanceError(
      'CORRECTION_FORBIDDEN',
      'Recording a correction requires the public-health report permission.',
      403,
    );
  if (!Number.isSafeInteger(reportId) || reportId <= 0)
    throw new SurveillanceError('INVALID_INPUT', 'A valid report id is required.');
  const reason = text(input.reason, 'Correction reason', 500);
  if (reason.length < 10)
    throw new SurveillanceError(
      'INVALID_INPUT',
      'A correction reason of at least 10 characters is required.',
    );
  if (input.epiWeek !== undefined || input.diseaseCode !== undefined)
    throw new SurveillanceError(
      'IMMUTABLE_FIELD',
      'A correction cannot move a record to another disease or epidemiological week. Record a new report instead.',
    );
  const casesCount = count(input.casesCount, 'Cases count', 1);
  const mortalityCount = count(input.mortalityCount, 'Mortality count', 0);
  if (mortalityCount > casesCount)
    throw new SurveillanceError('INVALID_INPUT', 'Deaths cannot exceed recorded cases.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(147013, $1)', [scope.facilityId]);
    const existing = await client.query<{
      id: number;
      diseaseCode: string;
      diseaseName: string;
      ageGroup: string;
      epiWeek: string;
      status: string | null;
      casesCount: number | null;
      mortalityCount: number | null;
      facilityId: number;
    }>(
      `SELECT id, disease_code AS "diseaseCode", disease_name AS "diseaseName",
         age_group AS "ageGroup", epi_week AS "epiWeek", status,
         cases_count AS "casesCount", mortality_count AS "mortalityCount",
         facility_id AS "facilityId"
       FROM public_health_reports WHERE id=$1 FOR UPDATE`,
      [reportId],
    );
    const original = existing.rows[0];
    if (!original || original.facilityId !== scope.facilityId)
      throw new SurveillanceError('REPORT_NOT_FOUND', 'Surveillance report not found.', 404);
    if (original.status === SUPERSEDED_STATUS)
      throw new SurveillanceError(
        'ALREADY_SUPERSEDED',
        'This record has already been replaced. Correct the replacement instead.',
        409,
      );
    if (original.casesCount === casesCount && original.mortalityCount === mortalityCount)
      throw new SurveillanceError(
        'NO_CHANGE',
        'The corrected counts are identical to the recorded counts.',
        409,
      );
    const supersededBy = await client.query<{ id: number }>(
      `SELECT id FROM public_health_reports WHERE supersedes_report_id=$1 LIMIT 1`,
      [reportId],
    );
    if (supersededBy.rows.length)
      throw new SurveillanceError(
        'ALREADY_SUPERSEDED',
        'This record has already been replaced. Correct the replacement instead.',
        409,
      );

    const replacement = await client.query<{ id: number }>(
      `INSERT INTO public_health_reports
        (facility_id,disease_code,disease_name,cases_count,mortality_count,age_group,epi_week,
         reported_by,status,supersedes_report_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'DRAFT',$9) RETURNING id`,
      [
        scope.facilityId,
        original.diseaseCode,
        original.diseaseName,
        casesCount,
        mortalityCount,
        original.ageGroup,
        original.epiWeek,
        String(scope.actorUserId),
        original.id,
      ],
    );
    const replacementId = replacement.rows[0].id;
    await client.query(`UPDATE public_health_reports SET status=$2 WHERE id=$1`, [
      original.id,
      SUPERSEDED_STATUS,
    ]);
    await audit(client, scope, 'CORRECT', String(replacementId), {
      supersedesReportId: original.id,
      epiWeek: original.epiWeek,
      diseaseCode: original.diseaseCode,
      previous: { casesCount: original.casesCount, mortalityCount: original.mortalityCount },
      corrected: { casesCount, mortalityCount },
      reason,
      transmitted: false,
    });
    await client.query('COMMIT');
    return {
      id: replacementId,
      supersedesReportId: original.id,
      epiWeek: original.epiWeek,
      diseaseCode: original.diseaseCode,
      diseaseName: original.diseaseName,
      ageGroup: original.ageGroup,
      casesCount,
      mortalityCount,
      previous: { casesCount: original.casesCount, mortalityCount: original.mortalityCount },
      reason,
      status: 'DRAFT',
      transmitted: false,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

type Row = {
  id: number;
  diseaseCode: string;
  diseaseName: string;
  ageGroup: string;
  casesCount: number | null;
  mortalityCount: number | null;
  status: string | null;
  reportedAt: string;
  supersedesReportId: number | null;
};

/**
 * Facility tally for one epidemiological week.
 *
 * Only records that have not been superseded are counted. Where the same
 * disease and age group have more than one such record, the figure is reported
 * as disputed with the contributing ids, because the alternative — adding them —
 * would turn a data-entry mistake into an epidemic signal.
 */
export async function weeklySurveillanceSummaryScoped(
  scope: SurveillanceScope,
  input: { epiWeek: unknown },
) {
  const epiWeek = validateEpiWeek(input.epiWeek);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows } = await client.query<Row>(
      `SELECT id, disease_code AS "diseaseCode", disease_name AS "diseaseName",
         age_group AS "ageGroup", cases_count AS "casesCount",
         mortality_count AS "mortalityCount", status, reported_at::text AS "reportedAt",
         supersedes_report_id AS "supersedesReportId"
       FROM public_health_reports
       WHERE facility_id=$1 AND epi_week=$2
       ORDER BY disease_code, age_group, id`,
      [scope.facilityId, epiWeek],
    );
    await client.query('COMMIT');

    const active = rows.filter((row) => row.status !== SUPERSEDED_STATUS);
    const superseded = rows.filter((row) => row.status === SUPERSEDED_STATUS);
    const groups = new Map<string, Row[]>();
    for (const row of active) {
      const key = `${row.diseaseCode}\u0000${row.ageGroup}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const tallies = [...groups.entries()]
      .map(([key, entries]) => {
        const [diseaseCode, ageGroup] = key.split('\u0000');
        const cases = entries.reduce((sum, row) => sum + (row.casesCount ?? 0), 0);
        const deaths = entries.reduce((sum, row) => sum + (row.mortalityCount ?? 0), 0);
        return {
          diseaseCode,
          diseaseName: entries[0].diseaseName,
          ageGroup,
          casesCount: cases,
          mortalityCount: deaths,
          // Ratio is reported as text, not rounded into a percentage claim.
          caseFatalityRatio: cases === 0 ? null : (deaths / cases).toFixed(4),
          recordCount: entries.length,
          reportIds: entries.map((row) => row.id),
          disputed: entries.length > 1,
          reviewNote:
            entries.length > 1
              ? `${entries.length} active records exist for this disease and age group in ${epiWeek}. The total is shown but must not be submitted until it is corrected down to one record.`
              : null,
        };
      })
      .sort(
        (a, b) =>
          a.diseaseCode.localeCompare(b.diseaseCode) || a.ageGroup.localeCompare(b.ageGroup),
      );
    const disputed = tallies.filter((tally) => tally.disputed);
    return {
      facilityId: scope.facilityId,
      epiWeek,
      tallies,
      superseded: superseded.map((row) => ({
        id: row.id,
        diseaseCode: row.diseaseCode,
        ageGroup: row.ageGroup,
        casesCount: row.casesCount,
        mortalityCount: row.mortalityCount,
        replacedBy: rows.find((candidate) => candidate.supersedesReportId === row.id)?.id ?? null,
        reportedAt: row.reportedAt,
      })),
      totals: {
        diseases: tallies.length,
        records: active.length,
        casesCount: tallies.reduce((sum, tally) => sum + tally.casesCount, 0),
        mortalityCount: tallies.reduce((sum, tally) => sum + tally.mortalityCount, 0),
        disputedGroups: disputed.length,
      },
      submission: {
        ready: disputed.length === 0 && active.length > 0,
        blockedBy: disputed.length
          ? `${disputed.length} disease/age group(s) have competing active records.`
          : active.length === 0
            ? 'No active records were recorded for this week.'
            : null,
        transmitted: false,
      },
      limitations: {
        format: 'FACILITY_TALLY_ONLY',
        notice:
          'This is a facility-local tally of records keyed in by staff. It is not an MOH 705 return, a KHIS or DHIS2 payload, and no submission was made. Week boundaries, case definitions and the official return format must be verified against the authoritative MOH specification before any figure here is reported.',
      },
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
