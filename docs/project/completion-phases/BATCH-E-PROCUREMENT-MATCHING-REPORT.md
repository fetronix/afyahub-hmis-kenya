# Batch E — three-way matching, supplier returns and supplier credit notes

Phase 5, procurement controls. Evidence date: 2026-10-27. Branch
`arena/e088f11d-afyahub-hmis-kenya`. Synthetic data only — no real patient,
staff, supplier or financial records were used anywhere in this batch.

## What a user can do now

Before payment, finance sees whether a supplier invoice agrees with the order it
was raised against and the receipt that evidences delivery. Where the three do
not agree, the difference is named — the order price versus the received price,
the receipt value versus the invoice, goods billed before they arrived, no
receipt lines to compare against, more invoiced than received — and the invoice
cannot be paid until someone with the right permission accepts the difference in
writing. That acceptance, the reason, the person and the time are auditable.

Two further ways a payable comes down are now implemented rather than implied:

- **Return to supplier.** Goods go back out of the same lot they arrived in, at
  that lot's cost. Before the invoice is booked the credit goes to stock in
  transit/clearing; after it is booked, to the payable. The return is capped by
  what was received less what has already gone back, and reduces the invoice
  balance when there is one.
- **Supplier credit note.** Reduces the payable, reverses recoverable tax out of
  input VAT when it was recovered there, and cannot take a balance below zero.

The Procurement module has a fourth tab, **Matching, returns & credits**, listing
invoices with their verdict, the differences in plain language, and the actions
available to that user. It sits beside the existing requisition, order and
receiving/payables tabs rather than replacing them.

## What changed

| Area      | File                                                                                                  | Change                                                                                                                                                                                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema    | `drizzle/0080_procurement_matching.sql` (journal idx 79)                                              | Adds `supplier_invoice_matches`, `supplier_returns`, `supplier_return_items`, `supplier_credit_notes`, `supplier_credit_note_items`; adds `RETURN_OUT` to the `inventory_movements_type_chk` check so a return is distinguishable from a write-off                                       |
| Schema    | `src/db/schema/procurement-matching.ts` (+ `src/db/schema.ts`)                                        | Table definitions and barrel export                                                                                                                                                                                                                                                      |
| Matching  | `src/procurement/matching.service.ts`                                                                 | `matchSupplierInvoice`, `readMatch`, `overrideMatch`, `assertPayable`; one verdict per invoice, stored findings, override requires a reason of at least 10 characters and writes an audit row                                                                                            |
| Returns   | `src/procurement/returns.service.ts`                                                                  | `postSupplierReturn`, `createSupplierCreditNote` and their read methods, each in one transaction with the journal                                                                                                                                                                        |
| Ledger    | `src/inventory/inventory-accounting.service.ts`                                                       | `postSupplierReturn` (clearing before invoicing, payable after, refuses when no counterpart is configured) and `postSupplierCreditNote` (payable debit; clearing or expense credit; input-VAT reversal). Reconciliation now includes `RETURN_OUT`                                        |
| Receiving | `src/procurement/receiving.service.ts`                                                                | Invoice creation records the match in the same transaction and returns it; `paySupplierInvoice` calls `assertPayable` before writing any payment; a duplicate invoice number is refused by name (`INVOICE_NUMBER_IN_USE`) instead of surfacing a driver error                            |
| API       | `src/routes/procurement-workflow.routes.ts`                                                           | Nine routes: `GET`/`POST /supplier-invoices/:id/match`, `POST /supplier-invoices/:id/match-override`, `GET`/`POST /supplier-returns`, `GET /supplier-returns/:id`, `GET`/`POST /supplier-credit-notes`, `GET /supplier-credit-notes/:id`; domain errors mapped to their own status codes |
| Client    | `src/api/clients/procurement-workflow.client.ts`                                                      | Types and methods for the nine routes                                                                                                                                                                                                                                                    |
| UI        | `src/components/procurement/MatchingReturnsPanel.tsx`, `src/components/modules/ProcurementModule.tsx` | New tab; verdicts, findings, override dialog, return dialog, credit dialog                                                                                                                                                                                                               |

## Evidence

All figures are from runs performed in this session against PostgreSQL 18.6 with
all 80 migrations applied to `jalicare_synthetic_test`.

| Check                                                                | Result                                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------------- |
| `src/tests/integration/procurement-matching-returns.db.spec.ts`      | **18/18 passed**                                            |
| `src/tests/integration/procurement-matching-returns-http.db.spec.ts` | **12/12 passed**                                            |
| `src/tests/vitest/procurement-matching-returns.spec.tsx`             | **7/7 passed**                                              |
| `src/tests/schema-extraction.spec.ts`                                | **107/107 passed** (contract now lists the five new tables) |
| Full suite                                                           | **2464 passed / 5 failed / 2469** across 262 files          |
| `tsc --noEmit`                                                       | 32 errors, all pre-existing and none in a Batch E file      |
| `eslint .`                                                           | 0 errors, 103 warnings                                      |
| Prettier                                                             | clean on every changed file                                 |

The five full-suite failures are the ones carried over from before this batch and
are not caused by it: `claims.spec.ts` and `migrations.spec.ts` fail because
`0078_approval_policies.sql` is not registered in `_journal.json` (frozen
approval-policy work in progress), and three assertions in
`procurement-workflow.db.spec.ts` fail inside that same work in progress at
`approval-policy.service.ts:110`. Batch E touched none of those files.

The batch adds 37 tests to the suite (18 + 12 + 7), which accounts exactly for the
difference between this run and the previous baseline of 2427 passed / 2432.

## What the tests actually prove

The service spec exercises real PostgreSQL and checks postings, not just return
values: a return takes stock out of its own lot at that lot's cost and leaves a
`RETURN_OUT` movement; the clearing accrual rises before invoicing and the
payable falls after; the invoice total and balance come down; a return into a
closed period is rejected and the stock is rolled back with it; a credit note
reverses recoverable tax out of input VAT; both writes replay on their keys; and
a user in another facility cannot reach the invoice.

The HTTP spec uses real sessions, roles and permissions against the real app, so
the nine routes are checked for authentication, permission, facility scope and
stable error codes (`THREE_WAY_MATCH_VARIANCE`, `OVERRIDE_REASON_REQUIRED`,
`RETURN_EXCEEDS_RECEIPT`, `CREDIT_EXCEEDS_BALANCE`, 404 for an unknown note)
rather than for 500s.

## What this does not prove, stated plainly

- **The supplier's own arithmetic.** A match compares the documents this system
  holds. Units shipped and never recorded are invisible to it, so the absence of
  a finding is not proof that an invoice is correct.
- **The `DUPLICATE_INVOICE_NUMBER` finding.** It cannot fire while the unique
  index on (facility, supplier, invoice number) exists, and no test pretends
  otherwise. The enforced control is the index plus the named
  `INVOICE_NUMBER_IN_USE` refusal; both are exercised. The finding is retained as
  a backstop for data predating that index.
- **Supplier statement reconciliation**, still missing: there is no import of a
  supplier's own statement, so a credit the supplier recorded and this facility
  did not is not detected here.
- **Tolerance policy.** A tolerance amount can be passed to the match, but no
  per-facility stored tolerance policy with approval thresholds exists yet; the
  default is zero and every difference needs an override.
- **Facility UAT.** No clinical or finance user at a real facility has exercised
  these screens.
- **Browser-level evidence.** The panel has component tests; no Chromium
  screenshots were captured for this batch.

## Register movement

- Roadmap §5, "Suppliers, procurement, stores": supplier returns and three-way
  matching move from outstanding to implemented and synthetically tested;
  supplier statement reconciliation and facility UAT remain outstanding.
- Payroll statutory returns (§5) remain untouched: no rates were invented and no
  statutory output was certified.

## External dependencies

None for this batch. Nothing here calls a bank, a supplier system or a government
endpoint; all postings are internal double-entry.

## Next

Continue the roadmap in sprint order after Phase 5's remaining items:
fixed-asset revaluation, impairment and tax depreciation; the payroll statutory
outputs once authoritative rates and forms are supplied; then Phase 6 integrations
(sandbox only) and Phase 7 deployment and acceptance work.
