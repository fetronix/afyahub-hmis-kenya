/**
 * Assembles the documentation screenshot library from genuine captures that are
 * already committed in this repository as evidence for named verification runs.
 *
 * Every file copied here was produced by a browser driving the running JaliCare
 * application against synthetic data. Nothing is drawn, rendered or synthesised.
 *
 * Captures that do not exist for a module are NOT faked: the manifest records
 * them as unavailable and the chapters say so in words.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = 'docs/documentation/assets/screenshots';
const PROVENANCE = 'docs/documentation/SCREENSHOT_PROVENANCE.md';

/*
 * [source capture, destination in the documentation library, origin run]
 * Sources are evidence committed in this repository. If a source is absent the
 * build records it in `missing[]` rather than failing silently.
 */
const MAP = [
  /* shell, dashboard, enterprise */
  ['docs/project/delivery-evidence/phase-5/01-login.png', '01-platform/01-login-screen.png',
   'Phase 5 delivery evidence run'],
  ['docs/audits/accounting-workspace-evidence/10-mobile-dashboard.png', '01-platform/02-mobile-shell.png',
   'Accounting workspace evidence run (mobile viewport)'],
  ['docs/dashboard/screenshots/desktop-synthetic.png', '02-dashboard/01-dashboard-desktop.png',
   'Dashboard responsive-evidence run'],
  ['docs/dashboard/screenshots/refinement-desktop-notifications-synthetic.png', '02-dashboard/02-notifications.png',
   'Dashboard notifications refinement run'],
  ['docs/dashboard/screenshots/refinement-desktop-operations-synthetic.png', '02-dashboard/03-operational-overview.png',
   'Dashboard operations refinement run'],
  ['docs/dashboard/screenshots/mobile-synthetic.png', '02-dashboard/04-dashboard-mobile.png',
   'Dashboard mobile capture'],
  ['docs/dashboard/screenshots/tablet-synthetic.png', '02-dashboard/05-dashboard-tablet.png',
   'Dashboard tablet capture'],

  /* patients, reception, outpatient */
  ['docs/ui/screenshots/registration-desktop-synthetic.png', '03-patient-management/01-patient-management.png',
   'Presentation-readiness responsive run'],
  ['docs/ui/screenshots/registration-small-mobile-synthetic.png', '03-patient-management/02-patient-management-mobile.png',
   'Presentation-readiness responsive run'],
  ['docs/audits/clinical-documents-evidence/01-patient-consent-preview.png', '03-patient-management/03-patient-document.png',
   'Clinical-documents evidence run'],
  ['docs/audits/clinical-documents-evidence/02-patient-document-audit.png', '03-patient-management/04-document-audit.png',
   'Clinical-documents evidence run'],
  ['docs/audits/clinical-documents-evidence/03-patient-portal-own-documents.png', '03-patient-management/05-portal-documents.png',
   'Clinical-documents evidence run'],
  ['docs/audits/portal-medical-record-evidence/01-portal-medical-record-section.png', '03-patient-management/06-portal-medical-record.png',
   'Portal medical-record evidence run'],
  ['docs/ui/screenshots/reception-desktop-synthetic.png', '04-reception/01-appointment-queue.png',
   'Presentation-readiness responsive run'],
  ['docs/ui/screenshots/appointment-modal-small-mobile-synthetic.png', '04-reception/02-appointment-modal-mobile.png',
   'Presentation-readiness responsive run'],
  ['docs/ui/screenshots/specialty-desktop-synthetic.png', '05-outpatient/01-outpatient-workspace.png',
   'Presentation-readiness responsive run'],
  ['docs/audits/responsible-doctor-evidence/01-doctor-a-default.png', '05-outpatient/02-encounter-doctor-a.png',
   'Responsible-doctor evidence run'],
  ['docs/audits/responsible-doctor-evidence/03-records-search-selection.png', '05-outpatient/03-records-search.png',
   'Responsible-doctor evidence run'],

  /* diagnostics */
  ['docs/ui/screenshots/laboratory-desktop-synthetic.png', '10-laboratory/01-laboratory-workspace.png',
   'Presentation-readiness responsive run'],
  ['docs/ui/screenshots/laboratory-tablet-synthetic.png', '10-laboratory/02-laboratory-tablet.png',
   'Presentation-readiness responsive run'],
  ['docs/ui/screenshots/radiology-desktop-synthetic.png', '11-radiology/01-radiology-workspace.png',
   'Presentation-readiness responsive run'],
  ['docs/audits/radiology-consent-evidence/01-radiology-verified.png', '11-radiology/02-radiology-consent-verified.png',
   'Radiology consent evidence run'],
  ['docs/audits/radiology-consent-evidence/03-portal-release.png', '11-radiology/03-report-portal-release.png',
   'Radiology consent evidence run'],
  ['docs/audits/radiology-consent-evidence/04-mobile-consent.png', '11-radiology/04-consent-mobile.png',
   'Radiology consent evidence run'],
  ['docs/audits/presentation-readiness-evidence/04-radiology-verified-consent.png', '11-radiology/05-verified-consent.png',
   'Presentation-readiness evidence run'],

  /* workforce */
  ['docs/project/delivery-evidence/phase-5/02-human-resources-overview.png', '15-human-resources/01-hr-overview.png',
   'Phase 5 delivery evidence run'],
  ['docs/project/delivery-evidence/phase-5/03-hr-tab-1-employees.png', '15-human-resources/02-employees.png',
   'Phase 5 delivery evidence run'],
  ['docs/project/delivery-evidence/phase-5/03-hr-tab-3-attendance-roster.png', '15-human-resources/03-attendance-roster.png',
   'Phase 5 delivery evidence run'],
  ['docs/project/delivery-evidence/phase-5/04-hr-employee-record.png', '15-human-resources/04-employee-record.png',
   'Phase 5 delivery evidence run'],
  ['docs/audits/payroll-evidence/03-salary-components.png', '16-payroll/01-salary-components.png',
   'Payroll evidence run'],
  ['docs/audits/payroll-evidence/04-calculated-review.png', '16-payroll/02-calculated-review.png',
   'Payroll evidence run'],
  ['docs/audits/payroll-evidence/05-finalized-payroll.png', '16-payroll/03-finalised-run.png',
   'Payroll evidence run'],
  ['docs/audits/payroll-evidence/07-individual-payslip.png', '16-payroll/04-payslip.png',
   'Payroll evidence run'],
  ['docs/audits/payroll-readiness-evidence/09-ledger-mapping.png', '16-payroll/05-ledger-mapping.png',
   'Payroll readiness evidence run'],
  ['docs/project/delivery-evidence/phase-5/06-payroll-statutory-rules.png', '16-payroll/06-statutory-rules.png',
   'Phase 5 delivery evidence run'],

  /* revenue and money */
  ['docs/ui/screenshots/billing-desktop-synthetic.png', '17-billing/01-billing-workspace.png',
   'Presentation-readiness responsive run'],
  ['docs/ui/screenshots/billing-small-mobile-synthetic.png', '17-billing/02-billing-mobile.png',
   'Presentation-readiness responsive run'],
  ['docs/audits/accounting-workspace-evidence/01-accounting-dashboard.png', '18-accounting/01-accounting-dashboard.png',
   'Accounting workspace evidence run'],
  ['docs/audits/accounting-workspace-evidence/02-chart-of-accounts.png', '18-accounting/02-chart-of-accounts.png',
   'Accounting workspace evidence run'],
  ['docs/audits/accounting-workspace-evidence/03-financial-periods.png', '18-accounting/03-financial-periods.png',
   'Accounting workspace evidence run'],
  ['docs/audits/accounting-workspace-evidence/04-journal-entries.png', '18-accounting/04-journal-entries.png',
   'Accounting workspace evidence run'],
  ['docs/audits/accounting-workspace-evidence/05-income-statement.png', '18-accounting/05-income-statement.png',
   'Accounting workspace evidence run'],
  ['docs/audits/accounting-workspace-evidence/06-billing-settlement.png', '18-accounting/06-billing-settlement.png',
   'Accounting workspace evidence run'],
  ['docs/audits/accounting-workspace-evidence/07-expenses-payables.png', '18-accounting/07-expenses-payables.png',
   'Accounting workspace evidence run'],
  ['docs/audits/accounting-workspace-evidence/08-payroll-mapping-blockers.png', '18-accounting/08-payroll-mapping.png',
   'Accounting workspace evidence run'],
  ['docs/audits/accounting-workspace-evidence/09-existing-banking-workspace.png', '18-accounting/09-banking-workspace.png',
   'Accounting workspace evidence run'],
  ['docs/audits/accounting-workspace-evidence/12-read-only-permissions.png', '18-accounting/10-read-only-permission.png',
   'Accounting workspace evidence run'],
  ['docs/testing/financial-system/screenshots/17-partners-equity/01-partners-equity-dashboard.png', '19-partners-equity/01-dashboard.png',
   'Financial-system verification run, partners equity'],
  ['docs/testing/financial-system/screenshots/17-partners-equity/02-partners-equity-filtered-dashboard.png', '19-partners-equity/02-filtered-dashboard.png',
   'Financial-system verification run, partners equity'],
  ['docs/testing/financial-system/screenshots/17-partners-equity/03-contribution-register.png', '19-partners-equity/03-contribution-register.png',
   'Financial-system verification run, partners equity'],
  ['docs/testing/financial-system/screenshots/17-partners-equity/04-contribution-entry-draft.png', '19-partners-equity/04-contribution-draft.png',
   'Financial-system verification run, partners equity'],
  ['docs/testing/financial-system/screenshots/17-partners-equity/05-contribution-approved-and-posted.png', '19-partners-equity/05-contribution-posted.png',
   'Financial-system verification run, partners equity'],
  ['docs/testing/financial-system/screenshots/17-partners-equity/06-partner-statement.png', '19-partners-equity/06-partner-statement.png',
   'Financial-system verification run, partners equity'],
  ['docs/testing/financial-system/screenshots/17-partners-equity/07-changes-in-equity-annual.png', '19-partners-equity/07-changes-in-equity.png',
   'Financial-system verification run, partners equity'],
  ['docs/testing/financial-system/screenshots/17-partners-equity/08-reconciliation-after-reversal.png', '19-partners-equity/08-reconciliation.png',
   'Financial-system verification run, partners equity'],
  ['docs/audits/partner-equity-visibility-evidence/01-access-required.png', '19-partners-equity/09-access-required.png',
   'Partner equity visibility evidence run'],

  /* assets, stores, procurement */
  ['docs/project/delivery-evidence/phase-5/11-fixed-assets-register.png', '20-fixed-assets/01-register.png',
   'Phase 5 delivery evidence run'],
  ['docs/project/delivery-evidence/phase-5/12-fixed-asset-detail.png', '20-fixed-assets/02-asset-detail.png',
   'Phase 5 delivery evidence run'],
  ['docs/project/delivery-evidence/phase-5/13-fixed-assets-categories.png', '20-fixed-assets/03-categories.png',
   'Phase 5 delivery evidence run'],
  ['docs/project/delivery-evidence/phase-5/14-fixed-assets-maintenance.png', '20-fixed-assets/04-maintenance.png',
   'Phase 5 delivery evidence run'],
  ['docs/project/delivery-evidence/phase-5/16-fixed-assets-depreciation-preview.png', '20-fixed-assets/05-depreciation-preview.png',
   'Phase 5 delivery evidence run'],
  ['docs/project/delivery-evidence/phase-5/17-procurement-overview.png', '22-procurement/01-overview.png',
   'Phase 5 delivery evidence run'],
  ['docs/project/delivery-evidence/phase-5/19-procurement-requisition-form.png', '22-procurement/02-requisition-form.png',
   'Phase 5 delivery evidence run'],
  ['docs/project/delivery-evidence/phase-5/20-procurement-requisition-saved.png', '22-procurement/03-requisition-saved.png',
   'Phase 5 delivery evidence run'],
  ['docs/project/delivery-evidence/phase-5/21-procurement-receiving.png', '22-procurement/04-receiving.png',
   'Phase 5 delivery evidence run'],
  ['docs/ui/screenshots/inventory-desktop-synthetic.png', '21-inventory/01-inventory-workspace.png',
   'Presentation-readiness responsive run'],
  ['docs/project/delivery-evidence/phase-5/24-inventory-adjustment-posted.png', '21-inventory/02-adjustment-posted.png',
   'Phase 5 delivery evidence run'],
  ['docs/project/delivery-evidence/phase-5/26-inventory-transfer.png', '21-inventory/03-transfer.png',
   'Phase 5 delivery evidence run'],
  ['docs/project/delivery-evidence/phase-5/27-inventory-reorder-valuation.png', '21-inventory/04-valuation.png',
   'Phase 5 delivery evidence run'],
  ['docs/audits/reporting-programme-batch-1-evidence/05-branded-pdf-first-page.png', '21-inventory/05-stock-movements-report.png',
   'Reporting programme batch 1 evidence run (stock movement report PDF)'],

  /* insurance */
  ['docs/ui/screenshots/sha-eclaims-desktop-synthetic.png', '23-insurance/01-sha-eclaims.png',
   'Presentation-readiness responsive run'],
  ['docs/ui/screenshots/private-insurance-desktop-synthetic.png', '24-private-insurance/01-private-insurance.png',
   'Presentation-readiness responsive run'],

  /* reporting, configuration, audit, platform */
  ['docs/audits/presentation-readiness-evidence/06-reporting-centre-catalogue.png', '25-reporting/01-catalogue.png',
   'Presentation-readiness evidence run'],
  ['docs/audits/presentation-readiness-evidence/07b-reporting-centre-returned-rows.png', '25-reporting/02-report-results.png',
   'Presentation-readiness evidence run'],
  ['docs/audits/reporting-programme-batch-1-evidence/01-movement-workbench.png', '25-reporting/03-movement-workbench.png',
   'Reporting programme batch 1 evidence run'],
  ['docs/audits/reporting-programme-batch-1-evidence/02-actual-movement-rows.png', '25-reporting/04-movement-rows.png',
   'Reporting programme batch 1 evidence run'],
  ['docs/audits/reporting-programme-batch-1-evidence/03-empty-result.png', '25-reporting/05-empty-result.png',
   'Reporting programme batch 1 evidence run'],
  ['docs/audits/reporting-programme-batch-1-evidence/05-branded-pdf-first-page.png', '25-reporting/06-exported-pdf.png',
   'Reporting programme batch 1 evidence run'],
  ['docs/audits/presentation-readiness-evidence/08-reporting-centre-clinical-document.png', '25-reporting/07-clinical-document-report.png',
   'Presentation-readiness evidence run'],
  ['docs/ui/screenshots/settings-desktop-synthetic.png', '26-configuration/01-configuration.png',
   'Presentation-readiness responsive run'],
  ['docs/ui/screenshots/platform-administration-desktop-synthetic.png', '26-configuration/02-platform-administration.png',
   'Presentation-readiness responsive run'],
  ['docs/audits/clinical-documents-evidence/05-letterhead-active-version.png', '26-configuration/03-letterhead-version.png',
   'Clinical-documents evidence run'],
  ['docs/ui/screenshots/audit-desktop-synthetic.png', '27-audit/01-audit-trail.png',
   'Presentation-readiness responsive run'],
  ['docs/audits/syrona-zero-fill-evidence/browser/08-audit.png', '27-audit/02-audit-events.png',
   'Zero-fill planning evidence run'],
  ['docs/audits/syrona-zero-fill-evidence/browser/01-dashboard.png', '28-planning/01-planning-dashboard.png',
   'Zero-fill planning evidence run'],
  ['docs/audits/syrona-zero-fill-evidence/browser/10-import-preview.png', '28-planning/02-import-preview.png',
   'Zero-fill planning evidence run'],
  ['docs/audits/syrona-zero-fill-evidence/browser/09-issued-report.png', '28-planning/03-issued-report.png',
   'Zero-fill planning evidence run'],
  ['docs/audits/budget-planning-evidence/13-pdf-page-1.png', '28-planning/04-budget-pdf.png',
   'Budget planning evidence run'],
];

async function main() {
  const written = [];
  const missing = [];
  for (const [source, dest, origin] of MAP) {
    const target = path.join(OUT, dest);
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, target);
      const stat = await fs.stat(target);
      written.push({ dest, source, origin, bytes: stat.size });
    } catch {
      missing.push(source);
    }
  }

  const lines = [
    '# Screenshot provenance',
    '',
    'Every image in this documentation package is a browser capture of the running JaliCare',
    'application against synthetic data. No image was generated by an image model, drawn by',
    'hand, or reconstructed from a design file.',
    '',
    'Each file below was copied unchanged from a verification run already committed in this',
    'repository. The source path is given so a reviewer can compare the image with the run',
    'that produced it. The account in each capture is synthetic, the patients are synthetic',
    'and the amounts are invented test figures.',
    '',
    '## Captures included',
    '',
    '| Documentation file | Source capture | Origin run | Bytes |',
    '| --- | --- | --- | --- |',
    ...written.map(
      (entry) => `| \`${entry.dest}\` | \`${entry.source}\` | ${entry.origin} | ${entry.bytes} |`,
    ),
    '',
    '## Modules with no capture available',
    '',
    'The following screens could not be captured for this issue because no genuine capture of',
    'them exists in the repository evidence and the browser harness was unavailable in the',
    'build environment. They are documented from source and schema, and the chapters say so',
    'instead of showing a picture:',
    '',
    '- Inpatient ward board and discharge (no ward configured in the synthetic dataset)',
    '- Pharmacy dispensing',
    '- Operating theatre case list',
    '- Dialysis sessions',
    '- Trial balance, balance sheet and cash flow statements as standalone screens',
    '- Maternity and child health registers',
    '',
    missing.length
      ? `\n## Sources referenced but absent from this checkout\n\n${missing.map((entry) => `- \`${entry}\``).join('\n')}\n`
      : '',
  ];
  await fs.writeFile(PROVENANCE, `${lines.join('\n')}\n`);

  const manifest = {
    generatedAt: new Date().toISOString(),
    count: written.length,
    files: written,
    missing,
  };
  await fs.writeFile('docs/documentation/assets/screenshot-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`screenshots assembled: ${written.length} · missing sources: ${missing.length}`);
  if (missing.length) console.log(missing.slice(0, 12).join('\n'));
}

main();
