import { eq } from 'drizzle-orm';

import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { db } from '../../db/index.ts';
import { getFacilityByIdScoped } from '../../db/queries.ts';
import * as schema from '../../db/schema.ts';
import { isIsoDate, type FieldError } from '../maternity-contracts.ts';

export class MaternityDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly fields?: FieldError[],
  ) {
    super(message);
    this.name = 'MaternityDomainError';
  }
}

export function invalid(fields: FieldError[]): never {
  throw new MaternityDomainError(
    'INVALID_INPUT',
    fields.map((field) => field.message).join(' '),
    400,
    fields,
  );
}

export function notFound(what: string): never {
  throw new MaternityDomainError('NOT_FOUND', `${what} was not found.`, 404);
}

export async function facilityInScope(
  context: AuthorizationContext,
  facilityId: unknown,
): Promise<number> {
  const parsed = Number(facilityId);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new MaternityDomainError('FACILITY_REQUIRED', 'A valid facilityId is required.', 400);
  }

  /*
   * getFacilityByIdScoped throws when the facility is outside the
   * caller's scope. Convert that to the same answer as a facility that
   * does not exist: a 403 here would confirm which IDs are real.
   */
  const facility = await getFacilityByIdScoped(context, parsed).catch(() => null);

  if (!facility) notFound('The facility');

  return parsed;
}

export async function patientInScope(context: AuthorizationContext, patientId: unknown) {
  const parsed = Number(patientId);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new MaternityDomainError('PATIENT_REQUIRED', 'A valid patientId is required.', 400);
  }

  const [patient] = await db
    .select({
      id: schema.patients.id,
      tenantId: schema.patients.tenantId,
    })
    .from(schema.patients)
    .where(eq(schema.patients.id, parsed))
    .limit(1);

  if (!patient || patient.tenantId !== context.tenantId) {
    notFound('The patient');
  }

  return patient;
}

export async function resolvePregnancy(context: AuthorizationContext, pregnancyId: unknown) {
  const parsed = Number(pregnancyId);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new MaternityDomainError('PREGNANCY_REQUIRED', 'A valid pregnancyId is required.', 400);
  }

  const [pregnancy] = await db
    .select()
    .from(schema.maternityPregnancies)
    .where(eq(schema.maternityPregnancies.id, parsed))
    .limit(1);

  if (!pregnancy) notFound('The pregnancy record');

  /* Another facility's record answers the same way as a missing one. */
  const facility = await getFacilityByIdScoped(context, pregnancy.facilityId).catch(() => null);

  if (!facility || facility.tenantId !== pregnancy.tenantId) {
    notFound('The pregnancy record');
  }

  return pregnancy;
}

export async function resolveLabour(context: AuthorizationContext, labourRecordId: unknown) {
  const parsed = Number(labourRecordId);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new MaternityDomainError('LABOUR_REQUIRED', 'A valid labourRecordId is required.', 400);
  }

  const [labour] = await db
    .select()
    .from(schema.labourRecords)
    .where(eq(schema.labourRecords.id, parsed))
    .limit(1);

  if (!labour) notFound('The labour record');

  const facility = await getFacilityByIdScoped(context, labour.facilityId).catch(() => null);

  if (!facility || facility.tenantId !== labour.tenantId) {
    notFound('The labour record');
  }

  return labour;
}

export function requireIsoDate(value: unknown, field: string): string {
  if (!isIsoDate(value)) {
    invalid([{ field, message: `${field} must be a valid date (YYYY-MM-DD).` }]);
  }

  return value.trim();
}

export function optionalIsoDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;

  if (!isIsoDate(value)) {
    invalid([{ field, message: `${field} must be a valid date (YYYY-MM-DD).` }]);
  }

  return value.trim();
}

export function optionalTimestamp(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    invalid([
      {
        field,
        message: `${field} must be a date and time (ISO 8601).`,
      },
    ]);
  }

  return value;
}

export function optionalText(value: unknown, max = 2000): string | null {
  if (value === undefined || value === null) return null;

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  if (trimmed.length === 0) return null;

  return trimmed.slice(0, max);
}

export function collect<T>(result: { value: T; error?: FieldError }, errors: FieldError[]): T {
  if (result.error) {
    errors.push(result.error);
    return null as unknown as T;
  }

  return result.value;
}

export function pgErrorCode(error: unknown): string | undefined {
  const direct = (error as { code?: string })?.code;

  if (direct) return direct;

  return (error as { cause?: { code?: string } })?.cause?.code;
}

export function uniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === '23505';
}

export function toNumeric(value: number | null): string | null {
  return value === null ? null : String(value);
}
