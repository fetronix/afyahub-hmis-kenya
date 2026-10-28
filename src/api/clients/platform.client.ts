import type {
  AnalyticsSummary,
  AuditLog,
  Department,
  DhaCallLog,
  DhaEligibilityResult,
  DhaReadinessReport,
  Facility,
  PublicHealthReport,
  Tenant,
} from '../../types/index.ts';
import { API_BASE, fetchJson } from './http.ts';

export const platformClient = {
  getHealth: () =>
    fetchJson<{
      status: string;
      system: string;
      dhaReadiness: string;
      timestamp: string;
    }>(`${API_BASE}/health`),

  seedData: () =>
    fetchJson<{
      success: boolean;
      message: string;
    }>(`${API_BASE}/seed`, {
      method: 'POST',
    }),

  getTenants: () => fetchJson<Tenant[]>(`${API_BASE}/tenants`),

  getTenant: (id: number) => fetchJson<Tenant>(`${API_BASE}/tenants/${id}`),

  getFacilities: (tenantId?: number) =>
    fetchJson<Facility[]>(`${API_BASE}/facilities${tenantId ? `?tenantId=${tenantId}` : ''}`),

  getFacilityModules: (facilityId: number) =>
    fetchJson<{
      success: boolean;
      facilityId: number;
      enabledModules: string[];
      alwaysEnabled: string[];
      canManage: boolean;
      catalogue: Array<{
        id: string;
        label: string;
        group: string;
        description: string;
        alwaysOn?: boolean;
      }>;
    }>(`${API_BASE}/facilities/${facilityId}/modules`),

  updateFacilityModules: (facilityId: number, enabledModules: string[]) =>
    fetchJson<{
      success: boolean;
      facilityId: number;
      enabledModules: string[];
      added: string[];
      removed: string[];
      alwaysEnabled: string[];
      changed: boolean;
    }>(`${API_BASE}/facilities/${facilityId}/modules`, {
      method: 'PATCH',
      body: JSON.stringify({ enabledModules }),
    }),

  getDepartments: (facilityId?: number) =>
    fetchJson<Department[]>(
      `${API_BASE}/departments${facilityId ? `?facilityId=${facilityId}` : ''}`,
    ),

  getPublicHealthReports: (facilityId?: number) =>
    fetchJson<PublicHealthReport[]>(
      `${API_BASE}/public-health/reports${facilityId ? `?facilityId=${facilityId}` : ''}`,
    ),

  recordPublicHealthReport: (rep: Partial<PublicHealthReport>) =>
    fetchJson<PublicHealthReport>(`${API_BASE}/public-health/reports`, {
      method: 'POST',
      body: JSON.stringify(rep),
    }),

  getAnalyticsSummary: (facilityId?: number) =>
    fetchJson<AnalyticsSummary>(
      `${API_BASE}/analytics/summary${facilityId ? `?facilityId=${facilityId}` : ''}`,
    ),

  getFhirPatient: (id: number) => fetchJson<any>(`${API_BASE}/interop/fhir/patient/${id}`),

  getMoh705Summary: (facilityId?: number) =>
    fetchJson<any>(
      `${API_BASE}/interop/dha/moh-705${facilityId ? `?facilityId=${facilityId}` : ''}`,
    ),

  getDhaCompliance: () =>
    fetchJson<{
      success: boolean;
      generatedAt: string;
      categories: Array<{
        category: string;
        label: string;
        weight: number;
        assessed: number;
        verified: number;
        score: number;
        contribution: number;
      }>;
      weightedAverage: number;
      overallScore: number;
      criticalGateTriggered: boolean;
      criticalGaps: Array<{
        id: string;
        title: string;
        status: string;
        severity: string;
        dependency?: string;
      }>;
      readyForSubmission: boolean;
      counts: Record<string, number>;
      totalRequirements: number;
      certification: false;
      disclaimer: string;
      requirements: Array<{
        id: string;
        category: string;
        title: string;
        requirement: string;
        module: string;
        status: string;
        severity: string;
        evidence: string;
        verification: string;
        externalDependency?: string;
        note?: string;
      }>;
    }>(`${API_BASE}/compliance/dha`),

  getDhaReadiness: (probe = false) =>
    fetchJson<DhaReadinessReport>(
      `${API_BASE}/integrations/dha/readiness?probe=${probe ? 'true' : 'false'}`,
    ),

  getDhaCalls: (facilityId?: number, limit = 25) =>
    fetchJson<DhaCallLog[]>(
      `${API_BASE}/integrations/dha/calls?limit=${limit}${
        facilityId ? `&facilityId=${facilityId}` : ''
      }`,
    ),

  checkDhaEligibility: (
    patientId: number,
    options: {
      identificationType?: string;
      identificationNumber?: string;
      facilityId?: number;
    } = {},
  ) =>
    fetchJson<DhaEligibilityResult>(
      `${API_BASE}/integrations/dha/patients/${patientId}/eligibility`,
      {
        method: 'POST',
        body: JSON.stringify(options),
      },
    ),

  getAuditLogs: (facilityId?: number) =>
    fetchJson<AuditLog[]>(`${API_BASE}/audit-logs${facilityId ? `?facilityId=${facilityId}` : ''}`),
};
