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
  hiddenModules?: string[];
  clinicalProtocols?: Record<string, unknown>;
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
  icd10Code: string | null;
  icd10Description: string | null;
  codingSystem?: 'ICD-10' | 'ICD-11';
  diagnosisCode?: string | null;
  diagnosisDisplay?: string | null;
  icd11Code?: string | null;
  icd11Title?: string | null;
  icd11Release?: string | null;
  icd11FoundationUri?: string | null;
  icd11LinearizationUri?: string | null;
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
  /** Counted from the beds in the ward, not typed in. */
  totalBeds: number;
  /** NULL when the facility has not set a rate. Never a guess. */
  dailyRate: string | null;
  isActive: boolean;
}

export interface Bed {
  id: number;
  wardId: number;
  bedNumber: string;
  bedType: string;
  status: string; // Available, Occupied, Maintenance, Cleaning, Reserved
  /** NULL when the facility has not set a charge. Never a guess. */
  dailyCharge: string | null;
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
  /** Money received beyond the total, held as patient credit. */
  creditBalance?: string;
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
  /**
   * The automatic charge this tariff answers (`CONSULTATION`,
   * `LABORATORY:LAB-CBC`, …), or null when the tariff is only reachable
   * by code. Set on the tariff screen; see migration 0019.
   */
  billingKey: string | null;
  /**
   * When this price applies. Null means always. Checked against today
   * when a charge is raised, so a price list can change on a date
   * without rewriting history.
   */
  effectiveFrom: string | null;
  effectiveTo: string | null;
  /** Whether automatic billing may use this tariff. */
  autoBill: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A charge the billing engine could not price.
 *
 * The clinical work exists; the invoice line does not. Holding the
 * original request is what makes it billable once the price list is
 * corrected — see migration 0020.
 */
export interface BillingChargeAttempt {
  id: number;
  facilityId: number;
  patientId: number;
  encounterId: number | null;
  sourceType: string;
  sourceId: number | null;
  itemType: string;
  description: string | null;
  codes: string[];
  serviceKeys: string[];
  family: string | null;
  serviceName: string | null;
  encounterType: string | null;
  quantity: number;
  reason: string;
  detail: string | null;
  codesTried: string[];
  status: 'PENDING' | 'BILLED' | 'DUPLICATE' | 'VOID';
  attempts: number;
  lastAttemptAt: string;
  resolvedItemId: number | null;
  resolvedInvoiceId: number | null;
  resolvedTariffCode: string | null;
  resolvedUnitPrice: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface BillingChargeAttemptList {
  facilityId: number;
  pending: number;
  attempts: BillingChargeAttempt[];
}

export interface BillingChargeAttemptOutcome {
  attemptId: number;
  status: 'BILLED' | 'DUPLICATE' | 'PENDING';
  result: {
    charged: boolean;
    reason?: string;
    message?: string;
    invoiceNumber?: string;
    tariffCode?: string;
    unitPrice?: number;
    unit?: string | null;
    matchRule?: 'LINK' | 'CODE' | 'CATALOGUE';
    matchExplanation?: string;
    codesTried?: string[];
  };
}

export interface BillingChargeRetrySummary {
  tried: number;
  billed: number;
  stillPending: number;
}

export interface TariffMatchRow {
  id: number;
  code: string;
  description: string;
  fee: string;
  unit: string;
  department: string | null;
  billingKey: string | null;
  isActive: boolean;
  verdict:
    | 'MATCHED_LINK'
    | 'MATCHED_CODE'
    | 'MATCHED_DESCRIPTION'
    | 'INACTIVE'
    | 'WRONG_DEPARTMENT'
    | 'DESCRIPTION_ALSO_MATCHES'
    | 'NO_MATCH';
  note: string;
}

export interface TariffMatchExplanation {
  facilityId: number;
  family: string;
  codes: string[];
  phrases: string[];
  linkedKeys: string[];
  rows: TariffMatchRow[];
  wouldBill: {
    code: string;
    description: string;
    fee: string;
    unit: string;
    rule: 'LINK' | 'CODE' | 'CATALOGUE';
  } | null;
  outcome: {
    rule: 'LINK' | 'CODE' | 'CATALOGUE' | null;
    ambiguity?: { phrase: string; codes: string[] };
  };
}

/**
 * A catalogue service → tariff link (migration 0021).
 *
 * `serviceId` is the stable id of the catalogue row — `lab_tests.id`
 * for a laboratory test — not a code that can be renamed.
 */
export interface ServiceTariffLink {
  id: number;
  serviceType: string;
  serviceId: number | null;
  serviceCode: string | null;
  serviceName: string | null;
  tariffId: number;
  autoBill: boolean;
  isActive: boolean;
  note: string | null;
  createdAt: string;
  tariffCode: string;
  tariffDescription: string;
  tariffFee: string;
  tariffUnit: string;
  tariffActive: boolean;
  tariffAutoBill: boolean;
  tariffEffectiveFrom: string | null;
  tariffEffectiveTo: string | null;
}

/** One laboratory test and what it would bill today. */
export interface LabServiceDiagnostic {
  testId: number;
  code: string;
  name: string;
  category: string | null;
  isActive: boolean;
  cataloguePrice: string | null;
  resolved: {
    tariffId: number;
    code: string;
    description: string;
    fee: string;
    unit: string;
    rule: 'LINK' | 'FAMILY_LINK' | 'ALIAS' | 'CODE' | 'CATALOGUE';
  } | null;
  failure: {
    code: string;
    label: string;
    message: string;
    candidates?: string[];
  } | null;
  codesTried: string[];
}

export interface LabServiceDiagnostics {
  facilityId: number;
  total: number;
  resolved: number;
  unresolvable: number;
  tests: LabServiceDiagnostic[];
}

export interface BillingPayment {
  id: number;
  invoiceId: number;
  receiptNumber: string;
  paymentMethod: string;
  amount: string;
  referenceCode?: string;
  /** Code from the customer's M-Pesa / Airtel confirmation message. */
  transactionCode?: string;
  settlementStatus?: SettlementOutcome;
  cashierName: string;
  paymentDate: string;
}

export type SettlementOutcome = 'FULLY_PAID' | 'BALANCE_REMAINING' | 'OVERPAID';

export interface PaymentSettlement {
  invoiceTotalCents: number;
  paidBeforeCents: number;
  balanceBeforeCents: number;
  amountCents: number;
  paidAfterCents: number;
  balanceAfterCents: number;
  creditCents: number;
  outcome: SettlementOutcome;
  invoiceStatus: 'Paid' | 'Partially Paid' | 'Unpaid' | 'Overpaid';
  summary: string;
}

export interface RecordPaymentResult {
  payment: BillingPayment;
  settlement: PaymentSettlement;
  invoice: {
    id: number;
    invoiceNumber: string;
    totalAmount: string;
    paidAmount: string;
    balanceAmount: string;
    creditBalance: string;
    status: string;
  };
}

export interface PaymentLedgerRow {
  id: number;
  invoiceId: number;
  invoiceNumber: string;
  patientId: number;
  receiptNumber: string;
  paymentMethod: string;
  amount: string;
  transactionCode: string | null;
  settlementStatus: SettlementOutcome | null;
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
  /** Set once the approved amount has been posted against the invoice. */
  settledPaymentId?: number | null;
  settledAt?: string | null;
}

export interface ClaimableLine {
  id: number;
  description: string;
  itemType: string | null;
  quantity: number | null;
  unitPrice: string | null;
  totalAmount: string | null;
}

export interface ClaimableLinesResponse {
  invoice: {
    id: number;
    invoiceNumber: string;
    patientId: number;
    totalAmount: string;
    paidAmount: string;
    balanceAmount: string;
    status: string;
    payerType: string;
  };
  lines: ClaimableLine[];
  openClaims: Array<{ id: number; claimNumber: string }>;
}

export interface DraftClaimResult {
  claim: InsuranceClaim;
  claimedLines: number;
  cappedAtBalance: boolean;
  selectedCents: number;
  balanceCents: number;
}

export interface ClaimSettlementResult {
  claim: InsuranceClaim;
  payment: BillingPayment;
  settlement: PaymentSettlement;
  appliedCents: number;
  unappliedCents: number;
  facilityId: number;
}

/* ============================================================
   DHA / AfyaConnect
   ============================================================ */

export type DhaCheckStatus = 'READY' | 'BLOCKED' | 'WARNING';

export interface DhaReadinessCheck {
  id: string;
  label: string;
  status: DhaCheckStatus;
  detail: string;
}

export interface DhaOperationState {
  operation: string;
  method: string;
  path: string;
  implemented: boolean;
  blockedReason?: string;
}

export interface DhaReadinessReport {
  generatedAt: string;
  config: {
    mode: 'mock' | 'sandbox' | 'production';
    enabled: boolean;
    baseUrl: string | null;
    disabledReason: string | null;
    productionOptIn: boolean;
    timeoutMs: number;
    maxRetries: number;
    /** Values only ever say 'configured' or 'missing'. */
    credentials: {
      clientId: 'configured' | 'missing';
      clientSecret: 'configured' | 'missing';
      facilityCode: 'configured' | 'missing';
    };
  };
  checks: DhaReadinessCheck[];
  operations: DhaOperationState[];
  ready: boolean;
  blockers: string[];
}

export interface DhaEligibilityVerdict {
  eligible: boolean;
  pomsfEligible: boolean;
  deceased: boolean;
  otpWhitelisted: boolean;
  biometricsEnforced: boolean;
  schemes: string[];
  matchedPrefixes: string[];
  statusCode: string | null;
  statusDesc: string | null;
  memberCrNumber: string | null;
}

export interface DhaEligibilityResult {
  verdict: DhaEligibilityVerdict;
  identificationType: string;
  identificationHint: string;
  simulated: boolean;
  mode: string;
  retrievedAt: string;
  memberCrNumberRecorded: boolean;
}

export interface DhaCallLog {
  id: number;
  facilityId: number | null;
  patientId: number | null;
  operation: string;
  method: string;
  path: string;
  status: string;
  httpStatus: number | null;
  durationMs: number | null;
  mode: string;
  simulated: boolean;
  errorCode: string | null;
  createdAt: string;
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
  expiringStockAlerts: number;
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

/**
 * One row of the money-in split. `channel` is the normalised bucket;
 * `label` is what the screen prints. SHA is a payer settlement, mobile
 * money is the online rail (M-Pesa / Airtel), cash is the drawer.
 */
export interface RevenueChannelRow {
  channel: 'SHA' | 'MOBILE_MONEY' | 'CASH' | 'CARD' | 'OTHER';
  label: string;
  paymentCount: number;
  amount: string;
}

export interface RevenueChannelReconciliation {
  collected: string;
  difference: string;
  reconciled: boolean;
  /** Stored method names that did not map to a known channel. */
  unmappedMethods: string[];
}

export interface RevenueReport {
  facilityId: number;
  from: string | null;
  to: string | null;
  totalRevenue: string;
  totals: RevenueTotals;
  byService: RevenueServiceRow[];
  byChannel?: RevenueChannelRow[];
  channelTotal?: string;
  channelReconciliation?: RevenueChannelReconciliation;
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

/* ============================================================
   PHARMACY STOCK — BATCHES AND EXPIRY
   ============================================================ */

export type BatchExpiryStatus = 'Expired' | 'Expiring' | 'OK';

export interface InventoryBatchRow {
  id: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  unit: string | null;
  batchNumber: string;
  expiryDate: string;
  quantityRemaining: number;
  costPerUnit: string;
  daysToExpiry: number | null;
  status: BatchExpiryStatus;
}

export interface ExpirySummaryItem {
  itemId: number;
  itemCode: string;
  itemName: string;
  expiredUnits: number;
  expiringUnits: number;
  earliestExpiry: string;
}

export interface ExpirySummary {
  facilityId: number;
  generatedAt: string;
  horizonDays: number;
  expiredBatches: number;
  expiredUnits: number;
  expiringBatches: number;
  expiringUnits: number;
  expiredValueCents: number;
  expiringValueCents: number;
  affectedItems: number;
  items: ExpirySummaryItem[];
}

export interface ReceiveBatchResult {
  batch: {
    id: number;
    itemId: number;
    batchNumber: string;
    expiryDate: string;
    quantityRemaining: number;
    costPerUnit: string | null;
  };
  item: InventoryItem | null;
  received: number;
  expiryMismatch: string | null;
}

export interface DispenseAllocation {
  batchId: number;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
}
