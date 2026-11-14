import type { PoolClient } from 'pg';

/**
 * Do not show totals from a partial or cross-facility posted ledger. Check both
 * directions: a scoped journal with a foreign account, and a scoped account
 * referenced by a foreign journal. No other facility's identifiers are returned.
 * Caller should use the same repeatable-read transaction as its report.
 */
export async function hasPostedJournalScopeMismatch(
  client: Pick<PoolClient, 'query'>,
  tenantId: number,
  facilityId: number,
): Promise<boolean> {
  const result = await client.query<{ inconsistent: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM journal_entries j
       JOIN journal_lines l ON l.journal_entry_id=j.id
       JOIN chart_of_accounts a ON a.id=l.account_id
       WHERE j.tenant_id=$1 AND j.facility_id=$2 AND j.status='POSTED'
         AND (a.tenant_id,a.facility_id) IS DISTINCT FROM (j.tenant_id,j.facility_id)
       UNION ALL
       SELECT 1 FROM chart_of_accounts a
       JOIN journal_lines l ON l.account_id=a.id
       JOIN journal_entries j ON j.id=l.journal_entry_id
       WHERE a.tenant_id=$1 AND a.facility_id=$2 AND j.status='POSTED'
         AND (a.tenant_id,a.facility_id) IS DISTINCT FROM (j.tenant_id,j.facility_id)
     ) AS inconsistent`,
    [tenantId, facilityId],
  );
  return result.rows[0].inconsistent;
}
