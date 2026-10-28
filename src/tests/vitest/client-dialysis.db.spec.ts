import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { pool } from '../../db/index.ts';
import { describeDb } from './support/db.ts';
import {
  addSessionObservationScoped,
  approveProtocolScoped,
  authorizePlanScoped,
  completeDialysisSessionScoped,
  createAssessmentScoped,
  createMachineScoped,
  createPlanScoped,
  followUpAdverseEventScoped,
  getDialysisWorkspaceScoped,
  recordAdverseEventScoped,
  recordConsumableScoped,
  scheduleDialysisScoped,
  setMachineStatusScoped,
  startDialysisSessionScoped,
  type DialysisScope,
} from '../../dialysis/dialysis.service.ts';

describeDb('dialysis safety and isolation against PostgreSQL', () => {
  let a: DialysisScope,
    b: DialysisScope,
    patientId: number,
    machineId: number,
    planId: number,
    sessionId: number;
  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? 'jalicare_test').includes('test'))
      throw new Error('Test database required.');
    const x = randomUUID().slice(0, 8);
    const t = await pool.query(
      'INSERT INTO tenants (name,slug) VALUES ($1,$2),($3,$4) RETURNING id',
      [`Synthetic A ${x}`, `dia-a-${x}`, `Synthetic B ${x}`, `dia-b-${x}`],
    );
    const f = await pool.query(
      'INSERT INTO facilities (tenant_id,code,name) VALUES ($1,$2,$3),($4,$5,$6) RETURNING id',
      [t.rows[0].id, `DA-${x}`, 'Synthetic A', t.rows[1].id, `DB-${x}`, 'Synthetic B'],
    );
    const u = await pool.query(
      'INSERT INTO users (uid,username,email,password_hash,full_name,tenant_id,facility_id) VALUES ($1,$2,$3,$4,$5,$6,$7),($8,$9,$10,$11,$12,$13,$14) RETURNING id',
      [
        `da-${x}`,
        `da-${x}`,
        `da-${x}@example.test`,
        'test-only',
        'Synthetic clinician',
        t.rows[0].id,
        f.rows[0].id,
        `db-${x}`,
        `db-${x}`,
        `db-${x}@example.test`,
        'test-only',
        'Synthetic clinician B',
        t.rows[1].id,
        f.rows[1].id,
      ],
    );
    a = {
      tenantId: t.rows[0].id,
      facilityId: f.rows[0].id,
      actorUserId: u.rows[0].id,
      actorName: 'Synthetic clinician',
    };
    b = {
      tenantId: t.rows[1].id,
      facilityId: f.rows[1].id,
      actorUserId: u.rows[1].id,
      actorName: 'Synthetic clinician B',
    };
    const p = await pool.query(
      "INSERT INTO patients (tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES ($1,$2,$3,'Synthetic','Patient','2000-01-01','Other') RETURNING id",
      [a.tenantId, a.facilityId, `D-${x}`],
    );
    patientId = p.rows[0].id;
  });
  it('requires explicit facility protocol, scoped patient and authorized plan', async () => {
    const assessment = await createAssessmentScoped(a, {
      patientId,
      renalHistorySummary: 'Synthetic assessment',
      vascularAccessType: 'Synthetic access',
    });
    await expect(
      createPlanScoped(a, {
        patientId,
        assessmentId: assessment.id,
        modality: 'Test',
        values: { example: 3 },
      }),
    ).rejects.toMatchObject({ code: 'APPROVED_PROTOCOL_REQUIRED' });
    await expect(
      createAssessmentScoped(b, {
        patientId,
        renalHistorySummary: 'Test',
        vascularAccessType: 'Test',
      }),
    ).rejects.toMatchObject({ code: 'PATIENT_NOT_FOUND' });
    await approveProtocolScoped(a, {
      version: 'test-v1',
      approvalReference: 'Synthetic test approval',
      planFields: [{ key: 'example', type: 'number', required: true, min: 1, max: 5 }],
      completionFields: [{ key: 'note', type: 'text', required: true }],
    });
    const plan = await createPlanScoped(a, {
      patientId,
      assessmentId: assessment.id,
      modality: 'Test',
      values: { example: 3 },
    });
    planId = plan.id;
    const machine = await createMachineScoped(a, {
      machineCode: 'TEST-01',
      bayLabel: 'Test bay',
      isolationZone: 'Test zone',
    });
    machineId = machine.id;
    expect(machine.status).toBe('OUT_OF_SERVICE');
    await expect(
      setMachineStatusScoped(a, machineId, { status: 'AVAILABLE', note: 'test' }),
    ).rejects.toMatchObject({ code: 'READINESS_CONFIRMATION_REQUIRED' });
    await setMachineStatusScoped(a, machineId, {
      status: 'AVAILABLE',
      note: 'Synthetic readiness',
      confirmedReady: true,
    });
    await expect(
      scheduleDialysisScoped(a, {
        patientId,
        treatmentPlanId: planId,
        machineId,
        scheduledDate: '2026-10-28',
        startTime: '08:00',
        endTime: '09:00',
        shiftCode: 'test',
        idempotencyKey: 'unauthorized',
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZED_PLAN_REQUIRED' });
    await authorizePlanScoped(a, planId);
  });
  it('creates linked appointments once and prevents overlapping machine allocations', async () => {
    const input = {
      patientId,
      treatmentPlanId: planId,
      machineId,
      scheduledDate: '2026-10-28',
      startTime: '08:00',
      endTime: '09:00',
      shiftCode: 'test',
      idempotencyKey: 'slot-1',
    };
    const results = await Promise.all([
      scheduleDialysisScoped(a, input),
      scheduleDialysisScoped(a, input),
    ]);
    expect(results[0].scheduleId).toBe(results[1].scheduleId);
    expect(results.filter((r) => r.idempotentReplay)).toHaveLength(1);
    await expect(
      scheduleDialysisScoped(a, {
        ...input,
        idempotencyKey: 'other',
        startTime: '08:30',
        endTime: '09:30',
      }),
    ).rejects.toMatchObject({ code: 'MACHINE_SLOT_CONFLICT' });
    const started = await startDialysisSessionScoped(a, results[0].scheduleId);
    sessionId = started.session.id;
    expect(started.session.status).toBe('IN_PROGRESS');
    expect((await startDialysisSessionScoped(a, results[0].scheduleId)).idempotentReplay).toBe(
      true,
    );
    await expect(startDialysisSessionScoped(b, results[0].scheduleId)).rejects.toMatchObject({
      code: 'SCHEDULE_NOT_FOUND',
    });
    const workspace = await getDialysisWorkspaceScoped(a);
    expect(workspace.schedules[0].status).toBe('IN_PROGRESS');
    expect(workspace.sessions[0].status).not.toBe('COMPLETED');
  });
  it('atomically consumes unexpired batches once and does not invent costs', async () => {
    const item = await pool.query(
      "INSERT INTO inventory_items (facility_id,item_code,name,current_stock,unit_cost) VALUES ($1,$2,'Synthetic supply',10,'0.00') RETURNING id",
      [a.facilityId, `SUP-${randomUUID().slice(0, 8)}`],
    );
    await pool.query(
      "INSERT INTO inventory_batches (item_id,batch_number,expiry_date,quantity_remaining,cost_per_unit) VALUES ($1,'EXPIRED','2000-01-01',5,'3.00'),($1,'VALID','2099-12-31',5,'0.00')",
      [item.rows[0].id],
    );
    const req = { inventoryItemId: item.rows[0].id, quantity: 2, idempotencyKey: 'usage-1' };
    const usage = await recordConsumableScoped(a, sessionId, req);
    expect(usage).toMatchObject({ totalCostKes: null, costStatus: 'UNAVAILABLE' });
    expect((await recordConsumableScoped(a, sessionId, req)).idempotentReplay).toBe(true);
    const batches = await pool.query(
      'SELECT batch_number,quantity_remaining FROM inventory_batches WHERE item_id=$1 ORDER BY batch_number',
      [item.rows[0].id],
    );
    expect(batches.rows).toEqual([
      { batch_number: 'EXPIRED', quantity_remaining: 5 },
      { batch_number: 'VALID', quantity_remaining: 3 },
    ]);
    await expect(
      recordConsumableScoped(a, sessionId, { ...req, idempotencyKey: 'usage-2', quantity: 4 }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  });
  it('records observations and adverse follow-up, and requires explicit completion', async () => {
    await addSessionObservationScoped(a, sessionId, { testObservation: 'Synthetic' });
    const event = await recordAdverseEventScoped(a, sessionId, {
      eventType: 'Synthetic',
      severity: 'Test',
      clinicalDescription: 'Synthetic',
      immediateIntervention: 'Synthetic',
      sessionOutcome: 'Under observation',
    });
    expect(
      (
        await followUpAdverseEventScoped(a, event.id, {
          status: 'RESOLVED',
          notes: 'Synthetic follow-up',
        })
      ).followUpStatus,
    ).toBe('RESOLVED');
    await expect(
      completeDialysisSessionScoped(a, sessionId, {
        outcome: 'COMPLETED',
        actualDurationMinutes: 30,
        nursingSummary: 'Synthetic',
        values: {},
      }),
    ).rejects.toMatchObject({ code: 'PROTOCOL_FIELD_REQUIRED' });
    const completed = await completeDialysisSessionScoped(a, sessionId, {
      outcome: 'COMPLETED',
      actualDurationMinutes: 30,
      nursingSummary: 'Synthetic',
      values: { note: 'Synthetic completion' },
    });
    expect(completed).toMatchObject({ status: 'COMPLETED', billingStatus: 'UNBILLED' });
    const row = await pool.query(
      'SELECT status,revision_history FROM dialysis_sessions WHERE id=$1',
      [sessionId],
    );
    expect(row.rows[0].revision_history.map((e: { action: string }) => e.action)).toEqual([
      'STARTED',
      'OBSERVATION',
      'ADVERSE_EVENT_FOLLOW_UP',
      'COMPLETED',
    ]);
    const machine = await pool.query('SELECT status FROM dialysis_machines WHERE id=$1', [
      machineId,
    ]);
    expect(machine.rows[0].status).toBe('DISINFECTION_REQUIRED');
  });
});
