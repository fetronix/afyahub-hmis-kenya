/**
 * JaliCare HMIS
 * Schema: Public-health (MOH) reports and the audit trail
 *
 * Extracted from `../schema.ts`, which re-exports every table defined here so
 * that `import * as schema from '../schema.ts'` and drizzle.config.ts keep
 * working untouched. Tables are grouped by the domain that owns them; the
 * relations that join two domains stay in the barrel, because a relation is a
 * statement about both and belongs to neither.
 */

import { pgTable, serial, text, integer, timestamp, index } from 'drizzle-orm/pg-core';

import { facilities } from './tenancy.ts';

export const publicHealthReports = pgTable('public_health_reports', {
  id: serial('id').primaryKey(),

  facilityId: integer('facility_id')
    .references(() => facilities.id)
    .notNull(),

  diseaseCode: text('disease_code').notNull(),

  diseaseName: text('disease_name').notNull(),

  casesCount: integer('cases_count').default(1),

  mortalityCount: integer('mortality_count').default(0),

  ageGroup: text('age_group').default('Over 5 Years'),

  epiWeek: text('epi_week').notNull(),

  reportedAt: timestamp('reported_at').defaultNow().notNull(),

  reportedBy: text('reported_by'),

  status: text('status').default('DRAFT'),

  submittedAt: timestamp('submitted_at'),

  submissionReference: text('submission_reference'),
});

/* ============================================================
   44. AUDIT TRAIL & SECURITY LOGS
   ============================================================ */

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id'),

    facilityId: integer('facility_id'),

    /*
      JaliCare UID rather than Firebase UID.
    */

    userId: text('user_id'),

    action: text('action').notNull(),

    resource: text('resource').notNull(),

    resourceId: text('resource_id'),

    details: text('details'),

    ipAddress: text('ip_address'),

    userAgent: text('user_agent'),

    requestId: text('request_id'),

    severity: text('severity').default('INFO'),

    /*
      Examples:
      INFO
      WARNING
      HIGH
      CRITICAL
    */

    timestamp: timestamp('timestamp').defaultNow().notNull(),
  },
  (table) => ({
    tenantIdx: index('audit_logs_tenant_idx').on(table.tenantId),

    facilityIdx: index('audit_logs_facility_idx').on(table.facilityId),

    userIdx: index('audit_logs_user_idx').on(table.userId),

    actionIdx: index('audit_logs_action_idx').on(table.action),

    timestampIdx: index('audit_logs_timestamp_idx').on(table.timestamp),
  }),
);
