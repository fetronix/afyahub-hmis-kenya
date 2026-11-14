/** Display-only: a sandbox provider status never settles an operational invoice. */
export function collectionStatusLabel(status: string, resultCode: string | null): string {
  if (status === 'FAILED' && resultCode === '1032') return 'CANCELLED BY CUSTOMER';
  if (status === 'PENDING' && resultCode && resultCode !== '0')
    return 'PENDING — QUERY INCONCLUSIVE';
  if (status === 'PROVIDER_CONFIRMED' && resultCode !== '0')
    return 'REVIEW REQUIRED — INCONSISTENT QUERY EVIDENCE';
  if (status === 'PROVIDER_CONFIRMED') return 'PROVIDER REPORTED SUCCESS — NOT SETTLED';
  return status.replaceAll('_', ' ');
}

export function collectionStatusNotice(status: string, resultCode: string | null): string {
  if (status === 'PROVIDER_CONFIRMED' && resultCode !== '0')
    return 'The stored success status lacks matching query evidence. Review it; no payment should be assumed.';
  if (status === 'FAILED' && resultCode === '1032')
    return 'The scoped provider query reported cancellation. No receipt or invoice payment was created.';
  switch (status) {
    case 'INITIATING':
      return 'The request is being prepared. Do not repeat it while its outcome is unknown.';
    case 'PENDING':
      return resultCode && resultCode !== '0'
        ? 'The latest provider query was inconclusive. Request acceptance is not proof of payment.'
        : 'The request was accepted for processing; this is not proof of payment.';
    case 'UNKNOWN':
      return 'The dispatch outcome is unknown. Review the request before sending another.';
    case 'PROVIDER_CONFIRMED':
      return 'The provider status query reported success, but amount, receipt and callback authenticity are not verified. This request created no invoice payment.';
    case 'FAILED':
      return 'The request failed or requires review. No receipt or invoice payment was created.';
    case 'REVIEW_REQUIRED':
      return 'Conflicting or incomplete evidence requires review; do not assume payment or repeat the request.';
    default:
      return 'The request status is unavailable. Review it before taking further action.';
  }
}
