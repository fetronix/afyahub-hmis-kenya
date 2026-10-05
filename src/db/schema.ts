import { pgTable, serial, text, integer, timestamp, boolean, numeric, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Tenants table for multi-tenancy
export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  domain: text('domain'),
  logoUrl: text('logo_url'),
  brandColor: text('brand_color').default('#0f766e'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  currency: text('currency').default('KES'),
  timezone: text('timezone').default('Africa/Nairobi'),
  settings: jsonb('settings').default({}),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

// Healthcare Facilities per Tenant
export const facilities = pgTable('facilities', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  level: text('level').default('Level 4'), // Level 2 Clinic, Level 3 Center, Level 4 Hospital, Level 5 County, Level 6 National
  county: text('county').default('Nairobi'),
  subCounty: text('sub_county').default('Westlands'),
  mflCode: text('mfl_code').default('MFL-12845'), // Kenya Master Facility List Code
  address: text('address'),
  phone: text('phone'),
  email: text('email'),
  enabledModules: jsonb('enabled_modules').default([
    'registration', 'reception', 'opd', 'inpatient', 'theatre', 'specialty',
    'laboratory', 'radiology', 'pharmacy', 'inventory', 'procurement',
    'finance', 'insurance', 'public_health', 'analytics', 'configuration'
  ]),
  createdAt: timestamp('created_at').defaultNow(),
});

// Departments in Facilities
export const departments = pgTable('departments', {
  id: serial('id').primaryKey(),
  facilityId: integer('facility_id').references(() => facilities.id).notNull(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  type: text('type').default('clinical'), // clinical, diagnostic, pharmacy, administrative, inpatient
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

// Roles
export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id),
  name: text('name').notNull(),
  description: text('description'),
  isSystem: boolean('is_system').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

// Permissions
export const permissions = pgTable('permissions', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  module: text('module').notNull(),
  description: text('description'),
});

// Role Permissions mapping
export const rolePermissions = pgTable('role_permissions', {
  id: serial('id').primaryKey(),
  roleId: integer('role_id').references(() => roles.id).notNull(),
  permissionId: integer('permission_id').references(() => permissions.id).notNull(),
});

// Users
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID
  tenantId: integer('tenant_id').references(() => tenants.id),
  facilityId: integer('facility_id').references(() => facilities.id),
  email: text('email').notNull(),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  designation: text('designation'), // Doctor, Nurse, Pharmacist, Lab Tech, Administrator, Cashier
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

// User Roles mapping
export const userRoles = pgTable('user_roles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  roleId: integer('role_id').references(() => roles.id).notNull(),
});

// Practitioners (Doctor, Clinical Officer, Nurse, Specialist)
export const practitioners = pgTable('practitioners', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  facilityId: integer('facility_id').references(() => facilities.id).notNull(),
  userId: integer('user_id').references(() => users.id),
  fullName: text('full_name').notNull(),
  licenseNumber: text('license_number'), // Kenya Medical Practitioners & Dentists Council (KMPDC) or Nursing Council of Kenya (NCK)
  specialty: text('specialty').default('General Medicine'),
  qualification: text('qualification'),
  departmentId: integer('department_id').references(() => departments.id),
  phone: text('phone'),
  isActive: boolean('is_active').default(true),
});

// Patients
export const patients = pgTable('patients', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  facilityId: integer('facility_id').references(() => facilities.id).notNull(),
  mrn: text('mrn').notNull().unique(), // Medical Record Number e.g. MRN-2026-0042
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  middleName: text('middle_name'),
  dateOfBirth: text('date_of_birth').notNull(),
  gender: text('gender').notNull(), // Male, Female, Other
  phone: text('phone').notNull(),
  email: text('email'),
  nationalId: text('national_id'), // Kenya National ID / Passport
  shaNumber: text('sha_number'), // Kenya Social Health Authority (SHA) / NHIF number
  bloodGroup: text('blood_group'),
  maritalStatus: text('marital_status'),
  occupation: text('occupation'),
  county: text('county').default('Nairobi'),
  subCounty: text('sub_county').default('Westlands'),
  residentialAddress: text('residential_address'),
  emergencyContactName: text('emergency_contact_name'),
  emergencyContactPhone: text('emergency_contact_phone'),
  emergencyContactRelationship: text('emergency_contact_relationship'),
  allergies: text('allergies').default('None known'),
  chronicConditions: text('chronic_conditions').default('None known'),
  payerType: text('payer_type').default('Self-Pay'), // Self-Pay, SHA, Insurance, Corporate
  insuranceProvider: text('insurance_provider'),
  policyNumber: text('policy_number'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Patient Identifiers (Biometric, Huduma, Passport, Birth Cert)
export const patientIdentifiers = pgTable('patient_identifiers', {
  id: serial('id').primaryKey(),
  patientId: integer('patient_id').references(() => patients.id).notNull(),
  idType: text('id_type').notNull(), // National ID, SHA, Huduma, Passport, Birth Cert, Biometric
  idValue: text('id_value').notNull(),
  issuingAuthority: text('issuing_authority').default('Government of Kenya'),
  isPrimary: boolean('is_primary').default(false),
});

// Clinical Encounters
export const encounters = pgTable('encounters', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  facilityId: integer('facility_id').references(() => facilities.id).notNull(),
  patientId: integer('patient_id').references(() => patients.id).notNull(),
  practitionerId: integer('practitioner_id').references(() => practitioners.id),
  encounterType: text('encounter_type').default('Outpatient'), // Outpatient, Emergency, Inpatient, Specialist, Theatre
  departmentId: integer('department_id').references(() => departments.id),
  status: text('status').default('Active'), // Waiting, In-Consultation, Completed, Admitted, Discharged
  triageCategory: text('triage_category').default('Category 3 - Urgent'), // Category 1 (Resus), Category 2 (Emergent), Category 3 (Urgent), Category 4 (Less Urgent), Category 5 (Non-Urgent)
  chiefComplaint: text('chief_complaint'),
  historyOfPresentIllness: text('history_of_present_illness'),
  physicalExamination: text('physical_examination'),
  clinicalNotes: text('clinical_notes'),
  followUpDate: text('follow_up_date'),
  referralFacility: text('referral_facility'),
  startedAt: timestamp('started_at').defaultNow(),
  endedAt: timestamp('ended_at'),
});

// Appointments
export const appointments = pgTable('appointments', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  facilityId: integer('facility_id').references(() => facilities.id).notNull(),
  patientId: integer('patient_id').references(() => patients.id).notNull(),
  practitionerId: integer('practitioner_id').references(() => practitioners.id),
  departmentId: integer('department_id').references(() => departments.id),
  scheduledTime: text('scheduled_time').notNull(),
  durationMinutes: integer('duration_minutes').default(30),
  appointmentType: text('appointment_type').default('Routine Follow-up'),
  status: text('status').default('Scheduled'), // Scheduled, Checked-In, Completed, Cancelled, No-Show
  reason: text('reason'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Patient Queues
export const queues = pgTable('queues', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  facilityId: integer('facility_id').references(() => facilities.id).notNull(),
  patientId: integer('patient_id').references(() => patients.id).notNull(),
  encounterId: integer('encounter_id').references(() => encounters.id),
  queueType: text('queue_type').notNull(), // Triage, Doctor, Laboratory, Radiology, Pharmacy, Billing
  tokenNumber: text('token_number').notNull(), // E.g. OPD-021
  priority: text('priority').default('Normal'), // Emergency, Priority, Normal
  status: text('status').default('Waiting'), // Waiting, In-Progress, Called, Completed, Skipped
  waitingTimeMinutes: integer('waiting_time_minutes').default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

// Vital Signs & Observations
export const observations = pgTable('observations', {
  id: serial('id').primaryKey(),
  encounterId: integer('encounter_id').references(() => encounters.id).notNull(),
  patientId: integer('patient_id').references(() => patients.id).notNull(),
  systolicBp: integer('systolic_bp'),
  diastolicBp: integer('diastolic_bp'),
  pulseRate: integer('pulse_rate'),
  temperatureC: numeric('temperature_c', { precision: 4, scale: 1 }),
  respiratoryRate: integer('respiratory_rate'),
  spo2Percent: integer('spo2_percent'),
  weightKg: numeric('weight_kg', { precision: 5, scale: 1 }),
  heightCm: numeric('height_cm', { precision: 5, scale: 1 }),
  bmi: numeric('bmi', { precision: 4, scale: 1 }),
  bloodGlucoseMmol: numeric('blood_glucose_mmol', { precision: 4, scale: 1 }),
  recordedBy: text('recorded_by'),
  recordedAt: timestamp('recorded_at').defaultNow(),
});

// Diagnoses (ICD-10)
export const diagnoses = pgTable('diagnoses', {
  id: serial('id').primaryKey(),
  encounterId: integer('encounter_id').references(() => encounters.id).notNull(),
  patientId: integer('patient_id').references(() => patients.id).notNull(),
  icd10Code: text('icd10_code').notNull(), // E.g. B54 (Malaria), I10 (Hypertension)
  icd10Description: text('icd10_description').notNull(),
  diagnosisType: text('diagnosis_type').default('Primary'), // Primary, Secondary, Provisional, Differential
  status: text('status').default('Confirmed'), // Confirmed, Suspected, Resolved
  notes: text('notes'),
  diagnosedBy: text('diagnosed_by'),
  diagnosedAt: timestamp('diagnosed_at').defaultNow(),
});

// Clinical Procedures
export const clinicalProcedures = pgTable('procedures', {
  id: serial('id').primaryKey(),
  encounterId: integer('encounter_id').references(() => encounters.id).notNull(),
  patientId: integer('patient_id').references(() => patients.id).notNull(),
  procedureCode: text('procedure_code').notNull(),
  procedureName: text('procedure_name').notNull(),
  departmentId: integer('department_id').references(() => departments.id),
  category: text('category').default('Minor OPD'),
  cost: numeric('cost', { precision: 10, scale: 2 }).default('0'),
  status: text('status').default('Completed'),
  performedBy: text('performed_by'),
  notes: text('notes'),
  performedAt: timestamp('performed_at').defaultNow(),
});

// Medications & Prescriptions
export const medications = pgTable('medications', {
  id: serial('id').primaryKey(),
  encounterId: integer('encounter_id').references(() => encounters.id).notNull(),
  patientId: integer('patient_id').references(() => patients.id).notNull(),
  drugId: integer('drug_id'),
  drugName: text('drug_name').notNull(),
  dosage: text('dosage').notNull(), // e.g. 500mg
  frequency: text('frequency').notNull(), // e.g. TDS (3 times daily)
  duration: text('duration').notNull(), // e.g. 5 days
  route: text('route').default('Oral'), // Oral, IV, IM, Topical, Inhalation
  instructions: text('instructions'), // e.g. Take after food
  quantity: integer('quantity').default(1),
  unitPrice: numeric('unit_price', { precision: 10, scale: 2 }).default('0'),
  status: text('status').default('Prescribed'), // Prescribed, Dispensed, Cancelled
  prescribedBy: text('prescribed_by'),
  prescribedAt: timestamp('prescribed_at').defaultNow(),
});

// Inpatient Wards
export const wards = pgTable('wards', {
  id: serial('id').primaryKey(),
  facilityId: integer('facility_id').references(() => facilities.id).notNull(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  wardType: text('ward_type').default('General'), // General, Surgical, Pediatric, Maternity, ICU/HDU, Amenity
  genderAllocation: text('gender_allocation').default('Mixed'), // Male, Female, Mixed, Pediatric
  totalBeds: integer('total_beds').default(20),
  dailyRate: numeric('daily_rate', { precision: 10, scale: 2 }).default('1500.00'),
  isActive: boolean('is_active').default(true),
});

// Ward Beds
export const beds = pgTable('beds', {
  id: serial('id').primaryKey(),
  wardId: integer('ward_id').references(() => wards.id).notNull(),
  bedNumber: text('bed_number').notNull(),
  bedType: text('bed_type').default('Standard'), // Standard, Fowler, ICU Ventilated, Pediatric Crib
  status: text('status').default('Available'), // Available, Occupied, Maintenance, Cleaning, Reserved
  dailyCharge: numeric('daily_charge', { precision: 10, scale: 2 }).default('1500.00'),
  currentPatientId: integer('current_patient_id').references(() => patients.id),
});

// Inpatient Admissions
export const admissions = pgTable('admissions', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  facilityId: integer('facility_id').references(() => facilities.id).notNull(),
  patientId: integer('patient_id').references(() => patients.id).notNull(),
  encounterId: integer('encounter_id').references(() => encounters.id),
  wardId: integer('ward_id').references(() => wards.id).notNull(),
  bedId: integer('bed_id').references(() => beds.id).notNull(),
  admissionDate: text('admission_date').notNull(),
  admissionType: text('admission_type').default('Emergency'), // Emergency, Elective, Transfer
  admittingDoctor: text('admitting_doctor'),
  provisionalDiagnosis: text('provisional_diagnosis'),
  nursingNotes: text('nursing_notes'),
  status: text('status').default('Admitted'), // Admitted, Discharged, Transferred, Absconded, Deceased
  dischargeDate: text('discharge_date'),
  dischargeType: text('discharge_type'), // Routine, Against Medical Advice, Transfer, Deceased
  dischargeSummary: text('discharge_summary'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Operating Theatres
export const theatreCases = pgTable('theatre_cases', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  facilityId: integer('facility_id').references(() => facilities.id).notNull(),
  patientId: integer('patient_id').references(() => patients.id).notNull(),
  procedureName: text('procedure_name').notNull(),
  theatreRoom: text('theatre_room').default('Main Theatre 1'),
  theatreType: text('theatre_type').default('Major'), // Major, Minor, Endoscopy, Emergency
  leadSurgeon: text('lead_surgeon').notNull(),
  anaesthetist: text('anaesthetist'),
  scrubNurse: text('scrub_nurse'),
  scheduledStart: text('scheduled_start').notNull(),
  scheduledEnd: text('scheduled_end'),
  preOpChecklist: jsonb('pre_op_checklist').default({}),
  postOpNotes: text('post_op_notes'),
  status: text('status').default('Scheduled'), // Scheduled, In-Theatre, Recovery, Completed, Cancelled
  createdAt: timestamp('created_at').defaultNow(),
});

// Laboratory Test Catalogue
export const labTests = pgTable('lab_tests', {
  id: serial('id').primaryKey(),
  facilityId: integer('facility_id').references(() => facilities.id).notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  category: text('category').default('Haematology'), // Haematology, Biochemistry, Microbiology, Parasitology, Immunology
  specimenType: text('specimen_type').default('Whole Blood'),
  referenceRanges: text('reference_ranges'),
  turnaroundHours: integer('turnaround_hours').default(2),
  price: numeric('price', { precision: 10, scale: 2 }).default('500.00'),
  isActive: boolean('is_active').default(true),
});

// Laboratory Orders
export const labOrders = pgTable('lab_orders', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  facilityId: integer('facility_id').references(() => facilities.id).notNull(),
  patientId: integer('patient_id').references(() => patients.id).notNull(),
  encounterId: integer('encounter_id').references(() => encounters.id),
  testId: integer('test_id').references(() => labTests.id),
  testName: text('test_name').notNull(),
  status: text('status').default('Ordered'), // Ordered, Sample Collected, Accessioned, Processing, Verified, Published
  sampleCollectedAt: timestamp('sample_collected_at'),
  sampleAccessionNumber: text('sample_accession_number'),
  orderedBy: text('ordered_by'),
  orderedAt: timestamp('ordered_at').defaultNow(),
});

// Laboratory Results
export const labResults = pgTable('lab_results', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').references(() => labOrders.id).notNull(),
  patientId: integer('patient_id').references(() => patients.id).notNull(),
  parameterName: text('parameter_name').notNull(),
  measuredValue: text('measured_value').notNull(),
  unit: text('unit'),
  referenceRange: text('reference_range'),
  flag: text('flag').default('Normal'), // Normal, High, Low, Critical
  notes: text('notes'),
  verifiedBy: text('verified_by'),
  verifiedAt: timestamp('verified_at').defaultNow(),
});

// Radiology Orders
export const radiologyOrders = pgTable('radiology_orders', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  facilityId: integer('facility_id').references(() => facilities.id).notNull(),
  patientId: integer('patient_id').references(() => patients.id).notNull(),
  encounterId: integer('encounter_id').references(() => encounters.id),
  modality: text('modality').notNull(), // X-Ray, Ultrasound, CT Scan, MRI
  procedureName: text('procedure_name').notNull(),
  clinicalIndication: text('clinical_indication'),
  status: text('status').default('Requested'), // Requested, Scheduled, Performed, Reported
  radiologistFindings: text('radiologist_findings'),
  impression: text('impression'),
  attachmentUrl: text('attachment_url'),
  orderedBy: text('ordered_by'),
  reportedBy: text('reported_by'),
  reportedAt: timestamp('reported_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Inventory Items / Drug Catalogue
export const inventoryItems = pgTable('inventory_items', {
  id: serial('id').primaryKey(),
  facilityId: integer('facility_id').references(() => facilities.id).notNull(),
  itemCode: text('item_code').notNull(),
  name: text('name').notNull(),
  genericName: text('generic_name'),
  category: text('category').default('Pharmaceuticals'), // Pharmaceuticals, Surgical Supplies, Lab Reagents, Consumables
  unit: text('unit').default('Tablets'), // Tablets, Vials, Ampoules, Bottles, Boxes
  strength: text('strength'), // 500mg, 1g, 200ml
  dosageForm: text('dosage_form'), // Capsule, Tablet, Syrup, Injection, Ointment
  currentStock: integer('current_stock').default(0),
  reorderLevel: integer('reorder_level').default(50),
  unitCost: numeric('unit_cost', { precision: 10, scale: 2 }).default('0'),
  sellingPrice: numeric('selling_price', { precision: 10, scale: 2 }).default('0'),
  storeLocation: text('store_location').default('Main Pharmacy Store'),
  isActive: boolean('is_active').default(true),
});

// Inventory Batches
export const inventoryBatches = pgTable('inventory_batches', {
  id: serial('id').primaryKey(),
  itemId: integer('item_id').references(() => inventoryItems.id).notNull(),
  batchNumber: text('batch_number').notNull(),
  expiryDate: text('expiry_date').notNull(),
  quantityRemaining: integer('quantity_remaining').notNull(),
  costPerUnit: numeric('cost_per_unit', { precision: 10, scale: 2 }).default('0'),
});

// Pharmacy Dispensations
export const pharmacyDispensations = pgTable('pharmacy_dispensations', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  facilityId: integer('facility_id').references(() => facilities.id).notNull(),
  prescriptionId: integer('prescription_id').references(() => medications.id),
  patientId: integer('patient_id').references(() => patients.id).notNull(),
  itemId: integer('item_id').references(() => inventoryItems.id),
  batchNumber: text('batch_number'),
  quantityDispensed: integer('quantity_dispensed').notNull(),
  dispensedBy: text('dispensed_by').notNull(),
  dispensedAt: timestamp('dispensed_at').defaultNow(),
  notes: text('notes'),
});

// Suppliers for Procurement
export const suppliers = pgTable('suppliers', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  name: text('name').notNull(),
  contactPerson: text('contact_person'),
  phone: text('phone'),
  email: text('email'),
  kraPin: text('kra_pin'), // Kenya Revenue Authority PIN
  address: text('address'),
  isActive: boolean('is_active').default(true),
});

// Purchase Orders
export const purchaseOrders = pgTable('purchase_orders', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  facilityId: integer('facility_id').references(() => facilities.id).notNull(),
  supplierId: integer('supplier_id').references(() => suppliers.id).notNull(),
  poNumber: text('po_number').notNull().unique(),
  totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).default('0'),
  status: text('status').default('Pending Approval'), // Draft, Pending Approval, Approved, Goods Received, Cancelled
  orderedBy: text('ordered_by'),
  approvedBy: text('approved_by'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Billing Invoices
export const billingInvoices = pgTable('billing_invoices', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  facilityId: integer('facility_id').references(() => facilities.id).notNull(),
  patientId: integer('patient_id').references(() => patients.id).notNull(),
  encounterId: integer('encounter_id').references(() => encounters.id),
  invoiceNumber: text('invoice_number').notNull().unique(), // E.g. INV-2026-0812
  totalAmount: numeric('total_amount', { precision: 10, scale: 2 }).default('0'),
  paidAmount: numeric('paid_amount', { precision: 10, scale: 2 }).default('0'),
  balanceAmount: numeric('balance_amount', { precision: 10, scale: 2 }).default('0'),
  status: text('status').default('Pending'), // Pending, Partially Paid, Paid, Waived, Disputed
  payerType: text('payer_type').default('Self-Pay'), // Self-Pay, SHA, Insurance, Corporate
  payerName: text('payer_name'),
  memberNumber: text('member_number'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Billing Items
export const billingItems = pgTable('billing_items', {
  id: serial('id').primaryKey(),
  invoiceId: integer('invoice_id').references(() => billingInvoices.id).notNull(),
  itemType: text('item_type').notNull(), // Consultation, Pharmacy, Lab, Radiology, Procedure, Bed Charge, Nursing
  description: text('description').notNull(),
  quantity: integer('quantity').default(1),
  unitPrice: numeric('unit_price', { precision: 10, scale: 2 }).default('0'),
  totalAmount: numeric('total_amount', { precision: 10, scale: 2 }).default('0'),
});

// Billing Payments
export const billingPayments = pgTable('billing_payments', {
  id: serial('id').primaryKey(),
  invoiceId: integer('invoice_id').references(() => billingInvoices.id).notNull(),
  receiptNumber: text('receipt_number').notNull().unique(), // E.g. REC-2026-0422
  paymentMethod: text('payment_method').default('M-Pesa'), // M-Pesa, Cash, Visa/Mastercard, Bank Transfer, SHA/NHIF
  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
  referenceCode: text('reference_code'), // E.g. M-Pesa Transaction Code QHD827491X
  cashierName: text('cashier_name').notNull(),
  paymentDate: timestamp('payment_date').defaultNow(),
});

// Insurance / SHA Claims
export const insuranceClaims = pgTable('insurance_claims', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  facilityId: integer('facility_id').references(() => facilities.id).notNull(),
  patientId: integer('patient_id').references(() => patients.id).notNull(),
  invoiceId: integer('invoice_id').references(() => billingInvoices.id).notNull(),
  claimNumber: text('claim_number').notNull().unique(),
  payerName: text('payer_name').default('Social Health Authority (SHA)'), // SHA, Jubilee, APA, CIC, Britam, Madison
  policyNumber: text('policy_number'),
  preAuthCode: text('pre_auth_code'),
  claimAmount: numeric('claim_amount', { precision: 10, scale: 2 }).notNull(),
  approvedAmount: numeric('approved_amount', { precision: 10, scale: 2 }).default('0'),
  status: text('status').default('Draft'), // Draft, Submitted, Pre-Authorized, Approved, Settled, Rejected
  submittedAt: timestamp('submitted_at'),
  adjudicationNotes: text('adjudication_notes'),
});

// Public Health & KHIS / DHIS2 Disease Surveillance
export const publicHealthReports = pgTable('public_health_reports', {
  id: serial('id').primaryKey(),
  facilityId: integer('facility_id').references(() => facilities.id).notNull(),
  diseaseCode: text('disease_code').notNull(), // E.g. A00 (Cholera), B05 (Measles), B50 (Malaria)
  diseaseName: text('disease_name').notNull(),
  casesCount: integer('cases_count').default(1),
  mortalityCount: integer('mortality_count').default(0),
  ageGroup: text('age_group').default('Over 5 Years'), // Under 5 Years, Over 5 Years
  epiWeek: text('epi_week').notNull(), // E.g. 2026-W40
  reportedAt: timestamp('reported_at').defaultNow(),
});

// Audit Trail & Security Logs
export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id'),
  facilityId: integer('facility_id'),
  userId: text('user_id'),
  action: text('action').notNull(), // CREATE, UPDATE, DELETE, VIEW, DISPENSE, BILL, ADMIT, DISCHARGE
  resource: text('resource').notNull(), // Patient, Prescription, Invoice, LabOrder, Bed
  resourceId: text('resource_id'),
  details: text('details'),
  ipAddress: text('ip_address'),
  timestamp: timestamp('timestamp').defaultNow(),
});

// Relations definitions
export const tenantsRelations = relations(tenants, ({ many }) => ({
  facilities: many(facilities),
  patients: many(patients),
  users: many(users),
}));

export const facilitiesRelations = relations(facilities, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [facilities.tenantId],
    references: [tenants.id],
  }),
  departments: many(departments),
  patients: many(patients),
  wards: many(wards),
}));

export const patientsRelations = relations(patients, ({ one, many }) => ({
  facility: one(facilities, {
    fields: [patients.facilityId],
    references: [facilities.id],
  }),
  encounters: many(encounters),
  appointments: many(appointments),
  invoices: many(billingInvoices),
  admissions: many(admissions),
}));

export const encountersRelations = relations(encounters, ({ one, many }) => ({
  patient: one(patients, {
    fields: [encounters.patientId],
    references: [patients.id],
  }),
  observations: many(observations),
  diagnoses: many(diagnoses),
  medications: many(medications),
  labOrders: many(labOrders),
}));
