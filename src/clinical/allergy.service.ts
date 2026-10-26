/**
 * JaliCare HMIS
 * Patient allergies
 *
 * A prescribing system that cannot answer "is this patient allergic to
 * this?" is not merely incomplete — it is unsafe. Before this module
 * the only allergy datum in the product was a boolean in the theatre
 * safety checklist, and `patients.allergies` was a free-text column
 * nothing wrote to.
 *
 * WHAT THIS DOES
 * ==============
 *
 *   - Records an allergen, the reaction, its severity, who recorded it
 *     and when.
 *   - Keeps resolved and entered-in-error rows. "Reacted to penicillin
 *     in 2019" remains clinically relevant after the episode, and a
 *     withdrawn mistake must not look like it never happened.
 *   - Answers `checkMedication`, which the prescription route calls
 *     before it writes.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * ================================
 *
 * It does not block a prescription. A hard stop on a string match
 * would refuse legitimate care — a documented tolerance, a
 * desensitisation course, a different salt of the same family — and
 * clinicians override hard stops by reflex. The route returns the
 * warnings with the order so the prescriber sees them and their
 * acknowledgement is recorded. Blocking policy belongs to clinical
 * governance, not to a substring match.
 *
 * The matching is deliberately conservative and explainable: a
 * normalised name match on the allergen, or a shared first word of
 * three or more letters ("penicillin" vs "penicillin V"). It does not
 * claim to be a pharmacological interaction engine, and no such claim
 * appears in the UI.
 */

import { and, desc, eq } from 'drizzle-orm';

import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';

import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { ScopeAccessError, resolveFacilityScope } from '../auth/scope.service.ts';

/* ============================================================
   Vocabulary
   ============================================================ */

export const ALLERGEN_TYPES = ['DRUG', 'FOOD', 'ENVIRONMENTAL', 'OTHER'] as const;
export const ALLERGY_SEVERITIES = ['MILD', 'MODERATE', 'SEVERE', 'LIFE_THREATENING'] as const;
export const ALLERGY_STATUSES = ['ACTIVE', 'RESOLVED', 'ENTERED_IN_ERROR'] as const;

export type AllergenType = (typeof ALLERGEN_TYPES)[number];
export type AllergySeverity = (typeof ALLERGY_SEVERITIES)[number];
export type AllergyStatus = (typeof ALLERGY_STATUSES)[number];

export class AllergyError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'AllergyError';
  }
}

/* ============================================================
   Scope
   ============================================================ */

interface AllergyScope {
  facilityId: number;
  tenantId: number;
  userId: number;
}

async function resolveScope(context: AuthorizationContext): Promise<AllergyScope> {
  const facilityId = resolveFacilityScope(context, undefined);

  const [facility] = await db
    .select({ id: schema.facilities.id, tenantId: schema.facilities.tenantId })
    .from(schema.facilities)
    .where(eq(schema.facilities.id, facilityId))
    .limit(1);

  if (!facility) {
    throw new ScopeAccessError('Facility not found.', 'FACILITY_ACCESS_DENIED');
  }

  return {
    facilityId: facility.id,
    tenantId: facility.tenantId,
    userId: context.userId,
  };
}

async function resolvePatient(context: AuthorizationContext, rawPatientId: unknown) {
  const scope = await resolveScope(context);
  const patientId = Number(rawPatientId);

  if (!Number.isSafeInteger(patientId) || patientId <= 0) {
    throw new AllergyError('A valid patient id is required.', 400, 'INVALID_PATIENT_ID');
  }

  const [patient] = await db
    .select({
      id: schema.patients.id,
      tenantId: schema.patients.tenantId,
      firstName: schema.patients.firstName,
      lastName: schema.patients.lastName,
      mrn: schema.patients.mrn,
    })
    .from(schema.patients)
    .where(and(eq(schema.patients.id, patientId), eq(schema.patients.tenantId, scope.tenantId)))
    .limit(1);

  if (!patient) {
    throw new AllergyError('Patient not found.', 404, 'PATIENT_NOT_FOUND');
  }

  return { patient, scope };
}

/* ============================================================
   Matching
   ============================================================ */

export function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Does an allergen name plausibly refer to a medication?
 *
 * Conservative on purpose, and explainable to a clinician: equal after
 * normalisation, one containing the other when the shorter is at least
 * four characters, or a shared leading word of at least four
 * characters. Anything vaguer produces false alarms that train people
 * to ignore the warning.
 */
export function matchesMedication(allergen: string, medication: string): boolean {
  const a = normaliseName(allergen);
  const m = normaliseName(medication);

  if (a === '' || m === '') return false;

  if (a === m) return true;

  if (a.length >= 4 && m.includes(a)) return true;
  if (m.length >= 4 && a.includes(m)) return true;

  const aWord = a.split(' ')[0];
  const mWord = m.split(' ')[0];

  return aWord.length >= 4 && aWord === mWord;
}

/* ============================================================
   Read
   ============================================================ */

export interface AllergyWarning {
  allergyId: number;
  allergen: string;
  allergenType: string;
  severity: string;
  reaction: string | null;
  matchedOn: string;
}

export async function listAllergies(context: AuthorizationContext, rawPatientId: unknown) {
  const { patient } = await resolvePatient(context, rawPatientId);

  const rows = await db
    .select()
    .from(schema.patientAllergies)
    .where(eq(schema.patientAllergies.patientId, patient.id))
    .orderBy(desc(schema.patientAllergies.recordedAt));

  const active = rows.filter((row) => row.status === 'ACTIVE');

  return {
    patientId: patient.id,
    allergies: rows,
    activeCount: active.length,
    highestSeverity:
      active.find((row) => row.severity === 'LIFE_THREATENING')?.severity ??
      active.find((row) => row.severity === 'SEVERE')?.severity ??
      active.find((row) => row.severity === 'MODERATE')?.severity ??
      (active.length > 0 ? 'MILD' : null),
  };
}

/**
 * The check a prescription calls.
 *
 * Returns warnings, not a verdict. An empty array means "nothing in the
 * registry matches this name", which is not the same as "safe" — and
 * the returned object says so in `disclaimer`.
 */
export async function checkMedicationAllergies(
  context: AuthorizationContext,
  rawPatientId: unknown,
  medicationNames: string[],
): Promise<{
  warnings: AllergyWarning[];
  disclaimer: string;
}> {
  const { allergies } = await listAllergies(context, rawPatientId);

  const active = allergies.filter((row) => row.status === 'ACTIVE');

  const warnings: AllergyWarning[] = [];

  for (const medication of medicationNames) {
    if (typeof medication !== 'string' || medication.trim() === '') continue;

    for (const allergy of active) {
      if (!matchesMedication(allergy.allergen, medication)) continue;

      warnings.push({
        allergyId: allergy.id,
        allergen: allergy.allergen,
        allergenType: allergy.allergenType,
        severity: allergy.severity,
        reaction: allergy.reaction,
        matchedOn: medication,
      });
    }
  }

  return {
    warnings,
    disclaimer:
      'Matched against the allergy registry recorded at this facility. An empty result is not a guarantee of safety: it means nothing recorded matches this name.',
  };
}

/* ============================================================
   Validation
   ============================================================ */

export interface AllergyInput {
  allergenType: AllergenType;
  allergen: string;
  reaction: string | null;
  severity: AllergySeverity;
  notes: string | null;
}

export function validateAllergyInput(input: unknown): AllergyInput {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new AllergyError('An allergy object is required.', 400, 'INVALID_ALLERGY_BODY');
  }

  const body = input as Record<string, unknown>;

  const allergen = typeof body.allergen === 'string' ? body.allergen.trim() : '';

  if (allergen.length < 2 || allergen.length > 200) {
    throw new AllergyError(
      'allergen must be between 2 and 200 characters.',
      400,
      'INVALID_ALLERGEN',
    );
  }

  const allergenType =
    typeof body.allergenType === 'string' ? body.allergenType.toUpperCase() : 'DRUG';

  if (!ALLERGEN_TYPES.includes(allergenType as AllergenType)) {
    throw new AllergyError(
      `allergenType must be one of: ${ALLERGEN_TYPES.join(', ')}.`,
      400,
      'INVALID_ALLERGEN_TYPE',
    );
  }

  const severity = typeof body.severity === 'string' ? body.severity.toUpperCase() : 'MODERATE';

  if (!ALLERGY_SEVERITIES.includes(severity as AllergySeverity)) {
    throw new AllergyError(
      `severity must be one of: ${ALLERGY_SEVERITIES.join(', ')}.`,
      400,
      'INVALID_ALLERGY_SEVERITY',
    );
  }

  const reaction =
    typeof body.reaction === 'string' && body.reaction.trim() !== ''
      ? body.reaction.trim().slice(0, 500)
      : null;

  const notes =
    typeof body.notes === 'string' && body.notes.trim() !== ''
      ? body.notes.trim().slice(0, 500)
      : null;

  return {
    allergenType: allergenType as AllergenType,
    allergen,
    reaction,
    severity: severity as AllergySeverity,
    notes,
  };
}

/* ============================================================
   Write
   ============================================================ */

export async function recordAllergy(
  context: AuthorizationContext,
  rawPatientId: unknown,
  rawInput: unknown,
) {
  const { patient, scope } = await resolvePatient(context, rawPatientId);
  const input = validateAllergyInput(rawInput);

  const [row] = await db
    .insert(schema.patientAllergies)
    .values({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      patientId: patient.id,
      allergenType: input.allergenType,
      allergen: input.allergen,
      reaction: input.reaction,
      severity: input.severity,
      status: 'ACTIVE',
      notes: input.notes,
      recordedByUserId: scope.userId,
      recordedAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  await db.insert(schema.auditLogs).values({
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    userId: String(context.userId),
    action: 'CREATE',
    resource: 'PatientAllergy',
    resourceId: String(row.id),
    details: `Allergy recorded: ${input.allergen} (${input.severity})`,
    severity: input.severity === 'LIFE_THREATENING' ? 'WARNING' : 'INFO',
  });

  return row;
}

export async function setAllergyStatus(
  context: AuthorizationContext,
  rawPatientId: unknown,
  rawAllergyId: unknown,
  rawStatus: unknown,
) {
  const { patient, scope } = await resolvePatient(context, rawPatientId);

  const allergyId = Number(rawAllergyId);

  if (!Number.isSafeInteger(allergyId) || allergyId <= 0) {
    throw new AllergyError('A valid allergy id is required.', 400, 'INVALID_ALLERGY_ID');
  }

  const status = typeof rawStatus === 'string' ? rawStatus.toUpperCase() : '';

  if (!ALLERGY_STATUSES.includes(status as AllergyStatus)) {
    throw new AllergyError(
      `status must be one of: ${ALLERGY_STATUSES.join(', ')}.`,
      400,
      'INVALID_ALLERGY_STATUS',
    );
  }

  const [existing] = await db
    .select()
    .from(schema.patientAllergies)
    .where(
      and(
        eq(schema.patientAllergies.id, allergyId),
        eq(schema.patientAllergies.patientId, patient.id),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new AllergyError('Allergy not found.', 404, 'ALLERGY_NOT_FOUND');
  }

  const [row] = await db
    .update(schema.patientAllergies)
    .set({
      status: status as AllergyStatus,
      resolvedAt: status === 'RESOLVED' ? new Date() : existing.resolvedAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.patientAllergies.id, allergyId))
    .returning();

  await db.insert(schema.auditLogs).values({
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    userId: String(context.userId),
    action: 'UPDATE',
    resource: 'PatientAllergy',
    resourceId: String(allergyId),
    details: `Allergy status: ${existing.status} -> ${status}`,
    severity: 'INFO',
  });

  return row;
}
