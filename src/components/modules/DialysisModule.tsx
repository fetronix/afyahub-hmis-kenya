import { PageHeader } from '../ui/layout.tsx';
import React, { useCallback, useEffect, useState } from 'react';
import { sprintApi, type DialysisWorkspace } from '../../api/client-sprint.client.ts';
import { useHmis } from '../../context/HmisContext.tsx';

const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const button =
  'rounded-lg bg-brand-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50';
type Rule = { key: string; type: 'text' | 'number' | 'boolean'; required: boolean };
function valuesForRules(rules: Rule[], values: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const rule of rules) {
    const value = values[rule.key] ?? '';
    if (value === '') continue;
    result[rule.key] =
      rule.type === 'number' ? Number(value) : rule.type === 'boolean' ? value === 'true' : value;
  }
  return result;
}
function ProtocolFields({
  rules,
  values,
  onChange,
}: {
  rules: Rule[];
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  return (
    <div className="space-y-2">
      {rules.map((rule) => (
        <label key={rule.key} className="block text-xs font-medium text-ink-soft">
          {rule.key}
          {rule.required ? ' *' : ''}
          {rule.type === 'boolean' ? (
            <select
              className={field}
              value={values[rule.key] ?? ''}
              required={rule.required}
              onChange={(e) => onChange({ ...values, [rule.key]: e.target.value })}
            >
              <option value="">Select…</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          ) : (
            <input
              className={field}
              type={rule.type === 'number' ? 'number' : 'text'}
              step={rule.type === 'number' ? 'any' : undefined}
              value={values[rule.key] ?? ''}
              required={rule.required}
              onChange={(e) => onChange({ ...values, [rule.key]: e.target.value })}
            />
          )}
        </label>
      ))}
    </div>
  );
}
export const DialysisModule: React.FC = () => {
  const { currentFacility, authenticatedUser, showToast } = useHmis();
  const [data, setData] = useState<DialysisWorkspace | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [protocol, setProtocol] = useState({
    version: '',
    approvalReference: '',
    planFields: '',
    completionFields: '',
  });
  const [machine, setMachine] = useState({ machineCode: '', bayLabel: '', isolationZone: '' }),
    [machineReady, setMachineReady] = useState({ id: '', note: '', confirmed: false });
  const [assessment, setAssessment] = useState({
    patientId: '',
    renalHistorySummary: '',
    vascularAccessType: '',
  });
  const [plan, setPlan] = useState({
      patientId: '',
      assessmentId: '',
      modality: '',
      values: {} as Record<string, string>,
    }),
    [planToAuthorize, setPlanToAuthorize] = useState('');
  const [schedule, setSchedule] = useState({
    patientId: '',
    treatmentPlanId: '',
    machineId: '',
    scheduledDate: '',
    startTime: '',
    endTime: '',
    shiftCode: '',
  });
  const [scheduleKey, setScheduleKey] = useState(() => crypto.randomUUID());
  const [complete, setComplete] = useState({
    sessionId: '',
    outcome: '',
    actualDurationMinutes: '',
    nursingSummary: '',
    values: {} as Record<string, string>,
  });
  const [observation, setObservation] = useState({ sessionId: '', notes: '' });
  const [usage, setUsage] = useState({ sessionId: '', inventoryItemId: '', quantity: '' }),
    [usageKey, setUsageKey] = useState(() => crypto.randomUUID());
  const [event, setEvent] = useState({
    sessionId: '',
    eventType: '',
    severity: '',
    clinicalDescription: '',
    immediateIntervention: '',
    sessionOutcome: '',
  });
  const [follow, setFollow] = useState({ id: '', status: '', notes: '' });
  const permissions = new Set(authenticatedUser?.permissions ?? []),
    can = (p: string) => Boolean(authenticatedUser?.isSuperAdmin || permissions.has(p));
  const load = useCallback(async () => {
    if (!currentFacility?.id) return;
    try {
      setError('');
      setData(await sprintApi.dialysisWorkspace(currentFacility.id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load dialysis.');
    }
  }, [currentFacility?.id]);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await action();
      showToast(message, { tone: 'success' });
      await load();
      return true;
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Operation failed.', { tone: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (!currentFacility) return <p>Select a facility to view dialysis.</p>;
  const fid = currentFacility.id;
  const completionRules =
    data?.sessions.find((session) => session.id === Number(complete.sessionId))?.completionFields ??
    [];
  return (
    <div className="space-y-5">
      <PageHeader>
        <div>
          <h1 className="ui-page-title">Dialysis unit</h1>
          <p className="ui-page-description">
            A scheduled slot is not a completed treatment. No treatment settings are supplied by the
            application; approved protocol rules and clinician entries are required.
          </p>
        </div>
      </PageHeader>
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
      {data && (
        <section className="rounded-xl border border-hair bg-surface p-4 space-y-3">
          <p className="text-xs text-amber-800">
            {data.notice} Consumable costs are not automatically posted to the ledger.
          </p>
          <p className="text-xs">
            Approved protocol:{' '}
            {data.protocol
              ? `${data.protocol.version} · ${data.protocol.approvalReference}`
              : 'Not configured'}
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h2 className="font-semibold">Machines</h2>
              <ul className="mt-2 space-y-1 text-xs">
                {data.machines.map((m) => (
                  <li key={m.id}>
                    #{m.id} {m.machineCode} · {m.bayLabel} · {m.isolationZone} · {m.status}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="font-semibold">Schedules</h2>
              <ul className="mt-2 space-y-2 text-xs">
                {data.schedules.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2">
                    #{s.id} · Patient #{s.patientId} · {s.scheduledDate} {s.startTime}–{s.endTime} ·{' '}
                    {s.status}
                    {s.status === 'SCHEDULED' && can('dialysis.sessions.record') && (
                      <button
                        className="btn-quiet"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => sprintApi.startDialysis(s.id, { facilityId: fid }),
                            'Session started.',
                          )
                        }
                      >
                        Start session
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div>
            <h2 className="font-semibold">Sessions</h2>
            <ul className="mt-2 space-y-1 text-xs">
              {data.sessions.map((s) => (
                <li key={s.id}>
                  #{s.id} · {s.sessionNumber} · Patient #{s.patientId} · {s.status} ·{' '}
                  {s.billedChargeStatus}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
      {can('dialysis.protocols.manage') && (
        <form
          className="rounded-xl border border-hair bg-surface p-4 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              try {
                const planFields = JSON.parse(protocol.planFields),
                  completionFields = JSON.parse(protocol.completionFields);
                await run(
                  () =>
                    sprintApi.approveProtocol({
                      facilityId: fid,
                      protocol: {
                        version: protocol.version,
                        approvalReference: protocol.approvalReference,
                        planFields,
                        completionFields,
                      },
                    }),
                  'Protocol approval recorded.',
                );
              } catch {
                showToast('Enter valid JSON arrays for the approved field rules.', {
                  tone: 'error',
                });
              }
            })();
          }}
        >
          <h2 className="font-semibold">Approve facility protocol</h2>
          <p className="text-xs text-muted">
            Only enter rules approved by the facility. Each JSON array contains field rules with
            key, type and required; optional numeric bounds must come from the approved protocol.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className={field}
              placeholder="Protocol version"
              aria-label="Protocol version"
              required
              value={protocol.version}
              onChange={(e) => setProtocol({ ...protocol, version: e.target.value })}
            />
            <input
              className={field}
              placeholder="Approval reference"
              aria-label="Approval reference"
              required
              value={protocol.approvalReference}
              onChange={(e) => setProtocol({ ...protocol, approvalReference: e.target.value })}
            />
          </div>
          <textarea
            className={field}
            aria-label="Plan field rules JSON"
            placeholder="Approved plan field rules (JSON array)"
            required
            value={protocol.planFields}
            onChange={(e) => setProtocol({ ...protocol, planFields: e.target.value })}
          />
          <textarea
            className={field}
            aria-label="Completion field rules JSON"
            placeholder="Approved completion field rules (JSON array)"
            required
            value={protocol.completionFields}
            onChange={(e) => setProtocol({ ...protocol, completionFields: e.target.value })}
          />
          <button className={button} disabled={busy}>
            Record protocol approval
          </button>
        </form>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {can('dialysis.machines.manage') && (
          <>
            <form
              className="rounded-xl border border-hair bg-surface p-4 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  () => sprintApi.createMachine({ facilityId: fid, ...machine }),
                  'Machine registered out of service.',
                );
              }}
            >
              <h2 className="font-semibold">Register machine</h2>
              {(['machineCode', 'bayLabel', 'isolationZone'] as const).map((k) => (
                <input
                  key={k}
                  className={field}
                  aria-label={k}
                  placeholder={k}
                  required
                  value={machine[k]}
                  onChange={(e) => setMachine({ ...machine, [k]: e.target.value })}
                />
              ))}
              <button className={button} disabled={busy}>
                Register
              </button>
            </form>
            <form
              className="rounded-xl border border-hair bg-surface p-4 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  () =>
                    sprintApi.setMachineStatus(Number(machineReady.id), {
                      facilityId: fid,
                      status: 'AVAILABLE',
                      note: machineReady.note,
                      confirmedReady: machineReady.confirmed,
                    }),
                  'Machine marked available.',
                );
              }}
            >
              <h2 className="font-semibold">Confirm machine readiness</h2>
              <select
                className={field}
                aria-label="Machine to mark ready"
                required
                value={machineReady.id}
                onChange={(e) => setMachineReady({ ...machineReady, id: e.target.value })}
              >
                <option value="">Select machine</option>
                {data?.machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.machineCode} · {m.status}
                  </option>
                ))}
              </select>
              <input
                className={field}
                placeholder="Readiness / cleaning note"
                required
                value={machineReady.note}
                onChange={(e) => setMachineReady({ ...machineReady, note: e.target.value })}
              />
              <label className="flex gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={machineReady.confirmed}
                  onChange={(e) =>
                    setMachineReady({ ...machineReady, confirmed: e.target.checked })
                  }
                />
                I confirm this machine is ready for use.
              </label>
              <button className={button} disabled={busy || !machineReady.confirmed}>
                Mark available
              </button>
            </form>
          </>
        )}
      </div>
      {can('dialysis.assessments.manage') && (
        <div className="grid gap-4 lg:grid-cols-2">
          <form
            className="rounded-xl border border-hair bg-surface p-4 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                await run(async () => {
                  const r = await sprintApi.createAssessment({
                    facilityId: fid,
                    ...assessment,
                    patientId: Number(assessment.patientId),
                  });
                  setPlan((p) => ({
                    ...p,
                    patientId: assessment.patientId,
                    assessmentId: String(r.assessment.id),
                  }));
                }, 'Assessment saved for clinical review.');
              })();
            }}
          >
            <h2 className="font-semibold">Patient assessment</h2>
            <input
              className={field}
              aria-label="Assessment patient ID"
              placeholder="Existing patient ID"
              required
              value={assessment.patientId}
              onChange={(e) => setAssessment({ ...assessment, patientId: e.target.value })}
            />
            <textarea
              className={field}
              aria-label="Renal history"
              placeholder="Clinical assessment"
              required
              value={assessment.renalHistorySummary}
              onChange={(e) =>
                setAssessment({ ...assessment, renalHistorySummary: e.target.value })
              }
            />
            <input
              className={field}
              aria-label="Vascular access"
              placeholder="Vascular access documented by clinician"
              required
              value={assessment.vascularAccessType}
              onChange={(e) => setAssessment({ ...assessment, vascularAccessType: e.target.value })}
            />
            <button className={button} disabled={busy}>
              Save assessment
            </button>
          </form>
          <form
            className="rounded-xl border border-hair bg-surface p-4 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const r = await sprintApi.createPlan({
                  facilityId: fid,
                  patientId: Number(plan.patientId),
                  assessmentId: Number(plan.assessmentId),
                  modality: plan.modality,
                  values: valuesForRules(data?.protocol?.planFields ?? [], plan.values),
                });
                setPlanToAuthorize(String(r.treatmentPlan.id));
              }, 'Draft plan created; authorization is still required.');
            }}
          >
            <h2 className="font-semibold">Draft treatment plan</h2>
            <input
              className={field}
              placeholder="Patient ID"
              required
              value={plan.patientId}
              onChange={(e) => setPlan({ ...plan, patientId: e.target.value })}
            />
            <input
              className={field}
              placeholder="Assessment ID"
              required
              value={plan.assessmentId}
              onChange={(e) => setPlan({ ...plan, assessmentId: e.target.value })}
            />
            <input
              className={field}
              placeholder="Clinician-prescribed modality"
              required
              value={plan.modality}
              onChange={(e) => setPlan({ ...plan, modality: e.target.value })}
            />
            {data?.protocol ? (
              <ProtocolFields
                rules={data.protocol.planFields}
                values={plan.values}
                onChange={(values) => setPlan({ ...plan, values })}
              />
            ) : (
              <p className="text-xs text-amber-800">An approved facility protocol is required.</p>
            )}
            <button className={button} disabled={busy || !data?.protocol}>
              Create draft
            </button>
          </form>
        </div>
      )}
      {can('dialysis.plans.authorize') && (
        <form
          className="rounded-xl border border-hair bg-surface p-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => sprintApi.authorizePlan(Number(planToAuthorize), { facilityId: fid }),
              'Plan authorized.',
            );
          }}
        >
          <label className="text-xs">
            Draft plan ID
            <input
              className={field}
              required
              value={planToAuthorize}
              onChange={(e) => setPlanToAuthorize(e.target.value)}
            />
          </label>
          <button className={button} disabled={busy}>
            Authorize plan
          </button>
        </form>
      )}
      {can('dialysis.schedule.manage') && (
        <form
          className="rounded-xl border border-hair bg-surface p-4 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              const ok = await run(
                () =>
                  sprintApi.scheduleDialysis(
                    {
                      facilityId: fid,
                      ...schedule,
                      patientId: Number(schedule.patientId),
                      treatmentPlanId: Number(schedule.treatmentPlanId),
                      machineId: Number(schedule.machineId),
                    },
                    scheduleKey,
                  ),
                'Schedule and linked appointment created.',
              );
              if (ok) setScheduleKey(crypto.randomUUID());
            })();
          }}
        >
          <h2 className="font-semibold">Schedule session</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            {(['patientId', 'treatmentPlanId', 'shiftCode'] as const).map((k) => (
              <input
                key={k}
                className={field}
                placeholder={k}
                aria-label={k}
                required
                value={schedule[k]}
                onChange={(e) => setSchedule({ ...schedule, [k]: e.target.value })}
              />
            ))}
            <select
              className={field}
              aria-label="Scheduled machine"
              required
              value={schedule.machineId}
              onChange={(e) => setSchedule({ ...schedule, machineId: e.target.value })}
            >
              <option value="">Select machine</option>
              {data?.machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.machineCode} · {m.status}
                </option>
              ))}
            </select>
            <input
              className={field}
              aria-label="Scheduled date"
              type="date"
              required
              value={schedule.scheduledDate}
              onChange={(e) => setSchedule({ ...schedule, scheduledDate: e.target.value })}
            />
            <input
              className={field}
              aria-label="Start time"
              type="time"
              required
              value={schedule.startTime}
              onChange={(e) => setSchedule({ ...schedule, startTime: e.target.value })}
            />
            <input
              className={field}
              aria-label="End time"
              type="time"
              required
              value={schedule.endTime}
              onChange={(e) => setSchedule({ ...schedule, endTime: e.target.value })}
            />
          </div>
          <button className={button} disabled={busy}>
            Schedule
          </button>
        </form>
      )}
      {can('dialysis.sessions.record') && (
        <div className="grid gap-4 lg:grid-cols-2">
          <form
            className="rounded-xl border border-hair bg-surface p-4 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  sprintApi.addObservation(Number(observation.sessionId), {
                    facilityId: fid,
                    values: { notes: observation.notes },
                  }),
                'Observation recorded.',
              );
            }}
          >
            <h2 className="font-semibold">Add observation</h2>
            <input
              className={field}
              placeholder="Session ID"
              required
              value={observation.sessionId}
              onChange={(e) => setObservation({ ...observation, sessionId: e.target.value })}
            />
            <textarea
              className={field}
              placeholder="Clinician-entered observation"
              required
              value={observation.notes}
              onChange={(e) => setObservation({ ...observation, notes: e.target.value })}
            />
            <button className={button} disabled={busy}>
              Record observation
            </button>
          </form>
          <form
            className="rounded-xl border border-hair bg-surface p-4 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  sprintApi.completeDialysis(Number(complete.sessionId), {
                    facilityId: fid,
                    outcome: complete.outcome,
                    actualDurationMinutes: Number(complete.actualDurationMinutes),
                    nursingSummary: complete.nursingSummary,
                    values: valuesForRules(completionRules, complete.values),
                  }),
                'Session outcome recorded.',
              );
            }}
          >
            <h2 className="font-semibold">Record session outcome</h2>
            <input
              className={field}
              placeholder="Session ID"
              required
              value={complete.sessionId}
              onChange={(e) => setComplete({ ...complete, sessionId: e.target.value })}
            />
            <select
              className={field}
              required
              value={complete.outcome}
              onChange={(e) => setComplete({ ...complete, outcome: e.target.value })}
            >
              <option value="">Select actual outcome</option>
              <option value="COMPLETED">Completed</option>
              <option value="TERMINATED_EARLY">Terminated early</option>
              <option value="ABORTED">Aborted</option>
            </select>
            <input
              className={field}
              type="number"
              min="1"
              placeholder="Actual duration in minutes"
              required
              value={complete.actualDurationMinutes}
              onChange={(e) => setComplete({ ...complete, actualDurationMinutes: e.target.value })}
            />
            <textarea
              className={field}
              placeholder="Clinical summary"
              required
              value={complete.nursingSummary}
              onChange={(e) => setComplete({ ...complete, nursingSummary: e.target.value })}
            />
            {completionRules.length > 0 && (
              <ProtocolFields
                rules={completionRules}
                values={complete.values}
                onChange={(values) => setComplete({ ...complete, values })}
              />
            )}
            <button className={button} disabled={busy}>
              Record outcome
            </button>
          </form>
        </div>
      )}
      {can('dialysis.sessions.record') && can('inventory.manage') && (
        <form
          className="rounded-xl border border-hair bg-surface p-4 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              const ok = await run(
                () =>
                  sprintApi.useConsumable(
                    Number(usage.sessionId),
                    {
                      facilityId: fid,
                      inventoryItemId: Number(usage.inventoryItemId),
                      quantity: Number(usage.quantity),
                    },
                    usageKey,
                  ),
                'Consumable usage recorded.',
              );
              if (ok) setUsageKey(crypto.randomUUID());
            })();
          }}
        >
          <h2 className="w-full font-semibold">Record consumables</h2>
          {(['sessionId', 'inventoryItemId', 'quantity'] as const).map((k) => (
            <input
              key={k}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={k}
              aria-label={k}
              required
              value={usage[k]}
              onChange={(e) => setUsage({ ...usage, [k]: e.target.value })}
            />
          ))}
          <button className={button} disabled={busy}>
            Record usage
          </button>
        </form>
      )}
      {can('dialysis.adverse_events.manage') && (
        <div className="grid gap-4 lg:grid-cols-2">
          <form
            className="rounded-xl border border-hair bg-surface p-4 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  sprintApi.adverseEvent(Number(event.sessionId), { facilityId: fid, ...event }),
                'Adverse event recorded for follow-up.',
              );
            }}
          >
            <h2 className="font-semibold">Adverse event</h2>
            {(
              [
                'sessionId',
                'eventType',
                'severity',
                'clinicalDescription',
                'immediateIntervention',
                'sessionOutcome',
              ] as const
            ).map((k) => (
              <input
                key={k}
                className={field}
                placeholder={k}
                aria-label={k}
                required
                value={event[k]}
                onChange={(e) => setEvent({ ...event, [k]: e.target.value })}
              />
            ))}
            <button className={button} disabled={busy}>
              Record event
            </button>
          </form>
          <form
            className="rounded-xl border border-hair bg-surface p-4 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  sprintApi.followUp(Number(follow.id), {
                    facilityId: fid,
                    status: follow.status,
                    notes: follow.notes,
                  }),
                'Follow-up recorded.',
              );
            }}
          >
            <h2 className="font-semibold">Event follow-up</h2>
            <input
              className={field}
              placeholder="Event ID"
              required
              value={follow.id}
              onChange={(e) => setFollow({ ...follow, id: e.target.value })}
            />
            <select
              className={field}
              required
              value={follow.status}
              onChange={(e) => setFollow({ ...follow, status: e.target.value })}
            >
              <option value="">Select status</option>
              <option value="OPEN">Open</option>
              <option value="IN_FOLLOW_UP">In follow-up</option>
              <option value="RESOLVED">Resolved</option>
            </select>
            <textarea
              className={field}
              placeholder="Follow-up notes"
              required
              value={follow.notes}
              onChange={(e) => setFollow({ ...follow, notes: e.target.value })}
            />
            <button className={button} disabled={busy}>
              Record follow-up
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
