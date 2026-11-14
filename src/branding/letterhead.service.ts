/**
 * Facility letterhead management.
 *
 * WHAT THIS OWNS
 * --------------
 * Uploading, previewing, activating, replacing, withdrawing and reading back a
 * facility's letterhead versions — and nothing else. It does not render
 * documents (see `src/documents/`) and it does not decide who may print.
 *
 * THE RULES IT HOLDS
 * ------------------
 * - Scope. Every read and write is filtered by the caller's tenant *and* the
 *   facility being addressed. A cross-tenant id is indistinguishable from a
 *   missing one: the caller gets a 404, not a 403, so the endpoint cannot be
 *   used to discover that another hospital's letterhead exists.
 * - Immutability. The uploaded bytes never change. A replacement is a new
 *   version, and the database trigger (§0090) enforces that even if this
 *   service is bypassed.
 * - One active version. Activation supersedes the previous one *inside the
 *   same transaction*, and the partial unique index makes a second active row
 *   impossible if that transaction is ever wrong.
 * - History is evidence. Versions are never deleted, and every lifecycle move
 *   writes an append-only event naming the actor, so "who put this letterhead
 *   on the invoices" has an answer that is not a guess.
 */

import { createHash } from 'node:crypto';

import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { hasAllPermissions } from '../auth/authorization.service.ts';
import { requireFacilityScope, requireTenantScope } from '../auth/scope.service.ts';
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import {
  inspectLetterheadPdf,
  LetterheadError,
  type LetterheadErrorCode,
  type LetterheadPdfFacts,
} from './letterhead-pdf.ts';
import {
  defaultBodyRectangle,
  measureLetterheadLayout,
  type BodyRectangle,
} from './letterhead-layout.ts';

export { LetterheadError };
export type { LetterheadErrorCode };

/** Bodies smaller than this cannot carry a document. */
const MIN_BODY_HEIGHT_PT = 120;
const MIN_BODY_WIDTH_PT = 200;

export type LetterheadStatus = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED' | 'WITHDRAWN';

export interface LetterheadVersionView {
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
  /** True when this version carries an uploaded PDF rather than a composed logo. */
  hasPdf: boolean;
  uploadedByUserId: number;
  uploadedAt: string;
  activatedByUserId: number | null;
  activatedAt: string | null;
  retiredByUserId: number | null;
  retiredAt: string | null;
  retireReason: string | null;
}

export interface LetterheadEventView {
  id: number;
  letterheadId: number;
  version: number;
  action: 'UPLOADED' | 'ACTIVATED' | 'SUPERSEDED' | 'WITHDRAWN';
  actorUserId: number;
  reason: string | null;
  createdAt: string;
}

function forbidden(): never {
  throw new LetterheadError(
    'LETTERHEAD_FORBIDDEN',
    'Permission is required to manage facility branding.',
    403,
  );
}

function requireRead(context: AuthorizationContext): void {
  if (!hasAllPermissions(context, ['facility.branding.read'])) forbidden();
}

function requireManage(context: AuthorizationContext): void {
  if (!hasAllPermissions(context, ['facility.branding.read', 'facility.branding.manage'])) {
    forbidden();
  }
}

function notFound(): never {
  throw new LetterheadError('LETTERHEAD_NOT_FOUND', 'Letterhead version not found.', 404);
}

function validId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new LetterheadError('LETTERHEAD_ID_INVALID', 'A valid letterhead id is required.', 400);
  }
  return id;
}

/**
 * Resolve the facility the caller is addressing and prove it is theirs.
 *
 * Super administrators pass `requireFacilityScope` too — an operator acting on
 * a tenant still has to name that tenant explicitly, and the caller supplies
 * it, so nothing is inferred from the letterhead row.
 */
async function scopedFacility(
  context: AuthorizationContext,
  rawFacilityId: number,
): Promise<{ tenantId: number; facilityId: number }> {
  const [facility] = await db
    .select({ id: schema.facilities.id, tenantId: schema.facilities.tenantId })
    .from(schema.facilities)
    .where(eq(schema.facilities.id, validId(rawFacilityId)));
  if (!facility) throw notFound();
  requireTenantScope(context, facility.tenantId);
  requireFacilityScope(context, facility.tenantId, facility.id);
  return { tenantId: facility.tenantId, facilityId: facility.id };
}

function toView(row: typeof schema.facilityLetterheads.$inferSelect): LetterheadVersionView {
  return {
    id: row.id,
    facilityId: row.facilityId,
    version: row.version,
    status: row.status as LetterheadStatus,
    pageWidthPt: row.pageWidthPt,
    pageHeightPt: row.pageHeightPt,
    bodyTopPt: row.bodyTopPt,
    bodyBottomPt: row.bodyBottomPt,
    bodyLeftPt: row.bodyLeftPt,
    bodyRightPt: row.bodyRightPt,
    layoutSource: row.layoutSource,
    sourcePdfBytes: row.sourcePdfBytes,
    sourcePdfPages: row.sourcePdfPages,
    sourcePdfSha256: row.sourcePdfSha256,
    hasPdf: row.sourcePdf !== null,
    uploadedByUserId: row.createdBy,
    uploadedAt: row.createdAt.toISOString(),
    activatedByUserId: row.activatedBy,
    activatedAt: row.activatedAt ? row.activatedAt.toISOString() : null,
    retiredByUserId: row.retiredBy,
    retiredAt: row.retiredAt ? row.retiredAt.toISOString() : null,
    retireReason: row.retireReason,
  };
}

/** Columns every list query selects. `source_pdf` is deliberately excluded. */
const listColumns = {
  id: schema.facilityLetterheads.id,
  facilityId: schema.facilityLetterheads.facilityId,
  version: schema.facilityLetterheads.version,
  status: schema.facilityLetterheads.status,
  pageWidthPt: schema.facilityLetterheads.pageWidthPt,
  pageHeightPt: schema.facilityLetterheads.pageHeightPt,
  bodyTopPt: schema.facilityLetterheads.bodyTopPt,
  bodyBottomPt: schema.facilityLetterheads.bodyBottomPt,
  bodyLeftPt: schema.facilityLetterheads.bodyLeftPt,
  bodyRightPt: schema.facilityLetterheads.bodyRightPt,
  layoutSource: schema.facilityLetterheads.layoutSource,
  sourcePdfBytes: schema.facilityLetterheads.sourcePdfBytes,
  sourcePdfPages: schema.facilityLetterheads.sourcePdfPages,
  sourcePdfSha256: schema.facilityLetterheads.sourcePdfSha256,
  createdBy: schema.facilityLetterheads.createdBy,
  createdAt: schema.facilityLetterheads.createdAt,
  activatedBy: schema.facilityLetterheads.activatedBy,
  activatedAt: schema.facilityLetterheads.activatedAt,
  retiredBy: schema.facilityLetterheads.retiredBy,
  retiredAt: schema.facilityLetterheads.retiredAt,
  retireReason: schema.facilityLetterheads.retireReason,
  hasPdf: sql<boolean>`(${schema.facilityLetterheads.sourcePdf} is not null)`,
};

function toListedView(
  row: {
    [K in keyof typeof listColumns]: unknown;
  } & { hasPdf: boolean },
): LetterheadVersionView {
  const date = (value: unknown) => (value instanceof Date ? value.toISOString() : null);
  return {
    id: row.id as number,
    facilityId: row.facilityId as number,
    version: row.version as number,
    status: row.status as LetterheadStatus,
    pageWidthPt: row.pageWidthPt as number | null,
    pageHeightPt: row.pageHeightPt as number | null,
    bodyTopPt: row.bodyTopPt as number | null,
    bodyBottomPt: row.bodyBottomPt as number | null,
    bodyLeftPt: row.bodyLeftPt as number | null,
    bodyRightPt: row.bodyRightPt as number | null,
    layoutSource: row.layoutSource as string | null,
    sourcePdfBytes: row.sourcePdfBytes as number | null,
    sourcePdfPages: row.sourcePdfPages as number | null,
    sourcePdfSha256: row.sourcePdfSha256 as string | null,
    hasPdf: row.hasPdf,
    uploadedByUserId: row.createdBy as number,
    uploadedAt: date(row.createdAt) ?? '',
    activatedByUserId: row.activatedBy as number | null,
    activatedAt: date(row.activatedAt),
    retiredByUserId: row.retiredBy as number | null,
    retiredAt: date(row.retiredAt),
    retireReason: row.retireReason as string | null,
  };
}

/** Every version of this facility's letterhead, newest first, with its history. */
export async function listLetterheads(
  context: AuthorizationContext,
  rawFacilityId: number,
): Promise<{ versions: LetterheadVersionView[]; events: LetterheadEventView[] }> {
  requireRead(context);
  const scope = await scopedFacility(context, rawFacilityId);

  const rows = await db
    .select(listColumns)
    .from(schema.facilityLetterheads)
    .where(eq(schema.facilityLetterheads.facilityId, scope.facilityId))
    .orderBy(desc(schema.facilityLetterheads.version));

  const events = await db
    .select()
    .from(schema.facilityLetterheadEvents)
    .where(eq(schema.facilityLetterheadEvents.facilityId, scope.facilityId))
    .orderBy(desc(schema.facilityLetterheadEvents.id))
    .limit(200);

  return {
    versions: rows.map((row) => toListedView(row)),
    events: events.map((event) => ({
      id: event.id,
      letterheadId: event.letterheadId,
      version: event.version,
      action: event.action as LetterheadEventView['action'],
      actorUserId: event.actorUserId,
      reason: event.reason,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

/** Load one version, scoped. Returns the row including the stored bytes. */
async function loadVersion(
  context: AuthorizationContext,
  rawId: number,
): Promise<typeof schema.facilityLetterheads.$inferSelect> {
  const id = validId(rawId);
  const [row] = await db
    .select()
    .from(schema.facilityLetterheads)
    .where(eq(schema.facilityLetterheads.id, id));
  if (!row) throw notFound();
  requireTenantScope(context, row.tenantId);
  requireFacilityScope(context, row.tenantId, row.facilityId);
  return row;
}

export async function getLetterhead(
  context: AuthorizationContext,
  rawId: number,
): Promise<LetterheadVersionView> {
  requireRead(context);
  return toView(await loadVersion(context, rawId));
}

/**
 * The stored PDF, for an authenticated download.
 *
 * There is no URL to guess: the bytes are addressed by row id behind the same
 * scope check as everything else, and never written to a static directory.
 */
export async function readLetterheadBytes(
  context: AuthorizationContext,
  rawId: number,
): Promise<{ bytes: Buffer; filename: string; sha256: string }> {
  requireRead(context);
  const row = await loadVersion(context, rawId);
  if (!row.sourcePdf) {
    throw new LetterheadError(
      'LETTERHEAD_NOT_A_DOCUMENT',
      'This version was composed from a logo and text, not uploaded as a PDF.',
      404,
    );
  }
  return {
    bytes: Buffer.from(row.sourcePdf),
    filename: `letterhead-v${row.version}.pdf`,
    sha256: row.sourcePdfSha256 ?? '',
  };
}

export interface UploadLetterheadInput {
  facilityId: number;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  /** Optional correction to the measured body rectangle. */
  body?: Partial<Pick<BodyRectangle, 'bodyTopPt' | 'bodyBottomPt' | 'bodyLeftPt' | 'bodyRightPt'>>;
}

/**
 * Store a new DRAFT version.
 *
 * Validation happens before anything is written, so a rejected file leaves no
 * row, no event and no gap in the version sequence.
 */
export async function uploadLetterhead(
  context: AuthorizationContext,
  input: UploadLetterheadInput,
): Promise<{ letterhead: LetterheadVersionView; measurement: BodyRectangle }> {
  requireManage(context);
  const scope = await scopedFacility(context, input.facilityId);

  const facts: LetterheadPdfFacts = await inspectLetterheadPdf(input.bytes, {
    filename: input.filename,
    mimeType: input.mimeType,
  });
  const measured = await measureLetterheadLayout(input.bytes);
  const body = applyBodyOverride(measured, input.body);
  const sha256 = sha256Hex(input.bytes);

  /*
   * The same file twice is an accident, not a second branding decision. Answer
   * before the unique index does, so the administrator is told which version
   * they already have instead of being shown a constraint name.
   */
  const [duplicate] = await db
    .select({ id: schema.facilityLetterheads.id, version: schema.facilityLetterheads.version })
    .from(schema.facilityLetterheads)
    .where(
      and(
        eq(schema.facilityLetterheads.facilityId, scope.facilityId),
        eq(schema.facilityLetterheads.sourcePdfSha256, sha256),
      ),
    );
  if (duplicate) {
    throw new LetterheadError(
      'LETTERHEAD_DUPLICATE',
      `This file is already stored as version ${duplicate.version}.`,
      409,
    );
  }

  const created = await db.transaction(async (tx) => {
    /*
     * Lock the facility row so two simultaneous uploads cannot compute the same
     * next version number. The unique index would reject the loser, but with an
     * opaque error; this makes the failure impossible instead of merely caught.
     */
    await tx.execute(sql`SELECT id FROM facilities WHERE id = ${scope.facilityId} FOR UPDATE`);

    const [existing] = await tx
      .select({ version: schema.facilityLetterheads.version })
      .from(schema.facilityLetterheads)
      .where(eq(schema.facilityLetterheads.facilityId, scope.facilityId))
      .orderBy(desc(schema.facilityLetterheads.version))
      .limit(1);
    const nextVersion = (existing?.version ?? 0) + 1;

    const [row] = await tx
      .insert(schema.facilityLetterheads)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        version: nextVersion,
        status: 'DRAFT',
        sourcePdf: input.bytes,
        sourcePdfSha256: sha256,
        sourcePdfBytes: input.bytes.length,
        sourcePdfPages: facts.pages,
        pageWidthPt: facts.widthPt,
        pageHeightPt: facts.heightPt,
        bodyTopPt: body.bodyTopPt,
        bodyBottomPt: body.bodyBottomPt,
        bodyLeftPt: body.bodyLeftPt,
        bodyRightPt: body.bodyRightPt,
        layoutSource: body.layoutSource,
        // The 0089 checksum covers the immutable content of a version. For an
        // uploaded PDF that is the file itself.
        checksum: sha256,
        createdBy: context.userId,
      })
      .returning();

    await tx.insert(schema.facilityLetterheadEvents).values({
      letterheadId: row.id,
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      action: 'UPLOADED',
      version: nextVersion,
      actorUserId: context.userId,
      reason: input.filename.slice(0, 200),
    });

    return row;
  });

  return { letterhead: toView(created), measurement: body };
}

/** Clamp an administrator's correction onto the stored page geometry. */
function applyBodyOverride(
  measured: BodyRectangle,
  override: UploadLetterheadInput['body'],
): BodyRectangle {
  if (!override) return measured;
  const next: BodyRectangle = { ...measured };
  if (typeof override.bodyTopPt === 'number') next.bodyTopPt = round2(override.bodyTopPt);
  if (typeof override.bodyBottomPt === 'number') next.bodyBottomPt = round2(override.bodyBottomPt);
  if (typeof override.bodyLeftPt === 'number') next.bodyLeftPt = round2(override.bodyLeftPt);
  if (typeof override.bodyRightPt === 'number') next.bodyRightPt = round2(override.bodyRightPt);
  next.layoutSource = 'ADJUSTED';
  validateBodyRectangle(next);
  return next;
}

function validateBodyRectangle(body: BodyRectangle): void {
  const { pageWidthPt: w, pageHeightPt: h } = body;
  const finite = [body.bodyTopPt, body.bodyBottomPt, body.bodyLeftPt, body.bodyRightPt].every(
    (value) => Number.isFinite(value) && value >= 0,
  );
  if (!finite) {
    throw new LetterheadError(
      'LETTERHEAD_LAYOUT_INVALID',
      'The content area must be four non-negative distances in points.',
      400,
    );
  }
  if (h - body.bodyTopPt - body.bodyBottomPt < MIN_BODY_HEIGHT_PT) {
    throw new LetterheadError(
      'LETTERHEAD_LAYOUT_INVALID',
      `The content area would be ${round2(h - body.bodyTopPt - body.bodyBottomPt)} pt tall; at least ${MIN_BODY_HEIGHT_PT} pt is required.`,
      400,
    );
  }
  if (w - body.bodyLeftPt - body.bodyRightPt < MIN_BODY_WIDTH_PT) {
    throw new LetterheadError(
      'LETTERHEAD_LAYOUT_INVALID',
      `The content area would be ${round2(w - body.bodyLeftPt - body.bodyRightPt)} pt wide; at least ${MIN_BODY_WIDTH_PT} pt is required.`,
      400,
    );
  }
}

/** Correct the body rectangle of a DRAFT version. Frozen once activated. */
export async function updateLetterheadLayout(
  context: AuthorizationContext,
  rawId: number,
  body: NonNullable<UploadLetterheadInput['body']>,
): Promise<LetterheadVersionView> {
  requireManage(context);
  const row = await loadVersion(context, rawId);
  if (row.status !== 'DRAFT') {
    throw new LetterheadError(
      'LETTERHEAD_IMMUTABLE',
      'Only a draft letterhead can be adjusted. Withdraw it and upload a new version.',
      409,
    );
  }
  if (!row.sourcePdf || row.pageWidthPt === null || row.pageHeightPt === null) {
    throw new LetterheadError(
      'LETTERHEAD_NOT_A_DOCUMENT',
      'This version has no uploaded page to lay out.',
      409,
    );
  }
  const next = applyBodyOverride(
    {
      pageWidthPt: row.pageWidthPt,
      pageHeightPt: row.pageHeightPt,
      bodyTopPt: row.bodyTopPt ?? 0,
      bodyBottomPt: row.bodyBottomPt ?? 0,
      bodyLeftPt: row.bodyLeftPt ?? 0,
      bodyRightPt: row.bodyRightPt ?? 0,
      layoutSource: 'ADJUSTED',
    },
    body,
  );

  const [updated] = await db
    .update(schema.facilityLetterheads)
    .set({
      bodyTopPt: next.bodyTopPt,
      bodyBottomPt: next.bodyBottomPt,
      bodyLeftPt: next.bodyLeftPt,
      bodyRightPt: next.bodyRightPt,
      layoutSource: next.layoutSource,
    })
    .where(eq(schema.facilityLetterheads.id, row.id))
    .returning();
  return toView(updated);
}

/**
 * Make a version the facility's active letterhead.
 *
 * Superseding the incumbent and activating the new version is one transaction:
 * a moment with no active letterhead, or with two, is not allowed to exist.
 */
export async function activateLetterhead(
  context: AuthorizationContext,
  rawId: number,
  reason?: string,
): Promise<LetterheadVersionView> {
  requireManage(context);
  const target = await loadVersion(context, rawId);
  if (target.status === 'ACTIVE') return toView(target);
  if (target.status !== 'DRAFT') {
    throw new LetterheadError(
      'LETTERHEAD_NOT_ACTIVATABLE',
      'Only a draft letterhead can be activated. Retired versions are kept for reprints.',
      409,
    );
  }
  if (!target.sourcePdf && target.headerText === null && target.footerText === null) {
    throw new LetterheadError('LETTERHEAD_EMPTY', 'This draft has no content to activate.', 409);
  }

  /*
   * `now()` rather than a JS Date.
   *
   * A JS Date is serialised by the driver in the *process* timezone, and a
   * `timestamp` column stores that wall clock verbatim; the database defaults
   * (`now()`) store UTC. Mixing the two makes "which version was active at
   * this instant" depend on the server's TZ. The lifecycle timestamps are
   * therefore written by the database, exactly like the document timestamps
   * they are compared against.
   */
  const activated = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM facilities WHERE id = ${target.facilityId} FOR UPDATE`);

    const incumbent = await tx
      .select({ id: schema.facilityLetterheads.id, version: schema.facilityLetterheads.version })
      .from(schema.facilityLetterheads)
      .where(
        and(
          eq(schema.facilityLetterheads.facilityId, target.facilityId),
          eq(schema.facilityLetterheads.status, 'ACTIVE'),
        ),
      );

    for (const row of incumbent) {
      if (row.id === target.id) continue;
      await tx
        .update(schema.facilityLetterheads)
        .set({
          status: 'SUPERSEDED',
          retiredBy: context.userId,
          retiredAt: sql`now()`,
          retireReason: reason?.trim() || 'Superseded by a newer letterhead',
        })
        .where(eq(schema.facilityLetterheads.id, row.id));
      await tx.insert(schema.facilityLetterheadEvents).values({
        letterheadId: row.id,
        tenantId: target.tenantId,
        facilityId: target.facilityId,
        action: 'SUPERSEDED',
        version: row.version,
        actorUserId: context.userId,
        reason: reason?.trim() || `Superseded by version ${target.version}`,
      });
    }

    const [row] = await tx
      .update(schema.facilityLetterheads)
      .set({
        status: 'ACTIVE',
        activatedBy: context.userId,
        activatedAt: sql`now()`,
      })
      .where(eq(schema.facilityLetterheads.id, target.id))
      .returning();

    await tx.insert(schema.facilityLetterheadEvents).values({
      letterheadId: target.id,
      tenantId: target.tenantId,
      facilityId: target.facilityId,
      action: 'ACTIVATED',
      version: target.version,
      actorUserId: context.userId,
      reason: reason?.trim() || null,
    });

    return row;
  });

  return toView(activated);
}

/**
 * Retire a version.
 *
 * An active version becomes WITHDRAWN (leaving the facility with no letterhead
 * until another is activated — which is a legitimate choice, and printed
 * documents fall back to plain A4); a draft becomes WITHDRAWN without ever
 * having been used.
 */
export async function withdrawLetterhead(
  context: AuthorizationContext,
  rawId: number,
  reason: string,
): Promise<LetterheadVersionView> {
  requireManage(context);
  const row = await loadVersion(context, rawId);
  if (row.status === 'WITHDRAWN') return toView(row);
  if (row.status === 'SUPERSEDED') {
    throw new LetterheadError(
      'LETTERHEAD_NOT_WITHDRAWABLE',
      'A superseded version is already retired and is kept for reprints.',
      409,
    );
  }
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  if (trimmed.length < 3) {
    throw new LetterheadError(
      'LETTERHEAD_REASON_REQUIRED',
      'Give a reason of at least 3 characters for withdrawing a letterhead.',
      400,
    );
  }

  const withdrawn = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.facilityLetterheads)
      .set({
        status: 'WITHDRAWN',
        retiredBy: context.userId,
        retiredAt: sql`now()`,
        retireReason: trimmed.slice(0, 500),
      })
      .where(
        and(
          eq(schema.facilityLetterheads.id, row.id),
          inArray(schema.facilityLetterheads.status, ['DRAFT', 'ACTIVE']),
        ),
      )
      .returning();

    await tx.insert(schema.facilityLetterheadEvents).values({
      letterheadId: row.id,
      tenantId: row.tenantId,
      facilityId: row.facilityId,
      action: 'WITHDRAWN',
      version: row.version,
      actorUserId: context.userId,
      reason: trimmed.slice(0, 500),
    });

    return updated;
  });

  return toView(withdrawn);
}

export interface ResolvedLetterhead {
  id: number;
  version: number;
  status: LetterheadStatus;
  bytes: Buffer | null;
  pageWidthPt: number;
  pageHeightPt: number;
  bodyTopPt: number;
  bodyBottomPt: number;
  bodyLeftPt: number;
  bodyRightPt: number;
  label: string;
}

function toResolved(row: typeof schema.facilityLetterheads.$inferSelect): ResolvedLetterhead {
  const width = row.pageWidthPt ?? 595.28;
  const height = row.pageHeightPt ?? 841.89;
  const fallback = defaultBodyRectangle(width, height);
  const activated = row.activatedAt ? row.activatedAt.toISOString().slice(0, 10) : null;
  return {
    id: row.id,
    version: row.version,
    status: row.status as LetterheadStatus,
    bytes: row.sourcePdf ? Buffer.from(row.sourcePdf) : null,
    pageWidthPt: width,
    pageHeightPt: height,
    bodyTopPt: row.bodyTopPt ?? fallback.bodyTopPt,
    bodyBottomPt: row.bodyBottomPt ?? fallback.bodyBottomPt,
    bodyLeftPt: row.bodyLeftPt ?? fallback.bodyLeftPt,
    bodyRightPt: row.bodyRightPt ?? fallback.bodyRightPt,
    label: activated
      ? `Letterhead v${row.version} (activated ${activated})`
      : `Letterhead v${row.version}`,
  };
}

/**
 * The facility's active letterhead, or null when it has none.
 *
 * Deliberately not permission-checked: this is called by document rendering
 * *after* the caller has already been authorized for the document itself. It
 * takes a facility id that came from a row the caller was allowed to read.
 */
export async function resolveActiveLetterhead(
  tenantId: number,
  facilityId: number,
): Promise<ResolvedLetterhead | null> {
  const [row] = await db
    .select()
    .from(schema.facilityLetterheads)
    .where(
      and(
        eq(schema.facilityLetterheads.tenantId, tenantId),
        eq(schema.facilityLetterheads.facilityId, facilityId),
        eq(schema.facilityLetterheads.status, 'ACTIVE'),
      ),
    );
  return row ? toResolved(row) : null;
}

/**
 * A specific version, whatever its status.
 *
 * This is the reprint path: a finalized invoice records the letterhead it was
 * issued under, and that version may since have been superseded or withdrawn.
 * Returning it is the whole point — the reprint must look like the original.
 */
export async function resolveLetterheadVersion(
  tenantId: number,
  facilityId: number,
  letterheadId: number,
): Promise<ResolvedLetterhead | null> {
  const [row] = await db
    .select()
    .from(schema.facilityLetterheads)
    .where(
      and(
        eq(schema.facilityLetterheads.id, letterheadId),
        eq(schema.facilityLetterheads.tenantId, tenantId),
        eq(schema.facilityLetterheads.facilityId, facilityId),
      ),
    );
  return row ? toResolved(row) : null;
}

/**
 * The letterhead a document must print on, given when it was issued.
 *
 * WHY DERIVED, AND NOT A COLUMN PER DOCUMENT TABLE
 * -----------------------------------------------
 * Every version records when it was activated and when it retired, and 0090
 * makes both write-once. That history is enough to answer "which letterhead was
 * in effect at this instant" exactly, for every document type, without adding a
 * letterhead id to eight separate tables or a second snapshot table that would
 * only ever duplicate those two timestamps.
 *
 * A document is therefore branded with the stationery of its own issuance:
 * replacing the letterhead today cannot restyle an invoice, a receipt, an LPO, a
 * laboratory report or a discharge summary that was issued last week — which is
 * the property an auditor asks for first.
 *
 * `issuedAt` must be the moment the document itself was issued (finalized,
 * received, reported, discharged), not the moment somebody pressed Print.
 *
 * Returns null when no letterhead was in effect:
 * - the facility had never activated one, or
 * - it had withdrawn it and not yet activated a replacement (a real gap, and
 *   the honest answer is plain A4 rather than borrowing a later version).
 */
export async function resolveLetterheadAt(
  tenantId: number,
  facilityId: number,
  issuedAt: Date | string | null | undefined,
): Promise<ResolvedLetterhead | null> {
  const wallClock = toUtcWallClock(issuedAt);
  if (!wallClock) {
    /* An unparseable issuance time cannot be placed in history; the active
     * letterhead is the only defensible answer, and the caller is told which
     * one it got through the label printed in the footer. */
    return resolveActiveLetterhead(tenantId, facilityId);
  }

  /*
   * The comparison is done entirely inside PostgreSQL, against a timestamp
   * literal in UTC. Neither side is a JS Date: the driver would parse a
   * `timestamp` column in the process timezone, and the process timezone is a
   * deployment detail (the test harness runs with TZ=Africa/Nairobi). A
   * letterhead history must not answer differently because of it.
   */
  const [row] = await db
    .select()
    .from(schema.facilityLetterheads)
    .where(
      and(
        eq(schema.facilityLetterheads.tenantId, tenantId),
        eq(schema.facilityLetterheads.facilityId, facilityId),
        sql`${schema.facilityLetterheads.activatedAt} IS NOT NULL`,
        sql`${schema.facilityLetterheads.activatedAt} <= ${wallClock}::timestamp`,
        sql`(${schema.facilityLetterheads.retiredAt} IS NULL OR ${schema.facilityLetterheads.retiredAt} > ${wallClock}::timestamp)`,
      ),
    )
    .orderBy(desc(schema.facilityLetterheads.activatedAt))
    .limit(1);
  return row ? toResolved(row) : null;
}

/**
 * A timestamp expressed as the wall clock the database stores.
 *
 * `timestamp` columns hold UTC wall clock here: every default is `now()`, and
 * the Drizzle mapping reads them as UTC. The comparison is therefore made
 * against an explicit UTC timestamp literal, never against a driver-parsed
 * value whose meaning would depend on the process timezone.
 */
export function toUtcWallClock(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/** The letterhead id to record on a finalization, or null when none is active. */
export async function activeLetterheadIdFor(
  tenantId: number,
  facilityId: number,
): Promise<number | null> {
  const [row] = await db
    .select({ id: schema.facilityLetterheads.id })
    .from(schema.facilityLetterheads)
    .where(
      and(
        eq(schema.facilityLetterheads.tenantId, tenantId),
        eq(schema.facilityLetterheads.facilityId, facilityId),
        eq(schema.facilityLetterheads.status, 'ACTIVE'),
      ),
    );
  return row?.id ?? null;
}

/** SHA-256 of the stored bytes, matching `source_pdf_sha256`. */
export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
