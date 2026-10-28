import React, { useState } from 'react';

import { api, type MaternityPregnancyDetail, type PostnatalVisit } from '../../../api/client.ts';
import {
  BREASTFEEDING_OPTIONS,
  BREAST_OPTIONS,
  Field,
  INVOLUTION_OPTIONS,
  LOCHIA_OPTIONS,
  MOOD_OPTIONS,
  PERINEUM_OPTIONS,
  fieldClass,
  num,
  text,
  todayIso,
  type RunMaternityAction,
} from './shared.tsx';

export interface PostnatalContactFormProps {
  facilityId: number | undefined;
  postnatalPregnancy: MaternityPregnancyDetail;
  busy: boolean;
  runAction: RunMaternityAction;
  loadPostnatal: (pregnancyId: number) => Promise<void>;
  setPostnatalRegister: React.Dispatch<React.SetStateAction<PostnatalVisit[]>>;
  setNotice: (message: string | null) => void;
  onRecorded: () => void;
}

export const PostnatalContactForm: React.FC<PostnatalContactFormProps> = ({
  facilityId,
  postnatalPregnancy,
  busy,
  runAction,
  loadPostnatal,
  setPostnatalRegister,
  setNotice,
  onRecorded,
}) => {
  const [pn, setPn] = useState({
    visitDate: todayIso(),
    visitNumber: '',
    bpSystolic: '',
    bpDiastolic: '',
    pulseBpm: '',
    temperatureC: '',
    fundalHeightCm: '',
    involution: '',
    lochia: '',
    perineum: '',
    breasts: '',
    breastfeeding: '',
    moodScreening: '',
    haemoglobinGdl: '',
    dangerSigns: '',
    notes: '',
    nextVisitDate: '',
    babyWeightGrams: '',
    babyNotes: '',
  });

  const submitPostnatal = async (event: React.FormEvent) => {
    event.preventDefault();

    const pregnancyId = postnatalPregnancy.id;
    const delivery = postnatalPregnancy.deliveries?.[0];

    await runAction(async () => {
      const created = await api.recordPostnatalVisit({
        pregnancyId,
        deliveryId: delivery?.id,
        visitDate: pn.visitDate,
        visitNumber: num(pn.visitNumber),
        bpSystolic: num(pn.bpSystolic),
        bpDiastolic: num(pn.bpDiastolic),
        pulseBpm: num(pn.pulseBpm),
        temperatureC: num(pn.temperatureC),
        fundalHeightCm: num(pn.fundalHeightCm),
        involution: text(pn.involution),
        lochia: text(pn.lochia),
        perineum: text(pn.perineum),
        breasts: text(pn.breasts),
        breastfeeding: text(pn.breastfeeding),
        moodScreening: text(pn.moodScreening),
        haemoglobinGdl: num(pn.haemoglobinGdl),
        dangerSigns: text(pn.dangerSigns),
        notes: text(pn.notes),
        nextVisitDate: text(pn.nextVisitDate),
        babyWeightGrams: num(pn.babyWeightGrams),
        babyNotes: text(pn.babyNotes),
      });

      setNotice(
        `Postnatal contact recorded for ${created.visitDate}${
          created.dayPostpartum !== null ? ` (day ${created.dayPostpartum})` : ''
        }.`,
      );

      onRecorded();
      setPn((current) => ({
        ...current,
        visitNumber: '',
        bpSystolic: '',
        bpDiastolic: '',
        pulseBpm: '',
        temperatureC: '',
        fundalHeightCm: '',
        involution: '',
        lochia: '',
        perineum: '',
        breasts: '',
        breastfeeding: '',
        moodScreening: '',
        haemoglobinGdl: '',
        dangerSigns: '',
        notes: '',
        nextVisitDate: '',
        babyWeightGrams: '',
        babyNotes: '',
      }));

      await loadPostnatal(pregnancyId);
      setPostnatalRegister(await api.getPostnatalRegister(facilityId));
    }, 'The postnatal contact could not be recorded.');
  };

  return (
    <form onSubmit={submitPostnatal} className="space-y-2 rounded-lg border border-slate-200 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Field label="Visit date *">
          <input
            required
            type="date"
            value={pn.visitDate}
            onChange={(e) => setPn({ ...pn, visitDate: e.target.value })}
            className={fieldClass}
          />
        </Field>
        <Field label="Contact no.">
          <input
            type="number"
            min={1}
            value={pn.visitNumber}
            onChange={(e) => setPn({ ...pn, visitNumber: e.target.value })}
            className={fieldClass}
          />
        </Field>
        <Field label="Baby weight (g)">
          <input
            type="number"
            value={pn.babyWeightGrams}
            onChange={(e) => setPn({ ...pn, babyWeightGrams: e.target.value })}
            className={fieldClass}
          />
        </Field>
        <Field label="BP systolic">
          <input
            type="number"
            value={pn.bpSystolic}
            onChange={(e) => setPn({ ...pn, bpSystolic: e.target.value })}
            className={fieldClass}
          />
        </Field>
        <Field label="BP diastolic">
          <input
            type="number"
            value={pn.bpDiastolic}
            onChange={(e) => setPn({ ...pn, bpDiastolic: e.target.value })}
            className={fieldClass}
          />
        </Field>
        <Field label="Pulse">
          <input
            type="number"
            value={pn.pulseBpm}
            onChange={(e) => setPn({ ...pn, pulseBpm: e.target.value })}
            className={fieldClass}
          />
        </Field>
        <Field label="Temp (°C)">
          <input
            type="number"
            step="0.1"
            value={pn.temperatureC}
            onChange={(e) => setPn({ ...pn, temperatureC: e.target.value })}
            className={fieldClass}
          />
        </Field>
        <Field label="Fundal height (cm)">
          <input
            type="number"
            step="0.1"
            value={pn.fundalHeightCm}
            onChange={(e) => setPn({ ...pn, fundalHeightCm: e.target.value })}
            className={fieldClass}
          />
        </Field>
        <Field label="Hb (g/dL)">
          <input
            type="number"
            step="0.1"
            value={pn.haemoglobinGdl}
            onChange={(e) => setPn({ ...pn, haemoglobinGdl: e.target.value })}
            className={fieldClass}
          />
        </Field>
        <Field label="Involution">
          <select
            value={pn.involution}
            onChange={(e) => setPn({ ...pn, involution: e.target.value })}
            className={fieldClass}
          >
            <option value="">Not examined</option>
            {INVOLUTION_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Lochia">
          <select
            value={pn.lochia}
            onChange={(e) => setPn({ ...pn, lochia: e.target.value })}
            className={fieldClass}
          >
            <option value="">Not examined</option>
            {LOCHIA_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Perineum">
          <select
            value={pn.perineum}
            onChange={(e) => setPn({ ...pn, perineum: e.target.value })}
            className={fieldClass}
          >
            <option value="">Not examined</option>
            {PERINEUM_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Breasts">
          <select
            value={pn.breasts}
            onChange={(e) => setPn({ ...pn, breasts: e.target.value })}
            className={fieldClass}
          >
            <option value="">Not recorded</option>
            {BREAST_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Breastfeeding">
          <select
            value={pn.breastfeeding}
            onChange={(e) => setPn({ ...pn, breastfeeding: e.target.value })}
            className={fieldClass}
          >
            <option value="">Not recorded</option>
            {BREASTFEEDING_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mood screening">
          <select
            value={pn.moodScreening}
            onChange={(e) => setPn({ ...pn, moodScreening: e.target.value })}
            className={fieldClass}
          >
            <option value="">Not screened</option>
            {MOOD_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Next visit">
          <input
            type="date"
            value={pn.nextVisitDate}
            onChange={(e) => setPn({ ...pn, nextVisitDate: e.target.value })}
            className={fieldClass}
          />
        </Field>
      </div>

      <Field label="Danger signs">
        <input
          type="text"
          value={pn.dangerSigns}
          onChange={(e) => setPn({ ...pn, dangerSigns: e.target.value })}
          className={fieldClass}
          placeholder="Blank means none were recorded"
        />
      </Field>
      <Field label="Notes">
        <textarea
          rows={2}
          value={pn.notes}
          onChange={(e) => setPn({ ...pn, notes: e.target.value })}
          className={fieldClass}
        />
      </Field>
      <Field label="Baby notes">
        <input
          type="text"
          value={pn.babyNotes}
          onChange={(e) => setPn({ ...pn, babyNotes: e.target.value })}
          className={fieldClass}
        />
      </Field>

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Record postnatal contact'}
      </button>
    </form>
  );
};
