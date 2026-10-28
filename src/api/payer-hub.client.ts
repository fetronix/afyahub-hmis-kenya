import { fetchJson } from './client.ts';

export interface PayerWorkflowPolicy {
  providerId: number;
  capability: string;
  isAllowed: boolean;
}
export interface PlatformPayer {
  id: number;
  code: string;
  displayName: string;
  payerType: string;
  adapterKey: string;
  informationUrl: string;
  status: 'ACTIVE' | 'DISABLED';
  requestable: boolean;
  capabilities: PayerWorkflowPolicy[];
}
export interface PayerAssignment {
  id: number;
  providerId: number;
  tenantId: number;
  facilityId: number;
  facilityName: string;
  isAllowed: boolean;
  assignmentSource: string;
  sandboxStatus: string;
  productionApproval: string;
}
export interface FacilityPayer {
  id: number;
  code: string;
  displayName: string;
  payerType: string;
  adapterKey: string;
  informationUrl: string;
  status: 'ACTIVE' | 'DISABLED';
  requestable: boolean;
  isAssigned: boolean;
  assignmentSource: string | null;
  requestStatus: string;
  isActive: boolean;
  configId: number | null;
  integrationType: string | null;
  sandboxStatus: string;
  productionApproval: string;
  connectionStatus: string;
  processing: string;
  workflows: string[];
  usableForNewClaims: boolean;
  environments: Array<{
    environment: string;
    secretReference: string;
    providerIdentifier: string | null;
    configured: boolean;
    connectionVerified: boolean;
  }>;
}
const root = '/api/payer-hub';
function send<T = unknown>(path: string, method: string, body: unknown) {
  return fetchJson<T>(`${root}${path}`, { method, body: JSON.stringify(body) });
}
export const payerHubApi = {
  platform: () =>
    fetchJson<{
      providers: PlatformPayer[];
      assignments: PayerAssignment[];
      requests: Array<{
        id: number;
        providerId: number;
        facilityId: number;
        facilityName: string;
        status: string;
      }>;
      notice: string;
    }>(`${root}/platform`),
  facilities: () =>
    fetchJson<{ facilities: Array<{ id: number; tenantId: number; name: string }> }>(
      `${root}/platform/facilities`,
    ),
  register: (input: { code: string; displayName: string; informationUrl: string }) =>
    send('/platform/payers', 'POST', input),
  update: (id: number, input: { status?: string; requestable?: boolean }) =>
    send(`/platform/payers/${id}`, 'PATCH', input),
  workflow: (id: number, workflow: string, isAllowed: boolean) =>
    send(`/platform/payers/${id}/workflows/${encodeURIComponent(workflow)}`, 'PUT', { isAllowed }),
  assign: (id: number, facilityId: number, isAllowed: boolean) =>
    send(`/platform/payers/${id}/facilities/${facilityId}`, 'PUT', { isAllowed }),
  decide: (id: number, decision: 'APPROVED' | 'REJECTED', reference: string) =>
    send(`/platform/assignments/${id}/production-decision`, 'POST', { decision, reference }),
  catalogue: (facilityId: number) =>
    fetchJson<{ providers: FacilityPayer[]; notice: string }>(
      `${root}/facility/catalogue?facilityId=${facilityId}`,
    ),
  requestAccess: (id: number, facilityId: number) =>
    send(`/facility/payers/${id}/access-request`, 'POST', { facilityId }),
  activate: (id: number, facilityId: number, isActive: boolean) =>
    send(`/facility/payers/${id}/activation`, 'PUT', { facilityId, isActive }),
  configure: (id: number, facilityId: number, environment: string, providerIdentifier: string) =>
    send(`/facility/payers/${id}/environments/${environment}`, 'PUT', {
      facilityId,
      providerIdentifier,
    }),
  test: (id: number, facilityId: number) =>
    send<{ tested: boolean; verified: boolean; message: string }>(
      `/facility/payers/${id}/connection-test`,
      'POST',
      { facilityId },
    ),
  production: (id: number, facilityId: number) =>
    send(`/facility/payers/${id}/production-request`, 'POST', { facilityId }),
};
