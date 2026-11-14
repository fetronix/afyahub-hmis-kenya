# Laboratory investigation identity and facility billing

## Scope and status

This change addresses laboratory orders created from a facility investigation, without introducing a new invoice engine or changing the clinical sequence. The evidence below uses **only isolated synthetic PostgreSQL databases and synthetic browser data**. It is not evidence of a production deployment, real-facility configuration, a real patient's outcome, or completed clinical UAT. No real prices, pending attempts, historical identities, invoices, payments or production data were altered.

## Findings

- Reproduced in the outpatient UI: after a selected facility service disappeared from a refreshed catalogue, a mixed order containing free text could be submitted while silently omitting the selected service's ID. A specimen or description was left, but neither is a service identity. The UI now retains the selected service and specimen independently and sends its ID; it allows the selection to be removed and the server checks availability again.
- A name-only investigation intentionally has neither a facility service ID nor a legacy laboratory-test ID. It remains a clinical exception and does not become chargeable by matching words, a specimen, or a guessed code. Its unpriced evaluation reports `SERVICE_NOT_SELECTED`.
- The reported real-record error indicates the resolver could not find a supported explicit identity on that order. It does **not** establish that a checkbox was selected originally, why the identity was absent, which code version was deployed, or whether the real facility tariff was linked correctly. Those facts remain unverified; do not backfill or infer them from this synthetic reproduction.
- Differing service and tariff codes are not themselves a defect: the relationship is the explicit facility-service foreign key, not equality of code or name.

## Identity, scope and billing path

1. Facility configuration creates a row in `facility_services` and an explicitly linked row in `facility_service_tariffs`. A laboratory service has category `LABORATORY`; `unit` represents e.g. `Service`. The tariff's `facility_service_id` references `facility_services.id`, with `(facility_service_id, facility_id, tenant_id)` constrained to the same facility and tenant. The active-tariff uniqueness guard prevents choosing an arbitrary active tariff by row order.
2. The facility-scoped laboratory catalogue is retrieved by category/normalized department. The outpatient selection keeps the selected ID and its separately entered specimen even if the catalogue refreshes; facility/tenant changes clear drafts. The UI rejects an encounter for a different tenant, facility or patient. The server independently authorizes and validates the facility, patient, encounter, service category/activity and each order line; a mixed batch is atomic.
3. The server persists `lab_orders.tenant_id`, `facility_id`, `patient_id`, `encounter_id`, `facility_service_id`, separate `specimen_type`, and the validated order-time `service_code` snapshot. A legacy explicitly selected `lab_orders.test_id` remains a separate supported identity. Retrieval and idempotent replay return the stored code snapshot; `currentServiceCode` is a separately scoped view of the current service code. An audit records the selected identity. Code and name are not used to guess a missing ID.
4. Existing accessioning, specimen collection, result entry and verification remain in place. A clinician explicitly completes the investigation only after the existing collection and verified-result checks. There is no order-time laboratory charge. The completion and durable billing-work record use the existing transactional path.
5. The existing charge resolver uses the persisted explicit service ID and the tariff's scoped `facility_service_id`, checks service/tariff activity, automatic-billing flags, effective dates and a positive price, then creates an ordinary idempotent `billing_items` row linked to the invoice and tariff. The item also keeps tariff/service code and price snapshots. It does not guess from a name or specimen or charge an uncompleted investigation.
6. Missing, disabled, not-yet-effective, expired or zero-priced tariffs do not block otherwise valid completion. The existing `billing_charge_attempts` queue keeps the generic `reason` for compatibility and, for new evaluations, the nullable `diagnosis_code` with a specific reason such as `SERVICE_NOT_SELECTED`, `TARIFF_NOT_CONFIGURED`, `NOT_YET_EFFECTIVE`, `EXPIRED` or `ZERO_PRICE`. A still-pending retry refreshes the diagnosis; an explicitly configured, eligible tariff can then be retried using the same idempotent billing engine. The removed review panel remains removed; the queue/API and prior rows remain intact. An unavailable queue or audit is not treated as an empty queue or as a successfully recorded clinical completion.

## Evidence

- Synthetic end-to-end browser and PostgreSQL run: configured `BLOOD01` (`blood test`, `LABORATORY`, unit `Service`) with an explicitly linked tariff `LB-BLD01` at **KES 456.00**. The browser selected the real facility-service ID and a separate specimen, and the database persisted both. No laboratory line was created at order time. After specimen collection, result entry, verification and explicit completion, exactly one invoice item had the selected service ID, tariff ID, tariff code `LB-BLD01` and unit price KES 456.00. The same run completed two further investigations, imaging and a consultation, producing one unpaid KES 1,031 five-line invoice; repeated completion did not duplicate items.
- `src/tests/integration/laboratory-facility-identity.db.spec.ts` exercises that database-backed flow and identity retrieval/replay, scoped authorization and composite FK, concurrent completion, unpriced and ineligible tariffs, precise pending diagnosis, retry after explicit configuration, no name-based inference, encounter/patient mismatch, atomic batches, audited identity and unchanged synthetic paid financial history. It also applies the three migration statements to temporary historical fixtures and checks that old fields remain unchanged.
- `src/tests/vitest/outpatient-safety-ui.spec.tsx` covers identity/specimen retention through catalogue refresh, clearing a draft on scope change, stale-selection removal and filtering entries from another tenant/facility. A focused run of the laboratory, outpatient, billing concurrency, invoice, specimen-sharing, facility-service and tariff tests passed **212 tests across 14 files**.
- TypeScript typecheck passes; ESLint passes with 0 errors and 80 warnings. Deployment build and synthetic browser journey were run; the build warns about a large client chunk.
- The full database-required Vitest run is **not green**: 198 files passed, 4 failed; 1,838 tests passed, 18 failed and 11 skipped. A separate, fresh synthetic database running the unmodified starting commit `2bf03ca` produced the exact same 18 failing test names and the same failed suite setup (197 files passed, 4 failed; 1,817 tests passed, 18 failed and 11 skipped). Two `billing-posting` and two `tariff-validation` tests expect retired tariff validation/import endpoints and receive 404. Fourteen `master-tariffs-workflow` tests expect prior master-based routes, billing or diagnostic behavior. The `clinical-catalogue-selection` suite setup expects the retired `/api/master-lab-specimens` endpoint, receives 404, and its 11 tests do not run. These failures must be reconciled against the intended facility-owned workflow; they have not been disabled or weakened. This is a release blocker, not proof that all older workflows are safe.

## Schema and rollout requirements

Apply the complete ordered migration chain, then **0057, 0058 and 0059 before code that reads the new columns**:

- `0057_lab_service_scope.sql`: adds the composite `lab_orders` → `facility_services` tenant/facility FK as `NOT VALID`. It protects new or changed references but deliberately neither rewrites nor validates historical mismatches. Existing mismatches need a separate, authorized investigation; do not validate the constraint or recode historical orders blindly.
- `0058_charge_attempt_diagnosis.sql`: adds nullable `billing_charge_attempts.diagnosis_code`. Old rows keep their existing values and the new column remains NULL until a new evaluation.
- `0059_lab_service_code_snapshot.sql`: adds nullable `lab_orders.service_code`. It does not backfill old orders or change historical descriptions, financial items or tariffs.

On fresh isolated synthetic PostgreSQL, all 60 migrations applied; the legacy-mismatch, queue and order fixtures were also checked before and after these migrations. A missing new queue column must not be mistaken for the old missing bed-night identity columns: the code reports incomplete schema instead of disabling the process-wide bed-night identity guard. The existing clinical transaction requires durable billing work and audit, so an unavailable/broken queue is an infrastructure error, not a missing-tariff case.

Before any separately authorized deployment, review migration history and data, obtain and verify a restorable backup, rehearse the ordered migrations and application rollback on a representative isolated copy, arrange appropriate downtime/monitoring, resolve the failing suite, and obtain facility/clinical/financial UAT and approval. Retaining additive columns when rolling back application code is safer than dropping new provenance; an older application can reintroduce the lost-selection behavior. Do not run a historical backfill, price update, financial correction, `VALIDATE CONSTRAINT`, destructive rollback or production migration without its own approved plan.

## Read-only diagnostics for an authorized operator

These examples are **not** executed by the application or this work. Run only with explicit authorization, a read-only role and bound parameters `$1 = tenant ID`, `$2 = facility ID`, `$3 = a reviewed lab-order ID`. The detailed queries require migrations 0058–0059. Share only the minimum necessary results through approved channels; order and tariff IDs are sensitive operational metadata. An empty scoped join is not a license to infer or modify an identity.

Count historical links which fail the same tenant/facility relationship (aggregate only):

```sql
SELECT count(*) AS out_of_scope_links
FROM lab_orders AS o
LEFT JOIN facility_services AS s
  ON s.id = o.facility_service_id
 AND s.facility_id = o.facility_id
 AND s.tenant_id = o.tenant_id
WHERE o.tenant_id = $1 AND o.facility_id = $2
  AND o.facility_service_id IS NOT NULL AND s.id IS NULL;
```

Inspect a single authorized order's explicit relationship and candidate configured tariffs, without patient names or free text:

```sql
SELECT o.id AS order_id, o.status, o.test_id, o.clinical_exception,
       o.facility_service_id, o.service_code AS order_service_code,
       s.id AS scoped_service_id, s.code AS current_service_code,
       s.category, s.department, s.is_active AS service_active, s.auto_bill AS service_auto_bill,
       t.id AS tariff_id, t.code AS tariff_code, t.fee, t.is_active AS tariff_active,
       t.auto_bill AS tariff_auto_bill, t.effective_from, t.effective_to, t.archived_at
FROM lab_orders AS o
LEFT JOIN facility_services AS s
  ON s.id = o.facility_service_id AND s.facility_id = o.facility_id AND s.tenant_id = o.tenant_id
LEFT JOIN facility_service_tariffs AS t
  ON t.facility_service_id = s.id AND t.facility_id = s.facility_id AND t.tenant_id = s.tenant_id
WHERE o.tenant_id = $1 AND o.facility_id = $2 AND o.id = $3
ORDER BY t.id;
```

Inspect scoped queue diagnoses and existing invoice-item snapshots separately; a queue row or invoice status is not proof of payment:

```sql
SELECT a.id, a.status, a.reason, a.diagnosis_code,
       a.resolved_item_id, a.resolved_invoice_id, a.resolved_tariff_code, a.resolved_unit_price
FROM billing_charge_attempts AS a
JOIN lab_orders AS o ON o.id = a.source_id AND o.tenant_id = a.tenant_id
                    AND o.facility_id = a.facility_id AND o.patient_id = a.patient_id
WHERE a.tenant_id = $1 AND a.facility_id = $2 AND o.id = $3 AND a.source_type = 'LAB_ORDER';

SELECT b.id, b.invoice_id, b.facility_service_id, b.tariff_id, b.tariff_code,
       b.service_code, b.quantity, b.unit_price, b.total_amount
FROM billing_items AS b
JOIN billing_invoices AS i ON i.id = b.invoice_id
JOIN lab_orders AS o ON o.id = b.source_id AND o.tenant_id = i.tenant_id
                    AND o.facility_id = i.facility_id AND o.patient_id = i.patient_id
WHERE i.tenant_id = $1 AND i.facility_id = $2 AND o.id = $3 AND b.source_type = 'LAB_ORDER';
```

## Files changed and existing contracts traced

Changed:

- `src/components/modules/OutpatientModule.tsx`: scoped service selection and specimen retention.
- `src/routes/facility-services.routes.ts`: normalized laboratory catalogue filtering.
- `src/db/queries/laboratory.ts`, `src/db/schema/laboratory.ts`, `src/db/schema/billing.ts`, `src/types/index.ts`: validated identities, snapshots, retrieval and audit.
- `src/billing/facility-charge-resolver.ts`, `src/billing/charge-attempts.ts`: scoped ID resolution, precise queue diagnosis and retries through the existing billing engine.
- `drizzle/0057_lab_service_scope.sql`, `drizzle/0058_charge_attempt_diagnosis.sql`, `drizzle/0059_lab_service_code_snapshot.sql`, `drizzle/meta/_journal.json`: additive migration sequence.
- `src/tests/integration/laboratory-facility-identity.db.spec.ts`, `src/tests/vitest/outpatient-safety-ui.spec.tsx`, `scripts/facility-billing-browser-smoke.mjs`, this audit: synthetic regression, browser-to-database evidence and deployment notes.

Existing contracts also traced, without changes here: `src/components/modules/LaboratoryModule.tsx`, `src/routes/laboratory.routes.ts`, `src/api/clients/diagnostics-pharmacy.client.ts`, `src/validation/schemas/laboratory.schema.ts`, `src/db/queries/shared.ts` and the existing billing engine.
