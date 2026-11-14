/**
 * Facility branding and printable documents — browser client.
 *
 * Two shapes of request live here:
 *
 * - JSON calls, through the shared `fetchJson` so the session token, error
 *   shaping and 401 handling stay in one place.
 * - Binary calls (the letterhead PDF, a printed document), which cannot go
 *   through `fetchJson`: it parses JSON. They read the same session token and
 *   return a Blob so the caller can preview it in an iframe or save it.
 *
 * The binary endpoints require a bearer token, so a plain `<a href>` or an
 * `<iframe src>` will NOT work — the browser sends no Authorization header.
 * Fetching the bytes and handing the browser an object URL is the only way to
 * show a document that is protected by an authenticated endpoint.
 */

import { API_BASE, fetchJson, getSessionToken } from './http.ts';

export type LetterheadStatus = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED' | 'WITHDRAWN';

export interface LetterheadVersion {
  id: number;
  facilityId: number;
  version: number;
  status: LetterheadStatus;
  pageWidthPt: number | null;
  pageHeightPt: number | null;
  bodyTopPt: number | null;
  bodyBottomPt: number | null;
  bodyLeftPt: number | null;
  bodyRightPt: number | null;
  layoutSource: string | null;
  sourcePdfBytes: number | null;
  sourcePdfPages: number | null;
  sourcePdfSha256: string | null;
  hasPdf: boolean;
  uploadedByUserId: number;
  uploadedAt: string;
  activatedByUserId: number | null;
  activatedAt: string | null;
  retiredByUserId: number | null;
  retiredAt: string | null;
  retireReason: string | null;
}

export interface LetterheadEvent {
  id: number;
  letterheadId: number;
  version: number;
  action: 'UPLOADED' | 'ACTIVATED' | 'SUPERSEDED' | 'WITHDRAWN';
  actorUserId: number;
  reason: string | null;
  createdAt: string;
}

export interface LetterheadState {
  versions: LetterheadVersion[];
  events: LetterheadEvent[];
}

export interface BodyRectanglePatch {
  bodyTopPt?: number;
  bodyBottomPt?: number;
  bodyLeftPt?: number;
  bodyRightPt?: number;
}

const base = (facilityId: number, tail = '') =>
  `${API_BASE}/facility-branding/facilities/${facilityId}/letterheads${tail}`;

async function fetchBinary(url: string, options: RequestInit = {}): Promise<Blob> {
  const headers = new Headers(options.headers);
  const token = getSessionToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    let message = 'The document could not be loaded.';
    try {
      const body = (await response.json()) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      /* A binary error body is not JSON; the status is all we have. */
    }
    throw new Error(message);
  }
  return response.blob();
}

export const brandingClient = {
  async list(facilityId: number): Promise<LetterheadState> {
    return fetchJson<LetterheadState & { success: boolean }>(base(facilityId));
  },

  /**
   * Upload the raw PDF.
   *
   * The body is the file itself, not multipart: the server mounts a raw parser
   * before its JSON parser for exactly this route. The filename travels in the
   * query string because it is metadata for the audit trail, not a path.
   */
  async upload(facilityId: number, file: File): Promise<{ letterhead: LetterheadVersion }> {
    return fetchJson<{ success: boolean; letterhead: LetterheadVersion }>(
      `${base(facilityId)}?filename=${encodeURIComponent(file.name)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf' },
        body: file,
      },
    );
  },

  async adjust(facilityId: number, letterheadId: number, patch: BodyRectanglePatch) {
    return fetchJson<{ success: boolean; letterhead: LetterheadVersion }>(
      base(facilityId, `/${letterheadId}`),
      { method: 'PATCH', body: JSON.stringify(patch) },
    );
  },

  async activate(facilityId: number, letterheadId: number, reason?: string) {
    return fetchJson<{ success: boolean; letterhead: LetterheadVersion }>(
      base(facilityId, `/${letterheadId}/activate`),
      { method: 'POST', body: JSON.stringify({ reason }) },
    );
  },

  async withdraw(facilityId: number, letterheadId: number, reason: string) {
    return fetchJson<{ success: boolean; letterhead: LetterheadVersion }>(
      base(facilityId, `/${letterheadId}/withdraw`),
      { method: 'POST', body: JSON.stringify({ reason }) },
    );
  },

  /** The stored PDF as a blob, for preview or download. */
  preview(facilityId: number, letterheadId: number): Promise<Blob> {
    return fetchBinary(base(facilityId, `/${letterheadId}/file`));
  },

  /**
   * A real document rendered on this letterhead, before it is activated.
   *
   * This is the preview that decides activation: it shows the administrator's
   * own finalized invoice on the candidate stationery, through the same
   * renderer the issued document will use.
   */
  previewDocument(facilityId: number, letterheadId: number): Promise<Blob> {
    return fetchBinary(base(facilityId, `/${letterheadId}/preview-document`));
  },
};

/** Printed documents, by type. */
export type PrintableDocumentKind =
  | 'invoices'
  | 'receipts'
  | 'credit-notes'
  | 'purchase-orders'
  | 'goods-received-notes'
  | 'laboratory-orders'
  | 'radiology-orders';

export const documentClient = {
  invoice(id: number): Promise<Blob> {
    return fetchBinary(`${API_BASE}/documents/invoices/${id}/pdf`);
  },

  receipt(id: number, thermal = false): Promise<Blob> {
    return fetchBinary(`${API_BASE}/documents/receipts/${id}/pdf${thermal ? '?thermal=1' : ''}`);
  },

  creditNote(id: number): Promise<Blob> {
    return fetchBinary(`${API_BASE}/documents/credit-notes/${id}/pdf`);
  },

  purchaseOrder(id: number): Promise<Blob> {
    return fetchBinary(`${API_BASE}/documents/purchase-orders/${id}/pdf`);
  },

  goodsReceivedNote(id: number): Promise<Blob> {
    return fetchBinary(`${API_BASE}/documents/goods-received-notes/${id}/pdf`);
  },

  laboratoryReport(id: number): Promise<Blob> {
    return fetchBinary(`${API_BASE}/documents/laboratory-orders/${id}/pdf`);
  },

  radiologyReport(id: number): Promise<Blob> {
    return fetchBinary(`${API_BASE}/documents/radiology-orders/${id}/pdf`);
  },

  dischargeSummary(admissionId: number): Promise<Blob> {
    return fetchBinary(`${API_BASE}/documents/admissions/${admissionId}/discharge-summary.pdf`);
  },
};

/**
 * Open a protected blob in a new tab, or save it.
 *
 * The object URL is revoked after a minute rather than immediately: revoking it
 * while the new tab is still loading leaves the user with a blank page.
 */
export function openBlob(blob: Blob, filename?: string): void {
  const url = URL.createObjectURL(blob);
  if (filename) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
