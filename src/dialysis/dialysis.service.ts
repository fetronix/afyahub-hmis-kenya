/**
 * Dedicated dialysis workflow, backed by existing patients, appointments and
 * inventory. No clinical prescription, session completion or benefit approval
 * is inferred by this service. Facility protocols must be explicitly approved.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/index.ts';
import { planFefo, todayKey } from '../inventory/inventory-contracts.ts';
import { centsToKes, parseKesToCents, requireIsoDate } from '../accounting/accounting.service.ts';

export class DialysisSafetyError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'DialysisSafetyError';
  }
}

export interface DialysisScope {
  tenantId: number;
  facilityId: number;
  actorUserId: number;
  actorName: string;
}

interface FieldRule {
  key: string;
  type: 'text' | 'number' | 'boolean';
  required: boolean;
  min?: number;
  max?: number;
  allowedValues?: string[];
}
export interface DialysisProtocol {
  version: string;
  approvalReference: string;
  planFields: FieldRule[];
  completionFields: FieldRule[];
  approvedByUserId: number;
  approvedAt: string;
}

function text(value: unknown, name: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new DialysisSafetyError(
      'INVALID_INPUT',
      `${name} is required and must be at most ${max} characters.`,
    );
  }
  return value.trim();
}
function positiveId(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new DialysisSafetyError('INVALID_INPUT', `${name} must be a positive integer.`);
  return n;
}
function plainObject(value: unknown, name: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    JSON.stringify(value).length > 16000
  ) {
    throw new DialysisSafetyError(
      'INVALID_INPUT',
      `${name} must be a JSON object of at most 16 KB.`,
    );
  }
  return value as Record<string, unknown>;
}
function parseRules(value: unknown, name: string): FieldRule[] {
  if (!Array.isArray(value) || value.length > 40)
    throw new DialysisSafetyError(
      'INVALID_PROTOCOL',
      `${name} must be a list of at most 40 rules.`,
    );
  const keys = new Set<string>();
  return value.map((raw) => {
    const rule = plainObject(raw, 'Protocol rule');
    const key = text(rule.key, 'Rule key', 64);
    if (
      !/^[A-Za-z][A-Za-z0-9_]*$/.test(key) ||
      ['constructor', 'prototype', '__proto__'].includes(key) ||
      keys.has(key)
    ) {
      throw new DialysisSafetyError(
        'INVALID_PROTOCOL',
        'Protocol field keys must be unique simple identifiers.',
      );
    }
    keys.add(key);
    if (
      !['text', 'number', 'boolean'].includes(String(rule.type)) ||
      typeof rule.required !== 'boolean'
    ) {
      throw new DialysisSafetyError(
        'INVALID_PROTOCOL',
        'Each rule needs an explicit type and required flag.',
      );
    }
    const type = rule.type as FieldRule['type'];
    const result: FieldRule = { key, type, required: rule.required };
    if (rule.min !== undefined || rule.max !== undefined) {
      if (
        type !== 'number' ||
        (rule.min !== undefined && (typeof rule.min !== 'number' || !Number.isFinite(rule.min))) ||
        (rule.max !== undefined && (typeof rule.max !== 'number' || !Number.isFinite(rule.max)))
      ) {
        throw new DialysisSafetyError(
          'INVALID_PROTOCOL',
          'Numeric bounds must be explicitly supplied as finite numbers.',
        );
      }
      if (typeof rule.min === 'number') result.min = rule.min;
      if (typeof rule.max === 'number') result.max = rule.max;
      if (result.min !== undefined && result.max !== undefined && result.min > result.max)
        throw new DialysisSafetyError('INVALID_PROTOCOL', 'Minimum cannot exceed maximum.');
    }
    if (rule.allowedValues !== undefined) {
      if (
        type !== 'text' ||
        !Array.isArray(rule.allowedValues) ||
        rule.allowedValues.length < 1 ||
        rule.allowedValues.length > 30 ||
        !rule.allowedValues.every(
          (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 100,
        )
      ) {
        throw new DialysisSafetyError(
          'INVALID_PROTOCOL',
          'Allowed values must be explicit text options.',
        );
      }
      result.allowedValues = [...new Set(rule.allowedValues.map((v: string) => v.trim()))];
    }
    return result;
  });
}

export function parseApprovedProtocol(
  input: unknown,
  actorUserId: number,
  now = new Date(),
): DialysisProtocol {
  const raw = plainObject(input, 'Protocol');
  return {
    version: text(raw.version, 'Protocol version', 80),
    approvalReference: text(raw.approvalReference, 'Approval reference', 200),
    planFields: parseRules(raw.planFields, 'planFields'),
    completionFields: parseRules(raw.completionFields, 'completionFields'),
    approvedByUserId: actorUserId,
    approvedAt: now.toISOString(),
  };
}

export function validateProtocolValues(
  rules: FieldRule[],
  input: unknown,
): Record<string, unknown> {
  const values = plainObject(input, 'Clinical values');
  const allowedKeys = new Set(rules.map((r) => r.key));
  if (Object.keys(values).some((key) => !allowedKeys.has(key))) {
    throw new DialysisSafetyError(
      'PROTOCOL_FIELD_UNKNOWN',
      'A clinical field is not in the facility-approved protocol.',
    );
  }
  for (const rule of rules) {
    const value = values[rule.key];
    const missing = value === null || value === undefined || value === '';
    if (missing) {
      if (rule.required)
        throw new DialysisSafetyError(
          'PROTOCOL_FIELD_REQUIRED',
          `Protocol field ${rule.key} is required.`,
        );
      continue;
    }
    if (typeof value !== (rule.type === 'text' ? 'string' : rule.type)) {
      throw new DialysisSafetyError(
        'PROTOCOL_FIELD_INVALID',
        `Protocol field ${rule.key} has the wrong type.`,
      );
    }
    if (
      typeof value === 'string' &&
      (value.trim().length > 2000 ||
        (rule.required && !value.trim()) ||
        (rule.allowedValues && !rule.allowedValues.includes(value)))
    ) {
      throw new DialysisSafetyError(
        'PROTOCOL_FIELD_INVALID',
        `Protocol field ${rule.key} is invalid.`,
      );
    }
    if (
      typeof value === 'number' &&
      (!Number.isFinite(value) ||
        (rule.min !== undefined && value < rule.min) ||
        (rule.max !== undefined && value > rule.max))
    ) {
      throw new DialysisSafetyError(
        'PROTOCOL_FIELD_OUT_OF_RANGE',
        `Protocol field ${rule.key} is outside the approved range.`,
      );
    }
  }
  return values;
}

async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
async function audit(
  client: PoolClient,
  scope: DialysisScope,
  action: string,
  resource: string,
  id: number,
  details: object = {},
) {
  await client.query(
    'INSERT INTO audit_logs (tenant_id,facility_id,user_id,action,resource,resource_id,details) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [
      scope.tenantId,
      scope.facilityId,
      String(scope.actorUserId),
      action,
      resource,
      String(id),
      JSON.stringify(details),
    ],
  );
}
async function requirePatient(client: PoolClient, scope: DialysisScope, id: number) {
  const result = await client.query(
    `SELECT p.id FROM patients p WHERE p.id=$1 AND p.tenant_id=$2 AND
      (p.registration_facility_id=$3 OR EXISTS (SELECT 1 FROM patient_facilities f WHERE f.patient_id=p.id AND f.facility_id=$3 AND f.tenant_id=$2 AND f.status='ACTIVE')
       OR EXISTS (SELECT 1 FROM encounters e WHERE e.patient_id=p.id AND e.facility_id=$3 AND e.tenant_id=$2))`,
    [id, scope.tenantId, scope.facilityId],
  );
  if (!result.rows.length)
    throw new DialysisSafetyError(
      'PATIENT_NOT_FOUND',
      'Patient not found in the authorized facility.',
      404,
    );
}
async function currentProtocol(
  client: PoolClient,
  scope: DialysisScope,
): Promise<DialysisProtocol> {
  const result = await client.query(
    'SELECT clinical_protocols FROM facilities WHERE id=$1 AND tenant_id=$2 FOR SHARE',
    [scope.facilityId, scope.tenantId],
  );
  const protocol = result.rows[0]?.clinical_protocols?.dialysis;
  if (
    !protocol ||
    typeof protocol !== 'object' ||
    !protocol.version ||
    !protocol.approvalReference ||
    !protocol.approvedByUserId ||
    !Array.isArray(protocol.planFields) ||
    !Array.isArray(protocol.completionFields)
  ) {
    throw new DialysisSafetyError(
      'APPROVED_PROTOCOL_REQUIRED',
      'A facility-approved dialysis protocol is required.',
      409,
    );
  }
  return protocol as DialysisProtocol;
}

export async function approveProtocolScoped(scope: DialysisScope, input: unknown) {
  const protocol = parseApprovedProtocol(input, scope.actorUserId);
  return tx(async (client) => {
    const current = await client.query(
      'SELECT clinical_protocols FROM facilities WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
      [scope.facilityId, scope.tenantId],
    );
    if (!current.rows.length)
      throw new DialysisSafetyError('FACILITY_NOT_FOUND', 'Facility not found.', 404);
    if (current.rows[0].clinical_protocols?.dialysis?.version === protocol.version) {
      throw new DialysisSafetyError(
        'PROTOCOL_VERSION_EXISTS',
        'Use a new version for every protocol approval.',
        409,
      );
    }
    const result = await client.query(
      `UPDATE facilities SET clinical_protocols=jsonb_set(COALESCE(clinical_protocols,'{}'::jsonb),'{dialysis}',$1::jsonb,true),updated_at=now()
       WHERE id=$2 AND tenant_id=$3 RETURNING id`,
      [JSON.stringify(protocol), scope.facilityId, scope.tenantId],
    );
    if (!result.rows.length)
      throw new DialysisSafetyError('FACILITY_NOT_FOUND', 'Facility not found.', 404);
    await audit(client, scope, 'APPROVE', 'dialysis_protocol', scope.facilityId, {
      version: protocol.version,
      approvalReference: protocol.approvalReference,
    });
    return protocol;
  });
}

export async function createMachineScoped(scope: DialysisScope, input: Record<string, unknown>) {
  const code = text(input.machineCode, 'Machine code', 80);
  const bay = text(input.bayLabel, 'Bay label', 80);
  const zone = text(input.isolationZone, 'Isolation zone', 80);
  try {
    return await tx(async (client) => {
      const result = await client.query(
        `INSERT INTO dialysis_machines (tenant_id,facility_id,machine_code,bay_label,isolation_zone,status)
         VALUES ($1,$2,$3,$4,$5,'OUT_OF_SERVICE') RETURNING id,machine_code AS "machineCode",bay_label AS "bayLabel",isolation_zone AS "isolationZone",status`,
        [scope.tenantId, scope.facilityId, code, bay, zone],
      );
      await audit(client, scope, 'CREATE', 'dialysis_machines', result.rows[0].id, {
        status: 'OUT_OF_SERVICE',
      });
      return result.rows[0];
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505')
      throw new DialysisSafetyError(
        'MACHINE_CODE_EXISTS',
        'Machine code already exists in this facility.',
        409,
      );
    throw error;
  }
}

export async function setMachineStatusScoped(
  scope: DialysisScope,
  machineId: number,
  input: Record<string, unknown>,
) {
  positiveId(machineId, 'Machine id');
  const status = text(input.status, 'Machine status', 30).toUpperCase();
  if (!['AVAILABLE', 'OUT_OF_SERVICE', 'MAINTENANCE', 'DISINFECTION_REQUIRED'].includes(status))
    throw new DialysisSafetyError('INVALID_MACHINE_STATUS', 'Unsupported machine status.');
  const note = text(input.note, 'Readiness or maintenance note', 500);
  if (status === 'AVAILABLE' && input.confirmedReady !== true)
    throw new DialysisSafetyError(
      'READINESS_CONFIRMATION_REQUIRED',
      'An authorized staff member must confirm machine readiness.',
    );
  return tx(async (client) => {
    const result = await client.query(
      'SELECT id,status FROM dialysis_machines WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 FOR UPDATE',
      [machineId, scope.tenantId, scope.facilityId],
    );
    if (!result.rows.length)
      throw new DialysisSafetyError('MACHINE_NOT_FOUND', 'Machine not found.', 404);
    if (result.rows[0].status === 'IN_SESSION')
      throw new DialysisSafetyError(
        'MACHINE_IN_USE',
        'Machine status cannot be changed during a session.',
        409,
      );
    const updated = await client.query(
      'UPDATE dialysis_machines SET status=$1,notes=$2,updated_at=now() WHERE id=$3 RETURNING id,machine_code AS "machineCode",status',
      [status, note, machineId],
    );
    await audit(client, scope, 'UPDATE', 'dialysis_machines', machineId, {
      previousStatus: result.rows[0].status,
      status,
    });
    return updated.rows[0];
  });
}

export async function createAssessmentScoped(scope: DialysisScope, input: Record<string, unknown>) {
  const patientId = positiveId(input.patientId, 'Patient id');
  const history = text(input.renalHistorySummary, 'Clinical assessment', 5000);
  const access = text(input.vascularAccessType, 'Vascular access', 200);
  const encounterId =
    input.encounterId == null ? null : positiveId(input.encounterId, 'Encounter id');
  return tx(async (client) => {
    await requirePatient(client, scope, patientId);
    if (encounterId) {
      const encounter = await client.query(
        'SELECT id FROM encounters WHERE id=$1 AND patient_id=$2 AND tenant_id=$3 AND facility_id=$4',
        [encounterId, patientId, scope.tenantId, scope.facilityId],
      );
      if (!encounter.rows.length)
        throw new DialysisSafetyError(
          'ENCOUNTER_NOT_FOUND',
          'Encounter not found in this facility.',
          404,
        );
    }
    const result = await client.query(
      `INSERT INTO dialysis_patient_assessments (tenant_id,facility_id,patient_id,encounter_id,renal_history_summary,vascular_access_type,clinical_fitness_status,assessed_by_user_id,assessed_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,'REQUIRES_CLINICAL_REVIEW',$7,$8) RETURNING id,patient_id AS "patientId",clinical_fitness_status AS "clinicalFitnessStatus"`,
      [
        scope.tenantId,
        scope.facilityId,
        patientId,
        encounterId,
        history,
        access,
        scope.actorUserId,
        scope.actorName,
      ],
    );
    await audit(client, scope, 'CREATE', 'dialysis_assessment', result.rows[0].id);
    return result.rows[0];
  });
}

export async function createPlanScoped(scope: DialysisScope, input: Record<string, unknown>) {
  const patientId = positiveId(input.patientId, 'Patient id');
  const assessmentId = positiveId(input.assessmentId, 'Assessment id');
  const modality = text(input.modality, 'Modality', 100);
  return tx(async (client) => {
    await requirePatient(client, scope, patientId);
    const assessment = await client.query(
      'SELECT id FROM dialysis_patient_assessments WHERE id=$1 AND patient_id=$2 AND tenant_id=$3 AND facility_id=$4',
      [assessmentId, patientId, scope.tenantId, scope.facilityId],
    );
    if (!assessment.rows.length)
      throw new DialysisSafetyError(
        'ASSESSMENT_NOT_FOUND',
        'Assessment not found for this patient and facility.',
        404,
      );
    const protocol = await currentProtocol(client, scope);
    const values = validateProtocolValues(protocol.planFields, input.values);
    const number = `DTP-${randomUUID()}`;
    const result = await client.query(
      `INSERT INTO dialysis_treatment_plans (tenant_id,facility_id,patient_id,assessment_id,plan_number,modality,protocol_parameters,status,change_history)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'DRAFT',$8::jsonb) RETURNING id,plan_number AS "planNumber",status`,
      [
        scope.tenantId,
        scope.facilityId,
        patientId,
        assessmentId,
        number,
        modality,
        JSON.stringify({
          protocolVersion: protocol.version,
          values,
          completionFields: protocol.completionFields,
        }),
        JSON.stringify([
          { action: 'CREATED_DRAFT', by: scope.actorUserId, at: new Date().toISOString() },
        ]),
      ],
    );
    await audit(client, scope, 'CREATE', 'dialysis_treatment_plan', result.rows[0].id, {
      status: 'DRAFT',
      protocolVersion: protocol.version,
    });
    return result.rows[0];
  });
}

export async function authorizePlanScoped(scope: DialysisScope, planId: number) {
  positiveId(planId, 'Plan id');
  return tx(async (client) => {
    const result = await client.query(
      'SELECT id,status,protocol_parameters,change_history FROM dialysis_treatment_plans WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 FOR UPDATE',
      [planId, scope.tenantId, scope.facilityId],
    );
    if (!result.rows.length)
      throw new DialysisSafetyError('PLAN_NOT_FOUND', 'Treatment plan not found.', 404);
    const plan = result.rows[0];
    if (plan.status !== 'DRAFT')
      throw new DialysisSafetyError('PLAN_NOT_DRAFT', 'Only a draft plan can be authorized.', 409);
    const protocol = await currentProtocol(client, scope);
    if (plan.protocol_parameters?.protocolVersion !== protocol.version)
      throw new DialysisSafetyError(
        'PROTOCOL_CHANGED',
        'Protocol changed; create a new plan for clinician review.',
        409,
      );
    validateProtocolValues(protocol.planFields, plan.protocol_parameters?.values);
    const history = Array.isArray(plan.change_history) ? plan.change_history : [];
    const updated = await client.query(
      `UPDATE dialysis_treatment_plans SET status='AUTHORIZED',authorized_by_user_id=$1,authorized_by_name=$2,authorized_at=now(),change_history=$3::jsonb,updated_at=now() WHERE id=$4 RETURNING id,status`,
      [
        scope.actorUserId,
        scope.actorName,
        JSON.stringify([
          ...history,
          { action: 'AUTHORIZED', by: scope.actorUserId, at: new Date().toISOString() },
        ]),
        planId,
      ],
    );
    await audit(client, scope, 'AUTHORIZE', 'dialysis_treatment_plan', planId, {
      protocolVersion: protocol.version,
    });
    return updated.rows[0];
  });
}

function timeMinutes(value: unknown): number {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new DialysisSafetyError('INVALID_TIME', 'Time must be HH:MM.');
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}
function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function scheduleDialysisScoped(scope: DialysisScope, input: Record<string, unknown>) {
  const patientId = positiveId(input.patientId, 'Patient id'),
    planId = positiveId(input.treatmentPlanId, 'Plan id'),
    machineId = positiveId(input.machineId, 'Machine id');
  const date = requireIsoDate(input.scheduledDate),
    start = text(input.startTime, 'Start time', 5),
    end = text(input.endTime, 'End time', 5),
    shift = text(input.shiftCode, 'Shift', 80),
    key = text(input.idempotencyKey, 'Idempotency key', 128);
  const duration = timeMinutes(end) - timeMinutes(start);
  if (duration <= 0)
    throw new DialysisSafetyError('INVALID_TIME_RANGE', 'End time must be after start time.');
  const digest = hash({ patientId, planId, machineId, date, start, end, shift });
  try {
    return await tx(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,$2))', [
        `dialysis:${key}`,
        scope.facilityId,
      ]);
      const prior = await client.query(
        'SELECT id,request_hash,appointment_id FROM dialysis_schedules WHERE tenant_id=$1 AND facility_id=$2 AND idempotency_key=$3',
        [scope.tenantId, scope.facilityId, key],
      );
      if (prior.rows.length) {
        if (prior.rows[0].request_hash !== digest)
          throw new DialysisSafetyError(
            'IDEMPOTENCY_CONFLICT',
            'Idempotency key was already used for a different schedule.',
            409,
          );
        return {
          scheduleId: prior.rows[0].id,
          appointmentId: prior.rows[0].appointment_id,
          idempotentReplay: true,
        };
      }
      await requirePatient(client, scope, patientId);
      const plan = await client.query(
        "SELECT id FROM dialysis_treatment_plans WHERE id=$1 AND patient_id=$2 AND tenant_id=$3 AND facility_id=$4 AND status='AUTHORIZED'",
        [planId, patientId, scope.tenantId, scope.facilityId],
      );
      if (!plan.rows.length)
        throw new DialysisSafetyError(
          'AUTHORIZED_PLAN_REQUIRED',
          'An authorized treatment plan for this patient is required.',
          409,
        );
      const machine = await client.query(
        'SELECT id,status,is_active FROM dialysis_machines WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 FOR UPDATE',
        [machineId, scope.tenantId, scope.facilityId],
      );
      if (
        !machine.rows.length ||
        !machine.rows[0].is_active ||
        ['MAINTENANCE', 'OUT_OF_SERVICE'].includes(machine.rows[0].status)
      )
        throw new DialysisSafetyError(
          'MACHINE_UNAVAILABLE',
          'Machine is unavailable in this facility.',
          409,
        );
      const appt = await client.query(
        `INSERT INTO appointments (tenant_id,facility_id,patient_id,scheduled_time,duration_minutes,appointment_type,status,reason) VALUES ($1,$2,$3,$4,$5,'Dialysis Session','Scheduled','Dialysis session') RETURNING id`,
        [scope.tenantId, scope.facilityId, patientId, `${date}T${start}:00`, duration],
      );
      const result = await client.query(
        `INSERT INTO dialysis_schedules (tenant_id,facility_id,patient_id,treatment_plan_id,appointment_id,machine_id,scheduled_date,shift_code,start_time,end_time,status,booked_source,created_by_user_id,idempotency_key,request_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'SCHEDULED','FACILITY_STAFF',$11,$12,$13) RETURNING id`,
        [
          scope.tenantId,
          scope.facilityId,
          patientId,
          planId,
          appt.rows[0].id,
          machineId,
          date,
          shift,
          start,
          end,
          scope.actorUserId,
          key,
          digest,
        ],
      );
      await audit(client, scope, 'CREATE', 'dialysis_schedule', result.rows[0].id, {
        status: 'SCHEDULED',
      });
      return {
        scheduleId: result.rows[0].id,
        appointmentId: appt.rows[0].id,
        idempotentReplay: false,
      };
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23514')
      throw new DialysisSafetyError(
        'MACHINE_SLOT_CONFLICT',
        'Machine is already allocated for an overlapping slot.',
        409,
      );
    throw error;
  }
}

export async function startDialysisSessionScoped(scope: DialysisScope, scheduleId: number) {
  positiveId(scheduleId, 'Schedule id');
  return tx(async (client) => {
    const schedule = await client.query(
      'SELECT * FROM dialysis_schedules WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 FOR UPDATE',
      [scheduleId, scope.tenantId, scope.facilityId],
    );
    if (!schedule.rows.length)
      throw new DialysisSafetyError('SCHEDULE_NOT_FOUND', 'Schedule not found.', 404);
    const s = schedule.rows[0];
    const existing = await client.query(
      'SELECT id,status FROM dialysis_sessions WHERE schedule_id=$1',
      [scheduleId],
    );
    if (existing.rows.length) return { session: existing.rows[0], idempotentReplay: true };
    if (!['SCHEDULED', 'CHECKED_IN'].includes(s.status))
      throw new DialysisSafetyError('SCHEDULE_NOT_STARTABLE', 'Schedule is not startable.', 409);
    const plan = await client.query(
      "SELECT protocol_parameters FROM dialysis_treatment_plans WHERE id=$1 AND patient_id=$2 AND tenant_id=$3 AND facility_id=$4 AND status='AUTHORIZED'",
      [s.treatment_plan_id, s.patient_id, scope.tenantId, scope.facilityId],
    );
    const protocol = await currentProtocol(client, scope);
    if (!plan.rows.length || plan.rows[0].protocol_parameters?.protocolVersion !== protocol.version)
      throw new DialysisSafetyError(
        'AUTHORIZED_PLAN_REQUIRED',
        'An authorized plan matching the current approved protocol is required.',
        409,
      );
    const machine = await client.query(
      'SELECT id,status,is_active FROM dialysis_machines WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 FOR UPDATE',
      [s.machine_id, scope.tenantId, scope.facilityId],
    );
    if (
      !machine.rows.length ||
      !machine.rows[0].is_active ||
      machine.rows[0].status !== 'AVAILABLE'
    )
      throw new DialysisSafetyError(
        'MACHINE_NOT_READY',
        'Machine must be confirmed available before a session.',
        409,
      );
    const history = [{ action: 'STARTED', by: scope.actorUserId, at: new Date().toISOString() }];
    const result = await client.query(
      `INSERT INTO dialysis_sessions (tenant_id,facility_id,session_number,schedule_id,treatment_plan_id,patient_id,machine_id,status,started_at,initiated_by_user_id,revision_history) VALUES ($1,$2,$3,$4,$5,$6,$7,'IN_PROGRESS',now(),$8,$9::jsonb) RETURNING id,session_number AS "sessionNumber",status`,
      [
        scope.tenantId,
        scope.facilityId,
        `DS-${randomUUID()}`,
        scheduleId,
        s.treatment_plan_id,
        s.patient_id,
        s.machine_id,
        scope.actorUserId,
        JSON.stringify(history),
      ],
    );
    await client.query(
      "UPDATE dialysis_schedules SET status='IN_PROGRESS',updated_at=now() WHERE id=$1",
      [scheduleId],
    );
    await client.query(
      "UPDATE dialysis_machines SET status='IN_SESSION',updated_at=now() WHERE id=$1",
      [s.machine_id],
    );
    await audit(client, scope, 'START', 'dialysis_session', result.rows[0].id, {
      status: 'IN_PROGRESS',
    });
    return { session: result.rows[0], idempotentReplay: false };
  });
}

export async function addSessionObservationScoped(
  scope: DialysisScope,
  sessionId: number,
  values: unknown,
) {
  positiveId(sessionId, 'Session id');
  const data = plainObject(values, 'Observation');
  return tx(async (client) => {
    const result = await client.query(
      'SELECT status,revision_history FROM dialysis_sessions WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 FOR UPDATE',
      [sessionId, scope.tenantId, scope.facilityId],
    );
    if (!result.rows.length)
      throw new DialysisSafetyError('SESSION_NOT_FOUND', 'Session not found.', 404);
    if (result.rows[0].status !== 'IN_PROGRESS')
      throw new DialysisSafetyError(
        'SESSION_NOT_IN_PROGRESS',
        'Observations require a session in progress.',
        409,
      );
    const history = Array.isArray(result.rows[0].revision_history)
      ? result.rows[0].revision_history
      : [];
    await client.query(
      'UPDATE dialysis_sessions SET revision_history=$1::jsonb,updated_at=now() WHERE id=$2',
      [
        JSON.stringify([
          ...history,
          {
            action: 'OBSERVATION',
            by: scope.actorUserId,
            at: new Date().toISOString(),
            values: data,
          },
        ]),
        sessionId,
      ],
    );
    await audit(client, scope, 'UPDATE', 'dialysis_session', sessionId, { event: 'OBSERVATION' });
    return { sessionId, recorded: true };
  });
}

export async function completeDialysisSessionScoped(
  scope: DialysisScope,
  sessionId: number,
  input: Record<string, unknown>,
) {
  positiveId(sessionId, 'Session id');
  const outcome = text(input.outcome, 'Outcome', 30).toUpperCase();
  if (!['COMPLETED', 'TERMINATED_EARLY', 'ABORTED'].includes(outcome))
    throw new DialysisSafetyError(
      'INVALID_OUTCOME',
      'Explicit outcome must be COMPLETED, TERMINATED_EARLY or ABORTED.',
    );
  const summary = text(input.nursingSummary, 'Clinical summary', 5000);
  const duration = positiveId(input.actualDurationMinutes, 'Actual duration');
  return tx(async (client) => {
    const result = await client.query(
      'SELECT * FROM dialysis_sessions WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 FOR UPDATE',
      [sessionId, scope.tenantId, scope.facilityId],
    );
    if (!result.rows.length)
      throw new DialysisSafetyError('SESSION_NOT_FOUND', 'Session not found.', 404);
    const session = result.rows[0];
    if (session.status !== 'IN_PROGRESS')
      throw new DialysisSafetyError('SESSION_FINALIZED', 'Session is not in progress.', 409);
    const plan = await client.query(
      'SELECT protocol_parameters FROM dialysis_treatment_plans WHERE id=$1 AND tenant_id=$2 AND facility_id=$3',
      [session.treatment_plan_id, scope.tenantId, scope.facilityId],
    );
    const completionFields = plan.rows[0]?.protocol_parameters?.completionFields;
    if (!Array.isArray(completionFields))
      throw new DialysisSafetyError(
        'PROTOCOL_SNAPSHOT_MISSING',
        'The authorized plan has no completion protocol snapshot.',
        409,
      );
    const values = validateProtocolValues(completionFields, input.values);
    const history = Array.isArray(session.revision_history) ? session.revision_history : [];
    // Keep machine -> schedule lock order consistent with scheduling.
    await client.query(
      'SELECT id FROM dialysis_machines WHERE id=$1 AND facility_id=$2 FOR UPDATE',
      [session.machine_id, scope.facilityId],
    );
    await client.query(
      `UPDATE dialysis_sessions SET status=$1,ended_at=now(),actual_duration_minutes=$2,nursing_summary=$3,completed_by_user_id=$4,revision_history=$5::jsonb,updated_at=now() WHERE id=$6`,
      [
        outcome,
        duration,
        summary,
        scope.actorUserId,
        JSON.stringify([
          ...history,
          { action: outcome, by: scope.actorUserId, at: new Date().toISOString(), values },
        ]),
        sessionId,
      ],
    );
    await client.query(
      'UPDATE dialysis_schedules SET status=$1,updated_at=now() WHERE id=$2 AND facility_id=$3',
      [outcome, session.schedule_id, scope.facilityId],
    );
    await client.query(
      "UPDATE dialysis_machines SET status='DISINFECTION_REQUIRED',updated_at=now() WHERE id=$1 AND facility_id=$2",
      [session.machine_id, scope.facilityId],
    );
    await client.query(
      `UPDATE appointments SET status=$1,updated_at=now() WHERE id=(SELECT appointment_id FROM dialysis_schedules WHERE id=$2 AND facility_id=$3)`,
      [outcome === 'COMPLETED' ? 'Completed' : 'Cancelled', session.schedule_id, scope.facilityId],
    );
    await audit(client, scope, 'COMPLETE', 'dialysis_session', sessionId, {
      outcome,
      billing: 'UNBILLED',
    });
    return { id: sessionId, status: outcome, billingStatus: 'UNBILLED' };
  });
}

export async function recordConsumableScoped(
  scope: DialysisScope,
  sessionId: number,
  input: Record<string, unknown>,
) {
  positiveId(sessionId, 'Session id');
  const itemId = positiveId(input.inventoryItemId, 'Inventory item'),
    quantity = positiveId(input.quantity, 'Quantity'),
    key = text(input.idempotencyKey, 'Idempotency key', 128);
  if (quantity > 1_000_000)
    throw new DialysisSafetyError('INVALID_QUANTITY', 'Quantity is too large.');
  const digest = hash({ sessionId, itemId, quantity });
  return tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,$2))', [
      `dialysis-stock:${key}`,
      scope.facilityId,
    ]);
    const prior = await client.query(
      'SELECT id,request_hash,total_cost_kes FROM dialysis_consumable_usages WHERE facility_id=$1 AND tenant_id=$2 AND idempotency_key=$3',
      [scope.facilityId, scope.tenantId, key],
    );
    if (prior.rows.length) {
      if (prior.rows[0].request_hash !== digest)
        throw new DialysisSafetyError(
          'IDEMPOTENCY_CONFLICT',
          'Key already used for different consumables.',
          409,
        );
      return {
        id: prior.rows[0].id,
        idempotentReplay: true,
        totalCostKes: prior.rows[0].total_cost_kes,
      };
    }
    const session = await client.query(
      "SELECT id FROM dialysis_sessions WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 AND status='IN_PROGRESS' FOR UPDATE",
      [sessionId, scope.tenantId, scope.facilityId],
    );
    if (!session.rows.length)
      throw new DialysisSafetyError(
        'SESSION_NOT_IN_PROGRESS',
        'A session in progress is required.',
        409,
      );
    const item = await client.query(
      'SELECT id,name,current_stock,unit_cost FROM inventory_items WHERE id=$1 AND facility_id=$2 AND is_active=true',
      [itemId, scope.facilityId],
    );
    if (!item.rows.length)
      throw new DialysisSafetyError('INVENTORY_ITEM_NOT_FOUND', 'Inventory item not found.', 404);
    const batches = await client.query(
      'SELECT id,batch_number,expiry_date,quantity_remaining,cost_per_unit FROM inventory_batches WHERE item_id=$1 FOR UPDATE',
      [itemId],
    );
    const lots = batches.rows.map((r) => ({
      id: r.id,
      batchNumber: r.batch_number,
      expiryDate: r.expiry_date,
      quantityRemaining: r.quantity_remaining,
    }));
    let allocations: Array<{
      batchId: number;
      batchNumber: string;
      expiryDate: string;
      quantity: number;
    }> = [];
    let cost: bigint | null = null;
    if (lots.length) {
      const plan = planFefo(lots, quantity, todayKey());
      if (plan.shortfall > 0)
        throw new DialysisSafetyError(
          'INSUFFICIENT_STOCK',
          'Insufficient unexpired batch stock.',
          409,
        );
      allocations = plan.allocations;
      let total = 0n,
        known = true;
      for (const allocation of allocations) {
        await client.query(
          'UPDATE inventory_batches SET quantity_remaining=quantity_remaining-$1 WHERE id=$2',
          [allocation.quantity, allocation.batchId],
        );
        const batch = batches.rows.find((b) => b.id === allocation.batchId);
        const unit = parseKesToCents(batch?.cost_per_unit ?? '0');
        if (unit <= 0n) known = false;
        else total += unit * BigInt(allocation.quantity);
      }
      if (known) cost = total;
    } else {
      const unit = parseKesToCents(item.rows[0].unit_cost ?? '0');
      if (unit > 0n) cost = unit * BigInt(quantity);
    }
    const stock = await client.query(
      'UPDATE inventory_items SET current_stock=current_stock-$1,updated_at=now() WHERE id=$2 AND facility_id=$3 AND current_stock >= $1 RETURNING current_stock',
      [quantity, itemId, scope.facilityId],
    );
    if (!stock.rows.length)
      throw new DialysisSafetyError(
        'INSUFFICIENT_STOCK',
        'Inventory summary stock is insufficient; review stock records.',
        409,
      );
    const usage = await client.query(
      `INSERT INTO dialysis_consumable_usages (tenant_id,facility_id,session_id,inventory_item_id,item_name,quantity_used,unit_cost_kes,total_cost_kes,batch_allocations,idempotency_key,request_hash,deducted_from_stock,recorded_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8::jsonb,$9,$10,true,$11) RETURNING id`,
      [
        scope.tenantId,
        scope.facilityId,
        sessionId,
        itemId,
        item.rows[0].name,
        quantity,
        cost === null ? null : centsToKes(cost),
        JSON.stringify(allocations),
        key,
        digest,
        scope.actorUserId,
      ],
    );
    await audit(client, scope, 'CREATE', 'dialysis_consumable_usage', usage.rows[0].id, {
      quantity,
      costKnown: cost !== null,
    });
    return {
      id: usage.rows[0].id,
      idempotentReplay: false,
      totalCostKes: cost === null ? null : centsToKes(cost),
      costStatus: cost === null ? 'UNAVAILABLE' : 'RECORDED_NOT_POSTED_TO_LEDGER',
      allocations,
    };
  });
}

export async function recordAdverseEventScoped(
  scope: DialysisScope,
  sessionId: number,
  input: Record<string, unknown>,
) {
  positiveId(sessionId, 'Session id');
  const eventType = text(input.eventType, 'Event type', 200),
    severity = text(input.severity, 'Severity', 80),
    description = text(input.clinicalDescription, 'Clinical description', 5000),
    intervention = text(input.immediateIntervention, 'Intervention', 5000),
    outcome = text(input.sessionOutcome, 'Session outcome', 200);
  return tx(async (client) => {
    const session = await client.query(
      'SELECT patient_id FROM dialysis_sessions WHERE id=$1 AND tenant_id=$2 AND facility_id=$3',
      [sessionId, scope.tenantId, scope.facilityId],
    );
    if (!session.rows.length)
      throw new DialysisSafetyError('SESSION_NOT_FOUND', 'Session not found.', 404);
    const event = await client.query(
      `INSERT INTO dialysis_adverse_events (tenant_id,facility_id,session_id,patient_id,event_type,severity,clinical_description,immediate_intervention,session_outcome,follow_up_status,reported_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'OPEN',$10) RETURNING id,follow_up_status AS "followUpStatus"`,
      [
        scope.tenantId,
        scope.facilityId,
        sessionId,
        session.rows[0].patient_id,
        eventType,
        severity,
        description,
        intervention,
        outcome,
        scope.actorUserId,
      ],
    );
    await audit(client, scope, 'CREATE', 'dialysis_adverse_event', event.rows[0].id);
    return event.rows[0];
  });
}

export async function followUpAdverseEventScoped(
  scope: DialysisScope,
  eventId: number,
  input: Record<string, unknown>,
) {
  positiveId(eventId, 'Adverse event id');
  const status = text(input.status, 'Follow-up status', 30).toUpperCase();
  const notes = text(input.notes, 'Follow-up notes', 5000);
  if (!['OPEN', 'IN_FOLLOW_UP', 'RESOLVED'].includes(status)) {
    throw new DialysisSafetyError(
      'INVALID_FOLLOW_UP_STATUS',
      'Choose OPEN, IN_FOLLOW_UP or RESOLVED.',
    );
  }
  return tx(async (client) => {
    const event = await client.query(
      'SELECT id,session_id,follow_up_status FROM dialysis_adverse_events WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 FOR UPDATE',
      [eventId, scope.tenantId, scope.facilityId],
    );
    if (!event.rows.length)
      throw new DialysisSafetyError('ADVERSE_EVENT_NOT_FOUND', 'Adverse event not found.', 404);
    const session = await client.query(
      'SELECT revision_history FROM dialysis_sessions WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 FOR UPDATE',
      [event.rows[0].session_id, scope.tenantId, scope.facilityId],
    );
    if (!session.rows.length)
      throw new DialysisSafetyError('SESSION_NOT_FOUND', 'Session not found.', 404);
    const history = Array.isArray(session.rows[0].revision_history)
      ? session.rows[0].revision_history
      : [];
    await client.query(
      'UPDATE dialysis_sessions SET revision_history=$1::jsonb,updated_at=now() WHERE id=$2',
      [
        JSON.stringify([
          ...history,
          {
            action: 'ADVERSE_EVENT_FOLLOW_UP',
            eventId,
            status,
            notes,
            by: scope.actorUserId,
            at: new Date().toISOString(),
          },
        ]),
        event.rows[0].session_id,
      ],
    );
    await client.query(
      'UPDATE dialysis_adverse_events SET follow_up_status=$1,follow_up_notes=$2,follow_up_by_user_id=$3,follow_up_at=now(),updated_at=now() WHERE id=$4',
      [status, notes, scope.actorUserId, eventId],
    );
    await audit(client, scope, 'UPDATE', 'dialysis_adverse_event', eventId, {
      previousStatus: event.rows[0].follow_up_status,
      status,
    });
    return { id: eventId, followUpStatus: status };
  });
}

export async function getDialysisWorkspaceScoped(scope: DialysisScope) {
  const [machines, schedules, sessions, events, facility] = await Promise.all([
    pool.query(
      'SELECT id,machine_code AS "machineCode",bay_label AS "bayLabel",isolation_zone AS "isolationZone",status FROM dialysis_machines WHERE tenant_id=$1 AND facility_id=$2 ORDER BY machine_code',
      [scope.tenantId, scope.facilityId],
    ),
    pool.query(
      'SELECT id,patient_id AS "patientId",treatment_plan_id AS "treatmentPlanId",machine_id AS "machineId",scheduled_date::text AS "scheduledDate",start_time AS "startTime",end_time AS "endTime",status FROM dialysis_schedules WHERE tenant_id=$1 AND facility_id=$2 ORDER BY scheduled_date DESC,start_time LIMIT 100',
      [scope.tenantId, scope.facilityId],
    ),
    pool.query(
      `SELECT s.id,s.session_number AS "sessionNumber",s.schedule_id AS "scheduleId",s.patient_id AS "patientId",s.status,s.billed_charge_status AS "billedChargeStatus",s.started_at AS "startedAt",s.ended_at AS "endedAt",p.protocol_parameters->'completionFields' AS "completionFields" FROM dialysis_sessions s JOIN dialysis_treatment_plans p ON p.id=s.treatment_plan_id WHERE s.tenant_id=$1 AND s.facility_id=$2 ORDER BY s.created_at DESC LIMIT 100`,
      [scope.tenantId, scope.facilityId],
    ),
    pool.query(
      'SELECT id,session_id AS "sessionId",follow_up_status AS "followUpStatus" FROM dialysis_adverse_events WHERE tenant_id=$1 AND facility_id=$2 ORDER BY created_at DESC LIMIT 100',
      [scope.tenantId, scope.facilityId],
    ),
    pool.query('SELECT clinical_protocols FROM facilities WHERE tenant_id=$1 AND id=$2', [
      scope.tenantId,
      scope.facilityId,
    ]),
  ]);
  return {
    machines: machines.rows,
    schedules: schedules.rows,
    sessions: sessions.rows,
    adverseEvents: events.rows,
    protocol: facility.rows[0]?.clinical_protocols?.dialysis ?? null,
    notice:
      'Scheduled slots are not completed sessions. Billing and ledger integration are not yet automated.',
  };
}
