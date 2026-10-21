/**
 * JaliCare HMIS
 * DHA readiness — scoring
 *
 * The score is a convenience over the register, never a substitute for
 * it. Three rules keep it honest:
 *
 *   1. NOT_APPLICABLE is excluded from both the numerator and the
 *      denominator. An inapplicable requirement must not dilute a gap.
 *   2. A critical requirement that is MISSING or BLOCKED caps the whole
 *      assessment below a pass. A 92% average with no ODPC registration
 *      and no DPIA is not 92% ready, and this function refuses to print
 *      a number that implies otherwise.
 *   3. Every category publishes its own denominator, so a category with
 *      three requirements cannot outweigh one with twelve.
 *
 * The result says `certification` is false, always. Only DHA can issue a
 * certification, and no arithmetic in this file changes that.
 */

import {
  DHA_CATEGORY_LABELS,
  DHA_CATEGORY_WEIGHTS,
  DHA_REQUIREMENTS,
  type DhaRequirement,
  type RequirementCategory,
  type RequirementStatus,
} from './dha-requirements.ts';

/**
 * How much of a requirement each status represents.
 *
 * These are deliberate, documented judgements — not measurements.
 * `BLOCKED` scores zero on purpose: a capability awaiting an external
 * party is not a capability the facility has.
 */
export const STATUS_CREDIT: Record<RequirementStatus, number> = {
  VERIFIED: 1,
  IMPLEMENTED_UNTESTED: 0.75,
  PARTIAL: 0.5,
  MISSING: 0,
  BLOCKED: 0,
  NOT_APPLICABLE: 0,
};

/** Below this, the assessment is not a pass, whatever the average says. */
export const MINIMUM_READINESS_SCORE = 60;

/** Ceiling applied when a critical requirement is unmet. */
export const CRITICAL_GAP_CEILING = 59.9;

export interface CategoryScore {
  category: RequirementCategory;
  label: string;
  weight: number;
  /** Requirements that count (NOT_APPLICABLE excluded). */
  assessed: number;
  verified: number;
  /** 0–100, rounded to one decimal. */
  score: number;
  /** Weighted contribution to the overall figure. */
  contribution: number;
}

export interface CriticalGap {
  id: string;
  title: string;
  status: RequirementStatus;
  severity: string;
  dependency?: string;
}

export interface DhaScoreReport {
  generatedAt: string;
  categories: CategoryScore[];
  /** The weighted average before any cap. */
  weightedAverage: number;
  /** What is actually reported, after the critical-gap ceiling. */
  overallScore: number;
  /** True when a critical requirement is MISSING or BLOCKED. */
  criticalGateTriggered: boolean;
  criticalGaps: CriticalGap[];
  readyForSubmission: boolean;
  counts: Record<RequirementStatus, number>;
  totalRequirements: number;
  requirements: DhaRequirement[];
  /**
   * A constant. This is a self-assessment, not a certificate.
   */
  certification: false;
  disclaimer: string;
}

const CATEGORY_ORDER: RequirementCategory[] = [
  'functionality',
  'security',
  'reporting',
  'interoperability',
];

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function scoreCategory(
  category: RequirementCategory,
  requirements: readonly DhaRequirement[] = DHA_REQUIREMENTS,
): CategoryScore {
  const inCategory = requirements.filter((item) => item.category === category);

  const assessed = inCategory.filter(
    (item) => item.status !== 'NOT_APPLICABLE',
  );

  const credit = assessed.reduce(
    (sum, item) => sum + STATUS_CREDIT[item.status],
    0,
  );

  const score = assessed.length === 0 ? 0 : (credit / assessed.length) * 100;

  return {
    category,
    label: DHA_CATEGORY_LABELS[category],
    weight: DHA_CATEGORY_WEIGHTS[category],
    assessed: assessed.length,
    verified: assessed.filter((item) => item.status === 'VERIFIED').length,
    score: round1(score),
    contribution: round1(score * DHA_CATEGORY_WEIGHTS[category]),
  };
}

export function isCriticalGap(requirement: DhaRequirement): boolean {
  return (
    requirement.severity === 'critical' &&
    (requirement.status === 'MISSING' || requirement.status === 'BLOCKED')
  );
}

export function buildDhaScore(
  requirements: readonly DhaRequirement[] = DHA_REQUIREMENTS,
): DhaScoreReport {
  const categories = CATEGORY_ORDER.map((category) =>
    scoreCategory(category, requirements),
  );

  /*
   * Weights are re-normalised over the categories that actually have
   * assessed requirements, so adding a category later does not silently
   * shrink the others.
   */
  const weightTotal = categories.reduce(
    (sum, item) => sum + (item.assessed > 0 ? item.weight : 0),
    0,
  );

  const weightedAverage =
    weightTotal === 0
      ? 0
      : categories.reduce(
          (sum, item) =>
            sum + (item.assessed > 0 ? item.score * item.weight : 0),
          0,
        ) / weightTotal;

  const criticalGaps = requirements.filter(isCriticalGap).map((item) => ({
    id: item.id,
    title: item.title,
    status: item.status,
    severity: item.severity,
    dependency: item.externalDependency,
  }));

  const criticalGateTriggered = criticalGaps.length > 0;

  const overallScore = round1(
    criticalGateTriggered
      ? Math.min(weightedAverage, CRITICAL_GAP_CEILING)
      : weightedAverage,
  );

  const counts = {
    VERIFIED: 0,
    IMPLEMENTED_UNTESTED: 0,
    PARTIAL: 0,
    MISSING: 0,
    BLOCKED: 0,
    NOT_APPLICABLE: 0,
  } satisfies Record<RequirementStatus, number>;

  for (const item of requirements) counts[item.status] += 1;

  return {
    generatedAt: new Date().toISOString(),
    categories,
    weightedAverage: round1(weightedAverage),
    overallScore,
    criticalGateTriggered,
    criticalGaps,
    readyForSubmission:
      !criticalGateTriggered && overallScore >= MINIMUM_READINESS_SCORE,
    counts,
    totalRequirements: requirements.length,
    requirements: [...requirements],
    certification: false,
    disclaimer:
      'This is a technical self-assessment computed from the requirements register in this repository. It is not a DHA assessment, an approval or a certification, and no score here may be presented as one.',
  };
}
