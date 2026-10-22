/**
 * JaliCare HMIS
 * Maternity & MCH
 *
 * Three screens that follow the clinical order: the antenatal register,
 * the labour ward with the partograph, and the delivery register.
 *
 * Two rules shape the forms:
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
  AlertTriangle,
  Baby,
  CalendarDays,
  ClipboardList,
  HeartPulse,
  Plus,
  RefreshCw,
  Syringe,
  UserPlus,
} from 'lucide-react';

import { useHmis } from '../../context/HmisContext.tsx';
import {
  api,
  type AncVisit,
  type DeliveryRecord,
  type ImmunisationAntigen,
  type ImmunisationCard,
  type ImmunisationDueRow,
  type LabourRecord,
  type MaternityPregnancy,
  type MaternityPregnancyDetail,
  type MaternitySummary,
  type PartographEntry,
  type PostnatalVisit,
  type ServiceCharge,
} from '../../api/client.ts';

import { PartographChart } from '../maternity/PartographChart.tsx';

import type { Patient } from '../../types/index.ts';

/* ============================================================
   SMALL HELPERS
   ============================================================ */

const todayIso = () => new Date().toISOString().slice(0, 10);

/** '' -> undefined, so an untouched field is absent rather than zero. */
function num(value: string): number | undefined {
  if (value.trim() === '') return undefined;

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function text(value: string): string | undefined {
  const trimmed = value.trim();

  return trimmed === '' ? undefined : trimmed;
}

function formatGestation(
  gestation: { weeks: number; days: number } | null | undefined,
): string {
  if (!gestation) return '—';

  return `${gestation.weeks}w ${gestation.days}d`;
}

function patientName(patient: {
  firstName: string;
  lastName: string;
}): string {
  return `${patient.firstName} ${patient.lastName}`.trim();
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;

  return fallback;
}

const fieldClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100';
const labelClass = 'mb-1 block text-xs font-semibold text-slate-700';

/*
 * Presentation lists. The server validates every one of these on the way
 * in, so a stale option here is refused rather than stored.
 */
const INVOLUTION_OPTIONS = ['Normal', 'Subinvolution', 'Not examined'];
const LOCHIA_OPTIONS = ['Rubra', 'Serosa', 'Alba', 'Abnormal', 'Not examined'];
const PERINEUM_OPTIONS = [
  'Intact',
  'Healing',
  'Infected',
  'Dehisced',
  'Episiotomy healing',
  'Not examined',
];
const BREAST_OPTIONS = ['Normal', 'Engorged', 'Cracked nipples', 'Mastitis'];
const BREASTFEEDING_OPTIONS = [
  'Exclusive',
  'Mixed',
  'Formula',
  'Not breastfeeding',
];
const MOOD_OPTIONS = ['Not screened', 'No concern', 'Concern — referred'];

/** Children under five, for the immunisation card picker. */
function isUnderFive(patient: Patient): boolean {
  if (!patient.dateOfBirth) return false;

  const born = new Date(`${patient.dateOfBirth}T00:00:00Z`).getTime();

  if (!Number.isFinite(born)) return false;

  return Date.now() - born < 5 * 365.25 * 86_400_000;
}

function doseStatusClass(status: string): string {
  switch (status) {
    case 'Overdue':
      return 'bg-rose-100 text-rose-800';
    case 'Due':
      return 'bg-amber-100 text-amber-900';
    case 'Given':
      return 'bg-emerald-100 text-emerald-800';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

/* ============================================================
   MODULE
   ============================================================ */

type Tab = 'anc' | 'labour' | 'deliveries' | 'postnatal' | 'immunisation';

export const MaternityModule: React.FC = () => {
  const { currentFacility, showToast } = useHmis();

  const [tab, setTab] = useState<Tab>('anc');
  const [summary, setSummary] = useState<MaternitySummary | null>(null);
  const [pregnancies, setPregnancies] = useState<MaternityPregnancy[]>([]);
  const [labours, setLabours] = useState<LabourRecord[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);

  const [selectedPregnancy, setSelectedPregnancy] =
    useState<MaternityPregnancyDetail | null>(null);
  const [selectedLabour, setSelectedLabour] = useState<LabourRecord | null>(null);

  /* ---------------- postnatal ---------------- */
  const [postnatalRegister, setPostnatalRegister] = useState<PostnatalVisit[]>([]);
  const [postnatalPregnancy, setPostnatalPregnancy] =
    useState<MaternityPregnancyDetail | null>(null);
  const [postnatalVisits, setPostnatalVisits] = useState<PostnatalVisit[]>([]);
  const [postnatalOpen, setPostnatalOpen] = useState(false);

  /* ---------------- immunisation ---------------- */
  const [immunisationSchedule, setImmunisationSchedule] = useState<
    ImmunisationAntigen[]
  >([]);
  const [immunisationDue, setImmunisationDue] = useState<ImmunisationDueRow[]>([]);
  const [immunisationAsOf, setImmunisationAsOf] = useState<string | null>(null);
  const [immunisationNote, setImmunisationNote] = useState<string | null>(null);
  const [immunisationCard, setImmunisationCard] =
    useState<ImmunisationCard | null>(null);
  const [immunisationOpen, setImmunisationOpen] = useState(false);

  /*
   * What billing answered for the last delivery. A delivery is billable,
   * but only if the facility has priced it; the panel says which.
   */
  const [lastCharge, setLastCharge] = useState<{
    patient: string;
    charge: ServiceCharge;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const facilityId = currentFacility?.id;

  /* ---------------- booking form ---------------- */
  const [bookingOpen, setBookingOpen] = useState(false);
  const [booking, setBooking] = useState({
    patientId: '',
    bookedAt: todayIso(),
    lmpDate: '',
    eddDate: '',
    eddBasis: 'LMP',
    gravida: '',
    para: '',
    abortions: '',
    riskFactors: '',
  });

  /* ---------------- ANC visit form ---------------- */
  const [ancOpen, setAncOpen] = useState(false);
  const [anc, setAnc] = useState({
    visitDate: todayIso(),
    visitNumber: '',
    weightKg: '',
    bpSystolic: '',
    bpDiastolic: '',
    pulseBpm: '',
    fundalHeightCm: '',
    fetalHeartRateBpm: '',
    presentation: '',
    urineProtein: '',
    haemoglobinGdl: '',
    ttDose: '',
    dangerSigns: '',
    notes: '',
    nextVisitDate: '',
  });

  /* ---------------- labour form ---------------- */
  const [labourOpen, setLabourOpen] = useState(false);
  const [labourForm, setLabourForm] = useState({
    pregnancyId: '',
    admittedAt: '',
    labourOnsetAt: '',
  });

  /* ---------------- partograph form ---------------- */
  const [pg, setPg] = useState({
    recordedAt: '',
    cervicalDilatationCm: '',
    descentStation: '',
    contractionsPer10Min: '',
    contractionDurationSec: '',
    fetalHeartRateBpm: '',
    membranes: '',
    liquor: '',
    maternalPulseBpm: '',
    bpSystolic: '',
    bpDiastolic: '',
    temperatureC: '',
    notes: '',
  });

  /* ---------------- delivery form ---------------- */
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [delivery, setDelivery] = useState({
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
  const [babies, setBabies] = useState<
    Array<{
      outcome: string;
      sex: string;
      birthWeightGrams: string;
      apgar1: string;
      apgar5: string;
      resuscitation: string;
    }>
  >([{ outcome: 'Live Birth', sex: '', birthWeightGrams: '', apgar1: '', apgar5: '', resuscitation: '' }]);

  /* ---------------- postnatal form ---------------- */
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

  /* ---------------- immunisation form ---------------- */
  const [imm, setImm] = useState({
    antigenCode: '',
    doseNumber: '1',
    administeredOn: todayIso(),
    batchNumber: '',
    site: '',
    notes: '',
  });

  /* ============================================================
     LOADING
     ============================================================ */

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
        /*
         * The due list needs a facility. A tenant-level user with no
         * facility selected gets the schedule and the card, and an empty
         * list rather than a failed screen.
         */
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
      setError(
        errorMessage(err, 'The maternity register could not be loaded.'),
      );
    } finally {
      setLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const runAction = async (
    action: () => Promise<void>,
    fallback: string,
  ): Promise<void> => {
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
  };

  const refreshPregnancy = async (pregnancyId: number) => {
    const detail = await api.getPregnancy(pregnancyId);

    setSelectedPregnancy(detail);
  };

  const refreshLabour = async (labourRecordId: number) => {
    const detail = await api.getLabour(labourRecordId);

    setSelectedLabour(detail);
  };

  const loadPostnatal = async (pregnancyId: number) => {
    const [detail, visits] = await Promise.all([
      api.getPregnancy(pregnancyId),
      api.getPostnatalVisits(pregnancyId),
    ]);

    setPostnatalPregnancy(detail);
    setPostnatalVisits(visits);
  };

  const loadImmunisationCard = async (patientId: number) => {
    const card = await api.getImmunisationCard(patientId);

    setImmunisationCard(card);
  };

  const refreshImmunisationDue = async () => {
    if (!facilityId) return;

    const due = await api.getImmunisationDueList(facilityId);

    setImmunisationDue(due.children);
    setImmunisationAsOf(due.asOf);
    setImmunisationNote(due.note);
  };

  /* ============================================================
     ACTIONS
     ============================================================ */

  const submitBooking = async (event: React.FormEvent) => {
    event.preventDefault();

    await runAction(async () => {
      const created = await api.bookPregnancy({
        patientId: num(booking.patientId),
        facilityId,
        bookedAt: booking.bookedAt,
        lmpDate: text(booking.lmpDate),
        eddDate: text(booking.eddDate),
        eddBasis: booking.eddBasis,
        gravida: num(booking.gravida),
        para: num(booking.para),
        abortions: num(booking.abortions),
        riskFactors: text(booking.riskFactors),
      });

      setNotice(
        `Booked ${patientName(patients.find((p) => p.id === created.patientId) ?? { firstName: 'patient', lastName: '' })}. EDD ${created.eddDate}.`,
      );

      setBookingOpen(false);
      setBooking({
        patientId: '',
        bookedAt: todayIso(),
        lmpDate: '',
        eddDate: '',
        eddBasis: 'LMP',
        gravida: '',
        para: '',
        abortions: '',
        riskFactors: '',
      });

      await loadAll();
      await refreshPregnancy(created.id);
      showToast('Pregnancy booked.');
    }, 'The pregnancy could not be booked.');
  };

  const submitAnc = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!selectedPregnancy) return;

    await runAction(async () => {
      await api.recordAncVisit({
        pregnancyId: selectedPregnancy.id,
        visitDate: anc.visitDate,
        visitNumber: num(anc.visitNumber),
        weightKg: num(anc.weightKg),
        bpSystolic: num(anc.bpSystolic),
        bpDiastolic: num(anc.bpDiastolic),
        pulseBpm: num(anc.pulseBpm),
        fundalHeightCm: num(anc.fundalHeightCm),
        fetalHeartRateBpm: num(anc.fetalHeartRateBpm),
        presentation: text(anc.presentation),
        urineProtein: text(anc.urineProtein),
        haemoglobinGdl: num(anc.haemoglobinGdl),
        ttDose: num(anc.ttDose),
        dangerSigns: text(anc.dangerSigns),
        notes: text(anc.notes),
        nextVisitDate: text(anc.nextVisitDate),
      });

      setNotice('Antenatal visit recorded.');
      setAncOpen(false);
      setAnc({
        visitDate: todayIso(),
        visitNumber: '',
        weightKg: '',
        bpSystolic: '',
        bpDiastolic: '',
        pulseBpm: '',
        fundalHeightCm: '',
        fetalHeartRateBpm: '',
        presentation: '',
        urineProtein: '',
        haemoglobinGdl: '',
        ttDose: '',
        dangerSigns: '',
        notes: '',
        nextVisitDate: '',
      });

      await loadAll();
      await refreshPregnancy(selectedPregnancy.id);
    }, 'The antenatal visit could not be recorded.');
  };

  const submitLabour = async (event: React.FormEvent) => {
    event.preventDefault();

    await runAction(async () => {
      const created = await api.startLabour({
        pregnancyId: num(labourForm.pregnancyId),
        admittedAt: labourForm.admittedAt || new Date().toISOString(),
        labourOnsetAt: text(labourForm.labourOnsetAt),
      });

      setNotice('Labour record opened.');
      setLabourOpen(false);
      setLabourForm({ pregnancyId: '', admittedAt: '', labourOnsetAt: '' });

      await loadAll();
      await refreshLabour(created.id);
      setTab('labour');
    }, 'The labour record could not be opened.');
  };

  const submitPartograph = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!selectedLabour) return;

    await runAction(async () => {
      await api.recordPartograph({
        labourRecordId: selectedLabour.id,
        recordedAt: pg.recordedAt || new Date().toISOString(),
        cervicalDilatationCm: num(pg.cervicalDilatationCm),
        descentStation: num(pg.descentStation),
        contractionsPer10Min: num(pg.contractionsPer10Min),
        contractionDurationSec: num(pg.contractionDurationSec),
        fetalHeartRateBpm: num(pg.fetalHeartRateBpm),
        membranes: text(pg.membranes),
        liquor: text(pg.liquor),
        maternalPulseBpm: num(pg.maternalPulseBpm),
        bpSystolic: num(pg.bpSystolic),
        bpDiastolic: num(pg.bpDiastolic),
        temperatureC: num(pg.temperatureC),
        notes: text(pg.notes),
      });

      setNotice('Partograph reading recorded.');
      setPg({
        recordedAt: '',
        cervicalDilatationCm: '',
        descentStation: '',
        contractionsPer10Min: '',
        contractionDurationSec: '',
        fetalHeartRateBpm: '',
        membranes: '',
        liquor: '',
        maternalPulseBpm: '',
        bpSystolic: '',
        bpDiastolic: '',
        temperatureC: '',
        notes: '',
      });

      await refreshLabour(selectedLabour.id);
      await loadAll();
    }, 'The partograph reading could not be recorded.');
  };

  const submitDelivery = async (event: React.FormEvent) => {
    event.preventDefault();

    await runAction(async () => {
      const created = await api.recordDelivery({
        pregnancyId: num(delivery.pregnancyId),
        labourRecordId: num(delivery.labourRecordId),
        deliveredAt: delivery.deliveredAt || new Date().toISOString(),
        deliveryMode: delivery.deliveryMode,
        bloodLossMl: num(delivery.bloodLossMl),
        perineum: text(delivery.perineum),
        placentaComplete:
          delivery.placentaComplete === ''
            ? undefined
            : delivery.placentaComplete === 'Yes',
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

      setLastCharge(
        created.billing ? { patient: mother, charge: created.billing } : null,
      );

      setNotice(
        `Delivery recorded: ${created.babies.length} ${created.babies.length === 1 ? 'baby' : 'babies'}.`,
      );
      setDeliveryOpen(false);
      setBabies([
        { outcome: 'Live Birth', sex: '', birthWeightGrams: '', apgar1: '', apgar5: '', resuscitation: '' },
      ]);

      await loadAll();
      setTab('deliveries');
    }, 'The delivery could not be recorded.');
  };

  const submitPostnatal = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!postnatalPregnancy) return;

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

      setPostnatalOpen(false);
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

  const submitImmunisation = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!immunisationCard) return;

    const patientId = immunisationCard.patient.id;
    const antigen = immunisationSchedule.find(
      (candidate) => candidate.code === imm.antigenCode,
    );

    await runAction(async () => {
      const created = await api.recordImmunisation({
        patientId,
        antigenCode: imm.antigenCode,
        doseNumber: num(imm.doseNumber),
        administeredOn: imm.administeredOn,
        batchNumber: text(imm.batchNumber),
        site: text(imm.site),
        route: antigen?.route,
        notes: text(imm.notes),
      });

      setNotice(
        `${created.antigenCode} dose ${created.doseNumber} recorded on ${created.administeredOn}.`,
      );

      setImmunisationOpen(false);
      setImm({
        antigenCode: '',
        doseNumber: '1',
        administeredOn: todayIso(),
        batchNumber: '',
        site: '',
        notes: '',
      });

      await loadImmunisationCard(patientId);
      await refreshImmunisationDue();
    }, 'The dose could not be recorded.');
  };

  /* ============================================================
     DERIVED
     ============================================================ */

  const activePregnancies = useMemo(
    () => pregnancies.filter((pregnancy) => pregnancy.status === 'Active'),
    [pregnancies],
  );

  const inLabour = useMemo(
    () => labours.filter((labour) => labour.status === 'In Labour'),
    [labours],
  );

  /* ============================================================
     RENDER
     ============================================================ */

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 rounded-card border border-hair bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-[1.35rem] leading-tight tracking-tight text-ink">
            Maternity &amp; MCH
          </h1>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Antenatal care, labour with a partograph, and delivery — recorded
            against one pregnancy.
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
      </div>

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

      {/* ---------------- ANTENATAL ---------------- */}
      {tab === 'anc' && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="overflow-hidden rounded-xl border border-hair bg-surface">
            <div className="flex items-center justify-between border-b border-hair bg-canvas px-4 py-3">
              <h2 className="text-sm font-bold text-slate-800">
                Booked pregnancies
              </h2>
              <button
                type="button"
                onClick={() => setBookingOpen((open) => !open)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-ember-500 px-3 py-1.5 text-xs font-bold text-navy-950 shadow-sm hover:bg-ember-400"
              >
                <Plus className="h-3.5 w-3.5" />
                Book pregnancy
              </button>
            </div>

            {bookingOpen && (
              <form onSubmit={submitBooking} className="border-b border-hair p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className={labelClass}>Patient *</label>
                    <select
                      required
                      value={booking.patientId}
                      onChange={(event) =>
                        setBooking({ ...booking, patientId: event.target.value })
                      }
                      className={fieldClass}
                    >
                      <option value="">Select a registered patient</option>
                      {patients.map((patient) => (
                        <option key={patient.id} value={patient.id}>
                          {patientName(patient)} · {patient.mrn}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className={labelClass}>Booked on *</label>
                    <input
                      type="date"
                      required
                      value={booking.bookedAt}
                      onChange={(event) =>
                        setBooking({ ...booking, bookedAt: event.target.value })
                      }
                      className={fieldClass}
                    />
                  </div>

                  <div>
                    <label className={labelClass}>Last menstrual period</label>
                    <input
                      type="date"
                      value={booking.lmpDate}
                      onChange={(event) =>
                        setBooking({ ...booking, lmpDate: event.target.value })
                      }
                      className={fieldClass}
                    />
                  </div>

                  <div>
                    <label className={labelClass}>EDD</label>
                    <input
                      type="date"
                      value={booking.eddDate}
                      onChange={(event) =>
                        setBooking({ ...booking, eddDate: event.target.value })
                      }
                      className={fieldClass}
                    />
                    <p className="mt-1 text-2xs text-slate-500">
                      Leave blank with an LMP to derive it (LMP + 280 days).
                    </p>
                  </div>

                  <div>
                    <label className={labelClass}>EDD basis</label>
                    <select
                      value={booking.eddBasis}
                      onChange={(event) =>
                        setBooking({ ...booking, eddBasis: event.target.value })
                      }
                      className={fieldClass}
                    >
                      <option value="LMP">LMP</option>
                      <option value="Ultrasound">Ultrasound</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  {(['gravida', 'para', 'abortions'] as const).map((field) => (
                    <div key={field}>
                      <label className={`${labelClass} capitalize`}>{field}</label>
                      <input
                        type="number"
                        min={0}
                        value={booking[field]}
                        onChange={(event) =>
                          setBooking({ ...booking, [field]: event.target.value })
                        }
                        className={fieldClass}
                      />
                    </div>
                  ))}

                  <div className="sm:col-span-2">
                    <label className={labelClass}>Risk factors</label>
                    <textarea
                      rows={2}
                      value={booking.riskFactors}
                      onChange={(event) =>
                        setBooking({ ...booking, riskFactors: event.target.value })
                      }
                      className={fieldClass}
                      placeholder="Free text. Left blank if none were recorded."
                    />
                  </div>
                </div>

                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setBookingOpen(false)}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                  >
                    {busy ? 'Saving…' : 'Book pregnancy'}
                  </button>
                </div>
              </form>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/80 text-2xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Patient</th>
                    <th className="px-4 py-2.5 font-medium">Booked</th>
                    <th className="px-4 py-2.5 font-medium">EDD</th>
                    <th className="px-4 py-2.5 font-medium">Gestation</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pregnancies.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                        No pregnancies booked yet.
                      </td>
                    </tr>
                  )}
                  {pregnancies.map((pregnancy) => (
                    <tr key={pregnancy.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-slate-900">
                          {pregnancy.patient
                            ? patientName(pregnancy.patient)
                            : `Patient #${pregnancy.patientId}`}
                        </div>
                        <div className="font-mono text-2xs text-slate-500">
                          {pregnancy.patient?.mrn ?? ''}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-600">
                        {pregnancy.bookedAt}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-700">
                        {pregnancy.eddDate}
                        <span className="ml-1 text-2xs text-slate-400">
                          {pregnancy.eddBasis}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono">
                        {formatGestation(pregnancy.gestation)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={statusClass(pregnancy.status)}>
                          {pregnancy.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            void runAction(
                              () => refreshPregnancy(pregnancy.id),
                              'The pregnancy record could not be opened.',
                            )
                          }
                          className="rounded bg-teal-50 px-2 py-1 text-2xs font-semibold text-teal-800 hover:bg-teal-100"
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-hair bg-surface p-4">
            {!selectedPregnancy ? (
              <p className="text-sm text-slate-500">
                Select a pregnancy to see antenatal visits and record a new one.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="border-b border-slate-100 pb-3">
                  <h2 className="text-sm font-bold text-slate-900">
                    {patientName(selectedPregnancy.patient ?? {
                      firstName: `Patient #${selectedPregnancy.patientId}`,
                      lastName: '',
                    })}
                  </h2>
                  <p className="mt-1 text-xs text-slate-600">
                    EDD {selectedPregnancy.eddDate} ·{' '}
                    {formatGestation(selectedPregnancy.gestation)} ·{' '}
                    {selectedPregnancy.status}
                  </p>
                  <p className="mt-1 text-2xs text-slate-500">
                    G{selectedPregnancy.gravida ?? '—'} P
                    {selectedPregnancy.para ?? '—'} ·{' '}
                    {selectedPregnancy.ancVisits.length} visit
                    {selectedPregnancy.ancVisits.length === 1 ? '' : 's'}
                  </p>
                  {selectedPregnancy.riskFactors && (
                    <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-2xs text-amber-900">
                      Risk: {selectedPregnancy.riskFactors}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Antenatal visits
                  </h3>
                  {selectedPregnancy.status === 'Active' && (
                    <button
                      type="button"
                      onClick={() => setAncOpen((open) => !open)}
                      className="rounded-lg bg-teal-700 px-2.5 py-1 text-2xs font-semibold text-white hover:bg-teal-800"
                    >
                      {ancOpen ? 'Close form' : 'Record visit'}
                    </button>
                  )}
                </div>

                {ancOpen && (
                  <form onSubmit={submitAnc} className="space-y-2 rounded-lg border border-slate-200 p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Visit date *">
                        <input
                          type="date"
                          required
                          value={anc.visitDate}
                          onChange={(e) => setAnc({ ...anc, visitDate: e.target.value })}
                          className={fieldClass}
                        />
                      </Field>
                      <Field label="Visit no.">
                        <input
                          type="number"
                          min={1}
                          value={anc.visitNumber}
                          onChange={(e) => setAnc({ ...anc, visitNumber: e.target.value })}
                          className={fieldClass}
                        />
                      </Field>
                      <Field label="Weight (kg)">
                        <input type="number" step="0.1" value={anc.weightKg} onChange={(e) => setAnc({ ...anc, weightKg: e.target.value })} className={fieldClass} />
                      </Field>
                      <Field label="BP systolic">
                        <input type="number" value={anc.bpSystolic} onChange={(e) => setAnc({ ...anc, bpSystolic: e.target.value })} className={fieldClass} />
                      </Field>
                      <Field label="BP diastolic">
                        <input type="number" value={anc.bpDiastolic} onChange={(e) => setAnc({ ...anc, bpDiastolic: e.target.value })} className={fieldClass} />
                      </Field>
                      <Field label="Pulse">
                        <input type="number" value={anc.pulseBpm} onChange={(e) => setAnc({ ...anc, pulseBpm: e.target.value })} className={fieldClass} />
                      </Field>
                      <Field label="Fundal height (cm)">
                        <input type="number" step="0.1" value={anc.fundalHeightCm} onChange={(e) => setAnc({ ...anc, fundalHeightCm: e.target.value })} className={fieldClass} />
                      </Field>
                      <Field label="Fetal heart rate">
                        <input type="number" value={anc.fetalHeartRateBpm} onChange={(e) => setAnc({ ...anc, fetalHeartRateBpm: e.target.value })} className={fieldClass} />
                      </Field>
                      <Field label="Presentation">
                        <input type="text" value={anc.presentation} onChange={(e) => setAnc({ ...anc, presentation: e.target.value })} className={fieldClass} placeholder="Cephalic" />
                      </Field>
                      <Field label="Urine protein">
                        <select value={anc.urineProtein} onChange={(e) => setAnc({ ...anc, urineProtein: e.target.value })} className={fieldClass}>
                          <option value="">Not tested</option>
                          {['Negative', 'Trace', '+', '++', '+++'].map((v) => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Hb (g/dL)">
                        <input type="number" step="0.1" value={anc.haemoglobinGdl} onChange={(e) => setAnc({ ...anc, haemoglobinGdl: e.target.value })} className={fieldClass} />
                      </Field>
                      <Field label="TT dose">
                        <input type="number" min={1} max={5} value={anc.ttDose} onChange={(e) => setAnc({ ...anc, ttDose: e.target.value })} className={fieldClass} />
                      </Field>
                      <Field label="Next visit">
                        <input type="date" value={anc.nextVisitDate} onChange={(e) => setAnc({ ...anc, nextVisitDate: e.target.value })} className={fieldClass} />
                      </Field>
                    </div>

                    <Field label="Danger signs">
                      <textarea rows={2} value={anc.dangerSigns} onChange={(e) => setAnc({ ...anc, dangerSigns: e.target.value })} className={fieldClass} />
                    </Field>

                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                    >
                      {busy ? 'Saving…' : 'Save visit'}
                    </button>
                  </form>
                )}

                <ul className="space-y-2">
                  {selectedPregnancy.ancVisits.length === 0 && (
                    <li className="text-xs text-slate-500">
                      No antenatal visits recorded yet.
                    </li>
                  )}
                  {selectedPregnancy.ancVisits.map((visit) => (
                    <li key={visit.id} className="rounded-lg border border-slate-200 px-3 py-2">
                      <div className="flex items-baseline justify-between">
                        <span className="font-mono text-xs font-semibold text-slate-800">
                          {visit.visitDate}
                        </span>
                        <span className="text-2xs text-slate-500">
                          {visit.visitNumber ? `Visit ${visit.visitNumber}` : ''}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-slate-600">
                        <Reading label="Gest" value={visit.gestationWeeks !== null ? `${visit.gestationWeeks}w` : null} />
                        <Reading label="BP" value={visit.bpSystolic && visit.bpDiastolic ? `${visit.bpSystolic}/${visit.bpDiastolic}` : null} />
                        <Reading label="Fundal" value={visit.fundalHeightCm} />
                        <Reading label="FHR" value={visit.fetalHeartRateBpm} />
                        <Reading label="Hb" value={visit.haemoglobinGdl} />
                        <Reading label="Urine" value={visit.urineProtein} />
                      </div>
                      {visit.dangerSigns && (
                        <p className="mt-1 flex items-center gap-1 text-2xs text-rose-700">
                          <AlertTriangle className="h-3 w-3" />
                          {visit.dangerSigns}
                        </p>
                      )}
                      {visit.nextVisitDate && (
                        <p className="mt-1 text-2xs text-slate-500">
                          Next: {visit.nextVisitDate}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ---------------- LABOUR ---------------- */}
      {tab === 'labour' && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          <section className="overflow-hidden rounded-xl border border-hair bg-surface">
            <div className="flex items-center justify-between border-b border-hair bg-canvas px-4 py-3">
              <h2 className="text-sm font-bold text-slate-800">Labour ward</h2>
              <button
                type="button"
                onClick={() => setLabourOpen((open) => !open)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Admit
              </button>
            </div>

            {labourOpen && (
              <form onSubmit={submitLabour} className="space-y-2 border-b border-hair p-4">
                <Field label="Pregnancy *">
                  <select
                    required
                    value={labourForm.pregnancyId}
                    onChange={(e) => setLabourForm({ ...labourForm, pregnancyId: e.target.value })}
                    className={fieldClass}
                  >
                    <option value="">Select a booked pregnancy</option>
                    {activePregnancies.map((pregnancy) => (
                      <option key={pregnancy.id} value={pregnancy.id}>
                        {pregnancy.patient ? patientName(pregnancy.patient) : `#${pregnancy.patientId}`} · EDD {pregnancy.eddDate}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Admitted at">
                  <input type="datetime-local" value={labourForm.admittedAt} onChange={(e) => setLabourForm({ ...labourForm, admittedAt: e.target.value })} className={fieldClass} />
                </Field>
                <Field label="Labour onset">
                  <input type="datetime-local" value={labourForm.labourOnsetAt} onChange={(e) => setLabourForm({ ...labourForm, labourOnsetAt: e.target.value })} className={fieldClass} />
                </Field>
                <button type="submit" disabled={busy} className="w-full rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
                  {busy ? 'Saving…' : 'Open labour record'}
                </button>
              </form>
            )}

            <ul className="divide-y divide-slate-100">
              {labours.length === 0 && (
                <li className="px-4 py-6 text-center text-xs text-slate-500">
                  Nobody is in labour.
                </li>
              )}
              {labours.map((labour) => (
                <li key={labour.id}>
                  <button
                    type="button"
                    onClick={() =>
                      void runAction(
                        () => refreshLabour(labour.id),
                        'The labour record could not be opened.',
                      )
                    }
                    className={`w-full px-4 py-3 text-left hover:bg-slate-50 ${
                      selectedLabour?.id === labour.id ? 'bg-teal-50' : ''
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900">
                        {labour.patient ? patientName(labour.patient) : `Patient #${labour.patientId}`}
                      </span>
                      <span className={statusClass(labour.status)}>{labour.status}</span>
                    </div>
                    <div className="mt-1 font-mono text-2xs text-slate-500">
                      Admitted {labour.admittedAt.replace('T', ' ').slice(0, 16)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-hair bg-surface p-4">
            {!selectedLabour ? (
              <p className="text-sm text-slate-500">
                Select a woman in labour to see and extend the partograph.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      {selectedLabour.patient
                        ? patientName(selectedLabour.patient)
                        : `Labour #${selectedLabour.id}`}
                    </h2>
                    <p className="mt-1 font-mono text-2xs text-slate-500">
                      Admitted {selectedLabour.admittedAt.replace('T', ' ').slice(0, 16)}
                      {selectedLabour.labourOnsetAt
                        ? ` · onset ${selectedLabour.labourOnsetAt.replace('T', ' ').slice(0, 16)}`
                        : ''}
                    </p>
                  </div>
                  <span className={statusClass(selectedLabour.status)}>
                    {selectedLabour.status}
                  </span>
                </div>

                {selectedLabour.guidance && (
                  <div
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      selectedLabour.guidance.zone === 'Right of the action line'
                        ? 'border-rose-200 bg-rose-50 text-rose-900'
                        : selectedLabour.guidance.zone === 'Between the alert and action lines'
                          ? 'border-amber-200 bg-amber-50 text-amber-900'
                          : 'border-slate-200 bg-slate-50 text-slate-700'
                    }`}
                  >
                    <strong>{selectedLabour.guidance.zone}</strong>
                    {selectedLabour.guidance.hoursBeyondAlert !== null &&
                      selectedLabour.guidance.hoursBeyondAlert > 0 && (
                        <span className="ml-2">
                          {selectedLabour.guidance.hoursBeyondAlert}h beyond the alert line
                        </span>
                      )}
                    <p className="mt-1 text-2xs opacity-80">
                      {selectedLabour.guidance.note}
                    </p>
                  </div>
                )}

                {selectedLabour.status === 'In Labour' && (
                  <form onSubmit={submitPartograph} className="space-y-2 rounded-lg border border-slate-200 p-3">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <Field label="Reading time">
                        <input type="datetime-local" value={pg.recordedAt} onChange={(e) => setPg({ ...pg, recordedAt: e.target.value })} className={fieldClass} />
                      </Field>
                      <Field label="Dilatation (cm)">
                        <input type="number" step="0.5" min={0} max={10} value={pg.cervicalDilatationCm} onChange={(e) => setPg({ ...pg, cervicalDilatationCm: e.target.value })} className={fieldClass} />
                      </Field>
                      <Field label="Descent (−3…+3)">
                        <input type="number" min={-3} max={3} value={pg.descentStation} onChange={(e) => setPg({ ...pg, descentStation: e.target.value })} className={fieldClass} />
                      </Field>
                      <Field label="Contractions /10 min">
                        <input type="number" min={0} max={7} value={pg.contractionsPer10Min} onChange={(e) => setPg({ ...pg, contractionsPer10Min: e.target.value })} className={fieldClass} />
                      </Field>
                      <Field label="Duration (s)">
                        <input type="number" min={0} max={120} value={pg.contractionDurationSec} onChange={(e) => setPg({ ...pg, contractionDurationSec: e.target.value })} className={fieldClass} />
                      </Field>
                      <Field label="FHR">
                        <input type="number" value={pg.fetalHeartRateBpm} onChange={(e) => setPg({ ...pg, fetalHeartRateBpm: e.target.value })} className={fieldClass} />
                      </Field>
                      <Field label="Membranes">
                        <select value={pg.membranes} onChange={(e) => setPg({ ...pg, membranes: e.target.value })} className={fieldClass}>
                          <option value="">Not recorded</option>
                          <option value="Intact">Intact</option>
                          <option value="Ruptured">Ruptured</option>
                        </select>
                      </Field>
                      <Field label="Liquor">
                        <select value={pg.liquor} onChange={(e) => setPg({ ...pg, liquor: e.target.value })} className={fieldClass}>
                          <option value="">Not recorded</option>
                          {['Clear', 'Meconium I', 'Meconium II', 'Meconium III', 'Bloody', 'Absent'].map((v) => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Maternal pulse">
                        <input type="number" value={pg.maternalPulseBpm} onChange={(e) => setPg({ ...pg, maternalPulseBpm: e.target.value })} className={fieldClass} />
                      </Field>
                      <Field label="BP systolic">
                        <input type="number" value={pg.bpSystolic} onChange={(e) => setPg({ ...pg, bpSystolic: e.target.value })} className={fieldClass} />
                      </Field>
                      <Field label="BP diastolic">
                        <input type="number" value={pg.bpDiastolic} onChange={(e) => setPg({ ...pg, bpDiastolic: e.target.value })} className={fieldClass} />
                      </Field>
                      <Field label="Temp (°C)">
                        <input type="number" step="0.1" value={pg.temperatureC} onChange={(e) => setPg({ ...pg, temperatureC: e.target.value })} className={fieldClass} />
                      </Field>
                    </div>
                    <button type="submit" disabled={busy} className="w-full rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
                      {busy ? 'Saving…' : 'Add partograph reading'}
                    </button>
                  </form>
                )}

                {selectedLabour.plot && (
                  <PartographChart plot={selectedLabour.plot} />
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-2xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-2 py-2 font-medium">Time</th>
                        <th className="px-2 py-2 font-medium">Dilat.</th>
                        <th className="px-2 py-2 font-medium">Descent</th>
                        <th className="px-2 py-2 font-medium">Contr.</th>
                        <th className="px-2 py-2 font-medium">FHR</th>
                        <th className="px-2 py-2 font-medium">Liquor</th>
                        <th className="px-2 py-2 font-medium">BP</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      {(selectedLabour.entries ?? []).length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-2 py-4 text-center font-sans text-slate-500">
                            No partograph readings yet.
                          </td>
                        </tr>
                      )}
                      {(selectedLabour.entries ?? []).map((entry: PartographEntry) => (
                        <tr key={entry.id}>
                          <td className="px-2 py-1.5">{entry.recordedAt.replace('T', ' ').slice(5, 16)}</td>
                          <td className="px-2 py-1.5">{entry.cervicalDilatationCm ?? '—'}</td>
                          <td className="px-2 py-1.5">{entry.descentStation ?? '—'}</td>
                          <td className="px-2 py-1.5">
                            {entry.contractionsPer10Min ?? '—'}
                            {entry.contractionDurationSec ? `/${entry.contractionDurationSec}s` : ''}
                          </td>
                          <td className="px-2 py-1.5">{entry.fetalHeartRateBpm ?? '—'}</td>
                          <td className="px-2 py-1.5">{entry.liquor ?? '—'}</td>
                          <td className="px-2 py-1.5">
                            {entry.bpSystolic && entry.bpDiastolic ? `${entry.bpSystolic}/${entry.bpDiastolic}` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setDelivery((current) => ({
                      ...current,
                      pregnancyId: String(selectedLabour.pregnancyId),
                      labourRecordId: String(selectedLabour.id),
                    }));
                    setTab('deliveries');
                    setDeliveryOpen(true);
                  }}
                  className="w-full rounded-lg border border-teal-700 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-900 hover:bg-teal-100"
                >
                  Record the delivery for this labour →
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ---------------- DELIVERIES ---------------- */}
      {tab === 'deliveries' && (
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
            <form onSubmit={submitDelivery} className="space-y-3 rounded-xl border border-hair bg-surface p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Pregnancy *">
                  <select required value={delivery.pregnancyId} onChange={(e) => setDelivery({ ...delivery, pregnancyId: e.target.value })} className={fieldClass}>
                    <option value="">Select an active pregnancy</option>
                    {activePregnancies.map((pregnancy) => (
                      <option key={pregnancy.id} value={pregnancy.id}>
                        {pregnancy.patient ? patientName(pregnancy.patient) : `#${pregnancy.patientId}`} · EDD {pregnancy.eddDate}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Labour record (optional)">
                  <select value={delivery.labourRecordId} onChange={(e) => setDelivery({ ...delivery, labourRecordId: e.target.value })} className={fieldClass}>
                    <option value="">Not linked</option>
                    {inLabour.concat(labours.filter((l) => l.status === 'Delivered')).map((labour) => (
                      <option key={labour.id} value={labour.id}>
                        #{labour.id} · {labour.patient ? patientName(labour.patient) : 'patient'}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Delivered at">
                  <input type="datetime-local" value={delivery.deliveredAt} onChange={(e) => setDelivery({ ...delivery, deliveredAt: e.target.value })} className={fieldClass} />
                </Field>
                <Field label="Mode *">
                  <select value={delivery.deliveryMode} onChange={(e) => setDelivery({ ...delivery, deliveryMode: e.target.value })} className={fieldClass}>
                    {['Spontaneous Vertex', 'Assisted Vaginal', 'Breech', 'Vacuum', 'Forceps', 'Caesarean Section'].map((mode) => (
                      <option key={mode} value={mode}>{mode}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Blood loss (ml)">
                  <input type="number" min={0} value={delivery.bloodLossMl} onChange={(e) => setDelivery({ ...delivery, bloodLossMl: e.target.value })} className={fieldClass} />
                </Field>
                <Field label="Perineum">
                  <select value={delivery.perineum} onChange={(e) => setDelivery({ ...delivery, perineum: e.target.value })} className={fieldClass}>
                    <option value="">Not recorded</option>
                    {['Intact', '1st Degree', '2nd Degree', '3rd Degree', '4th Degree', 'Episiotomy'].map((state) => (
                      <option key={state} value={state}>{state}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Placenta complete">
                  <select value={delivery.placentaComplete} onChange={(e) => setDelivery({ ...delivery, placentaComplete: e.target.value })} className={fieldClass}>
                    <option value="">Not recorded</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                </Field>
                <Field label="Complications">
                  <input type="text" value={delivery.complications} onChange={(e) => setDelivery({ ...delivery, complications: e.target.value })} className={fieldClass} />
                </Field>
              </div>

              <div className="space-y-3 rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Babies
                  </h3>
                  {babies.length < 6 && (
                    <button
                      type="button"
                      onClick={() =>
                        setBabies((current) => [
                          ...current,
                          { outcome: 'Live Birth', sex: '', birthWeightGrams: '', apgar1: '', apgar5: '', resuscitation: '' },
                        ])
                      }
                      className="rounded border border-slate-300 px-2 py-1 text-2xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Add baby
                    </button>
                  )}
                </div>

                {babies.map((baby, index) => (
                  <div key={index} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <Field label={`Baby ${index + 1} outcome`}>
                      <select value={baby.outcome} onChange={(e) => setBabies(updateBaby(babies, setBabies, index, { outcome: e.target.value }))} className={fieldClass}>
                        {['Live Birth', 'Stillbirth Fresh', 'Stillbirth Macerated', 'Neonatal Death'].map((outcome) => (
                          <option key={outcome} value={outcome}>{outcome}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Sex">
                      <select value={baby.sex} onChange={(e) => setBabies(updateBaby(babies, setBabies, index, { sex: e.target.value }))} className={fieldClass}>
                        <option value="">Not recorded</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Ambiguous">Ambiguous</option>
                      </select>
                    </Field>
                    <Field label="Weight (g)">
                      <input type="number" value={baby.birthWeightGrams} onChange={(e) => setBabies(updateBaby(babies, setBabies, index, { birthWeightGrams: e.target.value }))} className={fieldClass} />
                    </Field>
                    <Field label="Apgar 1′">
                      <input type="number" min={0} max={10} value={baby.apgar1} onChange={(e) => setBabies(updateBaby(babies, setBabies, index, { apgar1: e.target.value }))} className={fieldClass} />
                    </Field>
                    <Field label="Apgar 5′">
                      <input type="number" min={0} max={10} value={baby.apgar5} onChange={(e) => setBabies(updateBaby(babies, setBabies, index, { apgar5: e.target.value }))} className={fieldClass} />
                    </Field>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setDeliveryOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={busy} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
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
                  {lastCharge.charge.totalAmount
                    ? ` · KES ${lastCharge.charge.totalAmount}`
                    : ''}
                  {lastCharge.charge.tariffCode
                    ? ` · tariff ${lastCharge.charge.tariffCode}`
                    : ''}
                  .
                </>
              ) : (
                <>
                  <strong>Recorded, not billed.</strong>{' '}
                  {lastCharge.charge.reason === 'TARIFF_NOT_CONFIGURED'
                    ? 'This facility has no active delivery tariff, so no invoice line was raised. Add one under Finance → Service tariffs; the delivery itself is saved.'
                    : lastCharge.charge.message ??
                      'The billing engine did not raise an invoice line.'}
                </>
              )}
            </div>
          )}

          <section className="overflow-hidden rounded-xl border border-hair bg-surface">
            <div className="border-b border-hair bg-canvas px-4 py-3">
              <h2 className="text-sm font-bold text-slate-800">Delivery register</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
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
                    const recordBabies = (record as DeliveryRecord & { babies?: Array<{ outcome: string }> }).babies ?? [];

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
              </table>
            </div>
          </section>
        </div>
      )}

      {/* ---------------- POSTNATAL ---------------- */}
      {tab === 'postnatal' && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
          <section className="overflow-hidden rounded-xl border border-hair bg-surface">
            <div className="flex items-center justify-between border-b border-hair bg-canvas px-4 py-3">
              <h2 className="text-sm font-bold text-slate-800">Postnatal contacts</h2>
              <span className="text-2xs text-slate-500">
                {postnatalRegister.length} recent
              </span>
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
                      {pregnancy.patient
                        ? patientName(pregnancy.patient)
                        : `#${pregnancy.patientId}`}{' '}
                      · {pregnancy.status} · EDD {pregnancy.eddDate}
                    </option>
                  ))}
                </select>
              </Field>

              <p className="mt-2 text-2xs leading-relaxed text-slate-500">
                Postnatal care is filed against the pregnancy, not the
                delivery, so a woman who delivered elsewhere still has a
                record here.
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
                      postnatalPregnancy?.id === visit.pregnancyId
                        ? 'bg-teal-50'
                        : ''
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900">
                        {visit.patient ? patientName(visit.patient) : `Patient #${visit.patientId}`}
                      </span>
                      <span className="font-mono text-2xs text-slate-500">
                        {visit.dayPostpartum !== null
                          ? `day ${visit.dayPostpartum}`
                          : 'day —'}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-2xs text-slate-500">
                      {visit.visitDate}
                      {visit.babyWeightGrams !== null
                        ? ` · baby ${visit.babyWeightGrams} g`
                        : ''}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-hair bg-surface p-4">
            {!postnatalPregnancy ? (
              <p className="text-sm text-slate-500">
                Select a mother on the left to see her postnatal contacts and
                record the next one.
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
                  <form
                    onSubmit={submitPostnatal}
                    className="space-y-2 rounded-lg border border-slate-200 p-3"
                  >
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
                            <option key={value} value={value}>{value}</option>
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
                            <option key={value} value={value}>{value}</option>
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
                            <option key={value} value={value}>{value}</option>
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
                            <option key={value} value={value}>{value}</option>
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
                            <option key={value} value={value}>{value}</option>
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
                            <option key={value} value={value}>{value}</option>
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
                          <td className="px-3 py-2 text-2xs text-slate-600">{visit.involution ?? '—'}</td>
                          <td className="px-3 py-2 text-2xs text-slate-600">{visit.lochia ?? '—'}</td>
                          <td className="px-3 py-2 text-2xs text-slate-600">{visit.breastfeeding ?? '—'}</td>
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
      )}

      {/* ---------------- IMMUNISATION ---------------- */}
      {tab === 'immunisation' && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
          <section className="overflow-hidden rounded-xl border border-hair bg-surface">
            <div className="flex items-center justify-between border-b border-hair bg-canvas px-4 py-3">
              <h2 className="text-sm font-bold text-slate-800">Doses outstanding</h2>
              <span className="text-2xs text-slate-500">
                {immunisationAsOf ? `as of ${immunisationAsOf}` : '—'}
              </span>
            </div>

            <div className="border-b border-hair p-4">
              <Field label="Open a child's card">
                <select
                  value={immunisationCard?.patient.id ?? ''}
                  onChange={(e) =>
                    void runAction(
                      () => loadImmunisationCard(Number(e.target.value)),
                      'The immunisation card could not be opened.',
                    )
                  }
                  className={fieldClass}
                >
                  <option value="">Select a child under five</option>
                  {patients.filter(isUnderFive).map((patient) => (
                    <option key={patient.id} value={patient.id}>
                      {patientName(patient)} · {patient.mrn} · {patient.dateOfBirth}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <ul className="divide-y divide-slate-100">
              {immunisationDue.length === 0 && (
                <li className="px-4 py-6 text-center text-xs text-slate-500">
                  No child at this facility has a dose due.
                </li>
              )}

              {immunisationDue.map((child) => (
                <li key={child.id}>
                  <button
                    type="button"
                    onClick={() =>
                      void runAction(
                        () => loadImmunisationCard(child.id),
                        'The immunisation card could not be opened.',
                      )
                    }
                    className={`w-full px-4 py-3 text-left hover:bg-slate-50 ${
                      immunisationCard?.patient.id === child.id ? 'bg-teal-50' : ''
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900">
                        {patientName(child)}
                      </span>
                      {child.overdueCount > 0 ? (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-2xs font-semibold text-rose-800">
                          {child.overdueCount} overdue
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-2xs font-semibold text-amber-900">
                          {child.outstandingCount} due
                        </span>
                      )}
                    </div>
                    <div className="mt-1 font-mono text-2xs text-slate-500">
                      {child.mrn} · born {child.dateOfBirth}
                      {child.nextDue ? ` · next ${child.nextDue.name}` : ''}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-hair bg-surface p-4">
            {!immunisationCard ? (
              <p className="text-sm text-slate-500">
                Select a child on the left to see the doses given and what the
                reference schedule says is outstanding.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      {patientName(immunisationCard.patient)}
                    </h2>
                    <p className="mt-1 font-mono text-2xs text-slate-500">
                      {immunisationCard.patient.mrn} · born{' '}
                      {immunisationCard.dateOfBirth ?? 'not recorded'}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setImmunisationOpen((open) => !open)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800"
                  >
                    <Syringe className="h-3.5 w-3.5" />
                    Record dose
                  </button>
                </div>

                {immunisationCard.dateOfBirth === null && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    {immunisationCard.note}
                  </div>
                )}

                {immunisationOpen && (
                  <form
                    onSubmit={submitImmunisation}
                    className="space-y-2 rounded-lg border border-slate-200 p-3"
                  >
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <Field label="Antigen *">
                        <select
                          required
                          value={imm.antigenCode}
                          onChange={(e) => setImm({ ...imm, antigenCode: e.target.value })}
                          className={fieldClass}
                        >
                          <option value="">Select an antigen</option>
                          {immunisationSchedule.map((antigen) => (
                            <option key={antigen.code} value={antigen.code}>
                              {antigen.name} · {antigen.weeks}w · {antigen.route}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Dose number">
                        <select
                          value={imm.doseNumber}
                          onChange={(e) => setImm({ ...imm, doseNumber: e.target.value })}
                          className={fieldClass}
                        >
                          {[1, 2, 3, 4].map((dose) => (
                            <option key={dose} value={dose}>{dose}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Date given *">
                        <input
                          required
                          type="date"
                          value={imm.administeredOn}
                          onChange={(e) => setImm({ ...imm, administeredOn: e.target.value })}
                          className={fieldClass}
                        />
                      </Field>
                      <Field label="Batch">
                        <input
                          type="text"
                          value={imm.batchNumber}
                          onChange={(e) => setImm({ ...imm, batchNumber: e.target.value })}
                          className={fieldClass}
                        />
                      </Field>
                      <Field label="Site">
                        <input
                          type="text"
                          value={imm.site}
                          onChange={(e) => setImm({ ...imm, site: e.target.value })}
                          className={fieldClass}
                          placeholder="e.g. Left thigh"
                        />
                      </Field>
                      <Field label="Notes">
                        <input
                          type="text"
                          value={imm.notes}
                          onChange={(e) => setImm({ ...imm, notes: e.target.value })}
                          className={fieldClass}
                        />
                      </Field>
                    </div>

                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                    >
                      {busy ? 'Saving…' : 'Record dose'}
                    </button>

                    <p className="text-2xs text-slate-500">
                      The database refuses a second dose of the same antigen at
                      the same dose number.
                    </p>
                  </form>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-2xs uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Antigen</th>
                        <th className="px-3 py-2 font-medium">Scheduled</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">Given on</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {immunisationCard.statuses.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                            Due dates need a date of birth. Doses can still be
                            recorded below.
                          </td>
                        </tr>
                      )}

                      {immunisationCard.statuses.map((dose) => (
                        <tr key={dose.antigenCode} className="hover:bg-slate-50/70">
                          <td className="px-3 py-2">
                            <span className="font-semibold text-slate-800">{dose.name}</span>
                            {dose.note && (
                              <span className="ml-1.5 text-2xs text-slate-500">{dose.note}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-2xs text-slate-600">
                            week {dose.scheduledWeeks}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`rounded-full px-2 py-0.5 text-2xs font-semibold ${doseStatusClass(dose.status)}`}>
                              {dose.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-2xs text-slate-600">
                            {dose.givenOn ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-2xs uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Given</th>
                        <th className="px-3 py-2 font-medium">Antigen</th>
                        <th className="px-3 py-2 font-medium">Dose</th>
                        <th className="px-3 py-2 font-medium">Batch</th>
                        <th className="px-3 py-2 font-medium">Site</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {immunisationCard.records.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                            No doses recorded for this child yet.
                          </td>
                        </tr>
                      )}

                      {immunisationCard.records.map((record) => (
                        <tr key={record.id} className="hover:bg-slate-50/70">
                          <td className="px-3 py-2 font-mono text-slate-700">{record.administeredOn}</td>
                          <td className="px-3 py-2 font-semibold text-slate-800">{record.antigenCode}</td>
                          <td className="px-3 py-2 font-mono">{record.doseNumber}</td>
                          <td className="px-3 py-2 font-mono text-2xs text-slate-600">{record.batchNumber ?? '—'}</td>
                          <td className="px-3 py-2 text-2xs text-slate-600">{record.site ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-2xs leading-relaxed text-slate-500">
                  {immunisationNote}
                </p>
              </div>
            )}
          </section>
        </div>
      )}

      <p className="text-2xs text-slate-500">
        <ClipboardList className="mr-1 inline h-3 w-3" />
        Empty fields are stored as absent, not as zero. The partograph line is a
        plotting aid against the reference curve; it does not recommend an
        intervention.
      </p>
    </div>
  );
};

/* ============================================================
   PRESENTATION HELPERS
   ============================================================ */

function updateBaby(
  babies: Array<{
    outcome: string;
    sex: string;
    birthWeightGrams: string;
    apgar1: string;
    apgar5: string;
    resuscitation: string;
  }>,
  setBabies: React.Dispatch<React.SetStateAction<typeof babies>>,
  index: number,
  patch: Partial<(typeof babies)[number]>,
) {
  return babies.map((baby, position) =>
    position === index ? { ...baby, ...patch } : baby,
  );
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div>
    <label className={labelClass}>{label}</label>
    {children}
  </div>
);

const Reading: React.FC<{ label: string; value: string | number | null }> = ({
  label,
  value,
}) => (
  <span>
    <span className="text-slate-400">{label} </span>
    <span className="font-mono text-slate-700">
      {value === null || value === '' ? '—' : value}
    </span>
  </span>
);

const SummaryChip: React.FC<{
  label: string;
  value?: number;
  tone?: 'brand' | 'ember';
}> = ({ label, value, tone }) => (
  <span
    className={`rounded-lg border px-2.5 py-1.5 text-2xs ${
      tone === 'brand'
        ? 'border-brand-200 bg-brand-50 text-brand-900'
        : tone === 'ember'
          ? 'border-ember-300 bg-ember-50 text-ember-900'
          : 'border-hair bg-surface text-ink'
    }`}
  >
    <span className="block font-semibold uppercase tracking-wider">{label}</span>
    <span className="font-mono text-sm font-bold">
      {value === undefined ? '—' : value}
    </span>
  </span>
);

function statusClass(status: string): string {
  const base = 'rounded px-2 py-0.5 text-2xs font-semibold';

  if (status === 'Active' || status === 'In Labour') {
    return `${base} bg-teal-50 text-teal-900 border border-teal-200`;
  }

  if (status === 'Delivered') {
    return `${base} bg-emerald-50 text-emerald-800 border border-emerald-200`;
  }

  if (status === 'Referred' || status === 'Transferred') {
    return `${base} bg-amber-50 text-amber-900 border border-amber-200`;
  }

  return `${base} bg-slate-100 text-slate-700`;
}
