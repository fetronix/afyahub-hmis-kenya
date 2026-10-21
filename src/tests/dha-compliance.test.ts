/**
 * JaliCare HMIS
 * DHA self-assessment — contract tests
 *
 * The failure this suite prevents is a number that nobody can explain.
 * A compliance percentage is only worth showing if it is:
 *
 *   - derived from a register, not typed into a component,
 *   - unable to hide a missing critical control behind an average,
 *   - honest about what has not been built, and
 *   - never confused with a certificate.
 *
 * Run with: npx tsx src/tests/dha-compliance.test.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  DHA_CATEGORY_WEIGHTS,
  DHA_REQUIREMENTS,
  type DhaRequirement,
} from '../compliance/dha-requirements.ts';
import {
  CRITICAL_GAP_CEILING,
  MINIMUM_READINESS_SCORE,
  STATUS_CREDIT,
  buildDhaScore,
  scoreCategory,
} from '../compliance/dha-score.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) {
    throw new Error(`FAILED: ${label}`);
  }
}

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

/* ============================================================
   1. The register is well formed
   ============================================================ */

function testRegister(): void {
  const ids = DHA_REQUIREMENTS.map((item) => item.id);

  assert(new Set(ids).size === ids.length, 'Requirement ids are unique');

  assert(
    DHA_REQUIREMENTS.length >= 30,
    'The register covers the assessment areas, not a sample',
  );

  const categories = new Set(DHA_REQUIREMENTS.map((item) => item.category));

  assert(
    categories.size === 4,
    'All four scored categories are present',
  );

  for (const category of categories) {
    assert(
      typeof DHA_CATEGORY_WEIGHTS[category] === 'number',
      `${category} has a weight`,
    );
  }

  const weightSum = Object.values(DHA_CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0);

  assert(
    Math.abs(weightSum - 1) < 1e-9,
    'The four weights sum to exactly 1 (35 / 30 / 20 / 15)',
  );

  for (const item of DHA_REQUIREMENTS) {
    assert(item.evidence.trim().length > 10, `${item.id} cites evidence`);
    assert(item.verification.trim().length > 10, `${item.id} says how it was checked`);
    assert(item.module.trim().length > 0, `${item.id} names where it lives`);
    assert(
      ['critical', 'high', 'medium', 'low'].includes(item.severity),
      `${item.id} has a severity`,
    );
  }

  /*
   * The three findings this audit must never allow to drift back into
   * "done": no consent record, no allergy checking, no ODPC evidence.
   */
  const byId = new Map(DHA_REQUIREMENTS.map((item) => [item.id, item]));

  assert(
    byId.get('FN-06')?.status === 'MISSING',
    'Consent capture is recorded as missing until a route and screen exist',
  );
  assert(
    byId.get('FN-15')?.status === 'MISSING',
    'Allergy checking is recorded as missing',
  );
  assert(
    byId.get('SP-01')?.status === 'BLOCKED',
    'ODPC registration is blocked on an external party, not marked complete',
  );
  assert(
    byId.get('SP-02')?.status === 'BLOCKED',
    'The DPIA is blocked until a responsible officer signs it',
  );
  assert(
    byId.get('PH-04')?.status === 'MISSING',
    'MOH 705 is missing while the endpoint returns 501',
  );
}

/* ============================================================
   2. The arithmetic is the published formula
   ============================================================ */

function testScoring(): void {
  const fixture: DhaRequirement[] = [
    {
      id: 'T-1',
      category: 'functionality',
      title: 'one',
      requirement: 'r',
      module: 'm',
      status: 'VERIFIED',
      severity: 'low',
      evidence: 'e',
      verification: 'v',
    },
    {
      id: 'T-2',
      category: 'functionality',
      title: 'two',
      requirement: 'r',
      module: 'm',
      status: 'PARTIAL',
      severity: 'low',
      evidence: 'e',
      verification: 'v',
    },
    {
      id: 'T-3',
      category: 'security',
      title: 'three',
      requirement: 'r',
      module: 'm',
      status: 'NOT_APPLICABLE',
      severity: 'low',
      evidence: 'e',
      verification: 'v',
    },
  ];

  const functionality = scoreCategory('functionality', fixture);

  assert(
    functionality.assessed === 2,
    'NOT_APPLICABLE is excluded from the denominator',
  );
  assert(
    functionality.score === 75,
    'VERIFIED + PARTIAL scores (1 + 0.5) / 2 = 75%',
  );

  const security = scoreCategory('security', fixture);

  assert(
    security.assessed === 0 && security.score === 0,
    'A category with only inapplicable rows does not invent a score',
  );

  const report = buildDhaScore(fixture);

  assert(
    report.overallScore === 75,
    'A fixture without critical gaps reports its weighted average',
  );
  assert(
    report.certification === false,
    'The report never claims certification',
  );

  /*
   * The gate. One critical MISSING row must pull the whole figure
   * below the pass line, however good the rest is.
   */
  const gated = buildDhaScore([
    ...Array.from({ length: 19 }, (_, index) => ({
      ...fixture[0],
      id: `OK-${index}`,
      category: 'functionality' as const,
    })),
    {
      ...fixture[0],
      id: 'BAD-1',
      category: 'security',
      status: 'MISSING' as const,
      severity: 'critical' as const,
    },
  ]);

  assert(
    gated.criticalGateTriggered && gated.criticalGaps.length === 1,
    'A critical gap is detected',
  );
  assert(
    gated.overallScore <= CRITICAL_GAP_CEILING,
    'A critical gap caps the reported score below a pass',
  );
  assert(
    gated.overallScore < MINIMUM_READINESS_SCORE,
    'The cap is below the pass threshold',
  );
  assert(
    gated.readyForSubmission === false,
    'A capped assessment is not ready for submission',
  );

  assert(
    STATUS_CREDIT.BLOCKED === 0 && STATUS_CREDIT.MISSING === 0,
    'Blocked and missing work earns no credit',
  );
}

/* ============================================================
   3. The real register produces the number the UI shows
   ============================================================ */

function testRealAssessment(): void {
  const report = buildDhaScore();

  assert(
    report.totalRequirements === DHA_REQUIREMENTS.length,
    'Every requirement is included in the report',
  );

  assert(
    report.criticalGateTriggered,
    'The real assessment acknowledges its critical gaps',
  );

  assert(
    report.overallScore <= CRITICAL_GAP_CEILING,
    'The real score is shown at or below the critical-gap ceiling',
  );

  assert(
    report.weightedAverage >= report.overallScore,
    'The uncapped average is published beside the capped figure',
  );

  assert(
    report.readyForSubmission === false,
    'The system does not describe itself as ready to submit',
  );

  const sum = report.categories.reduce(
    (total, category) => total + category.assessed,
    0,
  );

  assert(
    sum === DHA_REQUIREMENTS.filter((item) => item.status !== 'NOT_APPLICABLE').length,
    'Every scored requirement lands in exactly one category',
  );

  console.log(
    `      reported ${report.overallScore}% (average ${report.weightedAverage}%), ` +
      `${report.counts.VERIFIED} verified, ${report.criticalGaps.length} critical gaps`,
  );
}

/* ============================================================
   4. The endpoint and the panel are wired to the register
   ============================================================ */

function testWiring(): void {
  const route = source('src/compliance/compliance.routes.ts');
  const app = source('src/app.ts');
  const panel = source('src/components/modules/DhaCompliancePanel.tsx');
  const interop = source('src/components/modules/InteroperabilityModule.tsx');

  assert(
    route.includes("requireAnyPermission('audit.read', 'reports.read', 'system.settings.manage')"),
    'The assessment requires a reporting or audit permission',
  );
  assert(
    route.includes('buildDhaScore'),
    'The endpoint computes the score; it does not accept one',
  );
  assert(
    !/router\.(post|put|patch|delete)\(/.test(route),
    'There is no endpoint that can edit a score',
  );

  assert(
    app.includes("app.use('/api/compliance', complianceRoutes)"),
    'The compliance router is mounted',
  );

  assert(
    panel.includes('api.getDhaCompliance'),
    'The panel reads the assessment from the server',
  );
  assert(
    !/overallScore\s*[:=]\s*\d/.test(panel),
    'The panel hard-codes no score',
  );
  assert(
    panel.includes('Not certified. Only DHA can certify.'),
    'The panel states what the score is not',
  );
  assert(
    panel.includes('criticalGaps') && panel.includes('capped because a critical requirement is unmet'),
    'The panel shows the cap rather than only the total',
  );

  assert(
    interop.includes('<DhaCompliancePanel />'),
    'The interoperability screen renders the assessment',
  );
}

/* ============================================================
   RUN
   ============================================================ */

function run(): void {
  console.log('');
  console.log('==============================================');
  console.log('DHA SELF-ASSESSMENT — CONTRACT TESTS');
  console.log('==============================================');

  testRegister();
  console.log('  1. The register is complete and cites evidence');
  testScoring();
  console.log('  2. The published formula and the critical gate are correct');
  testRealAssessment();
  console.log('  3. The real register produces a capped, honest figure');
  testWiring();
  console.log('  4. Endpoint and panel are wired to the register');

  console.log('');
  console.log('==============================================');
  console.log(`DHA COMPLIANCE TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

try {
  run();
} catch (error) {
  console.error('');
  console.error('==============================================');
  console.error('DHA COMPLIANCE TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
}
