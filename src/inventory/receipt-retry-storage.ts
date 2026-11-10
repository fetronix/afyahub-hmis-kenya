/**
 * Keep only an opaque retry key, item ID and one-way request fingerprint in
 * the browser. Stock, costs and batch details remain on the server. Clearing
 * browser data or switching devices requires manual receipt review.
 */
export interface PendingInventoryReceipt {
  key: string;
  itemId: number;
  fingerprint: string;
}

export interface ReceiptFingerprintInput {
  facilityId: number;
  itemId: number;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  costPerUnit: string;
}

export async function fingerprintReceipt(input: ReceiptFingerprintInput): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new Error('Secure browser receipt identity is unavailable.');
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      1,
      input.facilityId,
      input.itemId,
      input.batchNumber,
      input.expiryDate,
      input.quantity,
      input.costPerUnit,
    ]),
  );
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function readPendingReceipt(storage: Storage, name: string): PendingInventoryReceipt | null {
  const raw = storage.getItem(name);
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== 'object' ||
    !('key' in value) ||
    typeof value.key !== 'string' ||
    !/^[A-Za-z0-9._:-]{8,128}$/.test(value.key) ||
    !('itemId' in value) ||
    !Number.isSafeInteger(value.itemId) ||
    Number(value.itemId) <= 0 ||
    !('fingerprint' in value) ||
    typeof value.fingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.fingerprint)
  )
    throw new Error('The saved receipt identity is invalid; manual review is required.');
  return { key: value.key, itemId: Number(value.itemId), fingerprint: value.fingerprint };
}

export function savePendingReceipt(
  storage: Storage,
  name: string,
  pending: PendingInventoryReceipt,
): void {
  const previous = readPendingReceipt(storage, name);
  if (previous && (previous.key !== pending.key || previous.fingerprint !== pending.fingerprint))
    throw new Error('A different receipt retry identity already exists.');
  storage.setItem(name, JSON.stringify(pending));
  const saved = readPendingReceipt(storage, name);
  if (!saved || saved.key !== pending.key || saved.fingerprint !== pending.fingerprint)
    throw new Error('The receipt retry identity could not be verified.');
}

/** Do not erase a newer pending operation from another tab. */
export function clearPendingReceipt(storage: Storage, name: string, key: string): boolean {
  const current = readPendingReceipt(storage, name);
  if (!current || current.key !== key) return false;
  storage.removeItem(name);
  return true;
}
