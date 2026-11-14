# Batch B — inventory-to-accounting design review (revision 2)

**Status: design review only. Read-only. No implementation.**

This document is the implementation-ready specification for inventory-to-accounting integration.
It records what the inventory and accounting code actually does today, the decisions that must be
taken before any code is written, and the corrections applied in this revision.

It contains **no implementation**: no source edit, no migration, no schema change, no test change,
no staging, no commit. Every statement is traceable to a file and line at `0b827cc`.

> **Revision 2.** Adds the six design questions as proposed decisions (§7), the six technical
> corrections A–F (§8), the exact C1 schema changes (§9.2) and the standalone C0 specification
> (§11). Section numbering changed; the mapping to the original eleven mandated sections is in §0.

| Item                       | Value                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Branch                     | `arena/e088f11d-afyahub-hmis-kenya`                                                                            |
| Local and remote head      | `0b827cc941c1106a59f13dc98a6e60d16d1e769e` — _fix(inventory): support multi-line stock count variance posting_ |
| Parent                     | `b32b39d`                                                                                                      |
| `main`                     | `63903c5` — unchanged, not touched                                                                             |
| Committed migrations       | 78 journal entries, `0000`–`0077` (`0077_inventory_control` last)                                              |
| Uncommitted migration file | `0078_approval_policies.sql` — belongs to the approval-policy WIP, **not registered**                          |
| Reserved for this work     | **`0079_inventory_accounting.sql`** — reserved, deliberately not created                                       |
| Environment this turn      | No database, no `node_modules` (sandbox reset) — **no test was run this turn**                                 |
| Test evidence used         | Quoted from earlier turns only; provenance in §12.5                                                            |

Nothing in this document was produced with real patient, staff or financial data.

> Date note: the session clock reports 2026-10-27; the Phase 5 evidence file carries a 2026-11-10
> timestamp. Both are sandbox clocks. Neither is a real-world attestation, and nothing here claims
> production readiness or facility acceptance.

---

## 0. How this document maps to the eleven mandated sections

| Mandated section                         | Here |
| ---------------------------------------- | ---- |
| 1. Repository verification               | §1   |
| 2. Architecture                          | §2   |
| 3. Findings with paths and functions     | §3   |
| 4. Current-state flow diagrams           | §4   |
| 5. Future-state flow                     | §5   |
| 6. D1–D4                                 | §6   |
| — design questions (revision 2)          | §7   |
| — technical corrections A–F (revision 2) | §8   |
| 7. Database and migration plan           | §9   |
| 8. API and UI plan                       | §10  |
| — C0 specification (revision 2)          | §11  |
| 9. Test strategy and acceptance criteria | §12  |
| 10. Risks, dependencies, open questions  | §13  |
| 11. Sequenced small batches              | §14  |
| — change record                          | §15  |

---

## 1. Repository verification

The sandbox restores a stale Git index between turns. That happened again this turn, and the
verification found **one genuine deviation from the documented baseline** beyond the expected
index reset. Both are recorded here before any work was done.

### 1.1 What was found

| Check                | Documented baseline                 | Found on entry              | Verdict                            |
| -------------------- | ----------------------------------- | --------------------------- | ---------------------------------- |
| Branch               | `arena/e088f11d-afyahub-hmis-kenya` | same                        | ✅                                 |
| Remote head          | `0b827cc`                           | `0b827cc`                   | ✅                                 |
| `main`               | `63903c5`                           | `63903c5`                   | ✅                                 |
| Local `HEAD`         | `0b827cc`                           | **`0111b55`** (branch base) | ⚠️ index reset — expected artefact |
| `git status`         | 14 paths                            | **587 paths**               | ⚠️ consequence of the same reset   |
| Local object DB      | contains `0b827cc`                  | **object absent**           | ⚠️ **new deviation**               |
| 8 WIP file checksums | recorded                            | all 8 match                 | ✅                                 |

### 1.2 The new deviation, and why it was safe to continue

`git cat-file -t 0b827cc` returned _bad object_: the commit was not in the local object database.
The clone had been re-fetched shallowly after the reset, so the branch tip was not present locally
even though the remote advertised it. This is a transport artefact of the sandbox, not a content
change.

It was resolved with `git fetch origin arena/e088f11d-afyahub-hmis-kenya main` — a **read-only
fetch that changes no tracked file**. `git cat-file -t 0b827cc` then returned `commit`.

This is recorded rather than silently repaired because it is the first turn in which the commit
object itself, not just the index, was missing. **No conclusion in this document depends on local
objects having been intact**: the worktree content was proved independently by tree hash (§1.3).

### 1.3 Proof that the worktree is the published content plus the expected paths

With a scratch index outside the repository (`GIT_INDEX_FILE=/tmp/idx-batchb-rev`, `git read-tree`,
`git add -A`, `git write-tree`) the worktree hashed to tree `88c48f9`. Diffed against `0b827cc` it
differed by **exactly 14 paths** — the documented 13 plus this document:

| #   | Path                                                                      | Kind                                 |
| --- | ------------------------------------------------------------------------- | ------------------------------------ |
| 1   | `drizzle/0078_approval_policies.sql`                                      | WIP, new, **not in `_journal.json`** |
| 2   | `src/db/schema/approval-policies.ts`                                      | WIP, new                             |
| 3   | `src/facility/approval-policy.service.ts`                                 | WIP, new                             |
| 4   | `src/routes/approval-policy.routes.ts`                                    | WIP, new                             |
| 5   | `src/procurement/requisitions.service.ts`                                 | WIP, modified                        |
| 6   | `src/procurement/procurement.service.ts`                                  | WIP, modified                        |
| 7   | `src/routes/procurement.routes.ts`                                        | WIP, modified                        |
| 8   | `src/routes/procurement-workflow.routes.ts`                               | WIP, modified                        |
| 9   | `docs/project/completion-phases/PHASE-5-FINAL-REPORT.md`                  | untracked doc                        |
| 10  | `docs/project/completion-phases/PHASE-1-4-OUTSTANDING-REGISTER.md`        | untracked doc                        |
| 11  | `docs/project/completion-phases/PHASE-6-INTEGRATION-MATRIX.md`            | untracked doc                        |
| 12  | `docs/project/completion-phases/PHASE-5-ACCEPTANCE-GAP-ASSESSMENT.md`     | untracked doc                        |
| 13  | `docs/project/delivery-evidence/phase-5/verification-run-2026-11-10.json` | untracked evidence                   |
| 14  | `docs/project/completion-phases/BATCH-B-INVENTORY-ACCOUNTING-DESIGN.md`   | **this document**                    |

Nothing else differed. The ref and index were then re-pointed with `git update-ref` and
`git read-tree`. **No file was reset, checked out, stashed or discarded, no branch was switched,
and no history was rewritten.** `git status` shows 0 ahead / 0 behind and exactly the 14 paths.

### 1.4 WIP preservation, verified byte-for-byte

All eight approval-policy files were hashed on entry and compared with the values recorded in the
previous turn. **All eight match exactly:**

| File                                        | MD5                                | Result |
| ------------------------------------------- | ---------------------------------- | ------ |
| `drizzle/0078_approval_policies.sql`        | `38df43659b39924141018aa7c09350ca` | match  |
| `src/db/schema/approval-policies.ts`        | `45e2076aa682af76eb35cf5f2becfbc7` | match  |
| `src/facility/approval-policy.service.ts`   | `1b53915df234d52452996c34a5949bf5` | match  |
| `src/routes/approval-policy.routes.ts`      | `b0bf92ea4fa96a31a8dad66449484e3b` | match  |
| `src/procurement/requisitions.service.ts`   | `662b18bf43215a2b272a6270052530c9` | match  |
| `src/procurement/procurement.service.ts`    | `01c6b47fa41ec4d1b44590b9a2bfc93e` | match  |
| `src/routes/procurement.routes.ts`          | `473d07bf9c940a437e8f1c1569950f5b` | match  |
| `src/routes/procurement-workflow.routes.ts` | `66cddb74130b67bda61c1ee7611b6dc3` | match  |

The Phase 5 documents and evidence were hashed on entry and re-hashed at the end of the turn; the
read-only Phase 1–4 documents, the Phase 5 report/assessment/HR documents, the Phase 6 matrix and
the verification JSON are unchanged (values in §15.2).

### 1.5 Consequences that constrain this design

- **`0078` is owned by uncommitted work.** `0079` is reserved for this work and is the only legal
  next number (§9.1).
- **The working tree cannot pass `src/tests/migrations.spec.ts` today.** That spec asserts every
  `drizzle/*.sql` appears in `meta/_journal.json` (`src/tests/migrations.spec.ts:53-59`) and
  `0078_approval_policies.sql` does not. This is a property of the uncommitted WIP, **not a
  regression at `0b827cc`** — CI at that commit was green on all seven jobs (§12.5). It means the
  approval-policy slice must register `0078` in the same commit that lands it.
- **No backup was rebuilt.** `.wip-backup/` and `/home/user/wip-preservation` are absent, and
  rebuilding them writes files this read-only turn does not authorise. The WIP content is intact in
  the worktree with verified checksums. Rebuilding is the first action of the next turn (§14.0).
- **No test could be run.** `node_modules`, `pgbin` and `pgdata` are all gone; every test figure
  below is quoted with provenance and is labelled as such.

**Files changed by this turn: one.** This document. No existing file was modified, no file was
staged, committed or pushed.

---

## 2. Architecture of the two domains as built

### 2.1 Inventory

| Concern                                              | File                                                                      | Anchors                                                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Item master, lots, receipts, dispensing              | `src/inventory/inventory.service.ts`                                      | `receiveBatchScoped` 523, `dispenseFefoScoped` 1040, `getBatchesScoped` 787                                                       |
| Movements, adjustments, counts, transfers, valuation | `src/inventory/stock-control.service.ts`                                  | `withTx` 39, `StockError` 52, `applyDelta` 174, `adjustStock` 255, `postStockCount` 522, `createTransfer` 607, `getValuation` 777 |
| Item and lot tables                                  | `src/db/schema/inventory.ts`                                              | `inventoryItems`, `inventoryBatches`, `pharmacyDispensations`, `pharmacyDispenseAllocations`                                      |
| Movement, count, transfer tables                     | `src/db/schema/inventory-control.ts`                                      | `inventoryMovements`, `inventoryStockCounts/Lines`, `inventoryTransfers/Items`                                                    |
| Movement DDL and indexes                             | `drizzle/0077_inventory_control.sql`                                      | `inventory_movements_reference_once_idx` 40                                                                                       |
| HTTP                                                 | `src/routes/inventory-control.routes.ts`, `src/routes/pharmacy.routes.ts` | `inventory.read`, `inventory.manage`, `pharmacy.dispense`                                                                         |

### 2.2 Accounting

| Concern                                       | File                                                      | Anchors                                                                                                                                 |
| --------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Posting primitive                             | `src/accounting/accounting.service.ts`                    | `AccountingIntegrityError` 13, `validateBalancedJournalLines` 106, `JournalRequest` 313, `requestHash` 334, `postInsideTransaction` 350 |
| Ledger tables                                 | `src/db/schema/financial-ledger.ts`                       | `chartOfAccounts`, `journalEntries`, `journalLines`, `financialPeriods`                                                                 |
| Balance CHECK, deferred trigger, period guard | `drizzle/0027_dialysis_accounting_icd11_booking_bank.sql` | `journal_entries_balanced_chk` 131; guards 791–832                                                                                      |
| HTTP and error mapping                        | `src/routes/accounting.routes.ts`                         | `AccountingIntegrityError` branch **94-97**                                                                                             |

### 2.3 The seam — and the fact that there is no seam

`postInsideTransaction(client: PoolClient, scope, request)` is the single posting primitive. Seven
call sites:

| Call site                                                 | Purpose                                          | Source type   |
| --------------------------------------------------------- | ------------------------------------------------ | ------------- |
| `src/accounting/billing-posting.service.ts:499`           | invoice / payment / refund                       | `BILLING_*`   |
| `src/assets/fixed-assets.service.ts:678, 973, 1095, 1269` | acquisition, depreciation, disposal, revaluation | `FIXED_ASSET` |
| `src/procurement/receiving.service.ts:679, 880`           | supplier invoice, supplier payment               | `PROCUREMENT` |

**No file under `src/inventory/` imports any accounting module.** Inventory and the ledger are two
systems sharing a database.

The good news: both transaction wrappers already expose the raw client that the primitive needs.

- `stock-control.service.ts:39` — `withTx(fn: (tx: Tx, client: PoolClient) => Promise<T>)`, manual
  `BEGIN` / `COMMIT` / `ROLLBACK`.
- `inventory.service.ts` — `db.transaction(async (tx) => …)` at 268, 453, 483, 582, 992, 1106; the
  drizzle transaction carries `$client` as the underlying `PoolClient`.

So inventory can call the primitive **inside its own existing transaction** and inherit atomicity.
No second accounting engine is needed, and none should be written.

---

## 3. Findings

| ID  | Finding                                                                                                  | Evidence                                                                                                                                                                                                                                                                                                                                                                          | Severity                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | No `INVENTORY` member in `JournalRequest.sourceType`                                                     | `accounting.service.ts:313` union: `MANUAL, REVERSAL, EXPENSE_REQUEST, BILLING_INVOICE, BILLING_PAYMENT, BILLING_REFUND, PAYROLL, FIXED_ASSET, PROCUREMENT`                                                                                                                                                                                                                       | Blocking (code only)                                                                                                                       |
| F2  | `journal_entries.source_type` is plain `text` with **no CHECK**                                          | `financial-ledger.ts:96`; the checks at `0041`, `0044`, `0045` belong to other tables                                                                                                                                                                                                                                                                                             | Relaxes work — no DDL for the new type                                                                                                     |
| F3  | The service does **not** verify debit = credit; it trusts `request.totalCents`                           | `postInsideTransaction` inserts header totals from the request, then lines                                                                                                                                                                                                                                                                                                        | Mitigated by F4                                                                                                                            |
| F4  | The database **does** enforce double entry                                                               | `journal_entries_balanced_chk` (`0027:131`); deferred `INITIALLY DEFERRED` trigger `jalicare_journal_entries_balanced_at_commit` (`0027:791-832`) raising `23514` at COMMIT: ≥2 lines, debits = credits, agreement with header totals, exact per-account inversion for reversals                                                                                                  | Strong — inherited by any new inventory journal                                                                                            |
| F5  | Posting is idempotent and race-safe                                                                      | advisory lock `pg_advisory_xact_lock(hashtextextended(key, facilityId))` (`accounting.service.ts:356`), prior-row lookup, SHA-256 `requestHash` compare; mismatch → `IDEMPOTENCY_CONFLICT` 409; match → prior journal + `idempotentReplay: true`                                                                                                                                  | Strong — reuse as-is                                                                                                                       |
| F6  | `requestHash` does **not** include `totalCents`                                                          | `requestHash` hashes date, description, source type/id, reversal fields and lines                                                                                                                                                                                                                                                                                                 | Minor: a changed total with identical lines is rejected by F4 on first insert, but an idempotent replay would silently return the original |
| F7  | A journal date must fall in **exactly one OPEN period**                                                  | `accounting.service.ts:377-386` → `OPEN_PERIOD_REQUIRED` 409, _"Journal date must be in exactly one open financial period."_                                                                                                                                                                                                                                                      | Good — the D4 mechanism                                                                                                                    |
| F8  | Periods can be **closed but never reopened**                                                             | `accounting.service.ts:294` is the only status write (`'CLOSED'`); `jalicare_financial_period_guard` raises when `OLD.status <> 'OPEN'`                                                                                                                                                                                                                                           | Constrains D4 corrections                                                                                                                  |
| F9  | **Purchases are expensed on purchase**                                                                   | `receiving.service.ts:650-712`: `subtotalCents = cents(note.inventoryValueKes)` debited to `expenseAccountId`; tax debited to the **same** expense account; `apAccountId` credited for the total                                                                                                                                                                                  | The current basis (D1)                                                                                                                     |
| F10 | No stock asset account is touched anywhere                                                               | no inventory or receiving path references an `ASSET` account                                                                                                                                                                                                                                                                                                                      | The gap Batch B closes                                                                                                                     |
| F11 | Accounts are **caller-supplied per invoice**                                                             | `receiving.service.ts:612-613` `positiveInt(body.expenseAccountId)`, `positiveInt(body.apAccountId)`                                                                                                                                                                                                                                                                              | No policy home exists                                                                                                                      |
| F12 | **No COA is seeded by any migration**, and no code resolves an account by code or role                   | no `INSERT INTO chart_of_accounts` in `drizzle/*.sql`; `is_system_account` exists but is only selected (`accounting.service.ts:628`), never used                                                                                                                                                                                                                                  | Activation needs operator configuration                                                                                                    |
| F13 | `inventory_movements` has **no unit-cost column**                                                        | `inventory-control.ts`: tenant, facility, item, batch, type, delta, `stock_after`, reason, reference type/id, store from/to, notes, actor, movement date                                                                                                                                                                                                                          | **Movements do not preserve cost snapshots**                                                                                               |
| F14 | Cost lives on the lot, the GRN line and the mutable item master                                          | `inventory_batches.cost_per_unit`; `goods_received_note_items.unit_cost` / `line_total`; `inventory_items.unit_cost` (editable)                                                                                                                                                                                                                                                   | Lot cost is the only durable basis                                                                                                         |
| F15 | Lot cost is immutable in practice                                                                        | `receiving.service.ts:414-421` → `BATCH_EXPIRY_MISMATCH` / `BATCH_COST_MISMATCH` 409, _"Review the receipt rather than restating earlier stock value."_                                                                                                                                                                                                                           | Good — historical cost survives                                                                                                            |
| F16 | FEFO draw-down **does not record which lots it reduced**                                                 | `applyDelta` (`stock-control.service.ts:174-245`): with `batchId = null` and `delta < 0` it walks lots ascending by expiry, decrements `quantity_remaining`, and **writes no allocation row**; the movement stores `batchId: null`                                                                                                                                                | **Blocking for costing adjustments, counts and write-offs**                                                                                |
| F17 | Dispensing records lots but not cost                                                                     | `dispenseFefoScoped` inserts `pharmacy_dispense_allocations (dispensationId, batchId, batchNumber, expiryDate, quantity)`; the movement is `DISPENSE` with `batchId: null`; it snapshots `sellingPriceSnapshot`, never cost                                                                                                                                                       | Cost **recoverable by join**, not stored                                                                                                   |
| F18 | Movement uniqueness is `(facility_id, reference_type, reference_id, movement_type)` — **no item column** | `0077_inventory_control.sql:40-42`                                                                                                                                                                                                                                                                                                                                                | Why Batch A needed per-item references; also a stable idempotency anchor                                                                   |
| F19 | Stock-count posting is atomic and replay-safe                                                            | `postStockCount` (`stock-control.service.ts:522`): one `withTx`, header `FOR UPDATE`, `status !== 'OPEN'` → `COUNT_CLOSED` 409, per-item variance movements, `POSTED`, one audit row                                                                                                                                                                                              | Good template                                                                                                                              |
| F20 | An adjustment's reference is **non-deterministic**                                                       | `adjustStock` (`stock-control.service.ts:255`): `referenceId: ${itemId}:${movementDate}:${Date.now().toString(36)}`                                                                                                                                                                                                                                                               | Journal keys must not derive from it                                                                                                       |
| F21 | Transfers are **intra-facility by construction** and move no stock                                       | `createTransfer` (`stock-control.service.ts:607`): `storeFrom`/`storeTo` are free-text labels on the same `facilityId`; two movements with the **same** `stockAfter`; no `current_stock` update, no `applyDelta`, **no lot movement**                                                                                                                                             | No journal needed                                                                                                                          |
| F22 | Valuation is lot-based, excludes unvalued lots, reports gaps                                             | `getValuation` (`stock-control.service.ts:777-860`): `Σ quantity_remaining × cost_per_unit` for `quantity_remaining > 0` and `i.facility_id = $1`; `unvaluedBatches`/`unvaluedQuantity` counted separately; `batchReconciliation` lists items where `current_stock ≠ Σ batch quantity`                                                                                            | The reconciliation denominator                                                                                                             |
| F23 | Valuation **includes deactivated items**                                                                 | the batch query filters `i.facility_id` only; the unbatched query filters `i.is_active = TRUE`. Asymmetric by accident of query shape                                                                                                                                                                                                                                             | Must be stated so the invariant is evaluated on `totalKes`, not on an active subset                                                        |
| F24 | `AccountingIntegrityError` is **swallowed to 500** on inventory paths                                    | `shared/errors.ts:150-164 respondInternalError` logs and returns **500** `{ error: message }` for anything unrecognised; `inventory-control.routes.ts:64-70 handleError` sends every non-`StockError` there; `shared/errors.ts:232-247 handleInventoryError` handles only `ScopeAccessError` and `InventoryDomainError`; `pharmacy.routes.ts:399-404` falls through to a bare 500 | **A closed period would surface as 500 today**                                                                                             |
| F25 | The correct mapping **already exists**, in another router                                                | `accounting.routes.ts:94-97`: `res.status(error.status).json({ success: false, error: error.code, message: error.message })`                                                                                                                                                                                                                                                      | Precedent for C0 — extract, do not reinvent                                                                                                |
| F26 | Permission checks are route-level only                                                                   | `accounting.routes.ts` uses `requirePermission('accounting.journals.post')`; `accounting.service.ts` checks none                                                                                                                                                                                                                                                                  | System postings require no accounting permission — must be documented, not accidental                                                      |
| F27 | Accounts must be active and facility-scoped to post                                                      | `accounting.service.ts:386-395`: `tenant_id`/`facility_id`/`is_active` with `FOR SHARE`; mismatch → `ACCOUNT_OUT_OF_SCOPE` 403                                                                                                                                                                                                                                                    | Reuse for policy validation                                                                                                                |
| F28 | `journal_lines` can carry `supplier_id`, `patient_id`, `invoice_id`                                      | `financial-ledger.ts` `journalLines`                                                                                                                                                                                                                                                                                                                                              | AP and consumption can be attributed                                                                                                       |
| F29 | `inventory_items` has **no `tenant_id`** (facility only); `inventory_movements` has both                 | `inventory.ts` vs `inventory-control.ts`                                                                                                                                                                                                                                                                                                                                          | Policy must key on tenant **and** facility, resolved from `StockScope`                                                                     |
| F30 | Tax is an opaque caller-supplied amount with no recoverability concept                                   | `receiving.service.ts:614`: `taxCents = nonNegativeMoney(body.taxAmount ?? 0)`; no tax code, rate, or VAT account anywhere                                                                                                                                                                                                                                                        | **Blocks correct tax treatment (§8.2)**                                                                                                    |
| F31 | `receiveBatchScoped` does **not lock the item row**; dispensing does                                     | `receiveBatchScoped` (`inventory.service.ts:582`+) takes only a per-receipt advisory lock and writes `currentStock: sql\`… + quantity\``(623);`dispenseFefoScoped`takes item`FOR UPDATE`(1336) and batch`FOR UPDATE`(1364);`adjustStock`/`postStockCount`/`createTransfer`lock via`loadItem(…, true)`                                                                             | **Activation cannot rely on row locks alone (§8.4)**                                                                                       |
| F32 | Fixed assets post their own `FIXED_ASSET` journals; nothing links them to inventory                      | `fixed-assets.service.ts:678, 973, 1095, 1269`                                                                                                                                                                                                                                                                                                                                    | No double count today; a future "capitalise equipment through procurement" path would collide with F9                                      |

---

## 4. Current-state flows

### 4.1 Purchase → receipt → invoice (the money path that exists)

```text
Purchase order ──► GRN (goods_received_notes)
                     │  line: quantity_received, unit_cost, line_total, batch_number, expiry
                     │  header: inventory_value_kes = Σ line_total
                     │  inventory_batches: cost_per_unit, quantity_remaining   (lot created here)
                     │  inventory_movements: RECEIPT, no value
                     ▼
                Supplier invoice  (receiving.service.ts:650-712)
                     │  taxAmount: caller-supplied, opaque, no recoverability flag  (F30)
                     │  DR expenseAccountId   subtotal          ← caller-supplied
                     │  DR expenseAccountId   tax (if any)      ← SAME expense account
                     │  CR apAccountId        total
                     │  source_type  PROCUREMENT,  source_id grn:<grnId>
                     │  idempotency  supplier-invoice:<facilityId>:<key>
                     │  guard        GRN_ALREADY_INVOICED on replay
                     ▼
                Ledger: an EXPENSE, not an ASSET.
```

### 4.2 Consumption

```text
FEFO selection ──► pharmacy_dispense_allocations (batch_id, quantity)
                     │  lot quantity_remaining -= qty        (batch rows locked)
                     │  item.current_stock   -= qty          (item row locked)
                     │  pharmacy_dispensations: sellingPriceSnapshot — no cost
                     │  inventory_movements: DISPENSE, batchId = null
                     ▼
                Ledger: nothing.
```

Billing posts `BILLING_INVOICE` for the sale, so a dispensed item produces **revenue with no cost
of goods**, overstating margin by the full cost of every item dispensed. That is the missing half
of a double entry, not a billing defect.

### 4.3 Adjustments, counts, write-offs, transfers

```text
adjustStock ────► applyDelta (FEFO if no batch named; allocation NOT recorded)
                   └─► movement ADJUSTMENT | WRITE_OFF  (ref ADJUSTMENT, refId item:date:base36)
                   └─► audit_logs InventoryAdjustment/ADJUST
                   └─► ledger: nothing

postStockCount ─► one transaction, header FOR UPDATE, OPEN → POSTED
                   └─► per counted line with variance ≠ 0:
                         applyDelta (FEFO, allocation NOT recorded)
                         movement COUNT_VARIANCE (ref STOCK_COUNT, refId <countId>:<itemId>)
                   └─► audit_logs InventoryStockCount/POST
                   └─► ledger: nothing

createTransfer ─► two movements per line, TRANSFER_OUT and TRANSFER_IN, same stockAfter,
                   no current_stock change, no lot change
                   └─► ledger: nothing — and nothing is required (F21)
```

### 4.4 Valuation — a report, not a balance

```text
inventory_batches (quantity_remaining > 0, facility)          ← no is_active filter (F23)
   ├─ valued   : Σ qty × cost_per_unit        → totalKes
   ├─ unvalued : cost_per_unit IS NULL        → counted, EXCLUDED from total
   └─ batchReconciliation: items where current_stock ≠ Σ batch quantity
```

`totalKes` is the figure a stock asset account would have to equal. Nothing compares it to anything
today.

### 4.5 Where value is created and where it leaks

| Event            | Physical stock | Lot                    | Cost recorded   | Ledger              |
| ---------------- | -------------- | ---------------------- | --------------- | ------------------- |
| GRN receipt      | +              | + (with cost)          | yes, on the lot | none until invoiced |
| Supplier invoice | —              | —                      | —               | DR expense / CR AP  |
| Dispense         | −              | −                      | **no**          | revenue only        |
| Adjustment ±     | ±              | ± (FEFO, unattributed) | **no**          | none                |
| Count variance ± | ±              | ± (FEFO, unattributed) | **no**          | none                |
| Write-off        | −              | − (FEFO, unattributed) | **no**          | none                |
| Transfer         | unchanged      | unchanged              | —               | none (correct)      |

Three leaks, in size order: **expensed purchases with no asset**, **consumption with no cost**, and
**unattributed lot reductions**.

---

## 5. Future-state flow (perpetual basis)

```text
┌─ Activation (once per facility, serialized — §8.4) ───────────────────────────┐
│ preconditions (§9.3) — all re-checked AFTER locks, inside one transaction     │
│ opening journal:                                                             │
│      DR  stock asset account          Σ valuation.totalKes                    │
│      CR  opening counterpart account  Σ valuation.totalKes   ← configured,    │
│                                          never implied (§8.1)                │
│      source_type INVENTORY, source_id policy:<facilityId>:<version>           │
└───────────────────────────────────────────────────────────────────────────────┘

GRN receipt                          Supplier invoice
  DR stock asset    line value         DR GRN clearing    net
  CR GRN clearing   line value         DR input VAT       recoverable tax
  key inv:grn:<f>:<grnId>              DR tax expense     non-recoverable tax
                                       CR AP              total
                                       key supplier-invoice:<f>:<key>  (unchanged)

Dispense                             Adjustment / count / write-off
  DR consumption (COGS)  lot cost      surplus: DR stock asset / CR adjustment
  CR stock asset         lot cost      shortage: DR adjustment or write-off
  key inv:dispense:<f>:<id>                      / CR stock asset
  cost from allocations ⨝ batches     key inv:count:<f>:<countId>
                                      key inv:adjustment:<f>:<id>

Transfer (same facility)             Closed period
  no journal — no value leaves         whole event rolls back, 409 OPEN_PERIOD_REQUIRED
```

Invariants:

1. Every stock-changing event writes **both** its movement and its journal, or **neither** — same
   transaction, same commit.
2. Stock asset balance `= totalKes` under the exact conditions of §8.3. Not "approximately".
3. One event produces at most one journal (F5).
4. Posted journals are never edited or deleted; corrections are reversals (§6, D4).

---

## 6. Decisions D1–D4

### 6.1 D1 — Accounting basis

**Recommendation: support both `EXPENSE_ON_PURCHASE` and `PERPETUAL`; retain
`EXPENSE_ON_PURCHASE` as the default.** See Q1 in §7 for the proposed decision.

- **History cannot be restated.** Movements carry no value (F13) and FEFO reductions are
  unattributed (F16), so the cost of everything already issued is unrecoverable. A facility that
  has been expensing has no defensible opening stock value except today's valuation.
- **Switching is a cut-off, not a conversion.** Activation posts one opening journal for
  `totalKes`; nothing before it is restated.
- **Half-perpetual is worse than either.** Purchases capitalised without consumption posting
  inflates the asset forever; consumption without capitalisation drives it negative. The basis must
  be a facility-level switch enforced in one place.

| Basis                           | Purchase                                         | Consumption              | Write-off / variance          | Stock asset          |
| ------------------------------- | ------------------------------------------------ | ------------------------ | ----------------------------- | -------------------- |
| `EXPENSE_ON_PURCHASE` (default) | DR expense / CR AP — unchanged                   | **no posting**           | **no posting**                | unused               |
| `PERPETUAL`                     | DR stock asset / CR clearing, then clearing / AP | DR COGS / CR stock asset | DR write-off / CR stock asset | must equal valuation |

Under `EXPENSE_ON_PURCHASE`, posting consumption would double-expense (R1). The consumption path
must therefore be **branch-gated on the policy**, not merely "post when accounts are mapped".

### 6.2 D2 — What perpetual posts

**Recommendation: post on five events; never on transfers.**

| Event            | Journal                                                   | Source id           | Idempotency key                           |
| ---------------- | --------------------------------------------------------- | ------------------- | ----------------------------------------- |
| GRN receipt      | DR stock asset / CR GRN clearing                          | `grn:<id>`          | `inv:grn:<f>:<id>`                        |
| Supplier invoice | DR clearing (net) · DR input VAT · DR tax expense / CR AP | `grn:<id>`          | existing `supplier-invoice:…` (unchanged) |
| Dispense         | DR consumption / CR stock asset                           | `dispensation:<id>` | `inv:dispense:<f>:<id>`                   |
| Adjustment       | stock asset vs adjustment account                         | `adjustment:<id>`   | `inv:adjustment:<f>:<id>`                 |
| Stock count      | one journal per count, netted **by account**, not by item | `stock-count:<id>`  | `inv:count:<f>:<id>`                      |
| Write-off        | DR write-off / CR stock asset                             | `adjustment:<id>`   | `inv:writeoff:<f>:<id>`                   |
| Transfer         | **none** (F21)                                            | —                   | —                                         |

**Capitalise at receipt, recognise AP at invoice, with a GRN clearing account** (Q3). Capitalising
at invoice would leave received-but-uninvoiced stock outside the ledger, so invariant 2 would fail
for exactly the stock physically on the shelf.

**Cost basis: the actual lot cost consumed.** Dispensing already records lots (F17), so its cost is
a join. Adjustments, counts and write-offs have none (F16), so `applyDelta` must **return** the lots
it reduced and they must be persisted — the most invasive change in the batch, sequenced alone (C2)
with defect-injection proof.

**Reconciliation is a report.** It never posts a correcting entry (§8.3).

### 6.3 D3 — Is `0079` available?

**Verified: yes. `0079` is free and is the correct next number.**

- `drizzle/meta/_journal.json` holds **78 entries**, index 0–77, last tag `0077_inventory_control`.
- `drizzle/` holds **79 `.sql` files**; the only unregistered file is the uncommitted
  `0078_approval_policies.sql`.
- Therefore `0078` is reserved by uncommitted work and `0079` is the first number that collides
  with neither a file on disk nor a committed migration.

Consequences:

1. **The source-type addition needs no DDL** (F2): `INVENTORY` is a TypeScript union change.
2. **The migration exists for the policy table** (§9.2).
3. **`0079_inventory_accounting.sql` is reserved and deliberately not created in this task.**
4. **Do not take `0078`**, even if this work lands first: the WIP owns the filename, and two
   migrations sharing a number is unrecoverable without rewriting history.
5. Any future commit adding `0079` must register it in `_journal.json` (index 78, timestamp newer
   than `0077`) in the **same commit**; `src/tests/migrations.spec.ts:40-95` enforces parity,
   contiguity and increasing timestamps.

### 6.4 D4 — Closed periods and corrections

**Recommendation: block and roll back the whole event, surface a clear 409, correct forward only.**
Mechanism in §8.6.

Already working, not to be rebuilt:

- The date resolves to exactly one OPEN period before insert; failure → `OPEN_PERIOD_REQUIRED` 409 (F7).
- The DB independently refuses a closed or mismatched period (`jalicare_journal_header_guard`,
  `23514`), so a code path that skips the check still cannot corrupt the ledger.
- Posting inside the inventory transaction rolls the movement back with the journal (§8.6.3).

Must be fixed for D4 to be satisfied:

1. **The error must reach the client intact** — today it becomes a 500 (F24). §8.6.1.
2. **The entry date must be the business-event date**: `movementDate` for adjustments, `countDate`
   for counts, `dispensingDateSnapshot` for dispensing, `received_date` for receipts. Using "today"
   would book January receipts into November.
3. **A blocked event must say which date and period.** Contract in §8.6.2.
4. **Periods cannot be reopened (F8), so corrections go forward**: a reversal dated in the current
   open period, plus a compensating stock adjustment, as **one** action. Reversing the journal alone
   breaks invariant 2 by leaving the movement; adjusting stock alone breaks it in the other
   direction.
5. **Historical unposted movements** are handled by the opening entry, never by back-posting — the
   periods covering that stock are almost certainly closed and back-posting would double-count
   against the opening balance. Activation refuses rather than guesses (§9.3).
6. **Partial-failure rule.** If the journal fails for any reason, the stock change fails with it.
   Never "record the stock, log the accounting failure". The only recovery is a later retry that
   produces exactly one journal, which F5 makes safe.

---

## 7. Six design questions — proposed decisions awaiting approval

> **These are proposals, not approvals.** The user's guidance is recorded as a proposed decision in
> each case; none is marked approved, and §13.3 states what each still needs.

### Q1 — Support both bases, default to expense-on-purchase

**Proposed decision:** support `EXPENSE_ON_PURCHASE` and `PERPETUAL` as a facility policy;
`EXPENSE_ON_PURCHASE` is the default for every facility and the only behaviour available to a
facility that has not activated perpetual.

| Aspect      | Proposed                                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage     | `facility_inventory_accounting.basis`, one ACTIVE row per facility                                                                                       |
| Default     | `EXPENSE_ON_PURCHASE`, created lazily — an absent row means the default                                                                                  |
| Switch      | One-way in practice: activation requires a clean cut-off; re-activation requires a new version row and a new cut-off                                     |
| Enforcement | One `resolveBasis(scope)` helper; every posting site branches on it                                                                                      |
| Reversible? | No automatic reversal. A facility may stop capitalising prospectively with an accountant-approved closing entry; that is a future decision, not in C1–C8 |

**Status: proposed. Not approved.**

### Q2 — One consumption/COGS account per facility

**Proposed decision:** a single configurable `consumption_account_id` per facility; category-level
accounts are a documented future extension, not part of C1–C8.

| Aspect           | Proposed                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Granularity      | one account per facility                                                                                                                                                             |
| Future extension | `inventory_item_categories` → account mapping, added later without changing the journal contract                                                                                     |
| Rationale        | `inventory_items.category` is free text with a default (`'Pharmaceuticals'`) and no enumeration table exists, so a category→account mapping would be built on an uncontrolled string |
| Consequence      | pharmacy, laboratory consumables and general stores share one COGS line; acceptable for a single-facility ledger, insufficient for departmental reporting                            |
| Mitigation       | carry `service_line` / `departmentCode` on the journal line if and when departments are configured                                                                                   |

**Status: proposed. Not approved.**

### Q3 — Capitalise stock at GRN receipt using a GRN clearing account

**Proposed decision:** capitalise at receipt; recognise AP at invoice; balance through a GRN
clearing account.

| Aspect               | Proposed                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Timing               | title and risk assumed at receipt (this is when stock is physically controlled)                                             |
| Clearing account     | `clearing_account_id`, type `ASSET` or `LIABILITY`                                                                          |
| Invoice              | clears the clearing account for the net; no second capitalisation                                                           |
| Uninvoiced stock     | sits in clearing, correctly inside the ledger before the invoice arrives                                                    |
| Alternative rejected | capitalise at invoice — leaves received-but-uninvoiced stock outside the ledger, violating invariant 2 for real shelf stock |
| Risk                 | clearing accumulates if invoices are never raised; §8.3 makes clearing its own invariant so the balance is visible          |

**Status: proposed. Not approved.**

### Q4 — Do not assume real facilities have open historical periods

**Proposed decision:** no assumption is made about historical period state. Activation requires
**facility-specific verification** that `effective_from` falls inside an OPEN period, and refuses
otherwise.

| Aspect                         | Proposed                                                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Assumption made                | none                                                                                                                                          |
| Verification                   | at activation, inside the transaction: exactly one OPEN period contains `effective_from` (F7); otherwise 409 `OPEN_PERIOD_REQUIRED`           |
| Consequence for old facilities | activation for a facility whose history is fully closed requires opening a new period first — an operator action, recorded in the audit trail |
| Consequence for backlog        | stock received before `effective_from` is never back-posted; it is valued into the opening entry                                              |
| Not permitted                  | silently choosing a different date, or back-dating into a closed period                                                                       |

**Status: proposed. Not approved.**

### Q5 — Zero-cost donated or sample stock only through an authorised, audited classification

**Proposed decision:** a lot with no cost may exist only if explicitly classified as a zero-cost
donation/sample, authorised and audited. Otherwise it blocks activation.

| Aspect               | Proposed                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Problem              | `getValuation` excludes null-cost lots from `totalKes` (F22); under perpetual that means real stock with no asset, so invariant 2 silently holds on a subset |
| Mechanism            | a `zero_cost_classification` on the batch (or a policy-level flag plus a per-lot audit record): `DONATION`, `SAMPLE`, `TRIAL_STOCK`                          |
| Authorisation        | a permission distinct from `inventory.manage`; the approver is recorded                                                                                      |
| Audit                | one `audit_logs` row per classification, naming the lot, quantity, reason and approver                                                                       |
| Effect on valuation  | included at zero, but **declared** in `totalKes` as a separate line so the difference is never netted                                                        |
| Effect on activation | permitted only when every unvalued lot carries a classification; otherwise 409 `UNVALUED_STOCK`                                                              |
| Rejected alternative | treating absent cost as zero — that is treating unknown as zero, which this project forbids                                                                  |

**Status: proposed. Not approved.**

### Q6 — Finance authorisation for activation; inventory authorisation in the operational workflow

**Proposed decision:** perpetual activation requires **finance** authorisation, with inventory
authorisation included in the operational workflow.

| Operation                        | Permissions required                                                                                          | Rationale                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Read policy                      | `accounting.read`                                                                                             | —                                                        |
| Save account mapping (DRAFT)     | `accounting.coa.manage` **and** `inventory.manage`                                                            | changes what inventory will post                         |
| Activate perpetual               | `accounting.coa.manage` **and** `inventory.manage`, **plus** an explicit finance approver recorded on the row | an accounting-basis change, not an inventory setting     |
| Deactivate / supersede           | `accounting.periods.close` **and** `inventory.manage`                                                         | a period-boundary action                                 |
| Daily stock operations           | unchanged (`inventory.manage`, `pharmacy.dispense`)                                                           | operators must not need accounting rights to dispense    |
| View reconciliation              | `accounting.read`                                                                                             | —                                                        |
| Approve zero-cost classification | new permission, e.g. `inventory.zero-cost.approve`                                                            | separates the operational act from the accounting waiver |

Consequences: the activation endpoint needs a second, finance identity — recorded as
`activated_by_user_id` **and** `finance_approved_by_user_id` — not merely a stronger permission
check on the same session. System postings triggered by inventory operations deliberately require
no accounting permission (F26); the operator is recorded as `posted_by_user_id` and each event
writes an audit row.

**Status: proposed. Not approved.**

---

## 8. Technical corrections

### 8.1 A — The opening balance counterpart must be configured, never assumed

Revision 1 credited "opening equity". **That was wrong**: it assumed a chart of accounts the
repository does not define (F12) and a treatment only an accountant can choose. A facility may book
its opening stock against retained earnings, a capital reserve, an inter-branch or director loan, or
a suspense account pending audit.

**Correction.** The policy carries an explicit **`opening_balance_account_id`**, configured and
approved before activation can run.

| Rule                | Detail                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Required            | activation refuses without it (part of the ACTIVE precondition, §8.5)                                                                                  |
| Permitted types     | `EQUITY` or `LIABILITY`; an `ASSET` or `EXPENSE` counterpart is refused — that would net the stock asset against itself or expense the opening balance |
| Validation          | active, facility-scoped, reusing the `FOR SHARE` check at `accounting.service.ts:386` (F27)                                                            |
| Approval            | `finance_approved_by_user_id` + `approval_note` recorded on the policy row; one `audit_logs` row per activation                                        |
| Journal description | must contain `Opening stock balance` and `effective_from`, so it is identifiable in the trial balance without consulting the policy row                |
| Reversal            | the opening journal is reversible only through the D4 correction path, never by deletion (the DB forbids deleting a POSTED journal)                    |
| Not permitted       | defaulting to any account, or deriving one by code/type heuristic                                                                                      |

### 8.2 B — Tax treatment: four components, separated

Today `taxAmount` is an opaque caller-supplied figure debited to the **same expense account** as the
stock (F30), with `total = inventory_value + tax` credited to AP. There is no VAT account, no rate,
and no recoverability flag anywhere in the codebase.

**Correction.** Four components must be distinguished, each with its own account and treatment.

| #   | Component                      | Source today                                                    | Treatment under `PERPETUAL`                                                             | Treatment under `EXPENSE_ON_PURCHASE`          |
| --- | ------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | **Inventory acquisition cost** | `goods_received_notes.inventory_value_kes` = Σ GRN `line_total` | capitalised: DR stock asset / CR clearing at receipt                                    | DR expense / CR clearing, unchanged from today |
| 2   | **Recoverable input VAT**      | **does not exist** — must be supplied                           | DR input VAT account / CR AP. **Not** part of inventory cost; it is a receivable offset | identical                                      |
| 3   | **Non-recoverable VAT or tax** | merged into the opaque `taxAmount`                              | DR tax expense account / CR AP — **not** capitalised (see below)                        | DR expense / CR AP                             |
| 4   | **Supplier payable**           | `apAccountId` credited for `subtotal + tax`                     | CR AP for the sum of 1, 2 and 3                                                         | identical                                      |

Three consequences that must be designed for, not discovered:

1. **The GRN value must be defined as net of recoverable VAT.** `goods_received_note_items` has
   `unit_cost` and `line_total` and **no tax column**, so `inventory_value_kes` is whatever the
   receiving clerk typed. If a clerk types a VAT-inclusive unit cost, the stock asset will be
   overstated by the recoverable portion and no reconciliation can detect it (valuation and GL would
   both be inflated consistently — the error is invisible to invariant 2). **This is the most
   dangerous defect class in the whole design** and needs an explicit field-level rule in C3 plus a
   UI statement that unit cost is exclusive of recoverable VAT.
2. **`taxAmount` must be split, with a safe default.** Proposed input: an optional structured
   breakdown `{ recoverableTax, nonRecoverableTax }`. When only the legacy scalar `taxAmount` is
   supplied, it is treated **entirely as non-recoverable**. Never infer recoverability from a rate,
   a supplier, or an amount.
3. **Non-recoverable tax is proposed as an immediate expense, not capitalised**, because
   `inventory_batches.cost_per_unit` comes from the GRN `unit_cost` and never includes tax; capitalising
   at invoice would put value into the stock asset that valuation cannot see, so invariant 2 would
   fail on a timing difference with no way to distinguish it from an error. **Strict IAS 2 would
   absorb non-recoverable tax into inventory cost.** This is a genuine accounting-policy conflict,
   raised as an unresolved decision in §13.3 (U1), not silently resolved here.

New mapped accounts required by the policy (see §9.2): `input_vat_account_id` and
`non_recoverable_tax_account_id`.

### 8.3 C — The reconciliation invariant, stated precisely

`getValuation().totalKes` and the stock asset GL balance **must be equal, with zero tolerance**, if
and only if **all** of the following hold. Each condition names a difference class; **no class may
be netted against another**, and the report must itemise rather than sum them.

| #   | Condition                                                                                                                  | Difference class if violated                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | An ACTIVE `PERPETUAL` policy exists with `effective_from = E`                                                              | `POLICY` — not perpetual; no comparison is defined                                     |
| 2   | No journal line on the mapped stock asset account has `entry_date < E`                                                     | `PRE_PERIOD` — pre-activation postings                                                 |
| 3   | The opening journal exists exactly once for `E`, and its amount equals the valuation captured at activation                | `OPENING` — opening ≠ valuation at E                                                   |
| 4   | Every movement with `movement_date >= E` has exactly one linked `INVENTORY` journal, and every such journal has a movement | `UNPOSTED` — movement without journal, or journal without movement                     |
| 5   | No movement exists with `movement_date < E` that was created at or after activation                                        | `BACKDATED` — post-cut-off posting dated before the cut-off                            |
| 6   | `unvaluedQuantity = 0`, or every unvalued lot carries a Q5 zero-cost classification                                        | `UNVALUED` — real stock absent from `totalKes`                                         |
| 7   | `batchReconciliation` is empty at the measurement instant                                                                  | `UNBATCHED` — `current_stock ≠ Σ lot quantity`, so valuation omits stock               |
| 8   | The comparison is evaluated on **`totalKes` exactly as returned**, which includes batches of deactivated items (F23)       | `SCOPE` — comparing an "active items only" subset                                      |
| 9   | Rounding: valuation accumulates `BigInt(quantity) × BigInt(round(cost×100))` in integer cents and the GL stores cents      | `ROUNDING` — must be identically zero; any non-zero value is a defect, not a tolerance |

**Two further invariants that are not the stock-asset comparison but are equally mandatory:**

| Invariant | Statement                                                                  | Class                                                          |
| --------- | -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Clearing  | `clearing balance = Σ GRN value where no supplier invoice exists`          | `CLEARING` — an uninvoiced receipt or a double-cleared invoice |
| Tax       | `input VAT balance = Σ recoverable tax declared on invoices in the period` | `TAX` — recoverable VAT claimed without evidence               |

**Measurement rules.**

- Dated as of a single instant; the report shows the instant.
- Effective dates are **inclusive** of `E`: the opening entry is dated `E`, and movements on `E`
  thereafter are capitalised. A movement on `E` must be either fully inside the opening valuation or
  fully journaled — never both. §9.3 precondition 5 enforces the boundary.
- The report is **read-only** and may never post a correcting entry.
- A non-zero difference is a **finding to investigate**, never a tolerance to absorb.

### 8.4 D — Activation concurrency

**Correction.** Revision 1 relied on the activation transaction simply reading valuation. That is
not sufficient, and the code shows why:

- `adjustStock`, `postStockCount` and `createTransfer` lock the item row through
  `loadItem(…, true)` (`stock-control.service.ts`).
- `dispenseFefoScoped` locks the item row (1336) and the batch rows (1364).
- **`receiveBatchScoped` locks neither**: it takes only a per-receipt advisory lock
  (`inventory-receipt:<facilityId>:<key>`) and increments with
  `currentStock: sql\`… + quantity\`` (623), taking a row lock only at UPDATE time (F31).

A receipt that inserts a lot and then blocks on the item UPDATE cannot commit, so its stock is
invisible to activation's valuation read — and it commits immediately after activation, producing an
un-capitalised stock increase and permanent drift. Row locks alone cannot close that window.

**Mechanism: a facility-scoped advisory lock shared by activation and every stock mutation.**

```sql
-- one namespace for the whole inventory domain
SELECT pg_advisory_xact_lock(146908, $facilityId);
```

1. **C1** introduces one helper, `withInventoryFacilityLock`, taken as the **first statement** of the
   transaction in: activation, `adjustStock`, `postStockCount`, `createTransfer`,
   `receiveBatchScoped`, `dispenseFefoScoped`.
2. **Activation order inside its single transaction:** take the lock → `SET LOCAL lock_timeout`
   (short, e.g. 3 s) → re-run preconditions → **capture valuation** → post the opening journal →
   write the ACTIVE policy row → commit.
3. **Capture after the lock, never before.** A valuation read taken outside the transaction, or
   before the lock, is stale by construction. The figure that is posted must be the figure read
   under the lock.
4. **Why this is sound:** every stock mutation either committed before activation acquired the lock
   (and is therefore inside the captured valuation) or begins after activation commits (and is
   therefore journaled, because the policy is already ACTIVE).
5. **Deadlock hygiene:** lock namespace `146908` is distinct from the period guard's `146907`;
   the ordering (facility lock → period guard) is fixed and one-directional. `lock_timeout` turns a
   pathological wait into a fast 409 `ACTIVATION_BUSY` rather than a hang.
6. **Deliberate cost:** writers to the same facility serialise. For a single facility this is
   acceptable and matches existing behaviour, since item and batch row locks already serialise most
   of the same traffic. It is **not** a global lock and does not cross facilities.
7. **Residual hazard, documented not hidden:** a receipt **back-dated before `effective_from`** that
   starts after activation will fail at the journal step (`OPEN_PERIOD_REQUIRED`, because `E`'s
   period is closed to new postings or the date precedes it). It is rejected, not silently
   accepted — the correct outcome, but it means post-activation back-dating is no longer possible for
   stock. This must be stated in the activation confirmation screen.
8. **Partial adoption is worse than none.** If only some mutating paths take the lock, the guarantee
   is false. C1 must adopt it in all six entry points, and a test must assert that each one takes it.

### 8.5 E — Resolving the `opening_journal_id` workflow conflict

**The conflict.** Revision 1's table had
`CHECK (basis <> 'PERPETUAL' OR (… AND opening_journal_id IS NOT NULL))`. That makes a `PERPETUAL`
row impossible to insert before the opening journal exists — but the journal cannot be posted before
the policy is known to be the one being activated. The constraint and the workflow were mutually
exclusive.

**Correction.** Separate _configuration_ from _activation_ with an explicit lifecycle column, and
scope the completeness CHECK to the ACTIVE state.

| State        | Meaning                        | Permitted?                    |
| ------------ | ------------------------------ | ----------------------------- |
| _(no row)_   | default `EXPENSE_ON_PURCHASE`  | yes — the normal state        |
| `DRAFT`      | accounts chosen, not activated | yes, editable, posts nothing  |
| `ACTIVE`     | in force                       | yes, exactly one per facility |
| `SUPERSEDED` | replaced by a later activation | yes, historical, immutable    |

```sql
status text NOT NULL DEFAULT 'DRAFT'
  CHECK (status IN ('DRAFT','ACTIVE','SUPERSEDED'))

-- completeness is required only of an ACTIVE perpetual row
CONSTRAINT facility_inventory_accounting_active_complete CHECK (
  status <> 'ACTIVE'
  OR basis <> 'PERPETUAL'
  OR (stock_asset_account_id IS NOT NULL
      AND adjustment_account_id IS NOT NULL
      AND consumption_account_id IS NOT NULL
      AND write_off_account_id IS NOT NULL
      AND clearing_account_id IS NOT NULL
      AND opening_balance_account_id IS NOT NULL
      AND opening_journal_id IS NOT NULL))

-- exactly one ACTIVE row per facility, history preserved
CREATE UNIQUE INDEX facility_inventory_accounting_active_once_idx
  ON facility_inventory_accounting (facility_id) WHERE status = 'ACTIVE';
```

This satisfies both halves of the requirement:

- **Creatable before the journal exists** — a `DRAFT` row carries no completeness obligation, so the
  accounts can be configured, reviewed and corrected freely.
- **No incomplete perpetual activation can be committed** — the only way to become `ACTIVE` with
  `basis = 'PERPETUAL'` is to satisfy the CHECK at COMMIT, which requires `opening_journal_id`. If
  activation fails anywhere, the UPDATE to `ACTIVE` is in the same transaction as the journal, so
  neither is written.
- **History is kept** rather than overwritten: `UNIQUE (facility_id)` is replaced by
  `UNIQUE (facility_id, version)` plus the partial unique index, so a superseded activation remains
  auditable.

### 8.6 F — Closed periods: from `AccountingIntegrityError` to HTTP 409, with proof

#### 8.6.1 The error must not become a 500

`AccountingIntegrityError` already carries `(code, message, status)` — `accounting.service.ts:13-22`
— and `src/app.ts:463` honours a `status` for body-level errors. But **three inventory-facing
handlers bypass it** (F24):

| Path                          | Handler                                         | Today                                                                                  |
| ----------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| 12 stock-control endpoints    | `inventory-control.routes.ts:64-70 handleError` | `StockError` → mapped; **everything else → `respondInternalError` → 500**              |
| Dispensing and inventory CRUD | `shared/errors.ts:232-247 handleInventoryError` | `ScopeAccessError`, `InventoryDomainError` handled; **otherwise false → caller's 500** |
| Pharmacy dispense route       | `pharmacy.routes.ts:399-404`                    | explicit `500 { error: 'Dispensing could not be completed.' }`                         |

**Correction: extract the mapping that already exists at `accounting.routes.ts:94-97` into one
shared function and call it from both inventory entry points.** The extraction is mechanical and
changes no behaviour for any current caller, because no inventory path throws the class yet.

```ts
// src/routes/shared/errors.ts  (new export)
export const handleAccountingIntegrityError = (
  error: unknown,
  res: Response,
): boolean => {
  if (error instanceof AccountingIntegrityError) {
    res.status(error.status).json({
      success: false,
      error: error.code,
      message: error.message,
    });
    return true;
  }
  return false;
};
```

Import safety: `accounting.service.ts` imports only `node:crypto`, `pg` types, `../db/index.ts` and
`./journal-scope-integrity.ts` — it never imports from `routes/`, so `shared/errors.ts` importing it
creates no cycle. The file already imports eight service modules, so the pattern is established.

#### 8.6.2 Response contract

| Situation                                     | Status  | Body                                                                                                                             |
| --------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Date outside any period, or period closed     | **409** | `{ "success": false, "error": "OPEN_PERIOD_REQUIRED", "message": "Journal date must be in exactly one open financial period." }` |
| Account inactive or out of facility scope     | **403** | `{ "success": false, "error": "ACCOUNT_OUT_OF_SCOPE", "message": "Every account must be active and belong to this facility." }`  |
| Idempotency key reused with different content | **409** | `{ "success": false, "error": "IDEMPOTENCY_CONFLICT", "message": "Idempotency key was already used for a different journal." }`  |
| Original journal already reversed             | **409** | `{ "success": false, "error": "JOURNAL_ALREADY_REVERSED", "message": "This journal has already been reversed." }`                |
| Any unrecognised error                        | **500** | unchanged, no internal detail                                                                                                    |

The status is taken from the error object, so no code path may substitute its own.

#### 8.6.3 Proving no stock movement survives a failed journal

The property is not assumed from the presence of `BEGIN`/`ROLLBACK`; it is demonstrated:

1. Seed an item with `current_stock = N`, one lot with `quantity_remaining = N`.
2. Record `COUNT(*)` on `inventory_movements` and the lot quantities.
3. Open one transaction, perform **the same mutation `applyDelta` performs** (lot decrement + item
   decrement + movement insert), then call the **real** `postInsideTransaction` with an entry date
   in a **closed** period.
4. The primitive throws `AccountingIntegrityError` with `OPEN_PERIOD_REQUIRED` (F7 — the period
   lookup precedes any insert).
5. Roll back; assert `current_stock = N`, lot `quantity_remaining = N`, movement count unchanged,
   and no `journal_entries` row for the would-be key.

This uses the real error class, the real primitive and a real database. Its limitation is stated
plainly: it proves the **transactional property**, not the service wiring, because no inventory
service function calls the primitive yet. The service-level version (AC6) is the mandatory gate of
C3, the first batch that posts from an inventory transaction.

---

## 9. Database and migration plan

### 9.1 Numbering

| Number                          | Owner                   | State                                                            |
| ------------------------------- | ----------------------- | ---------------------------------------------------------------- |
| `0077_inventory_control.sql`    | committed               | last committed migration                                         |
| `0078_approval_policies.sql`    | **approval-policy WIP** | uncommitted, unregistered, **must not be touched or renumbered** |
| `0079_inventory_accounting.sql` | **this work**           | **reserved; not created in this task**                           |

`0079` is reserved by name now so that parallel work cannot claim it. Creating it is C1's first
action and must include its `_journal.json` entry (index 78, timestamp newer than `0077`) in the
same commit (§6.3).

### 9.2 Exact changes C1 would require — documented, not created

**A. One new migration file:** `drizzle/0079_inventory_accounting.sql`.

```sql
CREATE TABLE IF NOT EXISTS facility_inventory_accounting (
  id                              serial PRIMARY KEY,
  tenant_id                       integer NOT NULL REFERENCES tenants(id),
  facility_id                     integer NOT NULL REFERENCES facilities(id),
  version                         integer NOT NULL DEFAULT 1,
  status                          text NOT NULL DEFAULT 'DRAFT'
                                    CHECK (status IN ('DRAFT','ACTIVE','SUPERSEDED')),
  basis                           text NOT NULL
                                    CHECK (basis IN ('EXPENSE_ON_PURCHASE','PERPETUAL')),

  -- opening / capitalisation
  opening_balance_account_id      integer REFERENCES chart_of_accounts(id),
  opening_journal_id              integer REFERENCES journal_entries(id),

  -- perpetual posting accounts
  stock_asset_account_id          integer REFERENCES chart_of_accounts(id),
  clearing_account_id             integer REFERENCES chart_of_accounts(id),
  consumption_account_id          integer REFERENCES chart_of_accounts(id),
  adjustment_account_id           integer REFERENCES chart_of_accounts(id),
  write_off_account_id            integer REFERENCES chart_of_accounts(id),

  -- tax (§8.2)
  input_vat_account_id            integer REFERENCES chart_of_accounts(id),
  non_recoverable_tax_account_id  integer REFERENCES chart_of_accounts(id),

  -- lifecycle and authorisation (§7 Q6, §8.1)
  effective_from                  date,
  activated_at                    timestamptz,
  activated_by_user_id            integer REFERENCES users(id),
  finance_approved_by_user_id     integer REFERENCES users(id),
  approval_note                   text,

  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT facility_inventory_accounting_version_key UNIQUE (facility_id, version),

  -- completeness enforced only once ACTIVE (§8.5)
  CONSTRAINT facility_inventory_accounting_active_complete CHECK (
    status <> 'ACTIVE'
    OR basis <> 'PERPETUAL'
    OR (stock_asset_account_id   IS NOT NULL
        AND clearing_account_id      IS NOT NULL
        AND consumption_account_id   IS NOT NULL
        AND adjustment_account_id    IS NOT NULL
        AND write_off_account_id     IS NOT NULL
        AND opening_balance_account_id IS NOT NULL
        AND opening_journal_id       IS NOT NULL
        AND effective_from           IS NOT NULL
        AND activated_at             IS NOT NULL
        AND finance_approved_by_user_id IS NOT NULL)),

  -- an EXPENSE_ON_PURCHASE row must not carry capitalisation state
  CONSTRAINT facility_inventory_accounting_expense_no_opening CHECK (
    basis <> 'EXPENSE_ON_PURCHASE' OR opening_journal_id IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS facility_inventory_accounting_active_once_idx
  ON facility_inventory_accounting (facility_id) WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS facility_inventory_accounting_tenant_idx
  ON facility_inventory_accounting (tenant_id, facility_id);
```

**B. One new Drizzle schema module:** `src/db/schema/inventory-accounting.ts`, exporting
`facilityInventoryAccounting` mirroring the DDL, registered in the schema barrel so drizzle-kit does
not see an unmanaged table.

**C. No change to any existing table.** No `ALTER TABLE`. No backfill. No `UPDATE`. Specifically:

- `journal_entries.source_type` — unchanged; the new value needs no DDL (F2).
- `journal_entries_balanced_chk`, the deferred balance trigger and both period guards — untouched.
- `inventory_movements`, `inventory_batches`, `inventory_items`, `goods_received_notes`,
  `supplier_invoices` — untouched by C1.

**D. Account-type validation is application-level, not a CHECK.** The DB cannot know that
`stock_asset_account_id` must be an `ASSET` row without a cross-table constraint, and the allowed
set is a business rule (_§9.3_). It is enforced in `accounting.service.ts`-style validation, reusing
the `FOR SHARE` query shape at `accounting.service.ts:386`.

**E. If C2's allocation table is taken**, `inventory_movement_allocations (id, movement_id,
batch_id, quantity, unit_cost_cents, created_at)` may ship in the same file or as `0080`. Both are
additive; neither rewrites data.

**F. Verification when it is eventually built:** `db:status` → READY against a synthetic database,
`src/tests/migrations.spec.ts` green, and the full migration set applying cleanly from scratch.

### 9.3 Activation preconditions — re-checked under the lock, inside the transaction

| #   | Precondition                                                                                                                                                           | Failure                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | Account mapping complete for `PERPETUAL`, all accounts active and facility-scoped (F27)                                                                                | 403 `ACCOUNT_OUT_OF_SCOPE` / 409 `POLICY_INCOMPLETE` |
| 2   | Account types correct: stock `ASSET`; clearing `ASSET`/`LIABILITY`; consumption, adjustment, write-off, tax `EXPENSE`; opening counterpart `EQUITY`/`LIABILITY` (§8.1) | 409 `ACCOUNT_TYPE_MISMATCH`                          |
| 3   | `effective_from` in exactly one OPEN period (F7, Q4)                                                                                                                   | 409 `OPEN_PERIOD_REQUIRED`                           |
| 4   | `batchReconciliation` empty (F22, F23)                                                                                                                                 | 409 `RECONCILIATION_BLOCKED`                         |
| 5   | No stock movement with `movement_date >= effective_from` lacking an `INVENTORY` journal                                                                                | 409 `MOVEMENTS_OUTSIDE_CUTOFF`                       |
| 6   | `unvaluedQuantity = 0`, or every unvalued lot classified under Q5                                                                                                      | 409 `UNVALUED_STOCK`                                 |
| 7   | No existing ACTIVE row (unless superseding, which a later batch handles)                                                                                               | 409 `ALREADY_ACTIVATED`                              |
| 8   | Finance approver recorded (Q6)                                                                                                                                         | 403 `FINANCE_APPROVAL_REQUIRED`                      |

---

## 10. API and UI plan

### 10.1 Endpoints

| Method | Path                                        | Permissions                                  | Behaviour                                                                     |
| ------ | ------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| `GET`  | `/api/accounting/inventory-policy`          | `accounting.read`                            | Current ACTIVE row, or the implied `EXPENSE_ON_PURCHASE` default              |
| `PUT`  | `/api/accounting/inventory-policy`          | `accounting.coa.manage` + `inventory.manage` | Create/update a `DRAFT`; posts nothing; never sets `ACTIVE`                   |
| `POST` | `/api/accounting/inventory-policy/activate` | both, **+ finance approver**                 | Runs §9.3 under the lock (§8.4), posts the opening journal, flips to `ACTIVE` |
| `GET`  | `/api/accounting/inventory-reconciliation`  | `accounting.read`                            | Per-facility comparison with the classes of §8.3 itemised, never netted       |
| `GET`  | `/api/inventory/movements/:id/journal`      | `inventory.read` + `accounting.read`         | The journal for one movement, or an explicit `NOT_POSTED` reason              |

Errors follow the existing style `{ success:false, error:CODE, message }`, with
`OPEN_PERIOD_REQUIRED` 409, `ACCOUNT_OUT_OF_SCOPE` 403, `POLICY_INCOMPLETE` 409,
`RECONCILIATION_BLOCKED` 409, `UNVALUED_STOCK` 409, `MOVEMENTS_OUTSIDE_CUTOFF` 409,
`ALREADY_ACTIVATED` 409, `ACTIVATION_BUSY` 409.

### 10.2 UI

| Surface                              | Content                                                                                                                                                                                         | Guard                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Accounting settings → Inventory      | Basis selector, account pickers filtered to active facility accounts of the permitted types, effective date, opening counterpart account with its rationale shown                               | Save creates `DRAFT` only; activation is a separate action |
| Activation confirmation              | Opening value from the locked valuation, the exact journal to be posted, the counterpart account, the period, and an explicit "back-dated stock operations will be rejected" statement (§8.4.7) | Finance approver identity required; typed confirmation     |
| Valuation page                       | Existing valuation plus a GL strip: asset balance, valuation total, difference **by class**                                                                                                     | Difference is a badge; never auto-corrected                |
| Movement list                        | Journal link, or `not posted (expense basis)`                                                                                                                                                   | Read-only                                                  |
| Dispense / adjustment / count result | Journal reference on success; on a closed period the 409 message inline                                                                                                                         | Never a generic "something went wrong"                     |
| Unit cost field on receiving         | Explicit label: exclusive of recoverable VAT (§8.2.1)                                                                                                                                           | Prevents the invisible-overstatement defect                |

No screen may present an inventory action as "posted" when only the movement was written.

---

## 11. C0 — implementation specification

> **Scope: error surfacing only. C0 introduces no inventory journal and changes no procurement
> accounting behaviour.** It is specified here in full so it can be executed on authorisation; **it
> was not implemented in this task.**

### 11.1 Purpose

Make a failed accounting operation inside an inventory request return a truthful HTTP status with a
machine-readable code, instead of a generic 500. C0 ships the error contract that C3–C5 depend on,
while changing no posting behaviour — so it is verifiable in isolation and safe to land alone.

### 11.2 Files C0 may modify

| #   | File                                                           | Change                                                                                                                                             |
| --- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/routes/shared/errors.ts`                                  | Import `AccountingIntegrityError`; add and export `handleAccountingIntegrityError`; call it inside `handleInventoryError` before returning `false` |
| 2   | `src/routes/inventory-control.routes.ts`                       | In the local `handleError` (line 64), call `handleAccountingIntegrityError` after the `StockError` branch and before `respondInternalError`        |
| 3   | `src/tests/integration/inventory-accounting-errors.db.spec.ts` | **New file** — the tests of §11.5                                                                                                                  |

**Two source files, one new test file.** `pharmacy.routes.ts` needs **no change**: it already calls
`handleInventoryError` (`pharmacy.routes.ts:17, 399`), so adding the branch to that function covers
dispensing automatically. `accounting.routes.ts` is **not** touched — its inline branch at 94-97
already behaves correctly, and refactoring a working file is not needed to satisfy C0.

### 11.3 Error classes C0 must handle

| Class                      | Source                                    | Fields used                    | Mapped status                                                                                |
| -------------------------- | ----------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------- |
| `AccountingIntegrityError` | `src/accounting/accounting.service.ts:13` | `.status`, `.code`, `.message` | `error.status` (default 400; 409 for `OPEN_PERIOD_REQUIRED`, 403 for `ACCOUNT_OUT_OF_SCOPE`) |

Only this class is added. `StockError` (`stock-control.service.ts:52`) and
`InventoryDomainError` (`inventory.service.ts:80`) keep their existing branches and precedence;
`ScopeAccessError` keeps its precedence inside `handleInventoryError`.

**Precedence is deliberate and must be tested:** `StockError` → `AccountingIntegrityError` →
`InventoryDomainError`/`ScopeAccessError` → `respondInternalError`.

### 11.4 Expected HTTP response contract

```json
409
{
  "success": false,
  "error": "OPEN_PERIOD_REQUIRED",
  "message": "Journal date must be in exactly one open financial period."
}
```

Rules:

1. `status` comes from the error object; no handler substitutes its own.
2. `code` is passed through verbatim; never mapped to a generic string.
3. `message` is the domain message; it names no SQL, no account id and no patient data.
4. Body shape matches both existing conventions in use (`{success,error,message}`), so clients need
   no change.
5. An unrecognised error still produces `500 { error: 'The request could not be completed.' }` from
   `respondInternalError` — C0 must not widen the 500 path into a catch-all that leaks detail.

### 11.5 Integration tests using the real error-handling path

| ID  | Test                                                                                                                                                                                                                                              | Proves                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Call the **real** `handleInventoryError` with a **real** `AccountingIntegrityError('OPEN_PERIOD_REQUIRED', …, 409)` and a response recorder                                                                                                       | The mapping function returns 409 with the exact body of §11.4, and returns `true`                                                                     |
| T2  | Same for `ACCOUNT_OUT_OF_SCOPE` (403) and a default-constructed error (400)                                                                                                                                                                       | Status is taken from the object, not hard-coded                                                                                                       |
| T3  | **Wire-level, real DB, real primitive:** seed item + lot; open a transaction; perform the same mutation `applyDelta` performs; call the real `postInsideTransaction` with a date in a closed period; expect `AccountingIntegrityError`; roll back | §8.6.3 — `current_stock`, lot `quantity_remaining` and movement count are unchanged; no `journal_entries` row                                         |
| T4  | **HTTP-level, real router:** `POST /api/accounting/journals` with an entry date outside any open period → 409 `OPEN_PERIOD_REQUIRED`                                                                                                              | The same class maps to 409 over the wire through the running app (regression guard on `accounting.routes.ts:94`)                                      |
| T5  | Source-wiring assertions: `inventory-control.routes.ts` and `shared/errors.ts` reference `handleAccountingIntegrityError`, and `pharmacy.routes.ts` calls `handleInventoryError`                                                                  | A future refactor that drops the branch fails the suite. Follows the existing repo precedent (`src/tests/pharmacy-batches.spec.ts` asserts on source) |
| T6  | Unknown error still yields 500 through `respondInternalError`, with no message leakage                                                                                                                                                            | The 500 path is unchanged                                                                                                                             |

**Honest limitation, stated in the test file's own header:** T1–T2 test the handler; T3 tests the
transactional property; T4 tests the wire contract on the accounting router; T5 tests wiring. **None
of them yet exercises a real inventory endpoint producing a real accounting failure, because no
inventory code path calls the primitive until C3.** The end-to-end proof is AC6, which is a
mandatory gate of C3. C0 must not be described as having proven inventory-to-ledger behaviour.

### 11.6 Proof that a failed posting leaves no stock movement

T3 is the proof, and its assertion set is the specification:

- `inventory_items.current_stock` equals the pre-transaction value;
- `inventory_batches.quantity_remaining` equals the pre-transaction value;
- `COUNT(*)` on `inventory_movements` for that item is unchanged;
- no `journal_entries` row exists for the attempted `idempotency_key`;
- no `journal_lines` row references the attempted journal;
- the thrown error is `AccountingIntegrityError` with code `OPEN_PERIOD_REQUIRED`.

If any assertion fails, the design assumption that inventory can rely on the caller's transaction is
false and **C3 must not proceed**.

### 11.7 Regression tests required

| Suite                                                                               | Expectation                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/tests/integration/inventory-*.db.spec.ts` (7 files, 77 tests as last measured) | unchanged and green                                                                                                                                                                                          |
| Accounting suites — journals, periods, scope integrity                              | unchanged and green                                                                                                                                                                                          |
| `src/tests/route-scope.spec.ts`, `src/tests/vitest/route-inventory.spec.ts`         | unchanged and green (error-handler edits must not alter route registration)                                                                                                                                  |
| Typecheck, lint, formatting                                                         | clean                                                                                                                                                                                                        |
| `src/tests/migrations.spec.ts`                                                      | **unchanged by C0**; note it already fails on the working tree because of the unregistered WIP `0078` (§1.5) — C0 must not be blamed for that, and must not "fix" it by registering someone else's migration |

### 11.8 Explicitly excluded from C0

| Excluded                                                | Why                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| Any `INVENTORY` journal or posting call                 | C3–C5                                                      |
| `JournalRequest.sourceType` union change                | C1                                                         |
| Procurement accounting changes (`receiving.service.ts`) | C3                                                         |
| The policy table, `0079`, schema work                   | C1                                                         |
| The facility advisory lock                              | C1                                                         |
| Valuation, reconciliation, reporting changes            | C6                                                         |
| UI changes                                              | C7                                                         |
| New permissions                                         | C1/C7                                                      |
| `pharmacy.routes.ts` edits                              | not needed — already routes through `handleInventoryError` |
| `accounting.routes.ts` refactor                         | working as-is; out of scope                                |
| Registering `0078` in `_journal.json`                   | belongs to the approval-policy WIP, not C0                 |
| Any migration, schema change or data change             | prohibited                                                 |
| Facility UAT                                            | outstanding by definition                                  |

---

## 12. Test strategy and acceptance criteria

### 12.1 Layers

| Layer            | Proves                                                                                                                                                     | Where                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| DB constraint    | deferred balance trigger still fires; the ACTIVE-complete CHECK rejects an incomplete perpetual row; the partial unique index permits one ACTIVE row       | `*.db.spec.ts` on synthetic PostgreSQL           |
| Service          | each event produces exactly one balanced journal inside the existing transaction; replay returns the same journal; a closed period rolls the movement back | `src/tests/integration/inventory-*.db.spec.ts`   |
| Concurrency      | two simultaneous activations yield one ACTIVE row; a receipt started mid-activation is either inside the opening valuation or rejected                     | new `inventory-accounting-activation.db.spec.ts` |
| Reconciliation   | after a scripted lifecycle `Σ stock asset = totalKes`, and every difference class is itemised                                                              | new `inventory-ledger-reconciliation.db.spec.ts` |
| Defect injection | revert the posting call → reconciliation test fails; revert the error mapping → closed-period test returns 500                                             | local, recorded in the batch report              |
| Browser          | policy form, activation preconditions, reconciliation view, closed-period message                                                                          | Playwright, synthetic only                       |
| Migration        | parity, contiguity, timestamps, fresh apply                                                                                                                | `src/tests/migrations.spec.ts`                   |

### 12.2 Evidence classes

Passing tests are evidence, not proof of facility acceptance. Batch C code may be reported as
**Sandbox tested** at best. It may not be called production verified, and cannot be called complete
without the reconciliation invariant demonstrated, defect injections recorded, and CI green.

### 12.3 Acceptance criteria

| AC   | Criterion                                                                                                                                                                                      | Class                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| AC1  | `0079` applies to a fresh synthetic database; `db:status` READY                                                                                                                                | Sandbox tested                                |
| AC2  | Perpetual GRN posts DR stock asset / CR clearing; the invoice clears net, splits recoverable VAT and non-recoverable tax, and credits AP                                                       | Sandbox tested                                |
| AC3  | Dispensing posts consumption at the **lot cost recorded at receipt**, unchanged after a later price edit                                                                                       | Sandbox tested                                |
| AC4  | Adjustment, count variance and write-off are each costed from the lots actually reduced                                                                                                        | Sandbox tested                                |
| AC5  | Replay returns the original journal (`idempotentReplay: true`) and writes no second entry                                                                                                      | Sandbox tested                                |
| AC6  | A stock event dated into a closed period returns 409 `OPEN_PERIOD_REQUIRED` **from the inventory endpoint**, and leaves no movement, no lot change and no item change                          | Sandbox tested — **mandatory gate of C3**     |
| AC7  | After a scripted lifecycle, asset balance equals `totalKes` to the cent, `unvaluedQuantity = 0`, `batchReconciliation` empty                                                                   | Sandbox tested                                |
| AC8  | Under `EXPENSE_ON_PURCHASE`, consumption writes no journal and gross margin is identical to today                                                                                              | Sandbox tested                                |
| AC9  | Transfers produce no journal                                                                                                                                                                   | Sandbox tested                                |
| AC10 | The reconciliation report itemises all nine classes of §8.3 and never nets them                                                                                                                | Sandbox tested                                |
| AC11 | Activation is refused without an open period, without accounts, with a reconciliation gap, with a back-dated movement past the cut-off, or without a finance approver — each with its own code | Sandbox tested                                |
| AC12 | Two concurrent activations produce exactly one ACTIVE row                                                                                                                                      | Sandbox tested                                |
| AC13 | Facility UAT of the policy form, activation and reconciliation                                                                                                                                 | **Missing** until a real facility performs it |

### 12.4 Definition of done for implementation

1. `0079` committed with its journal entry; CI's migration job applies it.
2. Every stock-changing event writes movement + journal or neither — demonstrated by test.
3. Asset balance equals `totalKes` with all nine classes itemised and none netted.
4. Expense-basis facilities measurably unchanged: same margin, no new journals.
5. Closed periods block with 409 **from inventory endpoints** and leave no movement (AC6).
6. All seven CI jobs green; the existing 77 inventory tests still pass.
7. Facility UAT of policy and reconciliation — **still outstanding**.

### 12.5 Test evidence — quoted, not produced

| Run                          | Result                                                  | Provenance                |
| ---------------------------- | ------------------------------------------------------- | ------------------------- |
| Batch A focused spec         | 3/3 passed                                              | turn 5                    |
| Batch A defect injection     | 2 failed / 1 passed with the fix reverted; 3/3 restored | turn 5                    |
| Inventory integration suites | 77/77 across 7 files                                    | turn 5                    |
| Whole vitest tree            | 311 suites / 1137 tests passed                          | turn 5, isolated worktree |
| Typecheck / lint / prettier  | `tsc` exit 0; 0 errors, 103 warnings; formatting clean  | turn 5                    |
| CI at `0b827cc`              | run `42815915288` — completed/success, 7/7 jobs         | turn 6                    |

**Nothing was run this turn** (§1.5). These figures establish the baseline the inventory suites hold;
they test none of the behaviour proposed here, because none of it exists.

---

## 13. Risks, dependencies, open questions

### 13.1 Risks

| #   | Risk                                             | Why it is real here                                                                          | Prevention                                                                 | Surfacing                                                                                                                      |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| R1  | **Double expensing**                             | F9 expenses today; a naive perpetual build adds consumption posting without gating purchases | Branch both sides on `basis` in one helper; AC8                            | Reconciliation shows an expense spike with no asset; AC8 fails                                                                 |
| R2  | **Double posting an invoice**                    | `GRN_ALREADY_INVOICED` + idempotency already exist (F5)                                      | Reuse the existing key verbatim; never mint a second key for one invoice   | Replay test (AC5); clearing-class difference                                                                                   |
| R3  | **Valuation excluding unvalued lots**            | `getValuation` excludes null-cost lots by design (F22)                                       | Q5 classification; §9.3 precondition 6                                     | `UNVALUED` class itemised                                                                                                      |
| R4  | **Missing cost snapshots**                       | Movements carry no cost (F13); FEFO reductions unattributed (F16)                            | C2: persist allocations; never recompute from the item master              | Journal cost ≠ lot cost; AC3/AC4                                                                                               |
| R5  | **Negative inventory**                           | `applyDelta` blocks at item and lot level                                                    | Unchanged; journal joins the same transaction                              | Existing `NEGATIVE_STOCK` / `BATCH_QUANTITY_EXCEEDED` 409                                                                      |
| R6  | **Duplicate journals**                           | Posting could be retried                                                                     | F5 advisory lock + unique index + hash                                     | `IDEMPOTENCY_CONFLICT` 409; AC5                                                                                                |
| R7  | **Partial failure**                              | Only if posting uses a second connection                                                     | Post inside the caller's transaction; §11.6 proves it                      | AC6                                                                                                                            |
| R8  | **Cross-facility or cross-tenant posting**       | accounts and periods are facility-scoped; `inventory_items` has no tenant column (F29)       | Scope from `StockScope`; rely on F27; policy carries both keys             | 403; reconciliation is per facility                                                                                            |
| R9  | **Adjustments into closed periods**              | back-dated `movementDate` is user-supplied                                                   | entry date = event date; 409 naming the period; no partial write           | AC6                                                                                                                            |
| R10 | **Stock balance with no ledger counterpart**     | every movement before activation has no journal                                              | opening entry + §9.3 precondition 5                                        | AC7, AC10                                                                                                                      |
| R11 | **Basis switching mid-stream**                   | two bases cannot both be true in one history                                                 | cut-off only, opening entry only, one ACTIVE row                           | `ALREADY_ACTIVATED`; dated difference                                                                                          |
| R12 | **System postings bypass accounting permission** | F26                                                                                          | accepted; actor recorded, audit row per event; documented in the policy UI | audit review                                                                                                                   |
| R13 | **Reversing a journal without reversing stock**  | breaks invariant 2 in the opposite direction                                                 | corrections are one action                                                 | difference appears immediately                                                                                                 |
| R14 | **Concurrent receipt during activation**         | `receiveBatchScoped` locks no item row (F31)                                                 | shared facility advisory lock (§8.4), adopted by all six entry points      | AC12; `ACTIVATION_BUSY` 409                                                                                                    |
| R15 | **VAT-inclusive unit cost typed at receiving**   | the GRN has no tax column (F30)                                                              | §8.2.1 field rule + UI label                                               | **Invisible to invariant 2** — detects only by invoice-to-receipt comparison, hence must be prevented at entry, not reconciled |
| R16 | **Clearing account accumulates**                 | uninvoiced receipts                                                                          | clearing invariant (§8.3)                                                  | `CLEARING` class                                                                                                               |
| R17 | **Activation posts a stale opening balance**     | valuation read before the lock                                                               | capture only under the lock (§8.4.3)                                       | AC12; difference dated to activation                                                                                           |

### 13.2 Dependencies

- **Batch A** (`0b827cc`) — composite stock-count references; without it a multi-item count cannot
  post, so count-variance journals could not be tested.
- **Approval-policy WIP** — owns `0078` and four procurement files. C-batches touch
  `receiving.service.ts` and `stock-control.service.ts`, not those four files, so they coexist;
  **no C batch may edit the WIP files**, and `0079` must not be renumbered if the WIP lands first.
- **COA seeding** — none exists (F12). Activation is impossible in a fresh facility until accounts
  are created. An operator task, not a C task, but a hard prerequisite for UAT.
- **Financial periods** — a facility with no OPEN period cannot post anything (Q4).

### 13.3 Remaining unresolved accounting decisions

| #   | Question                                                                                                                     | Why it cannot be assumed                                                                                                                                                                                        | Owner                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| U1  | **Is non-recoverable tax expensed immediately or absorbed into inventory cost?**                                             | §8.2 proposes immediate expense to preserve invariant 2 exactly; strict IAS 2 would absorb it and require a COGS correction for already-consumed stock. These give different stock values and different margins | Facility accountant           |
| U2  | **Which opening counterpart account applies** — retained earnings, capital reserve, inter-branch/director loan, or suspense? | §8.1 refuses to default. It is a statutory-presentation choice, and a wrong choice is visible in every subsequent financial statement                                                                           | Facility accountant / auditor |
| U3  | **Is VAT registration status known per facility?**                                                                           | If a facility is not VAT-registered, no tax is recoverable at all and `input_vat_account_id` should be unused. The repository has no tax-registration field                                                     | Finance                       |
| U4  | **Should clearing be an `ASSET` or a `LIABILITY`?**                                                                          | Depends on whether uninvoiced receipts are expected to dominate (asset) or prepayments dominate (liability). The design permits either; the trial balance presentation differs                                  | Facility accountant           |
| U5  | **What is the consumption account's departmental split, if any?**                                                            | Q2 ships one account; a facility that reports by department needs `departmentCode` on the lines from day one, which is a schema-visible choice                                                                  | Finance                       |
| U6  | **Is perpetual wanted at all, or is the deliverable the reconciliation report plus a documented expense-basis position?**    | Determines whether C2–C5 (~5 batches) are in scope or C1/C6 alone suffice                                                                                                                                       | Facility / project owner      |

### 13.4 Questions already proposed as decisions

Q1–Q6 in §7 are **proposed and awaiting approval**; they are not restated here as open questions.

---

## 14. Implementation matrix and sequenced batches

### 14.0 Preconditions before any C batch

1. Rebuild `.wip-backup/` and `/home/user/wip-preservation` from the verified worktree and confirm
   the eight checksums in §1.4 (absent again this turn; rebuilding writes files, so it needs
   authorisation).
2. Reinstall `node_modules` and the embedded PostgreSQL instance, migrate the synthetic database,
   confirm `db:status` READY.
3. Re-verify the branch and worktree as in §1.3 before writing anything.

### 14.1 Matrix

| #   | Item                                                                    | Required / Optional                            | Batch           |
| --- | ----------------------------------------------------------------------- | ---------------------------------------------- | --------------- |
| 1   | Policy table (basis, accounts, lifecycle, approvals)                    | **Required**                                   | C1              |
| 2   | Account type + ownership validation                                     | **Required**                                   | C1              |
| 3   | Migration `0079` + journal registration                                 | **Required**                                   | C1              |
| 4   | `INVENTORY` source type (code only)                                     | **Required**                                   | C1              |
| 5   | Facility advisory lock adopted by all six stock entry points            | **Required**                                   | C1              |
| 6   | Lot-cost allocation snapshots (`applyDelta` returns allocations)        | **Required** for adjustments/counts/write-offs | C2              |
| 7   | Receipt capitalisation + GRN clearing                                   | **Required** for perpetual                     | C3              |
| 8   | Supplier-invoice rework: clearing, recoverable VAT, non-recoverable tax | **Required** for perpetual                     | C3              |
| 9   | Activation: opening journal with configured counterpart, under lock     | **Required**                                   | C3              |
| 10  | Consumption posting from lot cost                                       | **Required** for perpetual                     | C4              |
| 11  | Write-off posting                                                       | **Required** for perpetual                     | C4              |
| 12  | Adjustment posting                                                      | **Required** for perpetual                     | C5              |
| 13  | Count-variance posting (one journal per count)                          | **Required** for perpetual                     | C5              |
| 14  | Intra-facility transfer posting                                         | **Not needed** — no value moves (F21)          | —               |
| 15  | Closed-period 409 surfacing to inventory routes                         | **Required**                                   | **C0**          |
| 16  | Posting-exception surfacing + reconciliation report (nine classes)      | **Required**                                   | C6              |
| 17  | Permissions, audit rows, UI                                             | **Required**                                   | C7              |
| 18  | DB / integration / concurrency / browser tests                          | **Required**                                   | each batch + C8 |
| 19  | Category-level consumption accounts                                     | Optional                                       | C4b             |
| 20  | Movement-level cost columns instead of an allocation table              | Optional (alternative to #6)                   | C2              |
| 21  | Backfill of historical movements                                        | **Not recommended**                            | —               |
| 22  | Supplier returns, three-way matching, payroll                           | **Excluded by instruction**                    | —               |

### 14.2 Sequenced batches

| Batch  | Content                                                                                                                                 | Files                                                                                                | Tests                                              | Risk                                                              |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| **C0** | Error surfacing only (§11)                                                                                                              | 2 source + 1 new spec                                                                                | T1–T6                                              | **Very low** — no posting exists, so the branch is inert until C3 |
| **C1** | `0079` policy table + schema module + service/endpoints (`DRAFT` only) + `INVENTORY` union + facility advisory lock in six entry points | new schema/service/routes; `accounting.service.ts` (union); 6 inventory entry points (one line each) | migration specs, policy CRUD, AC12 lock assertions | Low–medium (lock adoption is mechanical but touches 6 files)      |
| **C2** | `applyDelta` returns allocations; persist them                                                                                          | `stock-control.service.ts`, allocation table                                                         | cost assertions + defect injection                 | **Medium** — shared primitive, three call sites                   |
| **C3** | Receipt capitalisation, invoice rework, activation opening entry                                                                        | `receiving.service.ts`, policy service, accounting call                                              | AC2, AC5, AC6 (gate), AC7 partial, AC8             | **High** — changes live procurement posting                       |
| **C4** | Consumption and write-off posting                                                                                                       | `inventory.service.ts`, `stock-control.service.ts`                                                   | AC3, AC4, AC5, AC6                                 | Medium — busiest write path                                       |
| **C5** | Adjustment and count-variance posting                                                                                                   | `stock-control.service.ts`                                                                           | AC4, AC5, AC6, AC9                                 | Medium                                                            |
| **C6** | Reconciliation endpoint + nine-class report                                                                                             | new accounting read path                                                                             | AC7, AC10                                          | Low — read-only                                                   |
| **C7** | UI: policy form, activation wizard, reconciliation strip, journal links, error surfaces, VAT label                                      | accounting + inventory UI                                                                            | browser suite                                      | Low–medium                                                        |
| **C8** | Full-suite verification, CI, evidence                                                                                                   | tests only                                                                                           | 7 CI jobs green                                    | Low                                                               |

Order: **C0 → C1 → C2 → C3 → C4 → C5 → C6 → C7 → C8.** C0 and C1 are independent; C3 must not
precede C1; C2 must not follow C5, because C5 needs costed allocations.

---

## 15. What this turn changed

### 15.1 Content changes to this document

| Correction                | Before (revision 1)                                                               | Now                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Opening balance           | credited "opening equity"                                                         | explicitly configured, accountant-approved counterpart account with a type restriction (§8.1)                          |
| Tax                       | one opaque amount debited to the expense account                                  | four separated components with accounts and treatments; recoverable-VAT field rule; documented IAS 2 conflict (§8.2)   |
| Reconciliation            | equality asserted, differences named                                              | nine conditions, each with a difference class, zero tolerance, no netting, two extra invariants (§8.3)                 |
| Activation concurrency    | valuation simply read in the transaction                                          | shared facility advisory lock, capture-after-lock, `lock_timeout`, residual hazard documented (§8.4)                   |
| Policy constraint         | `opening_journal_id` required whenever `basis = PERPETUAL`, blocking the workflow | lifecycle `status`, CHECK scoped to `ACTIVE`, partial unique index, version history (§8.5)                             |
| Closed periods            | "must map to 409"                                                                 | exact classes, the two handlers that swallow them, extracted shared function, response contract, rollback proof (§8.6) |
| Design questions          | six open questions                                                                | six **proposed decisions** with consequences, marked not approved (§7)                                                 |
| Migration                 | `0079` availability                                                               | `0079` reserved by name; exact C1 DDL documented, nothing created (§9.2)                                               |
| C0                        | a table row                                                                       | standalone specification with files, classes, contract, tests, exclusions (§11)                                        |
| Risks                     | 13                                                                                | 17, adding R14–R17                                                                                                     |
| Open accounting decisions | implicit                                                                          | six explicit unresolved items U1–U6 (§13.3)                                                                            |

### 15.2 Files changed and their status

| Statement                                                               | Status                                                                            |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `docs/project/completion-phases/BATCH-B-INVENTORY-ACCOUNTING-DESIGN.md` | **Modified** — the only file written this turn (revision 2, replacing revision 1) |
| Application source                                                      | **Unchanged**                                                                     |
| Tests                                                                   | **Unchanged**, and none executed                                                  |
| Migrations or schema                                                    | **Unchanged** — `0079` reserved, not created                                      |
| Approval-policy WIP (8 files)                                           | **Unchanged** — all eight checksums match §1.4                                    |
| Phase 5 documents and evidence                                          | **Unchanged** — hashed on entry and re-verified at turn end                       |
| Staging, commits, pushes                                                | **None**                                                                          |
| `main`                                                                  | **Untouched** at `63903c5`                                                        |

### 15.3 Explicit confirmations

- No implementation of C0 or any other batch.
- No test was written, modified or executed.
- No migration was created, registered, edited or executed; `0079_inventory_accounting.sql` remains
  reserved and absent.
- No schema change.
- Nothing staged, committed or pushed; no history rewritten.
- The eight approval-policy WIP files are byte-for-byte unchanged.
- Phase 6 was not begun; supplier returns, three-way matching and payroll returns were not touched.
- No production-readiness or facility-acceptance claim is made anywhere in this document.
