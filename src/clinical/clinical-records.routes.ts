/**
 * JaliCare HMIS
 * Consent and allergy routes
 *
 * Both resources hang off a patient, are scoped to the caller's
 * facility, and answer 404 — never 403 — for a patient in another
 * tenant, so the response cannot be used to enumerate ids.
 *
 *   GET    /api/patients/:id/consents
 *   POST   /api/patients/:id/consents
 *   POST   /api/patients/:id/consents/:consentId/revoke
 *   GET    /api/patients/:id/allergies
 *   POST   /api/patients/:id/allergies
 *   PATCH  /api/patients/:id/allergies/:allergyId
 *   POST   /api/patients/:id/allergies/check
 *
 * The check endpoint exists so a prescribing screen can ask before it
 * writes, rather than discovering the conflict afterwards.
 */

import { Router } from 'express';

import { requireAuth, type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import { ScopeAccessError } from '../auth/scope.service.ts';

import {
  ConsentError,
  grantConsent,
  listConsents,
  revokeConsent,
} from './consent.service.ts';

import {
  AllergyError,
  checkMedicationAllergies,
  listAllergies,
  recordAllergy,
  setAllergyStatus,
} from './allergy.service.ts';

const router = Router();

router.use(requireAuth);

function sendError(res: import('express').Response, error: unknown): boolean {
  if (error instanceof ConsentError || error instanceof AllergyError) {
    res.status(error.statusCode).json({
      success: false,
      error: error.code,
      message: error.message,
    });

    return true;
  }

  if (error instanceof ScopeAccessError) {
    const status = error.code === 'FACILITY_REQUIRED' ? 400 : 403;

    res.status(status).json({
      success: false,
      error: error.code,
      message: error.message,
    });

    return true;
  }

  return false;
}

function requireContext(req: AuthRequest, res: import('express').Response) {
  if (!req.authContext) {
    res.status(401).json({
      success: false,
      error: 'AUTHORIZATION_CONTEXT_MISSING',
      message: 'Authorization context is required.',
    });

    return null;
  }

  return req.authContext;
}

/* ============================================================
   Consent
   ============================================================ */

router.get(
  '/:id/consents',
  requirePermission('patients.read'),
  async (req: AuthRequest, res) => {
    const context = requireContext(req, res);
    if (!context) return;

    try {
      res.json({ success: true, ...(await listConsents(context, req.params.id)) });
    } catch (error) {
      if (sendError(res, error)) return;

      res.status(500).json({
        success: false,
        error: 'CONSENT_READ_FAILED',
        message: 'The consent record could not be read.',
      });
    }
  },
);

router.post(
  '/:id/consents',
  requirePermission('patients.update'),
  async (req: AuthRequest, res) => {
    const context = requireContext(req, res);
    if (!context) return;

    try {
      const consent = await grantConsent(context, req.params.id, req.body);

      res.status(201).json({ success: true, consent });
    } catch (error) {
      if (sendError(res, error)) return;

      res.status(500).json({
        success: false,
        error: 'CONSENT_WRITE_FAILED',
        message: 'The consent could not be recorded.',
      });
    }
  },
);

router.post(
  '/:id/consents/:consentId/revoke',
  requirePermission('patients.update'),
  async (req: AuthRequest, res) => {
    const context = requireContext(req, res);
    if (!context) return;

    try {
      const result = await revokeConsent(
        context,
        req.params.id,
        req.params.consentId,
        (req.body ?? {}).reason,
      );

      res.json({ success: true, ...result });
    } catch (error) {
      if (sendError(res, error)) return;

      res.status(500).json({
        success: false,
        error: 'CONSENT_REVOKE_FAILED',
        message: 'The consent could not be revoked.',
      });
    }
  },
);

/* ============================================================
   Allergies
   ============================================================ */

router.get(
  '/:id/allergies',
  requirePermission('clinical.read'),
  async (req: AuthRequest, res) => {
    const context = requireContext(req, res);
    if (!context) return;

    try {
      res.json({ success: true, ...(await listAllergies(context, req.params.id)) });
    } catch (error) {
      if (sendError(res, error)) return;

      res.status(500).json({
        success: false,
        error: 'ALLERGY_READ_FAILED',
        message: 'The allergy registry could not be read.',
      });
    }
  },
);

router.post(
  '/:id/allergies',
  requirePermission('clinical.create'),
  async (req: AuthRequest, res) => {
    const context = requireContext(req, res);
    if (!context) return;

    try {
      const allergy = await recordAllergy(context, req.params.id, req.body);

      res.status(201).json({ success: true, allergy });
    } catch (error) {
      if (sendError(res, error)) return;

      res.status(500).json({
        success: false,
        error: 'ALLERGY_WRITE_FAILED',
        message: 'The allergy could not be recorded.',
      });
    }
  },
);

router.patch(
  '/:id/allergies/:allergyId',
  requirePermission('clinical.update'),
  async (req: AuthRequest, res) => {
    const context = requireContext(req, res);
    if (!context) return;

    try {
      const allergy = await setAllergyStatus(
        context,
        req.params.id,
        req.params.allergyId,
        (req.body ?? {}).status,
      );

      res.json({ success: true, allergy });
    } catch (error) {
      if (sendError(res, error)) return;

      res.status(500).json({
        success: false,
        error: 'ALLERGY_UPDATE_FAILED',
        message: 'The allergy could not be updated.',
      });
    }
  },
);

/**
 * Ask before prescribing.
 *
 * Read-only. It records nothing, so a prescriber can check a name
 * without leaving a trace of a decision they have not made.
 */
router.post(
  '/:id/allergies/check',
  requirePermission('clinical.read'),
  async (req: AuthRequest, res) => {
    const context = requireContext(req, res);
    if (!context) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const raw = body.medications;

    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 25) {
      res.status(400).json({
        success: false,
        error: 'INVALID_MEDICATION_LIST',
        message: 'medications must be an array of 1 to 25 names.',
      });

      return;
    }

    if (!raw.every((item) => typeof item === 'string' && item.length <= 200)) {
      res.status(400).json({
        success: false,
        error: 'INVALID_MEDICATION_LIST',
        message: 'Every medication must be a string of at most 200 characters.',
      });

      return;
    }

    try {
      const result = await checkMedicationAllergies(
        context,
        req.params.id,
        raw as string[],
      );

      res.json({ success: true, ...result });
    } catch (error) {
      if (sendError(res, error)) return;

      res.status(500).json({
        success: false,
        error: 'ALLERGY_CHECK_FAILED',
        message: 'The allergy check could not be completed.',
      });
    }
  },
);

export default router;
