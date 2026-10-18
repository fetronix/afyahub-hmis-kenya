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
  phone: string;
  email?: string;
  nationalId?: string;
  shaNumber?: string;
  bloodGroup?: string;
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
  verifiedBy?: string;
  verifiedAt: string;
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
