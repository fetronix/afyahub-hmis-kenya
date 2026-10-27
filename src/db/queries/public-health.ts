/**
 * JaliCare HMIS
 * Queries: MOH public-health reports and the audit trail
 *
 * Extracted from `../queries.ts`, which re-exports every function here so that
 * `import * as queries from '../queries.ts'` keeps working. The SQL, the scope
 * checks and the transaction boundaries are moved verbatim; nothing was rewritten.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../index.ts';
import * as schema from '../schema.ts';

import type { AuthorizationContext } from '../../auth/authorization.types.ts';

import { moduleLogger } from '../../logging/logger.ts';

const log = moduleLogger('db.public_health');

// Public Health

export async function getPublicHealthReports(facilityId: number) {
  if (!Number.isSafeInteger(facilityId) || facilityId <= 0) {
    throw new Error('A valid facility ID is required for public-health reports.');
  }

  try {
    return await db
      .select()
      .from(schema.publicHealthReports)
      .where(eq(schema.publicHealthReports.facilityId, facilityId))
      .orderBy(desc(schema.publicHealthReports.reportedAt));
  } catch (error) {
    log.error({ err: error }, 'public_health_reports.fetch_failed');
    throw new Error('Failed to fetch surveillance reports', { cause: error });
  }
}

export async function recordPublicHealthReport(
  data: typeof schema.publicHealthReports.$inferInsert,
) {
  try {
    const res = await db.insert(schema.publicHealthReports).values(data).returning();

    return res[0];
  } catch (error) {
    log.error({ err: error }, 'disease_surveillance_report.record_failed');
    throw new Error('Failed to record surveillance report', { cause: error });
  }
}

// Audit Logs
export async function logAuditEvent(
  tenantId: number | null,
  facilityId: number | null,
  userId: string | null,
  action: string,
  resource: string,
  resourceId: string | null,
  details: string,
) {
  try {
    await db.insert(schema.auditLogs).values({
      tenantId,
      facilityId,
      userId,
      action,
      resource,
      resourceId,
      details,
    });
  } catch (error) {
    log.error({ err: error }, 'audit_log.write_failed');
  }
}

export async function getAuditLogs(context: AuthorizationContext, requestedFacilityId?: number) {
  try {
    const conditions = [];

    if (context.isSuperAdmin) {
      if (requestedFacilityId !== undefined) {
        conditions.push(eq(schema.auditLogs.facilityId, requestedFacilityId));
      }
    } else if (context.facilityId !== null) {
      if (requestedFacilityId !== undefined && requestedFacilityId !== context.facilityId) {
        throw new Error("You are not authorized to view another facility's audit logs.");
      }

      conditions.push(eq(schema.auditLogs.facilityId, context.facilityId));
    } else if (context.tenantId !== null) {
      conditions.push(eq(schema.auditLogs.tenantId, context.tenantId));

      if (requestedFacilityId !== undefined) {
        conditions.push(eq(schema.auditLogs.facilityId, requestedFacilityId));
      }
    } else {
      throw new Error('Audit log authorization scope is unavailable.');
    }

    if (conditions.length === 0) {
      return await db
        .select()
        .from(schema.auditLogs)
        .orderBy(desc(schema.auditLogs.timestamp))
        .limit(50);
    }

    return await db
      .select()
      .from(schema.auditLogs)
      .where(and(...conditions))
      .orderBy(desc(schema.auditLogs.timestamp))
      .limit(50);
  } catch (error) {
    log.error({ err: error }, 'scoped_audit_logs.fetch_failed');
    throw error;
  }
}
