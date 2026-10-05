export interface LoginInput {
  identifier: string;
  password: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuthenticatedUser {
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
}

export interface LoginResult {
  success: boolean;
  message?: string;
  user?: AuthenticatedUser;
  sessionToken?: string;
  expiresAt?: Date;
  requiresMfa?: boolean;
  requiresPasswordChange?: boolean;
  error?: string;
}