import { fetchJson } from './client.ts';
export interface AdapterInfo {
  key: string;
  implementedCapabilities: string[];
  sandboxOnly: boolean;
  productionReady: boolean;
  note: string;
}
export interface HubAccount {
  id: number;
  integrationId: number;
  alias: string;
  accountType: string;
  maskedIdentifier: string;
  authorizationState: string;
  bankAccountId: number | null;
}
export interface HubIntegration {
  id: number;
  providerId: number;
  environment: 'SANDBOX' | 'PRODUCTION';
  enabledCapabilities: string[];
  isEnabled: boolean;
  isEffective: boolean;
  connectionStatus: string;
  lastHealthAt: string | null;
  lastErrorCode: string | null;
  productionApproval: string;
  credentialsConfigured: boolean;
  credentialEnvName: string | null;
  credentials: string;
  accounts: HubAccount[];
}
export interface FacilityProvider {
  id: number;
  code: string;
  displayName: string;
  adapterKey: string;
  documentationUrl: string;
  description: string;
  isAllowed: boolean;
  requestStatus: string;
  availableEnvironments: Array<'SANDBOX' | 'PRODUCTION'>;
  adapter: AdapterInfo;
  integrations: HubIntegration[];
}
export interface PlatformProvider {
  id: number;
  code: string;
  displayName: string;
  adapterKey: string;
  documentationUrl: string;
  description: string;
  status: string;
  requestable: boolean;
  assignedFacilities: number;
  enabledIntegrations: number;
  unavailableIntegrations: number;
  adapter: AdapterInfo;
  capabilities: Array<{ capability: string; isAllowed: boolean }>;
  environments: Array<{
    environment: 'SANDBOX' | 'PRODUCTION';
    isAvailable: boolean;
    sharedReferenceConfigured: boolean;
    sharedContractRecorded: boolean;
  }>;
}
export interface PlatformAssignment {
  providerId: number;
  facilityId: number;
  facilityName: string;
  tenantId: number;
  isAllowed: boolean;
  sharedCredentialsAllowed: boolean;
  integrations: Array<{
    id: number;
    environment: string;
    enabled: boolean;
    connectionStatus: string;
    productionApproval: string;
    lastHealthAt: string | null;
  }>;
}
export interface HubTransaction {
  id: number;
  integrationId: number;
  provider: string;
  environment: string;
  invoiceId: number;
  invoiceNumber: string;
  requestedAmountCents: string;
  providerRequestId: string | null;
  status: string;
  resultCode: string | null;
  createdAt: string;
  lastQueryAt: string | null;
  unverifiedNotifications: number;
}
export interface HubReconciliation {
  id: number;
  transactionId: number;
  billingPaymentId: number;
  status: string;
  matchedAt: string;
  voidedAt: string | null;
}
export interface HubNotification {
  id: number;
  transactionId: number;
  resultCode: string | null;
  verificationState: string;
  receivedAt: string;
}
const base = '/api/payment-hub';
function send<T>(path: string, method: string, body: unknown, key?: string) {
  return fetchJson<T>(`${base}${path}`, {
    method,
    headers: key ? { 'Idempotency-Key': key } : undefined,
    body: JSON.stringify(body),
  });
}
export const paymentHubApi = {
  platform: () =>
    fetchJson<{
      providers: PlatformProvider[];
      assignments: PlatformAssignment[];
      requests: Array<{
        providerId: number;
        facilityId: number;
        facilityName: string;
        status: string;
      }>;
      auditEvents: Array<{
        id: number;
        action: string;
        resource: string;
        facilityId: number | null;
        timestamp: string;
      }>;
      notice: string;
    }>(`${base}/platform`),
  facilities: () =>
    fetchJson<{ facilities: Array<{ id: number; tenantId: number; name: string }> }>(
      `${base}/platform/facilities`,
    ),
  register: (body: unknown) => send('/platform/providers', 'POST', body),
  updateProvider: (id: number, body: unknown) => send(`/platform/providers/${id}`, 'PATCH', body),
  updateEnvironment: (id: number, env: string, body: unknown) =>
    send(`/platform/providers/${id}/environments/${env}`, 'PUT', body),
  updateCapability: (id: number, capability: string, isAllowed: boolean) =>
    send(`/platform/providers/${id}/capabilities/${encodeURIComponent(capability)}`, 'PUT', {
      isAllowed,
    }),
  assign: (id: number, facilityId: number, body: unknown) =>
    send(`/platform/providers/${id}/facilities/${facilityId}`, 'PUT', body),
  decideProduction: (id: number, body: unknown) =>
    send(`/platform/integrations/${id}/production-decision`, 'POST', body),
  catalogue: (facilityId: number) =>
    fetchJson<{ providers: FacilityProvider[]; notice: string }>(
      `${base}/facility/catalogue?facilityId=${facilityId}`,
    ),
  access: (id: number, facilityId: number) =>
    send(`/facility/providers/${id}/access-request`, 'POST', { facilityId }),
  configure: (id: number, body: unknown) =>
    send<{ id: number }>(`/facility/providers/${id}/integrations`, 'POST', body),
  credentials: (id: number, body: unknown) =>
    send(`/facility/integrations/${id}/credentials`, 'PUT', body),
  addAccount: (id: number, body: unknown) =>
    send(`/facility/integrations/${id}/accounts`, 'POST', body),
  health: (id: number, facilityId: number) =>
    send<{ status: string; notice: string }>(`/facility/integrations/${id}/health`, 'POST', {
      facilityId,
    }),
  enabled: (id: number, facilityId: number, enabled: boolean) =>
    send(`/facility/integrations/${id}/enabled`, 'PUT', { facilityId, enabled }),
  productionRequest: (id: number, facilityId: number) =>
    send(`/facility/integrations/${id}/production-request`, 'POST', { facilityId }),
  transactions: (facilityId: number) =>
    fetchJson<{
      transactions: HubTransaction[];
      notifications: HubNotification[];
      reconciliations: HubReconciliation[];
      notice: string;
    }>(`${base}/facility/transactions?facilityId=${facilityId}`),
  collect: (body: unknown, key: string) =>
    send<{ transactionId: number; status: string; notice: string }>(
      '/facility/collections',
      'POST',
      body,
      key,
    ),
  query: (id: number, facilityId: number) =>
    send<{ status: string; notice: string }>(`/facility/transactions/${id}/query`, 'POST', {
      facilityId,
    }),
  reconcile: (id: number, body: unknown) =>
    send(`/facility/transactions/${id}/reconcile`, 'POST', body),
  voidMatch: (id: number, facilityId: number, reason: string) =>
    send(`/facility/reconciliations/${id}/void`, 'POST', { facilityId, reason }),
};
