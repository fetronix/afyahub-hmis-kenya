import React, { useState } from 'react';
import { Plus } from 'lucide-react';

import type {
  MaternityPregnancy,
  MaternityPregnancyDetail,
  PostnatalVisit,
} from '../../../api/client.ts';
import { PostnatalContactForm } from './PostnatalContactForm.tsx';
import { Field, fieldClass, patientName, type RunMaternityAction } from './shared.tsx';

export interface PostnatalCareSectionProps {
  facilityId: number | undefined;
  pregnancies: MaternityPregnancy[];
  postnatalRegister: PostnatalVisit[];
  setPostnatalRegister: React.Dispatch<React.SetStateAction<PostnatalVisit[]>>;
  postnatalPregnancy: MaternityPregnancyDetail | null;
  postnatalVisits: PostnatalVisit[];
  loadPostnatal: (pregnancyId: number) => Promise<void>;
  busy: boolean;
  runAction: RunMaternityAction;
  setNotice: (message: string | null) => void;
}

export const PostnatalCareSection: React.FC<PostnatalCareSectionProps> = ({
  facilityId,
  pregnancies,
  postnatalRegister,
  setPostnatalRegister,
  postnatalPregnancy,
  postnatalVisits,
  loadPostnatal,
  busy,
  runAction,
  setNotice,
}) => {
  const [postnatalOpen, setPostnatalOpen] = useState(false);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
      <section className="overflow-hidden rounded-xl border border-hair bg-surface">
        <div className="flex items-center justify-between border-b border-hair bg-canvas px-4 py-3">
          <h2 className="text-sm font-bold text-slate-800">Postnatal contacts</h2>
          <span className="text-2xs text-slate-500">{postnatalRegister.length} recent</span>
        </div>

        <div className="border-b border-hair p-4">
          <Field label="Open a mother's record">
            <select
              value={postnatalPregnancy?.id ?? ''}
              onChange={(e) =>
                void runAction(
                  () => loadPostnatal(Number(e.target.value)),
                  'The postnatal record could not be opened.',
                )
              }
              className={fieldClass}
            >
              <option value="">Select a pregnancy</option>
              {pregnancies.map((pregnancy) => (
                <option key={pregnancy.id} value={pregnancy.id}>
                  {pregnancy.patient ? patientName(pregnancy.patient) : `#${pregnancy.patientId}`} ·{' '}
                  {pregnancy.status} · EDD {pregnancy.eddDate}
                </option>
              ))}
            </select>
          </Field>

          <p className="mt-2 text-2xs leading-relaxed text-slate-500">
            Postnatal care is filed against the pregnancy, not the delivery, so a woman who
            delivered elsewhere still has a record here.
          </p>
        </div>

        <ul className="divide-y divide-slate-100">
          {postnatalRegister.length === 0 && (
            <li className="px-4 py-6 text-center text-xs text-slate-500">
              No postnatal contacts recorded yet.
            </li>
          )}

          {postnatalRegister.map((visit) => (
            <li key={visit.id}>
              <button
                type="button"
                onClick={() =>
                  void runAction(
                    () => loadPostnatal(visit.pregnancyId),
                    'The postnatal record could not be opened.',
                  )
                }
                className={`w-full px-4 py-3 text-left hover:bg-slate-50 ${
                  postnatalPregnancy?.id === visit.pregnancyId ? 'bg-teal-50' : ''
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-900">
                    {visit.patient ? patientName(visit.patient) : `Patient #${visit.patientId}`}
                  </span>
                  <span className="font-mono text-2xs text-slate-500">
                    {visit.dayPostpartum !== null ? `day ${visit.dayPostpartum}` : 'day —'}
                  </span>
                </div>
                <div className="mt-1 font-mono text-2xs text-slate-500">
                  {visit.visitDate}
                  {visit.babyWeightGrams !== null ? ` · baby ${visit.babyWeightGrams} g` : ''}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-hair bg-surface p-4">
        {!postnatalPregnancy ? (
          <p className="text-sm text-slate-500">
            Select a mother on the left to see her postnatal contacts and record the next one.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  {postnatalPregnancy.patient
                    ? patientName(postnatalPregnancy.patient)
                    : `Pregnancy #${postnatalPregnancy.id}`}
                </h2>
                <p className="mt-1 font-mono text-2xs text-slate-500">
                  {postnatalPregnancy.patient?.mrn ?? ''} · delivered{' '}
                  {postnatalPregnancy.deliveries?.[0]?.deliveredAt.slice(0, 10) ??
                    'not recorded here'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setPostnatalOpen((open) => !open)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Record contact
              </button>
            </div>

            {postnatalOpen && (
              <PostnatalContactForm
                facilityId={facilityId}
                postnatalPregnancy={postnatalPregnancy}
                busy={busy}
                runAction={runAction}
                loadPostnatal={loadPostnatal}
                setPostnatalRegister={setPostnatalRegister}
                setNotice={setNotice}
                onRecorded={() => setPostnatalOpen(false)}
              />
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-2xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Day</th>
                    <th className="px-3 py-2 font-medium">BP</th>
                    <th className="px-3 py-2 font-medium">Pulse</th>
                    <th className="px-3 py-2 font-medium">Involution</th>
                    <th className="px-3 py-2 font-medium">Lochia</th>
                    <th className="px-3 py-2 font-medium">Breastfeeding</th>
                    <th className="px-3 py-2 font-medium">Baby weight</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {postnatalVisits.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                        No postnatal contacts recorded for this mother yet.
                      </td>
                    </tr>
                  )}

                  {postnatalVisits.map((visit) => (
                    <tr key={visit.id} className="hover:bg-slate-50/70">
                      <td className="px-3 py-2 font-mono text-slate-700">{visit.visitDate}</td>
                      <td className="px-3 py-2 font-mono">{visit.dayPostpartum ?? '—'}</td>
                      <td className="px-3 py-2 font-mono">
                        {visit.bpSystolic && visit.bpDiastolic
                          ? `${visit.bpSystolic}/${visit.bpDiastolic}`
                          : '—'}
                      </td>
                      <td className="px-3 py-2 font-mono">{visit.pulseBpm ?? '—'}</td>
                      <td className="px-3 py-2 text-2xs text-slate-600">
                        {visit.involution ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-2xs text-slate-600">{visit.lochia ?? '—'}</td>
                      <td className="px-3 py-2 text-2xs text-slate-600">
                        {visit.breastfeeding ?? '—'}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {visit.babyWeightGrams !== null ? `${visit.babyWeightGrams} g` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
