/**
 * JaliCare HMIS
 * DHA compliance — read-only assessment endpoint
 *
 * The register is compiled into the server so the figure an
 * administrator sees cannot be edited in the browser. Nothing here
 * writes: an assessment is derived, not stored, which means it cannot
 * drift away from the code it describes.
 */

import { Router } from 'express';

import { requireAuth, type AuthRequest } from '../auth/auth.middleware.ts';
import { requireAnyPermission } from '../auth/authorization.middleware.ts';
import { buildDhaScore } from './dha-score.ts';
import {
  DHA_CATEGORY_WEIGHTS,
  DHA_REQUIREMENTS,
  type RequirementCategory,
} from './dha-requirements.ts';

const router = Router();

router.use(requireAuth);

/* ============================================================
   GET /api/compliance/dha
   ============================================================ */

router.get(
  '/dha',
  requireAnyPermission('audit.read', 'reports.read', 'system.settings.manage'),
  async (req: AuthRequest, res) => {
    if (!req.authContext) {
      res.status(401).json({
        success: false,
        error: 'AUTHORIZATION_CONTEXT_MISSING',
        message: 'Authorization context is required.',
      });
      return;
    }

    const category =
      typeof req.query.category === 'string' ? req.query.category : null;

    if (
      category !== null &&
      !(category in DHA_CATEGORY_WEIGHTS)
    ) {
      res.status(400).json({
        success: false,
        error: 'UNKNOWN_CATEGORY',
        message: `category must be one of: ${Object.keys(DHA_CATEGORY_WEIGHTS).join(', ')}.`,
      });
      return;
    }

    const report = buildDhaScore();

    res.json({
      success: true,
      ...report,
      requirements:
        category === null
          ? report.requirements
          : report.requirements.filter(
              (item) => item.category === (category as RequirementCategory),
            ),
    });
  },
);

/* ============================================================
   GET /api/compliance/dha/requirements/:id
   ============================================================ */

router.get(
  '/dha/requirements/:id',
  requireAnyPermission('audit.read', 'reports.read', 'system.settings.manage'),
  async (req: AuthRequest, res) => {
    if (!req.authContext) {
      res.status(401).json({
        success: false,
        error: 'AUTHORIZATION_CONTEXT_MISSING',
        message: 'Authorization context is required.',
      });
      return;
    }

    const requirement = DHA_REQUIREMENTS.find(
      (item) => item.id === req.params.id,
    );

    if (!requirement) {
      res.status(404).json({
        success: false,
        error: 'REQUIREMENT_NOT_FOUND',
        message: 'No requirement carries that id.',
      });
      return;
    }

    res.json({ success: true, requirement });
  },
);

export default router;
