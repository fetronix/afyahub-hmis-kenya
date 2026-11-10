/** Only an opaque retry key and non-secret request controls are persisted. */
export interface PendingCollection {
  key: string;
  invoiceId: number;
  integrationId: number;
  allowOverpayment: boolean;
  confirmSeparateRequest: boolean;
}

export function readPendingCollection(storage: Storage, name: string): PendingCollection | null {
  const raw = storage.getItem(name);
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid collection recovery data.');
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.key !== 'string' ||
    !/^[A-Za-z0-9._:/-]{8,120}$/.test(candidate.key) ||
    !Number.isSafeInteger(candidate.invoiceId) ||
    Number(candidate.invoiceId) <= 0 ||
    !Number.isSafeInteger(candidate.integrationId) ||
    Number(candidate.integrationId) <= 0 ||
    typeof candidate.allowOverpayment !== 'boolean' ||
    typeof candidate.confirmSeparateRequest !== 'boolean'
  )
    throw new Error('Invalid collection recovery data.');
  return {
    key: candidate.key,
    invoiceId: Number(candidate.invoiceId),
    integrationId: Number(candidate.integrationId),
    allowOverpayment: candidate.allowOverpayment,
    confirmSeparateRequest: candidate.confirmSeparateRequest,
  };
}

export function savePendingCollection(
  storage: Storage,
  name: string,
  value: PendingCollection,
): void {
  storage.setItem(name, JSON.stringify(value));
}

export function clearPendingCollection(storage: Storage, name: string, key: string): boolean {
  const current = readPendingCollection(storage, name);
  if (!current || current.key !== key) return false;
  storage.removeItem(name);
  return true;
}
