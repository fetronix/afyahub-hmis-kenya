/**
 * A browser keeps only the opaque retry key and prescription identifier.
 * Names, clinical notes, tokens and request bodies are not stored here.
 * The server remains authoritative; clearing browser storage or using a
 * different browser requires a manual dispensing-record review.
 */
export interface PendingDispense {
  key: string;
  prescriptionId: number;
}

export function readPendingDispense(storage: Storage, name: string): PendingDispense | null {
  const raw = storage.getItem(name);
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== 'object' ||
    !('key' in value) ||
    typeof value.key !== 'string' ||
    !/^[A-Za-z0-9._:-]{8,128}$/.test(value.key) ||
    !('prescriptionId' in value) ||
    !Number.isSafeInteger(value.prescriptionId) ||
    Number(value.prescriptionId) <= 0
  ) {
    throw new Error('The saved dispensing retry identity is invalid. Manual review is required.');
  }
  return { key: value.key, prescriptionId: Number(value.prescriptionId) };
}

export function savePendingDispense(
  storage: Storage,
  name: string,
  pending: PendingDispense,
): void {
  storage.setItem(
    name,
    JSON.stringify({ key: pending.key, prescriptionId: pending.prescriptionId }),
  );
}

/** Never erase a different pending operation created by another tab. */
export function clearPendingDispense(storage: Storage, name: string, key: string): boolean {
  const current = readPendingDispense(storage, name);
  if (!current || current.key !== key) return false;
  storage.removeItem(name);
  return true;
}
