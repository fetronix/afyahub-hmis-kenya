/**
 * Regenerate docs/dha-audit/DHA_REQUIREMENT_TRACEABILITY.md from the
 * requirements register.
 *
 * The document is generated rather than hand-written so it cannot drift
 * away from the code that produces the score. Run with:
 *
 *   npx tsx scripts/dha-traceability.ts
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import {
  DHA_CATEGORY_LABELS,
  DHA_CATEGORY_WEIGHTS,
  DHA_REQUIREMENTS,
  type RequirementCategory,
} from '../src/compliance/dha-requirements.ts';
import { buildDhaScore } from '../src/compliance/dha-score.ts';

const ORDER: RequirementCategory[] = [
  'functionality',
  'security',
  'reporting',
  'interoperability',
];

const report = buildDhaScore();

function cell(value: string | undefined): string {
  if (!value) return '—';
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

const lines: string[] = [];

lines.push('# DHA Requirement Traceability Matrix');
lines.push('');
lines.push(
  'Generated from `src/compliance/dha-requirements.ts` by `scripts/dha-traceability.ts`. ' +
    `Generated ${report.generatedAt}.`,
);
lines.push('');
lines.push(
  '> A status of **VERIFIED** means "exercised by a test in this repository and read during the audit". ' +
    'It does not mean certified, and it is not a DHA finding.',
);
lines.push('');
lines.push('## Summary');
lines.push('');
lines.push('| Category | Weight | Assessed | Verified | Score |');
lines.push('|---|---:|---:|---:|---:|');

for (const category of report.categories) {
  lines.push(
    `| ${category.label} | ${Math.round(category.weight * 100)}% | ${category.assessed} | ${category.verified} | ${category.score}% |`,
  );
}

lines.push(
  `| **Reported overall** | 100% | ${report.totalRequirements} | ${report.counts.VERIFIED} | **${report.overallScore}%** |`,
);
lines.push('');
lines.push(`Critical gaps: ${report.criticalGaps.map((gap) => gap.id).join(', ') || 'none'}.`);
lines.push('');
lines.push(`Ready for submission: **${report.readyForSubmission ? 'yes' : 'no'}**.`);
lines.push('');
lines.push(
  'Status credit used by the score: VERIFIED 1.0 · IMPLEMENTED_UNTESTED 0.75 · ' +
    'PARTIAL 0.5 · MISSING 0 · BLOCKED 0 · NOT_APPLICABLE excluded.',
);
lines.push('');

for (const category of ORDER) {
  const items = DHA_REQUIREMENTS.filter((item) => item.category === category);

  lines.push(
    `## ${DHA_CATEGORY_LABELS[category]} (weight ${Math.round(DHA_CATEGORY_WEIGHTS[category] * 100)}%)`,
  );
  lines.push('');
  lines.push(
    '| ID | Requirement | Module | Status | Severity | Evidence | Verification | External dependency |',
  );
  lines.push('|---|---|---|---|---|---|---|---|');

  for (const item of items) {
    lines.push(
      `| ${item.id} | **${cell(item.title)}**<br>${cell(item.requirement)} | ${cell(item.module)} | ${item.status} | ${item.severity} | ${cell(item.evidence)} | ${cell(item.verification)} | ${cell(item.externalDependency)} |`,
    );
  }

  lines.push('');
}

lines.push('## Notes carried from individual requirements');
lines.push('');

for (const item of DHA_REQUIREMENTS.filter((entry) => entry.note)) {
  lines.push(`- **${item.id} ${item.title}** — ${item.note}`);
}

lines.push('');
lines.push(`_${report.disclaimer}_`);
lines.push('');

const target = resolve(
  dirname(new URL(import.meta.url).pathname),
  '../docs/dha-audit/DHA_REQUIREMENT_TRACEABILITY.md',
);

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, lines.join('\n'), 'utf8');

console.log(`Wrote ${target}`);
console.log(`  ${DHA_REQUIREMENTS.length} requirements, overall ${report.overallScore}%`);
