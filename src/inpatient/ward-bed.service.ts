/**
 * JaliCare HMIS
 * Ward and bed setup
 *
 * The inpatient board was read-only: wards and beds could only appear if
 * someone ran the demo seed, and the seed creates sample patients as well.
 * A real facility therefore had a permanently empty ward dropdown and no
 * way to fill it. This module is the missing write path.
 *
 * Three rules shape it:
 *
 *   1. **The facility is decided by the session, never the body.** A
 *      ward is created at the facility the caller is authorised for; a
 *      bed inherits its facility from its ward.
 *
 *   2. **No invented numbers.** A ward's capacity is counted from the
 *      beds that exist, not typed in. A rate left blank is stored as
 *      NULL, not as the schema's historical 1500.00 default, so the
 *      screen can say "not priced" instead of showing a fee nobody set.
 *
 *   3. **History is not deleted.** A ward or bed that has ever held a
 *      patient cannot be deleted — the admission would lose the place it
 *      happened in. Those are retired instead (the ward is deactivated,
 *      the bed is taken out of service), and the refusal says so.
 */

import { and, count, eq, inArray, sql } from 'drizzle-orm';

import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';

import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { resolveFacilityScope } from '../auth/scope.service.ts';
import { getFacilityByIdScoped } from '../db/queries.ts';

import {
  BED_STATUS_SETTABLE,
  GENDER_ALLOCATIONS,
  InpatientDomainError,
} from '../db/inpatient-contracts.ts';

/* ============================================================
   LIMITS
   ============================================================ */

const MAX_BEDS_PER_REQUEST = 60;

/* ============================================================
   HELPERS
   ============================================================ */

function pgErrorCode(error: unknown): string | undefined {
  return (
    (error as { code?: string })?.code ??
    (error as { cause?: { code?: string } })?.cause?.code
  );
}

function requiredText(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  const text = typeof value === 'string' ? value.trim() : '';

  if (text.length < 2) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      `${field} is required.`,
      400,
    );
  }

  if (text.length > maxLength) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      `${field} must be ${maxLength} characters or fewer.`,
      400,
    );
  }

  return text;
}

function oneOf(
  value: unknown,
  field: string,
  allowed: readonly string[],
): string {
  const text = typeof value === 'string' ? value.trim() : '';

  const match = allowed.find(
    (option) => option.toLowerCase() === text.toLowerCase(),
  );

  if (!match) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      `${field} must be one of: ${allowed.join(', ')}.`,
      400,
    );
  }

  return match;
}

/**
 * A money field, or NULL.
 *
 * Blank input is stored as NULL on purpose: the column carries a
 * historical default of 1500.00, and a bed charged at a rate nobody
 * entered is a bill waiting to happen.
 */
function optionalMoney(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;

  const text = typeof value === 'number' ? String(value) : String(value).trim();

  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text)) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      `${field} must be a positive amount with at most two decimal places, or left blank.`,
      400,
    );
  }

  if (Number(text) <= 0) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      `${field} must be greater than zero, or left blank.`,
      400,
    );
  }

  return Number(text).toFixed(2);
}

async function facilityForContext(
  context: AuthorizationContext,
  requestedFacilityId?: number | null,
) {
  const facilityId = resolveFacilityScope(context, requestedFacilityId);

  const facility = await getFacilityByIdScoped(context, facilityId).catch(
    () => null,
  );

  if (!facility) {
    throw new InpatientDomainError(
      'FACILITY_NOT_FOUND',
      'Facility not found.',
      404,
    );
  }

  return facility;
}

async function requireWardInScope(
  context: AuthorizationContext,
  wardId: unknown,
) {
  const id = Number(wardId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      'A valid ward ID is required.',
      400,
    );
  }

  const [ward] = await db
    .select()
    .from(schema.wards)
    .where(eq(schema.wards.id, id))
    .limit(1);

  if (!ward) {
    throw new InpatientDomainError('WARD_NOT_FOUND', 'Ward not found.', 404);
  }

  /* Another facility's ward answers as absent, not as forbidden. */
  const facility = await getFacilityByIdScoped(context, ward.facilityId).catch(
    () => null,
  );

  if (!facility) {
    throw new InpatientDomainError('WARD_NOT_FOUND', 'Ward not found.', 404);
  }

  return { ward, facility };
}

async function requireBedInScope(
  context: AuthorizationContext,
  bedId: unknown,
) {
  const id = Number(bedId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      'A valid bed ID is required.',
      400,
    );
  }

  const [bed] = await db
    .select()
    .from(schema.beds)
    .where(eq(schema.beds.id, id))
    .limit(1);

  if (!bed) {
    throw new InpatientDomainError('BED_NOT_FOUND', 'Bed not found.', 404);
  }

  const { ward } = await requireWardInScope(context, bed.wardId);

  return { bed, ward };
}

/**
 * A ward's capacity is the beds it actually has.
 *
 * `total_beds` was typed in by hand and defaulted to 20, so a six-bed
 * ward could advertise twenty and the board would look half empty
 * forever. It is now derived after every bed change.
 */
async function syncWardCapacity(wardId: number): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(schema.beds)
    .where(eq(schema.beds.wardId, wardId));

  const total = Number(value ?? 0);

  await db
    .update(schema.wards)
    .set({ totalBeds: total })
    .where(eq(schema.wards.id, wardId));

  return total;
}

/* ============================================================
   WARDS
   ============================================================ */

export type CreateWardInput = {
  facilityId?: number | null;
  name: string;
  code: string;
  wardType: string;
  genderAllocation: string;
  dailyRate?: string | number | null;
};

export async function createWard(
  context: AuthorizationContext,
  input: CreateWardInput,
) {
  const facility = await facilityForContext(context, input.facilityId);

  const name = requiredText(input.name, 'Ward name', 120);

  const rawCode = requiredText(input.code, 'Ward code', 20).toUpperCase();
  const code = rawCode.replace(/\s+/g, '-').replace(/-+/g, '-');

  if (!/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(code)) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      'Ward code may contain only letters, digits and dashes.',
      400,
    );
  }

  const wardType = requiredText(input.wardType, 'Ward type', 60);

  const genderAllocation = oneOf(
    input.genderAllocation,
    'Gender allocation',
    GENDER_ALLOCATIONS,
  );

  const dailyRate = optionalMoney(input.dailyRate, 'Daily rate');

  try {
    const [created] = await db
      .insert(schema.wards)
      .values({
        facilityId: facility.id,
        name,
        code,
        wardType,
        genderAllocation,
        /*
         * Zero until beds exist. Passing NULL would fall back to the
         * column's 20, which would be a capacity nobody counted.
         */
        totalBeds: 0,
        dailyRate,
        isActive: true,
      })
      .returning();

    return created;
  } catch (error) {
    if (pgErrorCode(error) === '23505') {
      throw new InpatientDomainError(
        'WARD_CODE_EXISTS',
        `This facility already has a ward with the code ${code}.`,
        409,
      );
    }

    throw error;
  }
}

export type UpdateWardInput = {
  name?: string;
  wardType?: string;
  genderAllocation?: string;
  dailyRate?: string | number | null;
  isActive?: boolean;
};

export async function updateWard(
  context: AuthorizationContext,
  wardId: unknown,
  input: UpdateWardInput,
) {
  const { ward } = await requireWardInScope(context, wardId);

  const patch: Record<string, unknown> = {};

  if (input.name !== undefined) {
    patch.name = requiredText(input.name, 'Ward name', 120);
  }

  if (input.wardType !== undefined) {
    patch.wardType = requiredText(input.wardType, 'Ward type', 60);
  }

  if (input.genderAllocation !== undefined) {
    patch.genderAllocation = oneOf(
      input.genderAllocation,
      'Gender allocation',
      GENDER_ALLOCATIONS,
    );
  }

  /*
   * `dailyRate` is only touched when the caller sends the key, so an
   * edit form that omits the field cannot silently blank a rate.
   */
  if ('dailyRate' in input) {
    patch.dailyRate = optionalMoney(input.dailyRate, 'Daily rate');
  }

  if (input.isActive !== undefined) {
    if (typeof input.isActive !== 'boolean') {
      throw new InpatientDomainError(
        'INVALID_INPUT',
        'isActive must be true or false.',
        400,
      );
    }

    /* A retired ward cannot be retired twice into an occupied one. */
    if (input.isActive === false) {
      const [{ value }] = await db
        .select({ value: count() })
        .from(schema.beds)
        .where(
          and(
            eq(schema.beds.wardId, ward.id),
            sql`${schema.beds.currentPatientId} IS NOT NULL`,
          ),
        );

      if (Number(value ?? 0) > 0) {
        throw new InpatientDomainError(
          'WARD_OCCUPIED',
          'This ward still has patients in it. Discharge or transfer them before retiring the ward.',
          409,
        );
      }
    }

    patch.isActive = input.isActive;
  }

  if (Object.keys(patch).length === 0) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      'Nothing to update. Send at least one field.',
      400,
    );
  }

  const [updated] = await db
    .update(schema.wards)
    .set(patch)
    .where(eq(schema.wards.id, ward.id))
    .returning();

  return updated;
}

/**
 * Delete a ward that never held a patient.
 *
 * A ward with admissions is refused: its beds are referenced by those
 * records, and deleting the place an admission happened in would leave
 * the history pointing at nothing. Retire it instead.
 */
export async function deleteWard(
  context: AuthorizationContext,
  wardId: unknown,
) {
  const { ward } = await requireWardInScope(context, wardId);

  const [{ value: admissions }] = await db
    .select({ value: count() })
    .from(schema.admissions)
    .where(eq(schema.admissions.wardId, ward.id));

  if (Number(admissions ?? 0) > 0) {
    throw new InpatientDomainError(
      'WARD_HAS_HISTORY',
      `This ward has ${admissions} admission(s) on record, so it cannot be deleted. Retire it instead — retiring keeps the history and hides it from new admissions.`,
      409,
    );
  }

  const [{ value: occupied }] = await db
    .select({ value: count() })
    .from(schema.beds)
    .where(
      and(
        eq(schema.beds.wardId, ward.id),
        sql`${schema.beds.currentPatientId} IS NOT NULL`,
      ),
    );

  if (Number(occupied ?? 0) > 0) {
    throw new InpatientDomainError(
      'WARD_OCCUPIED',
      'This ward still has patients in it and cannot be deleted.',
      409,
    );
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.beds).where(eq(schema.beds.wardId, ward.id));
    await tx.delete(schema.wards).where(eq(schema.wards.id, ward.id));
  });

  return { deleted: true, wardId: ward.id, code: ward.code };
}

/* ============================================================
   BEDS
   ============================================================ */

export type CreateBedsInput = {
  wardId: number;
  /**
   * Explicit bed numbers. When absent, `prefix` + `startNumber` +
   * `count` generate them, which is how a real ward is set up: nobody
   * types twenty bed numbers by hand.
   */
  bedNumbers?: string[];
  prefix?: string;
  startNumber?: number;
  count?: number;
  bedType: string;
  dailyCharge?: string | number | null;
};

function normaliseBedNumber(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';

  if (text.length === 0) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      'A bed number cannot be blank.',
      400,
    );
  }

  if (text.length > 20) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      `Bed number "${text}" is longer than 20 characters.`,
      400,
    );
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9 -]*$/.test(text)) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      `Bed number "${text}" may contain only letters, digits, spaces and dashes.`,
      400,
    );
  }

  return text;
}

function bedNumbersFor(input: CreateBedsInput): string[] {
  if (Array.isArray(input.bedNumbers) && input.bedNumbers.length > 0) {
    const explicit = input.bedNumbers.map(normaliseBedNumber);

    if (explicit.length > MAX_BEDS_PER_REQUEST) {
      throw new InpatientDomainError(
        'INVALID_INPUT',
        `Add at most ${MAX_BEDS_PER_REQUEST} beds at a time.`,
        400,
      );
    }

    const seen = new Set<string>();
    const duplicates = new Set<string>();

    for (const number of explicit) {
      if (seen.has(number)) duplicates.add(number);
      seen.add(number);
    }

    if (duplicates.size > 0) {
      throw new InpatientDomainError(
        'INVALID_INPUT',
        `The same bed number appears twice: ${[...duplicates].join(', ')}.`,
        400,
      );
    }

    return explicit;
  }

  const rawPrefix = typeof input.prefix === 'string' ? input.prefix.trim() : '';

  if (!rawPrefix) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      'A bed number prefix is required, for example ICU-BED.',
      400,
    );
  }

  const prefix = rawPrefix.toUpperCase().replace(/\s+/g, '-').replace(/-+$/, '');

  if (!/^[A-Z0-9][A-Z0-9-]{0,11}$/.test(prefix)) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      'The bed prefix may contain only letters, digits and dashes.',
      400,
    );
  }

  const startNumber = Number(input.startNumber ?? 1);
  const count = Number(input.count ?? 0);

  if (!Number.isSafeInteger(startNumber) || startNumber < 1 || startNumber > 999) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      'The first bed number must be between 1 and 999.',
      400,
    );
  }

  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > MAX_BEDS_PER_REQUEST
  ) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      `The number of beds must be between 1 and ${MAX_BEDS_PER_REQUEST}.`,
      400,
    );
  }

  if (startNumber + count - 1 > 999) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      'That range runs past bed 999.',
      400,
    );
  }

  return Array.from({ length: count }, (_, index) => {
    const number = startNumber + index;

    return `${prefix}-${String(number).padStart(2, '0')}`;
  });
}

export async function createBeds(
  context: AuthorizationContext,
  input: CreateBedsInput,
) {
  const { ward } = await requireWardInScope(context, input.wardId);

  if (ward.isActive === false) {
    throw new InpatientDomainError(
      'WARD_RETIRED',
      'This ward is retired. Reactivate it before adding beds.',
      409,
    );
  }

  const bedType = requiredText(input.bedType, 'Bed type', 60);
  const dailyCharge = optionalMoney(input.dailyCharge, 'Daily charge');

  const numbers = bedNumbersFor(input);

  /*
   * Report the collision by name rather than letting the unique index
   * answer with a constraint name the receptionist cannot act on.
   */
  const existing = await db
    .select({ bedNumber: schema.beds.bedNumber })
    .from(schema.beds)
    .where(
      and(
        eq(schema.beds.wardId, ward.id),
        inArray(schema.beds.bedNumber, numbers),
      ),
    );

  if (existing.length > 0) {
    throw new InpatientDomainError(
      'BED_NUMBER_EXISTS',
      `This ward already has: ${existing.map((row) => row.bedNumber).join(', ')}. Nothing was added.`,
      409,
    );
  }

  try {
    const created = await db.transaction(async (tx) => {
      const rows = await tx
        .insert(schema.beds)
        .values(
          numbers.map((bedNumber) => ({
            wardId: ward.id,
            bedNumber,
            bedType,
            status: 'Available',
            dailyCharge,
          })),
        )
        .returning();

      return rows;
    });

    await syncWardCapacity(ward.id);

    return { created, wardId: ward.id, totalBeds: numbers.length };
  } catch (error) {
    if (pgErrorCode(error) === '23505') {
      throw new InpatientDomainError(
        'BED_NUMBER_EXISTS',
        'One of those bed numbers already exists in this ward. Nothing was added.',
        409,
      );
    }

    throw error;
  }
}

export type UpdateBedInput = {
  bedNumber?: string;
  bedType?: string;
  dailyCharge?: string | number | null;
  status?: string;
};

export async function updateBed(
  context: AuthorizationContext,
  bedId: unknown,
  input: UpdateBedInput,
) {
  const { bed } = await requireBedInScope(context, bedId);

  const patch: Record<string, unknown> = {};

  if (input.bedNumber !== undefined) {
    const bedNumber = normaliseBedNumber(input.bedNumber);

    if (bedNumber !== bed.bedNumber) {
      const [clash] = await db
        .select({ id: schema.beds.id })
        .from(schema.beds)
        .where(
          and(
            eq(schema.beds.wardId, bed.wardId),
            eq(schema.beds.bedNumber, bedNumber),
          ),
        )
        .limit(1);

      if (clash) {
        throw new InpatientDomainError(
          'BED_NUMBER_EXISTS',
          `This ward already has a bed numbered ${bedNumber}.`,
          409,
        );
      }
    }

    patch.bedNumber = bedNumber;
  }

  if (input.bedType !== undefined) {
    patch.bedType = requiredText(input.bedType, 'Bed type', 60);
  }

  if ('dailyCharge' in input) {
    patch.dailyCharge = optionalMoney(input.dailyCharge, 'Daily charge');
  }

  if (input.status !== undefined) {
    const status = String(input.status);

    if (!BED_STATUS_SETTABLE.has(status)) {
      throw new InpatientDomainError(
        'BED_STATUS_NOT_ALLOWED',
        'Occupancy is created by admitting a patient, not by editing a bed.',
        400,
      );
    }

    if (
      bed.currentPatientId !== null &&
      bed.currentPatientId !== undefined &&
      status !== 'Occupied'
    ) {
      throw new InpatientDomainError(
        'BED_STATUS_CONFLICT',
        'This bed is occupied. Discharge or transfer the patient before changing its status.',
        409,
      );
    }

    patch.status = status;
  }

  if (Object.keys(patch).length === 0) {
    throw new InpatientDomainError(
      'INVALID_INPUT',
      'Nothing to update. Send at least one field.',
      400,
    );
  }

  patch.updatedAt = new Date();

  const [updated] = await db
    .update(schema.beds)
    .set(patch)
    .where(eq(schema.beds.id, bed.id))
    .returning();

  return updated;
}

/**
 * Delete a bed that has never held a patient.
 *
 * A bed with admissions is refused, and a bed with a patient in it is
 * refused more bluntly: deleting the bed under a patient would erase the
 * place they are lying.
 */
export async function deleteBed(
  context: AuthorizationContext,
  bedId: unknown,
) {
  const { bed } = await requireBedInScope(context, bedId);

  if (
    bed.currentPatientId !== null &&
    bed.currentPatientId !== undefined
  ) {
    throw new InpatientDomainError(
      'BED_OCCUPIED',
      'This bed has a patient in it. Discharge or transfer the patient first.',
      409,
    );
  }

  const [{ value: admissions }] = await db
    .select({ value: count() })
    .from(schema.admissions)
    .where(eq(schema.admissions.bedId, bed.id));

  if (Number(admissions ?? 0) > 0) {
    throw new InpatientDomainError(
      'BED_HAS_HISTORY',
      `This bed has ${admissions} admission(s) on record, so it cannot be deleted. Set it to Maintenance instead — that takes it out of the board and keeps the history.`,
      409,
    );
  }

  await db.delete(schema.beds).where(eq(schema.beds.id, bed.id));

  await syncWardCapacity(bed.wardId);

  return { deleted: true, bedId: bed.id, bedNumber: bed.bedNumber };
}
