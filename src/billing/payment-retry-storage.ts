/** Only the opaque retry identity and invoice ID are kept in browser storage. */
export interface PendingPayment {
  key: string;
  invoiceId: number;
}
export function readPendingPayment(storage: Storage, name: string): PendingPayment | null {
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
    Number(value.invoiceId) <= 0
  )
    throw new Error('The saved payment retry identity is invalid; review is required.');
  return { key: value.key, invoiceId: Number(value.invoiceId) };
}
export function savePendingPayment(storage: Storage, name: string, value: PendingPayment): void {
  storage.setItem(name, JSON.stringify({ key: value.key, invoiceId: value.invoiceId }));
}
export function clearPendingPayment(storage: Storage, name: string, key: string): boolean {
  const current = readPendingPayment(storage, name);
  if (!current || current.key !== key) return false;
  storage.removeItem(name);
  return true;
}
