import { Router } from 'express';
import type { AuthRequest } from '../../auth/auth.middleware.ts';
import { requireAnyPermission, requirePermission } from '../../auth/authorization.middleware.ts';
import { handleScopeError } from '../../routes/shared/errors.ts';
import { ClaimEvidenceError, previewClaimEvidence } from './claim-evidence.service.ts';

const router = Router();
router.post(
  '/preview',
  requirePermission('billing.read', 'clinical.read'),
  requireAnyPermission('insurance.sha.claims.prepare', 'insurance.private.claims.prepare'),
  async (req: AuthRequest, res) => {
    if (!req.authContext)
      return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
    res.setHeader('Cache-Control', 'no-store');
    try {
      return res.json(await previewClaimEvidence(req.authContext, req.body ?? {}));
    } catch (error) {
      if (error instanceof ClaimEvidenceError)
        return res
          .status(error.status)
          .json({ success: false, error: error.code, message: error.message });
      if (handleScopeError(error, res)) return;
      return res.status(500).json({
        success: false,
        error: 'CLAIM_EVIDENCE_PREVIEW_FAILED',
        message: 'Clinical evidence could not be previewed.',
      });
    }
  },
);
export default router;
