/** Only opaque retry and record identifiers are kept in browser storage. */
export interface PendingRefund {
  key: string;
  invoiceId: number;
  paymentId: number;
}

export function readPendingRefund(storage: Storage, name: string): PendingRefund | null {
  const raw = storage.getItem(name);
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== 'object' ||
    !('key' in value) ||
    typeof value.key !== 'string' ||
    !/^[A-Za-z0-9._:-]{8,128}$/.test(value.key) ||
    !('invoiceId' in value) ||
    !Number.isSafeInteger(value.invoiceId) ||
    Number(value.invoiceId) <= 0 ||
    !('paymentId' in value) ||
    !Number.isSafeInteger(value.paymentId) ||
    Number(value.paymentId) <= 0
  ) {
    throw new Error('The saved refund retry identity is invalid. Manual review is required.');
  }
  return { key: value.key, invoiceId: Number(value.invoiceId), paymentId: Number(value.paymentId) };
}

export function savePendingRefund(storage: Storage, name: string, pending: PendingRefund): void {
  storage.setItem(
    name,
    JSON.stringify({
      key: pending.key,
      invoiceId: pending.invoiceId,
      paymentId: pending.paymentId,
    }),
  );
}

export function clearPendingRefund(storage: Storage, name: string, key: string): boolean {
  const current = readPendingRefund(storage, name);
  if (!current || current.key !== key) return false;
  storage.removeItem(name);
  return true;
}
