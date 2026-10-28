import { API_BASE, fetchJson, type ServiceCharge } from './http.ts';

export interface MaternityPatientRef {
  id: number;
  mrn: string | null;
  firstName: string;
  lastName: string;
  dateOfBirth?: string | null;
}

export interface GestationSummary {
  totalDays: number;
  weeks: number;
  days: number;
}

export interface MaternityPregnancy {
  id: number;
  tenantId: number;
  facilityId: number;
  patientId: number;
  bookedAt: string;
  lmpDate: string | null;
  eddDate: string;
  eddBasis: string;
  gravida: number | null;
  para: number | null;
  abortions: number | null;
  livingChildren: number | null;
  heightCm: string | null;
  bloodGroup: string | null;
  rhesus: string | null;
  haemoglobinGdl: string | null;
  riskFactors: string | null;
  status: string;
  closedAt: string | null;
  closedReason: string | null;
  createdAt: string;
  updatedAt: string;
  patient?: MaternityPatientRef;
  gestation?: GestationSummary | null;
  weeksToEdd?: number;
}

export interface AncVisit {
  id: number;
  pregnancyId: number;
  visitDate: string;
  visitNumber: number | null;
  gestationWeeks: number | null;
  gestationDays: number | null;
  weightKg: string | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  pulseBpm: number | null;
  temperatureC: string | null;
  fundalHeightCm: string | null;
  fetalHeartRateBpm: number | null;
  presentation: string | null;
  fetalMovements: string | null;
  urineProtein: string | null;
  urineGlucose: string | null;
  haemoglobinGdl: string | null;
  ttDose: number | null;
  ifasDispensed: boolean;
  dangerSigns: string | null;
  notes: string | null;
  nextVisitDate: string | null;
}

export interface PartographEntry {
  id: number;
  labourRecordId: number;
  recordedAt: string;
  cervicalDilatationCm: string | null;
  descentStation: number | null;
  contractionsPer10Min: number | null;
  contractionDurationSec: number | null;
  fetalHeartRateBpm: number | null;
  membranes: string | null;
  liquor: string | null;
  maternalPulseBpm: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  temperatureC: string | null;
  oxytocin: string | null;
  drugsGiven: string | null;
  notes: string | null;
}

export interface PartographGuidance {
  zone: string;
  hoursSinceFourCm: number | null;
  dilatationCm: number | null;
  hoursBeyondAlert: number | null;
  note: string;
}

export interface PlottedReading {
  recordedAt: string;
  hoursSinceAdmission: number;
  dilatationCm: number | null;
  fetalHeartRateBpm: number | null;
  contractionsPer10Min: number | null;
  contractionDurationSec: number | null;
}

export interface PartographLine {
  startHour: number;
  endHour: number;
  startCm: number;
  endCm: number;
}

export interface PartographPlot {
  readings: PlottedReading[];
  alertLine: PartographLine | null;
  actionLine: PartographLine | null;
  maxHour: number;
  zone: string;
  note: string;
}

export interface LabourRecord {
  id: number;
  pregnancyId: number;
  patientId: number;
  facilityId: number;
  admittedAt: string;
  labourOnsetAt: string | null;
  membranesRupturedAt: string | null;
  gestationWeeksAtAdmission: number | null;
  status: string;
  notes: string | null;
  patient?: MaternityPatientRef;
  pregnancy?: MaternityPregnancy;
  entries?: PartographEntry[];
  guidance?: PartographGuidance;
  plot?: PartographPlot;
}

export interface DeliveryBaby {
  id: number;
  deliveryId: number;
  babyNumber: number;
  sex: string | null;
  birthWeightGrams: number | null;
  apgar1: number | null;
  apgar5: number | null;
  apgar10: number | null;
  outcome: string;
  resuscitation: string | null;
  notes: string | null;
}

export interface DeliveryRecord {
  id: number;
  pregnancyId: number;
  patientId: number;
  facilityId: number;
  deliveredAt: string;
  deliveryMode: string;
  bloodLossMl: number | null;
  perineum: string | null;
  placentaComplete: boolean | null;
  placentaDeliveredAt: string | null;
  oxytocinGiven: boolean;
  complications: string | null;
  notes: string | null;
  conductedByCadre: string | null;
  patient?: MaternityPatientRef;
  babies?: DeliveryBaby[];
}

export interface MaternitySummary {
  facilityId: number;
  asOf: string;
  activePregnancies: number;
  ancVisitsThisMonth: number;
  inLabour: number;
  deliveriesThisMonth: number;
  babiesThisMonth: number;
}

export interface MaternityPregnancyDetail extends MaternityPregnancy {
  ancVisits: AncVisit[];
  labours: LabourRecord[];
  deliveries: Array<DeliveryRecord & { babies: DeliveryBaby[] }>;
}

export interface PostnatalVisit {
  id: number;
  pregnancyId: number;
  patientId: number;
  facilityId: number;
  deliveryId: number | null;
  visitDate: string;
  visitNumber: number | null;
  dayPostpartum: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  pulseBpm: number | null;
  temperatureC: string | null;
  fundalHeightCm: string | null;
  involution: string | null;
  lochia: string | null;
  perineum: string | null;
  breasts: string | null;
  breastfeeding: string | null;
  moodScreening: string | null;
  haemoglobinGdl: string | null;
  dangerSigns: string | null;
  notes: string | null;
  nextVisitDate: string | null;
  babyWeightGrams: number | null;
  babyNotes: string | null;
  patient?: MaternityPatientRef;
}

export interface ImmunisationRecord {
  id: number;
  patientId: number;
  facilityId: number;
  antigenCode: string;
  doseNumber: number;
  administeredOn: string;
  batchNumber: string | null;
  site: string | null;
  route: string | null;
  notes: string | null;
}

export interface ImmunisationAntigen {
  code: string;
  name: string;
  weeks: number;
  doses: number;
  route: string;
  note?: string;
}

export interface ImmunisationDoseStatus {
  antigenCode: string;
  name: string;
  scheduledWeeks: number;
  route: string;
  note?: string;
  givenOn: string | null;
  status: 'Given' | 'Due' | 'Overdue' | 'Not yet due';
}

export interface ImmunisationCard {
  patient: MaternityPatientRef & { dateOfBirth?: string | null };
  dateOfBirth: string | null;
  records: ImmunisationRecord[];
  statuses: ImmunisationDoseStatus[];
  outstanding: ImmunisationDoseStatus[];
  note: string;
}

export interface ImmunisationDueRow {
  id: number;
  mrn: string | null;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  outstandingCount: number;
  overdueCount: number;
  nextDue: {
    antigenCode: string;
    name: string;
    status: string;
    scheduledWeeks: number;
  } | null;
}

export const maternityClient = {
  getMaternitySummary: (facilityId?: number) =>
    fetchJson<MaternitySummary>(
      `${API_BASE}/maternity/summary${facilityId ? `?facilityId=${facilityId}` : ''}`,
    ),

  getPregnancies: (
    params: {
      facilityId?: number;
      patientId?: number;
      status?: string;
    } = {},
  ) => {
    const query = new URLSearchParams();

    if (params.facilityId) query.set('facilityId', String(params.facilityId));
    if (params.patientId) query.set('patientId', String(params.patientId));
    if (params.status) query.set('status', params.status);

    const suffix = query.toString();

    return fetchJson<MaternityPregnancy[]>(
      `${API_BASE}/maternity/pregnancies${suffix ? `?${suffix}` : ''}`,
    );
  },

  getPregnancy: (pregnancyId: number) =>
    fetchJson<MaternityPregnancyDetail>(`${API_BASE}/maternity/pregnancies/${pregnancyId}`),

  bookPregnancy: (payload: Record<string, unknown>) =>
    fetchJson<MaternityPregnancy>(`${API_BASE}/maternity/pregnancies`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updatePregnancy: (pregnancyId: number, payload: Record<string, unknown>) =>
    fetchJson<MaternityPregnancy>(`${API_BASE}/maternity/pregnancies/${pregnancyId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  getAncVisits: (pregnancyId: number) =>
    fetchJson<AncVisit[]>(`${API_BASE}/maternity/pregnancies/${pregnancyId}/anc-visits`),

  recordAncVisit: (payload: Record<string, unknown>) =>
    fetchJson<AncVisit>(`${API_BASE}/maternity/anc-visits`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getLabours: (params: { facilityId?: number; status?: string } = {}) => {
    const query = new URLSearchParams();

    if (params.facilityId) query.set('facilityId', String(params.facilityId));
    if (params.status) query.set('status', params.status);

    const suffix = query.toString();

    return fetchJson<LabourRecord[]>(`${API_BASE}/maternity/labours${suffix ? `?${suffix}` : ''}`);
  },

  getLabour: (labourRecordId: number) =>
    fetchJson<LabourRecord>(`${API_BASE}/maternity/labours/${labourRecordId}`),

  startLabour: (payload: Record<string, unknown>) =>
    fetchJson<LabourRecord>(`${API_BASE}/maternity/labours`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateLabour: (labourRecordId: number, payload: Record<string, unknown>) =>
    fetchJson<LabourRecord>(`${API_BASE}/maternity/labours/${labourRecordId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  recordPartograph: (payload: Record<string, unknown>) =>
    fetchJson<PartographEntry>(`${API_BASE}/maternity/partograph`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getDeliveries: (
    params: {
      facilityId?: number;
      from?: string;
      to?: string;
    } = {},
  ) => {
    const query = new URLSearchParams();

    if (params.facilityId) query.set('facilityId', String(params.facilityId));
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);

    const suffix = query.toString();

    return fetchJson<DeliveryRecord[]>(
      `${API_BASE}/maternity/deliveries${suffix ? `?${suffix}` : ''}`,
    );
  },

  recordDelivery: (payload: Record<string, unknown>) =>
    fetchJson<{
      delivery: DeliveryRecord;
      babies: DeliveryBaby[];
      pregnancy: MaternityPregnancy;
      billing?: ServiceCharge | null;
    }>(`${API_BASE}/maternity/deliveries`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getDelivery: (deliveryId: number) =>
    fetchJson<DeliveryRecord & { babies: DeliveryBaby[] }>(
      `${API_BASE}/maternity/deliveries/${deliveryId}`,
    ),

  getPostnatalVisits: (pregnancyId: number) =>
    fetchJson<PostnatalVisit[]>(`${API_BASE}/maternity/pregnancies/${pregnancyId}/postnatal`),

  getPostnatalRegister: (facilityId?: number) =>
    fetchJson<PostnatalVisit[]>(
      `${API_BASE}/maternity/postnatal${facilityId ? `?facilityId=${facilityId}` : ''}`,
    ),

  recordPostnatalVisit: (payload: Record<string, unknown>) =>
    fetchJson<PostnatalVisit>(`${API_BASE}/maternity/postnatal`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getImmunisationSchedule: () =>
    fetchJson<{ antigens: ImmunisationAntigen[]; note: string }>(
      `${API_BASE}/immunisation/schedule`,
    ),

  getImmunisationCard: (patientId: number) =>
    fetchJson<ImmunisationCard>(`${API_BASE}/immunisation/card?patientId=${patientId}`),

  getImmunisationRecords: (patientId: number) =>
    fetchJson<ImmunisationRecord[]>(`${API_BASE}/immunisation/records?patientId=${patientId}`),

  recordImmunisation: (payload: Record<string, unknown>) =>
    fetchJson<ImmunisationRecord>(`${API_BASE}/immunisation/records`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getImmunisationDueList: (facilityId?: number) =>
    fetchJson<{
      asOf: string;
      children: ImmunisationDueRow[];
      note: string;
    }>(`${API_BASE}/immunisation/due${facilityId ? `?facilityId=${facilityId}` : ''}`),
};
