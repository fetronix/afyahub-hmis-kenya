/**
 * Facility inventory accounting: policy, posting and reconciliation.
 *
 * WHY THIS EXISTS
 * ---------------
 * Inventory and the ledger were two systems sharing a database. Stock was
 * received and consumed with no journal; a purchase was expensed once at
 * supplier invoice. That made cost of goods invisible and the stock asset
 * non-existent, so margin was overstated by the full cost of everything
 * dispensed.
 *
 * This service is the only place that decides *which* accounting treatment a
 * stock event receives. It does not post journals itself — it calls
 * `postInsideTransaction`, the single posting primitive, inside the caller's
 * transaction. That is what makes a stock movement and its journal succeed or
 * roll back together: there is no second connection, no outbox, no retry
 * daemon that could apply one without the other.
 *
 * THE DEFAULT IS UNCHANGED BEHAVIOUR
 * ----------------------------------
 * A facility with no ACTIVE policy row is on `EXPENSE_ON_PURCHASE`. Every
 * helper below returns `null` in that case and posts nothing, so enabling this
 * module changes nothing for a facility until an accountant deliberately
 * activates perpetual accounting.
 */
import type { PoolClient } from 'pg';

import { and, desc, eq, sql, type SQL } from 'drizzle-orm';

import { db, pool } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import {
  AccountingIntegrityError,
  postInsideTransaction,
  type JournalLine,
} from '../accounting/accounting.service.ts';

/** One lot a movement consumed, at the cost recorded when it was received. */
export interface LotAllocation {
  batchId: number;
  quantity: number;
  unitCostCents: number;
}

export interface InventoryAccountingScope {
  tenantId: number;
  facilityId: number;
  actorUserId: number;
}

export type InventoryAccountingBasis = 'EXPENSE_ON_PURCHASE' | 'PERPETUAL';

export interface InventoryAccountingPolicy {
  id: number;
  version: number;
  status: 'DRAFT' | 'ACTIVE' | 'SUPERSEDED';
  basis: InventoryAccountingBasis;
  effectiveFrom: string | null;
  stockAssetAccountId: number | null;
  clearingAccountId: number | null;
  consumptionAccountId: number | null;
  adjustmentAccountId: number | null;
  writeOffAccountId: number | null;
  openingBalanceAccountId: number | null;
  inputVatAccountId: number | null;
  nonRecoverableTaxAccountId: number | null;
  openingJournalId: number | null;
  openingValueCents: number;
  activatedAt: Date | null;
  financeApprovedByUserId: number | null;
  approvalNote: string | null;
}

/*
 * Facility advisory lock namespace. Activation takes the exclusive lock; every
 * stock mutation takes the shared lock. Shared locks do not block each other,
 * so ordinary receiving and dispensing keep their current concurrency; the
 * exclusive lock waits for in-flight movements to finish and blocks new ones
 * until the opening balance is committed.
 *
 * Distinct from the financial-period guard's 146907 so the two cannot deadlock
 * against each other in an unexpected order.
 */
const INVENTORY_ACCOUNTING_LOCK_NAMESPACE = 146908;

/** Serialise activation against every stock movement in this facility. */
export async function lockFacilityForActivation(
  client: PoolClient | { execute: (q: unknown) => Promise<unknown> },
  facilityId: number,
): Promise<void> {
  const client_ = client as PoolClient;
  await client_.query('SELECT pg_advisory_xact_lock($1, $2)', [
    INVENTORY_ACCOUNTING_LOCK_NAMESPACE,
    facilityId,
  ]);
}

/**
 * Adapt a Drizzle transaction to the `query(text, params)` shape the posting
 * primitive expects.
 *
 * The posting primitive takes a `PoolClient` because a journal must be written
 * on the connection that holds the stock change. Some callers open their
 * transaction with `db.transaction`, which hands back a query builder rather
 * than the connection. This adapter keeps the parameterised SQL — the text is
 * split on its `$n` placeholders and each value is bound as a real parameter —
 * so nothing is ever interpolated into the statement.
 */
export function transactionSqlClient(tx: {
  execute: (query: SQL) => Promise<{ rows: unknown[] }>;
}): PoolClient {
  /*
   * `pg` turns a JavaScript array into a Postgres array; Drizzle's `sql`
   * template turns it into a row value, and `$3::int[]` then fails with "cannot
   * cast type record to integer[]". Arrays are therefore bound as their literal
   * text form and left to the cast already present in the statement.
   */
  const bind = (value: unknown): unknown => {
    if (!Array.isArray(value)) return value ?? null;
    const items = value.map((entry) => {
      if (entry === null || entry === undefined) return 'NULL';
      if (typeof entry === 'number' || typeof entry === 'boolean') return String(entry);
      return `"${String(entry).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    });
    return `{${items.join(',')}}`;
  };

  return {
    query: async (text: string, params: unknown[] = []) => {
      const pieces: SQL[] = [];
      const chunks = text.split(/\$(\d+)/);
      pieces.push(sql.raw(chunks[0] ?? ''));
      for (let index = 1; index < chunks.length; index += 2) {
        const position = Number(chunks[index]);
        pieces.push(sql`${bind(params[position - 1])}`);
        pieces.push(sql.raw(chunks[index + 1] ?? ''));
      }
      return (await tx.execute(sql.join(pieces))) as { rows: never[] };
    },
  } as unknown as PoolClient;
}

/**
 * Announce that a stock movement is in flight.
 *
 * Shared, so ordinary stock work does not serialise against itself, but an
 * activation cannot begin between a movement's stock write and its commit.
 * Callers run this as the first statement of their existing transaction.
 */
export async function lockFacilityForStockMutation(
  tx: { execute: (query: SQL) => Promise<unknown> },
  facilityId: number,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock_shared(${INVENTORY_ACCOUNTING_LOCK_NAMESPACE}, ${facilityId})`,
  );
}

/* ------------------------------------------------------------- policy read */

function toPolicy(
  row: typeof schema.facilityInventoryAccounting.$inferSelect,
): InventoryAccountingPolicy {
  return {
    id: row.id,
    version: row.version,
    status: row.status as InventoryAccountingPolicy['status'],
    basis: row.basis as InventoryAccountingBasis,
    effectiveFrom: row.effectiveFrom ?? null,
    stockAssetAccountId: row.stockAssetAccountId ?? null,
    clearingAccountId: row.clearingAccountId ?? null,
    consumptionAccountId: row.consumptionAccountId ?? null,
    adjustmentAccountId: row.adjustmentAccountId ?? null,
    writeOffAccountId: row.writeOffAccountId ?? null,
    openingBalanceAccountId: row.openingBalanceAccountId ?? null,
    inputVatAccountId: row.inputVatAccountId ?? null,
    nonRecoverableTaxAccountId: row.nonRecoverableTaxAccountId ?? null,
    openingJournalId: row.openingJournalId ?? null,
    openingValueCents: row.openingValueCents ?? 0,
    activatedAt: row.activatedAt ?? null,
    financeApprovedByUserId: row.financeApprovedByUserId ?? null,
    approvalNote: row.approvalNote ?? null,
  };
}

/**
 * The basis in force for a facility.
 *
 * Read inside the caller's transaction so a concurrent activation cannot
 * change the answer between the check and the posting.
 */
export async function resolveInventoryBasis(
  client: PoolClient,
  scope: InventoryAccountingScope,
): Promise<InventoryAccountingBasis> {
  const result = await client.query(
    `SELECT basis FROM facility_inventory_accounting
      WHERE tenant_id=$1 AND facility_id=$2 AND status='ACTIVE'
      LIMIT 1`,
    [scope.tenantId, scope.facilityId],
  );

  return (result.rows[0]?.basis as InventoryAccountingBasis) ?? 'EXPENSE_ON_PURCHASE';
}

/** The ACTIVE policy, or null when the facility is on the default basis. */
export async function getActivePolicy(
  client: PoolClient,
  scope: InventoryAccountingScope,
): Promise<InventoryAccountingPolicy | null> {
  const result = await client.query(
    `SELECT * FROM facility_inventory_accounting
      WHERE tenant_id=$1 AND facility_id=$2 AND status='ACTIVE' LIMIT 1`,
    [scope.tenantId, scope.facilityId],
  );

  if (!result.rows.length) return null;

  const [row] = await db
    .select()
    .from(schema.facilityInventoryAccounting)
    .where(eq(schema.facilityInventoryAccounting.id, result.rows[0].id as number))
    .limit(1);

  return row ? toPolicy(row) : null;
}

export async function listInventoryAccountingPolicy(facilityId: number, tenantId: number) {
  const rows = await db
    .select()
    .from(schema.facilityInventoryAccounting)
    .where(
      and(
        eq(schema.facilityInventoryAccounting.tenantId, tenantId),
        eq(schema.facilityInventoryAccounting.facilityId, facilityId),
      ),
    )
    .orderBy(desc(schema.facilityInventoryAccounting.version));

  return rows.map(toPolicy);
}

/**
 * Read the facility's policy state for a request handler.
 *
 * Returns the basis in force, whether a policy has been activated at all, and
 * every version so an accountant can see how the facility got here.
 */
export async function readInventoryAccountingPolicy(
  tenantId: number,
  facilityId: number,
): Promise<{ basis: InventoryAccountingBasis; active: boolean; versions: unknown[] }> {
  const versions = await listInventoryAccountingPolicy(facilityId, tenantId);
  const active = versions.some((row) => (row as { status?: string }).status === 'ACTIVE');

  return {
    basis: active
      ? ((
          versions.find((row) => (row as { status?: string }).status === 'ACTIVE') as {
            basis: InventoryAccountingBasis;
          }
        ).basis ?? 'EXPENSE_ON_PURCHASE')
      : 'EXPENSE_ON_PURCHASE',
    active,
    versions,
  };
}

/* ------------------------------------------------------------ policy write */

export interface SavePolicyInput {
  basis?: unknown;
  stockAssetAccountId?: unknown;
  clearingAccountId?: unknown;
  consumptionAccountId?: unknown;
  adjustmentAccountId?: unknown;
  writeOffAccountId?: unknown;
  openingBalanceAccountId?: unknown;
  inputVatAccountId?: unknown;
  nonRecoverableTaxAccountId?: unknown;
  effectiveFrom?: unknown;
}

const numeric = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

/**
 * Create or update a DRAFT policy. A draft posts nothing and obliges nothing,
 * so the accounts can be configured, reviewed and corrected freely before an
 * accountant activates perpetual accounting.
 */
export async function saveInventoryAccountingPolicy(
  scenarioScope: { tenantId: number; facilityId: number },
  input: SavePolicyInput,
) {
  const basis: InventoryAccountingBasis =
    input.basis === 'PERPETUAL' ? 'PERPETUAL' : 'EXPENSE_ON_PURCHASE';

  return db.transaction(async (tx) => {
    const [active] = await tx
      .select({ id: schema.facilityInventoryAccounting.id })
      .from(schema.facilityInventoryAccounting)
      .where(
        and(
          eq(schema.facilityInventoryAccounting.tenantId, scenarioScope.tenantId),
          eq(schema.facilityInventoryAccounting.facilityId, scenarioScope.facilityId),
          eq(schema.facilityInventoryAccounting.status, 'ACTIVE'),
        ),
      )
      .limit(1)
      .for('update');

    /*
     * A policy in force is history. Editing it would silently re-point journals
     * that have already been posted — and the posted journals are immutable for
     * good reason. Re-baselining perpetual accounting is a deliberate, separate
     * exercise, so the draft is refused rather than quietly renumbered.
     */
    if (active) {
      throw new AccountingIntegrityError(
        'POLICY_ALREADY_ACTIVE',
        'Perpetual inventory accounting is already in force for this facility; a new policy would re-baseline posted journals.',
        409,
      );
    }

    const [existing] = await tx
      .select()
      .from(schema.facilityInventoryAccounting)
      .where(
        and(
          eq(schema.facilityInventoryAccounting.tenantId, scenarioScope.tenantId),
          eq(schema.facilityInventoryAccounting.facilityId, scenarioScope.facilityId),
          eq(schema.facilityInventoryAccounting.status, 'DRAFT'),
        ),
      )
      .limit(1)
      .for('update');

    /* Version 1 only when there is nothing else; a superseded row keeps its
       number and the next draft follows it. */
    const highestRow = await tx
      .select({ highest: schema.facilityInventoryAccounting.version })
      .from(schema.facilityInventoryAccounting)
      .where(eq(schema.facilityInventoryAccounting.facilityId, scenarioScope.facilityId))
      .orderBy(desc(schema.facilityInventoryAccounting.version))
      .limit(1);
    const highest = highestRow[0]?.highest ?? 0;

    const values = {
      basis,
      stockAssetAccountId: numeric(input.stockAssetAccountId),
      clearingAccountId: numeric(input.clearingAccountId),
      consumptionAccountId: numeric(input.consumptionAccountId),
      adjustmentAccountId: numeric(input.adjustmentAccountId),
      writeOffAccountId: numeric(input.writeOffAccountId),
      openingBalanceAccountId: numeric(input.openingBalanceAccountId),
      inputVatAccountId: numeric(input.inputVatAccountId),
      nonRecoverableTaxAccountId: numeric(input.nonRecoverableTaxAccountId),
      effectiveFrom:
        typeof input.effectiveFrom === 'string' && input.effectiveFrom.trim()
          ? input.effectiveFrom.trim()
          : null,
      updatedAt: new Date(),
    };

    if (existing) {
      const [updated] = await tx
        .update(schema.facilityInventoryAccounting)
        .set(values)
        .where(eq(schema.facilityInventoryAccounting.id, existing.id))
        .returning();
      return toPolicy(updated);
    }

    const [created] = await tx
      .insert(schema.facilityInventoryAccounting)
      .values({
        tenantId: scenarioScope.tenantId,
        facilityId: scenarioScope.facilityId,
        status: 'DRAFT',
        version: highest + 1,
        ...values,
      })
      .returning();

    return toPolicy(created);
  });
}

/* -------------------------------------------------------------- valuation */

export interface InventoryValuation {
  totalCents: bigint;
  unvaluedBatches: number;
  unvaluedQuantity: number;
  batchGaps: Array<{ itemId: number; currentStock: number; batchQuantity: number }>;
}

/**
 * What the stock on the shelf is worth, in cents.
 *
 * Deliberately the same arithmetic `getValuation` reports to a user: batches
 * with a positive remaining quantity, at the cost recorded when they were
 * received. A lot with no recorded cost is counted and excluded, never priced
 * at zero, because zero would be a claim that the stock is worthless.
 */
export async function readInventoryValuation(
  client: PoolClient,
  facilityId: number,
): Promise<InventoryValuation> {
  const valued = await client.query(
    `SELECT COALESCE(SUM(b.quantity_remaining::bigint * ROUND(b.cost_per_unit * 100)::bigint), 0)::text AS cents,
            COUNT(*) FILTER (WHERE b.cost_per_unit IS NULL)::int AS unvalued_batches,
            COALESCE(SUM(b.quantity_remaining) FILTER (WHERE b.cost_per_unit IS NULL), 0)::int AS unvalued_qty
       FROM inventory_batches b
       JOIN inventory_items i ON i.id = b.item_id
      WHERE i.facility_id = $1 AND b.quantity_remaining > 0`,
    [facilityId],
  );

  const gaps = await client.query(
    `SELECT i.id AS "itemId", COALESCE(i.current_stock, 0)::int AS "currentStock",
            COALESCE(SUM(b.quantity_remaining), 0)::int AS "batchQuantity"
       FROM inventory_items i
       LEFT JOIN inventory_batches b ON b.item_id = i.id
      WHERE i.facility_id = $1 AND i.is_active = TRUE
      GROUP BY i.id
     HAVING COALESCE(i.current_stock, 0) <> COALESCE(SUM(b.quantity_remaining), 0)`,
    [facilityId],
  );

  return {
    totalCents: BigInt(valued.rows[0]?.cents ?? '0'),
    unvaluedBatches: Number(valued.rows[0]?.unvalued_batches ?? 0),
    unvaluedQuantity: Number(valued.rows[0]?.unvalued_qty ?? 0),
    batchGaps: gaps.rows.map((row) => ({
      itemId: Number(row.itemId),
      currentStock: Number(row.currentStock),
      batchQuantity: Number(row.batchQuantity),
    })),
  };
}

/* -------------------------------------------------------------- activation */

export interface ActivatePolicyInput {
  financeApprovedByUserId?: unknown;
  approvalNote?: unknown;
  effectiveFrom?: unknown;
}

/**
 * Post the opening balance and put the policy in force.
 *
 * Everything happens in one transaction under the exclusive facility lock:
 * re-check preconditions, capture valuation, post the opening journal, flip the
 * row to ACTIVE. A valuation read before the lock would be stale by
 * construction, so it is captured after.
 */
export async function activateInventoryAccountingPolicy(
  scope: InventoryAccountingScope,
  input: ActivatePolicyInput,
) {
  const financeApprover = numeric(input.financeApprovedByUserId);
  if (!financeApprover) {
    throw new AccountingIntegrityError(
      'FINANCE_APPROVAL_REQUIRED',
      'Perpetual inventory accounting requires a named finance approver.',
      403,
    );
  }

  const effectiveFrom =
    typeof input.effectiveFrom === 'string' && input.effectiveFrom.trim()
      ? input.effectiveFrom.trim()
      : null;
  if (!effectiveFrom) {
    throw new AccountingIntegrityError(
      'EFFECTIVE_DATE_REQUIRED',
      'Choose the date perpetual accounting starts.',
      400,
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL lock_timeout = 3000');

    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
      INVENTORY_ACCOUNTING_LOCK_NAMESPACE,
      scope.facilityId,
    ]);

    const existing = await client.query(
      `SELECT id FROM facility_inventory_accounting
        WHERE tenant_id=$1 AND facility_id=$2 AND status='ACTIVE' FOR UPDATE`,
      [scope.tenantId, scope.facilityId],
    );
    if (existing.rows.length) {
      throw new AccountingIntegrityError(
        'ALREADY_ACTIVATED',
        'Perpetual inventory accounting is already active for this facility.',
        409,
      );
    }

    const draft = await client.query(
      `SELECT * FROM facility_inventory_accounting
        WHERE tenant_id=$1 AND facility_id=$2 AND status='DRAFT'
        ORDER BY version DESC LIMIT 1 FOR UPDATE`,
      [scope.tenantId, scope.facilityId],
    );
    if (!draft.rows.length || draft.rows[0].basis !== 'PERPETUAL') {
      throw new AccountingIntegrityError(
        'POLICY_INCOMPLETE',
        'Save a perpetual policy with its accounts before activating it.',
        409,
      );
    }
    const row = draft.rows[0] as Record<string, unknown>;

    const required = [
      'stock_asset_account_id',
      'clearing_account_id',
      'consumption_account_id',
      'adjustment_account_id',
      'write_off_account_id',
      'opening_balance_account_id',
    ];
    const missing = required.filter((column) => row[column] === null || row[column] === undefined);
    if (missing.length) {
      throw new AccountingIntegrityError(
        'POLICY_INCOMPLETE',
        `These accounts must be chosen before activation: ${missing.join(', ')}.`,
        409,
      );
    }

    /* Valuation is captured under the lock, so no receipt can be mid-flight. */
    const valuation = await readInventoryValuation(client, scope.facilityId);

    if (valuation.batchGaps.length) {
      throw new AccountingIntegrityError(
        'RECONCILIATION_BLOCKED',
        'Item stock and lot quantities disagree; correct them before an opening balance is posted.',
        409,
      );
    }
    if (valuation.unvaluedQuantity > 0) {
      throw new AccountingIntegrityError(
        'UNVALUED_STOCK',
        `${valuation.unvaluedQuantity} unit(s) are held in lots with no recorded cost. Cost them, or remove them, before activation.`,
        409,
      );
    }

    const policyId = Number(row.id);
    const version = Number(row.version);
    const openingAccount = Number(row.opening_balance_account_id);
    const stockAsset = Number(row.stock_asset_account_id);

    let openingJournalId: number | null = null;

    if (valuation.totalCents > 0n) {
      const journal = await postInsideTransaction(
        client,
        { tenantId: scope.tenantId, facilityId: scope.facilityId, actorUserId: scope.actorUserId },
        {
          entryDate: effectiveFrom,
          description: `Opening stock balance as at ${effectiveFrom}`,
          idempotencyKey: `inv:opening:${scope.facilityId}:${version}`,
          sourceType: 'INVENTORY',
          sourceId: `policy:${scope.facilityId}:${version}`,
          totalCents: valuation.totalCents,
          lines: [
            {
              accountId: stockAsset,
              debitCents: valuation.totalCents,
              creditCents: 0n,
              description: 'Stock on hand at activation',
              serviceLine: null,
            },
            {
              accountId: openingAccount,
              debitCents: 0n,
              creditCents: valuation.totalCents,
              description: 'Opening balance counterpart',
              serviceLine: null,
            },
          ],
        },
      );
      openingJournalId = Number(journal.journal.id);
    }

    await client.query(
      `UPDATE facility_inventory_accounting
          SET status='ACTIVE', effective_from=$1, activated_at=now(),
              activated_by_user_id=$2, finance_approved_by_user_id=$3,
              approval_note=$4, opening_journal_id=$5, opening_value_cents=$6, updated_at=now()
        WHERE id=$7`,
      [
        effectiveFrom,
        scope.actorUserId,
        financeApprover,
        typeof input.approvalNote === 'string' ? input.approvalNote.slice(0, 1000) : null,
        openingJournalId,
        Number(valuation.totalCents),
        policyId,
      ],
    );

    await client.query(
      `INSERT INTO audit_logs(tenant_id, facility_id, user_id, resource, resource_id, action, details)
       VALUES($1,$2,$3,'InventoryAccountingPolicy',$4,'ACTIVATE',$5)`,
      [
        scope.tenantId,
        scope.facilityId,
        String(scope.actorUserId),
        String(policyId),
        `Perpetual inventory accounting activated from ${effectiveFrom}; opening value ${(
          Number(valuation.totalCents) / 100
        ).toFixed(2)}.`,
      ],
    );

    await client.query('COMMIT');

    return {
      policyId,
      effectiveFrom,
      openingJournalId,
      openingValueKes: (Number(valuation.totalCents) / 100).toFixed(2),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/* ---------------------------------------------------------- posting helpers */

async function postInventoryJournal(
  client: PoolClient,
  scope: InventoryAccountingScope,
  input: {
    entryDate: string;
    description: string;
    idempotencyKey: string;
    sourceId: string;
    totalCents: bigint;
    lines: JournalLine[];
  },
): Promise<number> {
  const result = await postInsideTransaction(
    client,
    { tenantId: scope.tenantId, facilityId: scope.facilityId, actorUserId: scope.actorUserId },
    {
      entryDate: input.entryDate,
      description: input.description,
      idempotencyKey: input.idempotencyKey,
      sourceType: 'INVENTORY',
      sourceId: input.sourceId,
      totalCents: input.totalCents,
      lines: input.lines,
    },
  );

  return Number(result.journal.id);
}

const line = (
  accountId: number,
  debitCents: bigint,
  creditCents: bigint,
  description: string,
): JournalLine => ({ accountId, debitCents, creditCents, description, serviceLine: null });

/** Tie a movement to the journal it produced, so reconciliation can prove coverage. */
export async function linkMovementToJournal(
  client: PoolClient,
  scope: InventoryAccountingScope,
  movementId: number,
  journalEntryId: number,
): Promise<void> {
  await client.query(
    `INSERT INTO inventory_movement_journals(movement_id, tenant_id, facility_id, journal_entry_id)
     VALUES($1,$2,$3,$4) ON CONFLICT (movement_id) DO NOTHING`,
    [movementId, scope.tenantId, scope.facilityId, journalEntryId],
  );
}

/**
 * Capitalise a goods-received note: stock asset up, GRN clearing up.
 *
 * Capitalising at receipt rather than at invoice is what keeps
 * received-but-uninvoiced stock inside the ledger. The invoice later clears
 * the clearing account and recognises the payable.
 */
export async function postStockReceipt(
  client: PoolClient,
  scope: InventoryAccountingScope,
  input: { grnId: number; grnNumber: string; entryDate: string; valueCents: bigint },
): Promise<number | null> {
  if (input.valueCents <= 0n) return null;

  const policy = await getActivePolicy(client, scope);
  if (!policy || policy.basis !== 'PERPETUAL' || !policy.stockAssetAccountId) return null;
  if (!policy.clearingAccountId) return null;

  return postInventoryJournal(client, scope, {
    entryDate: input.entryDate,
    description: `Stock received on ${input.grnNumber}`,
    idempotencyKey: `inv:grn:${scope.facilityId}:${input.grnId}`,
    sourceId: `grn:${input.grnId}`,
    totalCents: input.valueCents,
    lines: [
      line(
        policy.stockAssetAccountId,
        input.valueCents,
        0n,
        `Stock received on ${input.grnNumber}`,
      ),
      line(
        policy.clearingAccountId,
        0n,
        input.valueCents,
        `Received not invoiced ${input.grnNumber}`,
      ),
    ],
  });
}

/**
 * Cost of the lots a movement consumed.
 *
 * Returns null when no allocation was recorded, which happens for a facility on
 * the expense basis and for any movement that drew no lot. Callers must treat
 * null as "nothing to post", never as zero cost.
 */
export function allocationsValueCents(allocations: LotAllocation[]): bigint {
  return allocations.reduce(
    (sum, allocation) =>
      sum + BigInt(allocation.quantity) * BigInt(Math.max(0, Math.round(allocation.unitCostCents))),
    0n,
  );
}

export async function recordMovementAllocations(
  client: PoolClient,
  scope: InventoryAccountingScope,
  movementId: number,
  allocations: LotAllocation[],
): Promise<void> {
  if (!allocations.length) return;

  /* Collapse any duplicate lot draws so the unique (movement, batch) index
     cannot reject a legitimate multi-draw movement. */
  const merged = new Map<number, LotAllocation>();
  for (const allocation of allocations) {
    const current = merged.get(allocation.batchId);
    if (current) current.quantity += allocation.quantity;
    else merged.set(allocation.batchId, { ...allocation });
  }

  /*
   * A lot belongs to exactly one item. Allocating a movement against another
   * item's lot would value the draw at a stranger's cost and leave the real
   * lot overstated, so the mismatch is refused rather than stored.
   */
  const batchIds = [...merged.keys()];
  const ownership = await client.query(
    `SELECT b.id
       FROM inventory_batches b
       JOIN inventory_movements m ON m.id = $1 AND m.item_id = b.item_id
      WHERE b.id = ANY($2::int[])`,
    [movementId, batchIds],
  );
  if (ownership.rows.length !== batchIds.length) {
    throw new AccountingIntegrityError(
      'ALLOCATION_LOT_MISMATCH',
      'A movement can only be allocated against lots of the item it moved.',
      409,
    );
  }

  for (const allocation of merged.values()) {
    if (allocation.quantity <= 0) continue;
    await client.query(
      `INSERT INTO inventory_movement_allocations(
         tenant_id, facility_id, movement_id, batch_id, quantity, unit_cost_cents)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT (movement_id, batch_id) DO NOTHING`,
      [
        scope.tenantId,
        scope.facilityId,
        movementId,
        allocation.batchId,
        allocation.quantity,
        Math.max(0, Math.round(allocation.unitCostCents)),
      ],
    );
  }
}

/**
 * Post the cost of stock leaving the shelf: consumption, write-off or a
 * shortage adjustment.
 *
 * `counterAccount` is the expense or adjustment account the cost lands in, and
 * `kind` distinguishes the idempotency key so the same movement can never
 * produce two journals under different names.
 */
export async function postStockIssue(
  client: PoolClient,
  scope: InventoryAccountingScope,
  input: {
    movementId: number;
    entryDate: string;
    description: string;
    costCents: bigint;
    kind: 'CONSUMPTION' | 'WRITE_OFF' | 'ADJUSTMENT';
  },
): Promise<number | null> {
  if (input.costCents <= 0n) return null;

  const policy = await getActivePolicy(client, scope);
  if (!policy || policy.basis !== 'PERPETUAL' || !policy.stockAssetAccountId) return null;

  const counterAccount =
    input.kind === 'CONSUMPTION'
      ? policy.consumptionAccountId
      : input.kind === 'WRITE_OFF'
        ? policy.writeOffAccountId
        : policy.adjustmentAccountId;

  if (!counterAccount) return null;

  const journalId = await postInventoryJournal(client, scope, {
    entryDate: input.entryDate,
    description: input.description,
    idempotencyKey: `inv:${input.kind.toLowerCase()}:${scope.facilityId}:${input.movementId}`,
    sourceId: `movement:${input.movementId}`,
    totalCents: input.costCents,
    lines: [
      line(counterAccount, input.costCents, 0n, input.description),
      line(policy.stockAssetAccountId, 0n, input.costCents, `Stock issued: ${input.description}`),
    ],
  });

  await linkMovementToJournal(client, scope, input.movementId, journalId);
  return journalId;
}

/** Post stock arriving back onto the shelf: a surplus adjustment or count gain. */
export async function postStockGain(
  client: PoolClient,
  scope: InventoryAccountingScope,
  input: {
    movementId: number;
    entryDate: string;
    description: string;
    costCents: bigint;
  },
): Promise<number | null> {
  if (input.costCents <= 0n) return null;

  const policy = await getActivePolicy(client, scope);
  if (!policy || policy.basis !== 'PERPETUAL' || !policy.stockAssetAccountId) return null;
  if (!policy.adjustmentAccountId) return null;

  const journalId = await postInventoryJournal(client, scope, {
    entryDate: input.entryDate,
    description: input.description,
    idempotencyKey: `inv:gain:${scope.facilityId}:${input.movementId}`,
    sourceId: `movement:${input.movementId}`,
    totalCents: input.costCents,
    lines: [
      line(policy.stockAssetAccountId, input.costCents, 0n, input.description),
      line(policy.adjustmentAccountId, 0n, input.costCents, input.description),
    ],
  });

  await linkMovementToJournal(client, scope, input.movementId, journalId);
  return journalId;
}

/**
 * Post stock going back to the supplier.
 *
 * The counterpart is not a matter of taste — it depends on whether the facility
 * has been billed yet:
 *
 *   * **CLEARING** when the note is not yet invoiced. The receipt credited
 *     "received not invoiced"; returning the goods means the supplier will
 *     simply not bill them, so that accrual must come down.
 *   * **PAYABLE** when the note is invoiced. The facility has been billed and
 *     owes the money, so the return reduces what it owes.
 *
 * Debiting an expense in either case would charge the facility for goods it no
 * longer has while leaving the accrual or the payable overstated — the cost
 * would be counted once in the expense and again in the liability.
 *
 * Returns null on the expense basis, where stock carries no ledger value and
 * the original invoice already expensed the purchase.
 */
export async function postSupplierReturn(
  client: PoolClient,
  scope: InventoryAccountingScope,
  input: {
    returnId: number;
    returnNumber: string;
    entryDate: string;
    supplierName: string;
    valueCents: bigint;
    counterpart: 'CLEARING' | 'PAYABLE';
    payableAccountId: number | null;
  },
): Promise<number | null> {
  if (input.valueCents <= 0n) return null;

  const policy = await getActivePolicy(client, scope);
  if (!policy || policy.basis !== 'PERPETUAL' || !policy.stockAssetAccountId) return null;

  const counterAccount =
    input.counterpart === 'PAYABLE' ? (input.payableAccountId ?? policy.clearingAccountId) : policy.clearingAccountId;

  /*
   * A return that has no account to come out of is not a posting decision, it
   * is a configuration gap. Saying so is better than crediting stock against an
   * arbitrary expense and calling the ledger reconciled.
   */
  if (!counterAccount) {
    throw new AccountingIntegrityError(
      'RETURN_COUNTERPART_UNCONFIGURED',
      'Returning stock needs a clearing account, or the payable account of the invoice being credited.',
      409,
    );
  }

  const journalId = await postInventoryJournal(client, scope, {
    entryDate: input.entryDate,
    description: `Goods returned to ${input.supplierName} (${input.returnNumber})`,
    idempotencyKey: `inv:return:${scope.facilityId}:${input.returnId}`,
    sourceId: `supplier-return:${input.returnId}`,
    totalCents: input.valueCents,
    lines: [
      line(counterAccount, input.valueCents, 0n, `Return ${input.returnNumber}`),
      line(
        policy.stockAssetAccountId,
        0n,
        input.valueCents,
        `Stock returned on ${input.returnNumber}`,
      ),
    ],
  });

  return journalId;
}

/**
 * Post a supplier credit note.
 *
 * A credit is money the facility no longer owes, so the payable is debited.
 * What sits on the other side depends on what the credit is for: a price
 * adjustment or a rebate reduces the cost of the stock, so it goes back to
 * clearing (or the expense the purchase landed in); tax that was reclaimed is
 * reversed out of input VAT rather than left as a receivable the facility will
 * never collect.
 *
 * The credit is not silently netted against stock: it is a claim, and it
 * reduces a liability. Where it lands is stated by the caller and recorded.
 */
export async function postSupplierCreditNote(
  client: PoolClient,
  scope: InventoryAccountingScope,
  input: {
    creditNoteId: number;
    creditNoteNumber: string;
    entryDate: string;
    supplierName: string;
    subtotalCents: bigint;
    taxCents: bigint;
    taxRecoverable: boolean;
    payableAccountId: number;
    fallbackExpenseAccountId: number;
  },
): Promise<number | null> {
  const totalCents = input.subtotalCents + input.taxCents;
  if (totalCents <= 0n) return null;

  const policy = await getActivePolicy(client, scope);
  /*
   * Unlike the return, a credit note must be posted even on the expense basis:
   * the purchase was expensed at invoice, so a credit is a recovery of that
   * expense. Declining to post would leave the expense overstated forever.
   */
  const creditAccount =
    policy?.basis === 'PERPETUAL' && policy.clearingAccountId
      ? policy.clearingAccountId
      : input.fallbackExpenseAccountId;

  const lines: JournalLine[] = [
    line(input.payableAccountId, totalCents, 0n, `Credit note ${input.creditNoteNumber}`),
  ];

  if (input.subtotalCents > 0n) {
    lines.push(
      line(
        creditAccount,
        0n,
        input.subtotalCents,
        `Credit for ${input.supplierName} (${input.creditNoteNumber})`,
      ),
    );
  }

  if (input.taxCents > 0n) {
    /*
     * Recoverable tax was debited to input VAT when the invoice was posted.
     * A credit reverses it there. Non-recoverable tax was an expense, so it is
     * credited back to the expense instead.
     */
    const taxAccount =
      input.taxRecoverable && policy?.inputVatAccountId
        ? policy.inputVatAccountId
        : (policy?.nonRecoverableTaxAccountId ?? input.fallbackExpenseAccountId);
    lines.push(line(taxAccount, 0n, input.taxCents, `Tax credit ${input.creditNoteNumber}`));
  }

  return postInventoryJournal(client, scope, {
    entryDate: input.entryDate,
    description: `Supplier credit note ${input.creditNoteNumber}`,
    idempotencyKey: `inv:credit-note:${scope.facilityId}:${input.creditNoteId}`,
    sourceId: `supplier-credit-note:${input.creditNoteId}`,
    totalCents,
    lines,
  });
}

/**
 * Post a supplier invoice that settles a goods received note.
 *
 * Clearing is the hinge of the perpetual basis: the receipt debited stock and
 * credited clearing, so the invoice must debit clearing and credit the payable.
 * Debiting an expense here as well would charge the cost twice — once when the
 * goods arrived and again when the bill did — which is the exact double count
 * that made the old treatment unusable.
 *
 * Tax is kept out of stock cost. A recoverable input tax is an asset against
 * the revenue authority; a non-recoverable tax is a cost in its own right. Only
 * the first is what "recoverable VAT" means, and it is never folded into the
 * value of what sits on the shelf.
 *
 * Returns null when the facility is not on the perpetual basis, so the caller
 * keeps its existing expense treatment untouched.
 */
export async function postSupplierInvoiceClearing(
  client: PoolClient,
  scope: InventoryAccountingScope,
  input: {
    grnId: number;
    invoiceNumber: string;
    entryDate: string;
    grnNumber: string;
    subtotalCents: bigint;
    taxCents: bigint;
    taxRecoverable: boolean;
    payableAccountId: number;
    fallbackExpenseAccountId: number;
  },
): Promise<number | null> {
  const policy = await getActivePolicy(client, scope);
  if (!policy || policy.basis !== 'PERPETUAL' || !policy.clearingAccountId) return null;

  const totalCents = input.subtotalCents + input.taxCents;
  if (totalCents <= 0n) return null;

  const lines: JournalLine[] = [
    line(policy.clearingAccountId, input.subtotalCents, 0n, `Stock received on ${input.grnNumber}`),
  ];

  if (input.taxCents > 0n) {
    /*
     * Recoverable tax needs a configured input-tax account. Without one the
     * facility has not said it can reclaim the money, so charging it to the
     * expense account is the only defensible default — claiming recovery that
     * no configuration supports would overstate the receivable.
     */
    const taxAccount =
      input.taxRecoverable && policy.inputVatAccountId
        ? policy.inputVatAccountId
        : (policy.nonRecoverableTaxAccountId ?? input.fallbackExpenseAccountId);
    lines.push(line(taxAccount, input.taxCents, 0n, `Tax on ${input.invoiceNumber}`));
  }

  lines.push(
    line(input.payableAccountId, 0n, totalCents, `Supplier invoice ${input.invoiceNumber}`),
  );

  return postInventoryJournal(client, scope, {
    entryDate: input.entryDate,
    description: `Supplier invoice ${input.invoiceNumber}`,
    /*
     * A note can be invoiced once, so the note is the stable reference — but
     * the *receipt* already owns `grn:<id>` as a journal source, and the source
     * index is unique per facility. Sharing it made the invoice fail with a
     * duplicate key instead of clearing the receipt.
     */
    idempotencyKey: `inv:invoice:${scope.facilityId}:${input.grnId}`,
    sourceId: `supplier-invoice:grn:${input.grnId}`,
    totalCents,
    lines,
  });
}

/**
 * Post a physical count's net variance as one journal.
 *
 * A count is a single event that happens to touch many items; posting one
 * journal per line would bury the count in the ledger and make it impossible to
 * explain as a whole. Gains and losses are netted *within the count* — that is
 * a real offset, because the count is one measurement — but the net is taken
 * separately for the stock side and the adjustment side so the two lines still
 * balance.
 */
export async function postCountVariance(
  client: PoolClient,
  scope: InventoryAccountingScope,
  input: {
    countId: number;
    countNumber: string;
    entryDate: string;
    gainCents: bigint;
    lossCents: bigint;
    movementIds: number[];
  },
): Promise<number | null> {
  const net = input.gainCents - input.lossCents;
  if (net === 0n || input.movementIds.length === 0) return null;

  const policy = await getActivePolicy(client, scope);
  if (!policy || policy.basis !== 'PERPETUAL' || !policy.stockAssetAccountId) return null;
  if (!policy.adjustmentAccountId) return null;

  const magnitude = net > 0n ? net : -net;
  const description = `Stock count ${input.countNumber}`;

  const journalId = await postInventoryJournal(client, scope, {
    entryDate: input.entryDate,
    description,
    idempotencyKey: `inv:count:${scope.facilityId}:${input.countId}`,
    sourceId: `stock-count:${input.countId}`,
    totalCents: magnitude,
    lines:
      net > 0n
        ? [
            line(policy.stockAssetAccountId, magnitude, 0n, `Count surplus ${input.countNumber}`),
            line(policy.adjustmentAccountId, 0n, magnitude, `Count surplus ${input.countNumber}`),
          ]
        : [
            line(policy.adjustmentAccountId, magnitude, 0n, `Count shortage ${input.countNumber}`),
            line(policy.stockAssetAccountId, 0n, magnitude, `Count shortage ${input.countNumber}`),
          ],
  });

  for (const movementId of input.movementIds) {
    await linkMovementToJournal(client, scope, movementId, journalId);
  }

  return journalId;
}

/* ---------------------------------------------------------- reconciliation */

export interface InventoryReconciliation {
  basis: InventoryAccountingBasis;
  effectiveFrom: string | null;
  valuationKes: string;
  stockAssetBalanceKes: string;
  differenceKes: string;
  reconciled: boolean;
  differences: Array<{ kind: string; detail: string }>;
  unvaluedBatches: number;
  unvaluedQuantity: number;
  unpostedMovements: number;
}

/**
 * Compare the stock asset account against what the shelf is worth.
 *
 * The two must agree to the cent. Anything else is reported as its own class of
 * difference and never netted against another: an unposted movement and an
 * unvalued lot can have opposite signs, and adding them together would hide
 * both.
 */
export async function readInventoryReconciliation(
  scope: InventoryAccountingScope,
): Promise<InventoryReconciliation> {
  const client = await pool.connect();
  try {
    const policy = await getActivePolicy(client, scope);

    if (!policy || policy.basis !== 'PERPETUAL' || !policy.stockAssetAccountId) {
      const valuation = await readInventoryValuation(client, scope.facilityId);

      return {
        basis: 'EXPENSE_ON_PURCHASE',
        effectiveFrom: null,
        valuationKes: (Number(valuation.totalCents) / 100).toFixed(2),
        stockAssetBalanceKes: '0.00',
        differenceKes: '0.00',
        reconciled: true,
        differences: [
          {
            kind: 'EXPENSE_BASIS',
            detail:
              'Purchases are expensed when invoiced, so stock carries no ledger value and there is nothing to reconcile.',
          },
        ],
        unvaluedBatches: valuation.unvaluedBatches,
        unvaluedQuantity: valuation.unvaluedQuantity,
        unpostedMovements: 0,
      };
    }

    const valuation = await readInventoryValuation(client, scope.facilityId);

    const balance = await client.query(
      `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0)::text AS cents
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.journal_entry_id
        WHERE e.tenant_id=$1 AND e.facility_id=$2
          AND e.status='POSTED' AND l.account_id=$3`,
      [scope.tenantId, scope.facilityId, policy.stockAssetAccountId],
    );

    const stockAssetCents = BigInt(balance.rows[0]?.cents ?? '0');
    const difference = stockAssetCents - valuation.totalCents;

    const differences: Array<{ kind: string; detail: string }> = [];

    if (valuation.unvaluedQuantity > 0) {
      differences.push({
        kind: 'UNVALUED',
        detail: `${valuation.unvaluedQuantity} unit(s) in ${valuation.unvaluedBatches} lot(s) have no recorded cost, so they carry no ledger value.`,
      });
    }

    if (valuation.batchGaps.length) {
      differences.push({
        kind: 'UNBATCHED',
        detail: `${valuation.batchGaps.length} item(s) hold a stock figure that differs from their lots, so valuation omits or double-counts that stock.`,
      });
    }

    /* Movements after activation that never produced a journal. */
    const unposted = await client.query(
      `SELECT COUNT(*)::int AS n
         FROM inventory_movements m
         LEFT JOIN inventory_movement_journals l ON l.movement_id = m.id
        WHERE m.tenant_id=$1 AND m.facility_id=$2
          AND m.movement_date >= $3::date
          AND l.movement_id IS NULL
          AND m.movement_type IN ('RECEIPT','DISPENSE','ADJUSTMENT','WRITE_OFF','COUNT_VARIANCE','RETURN_OUT')`,
      [scope.tenantId, scope.facilityId, policy.effectiveFrom],
    );
    const unpostedCount = Number(unposted.rows[0]?.n ?? 0);

    if (unpostedCount > 0) {
      differences.push({
        kind: 'UNPOSTED',
        detail: `${unpostedCount} stock movement(s) dated on or after ${policy.effectiveFrom} have no journal.`,
      });
    }

    if (difference !== 0n) {
      differences.push({
        kind: 'BALANCE',
        detail: `Stock asset balance differs from valuation by ${(Number(difference) / 100).toFixed(2)}.`,
      });
    }

    return {
      basis: policy.basis,
      effectiveFrom: policy.effectiveFrom,
      valuationKes: (Number(valuation.totalCents) / 100).toFixed(2),
      stockAssetBalanceKes: (Number(stockAssetCents) / 100).toFixed(2),
      differenceKes: (Number(difference) / 100).toFixed(2),
      reconciled: difference === 0n && differences.length === 0,
      differences,
      unvaluedBatches: valuation.unvaluedBatches,
      unvaluedQuantity: valuation.unvaluedQuantity,
      unpostedMovements: unpostedCount,
    };
  } finally {
    client.release();
  }
}
