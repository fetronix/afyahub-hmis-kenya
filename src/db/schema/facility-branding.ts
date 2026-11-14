/**
 * Facility letterhead (branding) schema.
 *
 * One row per uploaded version. Content is immutable after upload; only the
 * lifecycle columns move, and a partial unique index allows at most one ACTIVE
 * version per facility. See drizzle/0089_facility_letterheads.sql.
 */
import { sql } from 'drizzle-orm';
import {
  customType,
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { facilities, tenants } from './tenancy.ts';
import { users } from './auth.ts';

/** Drizzle has no first-class bytea column; this is the documented escape hatch. */
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return 'bytea';
  },
});

export const facilityLetterheads = pgTable(
  'facility_letterheads',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    facilityId: integer('facility_id')
      .notNull()
      .references(() => facilities.id),
    version: integer('version').notNull(),
    status: text('status').notNull().default('DRAFT'),

    headerText: text('header_text'),
    footerText: text('footer_text'),
    accentColor: text('accent_color'),

    logoMime: text('logo_mime'),
    logoBytes: bytea('logo_bytes'),
    logoSha256: text('logo_sha256'),
    logoWidth: integer('logo_width'),
    logoHeight: integer('logo_height'),

    /*
     * The facility's own letterhead, stored verbatim (migration 0090).
     *
     * `sourcePdf` is never selected by a list query and never placed on a web
     * path: the bytes leave the database only through an authorization-checked
     * endpoint. `sourcePdfPages` decides how a multi-page document continues —
     * page 2 of the letterhead is the continuation page when it exists.
     */
    sourcePdf: bytea('source_pdf'),
    sourcePdfSha256: text('source_pdf_sha256'),
    sourcePdfBytes: integer('source_pdf_bytes'),
    sourcePdfPages: integer('source_pdf_pages'),
    pageWidthPt: doublePrecision('page_width_pt'),
    pageHeightPt: doublePrecision('page_height_pt'),

    /*
     * The printable body rectangle, in PDF points from each page edge. The
     * renderer lays content out inside it, so it can never overlap the
     * artwork. `layoutSource` records whether those numbers were measured from
     * the uploaded PDF, adjusted by an administrator, or defaulted.
     */
    bodyTopPt: doublePrecision('body_top_pt'),
    bodyBottomPt: doublePrecision('body_bottom_pt'),
    bodyLeftPt: doublePrecision('body_left_pt'),
    bodyRightPt: doublePrecision('body_right_pt'),
    layoutSource: text('layout_source'),

    checksum: text('checksum').notNull(),

    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),

    activatedBy: integer('activated_by').references(() => users.id),
    activatedAt: timestamp('activated_at'),

    retiredBy: integer('retired_by').references(() => users.id),
    retiredAt: timestamp('retired_at'),
    retireReason: text('retire_reason'),
  },
  (table) => [
    uniqueIndex('facility_letterhead_version_unique').on(table.facilityId, table.version),
    /* Mirrors the database invariant so the intent is visible in code review. */
    uniqueIndex('facility_letterheads_active_unique')
      .on(table.facilityId)
      .where(sql`status = 'ACTIVE'`),
  ],
);

export const facilityLetterheadEvents = pgTable('facility_letterhead_events', {
  id: serial('id').primaryKey(),
  letterheadId: integer('letterhead_id')
    .notNull()
    .references(() => facilityLetterheads.id),
  tenantId: integer('tenant_id').notNull(),
  facilityId: integer('facility_id').notNull(),
  action: text('action').notNull(),
  version: integer('version').notNull(),
  actorUserId: integer('actor_user_id')
    .notNull()
    .references(() => users.id),
  reason: text('reason'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
