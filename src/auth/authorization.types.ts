/**
 * JaliCare HMIS
 * Authorization Types
 */

export interface AuthorizationContext {
  userId: number;
  tenantId: number | null;
  facilityId: number | null;

  roles: string[];
  permissions: string[];

  isSuperAdmin: boolean;
}

export interface AuthorizationResult {
  allowed: boolean;
  reason?: string;
}