export interface Tenant {
  id: number;
  name: string;
  slug: string;
  domain?: string;
  logoUrl?: string;
  brandColor: string;
  contactEmail?: string;
  contactPhone?: string;
  currency: string;
  timezone: string;
  settings?: any;
  isActive: boolean;
  createdAt: string;
}

export interface Facility {
  id: number;
  tenantId: number;
  code: string;
  name: string;
  level: string;
  county: string;
  subCounty: string;
  mflCode: string;
  address?: string;
  phone?: string;
  email?: string;
  enabledModules: string[];
  createdAt: string;
}

export interface Department {
  id: number;
  facilityId: number;
  name: string;
  code: string;
  type: string;
  isActive: boolean;
}

export interface Patient {
  id: number;
  tenantId: number;
  facilityId: number;
  mrn: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth: string;
  gender: string;
  phone?: string | null;
  email?: string | null;
  nationalId?: string | null;
  shaNumber?: string | null;
  bloodGroup?: string | null;
  guardianName?: string | null;
  guardianRelationship?: string | null;
  guardianPhone?: string | null;
  guardianShaNumber?: string | null;
  maritalStatus?: string;
  occupation?: string;
  county?: string;
  subCounty?: string;
  residentialAddress?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelationship?: string;
  allergies?: string;
  chronicConditions?: string;
  payerType: string;
  insuranceProvider?: string;
  policyNumber?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Encounter {
  id: number;
  tenantId: number;
  facilityId: number;
  patientId: number;
  practitionerId?: number;
  encounterType: string;
  departmentId?: number;
  status: string;
  triageCategory: string;
  chiefComplaint?: string;
  historyOfPresentIllness?: string;
  physicalExamination?: string;
  clinicalNotes?: string;
  followUpDate?: string;
  referralFacility?: string;
  startedAt: string;
  endedAt?: string;
}

export interface QueueItem {
  id: number;
  tenantId: number;
  facilityId: number;
  patientId: number;
  encounterId?: number;
  queueType: string;
  tokenNumber: string;
  priority: string;
  status: string;
  waitingTimeMinutes: number;
  createdAt: string;
}

export interface Appointment {
  id: number;
  tenantId: number;
  facilityId: number;
  patientId: number;
  practitionerId?: number;
  departmentId?: number;
  scheduledTime: string;
  durationMinutes: number;
  appointmentType: string;
  status: string;
  reason?: string;
  notes?: string;
  createdAt: string;
}

export interface Observation {
  id: number;
  encounterId: number;
  patientId: number;
  systolicBp?: number;
  diastolicBp?: number;
  pulseRate?: number;
  temperatureC?: string;
  respiratoryRate?: number;
  spo2Percent?: number;
  weightKg?: string;
  heightCm?: string;
  bmi?: string;
  bloodGlucoseMmol?: string;
  recordedBy?: string;
  recordedAt: string;
}

export interface Diagnosis {
  id: number;
  encounterId: number;
  patientId: number;
  icd10Code: string;
  icd10Description: string;
  diagnosisType: string;
  status: string;
  notes?: string;
  diagnosedBy?: string;
  diagnosedAt: string;
}

export interface Procedure {
  id: number;
  encounterId: number;
  patientId: number;
  procedureCode: string;
  procedureName: string;
  departmentId?: number;
  category: string;
  cost: string;
  status: string;
  performedBy?: string;
  notes?: string;
  performedAt: string;
}

export interface Medication {
  id: number;
  encounterId: number;
  patientId: number;
  drugId?: number;
  drugName: string;
  dosage: string;
  frequency: string;
  duration: string;
  route: string;
  instructions?: string;
  quantity: number;
  unitPrice: string;
  status: string;
  prescribedBy?: string;
  prescribedAt: string;
}

export interface Ward {
  id: number;
  facilityId: number;
  name: string;
  code: string;
  wardType: string;
  genderAllocation: string;
  totalBeds: number;
  dailyRate: string;
  isActive: boolean;
}

export interface Bed {
  id: number;
  wardId: number;
  bedNumber: string;
  bedType: string;
  status: string; // Available, Occupied, Maintenance, Cleaning, Reserved
  dailyCharge: string;
  currentPatientId?: number | null;
}

export interface Admission {
  id: number;
  tenantId: number;
  facilityId: number;
  patientId: number;
  encounterId?: number;
  wardId: number;
  bedId: number;
  admissionDate: string;
  admissionType: string;
  admittingDoctor?: string;
  provisionalDiagnosis?: string;
  nursingNotes?: string;
  status: string;
  dischargeDate?: string;
  dischargeType?: string;
  dischargeSummary?: string;
  createdAt: string;
}

export interface VitalFlag {
  field: string;
  label: string;
  value: number;
  severity: 'warning' | 'critical';
  direction: 'low' | 'high';
}

export interface VitalObservation {
  id: number;
  encounterId: number;
  patientId: number;
  systolicBp?: number | null;
  diastolicBp?: number | null;
  pulseRate?: number | null;
  temperatureC?: string | null;
  respiratoryRate?: number | null;
  spo2Percent?: number | null;
  weightKg?: string | null;
  heightCm?: string | null;
  bmi?: string | null;
  bloodGlucoseMmol?: string | null;
  recordedBy?: string | null;
  recordedAt: string;
  flags?: VitalFlag[];
}

export interface InpatientBoardRow {
  admissionId: number;
  patientId: number;
  patientName: string;
  patientMrn: string | null;
  wardId: number;
  wardName: string;
  bedId: number;
  bedNumber: string;
  admissionDate: string;
  admissionType: string | null;
  admittingDoctor: string | null;
  provisionalDiagnosis: string | null;
  lastVitalsAt: string | null;
  lastVitalsFlags: VitalFlag[];
  vitalsOverdue: boolean;
  hoursSinceVitals: number | null;
  notesToday: number;
  lastNoteAt: string | null;
  lastNoteShift: string | null;
}

export interface InpatientBoard {
  facilityId: number;
  generatedAt: string;
  shift: 'Morning' | 'Afternoon' | 'Night';
  wardCount: number;
  bedCount: number;
  occupiedBeds: number;
  availableBeds: number;
  cleaningBeds: number;
  occupancyRate: number;
  admissionCount: number;
  vitalsOverdueCount: number;
  criticalVitalsCount: number;
  notesTodayCount: number;
  rows: InpatientBoardRow[];
}

export interface NursingNote {
  id: number;
  tenantId: number;
  facilityId: number;
  patientId: number;
  admissionId?: number | null;
  encounterId?: number | null;
  noteType: string;
  shift?: string | null;
  note: string;
  recordedBy: string;
  recordedAt: string;
}

export interface ShiftHandoverGroup {
  shift: 'Morning' | 'Afternoon' | 'Night';
  noteCount: number;
  notes: Array<{
    id: number;
    patientId: number;
    admissionId: number | null;
    noteType: string;
    note: string;
    recordedBy: string;
    recordedAt: string;
    shift: string | null;
  }>;
}

export interface ShiftHandover {
  date: string;
  groups: ShiftHandoverGroup[];
  total: number;
}

export interface TheatreCase {
  id: number;
  tenantId: number;
  facilityId: number;
  patientId: number;
  procedureName: string;
  theatreRoom: string;
  theatreType: string;
  leadSurgeon: string;
  anaesthetist?: string;
  scrubNurse?: string;
  scheduledStart: string;
  scheduledEnd?: string;
  preOpChecklist?: any;
  postOpNotes?: string;
  status: string;
  createdAt: string;
}

export interface LabTest {
  id: number;
  facilityId: number;
  code: string;
  name: string;
  category: string;
  specimenType: string;
  referenceRanges?: string;
  turnaroundHours: number;
  price: string;
  isActive: boolean;
}

export interface LabOrder {
  id: number;
  tenantId: number;
  facilityId: number;
  patientId: number;
  encounterId?: number;
  testId?: number;
  testName: string;
  status: string;
  clinicalIndication?: string | null;
  specimenType?: string | null;
  priority?: string | null;
  clinicalNotes?: string | null;
  sampleCollectedAt?: string;
  sampleAccessionNumber?: string;
  orderedBy?: string;
  orderedAt: string;
}

export interface LabResult {
  id: number;
  orderId: number;
  patientId: number;
  parameterName: string;
  measuredValue: string;
  unit?: string;
  referenceRange?: string;
  flag: string;
  notes?: string;
  status: string;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
}

export interface RadiologyOrder {
  id: number;
  tenantId: number;
  facilityId: number;
  patientId: number;
  encounterId?: number;
  modality: string;
  procedureName: string;
  clinicalIndication?: string;
  status: string;
  radiologistFindings?: string;
  impression?: string;
  attachmentUrl?: string;
  orderedBy?: string;
  reportedBy?: string;
  reportedAt?: string;
  createdAt: string;
}

export interface InventoryItem {
  id: number;
  facilityId: number;
  itemCode: string;
  name: string;
  genericName?: string;
  category: string;
  unit: string;
  strength?: string;
  dosageForm?: string;
  currentStock: number;
  reorderLevel: number;
  unitCost: string;
  sellingPrice: string;
  storeLocation: string;
  isActive: boolean;
}

export interface Supplier {
  id: number;
  tenantId: number;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  kraPin?: string;
  address?: string;
  isActive: boolean;
}

export interface PurchaseOrder {
  id: number;
  tenantId: number;
  facilityId: number;
  supplierId: number;
  poNumber: string;
  totalAmount: string;
  status: string;
  orderedBy?: string;
  approvedBy?: string;
  createdAt: string;
}

export interface BillingInvoice {
  id: number;
  tenantId: number;
  facilityId: number;
  patientId: number;
  encounterId?: number;
  invoiceNumber: string;
  totalAmount: string;
  paidAmount: string;
  balanceAmount: string;
  status: string;
  payerType: string;
  payerName?: string;
  memberNumber?: string;
  createdAt: string;
}

export interface BillingItem {
  id: number;
  invoiceId: number;
  itemType: string;
  description: string;
  quantity: number;
  unitPrice: string;
  totalAmount: string;
  tariffId?: number | null;
  tariffCode?: string | null;
}

export interface ServiceTariff {
  id: number;
  tenantId: number;
  facilityId: number;
  code: string;
  description: string;
  department: string;
  unit: string;
  fee: string;
  shaStatus: string;
  shaNotes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BillingPayment {
  id: number;
  invoiceId: number;
  receiptNumber: string;
  paymentMethod: string;
  amount: string;
  referenceCode?: string;
  cashierName: string;
  paymentDate: string;
}

export interface InsuranceClaim {
  id: number;
  tenantId: number;
  facilityId: number;
  patientId: number;
  invoiceId: number;
  claimNumber: string;
  payerName: string;
  policyNumber?: string;
  preAuthCode?: string;
  claimAmount: string;
  approvedAmount: string;
  status: string;
  submittedAt?: string;
  adjudicationNotes?: string;
}

export interface PublicHealthReport {
  id: number;
  facilityId: number;
  diseaseCode: string;
  diseaseName: string;
  casesCount: number;
  mortalityCount: number;
  ageGroup: string;
  epiWeek: string;
  reportedAt: string;
}

export interface AuditLog {
  id: number;
  tenantId?: number;
  facilityId?: number;
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: string;
  ipAddress?: string;
  timestamp: string;
}

export interface AnalyticsSummary {
  totalPatients: number;
  activeQueuesCount: number;
  currentAdmissions: number;
  bedOccupancyRate: number;
  scheduledSurgeries: number;
  pendingLabOrders: number;
  totalRevenueKes: number;
  outstandingBillsKes: number;
  lowStockAlerts: number;
}

/* ============================================================
   REPORTING — REVENUE, OCCUPANCY AND LENGTH OF STAY
   ============================================================ */

export interface RevenueServiceRow {
  itemType: string;
  sourceType: string | null;
  lineCount: number;
  revenue: string;
}

export interface RevenueTotals {
  invoiceCount: number;
  voidedCount: number;
  invoiced: string;
  collected: string;
  outstanding: string;
}

export interface RevenueReport {
  facilityId: number;
  from: string | null;
  to: string | null;
  totalRevenue: string;
  totals: RevenueTotals;
  byService: RevenueServiceRow[];
}

export interface WardOccupancyRow {
  wardId: number;
  wardName: string;
  wardType: string | null;
  totalBeds: number;
  occupiedBeds: number;
  availableBeds: number;
  cleaningBeds: number;
  outOfServiceBeds: number;
  occupancyRate: number;
  activeAdmissions: number;
  averageStayDays: number | null;
}

export interface StayBucket {
  label: string;
  min: number;
  max: number | null;
  count: number;
}

export interface LengthOfStaySummary {
  activeAdmissions: number;
  averageStayDays: number | null;
  medianStayDays: number | null;
  longestStayDays: number | null;
  overstayCount: number;
  unparseableCount: number;
  dischargedInWindow: number;
  averageDischargedStayDays: number | null;
  medianDischargedStayDays: number | null;
  dischargedWindowDays: number;
  buckets: StayBucket[];
}

export interface LongestStayRow {
  admissionId: number;
  patientId: number;
  patientName: string;
  wardName: string;
  bedNumber: string | null;
  admissionDate: string;
  days: number;
}

export interface OperationsReport {
  facilityId: number;
  generatedAt: string;
  occupancy: {
    wardCount: number;
    bedCount: number;
    occupiedBeds: number;
    availableBeds: number;
    cleaningBeds: number;
    outOfServiceBeds: number;
    occupancyRate: number;
  };
  wards: WardOccupancyRow[];
  lengthOfStay: LengthOfStaySummary;
  longestStays: LongestStayRow[];
}

export interface OccupancyTrendResponse {
  facilityId: number;
  days: number;
  points: Array<{ date: string; occupiedBeds: number }>;
}
