import {
  Tenant, Facility, Department, Patient, Encounter, QueueItem,
  Appointment, Observation, Diagnosis, Procedure, Medication,
  Ward, Bed, Admission, TheatreCase, LabTest, LabOrder, LabResult,
  RadiologyOrder, InventoryItem, Supplier, PurchaseOrder,
  BillingInvoice, BillingItem, BillingPayment, InsuranceClaim,
  PublicHealthReport, AuditLog, AnalyticsSummary
} from '../types/index.ts';

const API_BASE = '/api';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errorData.error || `HTTP error ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Health & System
  getHealth: () => fetchJson<{ status: string; system: string; dhaReadiness: string; timestamp: string }>(`${API_BASE}/health`),
  seedData: () => fetchJson<{ success: boolean; message: string }>(`${API_BASE}/seed`, { method: 'POST' }),

  // Tenants & Facilities
  getTenants: () => fetchJson<Tenant[]>(`${API_BASE}/tenants`),
  getTenant: (id: number) => fetchJson<Tenant>(`${API_BASE}/tenants/${id}`),
  getFacilities: (tenantId?: number) => fetchJson<Facility[]>(`${API_BASE}/facilities${tenantId ? `?tenantId=${tenantId}` : ''}`),
  getDepartments: (facilityId?: number) => fetchJson<Department[]>(`${API_BASE}/departments${facilityId ? `?facilityId=${facilityId}` : ''}`),

  // Patients
  getPatients: (tenantId?: number, facilityId?: number, search?: string) => {
    const params = new URLSearchParams();
    if (tenantId) params.append('tenantId', tenantId.toString());
    if (facilityId) params.append('facilityId', facilityId.toString());
    if (search) params.append('search', search);
    return fetchJson<Patient[]>(`${API_BASE}/patients?${params.toString()}`);
  },
  getPatient: (id: number) => fetchJson<Patient>(`${API_BASE}/patients/${id}`),
  createPatient: (patient: Partial<Patient>) => fetchJson<Patient>(`${API_BASE}/patients`, { method: 'POST', body: JSON.stringify(patient) }),
  updatePatient: (id: number, patient: Partial<Patient>) => fetchJson<Patient>(`${API_BASE}/patients/${id}`, { method: 'PUT', body: JSON.stringify(patient) }),

  // Encounters
  getEncounters: (patientId?: number, facilityId?: number) => {
    const params = new URLSearchParams();
    if (patientId) params.append('patientId', patientId.toString());
    if (facilityId) params.append('facilityId', facilityId.toString());
    return fetchJson<Encounter[]>(`${API_BASE}/encounters?${params.toString()}`);
  },
  createEncounter: (encounter: Partial<Encounter>) => fetchJson<Encounter>(`${API_BASE}/encounters`, { method: 'POST', body: JSON.stringify(encounter) }),
  updateEncounter: (id: number, encounter: Partial<Encounter>) => fetchJson<Encounter>(`${API_BASE}/encounters/${id}`, { method: 'PUT', body: JSON.stringify(encounter) }),

  // Queues
  getQueues: (facilityId?: number, queueType?: string) => {
    const params = new URLSearchParams();
    if (facilityId) params.append('facilityId', facilityId.toString());
    if (queueType) params.append('queueType', queueType);
    return fetchJson<QueueItem[]>(`${API_BASE}/queues?${params.toString()}`);
  },
  createQueueItem: (queue: Partial<QueueItem>) => fetchJson<QueueItem>(`${API_BASE}/queues`, { method: 'POST', body: JSON.stringify(queue) }),
  updateQueueStatus: (id: number, status: string) => fetchJson<QueueItem>(`${API_BASE}/queues/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),

  // Appointments
  getAppointments: (facilityId?: number) => fetchJson<Appointment[]>(`${API_BASE}/appointments${facilityId ? `?facilityId=${facilityId}` : ''}`),
  createAppointment: (appointment: Partial<Appointment>) => fetchJson<Appointment>(`${API_BASE}/appointments`, { method: 'POST', body: JSON.stringify(appointment) }),

  // Vitals & Observations
  getObservations: (encounterId?: number, patientId?: number) => {
    const params = new URLSearchParams();
    if (encounterId) params.append('encounterId', encounterId.toString());
    if (patientId) params.append('patientId', patientId.toString());
    return fetchJson<Observation[]>(`${API_BASE}/observations?${params.toString()}`);
  },
  recordObservation: (obs: Partial<Observation>) => fetchJson<Observation>(`${API_BASE}/observations`, { method: 'POST', body: JSON.stringify(obs) }),

  // Diagnoses
  getDiagnoses: (encounterId?: number, patientId?: number) => {
    const params = new URLSearchParams();
    if (encounterId) params.append('encounterId', encounterId.toString());
    if (patientId) params.append('patientId', patientId.toString());
    return fetchJson<Diagnosis[]>(`${API_BASE}/diagnoses?${params.toString()}`);
  },
  recordDiagnosis: (diag: Partial<Diagnosis>) => fetchJson<Diagnosis>(`${API_BASE}/diagnoses`, { method: 'POST', body: JSON.stringify(diag) }),

  // Procedures
  getProcedures: (encounterId?: number, patientId?: number) => {
    const params = new URLSearchParams();
    if (encounterId) params.append('encounterId', encounterId.toString());
    if (patientId) params.append('patientId', patientId.toString());
    return fetchJson<Procedure[]>(`${API_BASE}/procedures?${params.toString()}`);
  },
  recordProcedure: (proc: Partial<Procedure>) => fetchJson<Procedure>(`${API_BASE}/procedures`, { method: 'POST', body: JSON.stringify(proc) }),

  // Medications
  getMedications: (encounterId?: number, patientId?: number) => {
    const params = new URLSearchParams();
    if (encounterId) params.append('encounterId', encounterId.toString());
    if (patientId) params.append('patientId', patientId.toString());
    return fetchJson<Medication[]>(`${API_BASE}/medications?${params.toString()}`);
  },
  prescribeMedication: (med: Partial<Medication>) => fetchJson<Medication>(`${API_BASE}/medications`, { method: 'POST', body: JSON.stringify(med) }),
  updateMedicationStatus: (id: number, status: string) => fetchJson<Medication>(`${API_BASE}/medications/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),

  // Inpatient Wards, Beds & Admissions
  getWards: (facilityId?: number) => fetchJson<Ward[]>(`${API_BASE}/wards${facilityId ? `?facilityId=${facilityId}` : ''}`),
  getBeds: (wardId?: number) => fetchJson<Bed[]>(`${API_BASE}/beds${wardId ? `?wardId=${wardId}` : ''}`),
  updateBedStatus: (id: number, status: string, currentPatientId?: number | null) => fetchJson<Bed>(`${API_BASE}/beds/${id}/status`, { method: 'PUT', body: JSON.stringify({ status, currentPatientId }) }),
  getAdmissions: (facilityId?: number, status?: string) => {
    const params = new URLSearchParams();
    if (facilityId) params.append('facilityId', facilityId.toString());
    if (status) params.append('status', status);
    return fetchJson<Admission[]>(`${API_BASE}/admissions?${params.toString()}`);
  },
  createAdmission: (adm: Partial<Admission>) => fetchJson<Admission>(`${API_BASE}/admissions`, { method: 'POST', body: JSON.stringify(adm) }),
  dischargePatient: (id: number, data: { bedId: number; dischargeDate: string; dischargeType: string; dischargeSummary: string }) => fetchJson<Admission>(`${API_BASE}/admissions/${id}/discharge`, { method: 'POST', body: JSON.stringify(data) }),

  // Theatre Cases
  getTheatreCases: (facilityId?: number) => fetchJson<TheatreCase[]>(`${API_BASE}/theatre-cases${facilityId ? `?facilityId=${facilityId}` : ''}`),
  createTheatreCase: (tc: Partial<TheatreCase>) => fetchJson<TheatreCase>(`${API_BASE}/theatre-cases`, { method: 'POST', body: JSON.stringify(tc) }),
  updateTheatreCase: (id: number, tc: Partial<TheatreCase>) => fetchJson<TheatreCase>(`${API_BASE}/theatre-cases/${id}`, { method: 'PUT', body: JSON.stringify(tc) }),

  // Laboratory
  getLabTests: (facilityId?: number) => fetchJson<LabTest[]>(`${API_BASE}/lab-tests${facilityId ? `?facilityId=${facilityId}` : ''}`),
  getLabOrders: (facilityId?: number, patientId?: number) => {
    const params = new URLSearchParams();
    if (facilityId) params.append('facilityId', facilityId.toString());
    if (patientId) params.append('patientId', patientId.toString());
    return fetchJson<LabOrder[]>(`${API_BASE}/lab-orders?${params.toString()}`);
  },
  createLabOrder: (order: Partial<LabOrder>) => fetchJson<LabOrder>(`${API_BASE}/lab-orders`, { method: 'POST', body: JSON.stringify(order) }),
  updateLabOrderStatus: (id: number, status: string, accessionNumber?: string) => fetchJson<LabOrder>(`${API_BASE}/lab-orders/${id}/status`, { method: 'PUT', body: JSON.stringify({ status, accessionNumber }) }),
  getLabResults: (orderId?: number, patientId?: number) => {
    const params = new URLSearchParams();
    if (orderId) params.append('orderId', orderId.toString());
    if (patientId) params.append('patientId', patientId.toString());
    return fetchJson<LabResult[]>(`${API_BASE}/lab-results?${params.toString()}`);
  },
  addLabResult: (res: Partial<LabResult>) => fetchJson<LabResult>(`${API_BASE}/lab-results`, { method: 'POST', body: JSON.stringify(res) }),

  // Radiology
  getRadiologyOrders: (facilityId?: number, patientId?: number) => {
    const params = new URLSearchParams();
    if (facilityId) params.append('facilityId', facilityId.toString());
    if (patientId) params.append('patientId', patientId.toString());
    return fetchJson<RadiologyOrder[]>(`${API_BASE}/radiology-orders?${params.toString()}`);
  },
  createRadiologyOrder: (order: Partial<RadiologyOrder>) => fetchJson<RadiologyOrder>(`${API_BASE}/radiology-orders`, { method: 'POST', body: JSON.stringify(order) }),
  updateRadiologyReport: (id: number, data: { findings: string; impression: string; reportedBy: string }) => fetchJson<RadiologyOrder>(`${API_BASE}/radiology-orders/${id}/report`, { method: 'PUT', body: JSON.stringify(data) }),

  // Pharmacy & Inventory
  getInventory: (facilityId?: number) => fetchJson<InventoryItem[]>(`${API_BASE}/inventory${facilityId ? `?facilityId=${facilityId}` : ''}`),
  createInventoryItem: (item: Partial<InventoryItem>) => fetchJson<InventoryItem>(`${API_BASE}/inventory`, { method: 'POST', body: JSON.stringify(item) }),
  dispenseMedication: (data: { prescriptionId?: number; patientId: number; itemId?: number; quantityDispensed: number; batchNumber?: string; dispensedBy: string; notes?: string; tenantId: number; facilityId: number }) => fetchJson<any>(`${API_BASE}/pharmacy/dispense`, { method: 'POST', body: JSON.stringify(data) }),

  // Procurement
  getSuppliers: (tenantId?: number) => fetchJson<Supplier[]>(`${API_BASE}/suppliers${tenantId ? `?tenantId=${tenantId}` : ''}`),
  getPurchaseOrders: (facilityId?: number) => fetchJson<PurchaseOrder[]>(`${API_BASE}/purchase-orders${facilityId ? `?facilityId=${facilityId}` : ''}`),
  createPurchaseOrder: (po: Partial<PurchaseOrder>) => fetchJson<PurchaseOrder>(`${API_BASE}/purchase-orders`, { method: 'POST', body: JSON.stringify(po) }),

  // Finance & Billing
  getInvoices: (facilityId?: number, patientId?: number) => {
    const params = new URLSearchParams();
    if (facilityId) params.append('facilityId', facilityId.toString());
    if (patientId) params.append('patientId', patientId.toString());
    return fetchJson<BillingInvoice[]>(`${API_BASE}/invoices?${params.toString()}`);
  },
  getInvoiceItems: (invoiceId: number) => fetchJson<BillingItem[]>(`${API_BASE}/invoices/${invoiceId}/items`),
  createInvoice: (invoice: Partial<BillingInvoice>, items: Partial<BillingItem>[]) => fetchJson<BillingInvoice>(`${API_BASE}/invoices`, { method: 'POST', body: JSON.stringify({ invoice, items }) }),
  recordPayment: (payment: Partial<BillingPayment>) => fetchJson<BillingPayment>(`${API_BASE}/billing/payments`, { method: 'POST', body: JSON.stringify(payment) }),

  // Insurance Claims
  getClaims: (facilityId?: number) => fetchJson<InsuranceClaim[]>(`${API_BASE}/claims${facilityId ? `?facilityId=${facilityId}` : ''}`),
  createClaim: (claim: Partial<InsuranceClaim>) => fetchJson<InsuranceClaim>(`${API_BASE}/claims`, { method: 'POST', body: JSON.stringify(claim) }),
  updateClaimStatus: (id: number, status: string, approvedAmount?: string, notes?: string) => fetchJson<InsuranceClaim>(`${API_BASE}/claims/${id}/status`, { method: 'PUT', body: JSON.stringify({ status, approvedAmount, notes }) }),

  // Public Health
  getPublicHealthReports: (facilityId?: number) => fetchJson<PublicHealthReport[]>(`${API_BASE}/public-health/reports${facilityId ? `?facilityId=${facilityId}` : ''}`),
  recordPublicHealthReport: (rep: Partial<PublicHealthReport>) => fetchJson<PublicHealthReport>(`${API_BASE}/public-health/reports`, { method: 'POST', body: JSON.stringify(rep) }),

  // Analytics & Interop
  getAnalyticsSummary: (facilityId?: number) => fetchJson<AnalyticsSummary>(`${API_BASE}/analytics/summary${facilityId ? `?facilityId=${facilityId}` : ''}`),
  getFhirPatient: (id: number) => fetchJson<any>(`${API_BASE}/interop/fhir/patient/${id}`),
  getMoh705Summary: (facilityId?: number) => fetchJson<any>(`${API_BASE}/interop/dha/moh-705${facilityId ? `?facilityId=${facilityId}` : ''}`),
  getAuditLogs: (facilityId?: number) => fetchJson<AuditLog[]>(`${API_BASE}/audit-logs${facilityId ? `?facilityId=${facilityId}` : ''}`),
};
