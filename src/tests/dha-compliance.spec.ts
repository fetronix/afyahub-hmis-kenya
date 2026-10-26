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
  isCriticalGap,
  scoreCategory,
} from '../compliance/dha-score.ts';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

const root = resolve(here, '../..');

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

describe('DHA self-assessment — contract tests', () => {
  it('1. The register is well formed', async () => {
    const ids = DHA_REQUIREMENTS.map((item) => item.id);

    expect(new Set(ids).size === ids.length, 'Requirement ids are unique').toBe(true);

    expect(
      DHA_REQUIREMENTS.length >= 30,
      'The register covers the assessment areas, not a sample',
    ).toBe(true);

    const categories = new Set(DHA_REQUIREMENTS.map((item) => item.category));

    expect(categories.size === 4, 'All four scored categories are present').toBe(true);

    for (const category of categories) {
      expect(typeof DHA_CATEGORY_WEIGHTS[category] === 'number', `${category} has a weight`).toBe(
        true,
      );
    }

    const weightSum = Object.values(DHA_CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0);

    expect(
      Math.abs(weightSum - 1) < 1e-9,
      'The four weights sum to exactly 1 (35 / 30 / 20 / 15)',
    ).toBe(true);

    for (const item of DHA_REQUIREMENTS) {
      expect(item.evidence.trim().length > 10, `${item.id} cites evidence`).toBe(true);
      expect(item.verification.trim().length > 10, `${item.id} says how it was checked`).toBe(true);
      expect(item.module.trim().length > 0, `${item.id} names where it lives`).toBe(true);
      expect(
        ['critical', 'high', 'medium', 'low'].includes(item.severity),
        `${item.id} has a severity`,
      ).toBe(true);
    }

    /*
     * The three findings this audit must never allow to drift back into
     * "done": no consent record, no allergy checking, no ODPC evidence.
     */
    const byId = new Map(DHA_REQUIREMENTS.map((item) => [item.id, item]));

    /*
     * Consent and allergy checking were implemented on 2026-10-21, but
     * neither is finished: consent does not gate sharing, and there is no
     * interaction engine. PARTIAL is the truthful status, and both must
     * remain critical gaps — a half-built critical control does not lift
     * the readiness cap.
     */
    expect(
      byId.get('FN-06')?.status === 'PARTIAL',
      'Consent capture is partial: recorded, but not yet enforced on sharing',
    ).toBe(true);
    expect(
      byId.get('FN-06')?.evidence?.includes('/api/patients/:id/consents') ?? false,
      'The consent row cites the route that now exists',
    ).toBe(true);
    expect(
      byId.get('FN-06') !== undefined && isCriticalGap(byId.get('FN-06')!),
      'Partial consent capture is still a critical gap',
    ).toBe(true);
    expect(
      byId.get('FN-15')?.status === 'PARTIAL',
      'Allergy checking is partial: name matching, no interaction engine',
    ).toBe(true);
    expect(
      byId.get('FN-15') !== undefined && isCriticalGap(byId.get('FN-15')!),
      'Partial allergy checking is still a critical gap',
    ).toBe(true);
    expect(
      byId.get('SP-08')?.status === 'PARTIAL',
      'Encryption at rest is partial: identifiers sealed, volume not encrypted',
    ).toBe(true);
    expect(
      byId.get('SP-08') !== undefined && isCriticalGap(byId.get('SP-08')!),
      'Partial encryption is still a critical gap',
    ).toBe(true);
    expect(
      (byId.get('SP-08')?.externalDependency ?? '').length > 0,
      'The encryption row names the party that must finish it',
    ).toBe(true);
    expect(
      byId.get('SP-01')?.status === 'BLOCKED',
      'ODPC registration is blocked on an external party, not marked complete',
    ).toBe(true);
    expect(
      byId.get('SP-02')?.status === 'BLOCKED',
      'The DPIA is blocked until a responsible officer signs it',
    ).toBe(true);
    expect(
      byId.get('PH-04')?.status === 'MISSING',
      'MOH 705 is missing while the endpoint returns 501',
    ).toBe(true);
  });

  it('2. The arithmetic is the published formula', async () => {
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

    expect(functionality.assessed === 2, 'NOT_APPLICABLE is excluded from the denominator').toBe(
      true,
    );
    expect(functionality.score === 75, 'VERIFIED + PARTIAL scores (1 + 0.5) / 2 = 75%').toBe(true);

    const security = scoreCategory('security', fixture);

    expect(
      security.assessed === 0 && security.score === 0,
      'A category with only inapplicable rows does not invent a score',
    ).toBe(true);

    const report = buildDhaScore(fixture);

    expect(
      report.overallScore === 75,
      'A fixture without critical gaps reports its weighted average',
    ).toBe(true);
    expect(report.certification === false, 'The report never claims certification').toBe(true);

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

    expect(
      gated.criticalGateTriggered && gated.criticalGaps.length === 1,
      'A critical gap is detected',
    ).toBe(true);
    expect(
      gated.overallScore <= CRITICAL_GAP_CEILING,
      'A critical gap caps the reported score below a pass',
    ).toBe(true);
    expect(
      gated.overallScore < MINIMUM_READINESS_SCORE,
      'The cap is below the pass threshold',
    ).toBe(true);
    expect(
      gated.readyForSubmission === false,
      'A capped assessment is not ready for submission',
    ).toBe(true);

    expect(
      STATUS_CREDIT.BLOCKED === 0 && STATUS_CREDIT.MISSING === 0,
      'Blocked and missing work earns no credit',
    ).toBe(true);

    /*
     * A critical row that is half-built must still gate. Otherwise
     * implementing 50% of every critical control lifts the cap while
     * none of them is actually finished.
     */
    const partialCritical = buildDhaScore([
      ...Array.from({ length: 19 }, (_, index) => ({
        ...fixture[0],
        id: `OK-${index}`,
        category: 'functionality' as const,
      })),
      {
        ...fixture[0],
        id: 'HALF-1',
        category: 'security',
        status: 'PARTIAL' as const,
        severity: 'critical' as const,
      },
    ]);

    expect(
      partialCritical.criticalGateTriggered,
      'A critical requirement that is only PARTIAL still triggers the gate',
    ).toBe(true);
    expect(
      partialCritical.overallScore <= CRITICAL_GAP_CEILING,
      'Partial critical work does not lift the cap',
    ).toBe(true);
  });

  it('3. The real register produces the number the UI shows', async () => {
    const report = buildDhaScore();

    expect(
      report.totalRequirements === DHA_REQUIREMENTS.length,
      'Every requirement is included in the report',
    ).toBe(true);

    expect(report.criticalGateTriggered, 'The real assessment acknowledges its critical gaps').toBe(
      true,
    );

    expect(
      report.overallScore <= CRITICAL_GAP_CEILING,
      'The real score is shown at or below the critical-gap ceiling',
    ).toBe(true);

    expect(
      report.weightedAverage >= report.overallScore,
      'The uncapped average is published beside the capped figure',
    ).toBe(true);

    expect(
      report.readyForSubmission === false,
      'The system does not describe itself as ready to submit',
    ).toBe(true);

    const sum = report.categories.reduce((total, category) => total + category.assessed, 0);

    expect(
      sum === DHA_REQUIREMENTS.filter((item) => item.status !== 'NOT_APPLICABLE').length,
      'Every scored requirement lands in exactly one category',
    ).toBe(true);
  });

  it('4. The endpoint and the panel are wired to the register', async () => {
    const route = source('src/compliance/compliance.routes.ts');
    const app = source('src/app.ts');
    const dha = source('src/routes/dha.routes.ts');
    const wiring = source('src/routes/index.ts');
    const panel = source('src/components/modules/DhaCompliancePanel.tsx');
    const interop = source('src/components/modules/InteroperabilityModule.tsx');

    expect(
      route.includes('requireSuperAdmin()'),
      'The assessment is superadmin-only: no facility role can hold it',
    ).toBe(true);
    expect(
      route.includes('router.use(requireAuth, requireSuperAdmin())'),
      'The guard is on the router, so a route added here later is closed by default',
    ).toBe(true);
    expect(!route.includes('requireAnyPermission'), 'No permission list opens the assessment').toBe(
      true,
    );
    expect(
      !/router\.get\(\s*'\/dha'\s*,\s*require/.test(route),
      'The /dha route carries no second, weaker guard',
    ).toBe(true);
    expect(
      route.includes('buildDhaScore'),
      'The endpoint computes the score; it does not accept one',
    ).toBe(true);
    expect(
      !/router\.(post|put|patch|delete)\(/.test(route),
      'There is no endpoint that can edit a score',
    ).toBe(true);

    expect(
      wiring.includes("api.use('/compliance', complianceRoutes)"),
      'The compliance router is mounted',
    ).toBe(true);

    expect(
      panel.includes('api.getDhaCompliance'),
      'The panel reads the assessment from the server',
    ).toBe(true);
    expect(!/overallScore\s*[:=]\s*\d/.test(panel), 'The panel hard-codes no score').toBe(true);
    expect(
      panel.includes('Not certified. Only DHA can certify.'),
      'The panel states what the score is not',
    ).toBe(true);
    expect(
      panel.includes('criticalGaps') &&
        panel.includes('capped because a critical requirement is unmet'),
      'The panel shows the cap rather than only the total',
    ).toBe(true);

    expect(
      interop.includes('<DhaCompliancePanel />'),
      'The interoperability screen renders the assessment',
    ).toBe(true);

    /*
     * The screen is superadmin-only. Hiding a rail item is presentation;
     * these assertions hold the three places that make it true.
     */
    const sidebar = source('src/components/Sidebar.tsx');
    const facilityRail = sidebar.slice(
      sidebar.indexOf('export const navSections'),
      sidebar.indexOf('const COLLAPSE_KEY'),
    );

    expect(
      sidebar.includes('export const superAdminNavSections'),
      'There is a separate platform-owner rail',
    ).toBe(true);
    expect(
      sidebar.indexOf('superAdminNavSections') < sidebar.indexOf("id: 'interoperability'"),
      'The DHA entry sits in the platform-owner rail',
    ).toBe(true);
    expect(
      !facilityRail.includes("id: 'interoperability'"),
      'The facility rail does not offer the DHA screen at all',
    ).toBe(true);

    const appShell = source('src/App.tsx');
    expect(
      /case 'interoperability':[\s\S]{0,700}isSuperAdmin/.test(appShell),
      'The screen renders nothing but a fallback for a non-superadmin',
    ).toBe(true);
    expect(
      appShell.includes('<DashboardModule />'),
      'The fallback is the dashboard, not an empty page',
    ).toBe(true);

    expect(
      /router\.get\(\s*'\/api\/integrations\/dha\/readiness',\s*requireSuperAdmin\(\)/.test(dha),
      'The DHA readiness report is superadmin-only, like the screen that shows it',
    ).toBe(true);
  });
});
