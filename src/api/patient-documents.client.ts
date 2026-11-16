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
  is_latest_version?: boolean;
  reviewed_by_actor?: boolean;
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
