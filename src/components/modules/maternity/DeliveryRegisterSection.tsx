import { DataTable } from '../../ui/layout.tsx';
import React, { useEffect, useState } from 'react';
import type { FacilityService } from '../../../types/index.ts';
import { Baby } from 'lucide-react';

import {
  api,
  type DeliveryRecord,
  type LabourRecord,
  type MaternityPregnancy,
} from '../../../api/client.ts';
import {
  Field,
  createEmptyBaby,
  fieldClass,
  num,
  patientName,
  text,
  updateBaby,
  type BabyDraft,
  type DeliveryDraft,
  type LastDeliveryCharge,
  type RunMaternityAction,
} from './shared.tsx';

export interface DeliveryRegisterSectionProps {
  facilityId?: number;
  activePregnancies: MaternityPregnancy[];
  inLabour: LabourRecord[];
  labours: LabourRecord[];
  deliveries: DeliveryRecord[];
  deliveryOpen: boolean;
  setDeliveryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  delivery: DeliveryDraft;
  setDelivery: React.Dispatch<React.SetStateAction<DeliveryDraft>>;
  lastCharge: LastDeliveryCharge | null;
  setLastCharge: React.Dispatch<React.SetStateAction<LastDeliveryCharge | null>>;
  busy: boolean;
  runAction: RunMaternityAction;
  loadAll: () => Promise<void>;
  setNotice: (message: string | null) => void;
}

export const DeliveryRegisterSection: React.FC<DeliveryRegisterSectionProps> = ({
  facilityId,
  activePregnancies,
  inLabour,
  labours,
  deliveries,
  deliveryOpen,
  setDeliveryOpen,
  delivery,
  setDelivery,
  lastCharge,
  setLastCharge,
  busy,
  runAction,
  loadAll,
  setNotice,
}) => {
  const [babies, setBabies] = useState<BabyDraft[]>([createEmptyBaby()]);
  const [deliveryServices, setDeliveryServices] = useState<FacilityService[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [serviceError, setServiceError] = useState('');

  useEffect(() => {
    let current = true;
    setServiceId('');
    setDeliveryServices([]);
    setServiceError('');
    if (facilityId && deliveryOpen) {
      api
        .getAvailableFacilityServices(facilityId, { category: 'DELIVERY' })
        .then((rows) => {
          if (current) setDeliveryServices(rows);
        })
        .catch(() => {
          if (current)
            setServiceError(
              'Delivery services could not be loaded. You can record care without selecting one; billing will require review.',
            );
        });
    }
    return () => {
      current = false;
    };
  }, [facilityId, deliveryOpen]);

  const submitDelivery = async (event: React.FormEvent) => {
    event.preventDefault();

    await runAction(async () => {
      const created = await api.recordDelivery({
        pregnancyId: num(delivery.pregnancyId),
        labourRecordId: num(delivery.labourRecordId),
        deliveredAt: delivery.deliveredAt || new Date().toISOString(),
        deliveryMode: delivery.deliveryMode,
        facilityServiceId: num(serviceId),
        bloodLossMl: num(delivery.bloodLossMl),
        perineum: text(delivery.perineum),
        placentaComplete:
          delivery.placentaComplete === '' ? undefined : delivery.placentaComplete === 'Yes',
        oxytocinGiven: delivery.oxytocinGiven,
        complications: text(delivery.complications),
        notes: text(delivery.notes),
        babies: babies.map((baby) => ({
          outcome: baby.outcome,
          sex: text(baby.sex),
          birthWeightGrams: num(baby.birthWeightGrams),
          apgar1: num(baby.apgar1),
          apgar5: num(baby.apgar5),
          resuscitation: text(baby.resuscitation),
        })),
      });

      const mother = created.delivery.patient
        ? patientName(created.delivery.patient)
        : `Patient #${created.delivery.patientId}`;

      setLastCharge(created.billing ? { patient: mother, charge: created.billing } : null);

      setNotice(
        `Delivery recorded: ${created.babies.length} ${created.babies.length === 1 ? 'baby' : 'babies'}.`,
      );
      setDeliveryOpen(false);
      setBabies([createEmptyBaby()]);
      setServiceId('');

      await loadAll();
    }, 'The delivery could not be recorded.');
  };

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setDeliveryOpen((open) => !open)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-teal-800"
        >
          <Baby className="h-4 w-4" />
          Record delivery
        </button>
      </div>

      {deliveryOpen && (
        <form
          onSubmit={submitDelivery}
          className="space-y-3 rounded-xl border border-hair bg-surface p-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Delivery service (optional)">
              <select
                value={serviceId}
                onChange={(event) => setServiceId(event.target.value)}
                className={fieldClass}
              >
                <option value="">No service selected — billing review required</option>
                {deliveryServices.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name} ({service.code}) —{' '}
                    {service.unitPrice === null || service.unitPrice === undefined
                      ? 'price unavailable'
                      : `KES ${service.unitPrice}`}
                  </option>
                ))}
              </select>
              {serviceError && (
                <p role="alert" className="text-xs text-amber-700">
                  {serviceError}
                </p>
              )}
            </Field>
            <Field label="Pregnancy *">
              <select
                required
                value={delivery.pregnancyId}
                onChange={(e) => setDelivery({ ...delivery, pregnancyId: e.target.value })}
                className={fieldClass}
              >
                <option value="">Select an active pregnancy</option>
                {activePregnancies.map((pregnancy) => (
                  <option key={pregnancy.id} value={pregnancy.id}>
                    {pregnancy.patient ? patientName(pregnancy.patient) : `#${pregnancy.patientId}`}{' '}
                    · EDD {pregnancy.eddDate}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Labour record (optional)">
              <select
                value={delivery.labourRecordId}
                onChange={(e) => setDelivery({ ...delivery, labourRecordId: e.target.value })}
                className={fieldClass}
              >
                <option value="">Not linked</option>
                {inLabour.concat(labours.filter((l) => l.status === 'Delivered')).map((labour) => (
                  <option key={labour.id} value={labour.id}>
                    #{labour.id} · {labour.patient ? patientName(labour.patient) : 'patient'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Delivered at">
              <input
                type="datetime-local"
                value={delivery.deliveredAt}
                onChange={(e) => setDelivery({ ...delivery, deliveredAt: e.target.value })}
                className={fieldClass}
              />
            </Field>
            <Field label="Mode *">
              <select
                value={delivery.deliveryMode}
                onChange={(e) => setDelivery({ ...delivery, deliveryMode: e.target.value })}
                className={fieldClass}
              >
                {[
                  'Spontaneous Vertex',
                  'Assisted Vaginal',
                  'Breech',
                  'Vacuum',
                  'Forceps',
                  'Caesarean Section',
                ].map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Blood loss (ml)">
              <input
                type="number"
                min={0}
                value={delivery.bloodLossMl}
                onChange={(e) => setDelivery({ ...delivery, bloodLossMl: e.target.value })}
                className={fieldClass}
              />
            </Field>
            <Field label="Perineum">
              <select
                value={delivery.perineum}
                onChange={(e) => setDelivery({ ...delivery, perineum: e.target.value })}
                className={fieldClass}
              >
                <option value="">Not recorded</option>
                {[
                  'Intact',
                  '1st Degree',
                  '2nd Degree',
                  '3rd Degree',
                  '4th Degree',
                  'Episiotomy',
                ].map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Placenta complete">
              <select
                value={delivery.placentaComplete}
                onChange={(e) => setDelivery({ ...delivery, placentaComplete: e.target.value })}
                className={fieldClass}
              >
                <option value="">Not recorded</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </Field>
            <Field label="Complications">
              <input
                type="text"
                value={delivery.complications}
                onChange={(e) => setDelivery({ ...delivery, complications: e.target.value })}
                className={fieldClass}
              />
            </Field>
          </div>

          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">Babies</h3>
              {babies.length < 6 && (
                <button
                  type="button"
                  onClick={() => setBabies((current) => [...current, createEmptyBaby()])}
                  className="rounded border border-slate-300 px-2 py-1 text-2xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Add baby
                </button>
              )}
            </div>

            {babies.map((baby, index) => (
              <div key={index} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Field label={`Baby ${index + 1} outcome`}>
                  <select
                    value={baby.outcome}
                    onChange={(e) =>
                      setBabies(updateBaby(babies, index, { outcome: e.target.value }))
                    }
                    className={fieldClass}
                  >
                    {[
                      'Live Birth',
                      'Stillbirth Fresh',
                      'Stillbirth Macerated',
                      'Neonatal Death',
                    ].map((outcome) => (
                      <option key={outcome} value={outcome}>
                        {outcome}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Sex">
                  <select
                    value={baby.sex}
                    onChange={(e) => setBabies(updateBaby(babies, index, { sex: e.target.value }))}
                    className={fieldClass}
                  >
                    <option value="">Not recorded</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Ambiguous">Ambiguous</option>
                  </select>
                </Field>
                <Field label="Weight (g)">
                  <input
                    type="number"
                    value={baby.birthWeightGrams}
                    onChange={(e) =>
                      setBabies(updateBaby(babies, index, { birthWeightGrams: e.target.value }))
                    }
                    className={fieldClass}
                  />
                </Field>
                <Field label="Apgar 1′">
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={baby.apgar1}
                    onChange={(e) =>
                      setBabies(updateBaby(babies, index, { apgar1: e.target.value }))
                    }
                    className={fieldClass}
                  />
                </Field>
                <Field label="Apgar 5′">
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={baby.apgar5}
                    onChange={(e) =>
                      setBabies(updateBaby(babies, index, { apgar5: e.target.value }))
                    }
                    className={fieldClass}
                  />
                </Field>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeliveryOpen(false)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Record delivery'}
            </button>
          </div>
        </form>
      )}

      {lastCharge && (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm ${
            lastCharge.charge.charged
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
        >
          {lastCharge.charge.charged ? (
            <>
              <strong>Billed.</strong> {lastCharge.patient} —{' '}
              {lastCharge.charge.invoiceNumber
                ? `invoice ${lastCharge.charge.invoiceNumber}`
                : 'added to an open invoice'}
              {lastCharge.charge.totalAmount ? ` · KES ${lastCharge.charge.totalAmount}` : ''}
              {lastCharge.charge.tariffCode ? ` · tariff ${lastCharge.charge.tariffCode}` : ''}.
            </>
          ) : (
            <>
              <strong>Recorded, not billed.</strong>{' '}
              {lastCharge.charge.reason === 'TARIFF_NOT_CONFIGURED'
                ? 'This facility has no active delivery tariff, so no invoice line was raised. Add one under Finance → Service tariffs; the delivery itself is saved.'
                : (lastCharge.charge.message ??
                  'The billing engine did not raise an invoice line.')}
            </>
          )}
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-hair bg-surface">
        <div className="border-b border-hair bg-canvas px-4 py-3">
          <h2 className="text-sm font-bold text-slate-800">Delivery register</h2>
        </div>
        <div className="overflow-x-auto">
          <DataTable className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 text-2xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Delivered</th>
                <th className="px-4 py-2.5 font-medium">Patient</th>
                <th className="px-4 py-2.5 font-medium">Mode</th>
                <th className="px-4 py-2.5 font-medium">Babies</th>
                <th className="px-4 py-2.5 font-medium">Outcome</th>
                <th className="px-4 py-2.5 font-medium">Blood loss</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {deliveries.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    No deliveries recorded yet.
                  </td>
                </tr>
              )}
              {deliveries.map((record) => {
                const recordBabies =
                  (record as DeliveryRecord & { babies?: Array<{ outcome: string }> }).babies ?? [];

                return (
                  <tr key={record.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-2.5 font-mono text-slate-600">
                      {record.deliveredAt.replace('T', ' ').slice(0, 16)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-slate-900">
                        {record.patient ? patientName(record.patient) : `#${record.patientId}`}
                      </div>
                      <div className="font-mono text-2xs text-slate-500">
                        {record.patient?.mrn ?? ''}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{record.deliveryMode}</td>
                    <td className="px-4 py-2.5 font-mono">{recordBabies.length}</td>
                    <td className="px-4 py-2.5 text-2xs text-slate-600">
                      {recordBabies.map((baby) => baby.outcome).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-600">
                      {record.bloodLossMl !== null ? `${record.bloodLossMl} ml` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        </div>
      </section>
    </div>
  );
};
