/**
 * JaliCare HMIS — icd schema.
 * Definitions are re-exported by ../schema.ts for existing callers and drizzle-kit.
 */

import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  boolean,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './auth.ts';
import { facilities, tenants } from './tenancy.ts';

export const icd11CatalogueEntries = pgTable(
  'icd11_catalogue_entries',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull(),
    title: text('title').notNull(),
    chapterCode: text('chapter_code'),
    chapterTitle: text('chapter_title'),
    classKind: text('class_kind').default('category').notNull(),
    foundationUri: text('foundation_uri'),
    linearizationUri: text('linearization_uri'),
    releaseId: text('release_id').default('2025-01').notNull(),
    sourceName: text('source_name').default('WHO ICD-11 MMS Official Release').notNull(),
    sourceUrl: text('source_url'),
    keywords: jsonb('keywords').$type<string[]>().default([]).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    isNotifiable: boolean('is_notifiable').default(false).notNull(),
    cachedFromWhoApi: boolean('cached_from_who_api').default(false).notNull(),
    fetchedAt: timestamp('fetched_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    codeReleaseIdx: uniqueIndex('icd11_catalogue_code_release_idx').on(table.code, table.releaseId),
  }),
);

export const icd10ToIcd11Mappings = pgTable(
  'icd10_to_icd11_mappings',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    icd10Code: text('icd10_code').notNull(),
    icd10Title: text('icd10_title').notNull(),
    icd11Code: text('icd11_code'),
    icd11Title: text('icd11_title'),
    icd11Chapter: text('icd11_chapter'),
    foundationUri: text('foundation_uri'),
    linearizationUri: text('linearization_uri'),
    releaseId: text('release_id').default('2025-01').notNull(),
    mappingType: text('mapping_type').default('ONE_TO_ONE').notNull(),
    reviewStatus: text('review_status').default('REQUIRES_CLINICAL_REVIEW').notNull(),
    mappingSource: text('mapping_source').notNull(),
    alternatives: jsonb('alternatives')
      .$type<Array<Record<string, unknown>>>()
      .default([])
      .notNull(),
    notes: text('notes'),
    reviewedByUserId: integer('reviewed_by_user_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    codeReleaseIdx: uniqueIndex('icd10_to_icd11_code_release_idx').on(
      table.facilityId,
      table.icd10Code,
      table.releaseId,
    ),
  }),
);
