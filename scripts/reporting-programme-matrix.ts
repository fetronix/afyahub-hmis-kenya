/** Source-only requirements inventory; does not import a database client or execute SQL. */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { REPORT_CATEGORIES } from '../src/reporting/report-catalogue.ts';
import { REPORT_ENGINES } from '../src/reporting/report-centre.types.ts';

const baseline = process.argv.includes('--baseline');
const destination = `docs/audits/REPORTING_PROGRAMME_${baseline ? 'BASELINE' : 'CURRENT'}_MATRIX`;
if (baseline && existsSync(destination + '.json'))
  throw Error('The preimplementation baseline is frozen; use current matrix generation instead.');
const prior = JSON.parse(
  readFileSync('docs/audits/clinical-documents-evidence/report-catalogue.json', 'utf8'),
) as Array<{ id: string; dataSource: string }>;
const groups = [
  'Patient and clinical operations',
  'OPD, admissions and inpatient activity',
  'Laboratory and radiology',
  'Pharmacy and inventory',
  'Billing, collections and revenue',
  'Expenses, procurement and budgets',
  'Accounting and financial statements',
  'Management and statutory reporting',
];
type Profile = { module: string; users: string; entities: string; group: number; risk: string };
const profile = (
  module: string,
  users: string,
  entities: string,
  group: number,
  risk: string,
): Profile => ({ module, users, entities, group, risk });
const clinicalRisk =
  'Clinical eligibility, signature/release, sensitive patient access and approved document content must be specified; a stored clinical row is not an approved certificate.';
const financialRisk =
  'Operational amounts are not posted/reconciled revenue or cash. Confirm attribution, reversals, missing amounts, period and currency; do not join on free-text names.';
const profiles: Record<string, Profile> = {
  printables: profile(
    'clinical/documents',
    'Clinicians; records staff',
    'patients, encounters, practitioners',
    1,
    clinicalRisk,
  ),
  financial: profile(
    'billing',
    'Cashiers; billing supervisors; finance',
    'billing_invoices, billing_items, billing_payments',
    5,
    financialRisk,
  ),
  'stock-goods': profile(
    'inventory',
    'Storekeepers; pharmacists; inventory supervisors',
    'inventory_items, inventory_batches, inventory_movements',
    4,
    'Historical coverage starts with recorded movements; item labels may change; units cannot be summed across items; current balances are not historical valuations.',
  ),
  'departmental-opd': profile(
    'opd',
    'Clinicians; OPD supervisor; records staff',
    'encounters, patients, diagnoses, departments, practitioners',
    2,
    'Encounter state is not proof of attendance or clinical completion; diagnosis rows are not unique patients or statutory cases.',
  ),
  'departmental-inpatient': profile(
    'inpatient',
    'Ward nurses; admissions desk; inpatient supervisor',
    'admissions, wards, beds, inpatient_bed_occupancies, admission_transfers',
    2,
    'Current ward/bed references cannot reconstruct past occupancy. Establish bed-capacity denominator and event-time rules before occupancy percentages.',
  ),
  'departmental-laboratory': profile(
    'laboratory',
    'Laboratory scientists; laboratory supervisor',
    'lab_orders, lab_results, lab_tests, lab_specimens, lab_specimen_orders',
    3,
    'Verified result is not necessarily released. Define cancelled/rejected/partial orders, result versions, release authority and timing; do not infer release from completion.',
  ),
  'departmental-radiology': profile(
    'radiology',
    'Radiographers; radiologists; imaging supervisor',
    'radiology_orders, patients, facility_services',
    3,
    'Reported is recorded state, not independently proven performance. Consent is enforced at completion; revenue requires source-linked billing attribution.',
  ),
  'departmental-pharmacy': profile(
    'pharmacy',
    'Pharmacists; dispensing supervisors',
    'medications, pharmacy_dispensations, pharmacy_dispense_allocations, inventory_movements',
    4,
    'Prescription is not dispensing; distinguish stock issue/return from charge/revenue. Preserve item and dose snapshots; no mixed-unit totals.',
  ),
  'departmental-theatre': profile(
    'theatre',
    'Theatre coordinator; surgeons; anaesthetists',
    'theatre_cases, theatre_bookings, theatre_rooms, theatre_schedule_events',
    1,
    'Booking is not procedure completion. Utilization needs approved capacity, cancellation, overlap and operating-time definitions.',
  ),
  'departmental-maternity-mch': profile(
    'maternity',
    'Midwives; MCH supervisor; records staff',
    'maternity_pregnancies, anc_visits, deliveries, delivery_babies, postnatal_visits, immunisation_records',
    1,
    'Protect maternal/child linkage; multiple babies are not multiple deliveries; no statutory classification or immunisation coverage denominator inferred.',
  ),
  'departmental-dialysis': profile(
    'dialysis',
    'Dialysis nurses; nephrologists; unit manager',
    'dialysis_sessions, dialysis_treatment_plans, dialysis_consumable_usages, dialysis_patient_assessments',
    1,
    'Scheduled is not completed treatment. Separate session clinical state, consumables, billing and posted revenue.',
  ),
  'departmental-social-work': profile(
    'clinical/social-work',
    'Social workers; authorized waiver approvers',
    '',
    1,
    'No integrated social-work counselling/support register established by these candidate entities; define the workflow before reporting. Refund is not waiver.',
  ),
  records: profile(
    'registration/clinical',
    'Medical records officers; clinical supervisors',
    'patients, encounters, diagnoses, admissions',
    1,
    'Patient identity/link scope, duplicate rows, denominator, event dates and clinical definitions require review.',
  ),
  hr: profile(
    'workforce',
    'Restricted HR/payroll officers',
    'hr_employees, hr_departments, payroll_runs, payroll_payslips, payroll_payslip_lines',
    8,
    'Payroll and bank details need dedicated source/export permissions. Statutory output requires approved form/version and effective-dated mappings; do not infer current statutory rates.',
  ),
  activity: profile(
    'audit/operations',
    'Authorized audit officers; system administrators',
    'audit_logs',
    8,
    'Audit logs may contain sensitive details. Require dedicated source/export authorization, redaction, retention and precise event semantics, not unrestricted JSON export.',
  ),
};
const overrides: Record<string, Partial<Profile>> = {
  'printables-discharge-summaries': {
    module: 'inpatient/documents',
    entities: 'admissions, patients, diagnoses, facility_letterheads',
  },
  'printables-operation-notes': {
    module: 'theatre',
    entities: 'theatre_cases, patients',
    risk:
      clinicalRisk + ' Approved immutable operation-note/signature workflow is not exposed here.',
  },
  'printables-anaesthetist-notes': {
    module: 'theatre',
    entities: 'theatre_cases, patients',
    risk: clinicalRisk + ' No approved integrated anaesthetic note output established.',
  },
  'printables-bill-consent-forms': {
    entities: 'billing_invoices, patient_consents',
    risk: 'Structured consent does not prove a signed financial agreement. Define approved financial-consent template and signatory workflow.',
  },
  'printables-radiology-reports': {
    module: 'radiology/documents',
    entities: 'radiology_orders, patients, facility_letterheads',
    group: 3,
  },
  'printables-laboratory-reports': {
    module: 'laboratory/documents',
    entities: 'lab_orders, lab_results, patients, facility_letterheads',
    group: 3,
  },
  'printables-invoices': {
    module: 'billing/documents',
    entities:
      'billing_invoices, billing_invoice_finalizations, billing_items, facility_letterheads',
    group: 5,
    users: 'Billing officers; cashiers',
    risk: financialRisk,
  },
  'printables-receipts': {
    module: 'billing/documents',
    entities: 'billing_payments, billing_invoices, facility_letterheads',
    group: 5,
    users: 'Cashiers; billing officers',
    risk:
      financialRisk +
      ' Existing receipt PDF service is a candidate, not an integrated Reporting Centre workflow.',
  },
  'printables-purchase-requisitions': {
    module: 'procurement',
    entities: 'procurement_requisitions, procurement_requisition_items',
    group: 6,
  },
  'printables-local-purchase-orders': {
    module: 'procurement/documents',
    entities: 'purchase_orders, purchase_order_items, suppliers, facility_letterheads',
    group: 6,
  },
  'printables-goods-received-notes': {
    module: 'procurement/documents',
    entities: 'goods_received_notes, goods_received_note_items, facility_letterheads',
    group: 6,
  },
  'financial-trial-balance': {
    module: 'accounting',
    entities: 'journal_entries, journal_lines, chart_of_accounts, financial_periods',
    group: 7,
  },
  'financial-income-statement': {
    module: 'accounting',
    entities: 'journal_entries, journal_lines, chart_of_accounts, financial_periods',
    group: 7,
  },
  'financial-balance-sheet': {
    module: 'accounting',
    entities: 'journal_entries, journal_lines, chart_of_accounts, financial_periods',
    group: 7,
  },
  'financial-monthly-profit-and-loss': {
    module: 'accounting',
    entities: 'journal_entries, journal_lines, chart_of_accounts, financial_periods',
    group: 7,
  },
  'financial-cash-flow-statement': {
    module: 'accounting',
    entities: 'journal_entries, journal_lines, chart_of_accounts, bank_accounts',
    group: 7,
    risk: 'Approved cash-equivalent classification and direct/indirect cash-flow mapping are missing; a bank movement list is not a cash-flow statement.',
  },
  'financial-budget-management': {
    module: 'planning',
    entities:
      'planning_plans, planning_categories, planning_items, planning_months, planning_reports',
    group: 6,
    risk: 'Projections/imported budgets must stay separate from posted actuals and actual purchases. Define approved plan/version and comparisons.',
  },
  'financial-credit-notes': {
    module: 'billing/procurement',
    entities: 'billing_refunds, supplier_credit_notes, supplier_credit_note_items',
    risk: 'Patient credit notes and supplier credit notes are distinct. Establish intended subject; refund does not automatically mean finalized credit note.',
  },
  'financial-waiver-reports': {
    entities: 'billing_invoices, audit_logs',
    risk: 'No complete dedicated waiver-decision lifecycle established for this report; do not equate discounts/refunds with authorized waivers.',
  },
  'financial-sha-receivables': {
    module: 'sha',
    entities:
      'sha_eclaims, sha_eclaim_items, insurance_remittances, insurance_reconciliation_entries',
    risk: financialRisk + ' Claim submission/acceptance is not settlement or posted receivable.',
  },
  'financial-private-insurance-receivables': {
    module: 'private-insurance',
    entities:
      'private_insurance_claims, private_insurance_claim_lines, private_insurance_remittance_allocations',
    risk: financialRisk + ' Preserve payer-specific allocation and claim status rules.',
  },
  'financial-m-pesa-reconciliation': {
    module: 'payment-hub',
    entities: 'payment_hub_transactions, payment_hub_webhook_events, payment_hub_reconciliations',
    risk:
      financialRisk +
      ' Provider identifiers and trusted settlement evidence required, not callback success alone.',
  },
  'financial-card-payment-reconciliation': {
    module: 'payment-hub',
    entities: 'payment_hub_transactions, payment_hub_reconciliations, bank_transactions',
    risk: financialRisk + ' No assumed card settlement contract or provider mapping.',
  },
  'financial-refund-reports': {
    entities: 'billing_refunds, billing_invoices, billing_refund_requests',
  },
  'stock-goods-stock-variance': {
    entities: 'inventory_stock_counts, inventory_stock_count_lines, inventory_movements',
  },
  'stock-goods-stock-transfers': {
    entities: 'inventory_transfers, inventory_transfer_items, inventory_movements',
  },
  'stock-goods-goods-received': {
    module: 'procurement',
    entities: 'goods_received_notes, goods_received_note_items, inventory_movements',
    group: 6,
  },
  'stock-goods-goods-returned': {
    module: 'procurement',
    entities: 'supplier_returns, supplier_return_items, supplier_credit_notes, inventory_movements',
    group: 6,
  },
  'stock-goods-lpo-summaries': {
    module: 'procurement',
    entities: 'purchase_orders, purchase_order_items, suppliers',
    group: 6,
  },
  'stock-goods-inward-invoices': {
    module: 'procurement',
    entities: 'supplier_invoices, supplier_invoice_matches',
    group: 6,
  },
  'stock-goods-outward-invoices': {
    module: 'billing',
    entities: 'billing_invoices, billing_items',
    group: 5,
  },
  'stock-goods-bin-cards': {
    entities: 'inventory_movements, inventory_items, inventory_batches',
    risk: 'Define opening balance provenance, chronological event order, back-dated corrections and lot/store semantics; current stock is not a historical opening balance.',
  },
  'stock-goods-supplier-reports': {
    module: 'procurement',
    entities: 'suppliers, purchase_orders, supplier_invoices, supplier_payments',
    group: 6,
  },
  'stock-goods-stock-valuation': {
    module: 'inventory-accounting',
    entities:
      'inventory_movements, inventory_movement_allocations, inventory_movement_journals, facility_inventory_accounting',
    risk: 'Require approved cost layers, method/effective date and complete opening values; selling price times current stock is not a defensible inventory valuation.',
  },
  'stock-goods-asset-register': {
    module: 'accounting/assets',
    entities: 'fixed_assets, fixed_asset_categories, fixed_asset_movements',
    group: 7,
  },
  'stock-goods-asset-tracking': {
    module: 'accounting/assets',
    entities: 'fixed_assets, fixed_asset_transfers, fixed_asset_movements',
    group: 7,
  },
  'stock-goods-asset-maintenance': {
    module: 'accounting/assets',
    entities: 'fixed_assets, fixed_asset_maintenance',
    group: 7,
  },
  'departmental-inpatient-bed-billing': {
    entities:
      'inpatient_bed_nights, inpatient_bed_billing_work, inpatient_bed_stay_snapshots, inpatient_bed_billing_reviews',
    risk: 'Use recorded nightly evidence; exclude disputed/reversed work correctly; occupancy days do not equal chargeable nights or recognized revenue.',
  },
  'departmental-pharmacy-returns': {
    entities: 'inventory_movements, supplier_returns, supplier_return_items',
    risk: 'Supplier return is not patient medication return. Establish intended return workflow before integration.',
  },
  'records-birth-reports': {
    module: 'maternity',
    entities: 'deliveries, delivery_babies, maternity_pregnancies',
    risk: 'Clinical recorded birth is not a statutory birth certificate/registration; define live/stillbirth and multiple-birth rules.',
  },
  'records-death-reports': {
    entities: 'admissions, public_health_reports',
    risk: 'Discharge type alone is not a complete certified mortality register; cause-of-death and certification workflow must be defined.',
  },
  'records-ipd-diagnosis-reports': {
    module: 'inpatient',
    entities: 'admissions, encounters, diagnoses, patients',
    group: 2,
  },
  'records-triage-analysis': {
    module: 'clinical',
    entities: 'observations, encounters, queues',
    group: 2,
    risk: 'Define observations/codes, acuity scale and timestamp provenance; do not infer triage category from a single vital sign.',
  },
  'activity-system-audit-logs': { entities: 'audit_logs' },
  'activity-activity-logs-by-user': { entities: 'audit_logs, users' },
  'activity-failed-login-reports': {
    entities: 'login_attempts',
    risk: 'Failed-attempt records contain identifiers/IP addresses. Restricted security reporting/redaction is required; avoid account enumeration.',
  },
  'activity-patient-record-access-logs': {
    entities: 'patient_record_access_logs, users, patients',
  },
  'activity-financial-approval-logs': {
    entities:
      'expense_requests, procurement_requisition_events, billing_refund_requests, approval_policies',
    risk: 'Different approval state machines and evidence schemas must not be flattened into an invented common event chronology.',
  },
  'activity-sms-reports': {
    entities: 'notification_alert_states',
    risk: 'No complete durable SMS delivery/provider evidence source established; UI alerts are not SMS delivery receipts.',
  },
  'activity-notification-delivery-reports': {
    entities: 'notification_alert_states, notification_read_receipts',
    risk: 'An in-app read receipt is not external delivery; define channels and trusted provider status.',
  },
  'activity-messages-reports': {
    entities: '',
    risk: 'No complete messaging register/channel model established. Define source and restricted content projection first.',
  },
  'activity-custom-administrative-reports': {
    entities: '',
    risk: 'Custom report specification absent; do not expose arbitrary SQL or unrestricted database export.',
  },
  'activity-background-job-failures': {
    entities: 'billing_charge_attempts, inpatient_bed_billing_work',
    risk: 'These are domain-specific work queues, not a complete global job registry. Define retry/error redaction and intended job coverage.',
  },
};
const schemaSources = readdirSync('src/db/schema')
  .filter((p) => p.endsWith('.ts'))
  .map((p) => ({ p: 'src/db/schema/' + p, text: readFileSync('src/db/schema/' + p, 'utf8') }));
const entityFiles = new Map<string, string>();
for (const { p, text } of schemaSources)
  for (const m of text.matchAll(/pgTable\(\s*['"]([^'"]+)/g)) entityFiles.set(m[1], p);
const paths: Record<string, string> = {
  invoice: '/api/documents/invoices/:id/pdf',
  laboratory: '/api/documents/laboratory-orders/:id/pdf',
  radiology: '/api/documents/radiology-orders/:id/pdf',
  discharge: '/api/documents/admissions/:id/discharge-summary.pdf',
};
const rows = REPORT_CATEGORIES.flatMap((category) =>
  category.reports.map((entry) => {
    const prefix = Object.keys(profiles)
      .sort((a, b) => b.length - a.length)
      .find((k) => entry.id.startsWith(k))!;
    const spec = { ...profiles[prefix], ...overrides[entry.id] };
    if (entry.id.startsWith('printables-') && spec.module.startsWith('procurement'))
      spec.users = 'Procurement officers; stores receiving officers; authorized approvers';
    if (entry.id === 'hr-employee-list' || entry.id === 'hr-employee-summaries')
      spec.entities = 'hr_employees, hr_departments, hr_designations';
    if (entry.id === 'records-unregistered-patient-reports') {
      spec.entities = '';
      spec.risk =
        'No complete unregistered-person workflow is established; absence from patients cannot be enumerated as an unregistered patient.';
    }
    if (entry.id === 'records-cashier-workload') {
      spec.entities = 'billing_payments, billing_invoices';
      spec.module = 'billing';
      spec.risk =
        'Cashier name is recorded free text, not verified staff identity. Define workload units and attribution before grouping.';
    }
    if (entry.id === 'records-doctors-workload') {
      spec.entities = 'encounters, practitioners, users';
      spec.risk =
        'Linked practitioner user is available for some encounters; define workload units, team attribution and completion state without inferring from free-text names.';
    }
    if (entry.id === 'records-nurses-workload') {
      spec.entities = 'nursing_notes, inpatient_bed_occupancies, users';
      spec.risk =
        'A note count is not nursing workload, staffing hours or acuity; establish approved units and actor coverage.';
    }

    if (entry.id.startsWith('records-moh-'))
      Object.assign(spec, {
        group: 8,
        users: 'Records officers; authorized statutory reporting officers',
        risk: 'Official form/version, case definitions, aggregation, age/sex bands, deduplication, reporting period and KHIS/MOH validation/sign-off are required. Existing operational registers do not establish these rules.',
      });
    if (entry.id.includes('referral'))
      Object.assign(spec, {
        module: 'referrals',
        entities: 'referrals, referral_documents, patients, encounters',
        risk: 'Distinguish outgoing/incoming/accepted/completed referrals, document access and facility event ownership; do not count all states as completed care.',
      });
    if (entry.id.startsWith('hr-')) {
      if (entry.id.includes('attendance') || entry.id.includes('overtime'))
        spec.entities = 'hr_employees, hr_attendance, hr_shifts, hr_roster_entries';
      if (entry.id.includes('leave'))
        spec.entities = 'hr_employees, hr_leave_requests, hr_leave_types';
      if (/p9a|p10/.test(entry.id))
        spec.entities =
          'payroll_form_profiles, payroll_statutory_versions, payroll_payslips, payroll_payslip_lines';
    }
    const def = entry.engine ? REPORT_ENGINES[entry.engine] : null;
    const entities = spec.entities.split(', ').filter(Boolean);
    const actual =
      entry.engine === 'inventory-movements'
        ? 'inventory_movements, inventory_items'
        : entry.engine
          ? prior.find((p) => p.id === entry.id)?.dataSource
          : null;
    const proposed = entities.map((e) => ({
      entity: e,
      schema: entityFiles.get(e) ?? 'NOT ESTABLISHED',
    }));
    const availableFilters = def
      ? [
          'facility',
          ...(def.dateLabel
            ? [def.dateMode === 'asOf' ? 'as-of date' : 'inclusive from/to (max 366 days)']
            : []),
          'literal search',
          ...(def.statuses ? ['status'] : []),
          ...Object.entries(def)
            .filter(([k, v]) => k.endsWith('Filter') && v)
            .map(([k]) => k),
        ]
      : entry.workflow
        ? ['source document reference']
        : [];
    return {
      id: entry.id,
      name: entry.name,
      category: category.name,
      subcategory: entry.group,
      intendedUsers: spec.users + ' (proposed business audience; actual access remains RBAC)',
      priorityGroup: groups[spec.group - 1],
      sourceModule: def?.module ?? spec.module,
      requiredDatabaseEntities: proposed,
      existingQuerySources:
        actual ??
        (entry.engine === 'inventory-movements'
          ? 'inventory_movements, inventory_items'
          : 'No integrated query; candidate entities are requirements, not implemented joins'),
      existingApi: entry.engine
        ? `POST /api/reporting/centre/${entry.engine}/{options,generate,export}`
        : entry.workflow
          ? `GET ${paths[entry.workflow]}`
          : 'NONE in Reporting Centre; source-module APIs do not imply report acceptance',
      engine: entry.engine,
      workflow: entry.workflow,
      availableFilters,
      requiredFilters: def
        ? availableFilters
        : [
            'Authenticated facility; relevant recorded event dates; status/department only where reliable source identity exists',
          ],
      exports: entry.engine ? ['PDF', 'XLSX', 'CSV'] : entry.workflow ? ['PDF'] : [],
      letterhead: entry.engine
        ? 'Existing common active-facility PDF/Print PDF renderer'
        : entry.workflow
          ? 'Existing document historical/pinned renderer'
          : 'Not integrated; reuse common renderer when implemented',
      functionalStatus: entry.engine
        ? 'PARTIAL — source-backed operational/accounting subset'
        : entry.workflow
          ? 'PARTIAL — existing individual-document workflow'
          : 'UNAVAILABLE',
      verification: baseline
        ? 'Source audit + prior f0a3bf2 evidence only; not freshly runtime verified'
        : entry.engine === 'inventory-movements'
          ? 'Bounded recorded-register DB/browser/PDF/XLSX accepted; see REPORTING_PROGRAMME_BATCH_1_ACCEPTANCE.md. Broader stock report remains partial'
          : 'Prior baseline evidence; not re-certified as fully complete by this batch',
      missingImplementation: entry.dependency,
      dependenciesAndRisks: spec.risk,
      sourceEvidence: [
        'src/reporting/report-catalogue.ts',
        ...(entry.engine
          ? [
              'src/reporting/report-centre.types.ts',
              'src/reporting/report-centre.operational-definitions.ts',
              'src/reporting/report-centre.service.ts',
              'src/reporting/report-centre.operational-queries.ts',
            ]
          : []),
        ...new Set(proposed.map((e) => e.schema).filter((s) => s !== 'NOT ESTABLISHED')),
      ],
    };
  }),
);
if (rows.length !== 144 || new Set(rows.map((r) => r.id)).size !== 144)
  throw Error('Catalogue drift: review count/duplicates');
const missing = rows.flatMap((r) =>
  r.requiredDatabaseEntities
    .filter((e) => e.schema === 'NOT ESTABLISHED')
    .map((e) => `${r.id}:${e.entity}`),
);
if (missing.length) throw Error('Unverified schema entities: ' + missing.join(', '));
writeFileSync(
  destination + '.json',
  JSON.stringify(
    {
      baselineCommit: 'f0a3bf20fb50397d7a37512e59522a08c8ded47d',
      scope:
        'Source/schema audit; audiences and candidate entities for unavailable reports are proposed requirements, not completed functionality',
      entries: rows,
    },
    null,
    2,
  ) + '\n',
);
const clean = (v: unknown) => String(v).replaceAll('|', '/').replaceAll('\n', ' ');
const columns = [
  'Report / category',
  'Intended users',
  'Business priority group',
  'Source module',
  'Required database entities (schema verified; candidate, not proof of joins)',
  'Existing API / engine',
  'Available filters',
  'Exports / letterhead',
  'Functional status / missing implementation',
  'Dependencies and risks',
];
writeFileSync(
  destination + '.md',
  `# Reporting Centre — ${baseline ? 'baseline' : 'current'} 144-entry requirements matrix\n\nBaseline: f0a3bf20fb50397d7a37512e59522a08c8ded47d. **Zero entries are certified fully functional by source inspection.** Proposed users and required entities need business-owner approval. No production data consulted. Candidate entities are real schema tables but may lack the required semantics; absence of a Reporting Centre API is explicit. Source paths and structured fields are in the companion JSON.\n\n| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n` +
    rows
      .map(
        (r) =>
          '| ' +
          [
            `${r.category}${r.subcategory ? ' / ' + r.subcategory : ''}: ${r.name} (${r.id})`,
            r.intendedUsers,
            r.priorityGroup,
            r.sourceModule,
            r.requiredDatabaseEntities.map((e) => e.entity).join(', ') ||
              'No complete source established',
            r.existingApi + (r.engine ? ' [engine ' + r.engine + ']' : ''),
            r.availableFilters.join(', ') || 'NONE integrated',
            `${r.exports.join(', ') || 'NONE'}; ${r.letterhead}`,
            r.functionalStatus + '; ' + r.missingImplementation,
            r.dependenciesAndRisks,
          ]
            .map(clean)
            .join(' | ') +
          ' |',
      )
      .join('\n') +
    '\n',
);
console.log(
  `Wrote ${rows.length} entries to ${destination}.{md,json}; fully functional 0, partial ${rows.filter((r) => r.engine || r.workflow).length}, unavailable ${rows.filter((r) => !r.engine && !r.workflow).length}`,
);
