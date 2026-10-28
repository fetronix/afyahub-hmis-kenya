import { dhaLegacyGuard } from '../insurance/hub/guards.ts';
/**
 * The dha routes.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions. `src/routes/index.ts` mounts this router on the API router.
 */

import { type AuthRequest } from '../auth/auth.middleware.ts';
import {
  requireAnyPermission,
  requirePermission,
  requireSuperAdmin,
} from '../auth/authorization.middleware.ts';
import * as billing from '../billing/billing.service.ts';
import { buildReadinessReport } from '../integrations/dha/dha.readiness.ts';
import * as dha from '../integrations/dha/dha.service.ts';
import { handleDhaError } from './shared/errors.ts';
import { and } from 'drizzle-orm';
import { Router, type Response } from 'express';

const router = Router();
router.use('/api/integrations/dha', dhaLegacyGuard);

/*
 * =========================================================
 * DHA / AFYACONNECT INTEGRATION
 * =========================================================
 *
 * Only documented endpoints are called. The readiness report is the
 * single place to discover what is configured, what is missing and
 * what this build does not implement yet.
 */

/*
 * Superadmin only, like the screen that reads it. The report names
 * which DHA credentials are configured, which operations are missing
 * and what this build cannot call — configuration state, not clinical
 * data, but not something every facility role needs either.
 */
router.get(
  '/api/integrations/dha/readiness',
  requireSuperAdmin(),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      // A readiness page is not authorization for a live sandbox probe.
      const report = await buildReadinessReport({ probe: false });

      return res.json(report);
    } catch (err: unknown) {
      if (handleDhaError(err, res)) return;

      console.error('Failed to build DHA readiness report:', err);
      return res.status(500).json({
        success: false,
        error: 'DHA_READINESS_FAILED',
        message: 'Failed to build the integration readiness report.',
      });
    }
  },
);

router.get(
  '/api/integrations/dha/service-mappings',
  requireAnyPermission('tariffs.read', 'system.settings.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const result = await dha.listServiceMappingsScoped(
        req.authContext,
        typeof req.query.facilityId === 'string' ? req.query.facilityId : null,
      );

      return res.json(result);
    } catch (err: unknown) {
      if (handleDhaError(err, res)) return;

      console.error('Failed to load DHA service mappings:', err);
      return res.status(500).json({
        success: false,
        error: 'DHA_MAPPINGS_FAILED',
        message: 'Failed to load the service-area mapping.',
      });
    }
  },
);

router.put(
  '/api/integrations/dha/service-mappings',
  requireAnyPermission('tariffs.manage', 'system.settings.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const body = req.body ?? {};

      const saved = await dha.saveServiceMappingScoped(req.authContext, {
        serviceArea: body.serviceArea,
        interventionCode: body.interventionCode,
        accessPoint: body.accessPoint ?? null,
        paymentMechanism: body.paymentMechanism ?? null,
        fund: body.fund ?? null,
        needsPreauth: typeof body.needsPreauth === 'boolean' ? body.needsPreauth : null,
        notes: body.notes ?? null,
        facilityId: body.facilityId ?? null,
        userId: req.user?.id ?? null,
      });

      return res.json(saved);
    } catch (err: unknown) {
      if (handleDhaError(err, res)) return;

      console.error('Failed to save DHA service mapping:', err);
      return res.status(500).json({
        success: false,
        error: 'DHA_MAPPING_SAVE_FAILED',
        message: 'Failed to save the service-area mapping.',
      });
    }
  },
);

router.get(
  '/api/integrations/dha/invoices/:id/interventions',
  requireAnyPermission('insurance.read', 'billing.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const result = await dha.resolveInvoiceInterventionsScoped(
        req.authContext,
        req.params.id,
        typeof req.query.facilityId === 'string' ? req.query.facilityId : null,
      );

      return res.json(result);
    } catch (err: unknown) {
      if (handleDhaError(err, res)) return;

      console.error('Failed to resolve invoice interventions:', err);
      return res.status(500).json({
        success: false,
        error: 'DHA_INTERVENTIONS_FAILED',
        message: 'Failed to resolve interventions for this invoice.',
      });
    }
  },
);

router.get(
  '/api/integrations/dha/calls',
  requireAnyPermission('audit.security.read', 'system.settings.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const calls = await dha.listRecentCallsScoped(
        req.authContext,
        typeof req.query.facilityId === 'string' ? req.query.facilityId : null,
        Number(req.query.limit ?? 50),
      );

      return res.json(calls);
    } catch (err: unknown) {
      if (handleDhaError(err, res)) return;

      console.error('Failed to load DHA call log:', err);
      return res.status(500).json({
        success: false,
        error: 'DHA_CALLS_FAILED',
        message: 'Failed to load the integration call log.',
      });
    }
  },
);

router.post(
  '/api/integrations/dha/patients/:id/eligibility',
  requirePermission('patients.read'),
  requirePermission('insurance.sha.eligibility.check'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const result = await dha.checkEligibilityScoped(req.authContext, {
        patientId: req.params.id,
        facilityId: req.body?.facilityId ?? null,
        identificationType: req.body?.identificationType ?? null,
        identificationNumber: req.body?.identificationNumber ?? null,
      });

      return res.json(result);
    } catch (err: unknown) {
      if (handleDhaError(err, res)) return;

      console.error('Failed to check DHA eligibility:', err);
      return res.status(500).json({
        success: false,
        error: 'DHA_ELIGIBILITY_FAILED',
        message: 'Failed to check SHA eligibility.',
      });
    }
  },
);

router.get(
  '/api/integrations/dha/patients/:id/coverage',
  requirePermission('patients.read'),
  requirePermission('insurance.sha.benefits.validate'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const query = (name: string): string | null =>
        typeof req.query[name] === 'string' && String(req.query[name]).trim()
          ? String(req.query[name]).trim()
          : null;

      const facilityId = query('facilityId');
      const kind = query('kind') ?? 'benefits';

      const context = req.authContext;
      const patientId = req.params.id;

      switch (kind) {
        case 'benefits':
          return res.json(await dha.getBenefitsScoped(context, patientId, facilityId));

        case 'interventions':
          return res.json(
            await dha.getInterventionsScoped(
              context,
              patientId,
              {
                subBenefitCode: query('subBenefitCode'),
                code: query('code'),
                accessPoint: query('accessPoint'),
                search: query('search'),
              },
              facilityId,
            ),
          );

        case 'sub-benefits':
          return res.json(
            await dha.getSubBenefitsScoped(
              context,
              patientId,
              query('parentBenefitCode'),
              facilityId,
            ),
          );

        case 'utilization': {
          const interventionCode = query('interventionCode');

          if (!interventionCode) {
            return res.status(400).json({
              success: false,
              error: 'INTERVENTION_CODE_REQUIRED',
              message: 'interventionCode is required for a utilization balance.',
            });
          }

          return res.json(
            await dha.getUtilizationScoped(context, patientId, interventionCode, facilityId),
          );
        }

        case 'pomsf-balances':
          return res.json(
            await dha.getPomsfBalancesScoped(context, patientId, query('policyYear'), facilityId),
          );

        default:
          return res.status(400).json({
            success: false,
            error: 'INVALID_COVERAGE_KIND',
            message:
              'kind must be one of: benefits, interventions, sub-benefits, utilization, pomsf-balances.',
          });
      }
    } catch (err: unknown) {
      if (handleDhaError(err, res)) return;

      console.error('Failed to load DHA coverage:', err);
      return res.status(500).json({
        success: false,
        error: 'DHA_COVERAGE_FAILED',
        message: 'Failed to load SHA coverage.',
      });
    }
  },
);

export default router;
