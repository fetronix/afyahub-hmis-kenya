# Batch 1 — Approval Policy Management

**Date:** 2026-10-27
**Branch:** `arena/e088f11d-afyahub-hmis-kenya`
**Scope:** complete the facility approval-policy feature end to end, without reworking procurement enforcement, migrations or unrelated modules.

---

## 1. What the administrator can now do

A facility administrator opens **Hospital Configuration Engine → Approval Policies** and can:

| Action                        | Result                                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| See every threshold on record | Rule name, scope, from-amount, required authority, effective window, active/retired status, who created it and when                                |
| See how many rules are live   | Three summary figures: active rules, rules on record (including retired), scopes covered                                                           |
| Read a rule in full           | Details dialog with the exact threshold, required permission, effective dates and author                                                           |
| Add a rule                    | Scope (requisition or purchase order), name, from-amount in shillings, required permission, effective dates, note — confirmed before it is written |
| Change a rule                 | Rename, change the end date, add a note, make it active or inactive — confirmed before it is written                                               |
| Check a proposed amount       | "What would this amount require?" returns the rule that would apply and whether the signed-in account holds the authority                          |
| Be told why a save failed     | A duplicate threshold, an unknown permission or a malformed amount lands beside the field that caused it                                           |

Reading is separate from writing. An account that may read procurement sees the thresholds and cannot change them; the screen says which permission would be needed.

## 2. API routes connected

Mounted once, from `src/routes/index.ts` (before the procurement workflow router), under `/api`:

| Method | Path                             | Purpose                              | Authorisation                                                                                                                                          |
| ------ | -------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/approval-policies`         | List rules + active count            | any of `approval_policies.read`, `approval_policies.manage`, `procurement.read`, `procurement.approve`, `facilities.read`, `facilities.modules.manage` |
| `GET`  | `/api/approval-policies/preview` | Rule governing a proposed amount     | same read set                                                                                                                                          |
| `POST` | `/api/approval-policies`         | Create a rule (201)                  | any of `approval_policies.manage`, `facilities.update`, `facilities.modules.manage`                                                                    |
| `PUT`  | `/api/approval-policies/:id`     | Rename, re-date, retire, re-activate | same write set                                                                                                                                         |

Stable error codes: `INVALID_INPUT`, `INVALID_SCOPE`, `INVALID_AMOUNT`, `UNKNOWN_PERMISSION`, `APPROVAL_THRESHOLD_IN_USE` (409), `APPROVAL_POLICY_NOT_FOUND` (404), `FACILITY_USER_REQUIRED` (403), `AUTHORIZATION_CONTEXT_MISSING` (401), `FACILITY_ACCESS_DENIED` (403).

**Two defects were found and fixed in this batch:**

1. **Unsatisfiable guard.** The router used `requirePermission`, which is ALL-of (`hasAllPermissions`). Viewing required _both_ `procurement.read` and `facilities.read`; writing required _both_ `procurement.approve` and `facilities.update`. No seeded role holds either pair — the facility-administrator set holds neither — so every real account would have received 403. Guards are now `requireAnyPermission`, which is what the intent always was.
2. **A working control reported as a server fault.** When a rule refused an approval, the approval-policy error reached the procurement route handlers, which only recognised their own domain error types, so the client received **HTTP 500** instead of a 403. Fixed in `procurement.routes.ts` and `procurement-workflow.routes.ts`; the refusal now arrives as `403 APPROVAL_AUTHORITY_REQUIRED` with the rule named, in both purchase orders and requisitions.

New permission codes `approval_policies.read` and `approval_policies.manage` (module `procurement`) are seeded, granted to `SUPER_ADMIN` and added to the facility-administrator invitation set (now 46 codes).

**Segregation of duties:** writing a threshold deliberately excludes `procurement.approve`. An approver cannot lower the bar that governs their own approvals, or deactivate the rule blocking them. Residual limitation, stated rather than hidden: an account holding _both_ a governance permission and `procurement.approve` can still do both. Closing that needs dual control (propose/approve) on policy changes, which is not implemented and is not claimed.

## 3. Frontend screens implemented

- `src/components/modules/ApprovalPoliciesPanel.tsx` — list, summary, details, create form, edit form, amount preview, confirmations, loading / empty / error states, permission-aware controls.
- `src/components/modules/ConfigurationModule.tsx` — new **Approval Policies** tab (icon `ShieldCheck`), shown only when a facility is selected and the account may read; body renders as the read-only or managing variant.
- `src/api/clients/approval-policy.client.ts` — typed client, folded into the existing `api` aggregate. Amounts cross the boundary as integer cents; the form parses shillings with exact decimal handling, so no float reaches the server's integer check.

Design decisions the screen states in its own copy:

- Threshold, scope and required permission are **immutable once saved**. Rewriting them in place would silently restate the rule that past approvals were judged against. To move a threshold, retire the rule and create a new one.
- The **highest matching threshold wins**, so a larger commitment can never be approved under a weaker rule than a smaller one.
- **No matching active rule** means the standard approval permission applies unchanged — the feature adds authority requirements, it never removes one.
- Saving always asks first and names the exact change.

## 4. Existing procurement workflow integration

Unchanged in behaviour, now reachable and correct in its error surface:

- `procurement.service.ts` (purchase-order approval) and `requisitions.service.ts` (requisition decision) both resolve the applicable rule **inside** the same database transaction as the approval, so a rule cannot change underneath a decision in flight.
- The applied rule is written into the approval event note, so the decision explains itself after the fact.
- A rule naming a permission the approver lacks produces `403 APPROVAL_AUTHORITY_REQUIRED` naming the rule; the order or requisition stays in its pending/submitted state.
- Deactivating a rule stops it governing future approvals; approvals already recorded keep the rule they were judged against.

## 5. Files changed

New:

- `src/routes/approval-policy.routes.ts`
- `src/api/clients/approval-policy.client.ts`
- `src/components/modules/ApprovalPoliciesPanel.tsx`
- `src/tests/integration/approval-policy.db.spec.ts`
- `src/tests/vitest/approval-policies-ui.spec.tsx`
- `src/tests/vitest/approval-policy-routes.spec.ts`
- `docs/project/completion-phases/BATCH-1-APPROVAL-POLICY-MANAGEMENT.md` (this file)

Modified:

- `src/seeds/permissions.ts` — two codes, two facility-administrator grants
- `src/routes/index.ts` — mount
- `src/routes/procurement.routes.ts` — map the policy refusal to its own status and code
- `src/routes/procurement-workflow.routes.ts` — same for requisitions and the chain
- `src/api/client.ts` — export, import and spread of the new client
- `src/components/modules/ConfigurationModule.tsx` — tab, permission flags, panel body

No migration was added or altered; `0078_approval_policies.sql` is unchanged. No service, table or route was duplicated: this batch mounts and completes the existing slice.

`src/routes/procurement-workflow.routes.ts` and `src/facility/approval-policy.service.ts` are themselves part of the pre-existing uncommitted WIP (untracked, not in `HEAD`), so they are listed as modified relative to their working-tree state rather than to a commit.

### Git status

- Branch `arena/e088f11d-afyahub-hmis-kenya`, local `HEAD` `0111b55`, published `197a553`. The local checkout is shallow and its `HEAD` predates the published tip; nothing was reset, cleaned, stashed, re-committed or pushed in this batch.
- **This batch is not committed.** The working tree already carries a large body of unrelated uncommitted prior-phase work (597 changed paths on inspection, including `package.json`/`package-lock.json` edits that predate this batch and were not made by it). Committing would have entangled that work or required a partial staging decision that only the repository owner should make. The files above are left in the tree for review.

## 6. Focused test results

| Suite                                                                                         | Tests | Result     |
| --------------------------------------------------------------------------------------------- | ----- | ---------- |
| `src/tests/vitest/approval-policy-routes.spec.ts` (new — route registration, database-free)   | 4     | **passed** |
| `src/tests/integration/approval-policy.db.spec.ts` (new — real PostgreSQL + real HTTP app)    | 22    | **passed** |
| `src/tests/vitest/approval-policies-ui.spec.tsx` (new — screen behaviour)                     | 13    | **passed** |
| `src/tests/integration/procurement-*.db.spec.ts` (5 existing suites — enforcement regression) | 54    | **passed** |
| `src/tests/vitest/permission-seed.db.spec.ts`, `facility-services-configuration.spec.tsx`     | 5     | **passed** |

Run from a freshly rebuilt environment (dependencies restored from the committed lockfile, database re-initialised, all 81 migrations applied): **10 files / 98 tests passed, 0 failed.**

Static checks: `tsc --noEmit` **0 errors**; the two eslint warnings in `ConfigurationModule.tsx` are pre-existing (`set-state-in-effect` in the module-draft effect) and the new panel and tests produce none; `prettier --check` clean on every changed file; `vite build` succeeds.

The backend suite proves, against a real database and the real HTTP app:

1. Unauthenticated list → 401; an account with an unrelated permission → 403.
2. **A facility administrator holding only `facilities.modules.manage` can list _and_ create** — the exact case the old ALL-of guard refused.
3. A procurement reader can see the thresholds.
4. A procurement approver **cannot** change a threshold, and nothing is written.
5. An account holding `facilities.update` can.
6. A sibling facility and another tenant cannot read or write this facility's rules, including by naming the facility id, and a policy id from another tenant cannot be updated.
7. Unknown permission, duplicate threshold, malformed amount, reversed dates and unknown scope each return their own code — not a 500.
8. Renaming and deactivating leaves the threshold and required permission untouched.
9. Every create and update writes an audit row naming the actor (`CREATE`, then `UPDATE`).
10. Preview reports the governing rule and whether the caller meets it.
11. Enforcement: below the threshold an ordinary approver succeeds; above it the same approver gets `403 APPROVAL_AUTHORITY_REQUIRED` naming the rule and the order stays pending; the account holding the named authority approves it; the rule name is recorded on the order. Requisitions behave the same way.
12. Deactivating a rule through the API stops it blocking the next approval.
13. **The whole journey in order**, in one test: the administrator saves a rule → it comes back in the list the screen reads with the threshold as entered and the actor recorded → a requisition for 20,000 KES needs that authority → an approver without it is refused with `403 APPROVAL_AUTHORITY_REQUIRED` naming the rule → that approver's attempt to deactivate the rule to get past it is refused and the rule stays active → the account holding the named authority approves the same requisition, with the rule recorded in the decision note. This test also pins that the **highest matching threshold wins** where several requisition rules apply.

14. **Route registration.** The router registers exactly the four routes, each once; every route carries a permission guard as its first handler; the domain router mounts the router exactly once; and no other mounted router claims any of those paths. This test was mutation-checked: commenting out the `domains.use(approvalPolicyRoutes)` line makes two of its four cases fail, and `src/routes/index.ts` was restored byte-identically afterwards. Over HTTP, the management path answers with an authorisation code rather than the catch-all `NOT_FOUND`, and `/api/master-tariffs` (retired) still answers 404.

The UI suite proves the screen is reachable from facility settings, renders server data, shows empty and error (with a working retry) states, rejects a malformed threshold without calling the API, names the change in the confirmation before writing, places a server refusal beside the offending field and does not add the unsaved rule to the list, previews an amount, hides every writing control from a reader, and edits through confirmation without offering to rewrite an immutable threshold.

**Not run:** the full 262-file suite. This was a deliberate restriction for this batch.

## 7. Remaining limitations

1. **Dual control is not implemented.** A single account holding both a governance permission and `procurement.approve` can change a rule and then approve under it. Propose/approve on policy changes is a larger workflow.
2. **The required permission is typed, not chosen.** The server validates it against the permission catalogue and refuses anything else with a readable message, but there is no picker. A picker needs a catalogue endpoint this screen may not read. A stale or misspelled code cannot be saved, but a valid code nobody holds will simply block every approval above that threshold.
3. **Thresholds are immutable by design.** Moving one means retiring and re-issuing. That is deliberate and stated on screen, but it does mean an administrator cannot correct a typo in the amount.
4. **Rule scope is today-only on the preview.** A rule with a future `effectiveFrom` is visible in the list but the preview reports what applies today.
5. **Policies are per facility**, not inherited from the tenant. Two facilities in one tenant need the rule entered twice.
6. **There is no "approval level" concept, and none was invented.** The existing schema models delegated authority as _required permission per amount band_ (`min_amount_cents` + `required_permission`), not as numbered levels or role chains. Multi-step approval (level 1 → level 2) is not supported and is not claimed; adding it would need a schema change and is outside this batch.
7. **Not proven here:** that the thresholds an administrator chooses are sensible, that the permission named corresponds to a role anyone actually holds, and any behaviour against real facility data. All evidence above uses synthetic records.
8. **No live connectivity claim.** The UI test mocks the API client; the backend test uses a disposable PostgreSQL database. Neither demonstrates a production deployment.
