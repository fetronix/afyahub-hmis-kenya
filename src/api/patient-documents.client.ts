import { getSessionToken } from './clients/http.ts';
import { getPortalToken } from './portal-client.ts';
export interface ResponsibleDoctor {
  id: number;
  name: string;
  designation: string | null;
}
export interface ResponsibleDoctorOptions {
  currentDoctor: ResponsibleDoctor | null;
  canAssignOthers: boolean;
  doctors: ResponsibleDoctor[];
  hasMore: boolean;
}
export interface PatientFile {
  id: number;
  patient_id: number;
  root_id: number | null;
  version: number;
  title: string;
  category: string;
  document_type: string;
  signing_date: string | null;
  uploaded_at: string;
  uploaded_by?: number;
  uploader_name?: string | null;
  patient_signature: string;
  doctor_signature: string;
  doctor_id: number | null;
  doctor_name?: string | null;
  notes: string | null;
  filename: string;
  mime_type: string;
  radiology_order_id: number | null;
  procedure_name: string | null;
  radiology_attachment_context?: 'PRE_PROCEDURE' | 'POST_REPORTING_HISTORICAL' | null;
  historical?: boolean;
  portal_released?: boolean;
  portal_release_status?: 'NOT_RELEASED' | 'RELEASED' | 'REVOKED';
  portal_released_at?: string | null;
  portal_revoked_at?: string | null;
  portal_reviewed_original?: boolean;
  is_latest_version?: boolean;
  reviewed_by_actor?: boolean;
}
export interface DocumentPageInfo {
  limit: number;
  total: number;
  returned: number;
  has_more: boolean;
  next_cursor: string | null;
}
export interface StaffDocumentPage {
  documents: PatientFile[];
  page: DocumentPageInfo;
}
export type PortalDocumentGroup = 'CONSENT' | 'CLINICAL' | 'OTHER';
export interface PortalDocument {
  id: number;
  title: string;
  group: PortalDocumentGroup;
  group_label: string;
  kind: string;
  document_type: string;
  category: string;
  signing_date: string | null;
  uploaded_at: string;
  version: number;
  is_superseded: boolean;
  has_versions: boolean;
  mime_type: string;
  source: string;
  procedure_name: string | null;
}
export interface PortalDocumentPage {
  documents: PortalDocument[];
  page: DocumentPageInfo;
  groups: { ALL: number; CONSENT: number; CLINICAL: number; OTHER: number };
  empty_state: 'NONE_RELEASED' | 'AWAITING_RELEASE' | 'NO_MATCHES' | null;
  filters: { search: string; group: string; from: string | null; to: string | null };
  downloads_enabled: boolean;
}
export interface PortalDocumentVersion {
  id: number;
  version: number;
  title: string;
  uploaded_at: string;
  signing_date: string | null;
  is_superseded?: boolean;
  current?: boolean;
}
export interface PortalDocumentDetail {
  document: PortalDocument;
  versions: PortalDocumentVersion[];
}
export async function documentRequest<T>(
  path: string,
  options: RequestInit = {},
  portal = false,
): Promise<T> {
  const token = portal ? getPortalToken() : getSessionToken();
  const response = await fetch(`/api/${portal ? 'portal/documents' : 'patient-documents'}${path}`, {
    ...options,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
    cache: 'no-store',
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message ?? data.error ?? 'Document operation failed.');
  }
  if (path.includes('/file'))
    return Object.assign(await response.blob(), {
      derivedPreview: response.headers.get('X-Document-Preview') === 'derived-static',
    }) as T;
  return response.json();
}
export function documentAction<T>(path: string, body: unknown) {
  return documentRequest<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
