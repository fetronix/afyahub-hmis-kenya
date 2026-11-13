/** Small payload readers shared by SHA workflows. */
export function asObj(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readStr(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim().length > 0) return val.trim();
  }
  return null;
}

export function readNumMoney(val: unknown): string | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val.toFixed(2);
  if (typeof val === 'string' && /^-?\d+(\.\d{1,4})?$/.test(val.trim())) {
    return Number(val.trim()).toFixed(2);
  }
  return null;
}

export function normalizeIsoDate(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.slice(0, 10);
  return null;
}
