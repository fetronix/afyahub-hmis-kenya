import { PageHeader } from '../ui/layout.tsx';
/**
 * JaliCare HMIS
 * Maternity & MCH
 *
 * Coordinator for the five maternal and child health clinical workflows:
 *   1. Antenatal register (`AncRegisterSection`)
 *   2. Labour ward & partograph (`LabourWardSection`)
 *   3. Delivery register & billing (`DeliveryRegisterSection`)
 *   4. Postnatal care (`PostnatalCareSection`)
 *   5. Immunisation (`ImmunisationSection`)
 *
 * Two rules shape the forms across all tabs:
 *
 *   1. An empty field is sent as absent, never as 0. The server stores
 *      NULL and the record stays honest about what was not measured.
 *   2. Every number the screen shows came back from the server. There is
 *      no sample patient, no example blood pressure and no placeholder
 *      Apgar score.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Baby,
  CalendarDays,
  ClipboardList,
  HeartPulse,
  RefreshCw,
  Syringe,
} from 'lucide-react';

import { useHmis } from '../../context/HmisContext.tsx';
import {
  api,
  type DeliveryRecord,
  type ImmunisationAntigen,
  type ImmunisationCard,
  type ImmunisationDueRow,
  type LabourRecord,
  type MaternityPregnancy,
  type MaternityPregnancyDetail,
  type MaternitySummary,
  type PostnatalVisit,
} from '../../api/client.ts';
import type { Patient } from '../../types/index.ts';

import { AncRegisterSection } from './maternity/AncRegisterSection.tsx';
import { DeliveryRegisterSection } from './maternity/DeliveryRegisterSection.tsx';
import { ImmunisationSection } from './maternity/ImmunisationSection.tsx';
import { LabourWardSection } from './maternity/LabourWardSection.tsx';
import { PostnatalCareSection } from './maternity/PostnatalCareSection.tsx';
import {
  SummaryChip,
  errorMessage,
  type DeliveryDraft,
  type LastDeliveryCharge,
  type MaternityTab,
} from './maternity/shared.tsx';

export const MaternityModule: React.FC = () => {
  const { currentFacility, showToast } = useHmis();

  const [tab, setTab] = useState<MaternityTab>('anc');
  const [summary, setSummary] = useState<MaternitySummary | null>(null);
  const [pregnancies, setPregnancies] = useState<MaternityPregnancy[]>([]);
  const [labours, setLabours] = useState<LabourRecord[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);

  const [selectedPregnancy, setSelectedPregnancy] = useState<MaternityPregnancyDetail | null>(null);
  const [selectedLabour, setSelectedLabour] = useState<LabourRecord | null>(null);

  const [postnatalRegister, setPostnatalRegister] = useState<PostnatalVisit[]>([]);
  const [postnatalPregnancy, setPostnatalPregnancy] = useState<MaternityPregnancyDetail | null>(
    null,
  );
  const [postnatalVisits, setPostnatalVisits] = useState<PostnatalVisit[]>([]);

  const [immunisationSchedule, setImmunisationSchedule] = useState<ImmunisationAntigen[]>([]);
  const [immunisationDue, setImmunisationDue] = useState<ImmunisationDueRow[]>([]);
  const [immunisationAsOf, setImmunisationAsOf] = useState<string | null>(null);
  const [immunisationNote, setImmunisationNote] = useState<string | null>(null);
  const [immunisationCard, setImmunisationCard] = useState<ImmunisationCard | null>(null);

  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryDraft>({
    pregnancyId: '',
    labourRecordId: '',
    deliveredAt: '',
    deliveryMode: 'Spontaneous Vertex',
    bloodLossMl: '',
    perineum: '',
    placentaComplete: '',
    oxytocinGiven: false,
    complications: '',
    notes: '',
  });
  const [lastCharge, setLastCharge] = useState<LastDeliveryCharge | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const facilityId = currentFacility?.id;

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [
        summaryResult,
        pregnancyRows,
        labourRows,
        deliveryRows,
        patientRows,
        postnatalRows,
        scheduleResult,
        dueResult,
      ] = await Promise.all([
        api.getMaternitySummary(facilityId),
        api.getPregnancies({ facilityId }),
        api.getLabours({ facilityId }),
        api.getDeliveries({ facilityId }),
        api.getPatients(undefined, facilityId),
        api.getPostnatalRegister(facilityId),
        api.getImmunisationSchedule(),
        facilityId ? api.getImmunisationDueList(facilityId) : Promise.resolve(null),
      ]);

      setSummary(summaryResult);
      setPregnancies(pregnancyRows);
      setLabours(labourRows);
      setDeliveries(deliveryRows);
      setPatients(patientRows);
      setPostnatalRegister(postnatalRows);
      setImmunisationSchedule(scheduleResult.antigens);
      setImmunisationDue(dueResult?.children ?? []);
      setImmunisationAsOf(dueResult?.asOf ?? null);
      setImmunisationNote(dueResult?.note ?? scheduleResult.note);
    } catch (err) {
      setError(errorMessage(err, 'The maternity register could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const runAction = useCallback(async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      await action();
    } catch (err) {
      setError(errorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  }, []);

  const refreshPregnancy = useCallback(async (pregnancyId: number) => {
    const detail = await api.getPregnancy(pregnancyId);

    setSelectedPregnancy(detail);
  }, []);

  const refreshLabour = useCallback(async (labourRecordId: number) => {
    const detail = await api.getLabour(labourRecordId);

    setSelectedLabour(detail);
  }, []);

  const loadPostnatal = useCallback(async (pregnancyId: number) => {
    const [detail, visits] = await Promise.all([
      api.getPregnancy(pregnancyId),
      api.getPostnatalVisits(pregnancyId),
    ]);

    setPostnatalPregnancy(detail);
    setPostnatalVisits(visits);
  }, []);

  const loadImmunisationCard = useCallback(async (patientId: number) => {
    const card = await api.getImmunisationCard(patientId);

    setImmunisationCard(card);
  }, []);

  const refreshImmunisationDue = useCallback(async () => {
    if (!facilityId) return;

    const due = await api.getImmunisationDueList(facilityId);

    setImmunisationDue(due.children);
    setImmunisationAsOf(due.asOf);
    setImmunisationNote(due.note);
  }, [facilityId]);

  const handleStartDeliveryFromLabour = useCallback(
    (pregnancyId: number, labourRecordId: number) => {
      setDelivery((current) => ({
        ...current,
        pregnancyId: String(pregnancyId),
        labourRecordId: String(labourRecordId),
      }));
      setTab('deliveries');
      setDeliveryOpen(true);
    },
    [],
  );

  const activePregnancies = useMemo(
    () => pregnancies.filter((pregnancy) => pregnancy.status === 'Active'),
    [pregnancies],
  );

  const inLabour = useMemo(
    () => labours.filter((labour) => labour.status === 'In Labour'),
    [labours],
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <PageHeader>
        <div>
          <h1 className="ui-page-title">Maternity &amp; MCH</h1>
          <p className="ui-page-description">
            Antenatal care, labour with a partograph, and delivery — recorded against one pregnancy.
          </p>
          <p className="mt-2 text-2xs font-semibold uppercase tracking-[0.12em] text-brand-700">
            Maternity &rarr; Antenatal register is the first tab below
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SummaryChip label="Booked" value={summary?.activePregnancies} tone="brand" />
          <SummaryChip label="ANC this month" value={summary?.ancVisitsThisMonth} />
          <SummaryChip label="In labour" value={summary?.inLabour} tone="ember" />
          <SummaryChip label="Delivered" value={summary?.deliveriesThisMonth} />
          <button
            type="button"
            onClick={() => void loadAll()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </PageHeader>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {notice}
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: 'anc', label: 'Antenatal register', icon: CalendarDays },
            { id: 'labour', label: 'Labour & partograph', icon: HeartPulse },
            { id: 'deliveries', label: 'Deliveries & billing', icon: Baby },
            { id: 'postnatal', label: 'Postnatal care', icon: Activity },
            { id: 'immunisation', label: 'Immunisation', icon: Syringe },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-semibold ${
              tab === id
                ? 'border-brand-500 bg-brand-500 text-white shadow-sm'
                : 'border-brand-100 bg-white text-brand-900 hover:border-brand-300 hover:bg-brand-50'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
            {id === 'anc' && activePregnancies.length > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 font-mono text-2xs font-bold ${
                  tab === id ? 'bg-white/20 text-white' : 'bg-brand-100 text-brand-800'
                }`}
              >
                {activePregnancies.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && pregnancies.length === 0 && (
        <p className="text-sm text-slate-500">Loading the maternity register…</p>
      )}

      {tab === 'anc' && (
        <AncRegisterSection
          facilityId={facilityId}
          patients={patients}
          pregnancies={pregnancies}
          selectedPregnancy={selectedPregnancy}
          busy={busy}
          runAction={runAction}
          loadAll={loadAll}
          refreshPregnancy={refreshPregnancy}
          setNotice={setNotice}
          showToast={showToast}
        />
      )}

      {tab === 'labour' && (
        <LabourWardSection
          activePregnancies={activePregnancies}
          labours={labours}
          selectedLabour={selectedLabour}
          busy={busy}
          runAction={runAction}
          loadAll={loadAll}
          refreshLabour={refreshLabour}
          setNotice={setNotice}
          onStartDeliveryFromLabour={handleStartDeliveryFromLabour}
        />
      )}

      {tab === 'deliveries' && (
        <DeliveryRegisterSection
          facilityId={facilityId}
          activePregnancies={activePregnancies}
          inLabour={inLabour}
          labours={labours}
          deliveries={deliveries}
          deliveryOpen={deliveryOpen}
          setDeliveryOpen={setDeliveryOpen}
          delivery={delivery}
          setDelivery={setDelivery}
          lastCharge={lastCharge}
          setLastCharge={setLastCharge}
          busy={busy}
          runAction={runAction}
          loadAll={loadAll}
          setNotice={setNotice}
        />
      )}

      {tab === 'postnatal' && (
        <PostnatalCareSection
          facilityId={facilityId}
          pregnancies={pregnancies}
          postnatalRegister={postnatalRegister}
          setPostnatalRegister={setPostnatalRegister}
          postnatalPregnancy={postnatalPregnancy}
          postnatalVisits={postnatalVisits}
          loadPostnatal={loadPostnatal}
          busy={busy}
          runAction={runAction}
          setNotice={setNotice}
        />
      )}

      {tab === 'immunisation' && (
        <ImmunisationSection
          patients={patients}
          immunisationSchedule={immunisationSchedule}
          immunisationDue={immunisationDue}
          immunisationAsOf={immunisationAsOf}
          immunisationNote={immunisationNote}
          immunisationCard={immunisationCard}
          loadImmunisationCard={loadImmunisationCard}
          refreshImmunisationDue={refreshImmunisationDue}
          busy={busy}
          runAction={runAction}
          setNotice={setNotice}
        />
      )}

      <p className="text-2xs text-slate-500">
        <ClipboardList className="mr-1 inline h-3 w-3" />
        Empty fields are stored as absent, not as zero. The partograph line is a plotting aid
        against the reference curve; it does not recommend an intervention.
      </p>
    </div>
  );
};
