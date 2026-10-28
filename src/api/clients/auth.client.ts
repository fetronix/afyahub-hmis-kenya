import {
  API_BASE,
  ApiError,
  clearSessionToken,
  fetchJson,
  isHtmlPayload,
  sanitizeServerErrorMessage,
  setSessionToken,
} from './http.ts';

export interface AuthenticatedUser {
  id: number;
  uid: string;
  username: string;
  email: string;
  fullName: string;
  tenantId: number | null;
  facilityId: number | null;
  designation?: string | null;
  roles?: string[];
  permissions?: string[];
  isSuperAdmin?: boolean;
  accountStatus: string;
  mustChangePassword: boolean;
  mfaEnabled: boolean;
  mfaRequired: boolean;
}

export interface LoginResponse {
  success: boolean;
  message?: string;
  error?: string;

  user?: {
    id: number;
    uid: string;
    username: string;
    email: string;
    fullName: string;
    tenantId: number | null;
    facilityId: number | null;
    accountStatus: string;
    mustChangePassword: boolean;
    mfaEnabled: boolean;
    mfaRequired: boolean;
  };

  sessionToken?: string;
  expiresAt?: string;

  requiresMfa?: boolean;
  requiresPasswordChange?: boolean;
}

export interface SessionResponse {
  success: boolean;

  user: AuthenticatedUser;

  session: {
    id: number;
    expiresAt: string;
    lastActivityAt: string;
  };
}

export interface RbacPermission {
  id: number;
  code: string;
  name: string;
  module: string;
  description: string | null;
  assignable: boolean;
}

export interface RbacRole {
  id: number;
  tenantId: number | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  permissionIds: number[];
  permissionCodes: string[];
  hasFacilityOverride: boolean;
  canEdit: boolean;
}

export interface RbacCatalogueRole {
  name: string;
  description: string;
  permissionCount: number;
  permissions: string[];
  exists: boolean;
  isActive: boolean | null;
  missingPermissionCodes: string[];
  unknownPermissionCodes: string[];
}

export interface RbacCatalogueCoverage {
  roleCount: number;
  roles: RbacCatalogueRole[];
  missingCount: number;
  driftCount: number;
}

export interface RbacRolesResponse {
  roles: RbacRole[];
  permissions: RbacPermission[];
  catalogue?: RbacCatalogueCoverage;
}

export interface RbacCatalogueApplyResult {
  createdRoles: string[];
  toppedUpRoles: Array<{ name: string; granted: number }>;
  skippedRoles: string[];
  addedPermissionLinks: number;
}

export const authClient = {
  getRbacRoles: async (facilityId: number): Promise<RbacRolesResponse> => {
    const response = await fetchJson<{
      success: boolean;
      data?: RbacRolesResponse;
      message?: string;
      error?: string;
    }>(`${API_BASE}/platform/rbac/roles?facilityId=${encodeURIComponent(String(facilityId))}`);

    if (
      !response.success ||
      !response.data ||
      !Array.isArray(response.data.roles) ||
      !Array.isArray(response.data.permissions)
    ) {
      throw new Error(
        response.message || response.error || 'Invalid RBAC roles response from server.',
      );
    }

    return response.data;
  },

  updateRbacRolePermissions: (
    roleId: number,
    facilityId: number,
    permissionIds: number[],
  ): Promise<{ success: boolean; message?: string }> =>
    fetchJson<{ success: boolean; message?: string }>(
      `${API_BASE}/platform/rbac/roles/${roleId}/permissions`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facilityId, permissionIds }),
      },
    ),

  applyRbacCatalogue: async (
    facilityId: number,
    options: { roleNames?: string[]; topUpExisting?: boolean } = {},
  ): Promise<RbacCatalogueApplyResult> => {
    const response = await fetchJson<{
      success: boolean;
      data?: RbacCatalogueApplyResult;
      message?: string;
      error?: string;
    }>(`${API_BASE}/platform/rbac/catalogue/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        facilityId,
        roleNames: options.roleNames,
        topUpExisting: options.topUpExisting === true,
      }),
    });

    if (!response.success || !response.data) {
      throw new Error(
        response.message || response.error || 'The catalogue roles could not be created.',
      );
    }

    return response.data;
  },

  getSubscriptionPeriods: async (): Promise<Record<string, any>[]> => {
    const response = await fetchJson<{
      success?: boolean;
      data?: Record<string, any>[];
      message?: string;
      error?: string;
    }>(`${API_BASE}/platform/subscription-periods`);

    if (response.success === false) {
      throw new ApiError(
        sanitizeServerErrorMessage(
          response.message ?? response.error,
          'Subscription data unavailable.',
        ),
        400,
        response.error,
      );
    }

    if (!Array.isArray(response.data)) {
      throw new ApiError(
        'Subscription endpoint returned an unexpected payload.',
        502,
        'INVALID_SUBSCRIPTION_PAYLOAD',
      );
    }

    return response.data;
  },

  login: async (identifier: string, password: string): Promise<LoginResponse> => {
    const loginPath = `${API_BASE}/auth/login`;
    let response: Response;

    try {
      response = await fetch(loginPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          identifier,
          password,
        }),
      });
    } catch {
      throw new ApiError(
        'Unable to reach the JaliCare HMIS server. Check your connection or try again shortly.',
        503,
        'SERVICE_UNAVAILABLE',
      );
    }

    const contentType = (response.headers?.get?.('content-type') ?? '').toLowerCase();
    const rawBody =
      typeof response.text === 'function' ? await response.text().catch(() => '') : '';

    if (isHtmlPayload(contentType, rawBody)) {
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        throw new ApiError(
          'The JaliCare HMIS service is temporarily unavailable. Please try again shortly.',
          response.status,
          'SERVICE_UNAVAILABLE',
        );
      }

      throw new ApiError(
        `Expected JSON from ${loginPath}, but received an HTML document (HTTP ${response.status}). Check API routing or proxy configuration.`,
        response.status,
        'UNEXPECTED_HTML_RESPONSE',
      );
    }

    let result: LoginResponse;

    try {
      result = rawBody.trim()
        ? (JSON.parse(rawBody) as LoginResponse)
        : {
            success: false,
            error: 'INVALID_SERVER_RESPONSE',
            message: 'The server returned an empty response.',
          };
    } catch {
      result = {
        success: false,
        error: 'INVALID_SERVER_RESPONSE',
        message: 'The server returned an invalid response.',
      };
    }

    if (!response.ok) {
      const safeMessage = sanitizeServerErrorMessage(
        result.message ?? result.error,
        response.status >= 500
          ? 'The authentication service encountered an error. Please try again.'
          : `HTTP error ${response.status}`,
      );

      throw new ApiError(safeMessage, response.status, result.error);
    }

    if (result.success && result.sessionToken) {
      setSessionToken(result.sessionToken);
    }

    return result;
  },

  getSession: (): Promise<SessionResponse> =>
    fetchJson<SessionResponse>(`${API_BASE}/auth/session`),

  logout: async () => {
    try {
      return await fetchJson<{
        success: boolean;
        message: string;
      }>(`${API_BASE}/auth/logout`, {
        method: 'POST',
      });
    } finally {
      clearSessionToken();
    }
  },

  clearLocalSession: () => {
    clearSessionToken();
  },
};
