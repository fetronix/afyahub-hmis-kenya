/**
 * Global platform administration is not a facility financial role. Existing
 * databases may already have these grants on the global role; do not delete
 * role records during seeding, but never treat them as facility authority.
 * Global payment/payer adapter permissions live in their separate namespaces.
 */
export function isFacilityFinancialPermission(code: string): boolean {
  return ['billing.', 'accounting.', 'tariffs.', 'insurance.'].some((prefix) =>
    code.startsWith(prefix),
  );
}
