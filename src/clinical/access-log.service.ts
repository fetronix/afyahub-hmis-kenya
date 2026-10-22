/**
 * JaliCare HMIS
 * Patient record access log
 *
 * Kenya's Data Protection Act asks a data controller to know who
 * looked at a patient's record and why. The table has existed since
 * the original schema, but only the FHIR endpoint ever wrote to it —
 * every screen in the application read patient data without leaving a
 * trace.
 *
 * This module is the single place that writes those rows. It is
 * deliberately strict: if the write fails, the caller must not serve
 * the record. An unaudited read is worse than a failed one.
 */

import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import type { AuthorizationContext } from '../auth/authorization.types.ts';

export const ACCESS_ACTIONS = [
  'VIEW',
  'DOWNLOAD',
  'EXPORT',
  'SHARE',
  'UPDATE',
  'CREATE',
  'PRINT',
  'IMPORT',
] as const;

export type AccessAction = (typeof ACCESS_ACTIONS)[number];

export const ACCESS_CHANNELS = [
  'PATIENT_PORTAL',
  'STAFF_PORTAL',
  'API',
  'REFERRAL',
  'FHIR',
  'EMERGENCY',
] as const;

export type AccessChannel = (typeof ACCESS_CHANNELS)[number];

export interface AccessRequestFacts {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface PatientAccessEntry {
  context: AuthorizationContext;
  patientId: number;
  tenantId: number;
  facilityId?: number | null;
  action: AccessAction;
  channel?: AccessChannel;
  recordType?: string;
  recordId?: number | null;
  purpose: string;
  request?: AccessRequestFacts;
}

/**
 * Explicit purposes.
 *
 * A free-text field invites "test" and "checking", which tells an
 * auditor nothing. The register asks for a lawful basis, so the caller
 * picks one and the log carries a code.
 */
export const ACCESS_PURPOSES = [
  'DIRECT_CARE',
  'CARE_COORDINATION',
  'BILLING',
  'QUALITY_AUDIT',
  'PATIENT_REQUEST',
  'EMERGENCY',
  'FHIR_EXCHANGE',
  'ADMINISTRATION',
  'RESEARCH_CONSENTED',
] as const;

export type AccessPurpose = (typeof ACCESS_PURPOSES)[number];

const CHANNEL_FOR_PURPOSE: Record<AccessPurpose, AccessChannel> = {
  DIRECT_CARE: 'STAFF_PORTAL',
  CARE_COORDINATION: 'STAFF_PORTAL',
  BILLING: 'STAFF_PORTAL',
  QUALITY_AUDIT: 'STAFF_PORTAL',
  PATIENT_REQUEST: 'PATIENT_PORTAL',
  EMERGENCY: 'EMERGENCY',
  FHIR_EXCHANGE: 'FHIR',
  ADMINISTRATION: 'STAFF_PORTAL',
  RESEARCH_CONSENTED: 'API',
};

export function channelForPurpose(purpose: AccessPurpose): AccessChannel {
  return CHANNEL_FOR_PURPOSE[purpose] ?? 'STAFF_PORTAL';
}

/**
 * Write one access row.
 *
 * Throws on failure on purpose — callers rely on this to refuse a read
 * they could not account for.
 */
export async function logPatientAccess(entry: PatientAccessEntry) {
  if (!Number.isSafeInteger(entry.patientId) || entry.patientId <= 0) {
    throw new Error('A valid patient is required before access can be logged.');
  }

  if (!entry.purpose || String(entry.purpose).trim() === '') {
    throw new Error('An access purpose is required before a record is served.');
  }

  const [row] = await db
    .insert(schema.patientRecordAccessLogs)
    .values({
      patientId: entry.patientId,
      userId: entry.context.userId ?? null,
      tenantId: entry.tenantId,
      facilityId: entry.facilityId ?? entry.context.facilityId ?? null,
      action: entry.action,
      accessChannel: entry.channel ?? channelForPurpose(entry.purpose as AccessPurpose),
      recordType: entry.recordType ?? 'Patient',
      recordId: entry.recordId ?? entry.patientId,
      purpose: entry.purpose,
      ipAddress: entry.request?.ipAddress ?? null,
      userAgent: entry.request?.userAgent ?? null,
    })
    .returning();

  return row;
}

/**
 * Same, but a failed log never blocks the caller.
 *
 * Reserved for writes the user has already committed — an allergy or a
 * consent that is on disk whether or not the log lands. Reads use the
 * strict variant.
 */
export async function logPatientAccessQuietly(
  entry: PatientAccessEntry,
): Promise<void> {
  try {
    await logPatientAccess(entry);
  } catch (error) {
    console.error(
      'Patient access log could not be written:',
      error instanceof Error ? error.message : error,
    );
  }
}
