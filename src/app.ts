import staffInvitationRoutes from './auth/staff-invitation.routes';
import staffRolesRoutes from './auth/staff-roles.routes';
import express, { type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import platformRoutes from './routes/platform.routes.ts';
import facilityModuleRoutes from './config/facility-modules.routes.ts';
import complianceRoutes from './compliance/compliance.routes.ts';
import portalRoutes from './portal/portal.routes.ts';
import portalAdminRoutes from './portal/portal-admin.routes.ts';
import clinicalRecordsRoutes from './clinical/clinical-records.routes.ts';
import { checkMedicationAllergies } from './clinical/allergy.service.ts';
import { logPatientAccess } from './clinical/access-log.service.ts';

import * as queries from './db/queries.ts';
import { db } from './db/index.ts';
import * as schema from './db/schema.ts';
import { and, count, eq, sql, sum } from 'drizzle-orm';
import { createSystemRouter } from './routes/system.routes.ts';

import { correlationIdFrom, moduleLogger } from './logging/logger.ts';
import authRoutes from './auth/auth.routes.ts';

import { requireAuth } from './middleware/auth.ts';
import { requireFacilityModule } from './middleware/facility-module.middleware.ts';
import {
  requireAuthorization,
  requirePermission,
  requireAnyPermission,
  requireSuperAdmin,
} from './auth/authorization.middleware.ts';
import type { AuthRequest } from './auth/auth.middleware.ts';
import { parseOptionalPositiveId, requireAuthContext } from './routes/shared/request.ts';
import inpatientRoutes from './routes/inpatient.routes.ts';
import maternalHealthRoutes from './routes/maternal-health.routes.ts';
import { chargeSafely } from './routes/shared/charges.ts';
import { handleInpatientError, handleScopeError } from './routes/shared/errors.ts';
import { ScopeAccessError, resolveFacilityScope } from './auth/scope.service.ts';

import * as billing from './billing/billing.service.ts';
import * as chargeAttempts from './billing/charge-attempts.ts';
import * as billingPayments from './billing/payments.service.ts';
import { chargeLabOrderBatch, radiologyChargeRequest } from './billing/service-charges.ts';
import { billingServiceKeys, isValidBillingKey } from './billing/tariff-codes.ts';
import { codesForFamily } from './billing/tariff-matching.ts';
import { CATALOGUE_SERVICE_TYPES, isCatalogueServiceType } from './billing/tariff-resolver.ts';
import * as insuranceClaims from './insurance/claims.service.ts';
import * as dha from './integrations/dha/dha.service.ts';
import { buildReadinessReport } from './integrations/dha/dha.readiness.ts';
import { DhaError } from './integrations/dha/dha.errors.ts';
import * as nursing from './nursing/nursing.service.ts';
import * as reporting from './reporting/reporting.service.ts';
import * as inventory from './inventory/inventory.service.ts';
import * as maternity from './maternity/maternity.service.ts';
import * as postnatal from './maternity/postnatal.service.ts';
import * as immunisation from './immunisation/immunisation.service.ts';

import {
  createApiRateLimiter,
  createAuthRateLimiter,
  createCorsMiddleware,
  createHelmetMiddleware,
} from './middleware/http-security.middleware.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.resolve(path.dirname(__filename), '..');

const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

/**
 * Where the built client lives.
 *
 * `src/app.ts` sits one level below the project root, and the bundle
 * (`build/server.js`) does too, so `..` is correct in both. STATIC_DIR
 * exists for cPanel layouts where the application root and the document
 * root differ; it is resolved against the process working directory.
 *
 * Absolute, never relative: cPanel's Passenger starts the process from a
 * directory that has nothing to do with the app, and relative paths then
 * resolve to a folder that does not contain dist/.
 */
const STATIC_DIR = process.env.STATIC_DIR
  ? path.resolve(process.cwd(), process.env.STATIC_DIR)
  : path.resolve(__dirname, 'dist');

/*
 * The application-wide logger. Structured, with credentials and patient
 * identity redacted at the logger rather than at each call site — a call
 * site that forgets is a leak, so the default has to be safe.
 */
const requestLog = moduleLogger('http');
const appLog = moduleLogger('app');

export async function createApp() {
  const app = express();

  /*
   * =========================================================
   * HTTP SECURITY
   * =========================================================
   *
   * Headers, origin allowlist and rate limits run before the body is
   * parsed, so a refused request costs nothing and never reaches a route.
   *
   * TRUST_PROXY must be set when the app sits behind a reverse proxy,
   * otherwise every request appears to come from the proxy address and a
   * single busy client would rate-limit the whole facility.
   */
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

  app.use(createHelmetMiddleware());
  app.use(createCorsMiddleware());

  /*
   * =========================================================
   * REQUEST LOGGING AND CORRELATION
   * =========================================================
   *
   * Every request gets one line on completion, and one correlation id that
   * every log statement inside it inherits.
   *
   * WHAT IS NOT LOGGED
   *
   * The query string is dropped. `GET /api/patients?nationalId=...` puts a
   * national identity number into a log file, and a log file is a copy of
   * patient data with none of the database's access control. The route path
   * is enough to see what happened; the parameters belong in the database
   * and in the audit trail, which has its own access rules.
   *
   * The body is never read. A discharge summary is a body.
   *
   * WHAT IS LOGGED
   *
   * method, path, status, duration, and the correlation id. That is enough
   * to answer "which requests got slower at 14:32" and "was there a burst
   * of 401s before this ticket" without storing anything about a patient.
   *
   * Health and readiness probes are not logged at info: an orchestrator
   * polls them every few seconds and would bury every other line.
   *
   * ORDER MATTERS AND THIS IS DELIBERATE. It runs before the rate limiters
   * and before `express.json()`, so that:
   *   - a rate-limited request is still logged (429s are worth seeing);
   *   - a malformed JSON body is still answered with a correlation id.
   * Placed after the body parser, a client sending bad JSON receives an
   * empty id and the operator has nothing to search for.
   */
  app.use((req, res, next) => {
    const correlationId = correlationIdFrom(req.headers['x-correlation-id']);
    const startedAt = process.hrtime.bigint();

    /* Echoed so a client (or a proxy log) can quote the id when reporting
     * a problem, which is how a support ticket becomes a log query. */
    res.setHeader('X-Correlation-Id', correlationId);

    const probe = req.path === '/api/health' || req.path === '/api/ready';

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

      requestLog[probe ? 'debug' : 'info'](
        {
          correlationId,
          method: req.method,
          /* `originalUrl.split('?')[0]` and not `req.path`: on a mounted
           * router they differ, and the mounted path is the useful one. */
          path: req.originalUrl.split('?')[0],
          status: res.statusCode,
          durationMs: Math.round(durationMs * 10) / 10,
          /* A failed request at warn level is what makes a 5xx alerting
           * rule possible without parsing messages. */
        },
        res.statusCode >= 500
          ? 'request.failed'
          : res.statusCode >= 400
            ? 'request.rejected'
            : 'request.completed',
      );
    });

    next();
  });

  /* Sign-in and invitation acceptance: counted on failures only. */
  app.use('/api/auth', createAuthRateLimiter());

  /* Everything else: a broad per-IP ceiling. */
  app.use('/api', createApiRateLimiter());

  /*
   * 1 MB is generous for this application (the largest body is a
   * claim or an invoice) and stops a single request from pinning the
   * process while it parses.
   */
  app.use(express.json({ limit: '1mb' }));

  /*
   * =========================================================
   * AUTHENTICATION ROUTES
   * =========================================================
   *
   * /api/auth/login
   *     Public
   *
   * /api/auth/session
   *     Protected internally by auth.routes.ts
   *
   * /api/auth/logout
   *     Protected internally by auth.routes.ts
   */
  app.use('/api/auth', authRoutes);

  /*
   * =========================================================
   * HEALTH AND READINESS
   * =========================================================
   *
   * Extracted to src/routes/system.routes.ts. Both stay PUBLIC, because a
   * load balancer and a container probe cannot authenticate. The paths are
   * unchanged: deployment health checks are already pointed at them.
   */
  app.use('/api', createSystemRouter());

  /*
   * =========================================================
   * AUTHENTICATED HMIS API
   * =========================================================
   *
   * IMPORTANT:
   *
   * Every API route registered AFTER this middleware requires
   * a valid authenticated session.
   *
   * Protected areas include:
   *
   * - Tenants
   * - Facilities
   * - Departments
   * - Patients
   * - Encounters
   * - Queues
   * - Appointments
   * - Observations
   * - Diagnoses
   * - Procedures
   * - Medications
   * - Wards
   * - Beds
   * - Admissions
   * - Theatre
   * - Laboratory
   * - Radiology
   * - Pharmacy
   * - Inventory
   * - Procurement
   * - Billing
   * - Claims
   * - Public Health
   * - Audit Logs
   * - Interoperability
   * - Analytics
   *
   * Authentication is NOT the same as authorization.
   *
   * The next security stage will add:
   *
   * - RBAC
   * - Permissions
   * - Tenant isolation
   * - Facility isolation
   */
  /*
   * Patient digital health record portal.
   *
   * Mounted BEFORE the staff gate below, and that order is the whole point:
   * a patient has no staff session. When these mounts sat under
   * `app.use('/api', requireAuth)`, `/api/portal/auth/activate` and
   * `/api/portal/auth/login` answered "Authentication is required." to the
   * patient holding a valid invitation — the link worked, the token was
   * good, and the door was bolted by a middleware the router never needed.
   *
   * `/api/portal` is the patient surface. Only activation and login are
   * public; every other route in that router carries `requirePortalAuth`,
   * which reads `patient_portal_sessions` and cannot accept a staff token.
   * `/api/portal/admin` is the staff surface and applies `requireAuth` and
   * `requirePermission` inside its own router, so moving it above this line
   * neither opens it nor duplicates the gate.
   */
  app.use('/api/portal/admin', portalAdminRoutes);
  app.use('/api/portal', portalRoutes);

  app.use('/api', requireAuth);
  app.use('/api', requireAuthorization);

  app.use('/api/platform', platformRoutes);
  app.use('/api/staff-invitations', staffInvitationRoutes);
  app.use('/api/staff-roles', staffRolesRoutes);

  /*
   * Facility module provisioning. Deliberately outside the
   * `requireFacilityModule` guards: this is the route that turns those
   * guards on and off, so it cannot depend on a module being enabled.
   */
  app.use('/api/facilities', facilityModuleRoutes);

  /*
   * DHA self-assessment. Read-only and compiled from the register, so the
   * figure cannot be edited in the browser or stored out of date.
   */
  app.use('/api/compliance', complianceRoutes);

  // Facility module enforcement. Keep platform administration, invitations,
  // tenants, and facility-context endpoints outside these operational guards.
  app.use('/api/patients', requireFacilityModule('registration'));

  /*
   * Consent and allergy records live under the patient they belong to.
   * Mounted after the module guard, so a facility without registration
   * enabled cannot reach them either.
   */
  app.use('/api/patients', clinicalRecordsRoutes);
  app.use('/api/appointments', requireFacilityModule('reception'));
  app.use('/api/queues', requireFacilityModule('reception'));

  app.use('/api/encounters', requireFacilityModule('opd'));
  app.use('/api/observations', requireFacilityModule('opd'));
  app.use('/api/diagnoses', requireFacilityModule('opd'));
  app.use('/api/procedures', requireFacilityModule('opd'));

  app.use('/api/maternity', requireFacilityModule('maternity'));

  /*
   * Immunisation rides on the maternity module on purpose: in Kenya the
   * doses are given in the MCH clinic, on the same visit as the mother's
   * postnatal check. A second module switch would let a facility open the
   * child register while the mother's record stayed closed.
   */
  app.use('/api/immunisation', requireFacilityModule('maternity'));

  app.use('/api/wards', requireFacilityModule('inpatient'));
  app.use('/api/beds', requireFacilityModule('inpatient'));
  app.use('/api/admissions', requireFacilityModule('inpatient'));
  app.use('/api/inpatient', requireFacilityModule('inpatient'));
  app.use('/api/nursing-notes', requireFacilityModule('inpatient'));
  app.use('/api/theatre-cases', requireFacilityModule('theatre'));

  app.use('/api/lab-tests', requireFacilityModule('laboratory'));
  app.use('/api/lab-orders', requireFacilityModule('laboratory'));
  app.use('/api/lab-results', requireFacilityModule('laboratory'));
  app.use('/api/radiology-orders', requireFacilityModule('radiology'));

  app.get('/api/medications', requireFacilityModule('pharmacy'));
  app.post('/api/medications', requireFacilityModule('opd'));
  app.put('/api/medications/:id/status', requireFacilityModule('pharmacy'));
  app.use('/api/pharmacy', requireFacilityModule('pharmacy'));
  app.use('/api/inventory', requireFacilityModule('inventory'));

  app.use('/api/suppliers', requireFacilityModule('procurement'));
  app.use('/api/purchase-orders', requireFacilityModule('procurement'));

  app.use('/api/claims', requireFacilityModule('insurance'));
  app.use('/api/integrations', requireFacilityModule('interoperability'));
  app.use('/api/public-health', requireFacilityModule('public_health'));
  app.use('/api/analytics', requireFacilityModule('analytics'));
  app.use('/api/reporting', requireFacilityModule('analytics'));
  app.use('/api/interoperability', requireFacilityModule('interoperability'));
  app.use('/api/audit-logs', requireFacilityModule('audit'));

  /* Scope failures become 403 (or 400 for a missing facility); see
     ./routes/shared/errors.ts. */

  /**
   * Resolve the one facility a request is allowed to touch.
   *
   * The older operational routes accepted `facilityId` from the query
   * string or the body and passed it straight to a query. When it was
   * absent, the query returned every facility's rows; when it pointed
   * somewhere else, the request read or wrote another facility. This
   * helper closes both directions: the id is checked against the
   * authenticated scope, and the database row is re-read through the
   * scoped query before anything is returned.
   *
   * Returns null after writing the response when the request must stop.
   */
  const requireScopedFacility = async (
    req: AuthRequest,
    res: Response,
    rawFacilityId: unknown,
  ): Promise<{ id: number; tenantId: number } | null> => {
    const context = req.authContext;

    if (!context) {
      res.status(401).json({
        success: false,
        error: 'AUTHORIZATION_CONTEXT_MISSING',
        message: 'Authorization context is required.',
      });

      return null;
    }

    const isEmpty = rawFacilityId === undefined || rawFacilityId === null || rawFacilityId === '';

    const parsed = isEmpty ? undefined : Number(rawFacilityId);

    if (parsed !== undefined && (!Number.isSafeInteger(parsed) || parsed <= 0)) {
      res.status(400).json({
        success: false,
        error: 'INVALID_FACILITY_ID',
        message: 'facilityId must be a positive integer.',
      });

      return null;
    }

    try {
      const facilityId = resolveFacilityScope(context, parsed);

      const facility = await queries.getFacilityByIdScoped(context, facilityId);

      if (!facility) {
        res.status(404).json({
          success: false,
          error: 'FACILITY_NOT_FOUND',
          message: 'The requested facility was not found.',
        });

        return null;
      }

      return { id: facility.id, tenantId: facility.tenantId };
    } catch (error) {
      if (!handleScopeError(error, res)) {
        res.status(500).json({
          success: false,
          error: 'FACILITY_SCOPE_RESOLUTION_FAILED',
          message: 'The facility scope could not be resolved.',
        });
      }

      return null;
    }
  };

  /**
   * Maps DHA integration failures onto their intended HTTP status.
   *
   * A missing configuration is a 503, not a 500: nothing is broken, the
   * facility simply has not been onboarded yet, and the message says
   * exactly what is missing.
   */
  const handleDhaError = (error: unknown, res: Response): boolean => {
    if (handleScopeError(error, res)) return true;

    if (error instanceof DhaError) {
      const status =
        error.code === 'NOT_CONFIGURED' || error.code === 'PRODUCTION_BLOCKED'
          ? 503
          : error.code === 'UNAUTHORIZED' || error.code === 'AUTH_FAILED'
            ? 502
            : error.code === 'FORBIDDEN'
              ? 403
              : error.code === 'NOT_FOUND'
                ? 404
                : error.code === 'VALIDATION_FAILED'
                  ? 400
                  : error.code === 'RATE_LIMITED'
                    ? 429
                    : 502;

      res.status(status).json({
        success: false,
        error: error.code,
        message: error.message,
        operation: error.operation,
      });

      return true;
    }

    return false;
  };

  /**
   * Maps claims workflow failures onto their intended HTTP status.
   *
   * A duplicate open claim is a 409, not a 500: the record already
   * exists and the clerk needs to be told which one.
   */
  const handleClaimError = (error: unknown, res: Response): boolean => {
    if (handleScopeError(error, res)) return true;

    if (error instanceof insuranceClaims.ClaimDomainError) {
      res.status(error.status).json({
        success: false,
        error: error.code,
        message: error.message,
        ...(Object.keys(error.detail).length > 0 ? { detail: error.detail } : {}),
      });

      return true;
    }

    return false;
  };

  /**
   * Maps payment settlement failures onto their intended HTTP status.
   *
   * A duplicate M-Pesa code is a 409, not a 500: the record already
   * exists and the clerk needs to know that, not to see a stack trace.
   */
  const handlePaymentError = (error: unknown, res: Response): boolean => {
    if (handleScopeError(error, res)) return true;

    if (error instanceof billingPayments.PaymentDomainError) {
      res.status(error.status).json({
        success: false,
        error: error.code,
        message: error.message,
        ...(Object.keys(error.detail).length > 0 ? { detail: error.detail } : {}),
      });

      return true;
    }

    return false;
  };

  /**
   * Maps inpatient domain failures onto their intended HTTP status.
   *
   *   400 invalid input
   *   403 tenant/facility scope violation (delegated to handleScopeError)
   *   404 record not found inside the authorised scope
   *   409 conflict with current state (occupied bed, closed admission)
   *
   * Returns false for unexpected errors so the caller keeps HTTP 500.
   */
  /**
   * Maps pharmacy stock failures onto their intended HTTP status.
   *
   *   400 invalid input or an already-expired batch
   *   404 item or patient not found inside the authorised scope
   *   409 insufficient unexpired stock
   *
   * Returns false for unexpected errors so the caller keeps HTTP 500.
   */
  const handleInventoryError = (error: unknown, res: Response): boolean => {
    if (handleScopeError(error, res)) return true;

    if (error instanceof inventory.InventoryDomainError) {
      res.status(error.status).json({
        success: false,
        error: error.code,
        message: error.message,
        ...(error.detail ? { detail: error.detail } : {}),
      });

      return true;
    }

    return false;
  };

  /**
   * Post a charge without ever letting billing break clinical care.
   *
   * A missing tariff, a closed invoice or a duplicate key must not stop
   * a clinician from ordering a test or admitting a patient. Faults are
   * logged and returned to the caller so the UI can surface them, while
   * the clinical action still succeeds.
   */
  /**
   * Maps known encounter input-validation errors to HTTP 400.
   * Unexpected errors must remain HTTP 500.
   */
  const handleEncounterValidationError = (error: unknown, res: Response): boolean => {
    if (!(error instanceof Error)) {
      return false;
    }

    const validationMessages = new Set([
      'A valid patient ID is required.',
      'Patient not found.',
      'Invalid practitioner ID.',
      'Invalid department ID.',
      'Invalid encounter ID.',
      'Changing the patient on an existing encounter is not allowed. Use the authorized patient-correction workflow.',
    ]);

    if (!validationMessages.has(error.message)) {
      return false;
    }

    const errorCodeByMessage: Record<string, string> = {
      'A valid patient ID is required.': 'INVALID_PATIENT_ID',
      'Patient not found.': 'PATIENT_NOT_FOUND',
      'Invalid practitioner ID.': 'INVALID_PRACTITIONER_ID',
      'Invalid department ID.': 'INVALID_DEPARTMENT_ID',
      'Invalid encounter ID.': 'INVALID_ENCOUNTER_ID',
      'Changing the patient on an existing encounter is not allowed. Use the authorized patient-correction workflow.':
        'PATIENT_REASSIGNMENT_NOT_ALLOWED',
    };

    res.status(400).json({
      success: false,
      error: errorCodeByMessage[error.message],
      message: error.message,
    });

    return true;
  };

  // =========================================================
  // TENANTS & FACILITIES
  // =========================================================

  app.get('/api/tenants', async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const list = await queries.getTenantsScoped(req.authContext);

      res.json(list);
    } catch (err: any) {
      if (handleScopeError(err, res)) {
        return;
      }

      res.status(500).json({
        error: err.message || 'Failed to fetch tenants',
      });
    }
  });

  app.get('/api/tenants/:id', async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const tenantId = Number(req.params.id);

      if (!Number.isInteger(tenantId) || tenantId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_TENANT_ID',
          message: 'Invalid tenant ID.',
        });
      }

      const tenant = await queries.getTenantByIdScoped(req.authContext, tenantId);

      if (!tenant) {
        return res.status(404).json({
          error: 'Tenant not found',
        });
      }

      res.json(tenant);
    } catch (err: any) {
      if (handleScopeError(err, res)) {
        return;
      }

      res.status(500).json({
        error: err.message || 'Failed to fetch tenant',
      });
    }
  });

  app.get('/api/facilities', async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const tenantId = req.query.tenantId !== undefined ? Number(req.query.tenantId) : undefined;

      if (tenantId !== undefined && (!Number.isInteger(tenantId) || tenantId <= 0)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_TENANT_ID',
          message: 'Invalid tenant ID.',
        });
      }

      const list = await queries.getFacilitiesScoped(req.authContext, tenantId);

      res.json(list);
    } catch (err: any) {
      if (handleScopeError(err, res)) {
        return;
      }

      res.status(500).json({
        error: err.message || 'Failed to fetch facilities',
      });
    }
  });

  app.get('/api/facilities/:id', async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const facilityId = Number(req.params.id);

      if (!Number.isInteger(facilityId) || facilityId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_FACILITY_ID',
          message: 'Invalid facility ID.',
        });
      }

      const facility = await queries.getFacilityByIdScoped(req.authContext, facilityId);

      if (!facility) {
        return res.status(404).json({
          error: 'Facility not found',
        });
      }

      res.json(facility);
    } catch (err: any) {
      if (handleScopeError(err, res)) {
        return;
      }

      res.status(500).json({
        error: err.message || 'Failed to fetch facility',
      });
    }
  });

  app.get(
    '/api/departments',
    requirePermission('patients.read'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
          });
        }

        const facilityId = req.query.facilityId ? Number(req.query.facilityId) : undefined;

        if (facilityId !== undefined && (!Number.isInteger(facilityId) || facilityId <= 0)) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_FACILITY_ID',
          });
        }

        const list = await queries.getDepartmentsScoped(req.authContext, facilityId);

        return res.json(list);
      } catch (err: any) {
        if (handleScopeError(err, res)) return;

        res.status(500).json({
          error: err.message,
        });
      }
    },
  );

  // =========================================================
  // PATIENT MANAGEMENT
  // =========================================================

  app.get(
    '/api/patients',
    requirePermission('patients.read'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
          });
        }

        const tenantId = req.query.tenantId !== undefined ? Number(req.query.tenantId) : undefined;

        const facilityId =
          req.query.facilityId !== undefined ? Number(req.query.facilityId) : undefined;

        if (
          (tenantId !== undefined && (!Number.isInteger(tenantId) || tenantId <= 0)) ||
          (facilityId !== undefined && (!Number.isInteger(facilityId) || facilityId <= 0))
        ) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_SCOPE_ID',
            message: 'Invalid tenant or facility ID.',
          });
        }

        const list = await queries.getPatientsScoped(
          req.authContext,
          tenantId,
          facilityId,
          typeof req.query.search === 'string' ? req.query.search : undefined,
        );

        return res.json(list);
      } catch (err: unknown) {
        if (handleScopeError(err, res)) return;

        console.error('Patient list error:', err);
        return res.status(500).json({
          success: false,
          error: 'PATIENT_LIST_FAILED',
        });
      }
    },
  );

  app.get(
    '/api/patients/:id',
    requirePermission('patients.read'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
          });
        }

        const patientId = Number(req.params.id);

        if (!Number.isInteger(patientId) || patientId <= 0) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_PATIENT_ID',
          });
        }

        const patient = await queries.getPatientByIdScoped(req.authContext, patientId);

        if (!patient) {
          return res.status(404).json({
            success: false,
            error: 'PATIENT_NOT_FOUND',
            message: 'Patient not found.',
          });
        }

        /*
         * Every read of a patient record is accounted for. The insert
         * happens before the response is written: if the log cannot be
         * written the request fails, because an unaccountable read of
         * identifiable health data is the thing the DPA prohibits.
         */
        await logPatientAccess({
          context: req.authContext,
          patientId: patient.id,
          tenantId: patient.tenantId,
          facilityId: patient.registrationFacilityId,
          action: 'VIEW',
          purpose: 'DIRECT_CARE',
          recordType: 'Patient',
          request: {
            ipAddress: req.ip ?? null,
            userAgent: req.get('user-agent') ?? null,
          },
        });

        return res.json(patient);
      } catch (err: unknown) {
        if (handleScopeError(err, res)) return;

        console.error('Patient retrieval error:', err);
        return res.status(500).json({
          success: false,
          error: 'PATIENT_RETRIEVAL_FAILED',
        });
      }
    },
  );

  app.post(
    '/api/patients',
    requirePermission('patients.create'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
          });
        }

        const patient = await queries.createPatientScoped(req.authContext, req.body);

        await queries.logAuditEvent(
          patient.tenantId,
          patient.registrationFacilityId,
          String(req.authContext.userId),
          'CREATE',
          'Patient',
          String(patient.id),
          'Patient registered',
        );

        return res.status(201).json(patient);
      } catch (err: unknown) {
        if (handleScopeError(err, res)) return;

        if (err instanceof queries.PatientMrnConflictError) {
          return res.status(409).json({
            success: false,
            error: err.code,
            message: err.message,
          });
        }

        console.error('Patient creation error:', err);
        return res.status(500).json({
          success: false,
          error: 'PATIENT_CREATION_FAILED',
        });
      }
    },
  );

  app.put(
    '/api/patients/:id',
    requirePermission('patients.update'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
          });
        }

        const patientId = Number(req.params.id);

        if (!Number.isInteger(patientId) || patientId <= 0) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_PATIENT_ID',
          });
        }

        const patient = await queries.updatePatientScoped(req.authContext, patientId, req.body);

        if (!patient) {
          return res.status(404).json({
            success: false,
            error: 'PATIENT_NOT_FOUND',
            message: 'Patient not found.',
          });
        }

        /*
         * This route previously wrote an access row marked
         * EXPORT / FHIR / "FHIR patient resource retrieval" — on a staff
         * edit. The row was wrong twice over: wrong action, wrong
         * channel, and it meant the real FHIR endpoint logged nothing.
         * It is now a correct UPDATE row, and the FHIR route logs its
         * own read.
         */
        await logPatientAccess({
          context: req.authContext,
          patientId: patient.id,
          tenantId: patient.tenantId,
          facilityId: patient.registrationFacilityId,
          action: 'UPDATE',
          purpose: 'DIRECT_CARE',
          recordType: 'Patient',
          request: {
            ipAddress: req.ip ?? null,
            userAgent: req.get('user-agent') ?? null,
          },
        });

        await queries.logAuditEvent(
          patient.tenantId,
          patient.registrationFacilityId,
          String(req.authContext.userId),
          'UPDATE',
          'Patient',
          String(patient.id),
          'Patient record updated',
        );

        return res.json(patient);
      } catch (err: unknown) {
        if (handleScopeError(err, res)) return;

        console.error('Patient update error:', err);
        return res.status(500).json({
          success: false,
          error: 'PATIENT_UPDATE_FAILED',
        });
      }
    },
  );

  // =========================================================
  // CLINICAL ENCOUNTERS
  // =========================================================

  app.get(
    '/api/encounters',
    requirePermission('clinical.read'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
          });
        }

        const patientId =
          req.query.patientId === undefined ? undefined : Number(req.query.patientId);
        const facilityId =
          req.query.facilityId === undefined ? undefined : Number(req.query.facilityId);

        if (patientId !== undefined && (!Number.isSafeInteger(patientId) || patientId <= 0)) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_PATIENT_ID',
          });
        }

        if (facilityId !== undefined && (!Number.isSafeInteger(facilityId) || facilityId <= 0)) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_FACILITY_ID',
          });
        }

        const list = await queries.getEncountersScoped(req.authContext, patientId, facilityId);

        return res.json(list);
      } catch (err: unknown) {
        if (handleScopeError(err, res)) return;
        if (handleEncounterValidationError(err, res)) return;
        console.error('Encounter list error:', err);
        return res.status(500).json({
          success: false,
          error: 'ENCOUNTERS_LIST_FAILED',
        });
      }
    },
  );

  app.post(
    '/api/encounters',
    requirePermission('clinical.create'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
          });
        }

        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_ENCOUNTER_BODY',
          });
        }

        const encounter = await queries.createEncounterScoped(req.authContext, req.body);

        /*
         * Consultation fee.
         *
         * Inpatient encounters are billed through the admission and the
         * daily bed charges instead, so they do not raise a consultation.
         */
        let charge: billing.ChargeResult | null = null;

        if (encounter && encounter.encounterType !== 'INPATIENT') {
          charge = await chargeSafely({
            tenantId: encounter.tenantId,
            facilityId: encounter.facilityId,
            patientId: encounter.patientId,
            encounterId: encounter.id,
            codes: codesForFamily({
              family: 'CONSULTATION',
              encounterType: encounter.encounterType,
            }),
            /*
             * A facility that numbered its price list (OPD-001) links that
             * row to CONSULTATION on the tariff screen; without the link
             * the engine can only guess, and between a 150 consultation and
             * a 300 follow-up a guess is a wrong charge.
             */
            serviceKeys: billingServiceKeys('CONSULTATION', [encounter.encounterType]),
            /*
             * Naming the service lets the engine read the facility's own
             * description when neither a link nor a code matches. It only
             * accepts a tariff that says it is this service, inside the
             * OPD family of departments, and only when exactly one does —
             * OPD-001 (General outpatient consultation, 150) wins while
             * OPD-002 (Follow-up consultation, 300) does not match at all.
             */
            family: 'CONSULTATION',
            serviceName: null,
            encounterType: encounter.encounterType,
            sourceType: 'CONSULTATION',
            sourceId: encounter.id,
            itemType: 'Consultation',
            description: 'Clinical consultation',
          });
        }

        return res.status(201).json({
          ...encounter,
          billing: charge,
        });
      } catch (err: unknown) {
        if (handleScopeError(err, res)) return;
        if (handleEncounterValidationError(err, res)) return;
        console.error('Encounter creation error:', err);
        return res.status(500).json({
          success: false,
          error: 'ENCOUNTER_CREATION_FAILED',
        });
      }
    },
  );

  app.put(
    '/api/encounters/:id',
    requirePermission('clinical.update'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
          });
        }

        const encounterId = Number(req.params.id);

        if (!Number.isSafeInteger(encounterId) || encounterId <= 0) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_ENCOUNTER_ID',
          });
        }

        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_ENCOUNTER_BODY',
          });
        }

        const encounter = await queries.updateEncounterScoped(
          req.authContext,
          encounterId,
          req.body,
        );

        if (!encounter) {
          return res.status(404).json({
            success: false,
            error: 'ENCOUNTER_NOT_FOUND',
          });
        }

        return res.json(encounter);
      } catch (err: unknown) {
        if (handleScopeError(err, res)) return;
        if (handleEncounterValidationError(err, res)) return;
        console.error('Encounter update error:', err);
        return res.status(500).json({
          success: false,
          error: 'ENCOUNTER_UPDATE_FAILED',
        });
      }
    },
  );

  // =========================================================
  // QUEUES
  // =========================================================

  app.get('/api/queues', requirePermission('appointments.read'), async (req, res) => {
    try {
      const facilityId = req.query.facilityId ? Number(req.query.facilityId) : undefined;

      const queueType = req.query.queueType as string;

      const list = await queries.getQueues(facilityId, queueType);

      res.json(list);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.post(
    '/api/queues',
    requirePermission('appointments.create'),
    async (req: AuthRequest, res: Response) => {
      if (!req.authContext) {
        return res.status(401).json({ error: 'Authentication context is required.' });
      }

      try {
        const item = await queries.createQueueEntry(req.authContext, req.body);

        res.status(201).json(item);
      } catch (err: any) {
        res.status(500).json({
          error: err.message,
        });
      }
    },
  );

  app.put(
    '/api/queues/:id/status',
    requirePermission('appointments.update'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const { status } = req.body ?? {};

        const updated = await queries.updateQueueStatusScoped(
          context,
          Number(req.params.id),
          String(status ?? ''),
        );

        if (!updated) {
          return res.status(404).json({
            success: false,
            error: 'QUEUE_TOKEN_NOT_FOUND',
          });
        }

        res.json(updated);
      } catch (err: any) {
        const message = err?.message ?? 'Failed to update queue status.';
        const clientError =
          message === 'Invalid queue status.' || message === 'A valid queue token is required.';

        res.status(clientError ? 400 : 500).json({
          error: message,
        });
      }
    },
  );

  // =========================================================
  // APPOINTMENTS
  // =========================================================

  app.get('/api/appointments', requirePermission('appointments.read'), async (req, res) => {
    try {
      const facilityId = req.query.facilityId ? Number(req.query.facilityId) : undefined;

      const list = await queries.getAppointments(facilityId);

      res.json(list);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.post('/api/appointments', requirePermission('appointments.create'), async (req, res) => {
    try {
      const appt = await queries.createAppointment(req.body);

      res.status(201).json(appt);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  // =========================================================
  // VITALS & OBSERVATIONS
  // =========================================================

  app.get(
    '/api/observations',
    requirePermission('clinical.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const list = await nursing.getObservationsScoped(context, {
          patientId: req.query.patientId ? Number(req.query.patientId) : undefined,
          encounterId: req.query.encounterId ? Number(req.query.encounterId) : undefined,
        });

        res.json(list);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Observation list error:', err);
        res.status(500).json({
          success: false,
          error: 'OBSERVATIONS_FETCH_FAILED',
        });
      }
    },
  );

  /**
   * Record ward or clinic vitals.
   *
   * Inpatient vitals are recorded against an admission, which guarantees
   * the patient is actually in a bed at this facility. A bare patient
   * payload is no longer accepted: observations carry no facility column,
   * so unscoped writes were a cross-tenant hole.
   */
  app.post(
    '/api/observations',
    requirePermission('clinical.create'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const admissionId = Number(req.body?.admissionId);
        const encounterId = Number(req.body?.encounterId);

        const recordedBy =
          typeof req.body?.recordedBy === 'string'
            ? req.body.recordedBy
            : (req.user?.fullName ?? null);

        /*
         * Ward vitals attach to an admission; OPD/triage vitals attach to
         * an encounter. Both paths resolve the patient from a scoped
         * record, so a bare patientId can no longer be written to.
         */
        const observation =
          Number.isSafeInteger(admissionId) && admissionId > 0
            ? await nursing.recordVitalsScoped(context, {
                ...req.body,
                admissionId,
                recordedBy,
              })
            : Number.isSafeInteger(encounterId) && encounterId > 0
              ? await nursing.recordObservationForEncounterScoped(context, {
                  ...req.body,
                  encounterId,
                  recordedBy,
                })
              : null;

        if (!observation) {
          return res.status(400).json({
            success: false,
            error: 'ADMISSION_OR_ENCOUNTER_REQUIRED',
            message: 'Record vitals against an admission or an encounter at this facility.',
          });
        }

        await queries.logAuditEvent(
          context.tenantId,
          context.facilityId,
          String(context.userId),
          'CREATE',
          'Observation',
          String(observation.id ?? ''),
          Number.isSafeInteger(admissionId) && admissionId > 0
            ? `Vitals recorded for admission ${admissionId}`
            : `Vitals recorded for encounter ${encounterId}`,
        );

        res.status(201).json(observation);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Observation creation error:', err);
        res.status(500).json({
          success: false,
          error: 'OBSERVATION_CREATION_FAILED',
        });
      }
    },
  );

  /*
   * MATERNITY / MCH and IMMUNISATION now live in
   * ./routes/maternal-health.routes.ts. Mounted at the same '/api'
   * prefix, at the same point in the middleware chain, so route order
   * relative to everything else is unchanged. The module gate for both
   * is the `requireFacilityModule('maternity')` mount above.
   */
  app.use('/api', maternalHealthRoutes);

  // =========================================================
  // DIAGNOSES & PROCEDURES
  // =========================================================

  app.get(
    '/api/diagnoses',
    requirePermission('clinical.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const encounterId = parseOptionalPositiveId(req.query.encounterId, 'encounterId');
        const patientId = parseOptionalPositiveId(req.query.patientId, 'patientId');

        /*
         * Scoped: no filter is refused rather than answered with every
         * diagnosis in the database.
         */
        const list = await queries.getDiagnosesScoped(context, {
          encounterId,
          patientId,
        });

        res.json(list);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Diagnosis list error:', err);
        res.status(500).json({
          success: false,
          error: 'DIAGNOSIS_LIST_FAILED',
        });
      }
    },
  );

  app.post(
    '/api/diagnoses',
    requirePermission('clinical.create'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        /*
         * The encounter decides the patient, not the request body. A caller
         * cannot file a diagnosis against another facility's encounter.
         */
        const diag = await queries.recordDiagnosisScoped(context, req.body);

        res.status(201).json(diag);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Diagnosis creation error:', err);
        res.status(500).json({
          success: false,
          error: 'DIAGNOSIS_CREATE_FAILED',
        });
      }
    },
  );

  app.get(
    '/api/procedures',
    requirePermission('clinical.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const encounterId = parseOptionalPositiveId(req.query.encounterId, 'encounterId');
        const patientId = parseOptionalPositiveId(req.query.patientId, 'patientId');

        const list = await queries.getProceduresScoped(context, {
          encounterId,
          patientId,
        });

        res.json(list);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Procedure list error:', err);
        res.status(500).json({
          success: false,
          error: 'PROCEDURE_LIST_FAILED',
        });
      }
    },
  );

  app.post(
    '/api/procedures',
    requirePermission('clinical.create'),
    async (req: AuthRequest, res) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const proc = await queries.recordProcedureScoped(context, req.body);

        let charge: billing.ChargeResult | null = null;

        if (proc && req.authContext) {
          charge = await chargeSafely({
            tenantId: req.authContext.tenantId ?? 0,
            facilityId: req.authContext.facilityId ?? 0,
            patientId: (proc as { patientId?: number }).patientId ?? 0,
            encounterId: (proc as { encounterId?: number }).encounterId ?? null,
            /*
             * The procedure's own code first (PROC-004), then the
             * name-derived code (PROC-WOUND-DRESSING), then the generic
             * fallbacks — the same order laboratory orders use.
             */
            codes: codesForFamily({
              family: 'PROCEDURE',
              code: (proc as { procedureCode?: string }).procedureCode ?? null,
              name: (proc as { procedureName?: string }).procedureName ?? null,
            }),
            serviceKeys: billingServiceKeys('PROCEDURE', [
              (proc as { procedureCode?: string }).procedureCode ?? null,
              (proc as { procedureName?: string }).procedureName ?? null,
            ]),
            family: 'PROCEDURE',
            serviceName: (proc as { procedureName?: string }).procedureName ?? null,
            sourceType: 'PROCEDURE',
            sourceId: (proc as { id?: number }).id ?? 0,
            itemType: 'Procedure',
            description: (proc as { procedureName?: string }).procedureName,
          });
        }

        res.status(201).json({ ...proc, billing: charge });
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Procedure creation error:', err);
        res.status(500).json({
          success: false,
          error: 'PROCEDURE_CREATE_FAILED',
        });
      }
    },
  );

  // =========================================================
  // MEDICATIONS & PRESCRIPTIONS
  // =========================================================

  app.get('/api/medications', requirePermission('pharmacy.read'), async (req, res) => {
    try {
      const encounterId = req.query.encounterId ? Number(req.query.encounterId) : undefined;

      const patientId = req.query.patientId ? Number(req.query.patientId) : undefined;

      const list = await queries.getMedications(encounterId, patientId);

      res.json(list);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.post(
    '/api/medications',
    requirePermission('clinical.create'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
          });
        }

        const body = (req.body ?? {}) as Record<string, unknown>;

        /*
         * The allergy check runs before the prescription is written.
         *
         * It does not block care: a hard stop on a name match would
         * refuse a documented tolerance or a deliberate desensitisation,
         * and clinicians learn to click through hard stops. Instead the
         * prescriber is shown what the registry holds and must
         * acknowledge it explicitly. The acknowledgement goes into the
         * audit trail.
         */
        const patientId = Number(body.patientId);
        const drugName = typeof body.drugName === 'string' ? body.drugName.trim() : '';

        if (Number.isSafeInteger(patientId) && patientId > 0 && drugName !== '') {
          const check = await checkMedicationAllergies(req.authContext, patientId, [drugName]);

          if (check.warnings.length > 0) {
            const acknowledged = body.allergyAcknowledged === true;

            if (!acknowledged) {
              return res.status(409).json({
                success: false,
                error: 'ALLERGY_CONFLICT',
                message:
                  'This patient has a recorded allergy that matches this medication. Confirm to prescribe anyway.',
                warnings: check.warnings,
                disclaimer: check.disclaimer,
                detail: {
                  warnings: check.warnings,
                  disclaimer: check.disclaimer,
                },
              });
            }

            await queries.logAuditEvent(
              req.authContext.tenantId,
              req.authContext.facilityId,
              String(req.authContext.userId),
              'PRESCRIBE',
              'Medication',
              null,
              `Allergy warning overridden for ${drugName}: ${check.warnings
                .map((warning) => warning.allergen)
                .join(', ')}`,
            );
          }
        }

        const { allergyAcknowledged: _acknowledged, ...payload } = body;

        const med = await queries.createMedication(
          payload as Parameters<typeof queries.createMedication>[0],
        );

        res.status(201).json(med);
      } catch (err: any) {
        if (handleScopeError(err, res)) return;

        res.status(500).json({
          error: err.message,
        });
      }
    },
  );

  app.put(
    '/api/medications/:id/status',
    requirePermission('pharmacy.dispense'),
    async (req, res) => {
      try {
        const { status } = req.body;

        const med = await queries.updateMedicationStatus(Number(req.params.id), status);

        res.json(med);
      } catch (err: any) {
        res.status(500).json({
          error: err.message,
        });
      }
    },
  );

  /*
   * INPATIENT (wards, beds, admissions, nursing notes) now lives in
   * ./routes/inpatient.routes.ts, mounted at the same '/api' prefix and at
   * the same point in the chain. The module gate is the
   * `requireFacilityModule('inpatient')` mounts above.
   */
  app.use('/api', inpatientRoutes);

  // =========================================================
  // THEATRE CASES
  // =========================================================

  app.get(
    '/api/theatre-cases',
    requireAnyPermission('clinical.read', 'inpatient.read'),
    async (req: AuthRequest, res: Response) => {
      const facility = await requireScopedFacility(req, res, req.query.facilityId);

      if (!facility) return;

      try {
        const list = await queries.getTheatreCases(facility.id);

        res.json(list);
      } catch (err: any) {
        res.status(500).json({
          error: err.message,
        });
      }
    },
  );

  app.post(
    '/api/theatre-cases',
    requirePermission('clinical.create'),
    async (req: AuthRequest, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;

      const facility = await requireScopedFacility(
        req,
        res,
        body.facilityId ?? req.query.facilityId,
      );

      if (!facility) return;

      try {
        /*
         * Required columns are enforced by the table, and the two
         * identifiers are taken from the resolved facility rather than
         * from the payload, so the record cannot be filed elsewhere.
         */
        const payload = {
          ...body,
          facilityId: facility.id,
          tenantId: facility.tenantId,
        } as Parameters<typeof queries.createTheatreCase>[0];

        const tc = await queries.createTheatreCase(payload);

        res.status(201).json(tc);
      } catch (err: any) {
        res.status(500).json({
          error: err.message,
        });
      }
    },
  );

  app.put(
    '/api/theatre-cases/:id',
    requirePermission('clinical.update'),
    async (req: AuthRequest, res: Response) => {
      const caseId = Number(req.params.id);

      if (!Number.isSafeInteger(caseId) || caseId <= 0) {
        res.status(400).json({
          success: false,
          error: 'INVALID_THEATRE_CASE_ID',
        });

        return;
      }

      const facility = await requireScopedFacility(
        req,
        res,
        req.query.facilityId ?? (req.body ?? {}).facilityId,
      );

      if (!facility) return;

      try {
        const existing = await queries.getTheatreCaseScoped(caseId, facility.id);

        if (!existing) {
          res.status(404).json({
            success: false,
            error: 'THEATRE_CASE_NOT_FOUND',
            message: 'The theatre case was not found in this facility.',
          });

          return;
        }

        const body = (req.body ?? {}) as Record<string, unknown>;

        const payload = {
          ...body,
          facilityId: facility.id,
          tenantId: facility.tenantId,
        } as Parameters<typeof queries.updateTheatreCase>[1];

        const tc = await queries.updateTheatreCase(caseId, payload);

        res.json(tc);
      } catch (err: any) {
        res.status(500).json({
          error: err.message,
        });
      }
    },
  );

  // =========================================================
  // LABORATORY
  // =========================================================

  app.get('/api/lab-tests', requirePermission('laboratory.read'), async (req, res) => {
    try {
      const facilityId = req.query.facilityId ? Number(req.query.facilityId) : undefined;

      const list = await queries.getLabTests(facilityId);

      res.json(list);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.get(
    '/api/lab-orders',
    requirePermission('laboratory.read'),
    async (req: AuthRequest, res) => {
      try {
        const facilityId = req.query.facilityId ? Number(req.query.facilityId) : undefined;

        const patientId = req.query.patientId ? Number(req.query.patientId) : undefined;

        const list = await queries.getLabOrders(req.authContext!, facilityId, patientId);

        res.json(list);
      } catch (err: any) {
        res.status(500).json({
          error: err.message,
        });
      }
    },
  );

  app.post(
    '/api/lab-orders/batch',
    requirePermission('laboratory.orders.create'),

    async (req: AuthRequest, res: Response) => {
      if (!req.authContext) {
        return res.status(401).json({ error: 'Authentication context is required.' });
      }

      try {
        const result = await queries.createLabOrderBatch(req.authContext, req.body);

        /*
         * Every order in the batch is priced, not just the first.
         *
         * The screen orders investigations through this endpoint and
         * never through the single-order one, so this is the only place
         * a laboratory charge can be raised. Before this, a batch of
         * tests reached the laboratory queue and the patient's invoice
         * stayed empty.
         */
        const billed = await chargeLabOrderBatch(result.orders, db);

        return res.status(201).json({ ...result, billing: billed });
      } catch (err: any) {
        const message = err?.message || 'Failed to create laboratory batch.';
        const clientError = [
          'Select at least one laboratory test.',
          'Enter no more than 100 laboratory investigations.',
          'Each investigation name must be 200 characters or fewer.',
          'Invalid laboratory investigation name.',
          'Invalid laboratory investigations.',
          'Enter at least one laboratory investigation.',
          'One or more laboratory test IDs are invalid.',
          'Duplicate tests are not allowed in one submission.',
          'Invalid laboratory priority.',
          'Clinical indication is required.',
          'Specimen type is required.',
          'Clinical text exceeds the permitted length.',
          'Encounter not found.',
          'A selected test is unavailable at this facility.',
        ].includes(message);

        return res.status(clientError ? 400 : 500).json({ error: message });
      }
    },
  );
  app.post(
    '/api/lab-orders',
    requirePermission('laboratory.orders.create'),
    async (req: AuthRequest, res: Response) => {
      if (!req.authContext) {
        return res.status(401).json({ error: 'Authentication context is required.' });
      }

      try {
        const order = await queries.createLabOrder(req.authContext, req.body);

        const labOrder = order as {
          id?: number;
          tenantId?: number;
          facilityId?: number;
          patientId?: number;
          encounterId?: number | null;
          testId?: number | null;
          testName?: string;
          testCode?: string | null;
        } | null;

        const charge =
          labOrder && labOrder.id
            ? await chargeSafely({
                tenantId: labOrder.tenantId ?? req.authContext.tenantId ?? 0,
                facilityId: labOrder.facilityId ?? req.authContext.facilityId ?? 0,
                patientId: labOrder.patientId ?? 0,
                encounterId: labOrder.encounterId ?? null,
                /*
                 * The catalogue code first (LAB-CBC), then the name-derived
                 * codes, then the generic fallbacks — the same order the batch
                 * route uses, because a single order must price the same way
                 * a batch does.
                 */
                codes: codesForFamily({
                  family: 'LABORATORY',
                  code: labOrder.testCode ?? null,
                  name: labOrder.testName,
                }),
                serviceKeys: billingServiceKeys('LABORATORY', [
                  labOrder.testCode ?? null,
                  labOrder.testName,
                ]),
                family: 'LABORATORY',
                serviceName: labOrder.testName,
                aliases: labOrder.testCode ? [labOrder.testCode] : [],
                serviceRef: {
                  type: 'LAB_TEST',
                  id: typeof labOrder.testId === 'number' ? labOrder.testId : null,
                  code: labOrder.testCode ?? null,
                },
                sourceType: 'LAB_ORDER',
                sourceId: labOrder.id,
                itemType: 'Laboratory',
                description: labOrder.testName,
              })
            : null;

        res.status(201).json({ ...order, billing: charge });
      } catch (err: any) {
        res.status(500).json({
          error: err.message,
        });
      }
    },
  );

  app.put(
    '/api/lab-orders/:id/status',
    requirePermission('laboratory.results.enter'),
    async (req: AuthRequest, res) => {
      try {
        const { status, accessionNumber } = req.body;

        const order = await queries.updateLabOrderStatus(
          req.authContext!,
          Number(req.params.id),
          status,
          accessionNumber,
        );

        res.json(order);
      } catch (err: any) {
        res.status(500).json({
          error: err.message,
        });
      }
    },
  );

  app.get(
    '/api/lab-results',
    requirePermission('laboratory.read'),
    async (req: AuthRequest, res) => {
      try {
        const orderId = req.query.orderId ? Number(req.query.orderId) : undefined;

        const patientId = req.query.patientId ? Number(req.query.patientId) : undefined;

        const list = await queries.getLabResults(
          req.authContext!,
          orderId,
          patientId,
          req.query.facilityId ? Number(req.query.facilityId) : undefined,
        );

        res.json(list);
      } catch (err: any) {
        res.status(500).json({
          error: err.message,
        });
      }
    },
  );

  app.post(
    '/api/lab-results',
    requirePermission('laboratory.results.enter'),
    async (req: AuthRequest, res) => {
      try {
        const {
          orderId,
          patientId,
          parameterName,
          measuredValue,
          unit,
          referenceRange,
          flag,
          notes,
        } = req.body ?? {};

        if (
          !Number.isInteger(Number(orderId)) ||
          Number(orderId) <= 0 ||
          !Number.isInteger(Number(patientId)) ||
          Number(patientId) <= 0 ||
          typeof parameterName !== 'string' ||
          !parameterName.trim() ||
          typeof measuredValue !== 'string' ||
          !measuredValue.trim()
        ) {
          res.status(400).json({
            error: 'Valid order, patient, parameter name, and measured value are required.',
          });
          return;
        }

        const result = await queries.addLabResult(req.authContext!, {
          orderId: Number(orderId),
          patientId: Number(patientId),
          parameterName: parameterName.trim(),
          measuredValue: measuredValue.trim(),
          unit: typeof unit === 'string' ? unit.trim() || null : null,
          referenceRange: typeof referenceRange === 'string' ? referenceRange.trim() || null : null,
          flag: typeof flag === 'string' && flag.trim() ? flag.trim() : null,
          notes: typeof notes === 'string' ? notes.trim() || null : null,
        });

        res.status(201).json(result);
      } catch (err: any) {
        res.status(500).json({
          error: err.message,
        });
      }
    },
  );

  // =========================================================
  app.post(
    '/api/lab-results/:id/verify',
    requirePermission('laboratory.results.verify'),
    async (req: AuthRequest, res) => {
      try {
        if (!req.authContext || !req.user) {
          res.status(401).json({ error: 'Authentication is required.' });
          return;
        }

        const resultId = Number(req.params.id);
        if (!Number.isInteger(resultId) || resultId <= 0) {
          res.status(400).json({ error: 'A valid laboratory result ID is required.' });
          return;
        }

        const verifier = req.user.fullName || req.user.username || String(req.user.id);

        const result = await queries.verifyLabResult(req.authContext, resultId, verifier);

        res.json(result);
      } catch (err: any) {
        if (typeof handleScopeError === 'function' && handleScopeError(err, res)) {
          return;
        }
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Could not verify laboratory result.',
        });
      }
    },
  );
  // RADIOLOGY
  // =========================================================

  app.get(
    '/api/radiology-orders',
    requireAnyPermission('clinical.read', 'laboratory.read'),
    async (req: AuthRequest, res: Response) => {
      const facility = await requireScopedFacility(req, res, req.query.facilityId);

      if (!facility) return;

      const patientId = req.query.patientId ? Number(req.query.patientId) : undefined;

      try {
        const list = await queries.getRadiologyOrders(facility.id, patientId);

        res.json(list);
      } catch (err: any) {
        res.status(500).json({
          error: err.message,
        });
      }
    },
  );

  app.post(
    '/api/radiology-orders',
    requirePermission('clinical.create'),
    async (req: AuthRequest, res: Response) => {
      try {
        const body = (req.body ?? {}) as Record<string, unknown>;

        const facility = await requireScopedFacility(
          req,
          res,
          body.facilityId ?? req.query.facilityId,
        );

        if (!facility) return;

        const payload = {
          ...body,
          facilityId: facility.id,
          tenantId: facility.tenantId,
        } as Parameters<typeof queries.createRadiologyOrder>[0];

        const order = await queries.createRadiologyOrder(payload);

        /*
         * The table has `procedure_name`, not `test_name`. Reading a field
         * that does not exist meant no RAD-<study> tariff could ever match:
         * a chest X-ray priced as RAD-CHEST-X-RAY was recorded and never
         * billed, while only a generic RADIOLOGY tariff would catch it.
         */
        const radiologyOrder = order as {
          id?: number;
          tenantId?: number;
          facilityId?: number;
          patientId?: number;
          encounterId?: number | null;
          procedureName?: string;
          modality?: string;
        } | null;

        let charge: billing.ChargeResult | null = null;

        if (radiologyOrder && radiologyOrder.id) {
          charge = await chargeSafely(radiologyChargeRequest(radiologyOrder as never));
        }

        res.status(201).json({ ...order, billing: charge });
      } catch (err: any) {
        res.status(500).json({
          error: err.message,
        });
      }
    },
  );

  app.put(
    '/api/radiology-orders/:id/report',
    requireAnyPermission('clinical.update', 'laboratory.results.enter'),
    async (req: AuthRequest, res: Response) => {
      const orderId = Number(req.params.id);

      if (!Number.isSafeInteger(orderId) || orderId <= 0) {
        res.status(400).json({
          success: false,
          error: 'INVALID_RADIOLOGY_ORDER_ID',
        });

        return;
      }

      const facility = await requireScopedFacility(
        req,
        res,
        req.query.facilityId ?? (req.body ?? {}).facilityId,
      );

      if (!facility) return;

      try {
        const existing = await queries.getRadiologyOrderScoped(orderId, facility.id);

        if (!existing) {
          res.status(404).json({
            success: false,
            error: 'RADIOLOGY_ORDER_NOT_FOUND',
            message: 'The order was not found in this facility.',
          });

          return;
        }

        const { findings, impression, reportedBy } = req.body;

        const order = await queries.updateRadiologyReport(
          orderId,
          findings,
          impression,
          reportedBy,
        );

        res.json(order);
      } catch (err: any) {
        res.status(500).json({
          error: err.message,
        });
      }
    },
  );

  // =========================================================
  // PHARMACY & INVENTORY
  // =========================================================

  /**
   * Batches with their expiry status, ordered earliest expiry first.
   * Everything reaches the facility through inventory_items, because
   * inventory_batches has no facility column of its own.
   */
  app.get(
    '/api/inventory/batches',
    requirePermission('inventory.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const status = typeof req.query.status === 'string' ? req.query.status : 'All';

        if (!['All', 'Expired', 'Expiring', 'OK'].includes(status)) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_STATUS',
            message: 'status must be one of All, Expired, Expiring, OK.',
          });
        }

        const rows = await inventory.getBatchesScoped(context, {
          facilityId: req.query.facilityId ? Number(req.query.facilityId) : undefined,
          itemId: req.query.itemId ? Number(req.query.itemId) : undefined,
          status: status as 'All' | 'Expired' | 'Expiring' | 'OK',
          horizonDays: req.query.horizonDays ? Number(req.query.horizonDays) : undefined,
        });

        return res.json(rows);
      } catch (err: unknown) {
        if (handleScopeError(err, res)) return;
        if (handleInventoryError(err, res)) return;

        console.error('Batch list error:', err);
        return res.status(500).json({
          success: false,
          error: 'BATCH_LIST_FAILED',
        });
      }
    },
  );

  /**
   * Expired and near-expiry stock for the facility.
   */
  app.get(
    '/api/inventory/expiry-summary',
    requirePermission('inventory.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const summary = await inventory.getExpirySummaryScoped(
          context,
          req.query.facilityId ? Number(req.query.facilityId) : undefined,
          req.query.days ? Number(req.query.days) : 30,
        );

        return res.json(summary);
      } catch (err: unknown) {
        if (handleScopeError(err, res)) return;
        if (handleInventoryError(err, res)) return;

        console.error('Expiry summary error:', err);
        return res.status(500).json({
          success: false,
          error: 'EXPIRY_SUMMARY_FAILED',
        });
      }
    },
  );

  /**
   * Receive stock into a batch.
   *
   * Tops up an existing batch number instead of failing, so a second
   * delivery of the same lot is not rejected by the unique index.
   */
  app.post(
    '/api/inventory/:id/batches',
    requirePermission('inventory.manage'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      const itemId = Number(req.params.id);

      if (!Number.isSafeInteger(itemId) || itemId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_ITEM_ID',
        });
      }

      try {
        const result = await inventory.receiveBatchScoped(
          context,
          itemId,
          req.body ?? {},
          typeof req.body?.facilityId === 'number' ? req.body.facilityId : undefined,
        );

        return res.status(201).json(result);
      } catch (err: unknown) {
        if (handleScopeError(err, res)) return;
        if (handleInventoryError(err, res)) return;

        console.error('Batch receive error:', err);
        return res.status(500).json({
          success: false,
          error: 'BATCH_RECEIVE_FAILED',
        });
      }
    },
  );

  app.get('/api/inventory', requirePermission('inventory.read'), async (req, res) => {
    try {
      const facilityId = req.query.facilityId ? Number(req.query.facilityId) : undefined;

      const list = await queries.getInventoryItems(facilityId);

      res.json(list);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.post('/api/inventory', requirePermission('inventory.manage'), async (req, res) => {
    try {
      const item = await queries.createInventoryItem(req.body);

      res.status(201).json(item);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.post(
    '/api/pharmacy/dispense',
    requirePermission('pharmacy.dispense'),
    async (req: AuthRequest, res) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
          });
        }

        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_DISPENSE_BODY',
          });
        }

        /*
         * Dispensing draws first-expiry-first-out inside a transaction
         * with the batch rows locked, so two tills cannot take the same
         * last strip and an expired lot is never handed to a patient.
         */
        const result = await inventory.dispenseFefoScoped(req.authContext, req.body);

        const dispensation = result.dispensation;

        /*
         * Price the dispensation from the facility tariff.
         *
         * The previous implementation created the invoice in the browser
         * with a hardcoded KES 15 unit price, which meant pharmacy revenue
         * never reflected the facility's own rates. Tariffs now win; the
         * medication's own price is used only as a fallback.
         */
        let charge: billing.ChargeResult | null = null;

        if (dispensation && dispensation.id && dispensation.patientId) {
          const drugName = typeof req.body.drugName === 'string' ? req.body.drugName : 'Medication';

          charge = await chargeSafely({
            tenantId: dispensation.tenantId ?? req.authContext.tenantId ?? 0,
            facilityId: dispensation.facilityId ?? req.authContext.facilityId ?? 0,
            patientId: dispensation.patientId,
            encounterId: typeof req.body.encounterId === 'number' ? req.body.encounterId : null,
            codes: codesForFamily({
              family: 'PHARMACY',
              name: drugName,
            }),
            serviceKeys: billingServiceKeys('PHARMACY', [drugName]),
            family: 'PHARMACY',
            serviceName: drugName,
            quantity:
              typeof dispensation.quantityDispensed === 'number'
                ? dispensation.quantityDispensed
                : 1,
            sourceType: 'PHARMACY',
            sourceId: dispensation.id,
            itemType: 'Pharmacy',
            description: drugName,
            fallbackUnitPrice:
              typeof req.body.unitPrice === 'string' || typeof req.body.unitPrice === 'number'
                ? req.body.unitPrice
                : null,
            fallbackDescription: drugName,
          });
        }

        /*
         * The patient has been served, so the token that sent them here
         * is done. A board that keeps showing them is a board nobody
         * trusts by the end of the day.
         */
        await queries
          .completeQueueTokensForPatient(req.authContext, result.dispensation.patientId, 'Pharmacy')
          .catch((error: unknown) => {
            console.error('Could not close the pharmacy queue token:', error);
          });

        res.status(201).json({
          ...result.dispensation,
          stockTracking: result.stockTracking,
          allocations: result.allocations,
          stockAfter: result.stockAfter,
          billing: charge,
        });
      } catch (err: unknown) {
        if (handleInventoryError(err, res)) return;

        const message = err instanceof Error ? err.message : 'Dispensing failed.';

        console.error('Dispense error:', err);
        res.status(500).json({
          error: message,
        });
      }
    },
  );

  // =========================================================
  // PROCUREMENT
  // =========================================================

  app.get(
    '/api/suppliers',
    requirePermission('procurement.read'),
    async (req: AuthRequest, res: Response) => {
      const context = req.authContext;

      if (!context) {
        res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });

        return;
      }

      const rawTenantId = req.query.tenantId;

      let tenantId: number | undefined;

      if (rawTenantId !== undefined && rawTenantId !== '') {
        tenantId = Number(rawTenantId);

        if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
          res.status(400).json({
            success: false,
            error: 'INVALID_TENANT_ID',
            message: 'tenantId must be a positive integer.',
          });

          return;
        }
      }

      if (!context.isSuperAdmin) {
        if (context.tenantId === null) {
          res.status(403).json({
            success: false,
            error: 'TENANT_SCOPE_REQUIRED',
            message: 'Your account is not attached to a tenant.',
          });

          return;
        }

        if (tenantId !== undefined && tenantId !== context.tenantId) {
          res.status(403).json({
            success: false,
            error: 'TENANT_ACCESS_DENIED',
            message: 'You are not authorized to access this tenant.',
          });

          return;
        }

        tenantId = context.tenantId;
      }

      try {
        const list = await queries.getSuppliers(tenantId);

        res.json(list);
      } catch (err: any) {
        res.status(500).json({
          error: err.message,
        });
      }
    },
  );

  app.get(
    '/api/purchase-orders',
    requirePermission('procurement.read'),
    async (req: AuthRequest, res: Response) => {
      const facility = await requireScopedFacility(req, res, req.query.facilityId);

      if (!facility) return;

      try {
        const list = await queries.getPurchaseOrders(facility.id);

        res.json(list);
      } catch (err: any) {
        res.status(500).json({
          error: err.message,
        });
      }
    },
  );

  app.post(
    '/api/purchase-orders',
    requirePermission('procurement.create'),
    async (req: AuthRequest, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;

      const facility = await requireScopedFacility(
        req,
        res,
        body.facilityId ?? req.query.facilityId,
      );

      if (!facility) return;

      try {
        const payload = {
          ...body,
          facilityId: facility.id,
          tenantId: facility.tenantId,
        } as Parameters<typeof queries.createPurchaseOrder>[0];

        const po = await queries.createPurchaseOrder(payload);

        res.status(201).json(po);
      } catch (err: any) {
        res.status(500).json({
          error: err.message,
        });
      }
    },
  );

  // =========================================================
  // FACILITY SERVICE TARIFFS
  // =========================================================

  const tariffModuleForDepartment = (department: string): string | null => {
    const value = department
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    const aliases: Record<string, string> = {
      opd: 'opd',
      outpatient: 'opd',
      inpatient: 'inpatient',
      ward: 'inpatient',
      theatre: 'theatre',
      operating_theatre: 'theatre',
      specialty: 'specialty',
      specialist: 'specialty',
      laboratory: 'laboratory',
      lab: 'laboratory',
      radiology: 'radiology',
      imaging: 'radiology',
      pharmacy: 'pharmacy',
      registration: 'registration',
      reception: 'reception',
      insurance: 'insurance',
      sha: 'insurance',
      finance: 'finance',
      general: 'finance',
    };
    return aliases[value] ?? null;
  };

  const validateTariffInput = (input: any) => {
    /*
     * Stored in capitals, always. The billing engine looks codes up in
     * capitals; a row saved as "consultation" would be invisible to it
     * and the visit would bill nothing.
     */
    const code = typeof input?.code === 'string' ? input.code.trim().toUpperCase() : '';
    const description = typeof input?.description === 'string' ? input.description.trim() : '';
    const department = typeof input?.department === 'string' ? input.department.trim() : '';
    const unit = typeof input?.unit === 'string' ? input.unit.trim() : 'Service';
    const feeText =
      typeof input?.fee === 'string' || typeof input?.fee === 'number'
        ? String(input.fee).trim()
        : '';
    const shaStatus =
      typeof input?.shaStatus === 'string' ? input.shaStatus.trim() : 'Not Assessed';
    const shaNotes =
      input?.shaNotes == null
        ? null
        : typeof input.shaNotes === 'string'
          ? input.shaNotes.trim()
          : undefined;
    const moduleId = tariffModuleForDepartment(department);
    const fee = Number(feeText);

    /*
     * Optional link to an automatic charge. Absent or empty means "not
     * linked"; anything else must be a key the engine understands, or it
     * would be a link that silently never fires.
     */
    const rawBillingKey = typeof input?.billingKey === 'string' ? input.billingKey.trim() : '';

    if (rawBillingKey !== '' && !isValidBillingKey(rawBillingKey)) {
      return null;
    }

    const billingKey = rawBillingKey === '' ? null : rawBillingKey.toUpperCase();

    /*
     * Effective dates. Both optional; empty means "always". They are
     * what lets a price list change on 1 January without either
     * rewriting history or silently repricing past invoices: the
     * resolver checks today's date against the pair.
     */
    const parseDate = (value: unknown): string | null | undefined => {
      if (value === undefined || value === null || value === '') return null;

      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
        return undefined;
      }

      const parsed = new Date(`${value.trim()}T00:00:00Z`);

      return Number.isNaN(parsed.getTime()) ? undefined : value.trim();
    };

    const effectiveFrom = parseDate(input?.effectiveFrom);
    const effectiveTo = parseDate(input?.effectiveTo);

    if (effectiveFrom === undefined || effectiveTo === undefined) return null;

    if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) return null;

    const autoBill = input?.autoBill === undefined ? true : input.autoBill === true;

    if (input?.autoBill !== undefined && typeof input.autoBill !== 'boolean') {
      return null;
    }

    if (
      !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,49}$/.test(code) ||
      !description ||
      description.length > 500 ||
      !department ||
      department.length > 100 ||
      !moduleId ||
      !unit ||
      unit.length > 50 ||
      !/^\d{1,8}(\.\d{1,2})?$/.test(feeText) ||
      !Number.isFinite(fee) ||
      fee < 0 ||
      !shaStatus ||
      shaStatus.length > 50 ||
      shaNotes === undefined ||
      (shaNotes !== null && shaNotes.length > 1000)
    ) {
      return null;
    }

    return {
      code,
      description,
      department: moduleId,
      unit,
      fee: fee.toFixed(2),
      shaStatus,
      shaNotes,
      moduleId,
      billingKey,
      effectiveFrom,
      effectiveTo,
      autoBill,
    };
  };

  /**
   * Turn the two database errors this write can raise into sentences.
   *
   *   23505  two active tariffs claim the same automatic charge. That is
   *          refused on purpose: the amount billed would otherwise depend
   *          on which row the database returned first.
   *   42703  the database predates migration 0019, so a link cannot be
   *          stored. Say so instead of reporting a generic failure and
   *          letting the administrator believe the link was saved.
   */
  const sendTariffWriteError = (error: unknown, res: Response): boolean => {
    const code = (error as { code?: string } | null)?.code;

    if (code === '23505') {
      res.status(409).json({
        success: false,
        error: 'TARIFF_BILLING_KEY_TAKEN',
        message:
          'Another active tariff already answers that automatic charge. Deactivate it first, or choose a different one.',
      });

      return true;
    }

    if (code === '42703' || code === '42P01') {
      /*
       * Two migrations sit behind this form now:
       *   0019 — billing_key (the automatic-billing link)
       *   0021 — effective dates and the automatic-billing flag
       * Either being absent is a deployment fact, not a bad request.
       * The message names the one that is missing rather than a generic
       * 500, because the operator can fix it in one command.
       */
      const message =
        typeof (error as { message?: string }).message === 'string' &&
        (error as { message: string }).message.includes('effective')
          ? 'Price validity dates need migration 0021. Run `npm run db:migrate`, then save again. The tariff was not changed.'
          : 'Automatic billing links need migrations 0019 and 0021. Run `npm run db:migrate`, then save again. The tariff was not changed.';

      res.status(409).json({
        success: false,
        error: 'TARIFF_MIGRATION_REQUIRED',
        message,
      });

      return true;
    }

    return false;
  };

  const facilityHasTariffModule = (
    facility: { enabledModules: unknown },
    moduleId: string,
  ): boolean =>
    Array.isArray(facility.enabledModules) && facility.enabledModules.includes(moduleId);

  // Tariff pricing is restricted to tenant-level Facility Administrators.
  // This guard runs after requirePermission has loaded req.authContext.
  const requireFacilityAdminTariffRole = (req: AuthRequest, res: Response): boolean => {
    const context = req.authContext;

    if (!context) {
      res.status(401).json({
        success: false,
        error: 'AUTHORIZATION_CONTEXT_MISSING',
        message: 'Authorization context is required.',
      });
      return false;
    }

    if (context.isSuperAdmin || !context.roles.includes('FACILITY_ADMIN')) {
      res.status(403).json({
        success: false,
        error: 'FACILITY_ADMIN_REQUIRED',
        message: 'Only Facility Administrators can manage facility service tariffs.',
      });
      return false;
    }

    return true;
  };
  const resolveTariffFacility = async (req: AuthRequest, res: Response, requestedId: unknown) => {
    if (!req.authContext) {
      res.status(401).json({
        success: false,
        error: 'AUTHORIZATION_CONTEXT_MISSING',
        message: 'Authorization context is required.',
      });
      return null;
    }

    const facilityId = Number(requestedId);
    if (!Number.isSafeInteger(facilityId) || facilityId <= 0) {
      res.status(400).json({
        success: false,
        error: 'INVALID_FACILITY_ID',
        message: 'A valid facilityId is required.',
      });
      return null;
    }

    try {
      const scopedId = resolveFacilityScope(req.authContext, facilityId);
      const facility = await queries.getFacilityByIdScoped(req.authContext, scopedId);

      if (!facility) {
        res.status(404).json({
          success: false,
          error: 'FACILITY_NOT_FOUND',
          message: 'The facility was not found in your authorized scope.',
        });
        return null;
      }

      if (!facilityHasTariffModule(facility, 'finance')) {
        res.status(403).json({
          success: false,
          error: 'FACILITY_MODULE_DISABLED',
          module: 'finance',
          message: 'The finance module must be enabled to manage tariffs.',
        });
        return null;
      }

      return facility;
    } catch (error: unknown) {
      if (handleScopeError(error, res)) return null;
      throw error;
    }
  };

  app.get(
    '/api/service-tariffs',
    requirePermission('tariffs.read'),
    async (req: AuthRequest, res: Response) => {
      if (!requireFacilityAdminTariffRole(req, res)) return;
      try {
        const facility = await resolveTariffFacility(req, res, req.query.facilityId);
        if (!facility) return;

        const rows = await db
          .select()
          .from(schema.facilityServiceTariffs)
          .where(
            and(
              eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
              eq(schema.facilityServiceTariffs.facilityId, facility.id),
            ),
          );

        return res.json(rows);
      } catch (error: unknown) {
        console.error('Failed to fetch service tariffs:', error);
        return res.status(500).json({
          success: false,
          error: 'SERVICE_TARIFFS_FETCH_FAILED',
          message: 'Failed to fetch service tariffs.',
        });
      }
    },
  );

  app.post(
    '/api/service-tariffs',
    requirePermission('tariffs.manage'),
    async (req: AuthRequest, res: Response) => {
      if (!requireFacilityAdminTariffRole(req, res)) return;
      try {
        const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
        if (!facility || !req.authContext) return;

        const input = validateTariffInput(req.body);
        if (!input) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_SERVICE_TARIFF',
            message:
              'Provide a valid code, description, enabled department, unit, fee, and SHA status.',
          });
        }

        if (!facilityHasTariffModule(facility, input.moduleId)) {
          return res.status(400).json({
            success: false,
            error: 'TARIFF_DEPARTMENT_MODULE_DISABLED',
            message: 'Enable the selected department module before adding its tariff.',
          });
        }

        const [existing] = await db
          .select({ id: schema.facilityServiceTariffs.id })
          .from(schema.facilityServiceTariffs)
          .where(
            and(
              eq(schema.facilityServiceTariffs.facilityId, facility.id),
              eq(schema.facilityServiceTariffs.code, input.code),
            ),
          )
          .limit(1);

        if (existing) {
          return res.status(409).json({
            success: false,
            error: 'TARIFF_CODE_EXISTS',
            message: 'That tariff code already exists for this facility.',
          });
        }

        const [created] = await db
          .insert(schema.facilityServiceTariffs)
          .values({
            tenantId: facility.tenantId,
            facilityId: facility.id,
            code: input.code,
            description: input.description,
            department: input.department,
            unit: input.unit,
            fee: input.fee,
            shaStatus: input.shaStatus,
            shaNotes: input.shaNotes,
            billingKey: input.billingKey,
            effectiveFrom: input.effectiveFrom,
            effectiveTo: input.effectiveTo,
            autoBill: input.autoBill,
            isActive: true,
          })
          .returning();

        await queries.logAuditEvent(
          facility.tenantId,
          facility.id,
          String(req.authContext.userId),
          'CREATE',
          'FACILITY_SERVICE_TARIFF',
          String(created.id),
          `Created tariff ${created.code} for department ${created.department}.`,
        );

        return res.status(201).json(created);
      } catch (error: unknown) {
        if (sendTariffWriteError(error, res)) return;

        console.error('Failed to create service tariff:', error);
        return res.status(500).json({
          success: false,
          error: 'SERVICE_TARIFF_CREATE_FAILED',
          message: 'Failed to create service tariff.',
        });
      }
    },
  );

  app.put(
    '/api/service-tariffs/:id',
    requirePermission('tariffs.manage'),
    async (req: AuthRequest, res: Response) => {
      if (!requireFacilityAdminTariffRole(req, res)) return;
      try {
        const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
        if (!facility || !req.authContext) return;

        const tariffId = Number(req.params.id);
        if (!Number.isSafeInteger(tariffId) || tariffId <= 0) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_TARIFF_ID',
            message: 'A valid tariff ID is required.',
          });
        }

        const input = validateTariffInput(req.body);
        if (!input) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_SERVICE_TARIFF',
            message: 'Provide valid tariff details.',
          });
        }

        if (!facilityHasTariffModule(facility, input.moduleId)) {
          return res.status(400).json({
            success: false,
            error: 'TARIFF_DEPARTMENT_MODULE_DISABLED',
            message: 'Enable the selected department module before assigning its tariff.',
          });
        }

        const [existing] = await db
          .select()
          .from(schema.facilityServiceTariffs)
          .where(
            and(
              eq(schema.facilityServiceTariffs.id, tariffId),
              eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
              eq(schema.facilityServiceTariffs.facilityId, facility.id),
            ),
          )
          .limit(1);

        if (!existing) {
          return res.status(404).json({
            success: false,
            error: 'TARIFF_NOT_FOUND',
            message: 'The tariff was not found in this facility.',
          });
        }

        const [duplicate] = await db
          .select({ id: schema.facilityServiceTariffs.id })
          .from(schema.facilityServiceTariffs)
          .where(
            and(
              eq(schema.facilityServiceTariffs.facilityId, facility.id),
              eq(schema.facilityServiceTariffs.code, input.code),
            ),
          )
          .limit(1);

        if (duplicate && duplicate.id !== tariffId) {
          return res.status(409).json({
            success: false,
            error: 'TARIFF_CODE_EXISTS',
            message: 'That tariff code already exists for this facility.',
          });
        }

        const [updated] = await db
          .update(schema.facilityServiceTariffs)
          .set({
            code: input.code,
            description: input.description,
            department: input.department,
            unit: input.unit,
            fee: input.fee,
            shaStatus: input.shaStatus,
            shaNotes: input.shaNotes,
            billingKey: input.billingKey,
            effectiveFrom: input.effectiveFrom,
            effectiveTo: input.effectiveTo,
            autoBill: input.autoBill,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.facilityServiceTariffs.id, tariffId),
              eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
              eq(schema.facilityServiceTariffs.facilityId, facility.id),
            ),
          )
          .returning();

        await queries.logAuditEvent(
          facility.tenantId,
          facility.id,
          String(req.authContext.userId),
          'UPDATE',
          'FACILITY_SERVICE_TARIFF',
          String(updated.id),
          `Updated tariff ${updated.code}. Existing invoice item snapshots are unchanged.`,
        );

        return res.json(updated);
      } catch (error: unknown) {
        if (sendTariffWriteError(error, res)) return;

        console.error('Failed to update service tariff:', error);
        return res.status(500).json({
          success: false,
          error: 'SERVICE_TARIFF_UPDATE_FAILED',
          message: 'Failed to update service tariff.',
        });
      }
    },
  );

  app.patch(
    '/api/service-tariffs/:id/deactivate',
    requirePermission('tariffs.manage'),
    async (req: AuthRequest, res: Response) => {
      if (!requireFacilityAdminTariffRole(req, res)) return;
      try {
        const facility = await resolveTariffFacility(
          req,
          res,
          req.body?.facilityId ?? req.query.facilityId,
        );
        if (!facility || !req.authContext) return;

        const tariffId = Number(req.params.id);
        if (!Number.isSafeInteger(tariffId) || tariffId <= 0) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_TARIFF_ID',
            message: 'A valid tariff ID is required.',
          });
        }

        const [updated] = await db
          .update(schema.facilityServiceTariffs)
          .set({ isActive: false, updatedAt: new Date() })
          .where(
            and(
              eq(schema.facilityServiceTariffs.id, tariffId),
              eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
              eq(schema.facilityServiceTariffs.facilityId, facility.id),
              eq(schema.facilityServiceTariffs.isActive, true),
            ),
          )
          .returning();

        if (!updated) {
          return res.status(404).json({
            success: false,
            error: 'ACTIVE_TARIFF_NOT_FOUND',
            message: 'No active tariff with that ID exists in this facility.',
          });
        }

        await queries.logAuditEvent(
          facility.tenantId,
          facility.id,
          String(req.authContext.userId),
          'DEACTIVATE',
          'FACILITY_SERVICE_TARIFF',
          String(updated.id),
          `Deactivated tariff ${updated.code}. Existing invoice item snapshots are unchanged.`,
        );

        return res.json(updated);
      } catch (error: unknown) {
        console.error('Failed to deactivate service tariff:', error);
        return res.status(500).json({
          success: false,
          error: 'SERVICE_TARIFF_DEACTIVATE_FAILED',
          message: 'Failed to deactivate service tariff.',
        });
      }
    },
  );

  // =========================================================
  // BILLING & CASHIER
  // =========================================================

  app.get(
    '/api/invoices',
    requirePermission('billing.read'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
            message: 'Authorization context is required.',
          });
        }

        const rawFacilityId = req.query.facilityId;
        const requestedFacilityId =
          typeof rawFacilityId === 'string' && rawFacilityId.trim()
            ? Number(rawFacilityId)
            : undefined;

        const facilityId = resolveFacilityScope(req.authContext, requestedFacilityId);

        const facility = await queries.getFacilityByIdScoped(req.authContext, facilityId);

        if (!facility) {
          return res.status(404).json({
            success: false,
            error: 'FACILITY_NOT_FOUND',
            message: 'Facility not found.',
          });
        }

        if (
          !Array.isArray(facility.enabledModules) ||
          !facility.enabledModules.includes('finance')
        ) {
          return res.status(403).json({
            success: false,
            error: 'FACILITY_MODULE_DISABLED',
            module: 'finance',
            message: 'The finance module is disabled for this facility.',
          });
        }

        const rawPatientId = req.query.patientId;
        let patientId: number | undefined;

        if (rawPatientId !== undefined) {
          if (
            typeof rawPatientId !== 'string' ||
            !rawPatientId.trim() ||
            !Number.isInteger(Number(rawPatientId)) ||
            Number(rawPatientId) <= 0
          ) {
            return res.status(400).json({
              success: false,
              error: 'INVALID_PATIENT_ID',
              message: 'Invalid patient ID.',
            });
          }

          patientId = Number(rawPatientId);
        }

        const list = await queries.getInvoices(facilityId, patientId);
        return res.json(list);
      } catch (err: unknown) {
        if (handleScopeError(err, res)) return;

        console.error('Failed to fetch invoices:', err);
        return res.status(500).json({
          success: false,
          error: 'INVOICE_FETCH_FAILED',
          message: 'Failed to fetch invoices.',
        });
      }
    },
  );
  app.get(
    '/api/invoices/:id/items',
    requirePermission('billing.read'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
            message: 'Authorization context is required.',
          });
        }

        const invoiceId = Number(req.params.id);
        if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_INVOICE_ID',
            message: 'A valid invoice ID is required.',
          });
        }

        const [invoice] = await db
          .select()
          .from(schema.billingInvoices)
          .where(eq(schema.billingInvoices.id, invoiceId))
          .limit(1);

        if (!invoice) {
          return res.status(404).json({
            success: false,
            error: 'INVOICE_NOT_FOUND',
            message: 'Invoice not found.',
          });
        }

        const facility = await queries.getFacilityByIdScoped(req.authContext, invoice.facilityId);

        if (!facility || facility.tenantId !== invoice.tenantId) {
          return res.status(404).json({
            success: false,
            error: 'INVOICE_NOT_FOUND',
            message: 'Invoice not found.',
          });
        }

        if (
          !Array.isArray(facility.enabledModules) ||
          !facility.enabledModules.includes('finance')
        ) {
          return res.status(403).json({
            success: false,
            error: 'FACILITY_MODULE_DISABLED',
            module: 'finance',
            message: 'The finance module is disabled for this facility.',
          });
        }

        const items = await queries.getInvoiceItems(invoiceId);
        return res.json(items);
      } catch (err: unknown) {
        if (handleScopeError(err, res)) return;

        console.error('Failed to fetch invoice items:', err);
        return res.status(500).json({
          success: false,
          error: 'INVOICE_ITEMS_FETCH_FAILED',
          message: 'Failed to fetch invoice items.',
        });
      }
    },
  );

  /**
   * Full invoice: header, line items with their clinical provenance and
   * every payment already recorded.
   */
  app.get(
    '/api/invoices/:id',
    requirePermission('billing.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const detail = await queries.getInvoiceDetailScoped(context, Number(req.params.id));

        if (!detail) {
          return res.status(404).json({
            success: false,
            error: 'INVOICE_NOT_FOUND',
          });
        }

        return res.json(detail);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Invoice detail error:', err);
        return res.status(500).json({
          success: false,
          error: 'INVOICE_DETAIL_FETCH_FAILED',
        });
      }
    },
  );

  /**
   * Void an invoice. Audit-preserving: the row and its lines remain,
   * marked voided, so the record is never destroyed.
   */
  app.post(
    '/api/invoices/:id/void',
    requirePermission('billing.update'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

      if (!reason) {
        return res.status(400).json({
          success: false,
          error: 'VOID_REASON_REQUIRED',
          message: 'A reason is required to void an invoice.',
        });
      }

      try {
        const invoice = await queries.voidInvoiceScoped(context, Number(req.params.id), reason);

        await queries.logAuditEvent(
          invoice.tenantId,
          invoice.facilityId,
          String(context.userId),
          'UPDATE',
          'Invoice',
          String(invoice.id),
          `Invoice ${invoice.invoiceNumber} voided: ${reason}`,
        );

        return res.json(invoice);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Invoice void error:', err);
        return res.status(500).json({
          success: false,
          error: 'INVOICE_VOID_FAILED',
        });
      }
    },
  );

  /**
   * The facility a request *asks* for, as a hint only.
   *
   * `resolveFacilityScope` decides whether the caller may have it. A
   * superadmin must name one; a facility user's own scope wins.
   */
  const requestedFacilityHint = (req: AuthRequest): number | undefined => {
    const raw = req.body?.facilityId ?? req.query.facilityId;

    if (typeof raw === 'number' && Number.isSafeInteger(raw)) return raw;

    if (typeof raw === 'string' && raw.trim() !== '') {
      const parsed = Number(raw);

      return Number.isSafeInteger(parsed) ? parsed : undefined;
    }

    return undefined;
  };

  // =========================================================
  // UNBILLED CHARGES
  // =========================================================
  //
  // A charge the engine could not price is written to
  // `billing_charge_attempts` (migration 0020). These routes are how a
  // facility sees that money and bills it once the price list is right.

  /** Everything waiting to be billed, plus what has been resolved. */
  app.get(
    '/api/billing/charge-attempts',
    /*
     * OR, not AND: a Facility Administrator holds `tariffs.*` and a
     * Billing Clerk holds `billing.*`. Either is entitled to see what
     * this facility failed to bill.
     */
    requireAnyPermission('billing.read', 'tariffs.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const rawFacilityId = req.query.facilityId;
        const requestedFacilityId =
          typeof rawFacilityId === 'string' && rawFacilityId.trim()
            ? Number(rawFacilityId)
            : undefined;

        const facilityId = resolveFacilityScope(context, requestedFacilityId);

        const status =
          typeof req.query.status === 'string' && req.query.status.trim()
            ? req.query.status.trim().toUpperCase()
            : null;

        const rows = await chargeAttempts.listChargeAttempts(db, {
          tenantId: context.tenantId ?? 0,
          facilityId,
          status,
        });

        const pending = await chargeAttempts.countPendingChargeAttempts(db, {
          tenantId: context.tenantId ?? 0,
          facilityId,
        });

        return res.json({ facilityId, pending, attempts: rows });
      } catch (error: unknown) {
        if (handleScopeError(error, res)) return;

        console.error('Charge attempt list error:', error);
        return res.status(500).json({
          success: false,
          error: 'CHARGE_ATTEMPTS_LIST_FAILED',
        });
      }
    },
  );

  /** Retry one charge after the tariff has been configured. */
  app.post(
    '/api/billing/charge-attempts/:id/retry',
    requireAnyPermission('billing.update', 'tariffs.manage'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      const attemptId = Number(req.params.id);

      if (!Number.isSafeInteger(attemptId) || attemptId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_CHARGE_ATTEMPT_ID',
        });
      }

      try {
        const facilityId = resolveFacilityScope(context, requestedFacilityHint(req));

        const outcome = await chargeAttempts.retryChargeAttempt(db, {
          tenantId: context.tenantId ?? 0,
          facilityId,
          attemptId,
        });

        if (!outcome) {
          return res.status(404).json({
            success: false,
            error: 'CHARGE_ATTEMPT_NOT_FOUND',
            message: 'This charge is not waiting to be billed at this facility.',
          });
        }

        if (outcome.status === 'BILLED') {
          await queries.logAuditEvent(
            context.tenantId ?? 0,
            facilityId,
            String(context.userId),
            'UPDATE',
            'BillingChargeAttempt',
            String(attemptId),
            `Unbilled charge retried and billed as ${outcome.result.tariffCode ?? 'tariff'} on invoice ${outcome.result.invoiceNumber ?? '—'}.`,
          );
        }

        return res.json(outcome);
      } catch (error: unknown) {
        if (handleScopeError(error, res)) return;

        console.error('Charge attempt retry error:', error);
        return res.status(500).json({
          success: false,
          error: 'CHARGE_ATTEMPT_RETRY_FAILED',
        });
      }
    },
  );

  /** Retry everything waiting for this facility, bounded. */
  app.post(
    '/api/billing/charge-attempts/retry',
    requireAnyPermission('billing.update', 'tariffs.manage'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const facilityId = resolveFacilityScope(context, requestedFacilityHint(req));

        const summary = await chargeAttempts.retryPendingChargeAttempts(db, {
          tenantId: context.tenantId ?? 0,
          facilityId,
        });

        await queries.logAuditEvent(
          context.tenantId ?? 0,
          facilityId,
          String(context.userId),
          'UPDATE',
          'BillingChargeAttempt',
          'batch',
          `Retried ${summary.tried} unbilled charge(s): ${summary.billed} billed, ${summary.stillPending} still waiting.`,
        );

        return res.json(summary);
      } catch (error: unknown) {
        if (handleScopeError(error, res)) return;

        console.error('Charge attempt batch retry error:', error);
        return res.status(500).json({
          success: false,
          error: 'CHARGE_ATTEMPT_RETRY_FAILED',
        });
      }
    },
  );

  /** Write an unbilled charge off, keeping the record. */
  app.post(
    '/api/billing/charge-attempts/:id/void',
    requireAnyPermission('billing.update', 'tariffs.manage'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      const attemptId = Number(req.params.id);

      if (!Number.isSafeInteger(attemptId) || attemptId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_CHARGE_ATTEMPT_ID',
        });
      }

      try {
        const facilityId = resolveFacilityScope(context, requestedFacilityHint(req));

        const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

        const voided = await chargeAttempts.voidChargeAttempt(db, {
          tenantId: context.tenantId ?? 0,
          facilityId,
          attemptId,
          ...(reason ? { reason } : {}),
        });

        if (!voided) {
          return res.status(404).json({
            success: false,
            error: 'CHARGE_ATTEMPT_NOT_FOUND',
          });
        }

        await queries.logAuditEvent(
          context.tenantId ?? 0,
          facilityId,
          String(context.userId),
          'UPDATE',
          'BillingChargeAttempt',
          String(attemptId),
          `Unbilled charge written off${reason ? `: ${reason}` : '.'}`,
        );

        return res.json({ success: true, id: attemptId, status: 'VOID' });
      } catch (error: unknown) {
        if (handleScopeError(error, res)) return;

        console.error('Charge attempt void error:', error);
        return res.status(500).json({
          success: false,
          error: 'CHARGE_ATTEMPT_VOID_FAILED',
        });
      }
    },
  );

  /**
   * Explain what a charge would be priced at, and why.
   *
   * Read-only. Every tariff in the facility comes back with a verdict,
   * so "OPD-001 was not used" is answered about the facility's own rows.
   */
  app.post(
    '/api/billing/tariff-match',
    requireAnyPermission('billing.read', 'tariffs.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      const family =
        typeof req.body?.family === 'string' ? req.body.family.trim().toUpperCase() : '';

      const known = [
        'CONSULTATION',
        'LABORATORY',
        'RADIOLOGY',
        'PROCEDURE',
        'ADMISSION',
        'BED_DAY',
        'DELIVERY',
        'PHARMACY',
      ];

      if (!known.includes(family)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_BILLING_FAMILY',
          message: `family must be one of ${known.join(', ')}.`,
        });
      }

      const asText = (value: unknown): string | null =>
        typeof value === 'string' && value.trim() ? value.trim() : null;

      try {
        /*
         * Scope first, body second: the requested facility is only ever
         * a *hint*, and `resolveFacilityScope` refuses one outside the
         * session's scope.
         */
        const facilityId = resolveFacilityScope(context, requestedFacilityHint(req));

        const explanation = await billing.explainFacilityTariffMatch(db, {
          facilityId,
          family: family as NonNullable<billing.ChargeRequest['family']>,
          code: asText(req.body?.code),
          name: asText(req.body?.name),
          wardCode: asText(req.body?.wardCode),
          encounterType: asText(req.body?.encounterType),
        });

        return res.json({
          facilityId,
          family,
          ...explanation,
          wouldBill: explanation.outcome.tariff
            ? {
                code: explanation.outcome.tariff.code,
                description: explanation.outcome.tariff.description,
                fee: explanation.outcome.tariff.fee,
                unit: explanation.outcome.tariff.unit,
                rule: explanation.outcome.rule,
              }
            : null,
        });
      } catch (error: unknown) {
        if (handleScopeError(error, res)) return;

        console.error('Tariff match explanation error:', error);
        return res.status(500).json({
          success: false,
          error: 'TARIFF_MATCH_FAILED',
        });
      }
    },
  );

  // =========================================================
  // SERVICE → TARIFF LINKS
  // =========================================================
  //
  // The explicit relationship the billing engine prefers: a catalogue
  // record, by database id, priced by a tariff row of the same facility
  // (migration 0021). Legacy keys (`billing_key`, 0019) still resolve,
  // but a link cannot be ambiguous and can be validated field by field.

  /** Every link this facility has made, with the tariff it points at. */
  app.get(
    '/api/service-tariff-links',
    requirePermission('tariffs.read'),
    async (req: AuthRequest, res: Response) => {
      if (!requireFacilityAdminTariffRole(req, res)) return;

      try {
        const facility = await resolveTariffFacility(req, res, req.query.facilityId);
        if (!facility) return;

        const rows = await db
          .select({
            id: schema.serviceTariffLinks.id,
            serviceType: schema.serviceTariffLinks.serviceType,
            serviceId: schema.serviceTariffLinks.serviceId,
            serviceCode: schema.serviceTariffLinks.serviceCode,
            serviceName: schema.serviceTariffLinks.serviceName,
            tariffId: schema.serviceTariffLinks.tariffId,
            autoBill: schema.serviceTariffLinks.autoBill,
            isActive: schema.serviceTariffLinks.isActive,
            note: schema.serviceTariffLinks.note,
            createdAt: schema.serviceTariffLinks.createdAt,
            tariffCode: schema.facilityServiceTariffs.code,
            tariffDescription: schema.facilityServiceTariffs.description,
            tariffFee: schema.facilityServiceTariffs.fee,
            tariffUnit: schema.facilityServiceTariffs.unit,
            tariffActive: schema.facilityServiceTariffs.isActive,
            tariffAutoBill: schema.facilityServiceTariffs.autoBill,
            tariffEffectiveFrom: schema.facilityServiceTariffs.effectiveFrom,
            tariffEffectiveTo: schema.facilityServiceTariffs.effectiveTo,
          })
          .from(schema.serviceTariffLinks)
          .innerJoin(
            schema.facilityServiceTariffs,
            eq(schema.facilityServiceTariffs.id, schema.serviceTariffLinks.tariffId),
          )
          .where(
            and(
              eq(schema.serviceTariffLinks.tenantId, facility.tenantId),
              eq(schema.serviceTariffLinks.facilityId, facility.id),
            ),
          );

        return res.json(rows);
      } catch (error: unknown) {
        if (sendTariffWriteError(error, res)) return;

        console.error('Service tariff link list error:', error);
        return res.status(500).json({
          success: false,
          error: 'SERVICE_TARIFF_LINKS_FETCH_FAILED',
        });
      }
    },
  );

  /**
   * Link a catalogue service to this facility's tariff.
   *
   * Re-linking replaces the active link rather than stacking a second
   * one, and the old row stays with `is_active = false` so the history
   * of what priced what is not erased.
   */
  app.post(
    '/api/service-tariff-links',
    requirePermission('tariffs.manage'),
    async (req: AuthRequest, res: Response) => {
      if (!requireFacilityAdminTariffRole(req, res)) return;

      try {
        const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
        if (!facility || !req.authContext) return;

        const serviceType =
          typeof req.body?.serviceType === 'string'
            ? req.body.serviceType.trim().toUpperCase()
            : '';
        const tariffId = Number(req.body?.tariffId);
        const rawServiceId = req.body?.serviceId;
        const serviceId =
          rawServiceId === undefined || rawServiceId === null || rawServiceId === ''
            ? null
            : Number(rawServiceId);

        if (!isCatalogueServiceType(serviceType)) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_SERVICE_TYPE',
            message: `serviceType must be one of ${CATALOGUE_SERVICE_TYPES.join(', ')}.`,
          });
        }

        if (serviceId !== null && (!Number.isSafeInteger(serviceId) || serviceId <= 0)) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_SERVICE_ID',
          });
        }

        if (!Number.isSafeInteger(tariffId) || tariffId <= 0) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_TARIFF_ID',
          });
        }

        /* The tariff must be this facility's — the database enforces it
         * too, but a 400 says which field is wrong. */
        const [tariff] = await db
          .select({
            id: schema.facilityServiceTariffs.id,
            code: schema.facilityServiceTariffs.code,
            isActive: schema.facilityServiceTariffs.isActive,
          })
          .from(schema.facilityServiceTariffs)
          .where(
            and(
              eq(schema.facilityServiceTariffs.id, tariffId),
              eq(schema.facilityServiceTariffs.facilityId, facility.id),
            ),
          )
          .limit(1);

        if (!tariff) {
          return res.status(404).json({
            success: false,
            error: 'TARIFF_NOT_FOUND',
            message: 'That tariff does not belong to this facility.',
          });
        }

        /*
         * A catalogue id must be a real, active row of this facility —
         * otherwise a typo would create a link to nothing that never
         * fires, which is the silent failure this table exists to end.
         */
        let serviceCode: string | null =
          typeof req.body?.serviceCode === 'string' ? req.body.serviceCode.trim() || null : null;
        let serviceName: string | null =
          typeof req.body?.serviceName === 'string' ? req.body.serviceName.trim() || null : null;

        /*
         * A bed-day link names a ward, so "General ward → IP-002" prices
         * that ward and leaves the ICU to its own row. The ward must be
         * this facility's, or the link would never fire.
         */
        if (serviceType === 'BED_DAY' && serviceId !== null) {
          const [ward] = await db
            .select({
              id: schema.wards.id,
              code: schema.wards.code,
              name: schema.wards.name,
            })
            .from(schema.wards)
            .where(and(eq(schema.wards.id, serviceId), eq(schema.wards.facilityId, facility.id)))
            .limit(1);

          if (!ward) {
            return res.status(404).json({
              success: false,
              error: 'CATALOGUE_SERVICE_NOT_FOUND',
              message: 'That ward does not belong to this facility.',
            });
          }

          serviceCode = ward.code ?? serviceCode;
          serviceName = ward.name ?? serviceName;
        }

        if (serviceType === 'LAB_TEST' && serviceId !== null) {
          const [test] = await db
            .select({
              id: schema.labTests.id,
              code: schema.labTests.code,
              name: schema.labTests.name,
              isActive: schema.labTests.isActive,
            })
            .from(schema.labTests)
            .where(
              and(eq(schema.labTests.id, serviceId), eq(schema.labTests.facilityId, facility.id)),
            )
            .limit(1);

          if (!test) {
            return res.status(404).json({
              success: false,
              error: 'CATALOGUE_SERVICE_NOT_FOUND',
              message: 'That laboratory test does not belong to this facility.',
            });
          }

          serviceCode = test.code ?? serviceCode;
          serviceName = test.name ?? serviceName;
        }

        const autoBill = req.body?.autoBill === undefined ? true : req.body.autoBill === true;

        const retired = await db
          .update(schema.serviceTariffLinks)
          .set({ isActive: false, updatedAt: new Date() })
          .where(
            and(
              eq(schema.serviceTariffLinks.tenantId, facility.tenantId),
              eq(schema.serviceTariffLinks.facilityId, facility.id),
              eq(schema.serviceTariffLinks.serviceType, serviceType),
              serviceId === null
                ? sql`${schema.serviceTariffLinks.serviceId} is null`
                : eq(schema.serviceTariffLinks.serviceId, serviceId),
              eq(schema.serviceTariffLinks.isActive, true),
            ),
          )
          .returning({ id: schema.serviceTariffLinks.id });

        const [created] = await db
          .insert(schema.serviceTariffLinks)
          .values({
            tenantId: facility.tenantId,
            facilityId: facility.id,
            serviceType,
            serviceId,
            serviceCode,
            serviceName,
            tariffId,
            autoBill,
            note:
              typeof req.body?.note === 'string'
                ? req.body.note.trim().slice(0, 500) || null
                : null,
            createdBy: String(req.authContext.userId),
            isActive: true,
          })
          .returning();

        await queries.logAuditEvent(
          facility.tenantId,
          facility.id,
          String(req.authContext.userId),
          'CREATE',
          'SERVICE_TARIFF_LINK',
          String(created.id),
          `${serviceType}${serviceId === null ? ' (all)' : ` #${serviceId}`} linked to tariff ${tariff.code}${autoBill ? '' : ' (automatic billing off)'}.`,
        );

        return res.status(201).json({
          ...created,
          replacedLinks: retired.map((row) => row.id),
        });
      } catch (error: unknown) {
        if (handleScopeError(error, res)) return;
        if (sendTariffWriteError(error, res)) return;

        console.error('Service tariff link error:', error);
        return res.status(500).json({
          success: false,
          error: 'SERVICE_TARIFF_LINK_FAILED',
        });
      }
    },
  );

  /** Retire a link. The row is kept so the audit trail survives. */
  app.patch(
    '/api/service-tariff-links/:id/deactivate',
    requirePermission('tariffs.manage'),
    async (req: AuthRequest, res: Response) => {
      if (!requireFacilityAdminTariffRole(req, res)) return;

      try {
        const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
        if (!facility || !req.authContext) return;

        const linkId = Number(req.params.id);

        if (!Number.isSafeInteger(linkId) || linkId <= 0) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_LINK_ID',
          });
        }

        const [updated] = await db
          .update(schema.serviceTariffLinks)
          .set({ isActive: false, updatedAt: new Date() })
          .where(
            and(
              eq(schema.serviceTariffLinks.id, linkId),
              eq(schema.serviceTariffLinks.tenantId, facility.tenantId),
              eq(schema.serviceTariffLinks.facilityId, facility.id),
            ),
          )
          .returning();

        if (!updated) {
          return res.status(404).json({
            success: false,
            error: 'SERVICE_TARIFF_LINK_NOT_FOUND',
          });
        }

        await queries.logAuditEvent(
          facility.tenantId,
          facility.id,
          String(req.authContext.userId),
          'UPDATE',
          'SERVICE_TARIFF_LINK',
          String(linkId),
          'Service-to-tariff link retired.',
        );

        return res.json(updated);
      } catch (error: unknown) {
        if (handleScopeError(error, res)) return;
        if (sendTariffWriteError(error, res)) return;

        console.error('Service tariff link deactivate error:', error);
        return res.status(500).json({
          success: false,
          error: 'SERVICE_TARIFF_LINK_DEACTIVATE_FAILED',
        });
      }
    },
  );

  /**
   * Every active laboratory test in this facility, with what it would
   * bill today — and, when it would bill nothing, why.
   *
   * This is the screen that answers "why did my order not bill?": it
   * runs the same resolver the charger runs, over the facility's own
   * catalogue, and names the row and the reason.
   */
  app.get(
    '/api/billing/lab-service-diagnostics',
    requirePermission('tariffs.read'),
    async (req: AuthRequest, res: Response) => {
      if (!requireFacilityAdminTariffRole(req, res)) return;

      try {
        const facility = await resolveFacilityScope(
          req.authContext!,
          req.query.facilityId ? Number(req.query.facilityId) : undefined,
        );

        const tests = await db
          .select({
            id: schema.labTests.id,
            code: schema.labTests.code,
            name: schema.labTests.name,
            category: schema.labTests.category,
            isActive: schema.labTests.isActive,
            cataloguePrice: schema.labTests.price,
          })
          .from(schema.labTests)
          .where(eq(schema.labTests.facilityId, facility));

        const diagnostics = [];

        for (const test of tests) {
          const resolution = await billing.resolveTariffForCharge(db, {
            facilityId: facility,
            codes: codesForFamily({
              family: 'LABORATORY',
              code: test.code,
              name: test.name,
            }),
            serviceKeys: billingServiceKeys('LABORATORY', [test.code, test.name]),
            family: 'LABORATORY',
            serviceName: test.name,
            serviceType: 'LAB_TEST',
            serviceId: test.id,
          });

          diagnostics.push({
            testId: test.id,
            code: test.code,
            name: test.name,
            category: test.category,
            isActive: test.isActive,
            /*
             * The catalogue price is shown beside the tariff so the two
             * cannot be confused. It is NOT used for billing; the
             * invoice amount always comes from the tariff.
             */
            cataloguePrice: test.cataloguePrice,
            resolved: resolution.tariff
              ? {
                  tariffId: resolution.tariff.id,
                  code: resolution.tariff.code,
                  description: resolution.tariff.description,
                  fee: resolution.tariff.fee,
                  unit: resolution.tariff.unit,
                  rule: resolution.rule,
                }
              : null,
            failure: resolution.failure
              ? {
                  code: resolution.failure.code,
                  label: resolution.failure.label,
                  message: resolution.failure.message,
                  ...(resolution.failure.candidates
                    ? { candidates: resolution.failure.candidates }
                    : {}),
                }
              : null,
            codesTried: resolution.codesTried,
          });
        }

        return res.json({
          facilityId: facility,
          total: diagnostics.length,
          resolved: diagnostics.filter((entry) => entry.resolved !== null).length,
          unresolvable: diagnostics.filter((entry) => entry.resolved === null).length,
          tests: diagnostics,
        });
      } catch (error: unknown) {
        if (handleScopeError(error, res)) return;

        console.error('Laboratory diagnostics error:', error);
        return res.status(500).json({
          success: false,
          error: 'LAB_SERVICE_DIAGNOSTICS_FAILED',
        });
      }
    },
  );

  /**
   * Operational report: bed occupancy by ward and length of stay.
   *
   * Length of stay is measured from the admission date to now for
   * patients still in a bed, and from admission to discharge for those
   * discharged in the last 30 days.
   */
  app.get(
    '/api/reporting/operations',
    requirePermission('reports.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const facilityId = resolveFacilityScope(
          context,
          req.query.facilityId ? Number(req.query.facilityId) : undefined,
        );

        const report = await reporting.getOperationsReportScoped(context, facilityId);

        return res.json(report);
      } catch (err: unknown) {
        if (handleScopeError(err, res)) return;

        if (err instanceof queries.InpatientDomainError) {
          return res.status(err.status).json({
            success: false,
            error: err.code,
            message: err.message,
          });
        }

        console.error('Operational report error:', err);
        return res.status(500).json({
          success: false,
          error: 'OPERATIONS_REPORT_FAILED',
        });
      }
    },
  );

  /**
   * Occupied bed-days per calendar day, for the occupancy sparkline.
   * Defaults to 14 days, capped at 90 so a bad query string cannot ask
   * the server to walk years of admissions.
   */
  app.get(
    '/api/reporting/occupancy-trend',
    requirePermission('reports.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const facilityId = resolveFacilityScope(
          context,
          req.query.facilityId ? Number(req.query.facilityId) : undefined,
        );

        const requestedDays = Number(req.query.days);
        const days = Number.isFinite(requestedDays) ? requestedDays : 14;

        const points = await reporting.getOccupancyTrendScoped(context, facilityId, days);

        return res.json({ facilityId, days: points.length, points });
      } catch (err: unknown) {
        if (handleScopeError(err, res)) return;

        if (err instanceof queries.InpatientDomainError) {
          return res.status(err.status).json({
            success: false,
            error: err.code,
            message: err.message,
          });
        }

        console.error('Occupancy trend error:', err);
        return res.status(500).json({
          success: false,
          error: 'OCCUPANCY_TREND_FAILED',
        });
      }
    },
  );

  /**
   * Revenue by service category, derived from invoice lines.
   * Excludes voided invoices so the figures reconcile to cash.
   */
  app.get(
    '/api/analytics/revenue',
    requirePermission('reports.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const facilityId = resolveFacilityScope(
          context,
          req.query.facilityId ? Number(req.query.facilityId) : undefined,
        );

        /*
         * Optional reporting window. Anything unparseable is a 400
         * rather than a silently unbounded report.
         */
        /*
         * Build the date in SERVER-LOCAL time, not UTC.
         *
         * `new Date('2026-10-21')` is UTC midnight, which in Nairobi is
         * 03:00 on the 21st: a report run at 01:00 would silently drop
         * the first three hours of the day it was asked about.
         */
        const parseRangeDate = (value: unknown, field: string) => {
          if (typeof value !== 'string' || value.trim().length === 0) {
            return undefined;
          }

          const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());

          if (!match) {
            throw new Error(`INVALID_${field.toUpperCase()}_DATE`);
          }

          const year = Number(match[1]);
          const month = Number(match[2]);
          const day = Number(match[3]);

          const parsed = new Date(year, month - 1, day);

          /* Reject 2026-02-31, which Date would roll forward to March. */
          if (
            Number.isNaN(parsed.getTime()) ||
            parsed.getFullYear() !== year ||
            parsed.getMonth() !== month - 1 ||
            parsed.getDate() !== day
          ) {
            throw new Error(`INVALID_${field.toUpperCase()}_DATE`);
          }

          return parsed;
        };

        let from: Date | undefined;
        let to: Date | undefined;

        try {
          from = parseRangeDate(req.query.from, 'from');
          to = parseRangeDate(req.query.to, 'to');
        } catch {
          return res.status(400).json({
            success: false,
            error: 'INVALID_DATE_RANGE',
            message: 'from and to must be dates in YYYY-MM-DD format.',
          });
        }

        if (from && to && from.getTime() > to.getTime()) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_DATE_RANGE',
            message: 'from must not be after to.',
          });
        }

        const range = { from, to };

        const [rows, totals, channelSplit] = await Promise.all([
          billing.getRevenueByServiceType(db, facilityId, range),
          billing.getRevenueTotals(db, facilityId, range),
          billing.getRevenueByPaymentChannel(db, facilityId, range),
        ]);

        const totalCents = rows.reduce((sum, row) => sum + billing.toCents(row.revenue), 0);

        /*
         * The channel lines must add up to what the invoices say was
         * collected. When they do not, the report says so instead of
         * quietly presenting a split that does not reconcile.
         */
        const collectedCents = billing.toCents(totals.collected);
        const channelDifferenceCents = channelSplit.totalCents - collectedCents;

        const echoDate = (value: unknown) =>
          typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
            ? value.trim()
            : null;

        return res.json({
          facilityId,
          from: echoDate(req.query.from),
          to: echoDate(req.query.to),
          totalRevenue: billing.fromCents(totalCents),
          totals: {
            invoiceCount: totals.invoiceCount,
            voidedCount: totals.voidedCount,
            invoiced: billing.fromCents(billing.toCents(totals.invoiced)),
            collected: billing.fromCents(billing.toCents(totals.collected)),
            outstanding: billing.fromCents(billing.toCents(totals.outstanding)),
          },
          byService: rows
            .map((row) => ({
              ...row,
              revenue: billing.fromCents(billing.toCents(row.revenue)),
            }))
            .sort((a, b) => billing.toCents(b.revenue) - billing.toCents(a.revenue)),
          byChannel: channelSplit.channels,
          channelTotal: billing.fromCents(channelSplit.totalCents),
          channelReconciliation: {
            collected: billing.fromCents(collectedCents),
            difference: billing.fromCents(channelDifferenceCents),
            reconciled: channelDifferenceCents === 0,
            unmappedMethods: channelSplit.unmappedMethods,
          },
        });
      } catch (err: unknown) {
        if (handleScopeError(err, res)) return;

        console.error('Revenue report error:', err);
        return res.status(500).json({
          success: false,
          error: 'REVENUE_REPORT_FAILED',
        });
      }
    },
  );

  app.post(
    '/api/invoices',
    requirePermission('billing.create'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
            message: 'Authorization context is required.',
          });
        }

        const body = req.body;
        const invoiceInput = body?.invoice;
        const itemsInput = body?.items;

        if (!invoiceInput || typeof invoiceInput !== 'object' || Array.isArray(invoiceInput)) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_INVOICE',
            message: 'Invoice details are required.',
          });
        }

        const facilityIdInput = Number(invoiceInput.facilityId);
        if (!Number.isSafeInteger(facilityIdInput) || facilityIdInput <= 0) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_FACILITY_ID',
            message: 'A valid facility ID is required.',
          });
        }

        const facilityId = resolveFacilityScope(req.authContext, facilityIdInput);
        const facility = await queries.getFacilityByIdScoped(req.authContext, facilityId);

        if (!facility) {
          return res.status(404).json({
            success: false,
            error: 'FACILITY_NOT_FOUND',
            message: 'Facility not found.',
          });
        }

        if (
          !Array.isArray(facility.enabledModules) ||
          !facility.enabledModules.includes('finance')
        ) {
          return res.status(403).json({
            success: false,
            error: 'FACILITY_MODULE_DISABLED',
            module: 'finance',
            message: 'The finance module is disabled for this facility.',
          });
        }

        const patientId = Number(invoiceInput.patientId);
        if (!Number.isSafeInteger(patientId) || patientId <= 0) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_PATIENT_ID',
            message: 'A valid patient ID is required.',
          });
        }

        const patient = await queries.getPatientByIdScoped(req.authContext, patientId);

        if (!patient || patient.tenantId !== facility.tenantId) {
          return res.status(400).json({
            success: false,
            error: 'PATIENT_NOT_AVAILABLE',
            message: 'The patient is not available in this tenant scope.',
          });
        }

        const invoiceNumber =
          typeof invoiceInput.invoiceNumber === 'string' ? invoiceInput.invoiceNumber.trim() : '';

        if (!invoiceNumber || invoiceNumber.length > 100) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_INVOICE_NUMBER',
            message: 'A valid invoice number is required.',
          });
        }

        if (!Array.isArray(itemsInput) || itemsInput.length === 0 || itemsInput.length > 200) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_INVOICE_ITEMS',
            message: 'Provide between 1 and 200 invoice items.',
          });
        }

        let totalCents = 0;
        const safeItems: Array<{
          itemType: string;
          description: string;
          quantity: number;
          unitPrice: string;
          totalAmount: string;
          tariffId?: number | null;
          tariffCode?: string | null;
        }> = [];

        for (const item of itemsInput) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return res.status(400).json({
              success: false,
              error: 'INVALID_INVOICE_ITEM',
              message: 'An invoice item is invalid.',
            });
          }

          const quantity = Number(item.quantity);

          if (!Number.isSafeInteger(quantity) || quantity <= 0) {
            return res.status(400).json({
              success: false,
              error: 'INVALID_INVOICE_ITEM',
              message: 'Invoice item quantity must be a positive whole number.',
            });
          }

          // When a tariff is selected, the database is authoritative
          // for its code, description, department and unit fee.
          if (item.tariffId !== undefined && item.tariffId !== null) {
            const tariffId = item.tariffId;

            if (typeof tariffId !== 'number' || !Number.isSafeInteger(tariffId) || tariffId <= 0) {
              return res.status(400).json({
                success: false,
                error: 'INVALID_TARIFF_ID',
                message: 'A valid service tariff must be selected.',
              });
            }

            const [tariff] = await db
              .select()
              .from(schema.facilityServiceTariffs)
              .where(
                and(
                  eq(schema.facilityServiceTariffs.id, tariffId),
                  eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
                  eq(schema.facilityServiceTariffs.facilityId, facility.id),
                  eq(schema.facilityServiceTariffs.isActive, true),
                ),
              )
              .limit(1);

            if (!tariff) {
              return res.status(400).json({
                success: false,
                error: 'INVALID_OR_INACTIVE_TARIFF',
                message: 'The selected tariff is unavailable for this facility.',
              });
            }

            const tariffModule = tariffModuleForDepartment(tariff.department);

            if (!tariffModule || !facilityHasTariffModule(facility, tariffModule)) {
              return res.status(400).json({
                success: false,
                error: 'TARIFF_MODULE_DISABLED',
                message: 'The tariff department is not enabled for this facility.',
              });
            }

            const tariffFee = String(tariff.fee);

            if (!/^\d{1,8}(\.\d{1,2})?$/.test(tariffFee)) {
              console.error('Invalid stored tariff fee:', tariff.id);

              return res.status(500).json({
                success: false,
                error: 'INVALID_STORED_TARIFF',
                message: 'The saved tariff fee is invalid. Contact an administrator.',
              });
            }

            const unitCents = Math.round(Number(tariffFee) * 100);
            const lineCents = unitCents * quantity;

            if (
              !Number.isSafeInteger(unitCents) ||
              !Number.isSafeInteger(lineCents) ||
              !Number.isSafeInteger(totalCents + lineCents)
            ) {
              return res.status(400).json({
                success: false,
                error: 'INVOICE_AMOUNT_TOO_LARGE',
                message: 'The invoice amount exceeds the supported limit.',
              });
            }

            totalCents += lineCents;

            safeItems.push({
              itemType: tariff.department,
              description: tariff.description,
              quantity,
              unitPrice: (unitCents / 100).toFixed(2),
              totalAmount: (lineCents / 100).toFixed(2),
              tariffId: tariff.id,
              tariffCode: tariff.code,
            });

            continue;
          }

          // Legacy invoice items remain supported when tariffId is omitted.
          const itemType = typeof item.itemType === 'string' ? item.itemType.trim() : '';
          const description = typeof item.description === 'string' ? item.description.trim() : '';
          const unitPrice = Number(item.unitPrice);

          if (
            !itemType ||
            itemType.length > 100 ||
            !description ||
            description.length > 500 ||
            !Number.isFinite(unitPrice) ||
            unitPrice < 0 ||
            !/^\d+(\.\d{1,2})?$/.test(String(item.unitPrice))
          ) {
            return res.status(400).json({
              success: false,
              error: 'INVALID_INVOICE_ITEM',
              message: 'Invoice item descriptions, quantities, and prices must be valid.',
            });
          }

          const unitCents = Math.round(unitPrice * 100);
          const lineCents = unitCents * quantity;

          if (!Number.isSafeInteger(lineCents) || !Number.isSafeInteger(totalCents + lineCents)) {
            return res.status(400).json({
              success: false,
              error: 'INVOICE_AMOUNT_TOO_LARGE',
              message: 'The invoice amount exceeds the supported limit.',
            });
          }

          totalCents += lineCents;

          safeItems.push({
            itemType,
            description,
            quantity,
            unitPrice: (unitCents / 100).toFixed(2),
            totalAmount: (lineCents / 100).toFixed(2),
          });
        }
        const totalAmount = (totalCents / 100).toFixed(2);

        const created = await queries.createInvoice(
          {
            tenantId: facility.tenantId,
            facilityId,
            patientId,
            invoiceNumber,
            totalAmount,
            paidAmount: '0.00',
            balanceAmount: totalAmount,
            status: 'Pending',
            payerType:
              typeof invoiceInput.payerType === 'string'
                ? invoiceInput.payerType.slice(0, 50)
                : 'Self-Pay',
            payerName:
              typeof invoiceInput.payerName === 'string'
                ? invoiceInput.payerName.slice(0, 200)
                : null,
            memberNumber:
              typeof invoiceInput.memberNumber === 'string'
                ? invoiceInput.memberNumber.slice(0, 100)
                : null,
          },
          safeItems,
        );

        return res.status(201).json(created);
      } catch (err: unknown) {
        if (handleScopeError(err, res)) return;

        console.error('Failed to create invoice:', err);
        return res.status(500).json({
          success: false,
          error: 'INVOICE_CREATE_FAILED',
          message: 'Failed to create invoice.',
        });
      }
    },
  );

  app.post(
    '/api/billing/payments',
    requirePermission('billing.payments.record'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext || !req.user) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
            message: 'Authorization context is required.',
          });
        }

        const result = await billingPayments.recordSettledPayment(
          req.authContext,
          req.body,
          req.user.fullName,
        );

        return res.status(201).json(result);
      } catch (err: unknown) {
        if (handlePaymentError(err, res)) return;
        if (handleScopeError(err, res)) return;

        console.error('Failed to record payment:', err);
        return res.status(500).json({
          success: false,
          error: 'PAYMENT_RECORD_FAILED',
          message: 'Failed to record payment.',
        });
      }
    },
  );

  /*
   * Payment ledger for shift reconciliation: what came in, by which
   * method, under which transaction code.
   */
  app.get(
    '/api/billing/payments',
    requirePermission('billing.payments.record'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
            message: 'Authorization context is required.',
          });
        }

        const queryParam = (value: unknown): string | null =>
          typeof value === 'string' && value.trim() ? value.trim() : null;

        const payments = await billingPayments.getPaymentLedgerScoped(req.authContext, {
          facilityId: queryParam(req.query.facilityId),
          invoiceId: queryParam(req.query.invoiceId),
          method: queryParam(req.query.method),
          limit: queryParam(req.query.limit),
        });

        return res.json(payments);
      } catch (err: unknown) {
        if (handlePaymentError(err, res)) return;
        if (handleScopeError(err, res)) return;

        console.error('Failed to load payment ledger:', err);
        return res.status(500).json({
          success: false,
          error: 'PAYMENT_LEDGER_FAILED',
          message: 'Failed to load payments.',
        });
      }
    },
  );

  /*
   * =========================================================
   * INSURANCE CLAIMS
   * =========================================================
   *
   * Claims are drafted from real invoice lines, adjudicated when the
   * payer responds, and settled only when the approved money is actually
   * posted. Nothing here contacts SHA or any other payer.
   */

  app.get(
    '/api/claims',
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

        const claims = await insuranceClaims.getClaimsScoped(
          req.authContext,
          typeof req.query.facilityId === 'string' ? req.query.facilityId : null,
        );

        return res.json(claims);
      } catch (err: unknown) {
        if (handleClaimError(err, res)) return;

        console.error('Failed to load claims:', err);
        return res.status(500).json({
          success: false,
          error: 'CLAIMS_FETCH_FAILED',
          message: 'Failed to load insurance claims.',
        });
      }
    },
  );

  /*
   * The lines a claim could cover, plus any claim already open on the
   * invoice. The screen prefills its selection from this.
   */
  app.get(
    '/api/invoices/:id/claimable-lines',
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

        const result = await insuranceClaims.getClaimableLinesScoped(
          req.authContext,
          req.params.id,
          typeof req.query.facilityId === 'string' ? req.query.facilityId : null,
        );

        return res.json(result);
      } catch (err: unknown) {
        if (handleClaimError(err, res)) return;

        console.error('Failed to load claimable lines:', err);
        return res.status(500).json({
          success: false,
          error: 'CLAIM_LINES_FETCH_FAILED',
          message: 'Failed to load the invoice charges.',
        });
      }
    },
  );

  app.get(
    '/api/claims/:id/items',
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

        const items = await insuranceClaims.getClaimItemsScoped(
          req.authContext,
          req.params.id,
          typeof req.query.facilityId === 'string' ? req.query.facilityId : null,
        );

        return res.json(items);
      } catch (err: unknown) {
        if (handleClaimError(err, res)) return;

        console.error('Failed to load claim items:', err);
        return res.status(500).json({
          success: false,
          error: 'CLAIM_ITEMS_FETCH_FAILED',
          message: 'Failed to load the claim lines.',
        });
      }
    },
  );

  app.post(
    '/api/claims',
    requirePermission('insurance.claims.create'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext || !req.user) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
            message: 'Authorization context is required.',
          });
        }

        const result = await insuranceClaims.draftClaimScoped(
          req.authContext,
          req.body,
          req.user.id,
        );

        return res.status(201).json(result);
      } catch (err: unknown) {
        if (handleClaimError(err, res)) return;

        console.error('Failed to draft claim:', err);
        return res.status(500).json({
          success: false,
          error: 'CLAIM_CREATE_FAILED',
          message: 'Failed to draft the claim.',
        });
      }
    },
  );

  app.post(
    '/api/claims/:id/submit',
    requirePermission('insurance.claims.create'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
            message: 'Authorization context is required.',
          });
        }

        const claim = await insuranceClaims.submitClaimScoped(
          req.authContext,
          req.params.id,
          req.body?.facilityId ?? null,
        );

        return res.json(claim);
      } catch (err: unknown) {
        if (handleClaimError(err, res)) return;

        console.error('Failed to submit claim:', err);
        return res.status(500).json({
          success: false,
          error: 'CLAIM_SUBMIT_FAILED',
          message: 'Failed to mark the claim as submitted.',
        });
      }
    },
  );

  app.post(
    '/api/claims/:id/adjudicate',
    requirePermission('insurance.claims.manage'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
            message: 'Authorization context is required.',
          });
        }

        const claim = await insuranceClaims.adjudicateClaimScoped(
          req.authContext,
          req.params.id,
          req.body,
        );

        return res.json(claim);
      } catch (err: unknown) {
        if (handleClaimError(err, res)) return;

        console.error('Failed to adjudicate claim:', err);
        return res.status(500).json({
          success: false,
          error: 'CLAIM_ADJUDICATION_FAILED',
          message: 'Failed to record the adjudication.',
        });
      }
    },
  );

  /*
   * Settling posts the approved money against the invoice. This is the
   * only path that can move a claim to "Settled".
   */
  app.post(
    '/api/claims/:id/settle',
    requirePermission('insurance.claims.manage'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext || !req.user) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
            message: 'Authorization context is required.',
          });
        }

        const result = await insuranceClaims.settleClaimScoped(
          req.authContext,
          req.params.id,
          req.user.fullName,
          req.body?.facilityId ?? null,
        );

        return res.json(result);
      } catch (err: unknown) {
        if (handleClaimError(err, res)) return;

        console.error('Failed to settle claim:', err);
        return res.status(500).json({
          success: false,
          error: 'CLAIM_SETTLEMENT_FAILED',
          message: 'Failed to settle the claim.',
        });
      }
    },
  );

  /*
   * Legacy status endpoint. Kept so existing screens do not break, but
   * it now goes through the same state machine: "Settled" posts money.
   */
  app.put(
    '/api/claims/:id/status',
    requirePermission('insurance.claims.manage'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext || !req.user) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
            message: 'Authorization context is required.',
          });
        }

        const status = typeof req.body?.status === 'string' ? req.body.status.trim() : '';
        const facilityId = req.body?.facilityId ?? null;

        if (status === 'Submitted') {
          const claim = await insuranceClaims.submitClaimScoped(
            req.authContext,
            req.params.id,
            facilityId,
          );

          return res.json(claim);
        }

        if (status === 'Approved' || status === 'Rejected') {
          const claim = await insuranceClaims.adjudicateClaimScoped(
            req.authContext,
            req.params.id,
            {
              approvedAmount: status === 'Rejected' ? 0 : req.body?.approvedAmount,
              notes: req.body?.notes,
              facilityId,
            },
          );

          return res.json(claim);
        }

        if (status === 'Settled') {
          const result = await insuranceClaims.settleClaimScoped(
            req.authContext,
            req.params.id,
            req.user.fullName,
            facilityId,
          );

          return res.json(result.claim);
        }

        return res.status(400).json({
          success: false,
          error: 'INVALID_TRANSITION',
          message: 'A claim cannot be set back to Draft. Use submit, adjudicate or settle.',
        });
      } catch (err: unknown) {
        if (handleClaimError(err, res)) return;

        console.error('Failed to update claim status:', err);
        return res.status(500).json({
          success: false,
          error: 'CLAIM_UPDATE_FAILED',
          message: 'Failed to update insurance claim.',
        });
      }
    },
  );

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
  app.get(
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

        const probe = String(req.query.probe ?? 'true') !== 'false';
        const report = await buildReadinessReport({ probe });

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

  app.get(
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

  app.put(
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

  app.get(
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

  app.get(
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

  app.post(
    '/api/integrations/dha/patients/:id/eligibility',
    requirePermission('patients.read'),
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

  app.get(
    '/api/integrations/dha/patients/:id/coverage',
    requirePermission('patients.read'),
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

  // PUBLIC HEALTH & KHIS SURVEILLANCE
  // =========================================================

  app.get(
    '/api/public-health/reports',
    requirePermission('reports.read'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
            message: 'Authorization context is required.',
          });
        }

        const rawFacilityId = req.query.facilityId;

        if (
          rawFacilityId !== undefined &&
          (typeof rawFacilityId !== 'string' || !/^[1-9]\d*$/.test(rawFacilityId))
        ) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_FACILITY_ID',
            message: 'facilityId must be a positive integer.',
          });
        }

        const requestedFacilityId = rawFacilityId === undefined ? undefined : Number(rawFacilityId);

        const facilityId = resolveFacilityScope(req.authContext, requestedFacilityId);

        const facility = await queries.getFacilityByIdScoped(req.authContext, facilityId);

        if (!facility) {
          return res.status(404).json({
            success: false,
            error: 'FACILITY_NOT_FOUND',
            message: 'The requested facility was not found.',
          });
        }

        const reports = await queries.getPublicHealthReports(facility.id);

        return res.json(reports);
      } catch (err: unknown) {
        if (handleScopeError(err, res)) return;

        console.error('Failed to fetch public-health reports:', err);
        return res.status(500).json({
          success: false,
          error: 'PUBLIC_HEALTH_REPORTS_FETCH_FAILED',
          message: 'Failed to fetch public-health reports.',
        });
      }
    },
  );

  app.post(
    '/api/public-health/reports',
    requirePermission('public_health.reports.create'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
            message: 'Authorization context is required.',
          });
        }

        const body: unknown = req.body;

        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_REPORT_BODY',
            message: 'A valid report object is required.',
          });
        }

        const input = body as Record<string, unknown>;

        let requestedFacilityId: number | undefined;

        if (input.facilityId !== undefined) {
          if (
            typeof input.facilityId !== 'number' ||
            !Number.isSafeInteger(input.facilityId) ||
            input.facilityId <= 0
          ) {
            return res.status(400).json({
              success: false,
              error: 'INVALID_FACILITY_ID',
              message: 'facilityId must be a positive integer.',
            });
          }

          requestedFacilityId = input.facilityId;
        }

        if (
          typeof input.diseaseCode !== 'string' ||
          !input.diseaseCode.trim() ||
          input.diseaseCode.trim().length > 50 ||
          typeof input.diseaseName !== 'string' ||
          !input.diseaseName.trim() ||
          input.diseaseName.trim().length > 200 ||
          typeof input.epiWeek !== 'string' ||
          !/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(input.epiWeek)
        ) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_REPORT_FIELDS',
            message: 'Valid diseaseCode, diseaseName, and epiWeek are required.',
          });
        }

        const casesCount = input.casesCount === undefined ? 1 : input.casesCount;

        const mortalityCount = input.mortalityCount === undefined ? 0 : input.mortalityCount;

        const ageGroup = input.ageGroup === undefined ? 'Over 5 Years' : input.ageGroup;

        if (
          typeof casesCount !== 'number' ||
          !Number.isSafeInteger(casesCount) ||
          casesCount < 1 ||
          typeof mortalityCount !== 'number' ||
          !Number.isSafeInteger(mortalityCount) ||
          mortalityCount < 0 ||
          mortalityCount > casesCount ||
          typeof ageGroup !== 'string' ||
          !ageGroup.trim() ||
          ageGroup.trim().length > 100
        ) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_REPORT_COUNTS',
            message: 'Report counts and ageGroup are invalid.',
          });
        }

        const facilityId = resolveFacilityScope(req.authContext, requestedFacilityId);

        const facility = await queries.getFacilityByIdScoped(req.authContext, facilityId);

        if (!facility) {
          return res.status(404).json({
            success: false,
            error: 'FACILITY_NOT_FOUND',
            message: 'The requested facility was not found.',
          });
        }

        const report = await queries.recordPublicHealthReport({
          facilityId: facility.id,
          diseaseCode: input.diseaseCode.trim(),
          diseaseName: input.diseaseName.trim(),
          casesCount,
          mortalityCount,
          ageGroup: ageGroup.trim(),
          epiWeek: input.epiWeek,
          reportedBy: String(req.authContext.userId),
        });

        return res.status(201).json(report);
      } catch (err: unknown) {
        if (handleScopeError(err, res)) return;

        console.error('Failed to record public-health report:', err);
        return res.status(500).json({
          success: false,
          error: 'PUBLIC_HEALTH_REPORT_CREATE_FAILED',
          message: 'Failed to record the public-health report.',
        });
      }
    },
  );
  // =========================================================
  // AUDIT TRAIL
  // =========================================================

  app.get(
    '/api/audit-logs',
    requirePermission('audit.read'),
    async (req: AuthRequest, res: Response) => {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
        });
      }

      const rawFacilityId = req.query.facilityId;
      let facilityId: number | undefined;

      if (rawFacilityId !== undefined) {
        if (
          typeof rawFacilityId !== 'string' ||
          !/^[1-9]\d*$/.test(rawFacilityId) ||
          !Number.isSafeInteger(Number(rawFacilityId))
        ) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_FACILITY_ID',
            message: 'facilityId must be a positive integer.',
          });
        }

        facilityId = Number(rawFacilityId);
      }

      const context = req.authContext;

      if (
        !context.isSuperAdmin &&
        context.facilityId !== null &&
        facilityId !== undefined &&
        facilityId !== context.facilityId
      ) {
        return res.status(403).json({
          success: false,
          error: 'FACILITY_ACCESS_DENIED',
          message: "You cannot view another facility's audit logs.",
        });
      }

      try {
        const list = await queries.getAuditLogs(context, facilityId);
        return res.json(list);
      } catch (err: unknown) {
        console.error('Failed to fetch audit logs:', err);

        return res.status(500).json({
          success: false,
          error: 'AUDIT_LOG_FETCH_FAILED',
          message: 'Unable to retrieve audit logs.',
        });
      }
    },
  );
  // =========================================================
  // DHA & INTEROPERABILITY
  // =========================================================

  app.get(
    '/api/interop/fhir/patient/:id',
    requirePermission('interop.fhir.patient.read'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
          });
        }

        const patientId = Number(req.params.id);

        if (!Number.isInteger(patientId) || patientId <= 0) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_PATIENT_ID',
          });
        }

        const patient = await queries.getPatientByIdScoped(req.authContext, patientId);

        if (!patient) {
          return res.status(404).json({
            success: false,
            error: 'PATIENT_NOT_FOUND',
          });
        }

        const fhirPatient = {
          resourceType: 'Patient',
          id: `ke-hmis-${patient.id}`,
          meta: {
            versionId: '1',
            lastUpdated: patient.updatedAt
              ? new Date(patient.updatedAt).toISOString()
              : new Date().toISOString(),
            profile: ['http://hl7.org/fhir/StructureDefinition/Patient'],
          },
          identifier: [
            {
              system: 'http://health.go.ke/mrn',
              value: patient.mrn,
              use: 'usual',
            },
            ...(patient.nationalId
              ? [
                  {
                    system: 'http://identity.go.ke/national-id',
                    value: patient.nationalId,
                    type: { text: 'National ID' },
                  },
                ]
              : []),
            ...(patient.shaNumber
              ? [
                  {
                    system: 'http://sha.go.ke/member-number',
                    value: patient.shaNumber,
                    type: {
                      text: 'Social Health Authority',
                    },
                  },
                ]
              : []),
          ],
          name: [
            {
              use: 'official',
              family: patient.lastName,
              given: [patient.firstName, ...(patient.middleName ? [patient.middleName] : [])],
            },
          ],
          telecom: [
            ...(patient.phone
              ? [
                  {
                    system: 'phone',
                    value: patient.phone,
                    use: 'mobile',
                  },
                ]
              : []),
            ...(patient.email
              ? [
                  {
                    system: 'email',
                    value: patient.email,
                  },
                ]
              : []),
          ],
          gender:
            patient.gender?.toLowerCase() === 'female'
              ? 'female'
              : patient.gender?.toLowerCase() === 'male'
                ? 'male'
                : 'unknown',
          ...(patient.dateOfBirth ? { birthDate: patient.dateOfBirth } : {}),
          address: [
            {
              ...(patient.residentialAddress ? { line: [patient.residentialAddress] } : {}),
              ...(patient.subCounty ? { city: patient.subCounty } : {}),
              ...(patient.county ? { district: patient.county } : {}),
              country: 'KEN',
            },
          ],
          managingOrganization: {
            reference: `Organization/facility-${patient.registrationFacilityId}`,
          },
        };

        await logPatientAccess({
          context: req.authContext,
          patientId: patient.id,
          tenantId: patient.tenantId,
          facilityId: patient.registrationFacilityId,
          action: 'EXPORT',
          channel: 'FHIR',
          purpose: 'FHIR_EXCHANGE',
          recordType: 'Patient',
          request: {
            ipAddress: req.ip ?? null,
            userAgent: req.get('user-agent') ?? null,
          },
        });

        res.setHeader('Content-Type', 'application/fhir+json');
        return res.json(fhirPatient);
      } catch (err: unknown) {
        if (handleScopeError(err, res)) return;

        console.error('FHIR patient retrieval error:', err);
        return res.status(500).json({
          success: false,
          error: 'FHIR_PATIENT_RETRIEVAL_FAILED',
        });
      }
    },
  );

  app.get(
    '/api/interop/dha/moh-705',
    requirePermission('reports.read'),
    async (req: AuthRequest, res: Response) => {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
        });
      }

      return res.status(501).json({
        success: false,
        error: 'MOH705_REPORT_NOT_IMPLEMENTED',
        message:
          'The report is unavailable until verified reporting data, facility identifiers, reporting periods, and scoped queries are implemented.',
      });
    },
  );

  // =========================================================
  // AGGREGATED ANALYTICS
  // =========================================================

  app.get(
    '/api/analytics/summary',
    requirePermission('reports.read'),
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
          });
        }

        const rawFacilityId = req.query.facilityId;
        if (typeof rawFacilityId !== 'string' || !/^[1-9]\d*$/.test(rawFacilityId)) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_FACILITY_ID',
            message: 'A valid facilityId is required.',
          });
        }

        const requestedFacilityId = Number(rawFacilityId);
        if (!Number.isSafeInteger(requestedFacilityId)) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_FACILITY_ID',
          });
        }

        const facility = await queries.getFacilityByIdScoped(req.authContext, requestedFacilityId);

        if (!facility) {
          return res.status(404).json({
            success: false,
            error: 'FACILITY_NOT_FOUND',
          });
        }

        const tenantId = facility.tenantId;
        const facilityId = facility.id;

        /* Today + 30 days, as the ISO text expiry_date stores. */
        const horizon = new Date();
        horizon.setDate(horizon.getDate() + 30);

        const expiryHorizon = [
          horizon.getFullYear(),
          String(horizon.getMonth() + 1).padStart(2, '0'),
          String(horizon.getDate()).padStart(2, '0'),
        ].join('-');

        const [
          patientRows,
          queueRows,
          admissionRows,
          bedRows,
          surgeryRows,
          labRows,
          invoiceRows,
          inventoryRows,
          expiringRows,
        ] = await Promise.all([
          db
            .select({ value: count() })
            .from(schema.patients)
            .where(
              and(
                eq(schema.patients.tenantId, tenantId),
                eq(schema.patients.registrationFacilityId, facilityId),
              ),
            ),

          db
            .select({ value: count() })
            .from(schema.queues)
            .where(
              and(
                eq(schema.queues.tenantId, tenantId),
                eq(schema.queues.facilityId, facilityId),
                sql`lower(coalesce(${schema.queues.status}, 'waiting')) IN ('waiting', 'in progress', 'serving')`,
              ),
            ),

          db
            .select({ value: count() })
            .from(schema.admissions)
            .where(
              and(
                eq(schema.admissions.tenantId, tenantId),
                eq(schema.admissions.facilityId, facilityId),
                sql`lower(coalesce(${schema.admissions.status}, 'admitted')) = 'admitted'`,
              ),
            ),

          db
            .select({
              total: count(),
              occupied: sql<number>`count(*) FILTER (WHERE lower(coalesce(${schema.beds.status}, '')) = 'occupied')`,
            })
            .from(schema.beds)
            .innerJoin(schema.wards, eq(schema.beds.wardId, schema.wards.id))
            .where(eq(schema.wards.facilityId, facilityId)),

          db
            .select({ value: count() })
            .from(schema.theatreCases)
            .where(
              and(
                eq(schema.theatreCases.tenantId, tenantId),
                eq(schema.theatreCases.facilityId, facilityId),
                sql`lower(coalesce(${schema.theatreCases.status}, '')) = 'scheduled'`,
              ),
            ),

          db
            .select({ value: count() })
            .from(schema.labOrders)
            .where(
              and(
                eq(schema.labOrders.tenantId, tenantId),
                eq(schema.labOrders.facilityId, facilityId),
                sql`lower(coalesce(${schema.labOrders.status}, 'ordered')) NOT IN ('completed', 'cancelled', 'canceled', 'reported', 'rejected')`,
              ),
            ),

          db
            .select({
              revenue: sum(schema.billingInvoices.paidAmount),
              outstanding: sum(schema.billingInvoices.balanceAmount),
            })
            .from(schema.billingInvoices)
            .where(
              and(
                eq(schema.billingInvoices.tenantId, tenantId),
                eq(schema.billingInvoices.facilityId, facilityId),
              ),
            ),

          db
            .select({ value: count() })
            .from(schema.inventoryItems)
            .where(
              and(
                eq(schema.inventoryItems.facilityId, facilityId),
                eq(schema.inventoryItems.isActive, true),
                sql`${schema.inventoryItems.currentStock} <= coalesce(${schema.inventoryItems.reorderLevel}, 0)`,
              ),
            ),

          /*
           * Batches already expired or expiring within 30 days that
           * still hold stock. expiry_date is stored as ISO text, so a
           * lexicographic comparison is also a chronological one.
           */
          db
            .select({ value: count() })
            .from(schema.inventoryBatches)
            .innerJoin(
              schema.inventoryItems,
              eq(schema.inventoryBatches.itemId, schema.inventoryItems.id),
            )
            .where(
              and(
                eq(schema.inventoryItems.facilityId, facilityId),
                sql`${schema.inventoryBatches.quantityRemaining} > 0`,
                sql`${schema.inventoryBatches.expiryDate} <= ${expiryHorizon}`,
              ),
            ),
        ]);

        const totalBeds = Number(bedRows[0]?.total ?? 0);
        const occupiedBeds = Number(bedRows[0]?.occupied ?? 0);

        return res.json({
          totalPatients: Number(patientRows[0]?.value ?? 0),
          activeQueuesCount: Number(queueRows[0]?.value ?? 0),
          currentAdmissions: Number(admissionRows[0]?.value ?? 0),
          bedOccupancyRate: totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 1000) / 10 : 0,
          scheduledSurgeries: Number(surgeryRows[0]?.value ?? 0),
          pendingLabOrders: Number(labRows[0]?.value ?? 0),
          totalRevenueKes: Number(invoiceRows[0]?.revenue ?? 0),
          outstandingBillsKes: Number(invoiceRows[0]?.outstanding ?? 0),
          lowStockAlerts: Number(inventoryRows[0]?.value ?? 0),
          expiringStockAlerts: Number(expiringRows[0]?.value ?? 0),
        });
      } catch (err: unknown) {
        if (handleScopeError(err, res)) return;

        console.error('Analytics summary error:', err);
        return res.status(500).json({
          success: false,
          error: 'ANALYTICS_SUMMARY_FAILED',
          message: 'Unable to load the facility analytics summary.',
        });
      }
    },
  );
  // VITE MIDDLEWARE / STATIC ASSETS
  // =========================================================

  if (!isProduction) {
    /*
     * Vite is imported HERE, not at the top of the file.
     *
     * A static `import 'vite'` makes every production process load Vite
     * and its whole tree — esbuild, the bundler, the CSS pipeline — into
     * memory and spin up its service threads, only to serve a predist
     * folder that `vite build` already wrote. On a shared cPanel account
     * with a low thread and memory ceiling that is a real cost, and it is
     * paid on every restart.
     *
     * It also removes the dev server from the production dependency
     * graph entirely, which is the property we actually want: there is no
     * code path in production that can start Vite.
     */
    const { createServer: createViteServer } = await import('vite');

    const vite = await createViteServer({
      server: {
        middlewareMode: true,
      },

      appType: 'spa',
    });

    app.use(vite.middlewares);
  } else {
    const indexHtml = path.join(STATIC_DIR, 'index.html');

    const hasClientBuild = existsSync(indexHtml);

    if (!hasClientBuild) {
      /*
       * Serving nothing silently is how a deployment shows a working API
       * and a blank page. Say exactly which path is missing and how it is
       * produced, then keep serving the API: a missing frontend must not
       * take the clinical endpoints down with it.
       */
      console.error('');
      console.error('No client build found.');
      console.error(`  Looked for: ${indexHtml}`);
      console.error('  Build it with: npm run build   (vite build -> dist/)');
      console.error('  Or point STATIC_DIR at the directory that holds index.html.');
      console.error('');
    } else {
      /*
       * Hashed assets are immutable and can be cached for a year;
       * index.html must not be cached or a client keeps loading the old
       * bundle after a deploy.
       */
      app.use(
        express.static(STATIC_DIR, {
          index: false,
          etag: true,
          lastModified: true,
          maxAge: '1y',
          immutable: true,
          setHeaders(res, filePath) {
            if (filePath.endsWith('index.html')) {
              res.setHeader('Cache-Control', 'no-store');
            }
          },
        }),
      );
    }

    /*
     * Client-side routes fall through to the SPA. An unmatched /api
     * path must not: answering JSON with HTML is worse than a 404, and
     * the client cannot tell a typo from an outage.
     */
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({
          success: false,
          error: 'NOT_FOUND',
          message: `No API route matches ${req.method} ${req.path}.`,
        });

        return;
      }

      if (!hasClientBuild) {
        res
          .status(503)
          .type('text/plain')
          .send(
            'The client build is missing on this server. Run npm run build and restart the application.',
          );

        return;
      }

      /*
       * The shell must never be cached: a client holding yesterday's
       * index.html asks for yesterday's asset hashes, and after a deploy
       * that is a blank page served from a cache nobody can clear.
       */
      res.setHeader('Cache-Control', 'no-store, must-revalidate');

      res.sendFile(indexHtml, (error) => {
        if (error) next(error);
      });
    });
  }

  // =========================================================

  /*
   * =========================================================
   * CATCH-ALL ERROR HANDLER
   * =========================================================
   *
   * Without this, an error thrown inside a route that did not handle it
   * reaches Express's default handler, which answers with an HTML page
   * containing the stack trace and the file paths. To a client that
   * expects JSON that is a parse failure; to anyone else it is a map of
   * the server.
   *
   * The response is deliberately uniform: a status and a correlation id.
   * Not the message, because a database error message contains table and
   * column names, and not the stack, because it contains paths. The full
   * detail goes to the log, where the correlation id joins it to the
   * request line, and an operator can read it.
   *
   * A 4xx is the client's problem and is logged at warn; a 5xx is ours and
   * is logged at error with the stack.
   */
  app.use(
    (
      error: Error & { status?: number; statusCode?: number; type?: string },
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      /* A response already started cannot be replaced with JSON; the only
       * correct move is to let Express close the connection. */
      if (res.headersSent) {
        next(error);

        return;
      }

      const correlationId = String(res.getHeader('X-Correlation-Id') ?? '');

      /* A malformed JSON body is a client mistake, not a server fault, and
       * answering 500 for it sends operators looking for an outage. */
      const isBadJson = error.type === 'entity.parse.failed';
      const isTooLarge = error.type === 'entity.too.large';

      const status = isBadJson ? 400 : isTooLarge ? 413 : (error.status ?? error.statusCode ?? 500);

      const detail = {
        correlationId,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status,
        err: error,
      };

      if (status >= 500) {
        appLog.error(detail, 'unhandled.error');
      } else {
        appLog.warn(detail, 'request.bad_input');
      }

      res.status(status).json({
        error:
          status >= 500
            ? 'An internal error occurred. Quote the correlation id when reporting it.'
            : isBadJson
              ? 'The request body is not valid JSON.'
              : isTooLarge
                ? 'The request body is too large.'
                : 'The request could not be processed.',
        /* Never the message and never the stack. The id is the whole
         * contract between the client and the log. */
        correlationId,
      });
    },
  );

  return app;
}
