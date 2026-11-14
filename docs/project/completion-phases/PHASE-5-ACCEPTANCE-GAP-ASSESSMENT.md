# Phase 5 — acceptance gap assessment and first implementation plan

**Status: assessment only. Nothing implemented, nothing committed, nothing pushed.**
Verified against `b32b39d8176a799c6f6b376e744d2902948624b7` on
`arena/e088f11d-afyahub-hmis-kenya`, working tree `dae70ac` (12 paths: the approval-policy
draft plus four closure documents — all untouched).

Baseline documents: [Phase 5 final report](./PHASE-5-FINAL-REPORT.md),
[Phase 1–4 register](./PHASE-1-4-OUTSTANDING-REGISTER.md),
[Phase 6 matrix](./PHASE-6-INTEGRATION-MATRIX.md).

---

## 0. A defect found while assessing gap 1 — proven, not inferred

Two-line stock counts cannot post. `postStockCount` writes every variance line with the same
ledger reference:

```ts
// src/inventory/stock-control.service.ts:562
referenceId: String(countId),      // identical for every line in the loop
```

`0077_inventory_control.sql:40` declares a unique index over

```
(facility_id, reference_type, reference_id, movement_type)
where reference_type is not null and reference_id is not null
```

so the second variance line in one count collides. Reproduced against a migrated synthetic
database (facility 3, two items, one count `999`):

```
1st variance line (item A, -3): inserted OK
2nd variance line (item B, +2): FAILED -> 23505 inventory_movements_reference_once_idx
  Key (facility_id, reference_type, reference_id, movement_type)=(3, STOCK_COUNT, 999, COUNT_VARIANCE)
=> movements persisted for that single count: 1 (a two-line count requires 2)
```

The inventory journey (33/33) passed only because its synthetic count had a single variance line.
**A real stock count of a store will fail**, and it fails as an unmapped database error rather
than a domain error the UI can explain.

This is a prerequisite for gap 1, not a separate feature: variance posting is one of the three
points that will need a journal.

---

## 1. Inventory → general ledger

### Existing implementation

| Concern                   | File                                                                                       | What it does today                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Adjustments               | `src/inventory/stock-control.service.ts:255` `adjustStock`                                 | Changes stock, appends a movement, writes an audit row — **no journal**                                  |
| Count variances           | same file `:522` `postStockCount`                                                          | Same, plus the reference defect above                                                                    |
| Transfers                 | same file `:597` `createTransfer`                                                          | Two item-level legs; no value changes hands, so **no journal is correct** here                           |
| Dispensing / receiving    | `src/inventory/inventory.service.ts`                                                       | Append RECEIPT / DISPENSE movements — **no journal**                                                     |
| Movement ledger           | `src/db/schema/inventory-control.ts:29`                                                    | Records **quantity only**; no cost, no value                                                             |
| Costs                     | `inventory_batches.cost_per_unit`, `inventory_items.unit_cost`                             | Batch cost is authoritative for valuation                                                                |
| Valuation                 | `stock-control.service.ts:767`                                                             | Σ(batch qty × batch cost); unvalued batches excluded and reported, unbatched items reconciled separately |
| Ledger entry point        | `src/accounting/accounting.service.ts:350` `postInsideTransaction(client, scope, request)` | Advisory lock, idempotency replay, open-period check, balanced lines, unique source                      |
| Account mapping precedent | `src/db/schema/assets.ts:42-48`, `fixed-asset.service.ts:600`                              | Category holds account ids; asset may override                                                           |
| Purchases                 | `src/procurement/receiving.service.ts:679`                                                 | Supplier invoice posts **Dr expenseAccountId / Cr accounts payable**                                     |
| Chart of accounts         | `POST /api/accounting/accounts` (`accounting.coa.manage`)                                  | Accounts are created per facility; there is no seeded default chart                                      |

### What is genuinely missing

1. **No account policy for stock.** Nothing records which account represents stock on hand, nor
   which expense absorbs a write-off, count variance or consumption.
2. **No value on the movement.** A journal built from a movement cannot be reproduced later,
   because the cost would be re-read from the item at posting time and would drift when the item
   cost changes.
3. **No journal on adjustment or variance.**
4. **The purchase side is expense-on-purchase.** Invoices debit an expense account, not a stock
   asset. Under that model stock on hand was never an asset, so posting a write-off to an
   inventory account would _create_ a divergence rather than remove one. This is the central
   design question, not an implementation detail.
5. **No reconciliation** between the stock account balance and the valuation report.

### Dependencies and risks

| #   | Risk                                                                                        | Consequence if ignored                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Posting basis is a finance policy decision** (expense-on-purchase vs perpetual inventory) | Posting adjustments under expense-on-purchase double-counts expense                                                                                                        |
| R2  | Unvalued stock (batches with no cost)                                                       | Posting it as zero fabricates an asset value — violates "unknown is not zero"                                                                                              |
| R3  | Closed financial period                                                                     | `postInsideTransaction` throws `409 OPEN_PERIOD_REQUIRED`; inside the same transaction the stock change rolls back too, so a closed period can block a physical adjustment |
| R4  | Valuation is batch-cost, movements may be unbatched                                         | A per-movement journal can legitimately differ from the batch valuation                                                                                                    |
| R5  | Inventory-only roles hold no accounting permission                                          | Configuration must be gated by `accounting.coa.manage`, but posting itself must not require it                                                                             |
| R6  | Migration numbering                                                                         | `0078_approval_policies.sql` exists uncommitted (unregistered) in the working tree. A new migration must be **0079** to avoid colliding with the draft                     |

### Proposed minimal implementation

Two batches. Batch A is a correctness fix; batch B is the feature.

**Batch A — make counts postable (prerequisite)**

- `stock-control.service.ts`: `referenceId: \`${countId}:${itemId}\`` for count variance lines.
  Unique per item within a count, stable across replays.
- Domain-error mapping so a constrained post surfaces as a `409` with a stable code, not a 500.
- Tests: two-line count posts both lines; replay is refused; same count re-posted is refused;
  three-line count with mixed signs.

**Batch B — posting policy**

1. **Migration `0079_inventory_posting_policy`**
   - `inventory_posting_settings`: `tenant_id`, `facility_id`, `posting_basis`
     (`EXPENSE_ON_PURCHASE` | `PERPETUAL`), `stock_account_id`, `adjustment_expense_account_id`,
     `variance_expense_account_id`, `consumption_expense_account_id` (all FK `chart_of_accounts`),
     `effective_from`, `effective_to`, `is_active`, `approved_by_user_id`, `approved_by_name`,
     `approved_at`, `created_by_user_id`, `notes`, timestamps.
   - Unique partial index: one active row per facility.
   - `inventory_movements` gains `unit_cost_cents bigint null` and `value_cents bigint null`,
     written at movement time so postings are reproducible.
2. **Service `src/inventory/inventory-posting.service.ts`**
   - `resolvePostingSettings(scope, client)` — active, effective-dated, facility-scoped;
     returns `null` when the facility has not configured a policy.
   - `valueMovement(...)` — batch cost when the movement names a batch, else item unit cost,
     else `null` (**never zero**).
   - `postStockMovement(client, scope, movement)` — one journal per movement,
     `sourceType: 'INVENTORY'`, `sourceId: 'MOV:<movementId>'`, idempotency key of the same shape.
     Balanced: a decrease is Dr `adjustment_expense_account_id` / Cr `stock_account_id`; an
     increase is the mirror. Count variances use `variance_expense_account_id`.
   - No policy configured, or value unknown → the movement is **recorded and left unposted**,
     and appears in an exceptions list. Stock never silently disagrees with a fabricated journal.
3. **Wiring** — call inside the existing `withTx`, so the journal and the stock change commit or
   roll back together. `sourceType` union in `accounting.service.ts` gains `'INVENTORY'`
   (no database check constraint exists on `journal_entries.source_type`, verified).
4. **API** — `GET`/`PUT /api/inventory/accounting-policy` (`inventory.read` /
   `accounting.coa.manage`), `GET /api/inventory/posting-exceptions` (`accounting.read`).
5. **UI** — a sixth tab, "Accounting policy", in
   `src/components/inventory/StockControlPanel.tsx`: basis selector, account pickers fed by
   `GET /api/accounting/accounts`, unposted-movement count, and an explicit warning that an
   unconfigured facility posts nothing.
6. **Tests**
   - Unit: valuation basis selection; unvalued → exception, never zero; idempotent replay.
   - `db.spec`: adjustment posts a balanced journal equal to quantity × cost; count variance
     posts one journal per line; replay does not double-post; closed period returns `409` and
     **leaves stock unchanged**; other facility's settings are invisible; `EXPENSE_ON_PURCHASE`
     facility posts nothing.

### Acceptance criteria

1. For a `PERPETUAL` facility, stock account movement over a period equals the change in the
   valuation report for **valued** stock, with unvalued stock listed as exceptions.
2. Every posted journal is balanced, idempotent and auditable to a movement id.
3. A closed period refuses the adjustment with a domain error and changes no stock.
4. No facility is switched to `PERPETUAL` without an explicit, attributed finance approval.
5. Facility isolation and permission checks proven by negative tests.

### Decisions required before implementation

- **D1 (blocking):** perpetual inventory, or adjustments-only under expense-on-purchase?
  Under expense-on-purchase there is nothing meaningful to post for a write-off.
  My recommendation: implement the setting with `EXPENSE_ON_PURCHASE` as default, so no existing
  facility changes behaviour, and only build the perpetual path.
- **D2:** does the purchase side (supplier invoice) also need to capitalise to stock under
  `PERPETUAL`? That changes `receiving.service.ts` and is a larger, separate change.
- **D3:** migration number `0079` accepted, given the uncommitted `0078` draft.
- **D4:** block on closed period (recommended) rather than posting to the next open period.

---

## 2. Supplier returns

**Existing.** No return, credit-note or debit-note concept: `src/db/schema/procurement.ts`
declares only requisitions/items/events, goods received notes/items. `supplier_invoices` lives in
`src/db/schema/financial-ledger.ts:299`. A return can be _recorded_ today only as a stock
adjustment with reason `RETURNED_TO_SUPPLIER` (`ADJUSTMENT_REASONS.SUPPLIER_RETURN`,
`stock-control.service.ts:79`), which moves stock but leaves the supplier balance and the ledger
untouched.

**Missing.** A return document against a GRN line; quantity validation against what was actually
received and not already returned; stock reversal; a credit note reducing accounts payable; a
journal (Dr AP / Cr stock or expense); audit and permission.

**Dependencies and risks.** Depends on gap 1 (stock account) if the return is to relieve an asset;
depends on gap 3 (a credit note must respect the matched invoice). Must not allow returning more
than received-and-not-returned.

**Proposed minimal implementation.** Migration adding `supplier_returns` + `supplier_return_items`
(GRN line reference, quantity, unit cost snapshot, reason); service that locks the GRN line,
validates remaining returnable quantity, reverses stock and appends a `RETURN` movement, and posts
Dr AP / Cr stock-or-expense; invoice status moves to a credit-note state; API + a Returns tab.

**Acceptance.** Cannot exceed returnable quantity (`409`); stock and movement agree; AP decreases;
journal balanced and idempotent; replay refused; facility isolation; permission-gated.

---

## 3. Three-way matching and tolerances

**Existing.** `outstandingOrderLines` (`receiving.service.ts:172`) and the over-receipt cap
(`:344`, `409 OVER_RECEIPT`) enforce PO → GRN quantity. The supplier invoice
(`:560`+) takes a caller-supplied `totalAmount`, `expenseAccountId` and `apAccountId` with
**no comparison** to received quantity or PO price; it only checks the GRN is posted and not
already invoiced.

**Missing.** Price and quantity tolerance policy; matching of invoice total against received
quantity × PO price; a variance hold that blocks or flags posting; configuration and exceptions
report.

**Dependencies and risks.** Needs a decision on tolerance semantics (percentage, absolute, per
line vs total) and on what happens to a variance (block, post with a flag, or route for approval).
Depends on gap 2 for credit notes.

**Proposed minimal implementation.** Facility-level tolerance settings (percentage and absolute
cap, per line); store matched vs invoiced amounts on the invoice; refuse or flag per policy;
exceptions list; tests for within-tolerance, over-tolerance, partial delivery and replay.

**Acceptance.** An invoice above tolerance is refused with a stable code; within tolerance posts;
matching is recomputed from GRN lines, never trusted from the client.

---

## 4. Payroll statutory returns

**Existing.** `src/workforce/payroll-calculator.ts` computes PAYE, NSSF, SHIF and AHL per employee
from effective-dated `payroll_statutory_versions` / `_bands`. `payroll_payslips` already stores
`gross_cents`, `taxable_cents`, `paye_cents`, `nssf_employee_cents`, `nssf_employer_cents`,
`shif_cents`, `ahl_employee_cents`, `ahl_employer_cents`, `other_deductions_cents`, `net_cents`
and a `breakdown` JSON per employee per run.

**Missing.** Any return output. There is no P9, P10, SHIF, NSSF or housing-levy schedule
endpoint, route or UI.

**Dependencies and risks.** The **formats must be authoritative**. I will not invent a KRA or
statutory layout. A facility-configured, effective-dated **remittance schedule** (per statute,
per run, reconciling payslip totals to the posted journal) is implementable now without claiming
filing compliance. A P9/P10-shaped export requires the current official specification and an
owner to accept it.

**Proposed minimal implementation.** A returns service aggregating a **posted** run's payslips by
statute and by employee; a remittance schedule export (CSV) reconciling to the payroll journal;
an explicit "not a statutory filing" banner and a documented list of what the filing requires.

**Acceptance.** Schedule totals equal the payslip totals and the posted journal; unposted runs are
refused; facility isolation; export audited. No claim of KRA acceptance.

---

## 5. Facility UAT and workflow evidence

**Existing.** Automated evidence only: four browser acceptance reports (24/24, 18/18, 13/13,
17/17) and 30 screenshots in `docs/project/delivery-evidence/phase-5/`, plus the CI-equivalent
verification run. No UAT plan, script, participant record or sign-off exists anywhere in the
repository.

**Missing.** Everything a facility acceptance needs: a UAT scope and script per workflow, named
participants with roles, synthetic-but-realistic scenarios, recorded results, defect log, and a
signed acceptance per module.

**Dependencies and risks.** Cannot be produced without facility staff. It is the one gap that is
**externally blocked**. Its absence is why Phase 5 is recorded as "implemented and synthetically
tested, awaiting facility UAT" rather than complete.

**Proposed minimal implementation.** A UAT pack (script per workflow, expected results, evidence
capture form) plus a results template, so the session is executable and auditable when a facility
is available. No invented sign-off.

**Acceptance.** Pack reviewed; sessions recorded with names, dates and outcomes; defects logged and
tracked. Until then the matrix stays "Awaiting facility UAT".

---

## Recommendation

Implement in this order: **Batch A (count fix) → gap 1 Batch B → gap 3 → gap 2 → gap 4 → UAT pack.**
Counts first because they are broken now; matching before returns because a credit note must
respect a matched invoice; payroll returns are independent and can run in parallel; the UAT pack
is written, not run, until a facility is available.

Awaiting approval of Batch A and of decisions D1–D4 before writing any code.
