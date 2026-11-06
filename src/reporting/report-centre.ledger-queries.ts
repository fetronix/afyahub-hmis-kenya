import type { ReportEngineId } from './report-catalogue.ts';
import type { ReportFilters } from './report-centre.types.ts';
import type { QueryPlan } from './report-centre.service.ts';

const amount = (cents: string) => `round((${cents})::numeric / 100, 2)`;
const pattern = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;

/** KES posted journal views, scoped independently at both account and journal. */
export function ledgerQueryPlan(
  id: ReportEngineId,
  tenantId: number,
  filters: ReportFilters,
): QueryPlan | null {
  if (!['ledger-trial-movements', 'ledger-income', 'ledger-balance-sheet'].includes(id))
    return null;
  const params: unknown[] = [tenantId, filters.facilityId];
  const param = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const posted = ["j.status='POSTED'"];
  if (id !== 'ledger-balance-sheet' && filters.from && filters.to) {
    posted.push(
      `j.entry_date >= ${param(filters.from)}::date`,
      `j.entry_date <= ${param(filters.to)}::date`,
    );
  } else if (id === 'ledger-balance-sheet' && filters.to) {
    posted.push(`j.entry_date <= ${param(filters.to)}::date`);
  }
  const where = ['TRUE'];
  if (id === 'ledger-income') where.push("d.account_type IN ('REVENUE','EXPENSE')");
  if (id === 'ledger-balance-sheet')
    where.push("d.account_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')");
  if (filters.accountIds) where.push(`d.id=ANY(${param(filters.accountIds)}::integer[])`);
  if (filters.search) {
    const q = param(pattern(filters.search));
    where.push(`(d.account_code ILIKE ${q} OR d.account_name ILIKE ${q})`);
  }
  const from = `(SELECT a.id,a.account_code,a.account_name,a.account_type,
      COALESCE(sum(l.debit_cents) FILTER (WHERE ${posted.join(' AND ')}),0)::numeric AS debits,
      COALESCE(sum(l.credit_cents) FILTER (WHERE ${posted.join(' AND ')}),0)::numeric AS credits,
      count(l.id) FILTER (WHERE j.id IS NULL)::integer AS invalid_links
    FROM chart_of_accounts a
    LEFT JOIN journal_lines l ON l.account_id=a.id
    LEFT JOIN journal_entries j ON j.id=l.journal_entry_id AND j.tenant_id=a.tenant_id AND j.facility_id=a.facility_id
    WHERE a.tenant_id=$1 AND a.facility_id=$2 GROUP BY a.id) d`;
  const normal =
    "CASE WHEN d.account_type IN ('ASSET','EXPENSE') THEN d.debits-d.credits ELSE d.credits-d.debits END";
  const base: QueryPlan = {
    from,
    where,
    params,
    select: `d.account_code AS code, d.account_name AS account, d.account_type AS type,
      ${amount('d.debits')}::text AS debits, ${amount('d.credits')}::text AS credits,
      ${amount('greatest(d.debits-d.credits,0)')}::text AS "netDebit",
      ${amount('greatest(d.credits-d.debits,0)')}::text AS "netCredit",
      ${amount(normal)}::text AS "normalAmount"`,
    order: 'd.account_code ASC, d.id ASC',
    missingExpression: 'd.invalid_links > 0',
    missingLabel:
      'account(s) have out-of-scope or missing journal references excluded from these amounts',
  };
  if (id === 'ledger-trial-movements') {
    base.summaries = [
      { label: 'Posted debits for filtered accounts', expression: amount('sum(d.debits)') },
      { label: 'Posted credits for filtered accounts', expression: amount('sum(d.credits)') },
    ];
  } else if (id === 'ledger-income') {
    const revenue = "sum(CASE WHEN d.account_type='REVENUE' THEN d.credits-d.debits ELSE 0 END)";
    const expense = "sum(CASE WHEN d.account_type='EXPENSE' THEN d.debits-d.credits ELSE 0 END)";
    base.summaries = [
      { label: 'Posted revenue for filtered accounts', expression: amount(revenue) },
      { label: 'Posted expenses for filtered accounts', expression: amount(expense) },
      {
        label: 'Posted ledger result for filtered accounts',
        expression: amount(`${revenue}-${expense}`),
      },
    ];
  } else {
    const assets = "sum(CASE WHEN d.account_type='ASSET' THEN d.debits-d.credits ELSE 0 END)";
    const liabilities =
      "sum(CASE WHEN d.account_type='LIABILITY' THEN d.credits-d.debits ELSE 0 END)";
    const equity =
      "sum(CASE WHEN d.account_type IN ('EQUITY','REVENUE') THEN d.credits-d.debits WHEN d.account_type='EXPENSE' THEN d.credits-d.debits ELSE 0 END)";
    base.summaries = [
      { label: 'Posted assets for filtered accounts', expression: amount(assets) },
      { label: 'Posted liabilities for filtered accounts', expression: amount(liabilities) },
      {
        label: 'Posted equity including accumulated result for filtered accounts',
        expression: amount(equity),
      },
    ];
  }
  return base;
}
