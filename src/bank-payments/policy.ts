import type { AuthorizationContext } from '../auth/authorization.types.ts';

export class BankPaymentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'BankPaymentError';
  }
}

/** Platform administration never implies authority over facility money. */
export function requireBankPermission(context: AuthorizationContext, permission: string): void {
  if (
    context.isSuperAdmin ||
    context.roles.includes('SUPER_ADMIN') ||
    !context.tenantId ||
    !context.facilityId ||
    !context.permissions.includes(permission)
  ) {
    throw new BankPaymentError(
      'BANK_PERMISSION_DENIED',
      'Facility finance permission is required.',
      403,
    );
  }
}

/** A designated finance administrator needs BOTH facility-admin membership and this grant. */
export function requireBankAdministrator(context: AuthorizationContext): void {
  requireBankPermission(context, 'bank_payments.configure');
  if (!context.roles.includes('FACILITY_ADMIN')) {
    throw new BankPaymentError(
      'BANK_ADMIN_REQUIRED',
      'A designated facility finance administrator is required.',
      403,
    );
  }
}

export function assertIndependent(actor: number, ...previousActors: (number | null)[]): void {
  if (previousActors.includes(actor)) {
    throw new BankPaymentError(
      'INDEPENDENT_REVIEW_REQUIRED',
      'The submitter, verifier and settlement approver must be different people.',
      403,
    );
  }
}

export function bankReference(value: string): string {
  return value.trim().toUpperCase();
}

export function isBankMethod(value: string): boolean {
  return /bank|transfer|eft|rtgs|pesalink/i.test(value);
}
