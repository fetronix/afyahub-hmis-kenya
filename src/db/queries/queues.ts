/**
 * JaliCare HMIS
 * Queries: Patient queues, token allocation, and appointments
 *
 * Extracted from `../queries.ts`, which re-exports every function here so that
 * `import * as queries from '../queries.ts'` keeps working. The SQL, the scope
 * checks and the transaction boundaries are moved verbatim; nothing was rewritten.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../index.ts';
import * as schema from '../schema.ts';

import { resolveFacilityScope } from '../../auth/scope.service.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';

import { resolveQueueOrLabScope } from './shared.ts';

import { getFacilityByIdScoped } from './tenancy.ts';

import { moduleLogger } from '../../logging/logger.ts';

const log = moduleLogger('db.queues');

// Queues
export async function getQueues(facilityId?: number, queueType?: string) {
  try {
    const query = db.select().from(schema.queues);
    const conditions = [];
    if (facilityId) conditions.push(eq(schema.queues.facilityId, facilityId));
    if (queueType && queueType !== 'All') conditions.push(eq(schema.queues.queueType, queueType));

    if (conditions.length > 0) {
      return await query
        .where(and(...conditions))
        .orderBy(desc(schema.queues.createdAt))
        .limit(100);
    }
    return await query.orderBy(desc(schema.queues.createdAt)).limit(100);
  } catch (error) {
    log.error({ err: error }, 'queues.fetch_failed');
    throw new Error('Failed to fetch patient queues', { cause: error });
  }
}

/**
 * The prefix a desk's tokens carry.
 *
 * A token is read aloud in a waiting room, so it is three letters and a
 * number, not a timestamp.
 */
export function queueTokenPrefix(queueType: string): string {
  const known: Record<string, string> = {
    triage: 'TRG',
    consultation: 'CON',
    opd: 'OPD',
    pharmacy: 'PHM',
    laboratory: 'LAB',
    lab: 'LAB',
    radiology: 'RAD',
    cashier: 'CSH',
    billing: 'CSH',
    records: 'REC',
    maternity: 'MAT',
    immunisation: 'IMM',
  };

  const key = queueType.trim().toLowerCase();

  if (known[key]) return known[key];

  const letters = queueType.replace(/[^A-Za-z]/g, '').toUpperCase();

  return (letters || 'TOK').slice(0, 3).padEnd(3, 'X');
}

/**
 * The next free token for this desk today.
 *
 * The number is allocated on the server because the browser cannot see
 * the other desk: two receptionists minting `TRG-347` from
 * `Math.random()` both call the same patient, and the person holding
 * the second slip has no way to know.
 */
export async function nextQueueToken(facilityId: number, queueType: string): Promise<string> {
  const [row] = await db
    .select({
      highest: sql<
        number | null
      >`MAX((substring(${schema.queues.tokenNumber} from '([0-9]+)$'))::int)`,
    })
    .from(schema.queues)
    .where(
      and(
        eq(schema.queues.facilityId, facilityId),
        eq(schema.queues.queueType, queueType),
        sql`${schema.queues.createdAt}::date = CURRENT_DATE`,
      ),
    );

  const next = Number(row?.highest ?? 0) + 1;

  return `${queueTokenPrefix(queueType)}-${String(next).padStart(3, '0')}`;
}

export async function createQueueEntry(
  context: AuthorizationContext,
  /*
   * The token is optional: leave it out and the server allocates the
   * next one for this facility and desk.
   */
  data: Omit<typeof schema.queues.$inferInsert, 'tokenNumber'> & {
    tokenNumber?: string | null;
  },
) {
  const scope = await resolveQueueOrLabScope(context, data);

  const suppliedToken =
    typeof data.tokenNumber === 'string' && data.tokenNumber.trim() !== ''
      ? data.tokenNumber.trim()
      : null;

  const tokenNumber = suppliedToken ?? (await nextQueueToken(scope.facilityId, data.queueType));

  try {
    const res = await db
      .insert(schema.queues)
      .values({ ...data, ...scope, tokenNumber })
      .returning();

    return res[0];
  } catch (error) {
    log.error({ err: error }, 'queue_entry.create_failed');
    throw new Error('Failed to create queue entry', { cause: error });
  }
}

export const QUEUE_STATUSES = [
  'Waiting',
  'Called',
  'In-Progress',
  'Completed',
  'Cancelled',
] as const;

/**
 * Move a token, inside the caller's facility.
 *
 * The previous version updated any row by id, so a user at one facility
 * could move another facility's token — and an unknown status string was
 * stored as given.
 */
export async function updateQueueStatusScoped(
  context: AuthorizationContext,
  queueId: number,
  status: string,
) {
  if (!Number.isSafeInteger(queueId) || queueId <= 0) {
    throw new Error('A valid queue token is required.');
  }

  if (!QUEUE_STATUSES.includes(status as (typeof QUEUE_STATUSES)[number])) {
    throw new Error('Invalid queue status.');
  }

  const [token] = await db
    .select()
    .from(schema.queues)
    .where(eq(schema.queues.id, queueId))
    .limit(1);

  if (!token) return null;

  const facility = await getFacilityByIdScoped(context, token.facilityId).catch(() => null);

  if (!facility) return null;

  const [updated] = await db
    .update(schema.queues)
    .set({ status })
    .where(and(eq(schema.queues.id, queueId), eq(schema.queues.facilityId, facility.id)))
    .returning();

  return updated ?? null;
}

/**
 * Close a patient's tokens at a desk.
 *
 * Called when the work the token represents is actually done — a
 * dispensation — so the board stops showing a patient who has left.
 */
export async function completeQueueTokensForPatient(
  context: AuthorizationContext,
  patientId: number,
  queueType: string,
) {
  const facilityId = resolveFacilityScope(context);

  await db
    .update(schema.queues)
    .set({ status: 'Completed' })
    .where(
      and(
        eq(schema.queues.facilityId, facilityId),
        eq(schema.queues.patientId, patientId),
        eq(schema.queues.queueType, queueType),
        inArray(schema.queues.status, ['Waiting', 'Called', 'In-Progress']),
      ),
    );
}

// Appointments
export async function getAppointments(facilityId?: number, practitionerId?: number) {
  try {
    const query = db.select().from(schema.appointments);
    const conditions = [];
    if (facilityId) conditions.push(eq(schema.appointments.facilityId, facilityId));
    if (practitionerId) conditions.push(eq(schema.appointments.practitionerId, practitionerId));

    if (conditions.length > 0) {
      return await query
        .where(and(...conditions))
        .orderBy(desc(schema.appointments.createdAt))
        .limit(50);
    }
    return await query.orderBy(desc(schema.appointments.createdAt)).limit(50);
  } catch (error) {
    log.error({ err: error }, 'appointments.fetch_failed');
    throw new Error('Failed to fetch appointments', { cause: error });
  }
}

export async function createAppointment(data: typeof schema.appointments.$inferInsert) {
  try {
    const res = await db.insert(schema.appointments).values(data).returning();
    return res[0];
  } catch (error) {
    log.error({ err: error }, 'appointment.create_failed');
    throw new Error('Failed to create appointment', { cause: error });
  }
}
