import staffInvitationRoutes from "./auth/staff-invitation.routes";
import staffRolesRoutes from "./auth/staff-roles.routes";
import express, { type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
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
import {
  ScopeAccessError,
  resolveFacilityScope,
} from './auth/scope.service.ts';

import * as billing from './billing/billing.service.ts';
import * as billingPayments from './billing/payments.service.ts';
import {
  chargeLabOrderBatch,
  radiologyChargeRequest,
  tariffCodeCandidates,
} from './billing/service-charges.ts';
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
import * as wardBed from './inpatient/ward-bed.service.ts';

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
   * HEALTH CHECK
   * =========================================================
   *
   * This remains PUBLIC.
   *
   * It can be used by:
   * - monitoring systems
   * - load balancers
   * - deployment health checks
   */
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'healthy',
      system: 'JaliCare Kenya HMIS',
      dhaReadiness: 'Not assessed',
      timestamp: new Date().toISOString(),
    });
  });

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
app.use('/api', requireAuth);
app.use('/api', requireAuthorization);

app.use('/api/platform', platformRoutes);
app.use("/api/staff-invitations", staffInvitationRoutes);
app.use("/api/staff-roles", staffRolesRoutes);

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

/*
 * Patient digital health record portal.
 *
 * `/api/portal` is the patient surface: activation and login are public,
 * everything else needs a patient session, and no route in it accepts a
 * staff token. `/api/portal/admin` is the staff surface and is behind
 * `requireAuth` inside its own router.
 *
 * Mounted before the module gates because a patient account does not
 * belong to a facility module — a patient must be able to reach their
 * record even if the facility has, say, switched off the pharmacy.
 */
app.use('/api/portal/admin', portalAdminRoutes);
app.use('/api/portal', portalRoutes);

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

  /*
   * =========================================================
   * SCOPE ERROR HANDLER
   * =========================================================
   *
   * Converts authorization/scope failures into a proper 403.
   *
   * This prevents scope violations from becoming generic
   * 500 server errors.
   */
  const handleScopeError = (
    error: unknown,
    res: Response,
  ): boolean => {
    if (
      error instanceof ScopeAccessError
    ) {
      /*
       * A missing target facility is the caller's omission, not a
       * refusal: a superadmin who did not choose a facility gets 400,
       * not 403, so the client can prompt for one.
       */
      const status =
        error.code === 'FACILITY_REQUIRED' ||
        error.code === 'INVALID_SCOPE_ID'
          ? 400
          : 403;

      res.status(status).json({
        success: false,
        error: error.code,
        message: error.message,
      });

      return true;
    }

    return false;
  };

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

    const isEmpty =
      rawFacilityId === undefined ||
      rawFacilityId === null ||
      rawFacilityId === '';

    const parsed = isEmpty ? undefined : Number(rawFacilityId);

    if (
      parsed !== undefined &&
      (!Number.isSafeInteger(parsed) || parsed <= 0)
    ) {
      res.status(400).json({
        success: false,
        error: 'INVALID_FACILITY_ID',
        message: 'facilityId must be a positive integer.',
      });

      return null;
    }

    try {
      const facilityId = resolveFacilityScope(context, parsed);

      const facility = await queries.getFacilityByIdScoped(
        context,
        facilityId,
      );

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
  const handleDhaError = (
    error: unknown,
    res: Response,
  ): boolean => {
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
  const handleClaimError = (
    error: unknown,
    res: Response,
  ): boolean => {
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
  const handlePaymentError = (
    error: unknown,
    res: Response,
  ): boolean => {
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
  const handleInpatientError = (
    error: unknown,
    res: Response,
  ): boolean => {
    if (handleScopeError(error, res)) return true;

    if (error instanceof queries.InpatientDomainError) {
      res.status(error.status).json({
        success: false,
        error: error.code,
        message: error.message,
      });

      return true;
    }

    return false;
  };

  /**
   * Maps maternity domain failures onto their HTTP status.
   *
   *   400 invalid input, with the field errors that caused it
   *   404 a record outside the caller's scope (indistinguishable from absent)
   *   409 a state conflict: already delivered, labour already open, a
   *       duplicate partograph reading
   *
   * Returns false for anything else so the caller keeps HTTP 500.
   */
  const handleMaternityError = (
    error: unknown,
    res: Response,
  ): boolean => {
    if (handleScopeError(error, res)) return true;

    if (error instanceof maternity.MaternityDomainError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.code,
        message: error.message,
        ...(error.fields && error.fields.length > 0
          ? { fields: error.fields }
          : {}),
      });

      return true;
    }

    return false;
  };

  /**
   * Maps immunisation failures onto their HTTP status.
   *
   * 400 an antigen outside the schedule, a future date, an impossible
   *     dose number; 404 a patient outside the caller's scope; 409 a dose
   *     the database has already seen.
   */
  const handleImmunisationError = (
    error: unknown,
    res: Response,
  ): boolean => {
    if (handleScopeError(error, res)) return true;

    if (error instanceof immunisation.ImmunisationDomainError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.code,
        message: error.message,
      });

      return true;
    }

    return false;
  };

  /**
   * Maps pharmacy stock failures onto their intended HTTP status.
   *
   *   400 invalid input or an already-expired batch
   *   404 item or patient not found inside the authorised scope
   *   409 insufficient unexpired stock
   *
   * Returns false for unexpected errors so the caller keeps HTTP 500.
   */
  const handleInventoryError = (
    error: unknown,
    res: Response,
  ): boolean => {
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
  const chargeSafely = async (
    request: billing.ChargeRequest,
  ): Promise<billing.ChargeResult | null> => {
    try {
      return await billing.chargeForService(db, request);
    } catch (error: unknown) {
      console.error('Billing charge failed:', error);

      return {
        charged: false,
        reason: 'INVALID_INPUT',
        message: 'The service was recorded but could not be billed.',
      };
    }
  };

  /**
   * Maps known encounter input-validation errors to HTTP 400.
   * Unexpected errors must remain HTTP 500.
   */
  const handleEncounterValidationError = (
    error: unknown,
    res: Response,
  ): boolean => {
    if (!(error instanceof Error)) {
      return false;
    }

    const validationMessages = new Set([
      "A valid patient ID is required.",
      "Patient not found.",
      "Invalid practitioner ID.",
      "Invalid department ID.",
      "Invalid encounter ID.",
      "Changing the patient on an existing encounter is not allowed. Use the authorized patient-correction workflow.",
    ]);

    if (!validationMessages.has(error.message)) {
      return false;
    }

    const errorCodeByMessage: Record<string, string> = {
      "A valid patient ID is required.": "INVALID_PATIENT_ID",
      "Patient not found.": "PATIENT_NOT_FOUND",
      "Invalid practitioner ID.": "INVALID_PRACTITIONER_ID",
      "Invalid department ID.": "INVALID_DEPARTMENT_ID",
      "Invalid encounter ID.": "INVALID_ENCOUNTER_ID",
      "Changing the patient on an existing encounter is not allowed. Use the authorized patient-correction workflow.": "PATIENT_REASSIGNMENT_NOT_ALLOWED",
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

  app.get(
    '/api/tenants',
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
            message: 'Authorization context is required.',
          });
        }

        const list =
          await queries.getTenantsScoped(
            req.authContext,
          );

        res.json(list);
      } catch (err: any) {
        if (
          handleScopeError(
            err,
            res,
          )
        ) {
          return;
        }

        res.status(500).json({
          error:
            err.message ||
            'Failed to fetch tenants',
        });
      }
    },
  );

  app.get(
    '/api/tenants/:id',
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
            message: 'Authorization context is required.',
          });
        }

        const tenantId =
          Number(req.params.id);

        if (
          !Number.isInteger(tenantId) ||
          tenantId <= 0
        ) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_TENANT_ID',
            message: 'Invalid tenant ID.',
          });
        }

        const tenant =
          await queries.getTenantByIdScoped(
            req.authContext,
            tenantId,
          );

        if (!tenant) {
          return res.status(404).json({
            error: 'Tenant not found',
          });
        }

        res.json(tenant);
      } catch (err: any) {
        if (
          handleScopeError(
            err,
            res,
          )
        ) {
          return;
        }

        res.status(500).json({
          error:
            err.message ||
            'Failed to fetch tenant',
        });
      }
    },
  );

  app.get(
    '/api/facilities',
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
            message: 'Authorization context is required.',
          });
        }

        const tenantId =
          req.query.tenantId !== undefined
            ? Number(req.query.tenantId)
            : undefined;

        if (
          tenantId !== undefined &&
          (
            !Number.isInteger(tenantId) ||
            tenantId <= 0
          )
        ) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_TENANT_ID',
            message: 'Invalid tenant ID.',
          });
        }

        const list =
          await queries.getFacilitiesScoped(
            req.authContext,
            tenantId,
          );

        res.json(list);
      } catch (err: any) {
        if (
          handleScopeError(
            err,
            res,
          )
        ) {
          return;
        }

        res.status(500).json({
          error:
            err.message ||
            'Failed to fetch facilities',
        });
      }
    },
  );

  app.get(
    '/api/facilities/:id',
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.authContext) {
          return res.status(401).json({
            success: false,
            error: 'AUTHORIZATION_CONTEXT_MISSING',
            message: 'Authorization context is required.',
          });
        }

        const facilityId =
          Number(req.params.id);

        if (
          !Number.isInteger(facilityId) ||
          facilityId <= 0
        ) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_FACILITY_ID',
            message: 'Invalid facility ID.',
          });
        }

        const facility =
          await queries.getFacilityByIdScoped(
            req.authContext,
            facilityId,
          );

        if (!facility) {
          return res.status(404).json({
            error: 'Facility not found',
          });
        }

        res.json(facility);
      } catch (err: any) {
        if (
          handleScopeError(
            err,
            res,
          )
        ) {
          return;
        }

        res.status(500).json({
          error:
            err.message ||
            'Failed to fetch facility',
        });
      }
    },
  );

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

        const facilityId = req.query.facilityId
          ? Number(req.query.facilityId)
          : undefined;

        if (
          facilityId !== undefined &&
          (!Number.isInteger(facilityId) || facilityId <= 0)
        ) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_FACILITY_ID',
          });
        }

        const list = await queries.getDepartmentsScoped(
          req.authContext,
          facilityId,
        );

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

      const tenantId =
        req.query.tenantId !== undefined
          ? Number(req.query.tenantId)
          : undefined;

      const facilityId =
        req.query.facilityId !== undefined
          ? Number(req.query.facilityId)
          : undefined;

      if (
        (tenantId !== undefined &&
          (!Number.isInteger(tenantId) || tenantId <= 0)) ||
        (facilityId !== undefined &&
          (!Number.isInteger(facilityId) || facilityId <= 0))
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
        typeof req.query.search === 'string'
          ? req.query.search
          : undefined,
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
  });

  app.get('/api/patients/:id', requirePermission('patients.read'), async (req: AuthRequest, res: Response) => {
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

      const patient = await queries.getPatientByIdScoped(
        req.authContext,
        patientId,
      );

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
  });

  app.post('/api/patients', requirePermission('patients.create'), async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
        });
      }

      const patient = await queries.createPatientScoped(
        req.authContext,
        req.body,
      );

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
  });

  app.put('/api/patients/:id', requirePermission('patients.update'), async (req: AuthRequest, res: Response) => {
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

      const patient = await queries.updatePatientScoped(
        req.authContext,
        patientId,
        req.body,
      );

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
  });

  // =========================================================
  // CLINICAL ENCOUNTERS
  // =========================================================

  app.get('/api/encounters', requirePermission('clinical.read'), async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
        });
      }

      const patientId = req.query.patientId === undefined
        ? undefined
        : Number(req.query.patientId);
      const facilityId = req.query.facilityId === undefined
        ? undefined
        : Number(req.query.facilityId);

      if (patientId !== undefined &&
          (!Number.isSafeInteger(patientId) || patientId <= 0)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_PATIENT_ID',
        });
      }

      if (facilityId !== undefined &&
          (!Number.isSafeInteger(facilityId) || facilityId <= 0)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_FACILITY_ID',
        });
      }

      const list = await queries.getEncountersScoped(
        req.authContext,
        patientId,
        facilityId,
      );

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
  });

  app.post('/api/encounters', requirePermission('clinical.create'), async (req: AuthRequest, res: Response) => {
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

      const encounter = await queries.createEncounterScoped(
        req.authContext,
        req.body,
      );

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
          codes: tariffCodeCandidates('CONSULT', encounter.encounterType, [
            `OPD-CONSULT`,
            'CONSULTATION',
            'CONSULT',
          ]),
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
  });

  app.put('/api/encounters/:id', requirePermission('clinical.update'), async (req: AuthRequest, res: Response) => {
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
  });

  // =========================================================
  // QUEUES
  // =========================================================

  app.get('/api/queues', requirePermission('appointments.read'), async (req, res) => {
    try {
      const facilityId = req.query.facilityId
        ? Number(req.query.facilityId)
        : undefined;

      const queueType =
        req.query.queueType as string;

      const list = await queries.getQueues(
        facilityId,
        queueType
      );

      res.json(list);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.post('/api/queues', requirePermission('appointments.create'), async (req: AuthRequest, res: Response) => {
    if (!req.authContext) {
      return res.status(401).json({ error: 'Authentication context is required.' });
    }

    try {
      const item =
        await queries.createQueueEntry(req.authContext, req.body);

      res.status(201).json(item);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.put('/api/queues/:id/status', requirePermission('appointments.update'), async (req: AuthRequest, res: Response) => {
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
      const clientError = message === 'Invalid queue status.' || message === 'A valid queue token is required.';

      res.status(clientError ? 400 : 500).json({
        error: message,
      });
    }
  });

  // =========================================================
  // APPOINTMENTS
  // =========================================================

  app.get('/api/appointments', requirePermission('appointments.read'), async (req, res) => {
    try {
      const facilityId = req.query.facilityId
        ? Number(req.query.facilityId)
        : undefined;

      const list =
        await queries.getAppointments(
          facilityId
        );

      res.json(list);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.post('/api/appointments', requirePermission('appointments.create'), async (req, res) => {
    try {
      const appt =
        await queries.createAppointment(
          req.body
        );

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
          patientId: req.query.patientId
            ? Number(req.query.patientId)
            : undefined,
          encounterId: req.query.encounterId
            ? Number(req.query.encounterId)
            : undefined,
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
            : req.user?.fullName ?? null;

        /*
         * Ward vitals attach to an admission; OPD/triage vitals attach to
         * an encounter. Both paths resolve the patient from a scoped
         * record, so a bare patientId can no longer be written to.
         */
        const observation = Number.isSafeInteger(admissionId) && admissionId > 0
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
            message:
              'Record vitals against an admission or an encounter at this facility.',
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

  // =========================================================
  // MATERNITY / MCH
  // =========================================================
  //
  // The module gate sits on the mount, the permission on the route.
  // A facility that does not deliver babies turns the module off; a
  // clinician who may not record a delivery is stopped by the code.
  // =========================================================

  app.get(
    '/api/maternity/summary',
    requirePermission('maternity.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const facilityId = parseOptionalPositiveId(
          req.query.facilityId,
          'facility ID',
        );

        const summary = await maternity.maternitySummary(context, facilityId);

        res.json(summary);
      } catch (err: unknown) {
        if (handleMaternityError(err, res)) return;

        console.error('Maternity summary error:', err);
        res.status(500).json({
          success: false,
          error: 'MATERNITY_SUMMARY_FAILED',
          message: 'The maternity summary could not be loaded.',
        });
      }
    },
  );

  app.get(
    '/api/maternity/pregnancies',
    requirePermission('maternity.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const facilityId = parseOptionalPositiveId(
          req.query.facilityId,
          'facility ID',
        );
        const patientId = parseOptionalPositiveId(
          req.query.patientId,
          'patient ID',
        );

        const list = await maternity.listPregnancies(context, {
          facilityId,
          patientId,
          status:
            typeof req.query.status === 'string' ? req.query.status : undefined,
          limit: req.query.limit ? Number(req.query.limit) : undefined,
        });

        res.json(list);
      } catch (err: unknown) {
        if (handleMaternityError(err, res)) return;

        console.error('Pregnancy list error:', err);
        res.status(500).json({
          success: false,
          error: 'PREGNANCY_LIST_FAILED',
          message: 'The pregnancy register could not be loaded.',
        });
      }
    },
  );

  app.post(
    '/api/maternity/pregnancies',
    requirePermission('maternity.create'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const created = await maternity.bookPregnancy(context, req.body ?? {});

        res.status(201).json(created);
      } catch (err: unknown) {
        if (handleMaternityError(err, res)) return;

        console.error('Pregnancy booking error:', err);
        res.status(500).json({
          success: false,
          error: 'PREGNANCY_BOOKING_FAILED',
          message: 'The pregnancy could not be booked.',
        });
      }
    },
  );

  app.get(
    '/api/maternity/pregnancies/:id',
    requirePermission('maternity.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const record = await maternity.getPregnancy(
          context,
          Number(req.params.id),
        );

        res.json(record);
      } catch (err: unknown) {
        if (handleMaternityError(err, res)) return;

        console.error('Pregnancy detail error:', err);
        res.status(500).json({
          success: false,
          error: 'PREGNANCY_FETCH_FAILED',
          message: 'The pregnancy record could not be loaded.',
        });
      }
    },
  );

  app.patch(
    '/api/maternity/pregnancies/:id',
    requirePermission('maternity.update'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const updated = await maternity.updatePregnancy(
          context,
          Number(req.params.id),
          req.body ?? {},
        );

        res.json(updated);
      } catch (err: unknown) {
        if (handleMaternityError(err, res)) return;

        console.error('Pregnancy update error:', err);
        res.status(500).json({
          success: false,
          error: 'PREGNANCY_UPDATE_FAILED',
          message: 'The pregnancy record could not be updated.',
        });
      }
    },
  );

  app.get(
    '/api/maternity/pregnancies/:id/anc-visits',
    requirePermission('maternity.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const visits = await maternity.listAncVisits(
          context,
          Number(req.params.id),
        );

        res.json(visits);
      } catch (err: unknown) {
        if (handleMaternityError(err, res)) return;

        console.error('ANC visit list error:', err);
        res.status(500).json({
          success: false,
          error: 'ANC_VISIT_LIST_FAILED',
          message: 'The antenatal visits could not be loaded.',
        });
      }
    },
  );

  app.post(
    '/api/maternity/anc-visits',
    requirePermission('maternity.create'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const created = await maternity.recordAncVisit(context, req.body ?? {});

        res.status(201).json(created);
      } catch (err: unknown) {
        if (handleMaternityError(err, res)) return;

        console.error('ANC visit creation error:', err);
        res.status(500).json({
          success: false,
          error: 'ANC_VISIT_CREATION_FAILED',
          message: 'The antenatal visit could not be recorded.',
        });
      }
    },
  );

  app.get(
    '/api/maternity/labours',
    requirePermission('maternity.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const facilityId = parseOptionalPositiveId(
          req.query.facilityId,
          'facility ID',
        );

        const list = await maternity.listLabours(context, {
          facilityId,
          status:
            typeof req.query.status === 'string' ? req.query.status : undefined,
        });

        res.json(list);
      } catch (err: unknown) {
        if (handleMaternityError(err, res)) return;

        console.error('Labour list error:', err);
        res.status(500).json({
          success: false,
          error: 'LABOUR_LIST_FAILED',
          message: 'The labour board could not be loaded.',
        });
      }
    },
  );

  app.post(
    '/api/maternity/labours',
    requirePermission('maternity.create'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const created = await maternity.startLabour(context, req.body ?? {});

        res.status(201).json(created);
      } catch (err: unknown) {
        if (handleMaternityError(err, res)) return;

        console.error('Labour start error:', err);
        res.status(500).json({
          success: false,
          error: 'LABOUR_START_FAILED',
          message: 'The labour record could not be opened.',
        });
      }
    },
  );

  app.get(
    '/api/maternity/labours/:id',
    requirePermission('maternity.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const record = await maternity.getLabour(context, Number(req.params.id));

        res.json(record);
      } catch (err: unknown) {
        if (handleMaternityError(err, res)) return;

        console.error('Labour detail error:', err);
        res.status(500).json({
          success: false,
          error: 'LABOUR_FETCH_FAILED',
          message: 'The labour record could not be loaded.',
        });
      }
    },
  );

  app.patch(
    '/api/maternity/labours/:id',
    requirePermission('maternity.update'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const updated = await maternity.updateLabour(
          context,
          Number(req.params.id),
          req.body ?? {},
        );

        res.json(updated);
      } catch (err: unknown) {
        if (handleMaternityError(err, res)) return;

        console.error('Labour update error:', err);
        res.status(500).json({
          success: false,
          error: 'LABOUR_UPDATE_FAILED',
          message: 'The labour record could not be updated.',
        });
      }
    },
  );

  app.post(
    '/api/maternity/partograph',
    requirePermission('maternity.create'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const created = await maternity.recordPartographEntry(
          context,
          req.body ?? {},
        );

        res.status(201).json(created);
      } catch (err: unknown) {
        if (handleMaternityError(err, res)) return;

        console.error('Partograph entry error:', err);
        res.status(500).json({
          success: false,
          error: 'PARTOGRAPH_ENTRY_FAILED',
          message: 'The partograph reading could not be recorded.',
        });
      }
    },
  );

  app.get(
    '/api/maternity/deliveries',
    requirePermission('maternity.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const facilityId = parseOptionalPositiveId(
          req.query.facilityId,
          'facility ID',
        );

        const list = await maternity.listDeliveries(context, {
          facilityId,
          from: typeof req.query.from === 'string' ? req.query.from : undefined,
          to: typeof req.query.to === 'string' ? req.query.to : undefined,
          limit: req.query.limit ? Number(req.query.limit) : undefined,
        });

        res.json(list);
      } catch (err: unknown) {
        if (handleMaternityError(err, res)) return;

        console.error('Delivery list error:', err);
        res.status(500).json({
          success: false,
          error: 'DELIVERY_LIST_FAILED',
          message: 'The delivery register could not be loaded.',
        });
      }
    },
  );

  app.post(
    '/api/maternity/deliveries',
    requirePermission('maternity.update'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const created = await maternity.recordDelivery(context, req.body ?? {});

        /*
         * A delivery is a billable event, and until now it raised nothing.
         *
         * The price comes from `facility_service_tariffs` and nowhere else.
         * No fallback price is passed, so a facility with no delivery tariff
         * gets `charged: false, reason: 'TARIFF_NOT_CONFIGURED'` and the UI
         * says so. It does not invent a number to fill the invoice.
         *
         * One charge per delivery, not per baby: twins are one delivery with
         * two babies, and the tariff is for the delivery.
         */
        const charge = await chargeSafely({
          tenantId: created.delivery.tenantId,
          facilityId: created.delivery.facilityId,
          patientId: created.delivery.patientId,
          encounterId: null,
          codes: tariffCodeCandidates('DELIVERY', created.delivery.deliveryMode, [
            'DELIVERY',
            'MATERNITY-DELIVERY',
          ]),
          sourceType: 'MATERNITY',
          sourceId: created.delivery.id,
          itemType: 'Maternity',
          description: `Delivery — ${created.delivery.deliveryMode}`,
        });

        res.status(201).json({ ...created, billing: charge });
      } catch (err: unknown) {
        if (handleMaternityError(err, res)) return;

        console.error('Delivery creation error:', err);
        res.status(500).json({
          success: false,
          error: 'DELIVERY_CREATION_FAILED',
          message: 'The delivery could not be recorded.',
        });
      }
    },
  );

  app.get(
    '/api/maternity/deliveries/:id',
    requirePermission('maternity.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const record = await maternity.getDelivery(
          context,
          Number(req.params.id),
        );

        res.json(record);
      } catch (err: unknown) {
        if (handleMaternityError(err, res)) return;

        console.error('Delivery detail error:', err);
        res.status(500).json({
          success: false,
          error: 'DELIVERY_FETCH_FAILED',
          message: 'The delivery record could not be loaded.',
        });
      }
    },
  );

  // =========================================================
  // POSTNATAL CARE
  //
  // Six weeks of contacts after a delivery, hung off the pregnancy so a
  // woman who delivered elsewhere still has a record here.
  // =========================================================

  app.get(
    '/api/maternity/postnatal',
    requirePermission('maternity.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const facilityId = parseOptionalPositiveId(
          req.query.facilityId,
          'facility ID',
        );

        const list = await postnatal.listPostnatalVisitsForFacility(
          context,
          facilityId,
        );

        res.json(list);
      } catch (err: unknown) {
        if (handleMaternityError(err, res)) return;

        console.error('Postnatal register error:', err);
        res.status(500).json({
          success: false,
          error: 'POSTNATAL_LIST_FAILED',
          message: 'The postnatal register could not be loaded.',
        });
      }
    },
  );

  app.get(
    '/api/maternity/pregnancies/:id/postnatal',
    requirePermission('maternity.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const visits = await postnatal.listPostnatalVisits(
          context,
          Number(req.params.id),
        );

        res.json(visits);
      } catch (err: unknown) {
        if (handleMaternityError(err, res)) return;

        console.error('Postnatal visit list error:', err);
        res.status(500).json({
          success: false,
          error: 'POSTNATAL_VISITS_FAILED',
          message: 'The postnatal visits could not be loaded.',
        });
      }
    },
  );

  app.post(
    '/api/maternity/postnatal',
    requirePermission('maternity.create'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const created = await postnatal.recordPostnatalVisit(
          context,
          req.body ?? {},
        );

        res.status(201).json(created);
      } catch (err: unknown) {
        if (handleMaternityError(err, res)) return;

        console.error('Postnatal visit creation error:', err);
        res.status(500).json({
          success: false,
          error: 'POSTNATAL_CREATION_FAILED',
          message: 'The postnatal visit could not be recorded.',
        });
      }
    },
  );

  // =========================================================
  // IMMUNISATION
  //
  // The schedule is in `immunisation-contracts.ts`; this is the record
  // of what was given. Mounted under the maternity module (see the gate
  // at the top of this file).
  // =========================================================

  /*
   * The reference schedule, straight from the module that computes
   * against it. The screen reads its antigen list from here rather than
   * carrying a second copy that would drift the first time a dose is
   * added.
   */
  app.get(
    '/api/immunisation/schedule',
    requirePermission('maternity.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      res.json({
        antigens: immunisation.ANTIGENS,
        note: immunisation.SCHEDULE_AGREES_NOTE,
      });
    },
  );

  app.get(
    '/api/immunisation/card',
    requirePermission('maternity.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const patientId = parseOptionalPositiveId(
          req.query.patientId,
          'patient ID',
        );

        if (!patientId) {
          res.status(400).json({
            success: false,
            error: 'PATIENT_REQUIRED',
            message: 'A valid patientId is required.',
          });

          return;
        }

        const card = await immunisation.immunisationCard(context, patientId);

        res.json(card);
      } catch (err: unknown) {
        if (handleImmunisationError(err, res)) return;

        console.error('Immunisation card error:', err);
        res.status(500).json({
          success: false,
          error: 'IMMUNISATION_CARD_FAILED',
          message: 'The immunisation card could not be loaded.',
        });
      }
    },
  );

  app.get(
    '/api/immunisation/records',
    requirePermission('maternity.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const patientId = parseOptionalPositiveId(
          req.query.patientId,
          'patient ID',
        );

        if (!patientId) {
          res.status(400).json({
            success: false,
            error: 'PATIENT_REQUIRED',
            message: 'A valid patientId is required.',
          });

          return;
        }

        const records = await immunisation.listImmunisationRecords(
          context,
          patientId,
        );

        res.json(records);
      } catch (err: unknown) {
        if (handleImmunisationError(err, res)) return;

        console.error('Immunisation record list error:', err);
        res.status(500).json({
          success: false,
          error: 'IMMUNISATION_RECORDS_FAILED',
          message: 'The immunisation records could not be loaded.',
        });
      }
    },
  );

  app.post(
    '/api/immunisation/records',
    requirePermission('maternity.create'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const created = await immunisation.recordImmunisation(
          context,
          req.body ?? {},
        );

        res.status(201).json(created);
      } catch (err: unknown) {
        if (handleImmunisationError(err, res)) return;

        console.error('Immunisation record error:', err);
        res.status(500).json({
          success: false,
          error: 'IMMUNISATION_CREATION_FAILED',
          message: 'The dose could not be recorded.',
        });
      }
    },
  );

  app.get(
    '/api/immunisation/due',
    requirePermission('maternity.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const facilityId = parseOptionalPositiveId(
          req.query.facilityId,
          'facility ID',
        );

        const list = await immunisation.immunisationDueList(
          context,
          facilityId,
        );

        res.json(list);
      } catch (err: unknown) {
        if (handleImmunisationError(err, res)) return;

        console.error('Immunisation due list error:', err);
        res.status(500).json({
          success: false,
          error: 'IMMUNISATION_DUE_FAILED',
          message: 'The immunisation list could not be loaded.',
        });
      }
    },
  );

  // =========================================================
  // DIAGNOSES & PROCEDURES
  // =========================================================

  app.get('/api/diagnoses', requirePermission('clinical.read'), async (req: AuthRequest, res: Response) => {
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
  });

  app.post('/api/diagnoses', requirePermission('clinical.create'), async (req: AuthRequest, res: Response) => {
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
  });

  app.get('/api/procedures', requirePermission('clinical.read'), async (req: AuthRequest, res: Response) => {
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
  });

  app.post('/api/procedures', requirePermission('clinical.create'), async (req: AuthRequest, res) => {
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
          codes: tariffCodeCandidates(
            'PROC',
            (proc as { procedureName?: string }).procedureName,
            ['PROCEDURE', 'PROC-GENERAL'],
          ),
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
  });

  // =========================================================
  // MEDICATIONS & PRESCRIPTIONS
  // =========================================================

  app.get('/api/medications', requirePermission('pharmacy.read'), async (req, res) => {
    try {
      const encounterId =
        req.query.encounterId
          ? Number(req.query.encounterId)
          : undefined;

      const patientId =
        req.query.patientId
          ? Number(req.query.patientId)
          : undefined;

      const list =
        await queries.getMedications(
          encounterId,
          patientId
        );

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
        const drugName =
          typeof body.drugName === 'string' ? body.drugName.trim() : '';

        if (
          Number.isSafeInteger(patientId) &&
          patientId > 0 &&
          drugName !== ''
        ) {
          const check = await checkMedicationAllergies(
            req.authContext,
            patientId,
            [drugName],
          );

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

  app.put('/api/medications/:id/status', requirePermission('pharmacy.dispense'), async (req, res) => {
    try {
      const { status } = req.body;

      const med =
        await queries.updateMedicationStatus(
          Number(req.params.id),
          status
        );

      res.json(med);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  // =========================================================
  // INPATIENT: WARDS, BEDS, ADMISSIONS
  // =========================================================

  // =========================================================
  // INPATIENT: WARDS, BEDS AND ADMISSIONS
  // =========================================================
  //
  // Tenant and facility scope are derived from req.authContext.
  // Client-supplied tenantId / facilityId are never trusted.
  //
  // Occupancy is created only by admitting a patient and released
  // only by discharging one, so bed status cannot forge a bed.

  /**
   * Return the request's authorization context, or respond 401.
   */
  const requireAuthContext = (
    req: AuthRequest,
    res: Response,
  ) => {
    if (!req.authContext) {
      res.status(401).json({
        success: false,
        error: 'AUTHORIZATION_CONTEXT_MISSING',
        message: 'Authentication is required.',
      });

      return null;
    }

    return req.authContext;
  };

  /**
   * Parse an optional positive integer query parameter.
   * Invalid values become HTTP 400 instead of a scope error.
   */
  const parseOptionalPositiveId = (
    value: unknown,
    field: string,
  ): number | undefined => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    const raw = Array.isArray(value) ? value[0] : value;

    if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) {
      throw new queries.InpatientDomainError(
        'INVALID_INPUT',
        `A valid ${field} is required.`,
        400,
      );
    }

    return Number(raw);
  };

  app.get(
    '/api/wards',
    requirePermission('inpatient.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const facilityId = parseOptionalPositiveId(
          req.query.facilityId,
          'facility ID',
        );

        const list = await queries.getWardsScoped(
          context,
          facilityId,
        );

        res.json(list);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Ward list error:', err);
        res.status(500).json({
          success: false,
          error: 'WARD_LIST_FAILED',
        });
      }
    },
  );

  /*
   * Ward set-up.
   *
   * The board was read-only before this: wards could only exist if the
   * demo seed had been run, so a real facility had an empty dropdown and
   * nowhere to fill it from. These are the write paths, each with its
   * own permission so a facility can decide who configures the ward
   * while keeping admission rights separate.
   */
  app.post(
    '/api/wards',
    requirePermission('inpatient.wards.create'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const created = await wardBed.createWard(context, req.body ?? {});

        await queries.logAuditEvent(
          context.tenantId,
          context.facilityId,
          String(context.userId),
          'CREATE',
          'Ward',
          String(created.id),
          `Created ward ${created.code} — ${created.name}`,
        );

        res.status(201).json(created);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Ward creation error:', err);
        res.status(500).json({
          success: false,
          error: 'WARD_CREATION_FAILED',
        });
      }
    },
  );

  app.put(
    '/api/wards/:id',
    requirePermission('inpatient.wards.update'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const updated = await wardBed.updateWard(
          context,
          req.params.id,
          req.body ?? {},
        );

        await queries.logAuditEvent(
          context.tenantId,
          context.facilityId,
          String(context.userId),
          'UPDATE',
          'Ward',
          String(updated.id),
          `Updated ward ${updated.code}`,
        );

        res.json(updated);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Ward update error:', err);
        res.status(500).json({
          success: false,
          error: 'WARD_UPDATE_FAILED',
        });
      }
    },
  );

  app.delete(
    '/api/wards/:id',
    requirePermission('inpatient.wards.delete'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const result = await wardBed.deleteWard(context, req.params.id);

        await queries.logAuditEvent(
          context.tenantId,
          context.facilityId,
          String(context.userId),
          'DELETE',
          'Ward',
          String(result.wardId),
          `Deleted unused ward ${result.code}`,
        );

        res.json(result);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Ward deletion error:', err);
        res.status(500).json({
          success: false,
          error: 'WARD_DELETION_FAILED',
        });
      }
    },
  );

  /*
   * Bed set-up. Beds are created in a batch because a ward is set up in
   * one sitting: a prefix, a first number and a count, or an explicit
   * list of numbers.
   */
  app.post(
    '/api/beds',
    requirePermission('inpatient.beds.create'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const result = await wardBed.createBeds(context, req.body ?? {});

        await queries.logAuditEvent(
          context.tenantId,
          context.facilityId,
          String(context.userId),
          'CREATE',
          'Bed',
          String(result.wardId),
          `Added ${result.totalBeds} bed(s) to ward ${result.wardId}`,
        );

        res.status(201).json(result);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Bed creation error:', err);
        res.status(500).json({
          success: false,
          error: 'BED_CREATION_FAILED',
        });
      }
    },
  );

  app.put(
    '/api/beds/:id',
    requirePermission('inpatient.beds.update'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const updated = await wardBed.updateBed(
          context,
          req.params.id,
          req.body ?? {},
        );

        await queries.logAuditEvent(
          context.tenantId,
          context.facilityId,
          String(context.userId),
          'UPDATE',
          'Bed',
          String(updated.id),
          `Updated bed ${updated.bedNumber}`,
        );

        res.json(updated);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Bed update error:', err);
        res.status(500).json({
          success: false,
          error: 'BED_UPDATE_FAILED',
        });
      }
    },
  );

  app.delete(
    '/api/beds/:id',
    requirePermission('inpatient.beds.delete'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const result = await wardBed.deleteBed(context, req.params.id);

        await queries.logAuditEvent(
          context.tenantId,
          context.facilityId,
          String(context.userId),
          'DELETE',
          'Bed',
          String(result.bedId),
          `Deleted unused bed ${result.bedNumber}`,
        );

        res.json(result);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Bed deletion error:', err);
        res.status(500).json({
          success: false,
          error: 'BED_DELETION_FAILED',
        });
      }
    },
  );

  app.get(
    '/api/beds',
    requirePermission('inpatient.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const wardId = parseOptionalPositiveId(
          req.query.wardId,
          'ward ID',
        );

        const list = await queries.getBedsScoped(
          context,
          wardId,
        );

        res.json(list);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Bed list error:', err);
        res.status(500).json({
          success: false,
          error: 'BED_LIST_FAILED',
        });
      }
    },
  );

  /*
   * Change a bed's housekeeping status.
   *
   * 'Occupied' is rejected by the query layer: occupancy must come
   * from an admission. A bed holding a patient cannot be changed
   * until that patient is discharged or transferred.
   */
  app.put(
    '/api/beds/:id/status',
    requirePermission('inpatient.admit'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const bed = await queries.setBedStatusScoped(
          context,
          Number(req.params.id),
          req.body?.status,
        );

        await queries.logAuditEvent(
          context.tenantId,
          context.facilityId,
          String(context.userId),
          'UPDATE',
          'Bed',
          String(bed?.id ?? req.params.id),
          `Bed status set to ${String(req.body?.status)}`,
        );

        res.json(bed);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Bed status update error:', err);
        res.status(500).json({
          success: false,
          error: 'BED_STATUS_UPDATE_FAILED',
        });
      }
    },
  );

  /*
   * Release a cleaned bed back into service (Cleaning -> Available).
   *
   * Without this, every discharge permanently removes a bed from the
   * usable board because nothing else restores 'Available'.
   */
  app.put(
    '/api/beds/:id/release',
    requirePermission('inpatient.admit'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const bed = await queries.releaseBedScoped(
          context,
          Number(req.params.id),
        );

        await queries.logAuditEvent(
          context.tenantId,
          context.facilityId,
          String(context.userId),
          'UPDATE',
          'Bed',
          String(bed?.id ?? req.params.id),
          'Bed released to Available after terminal cleaning',
        );

        res.json(bed);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Bed release error:', err);
        res.status(500).json({
          success: false,
          error: 'BED_RELEASE_FAILED',
        });
      }
    },
  );

  app.get(
    '/api/admissions',
    requirePermission('inpatient.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const facilityId = parseOptionalPositiveId(
          req.query.facilityId,
          'facility ID',
        );

        const status =
          typeof req.query.status === 'string'
            ? req.query.status
            : undefined;

        const list = await queries.getAdmissionsScoped(
          context,
          facilityId,
          status,
        );

        res.json(list);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Admission list error:', err);
        res.status(500).json({
          success: false,
          error: 'ADMISSION_LIST_FAILED',
        });
      }
    },
  );

  app.post(
    '/api/admissions',
    requirePermission('inpatient.admit'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const admission = await queries.createAdmissionScoped(
          context,
          req.body ?? {},
        );

        await queries.logAuditEvent(
          admission.tenantId,
          admission.facilityId,
          String(context.userId),
          'CREATE',
          'Admission',
          String(admission.id),
          `Admitted patient ${admission.patientId} to ward ${admission.wardId}, bed ${admission.bedId}`,
        );

        /*
         * One-off admission fee, when the facility has configured one.
         * Daily bed charges are accrued separately on discharge so each
         * night is billed once, keyed by date.
         */
        const [ward] = await db
          .select({
            code: schema.wards.code,
            name: schema.wards.name,
            dailyRate: schema.wards.dailyRate,
          })
          .from(schema.wards)
          .where(eq(schema.wards.id, admission.wardId))
          .limit(1);

        const charge = await chargeSafely({
          tenantId: admission.tenantId,
          facilityId: admission.facilityId,
          patientId: admission.patientId,
          encounterId: admission.encounterId ?? null,
          codes: tariffCodeCandidates('ADMIT', ward?.code, [
            'ADMISSION',
            'INPATIENT-ADMISSION',
          ]),
          sourceType: 'ADMISSION',
          sourceId: admission.id,
          itemType: 'Admission',
          description: `Admission — ${ward?.name ?? 'Inpatient ward'}`,
        });

        res.status(201).json({ ...admission, billing: charge });
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Admission creation error:', err);
        res.status(500).json({
          success: false,
          error: 'ADMISSION_CREATION_FAILED',
        });
      }
    },
  );

  app.post(
    '/api/admissions/:id/discharge',
    requirePermission('inpatient.discharge'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const admission = await queries.dischargeAdmissionScoped(
          context,
          Number(req.params.id),
          req.body ?? {},
        );

        await queries.logAuditEvent(
          admission.tenantId,
          admission.facilityId,
          String(context.userId),
          'UPDATE',
          'Admission',
          String(admission.id),
          `Discharged patient ${admission.patientId} from bed ${admission.bedId}`,
        );

        /*
         * Accrue one bed-day charge per night of the stay.
         *
         * Each night is keyed BED_DAY:<admissionId>:<date>, so
         * re-running a discharge, or a nightly accrual job that calls
         * the same path, can never double-bill a night.
         */
        const [ward] = await db
          .select({
            code: schema.wards.code,
            name: schema.wards.name,
          })
          .from(schema.wards)
          .where(eq(schema.wards.id, admission.wardId))
          .limit(1);

        const nights = billing.bedDayDates(
          admission.admissionDate,
          admission.dischargeDate,
        );

        const bedDayCharges: Array<billing.ChargeResult | null> = [];

        for (const date of nights) {
          bedDayCharges.push(
            await chargeSafely({
              tenantId: admission.tenantId,
              facilityId: admission.facilityId,
              patientId: admission.patientId,
              encounterId: admission.encounterId ?? null,
              codes: tariffCodeCandidates('BED', ward?.code, [
                'BED-DAY',
                'INPATIENT-BED-DAY',
                'WARD-DAY',
                'BED',
              ]),
              sourceType: 'BED_DAY',
              sourceId: admission.id,
              idempotencySuffix: date,
              itemType: 'Inpatient',
              description: `${ward?.name ?? 'Ward'} bed — ${date}`,
            }),
          );
        }

        res.json({
          ...admission,
          billing: {
            nights: nights.length,
            bedDays: bedDayCharges,
          },
        });
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Discharge error:', err);
        res.status(500).json({
          success: false,
          error: 'DISCHARGE_FAILED',
        });
      }
    },
  );

  // =========================================================
  // INPATIENT EXTRAS: TRANSFER, BED-DAYS, NURSING NOTES
  // =========================================================

  app.post(
    '/api/admissions/:id/transfer',
    requirePermission('inpatient.admit'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const { admission, transfer } =
          await queries.transferAdmissionScoped(
            context,
            Number(req.params.id),
            {
              toWardId: req.body?.toWardId,
              toBedId: req.body?.toBedId,
              reason: req.body?.reason,
              transferredBy:
                typeof req.body?.transferredBy === 'string'
                  ? req.body.transferredBy
                  : req.user?.fullName ?? 'Unknown',
            },
          );

        await queries.logAuditEvent(
          admission.tenantId,
          admission.facilityId,
          String(context.userId),
          'UPDATE',
          'Admission',
          String(admission.id),
          `Transferred patient ${admission.patientId} from bed ${transfer.fromBedId} to ${transfer.toBedId}`,
        );

        /*
         * Close the departing ward's bed-day segment using the OLD ward
         * rate, so a stay that moves between wards is not re-priced.
         */
        const accrual = await queries.accrueBedDaysScoped(
          context,
          admission.id,
        );

        res.json({ admission, transfer, billing: accrual });
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Admission transfer error:', err);
        res.status(500).json({
          success: false,
          error: 'ADMISSION_TRANSFER_FAILED',
        });
      }
    },
  );

  app.get(
    '/api/admissions/:id/transfers',
    requirePermission('inpatient.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const list = await queries.getAdmissionTransfersScoped(
          context,
          Number(req.params.id),
        );

        res.json(list);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Admission transfer list error:', err);
        res.status(500).json({
          success: false,
          error: 'ADMISSION_TRANSFERS_FETCH_FAILED',
        });
      }
    },
  );

  /**
   * Accrue bed-day charges on demand.
   *
   * Called by discharge and transfer. Exposed so a scheduled job can
   * bill long stays without waiting for discharge — it is idempotent,
   * so running it repeatedly bills each night once.
   */
  app.post(
    '/api/admissions/:id/accrue-bed-days',
    requirePermission('billing.create'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const accrual = await queries.accrueBedDaysScoped(
          context,
          Number(req.params.id),
          typeof req.body?.untilDate === 'string'
            ? req.body.untilDate
            : undefined,
        );

        res.json(accrual);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Bed-day accrual error:', err);
        res.status(500).json({
          success: false,
          error: 'BED_DAY_ACCRUAL_FAILED',
        });
      }
    },
  );

  /**
   * Ward board: occupancy, per-admission vitals status and note counts.
   * One scoped call so the ward screen and dashboard do not fan out.
   */
  app.get(
    '/api/inpatient/board',
    requirePermission('inpatient.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const facilityId = parseOptionalPositiveId(
          req.query.facilityId,
          'facility ID',
        );

        const board = await nursing.getInpatientBoardScoped(
          context,
          facilityId,
        );

        res.json(board);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Inpatient board error:', err);
        res.status(500).json({
          success: false,
          error: 'INPATIENT_BOARD_FAILED',
        });
      }
    },
  );

  /**
   * Vitals history for one admission, with abnormality flags derived
   * from adult reference ranges.
   */
  app.get(
    '/api/admissions/:id/vitals',
    requirePermission('inpatient.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const vitals = await nursing.getVitalsForAdmissionScoped(
          context,
          Number(req.params.id),
          req.query.limit ? Number(req.query.limit) : 20,
        );

        res.json(
          vitals.map((observation) => ({
            ...observation,
            flags: nursing.assessVitals(observation),
          })),
        );
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Admission vitals error:', err);
        res.status(500).json({
          success: false,
          error: 'ADMISSION_VITALS_FETCH_FAILED',
        });
      }
    },
  );

  /**
   * Record ward vitals against an admission.
   *
   * Separate from POST /api/observations so that ward care does not
   * depend on the OPD module being enabled for the facility.
   */
  app.post(
    '/api/admissions/:id/vitals',
    requirePermission('clinical.create'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const observation = await nursing.recordVitalsScoped(context, {
          ...req.body,
          admissionId: Number(req.params.id),
          recordedBy:
            typeof req.body?.recordedBy === 'string'
              ? req.body.recordedBy
              : req.user?.fullName ?? null,
        });

        await queries.logAuditEvent(
          context.tenantId,
          context.facilityId,
          String(context.userId),
          'CREATE',
          'Observation',
          String(observation.id ?? ''),
          `Ward vitals recorded for admission ${req.params.id}`,
        );

        res.status(201).json(observation);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Ward vitals error:', err);
        res.status(500).json({
          success: false,
          error: 'WARD_VITALS_CREATION_FAILED',
        });
      }
    },
  );

  /**
   * Shift handover: notes for a day grouped by shift.
   * Defaults to today; pass ?date=YYYY-MM-DD&shift=Morning to narrow.
   */
  app.get(
    '/api/nursing-notes/handover',
    requirePermission('inpatient.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const handover = await nursing.getShiftHandoverScoped(context, {
          date:
            typeof req.query.date === 'string' ? req.query.date : undefined,
          shift:
            typeof req.query.shift === 'string' ? req.query.shift : undefined,
        });

        res.json(handover);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Shift handover error:', err);
        res.status(500).json({
          success: false,
          error: 'SHIFT_HANDOVER_FAILED',
        });
      }
    },
  );

  app.get(
    '/api/nursing-notes',
    requirePermission('inpatient.read'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const admissionId = req.query.admissionId
          ? Number(req.query.admissionId)
          : undefined;

        const patientId = req.query.patientId
          ? Number(req.query.patientId)
          : undefined;

        const list = await queries.getNursingNotesScoped(context, {
          admissionId,
          patientId,
        });

        res.json(list);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Nursing note list error:', err);
        res.status(500).json({
          success: false,
          error: 'NURSING_NOTES_FETCH_FAILED',
        });
      }
    },
  );

  app.post(
    '/api/nursing-notes',
    requirePermission('clinical.create'),
    async (req: AuthRequest, res: Response) => {
      const context = requireAuthContext(req, res);

      if (!context) return;

      try {
        const note = await queries.createNursingNoteScoped(context, {
          admissionId: req.body?.admissionId,
          patientId: req.body?.patientId,
          encounterId: req.body?.encounterId,
          noteType: req.body?.noteType,
          shift: req.body?.shift,
          note: req.body?.note,
          recordedBy:
            typeof req.body?.recordedBy === 'string'
              ? req.body.recordedBy
              : req.user?.fullName ?? 'Unknown',
        });

        await queries.logAuditEvent(
          note.tenantId,
          note.facilityId,
          String(context.userId),
          'CREATE',
          'NursingNote',
          String(note.id),
          `Nursing note recorded for patient ${note.patientId}`,
        );

        res.status(201).json(note);
      } catch (err: unknown) {
        if (handleInpatientError(err, res)) return;

        console.error('Nursing note creation error:', err);
        res.status(500).json({
          success: false,
          error: 'NURSING_NOTE_CREATION_FAILED',
        });
      }
    },
  );

  // =========================================================
  // THEATRE CASES
  // =========================================================

  app.get(
    '/api/theatre-cases',
    requireAnyPermission('clinical.read', 'inpatient.read'),
    async (req: AuthRequest, res: Response) => {
      const facility = await requireScopedFacility(
        req,
        res,
        req.query.facilityId,
      );

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
        const existing = await queries.getTheatreCaseScoped(
          caseId,
          facility.id,
        );

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
      const facilityId =
        req.query.facilityId
          ? Number(req.query.facilityId)
          : undefined;

      const list =
        await queries.getLabTests(
          facilityId
        );

      res.json(list);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.get('/api/lab-orders', requirePermission('laboratory.read'), async (req: AuthRequest, res) => {
    try {
      const facilityId =
        req.query.facilityId
          ? Number(req.query.facilityId)
          : undefined;

      const patientId =
        req.query.patientId
          ? Number(req.query.patientId)
          : undefined;

      const list =
        await queries.getLabOrders(req.authContext!,
          facilityId,
          patientId
        );

      res.json(list);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

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
  app.post('/api/lab-orders', requirePermission('laboratory.orders.create'), async (req: AuthRequest, res: Response) => {
    if (!req.authContext) {
      return res.status(401).json({ error: 'Authentication context is required.' });
    }

    try {
      const order =
        await queries.createLabOrder(req.authContext, req.body);

      const labOrder = order as {
        id?: number;
        tenantId?: number;
        facilityId?: number;
        patientId?: number;
        encounterId?: number | null;
        testName?: string;
      } | null;

      const charge = labOrder && labOrder.id
        ? await chargeSafely({
            tenantId: labOrder.tenantId ?? req.authContext.tenantId ?? 0,
            facilityId: labOrder.facilityId ?? req.authContext.facilityId ?? 0,
            patientId: labOrder.patientId ?? 0,
            encounterId: labOrder.encounterId ?? null,
            codes: tariffCodeCandidates('LAB', labOrder.testName, [
              'LAB-GENERAL',
              'LABORATORY',
            ]),
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

  app.put('/api/lab-orders/:id/status', requirePermission('laboratory.results.enter'), async (req: AuthRequest, res) => {
    try {
      const {
        status,
        accessionNumber,
      } = req.body;

      const order =
        await queries.updateLabOrderStatus(req.authContext!,
          Number(req.params.id),
          status,
          accessionNumber
        );

      res.json(order);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.get('/api/lab-results', requirePermission('laboratory.read'), async (req: AuthRequest, res) => {
    try {
      const orderId =
        req.query.orderId
          ? Number(req.query.orderId)
          : undefined;

      const patientId =
        req.query.patientId
          ? Number(req.query.patientId)
          : undefined;

      const list =
        await queries.getLabResults(req.authContext!,
          orderId,
          patientId,
          req.query.facilityId ? Number(req.query.facilityId) : undefined
        );

      res.json(list);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.post('/api/lab-results', requirePermission('laboratory.results.enter'), async (req: AuthRequest, res) => {
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
  });

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

        const verifier =
          req.user.fullName ||
          req.user.username ||
          String(req.user.id);

        const result = await queries.verifyLabResult(
          req.authContext,
          resultId,
          verifier,
        );

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
      const facility = await requireScopedFacility(
        req,
        res,
        req.query.facilityId,
      );

      if (!facility) return;

      const patientId =
        req.query.patientId
          ? Number(req.query.patientId)
          : undefined;

      try {
        const list = await queries.getRadiologyOrders(
          facility.id,
          patientId,
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
        charge = await chargeSafely(
          radiologyChargeRequest(radiologyOrder as never),
        );
      }

      res.status(201).json({ ...order, billing: charge });
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

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
        const existing = await queries.getRadiologyOrderScoped(
          orderId,
          facility.id,
        );

        if (!existing) {
          res.status(404).json({
            success: false,
            error: 'RADIOLOGY_ORDER_NOT_FOUND',
            message: 'The order was not found in this facility.',
          });

          return;
        }

        const {
          findings,
          impression,
          reportedBy,
        } = req.body;

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
          horizonDays: req.query.horizonDays
            ? Number(req.query.horizonDays)
            : undefined,
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
      const facilityId =
        req.query.facilityId
          ? Number(req.query.facilityId)
          : undefined;

      const list =
        await queries.getInventoryItems(
          facilityId
        );

      res.json(list);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.post('/api/inventory', requirePermission('inventory.manage'), async (req, res) => {
    try {
      const item =
        await queries.createInventoryItem(
          req.body
        );

      res.status(201).json(item);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.post('/api/pharmacy/dispense', requirePermission('pharmacy.dispense'), async (req: AuthRequest, res) => {
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
      const result = await inventory.dispenseFefoScoped(
        req.authContext,
        req.body,
      );

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
        const drugName =
          typeof req.body.drugName === 'string' ? req.body.drugName : 'Medication';

        charge = await chargeSafely({
          tenantId:
            dispensation.tenantId ?? req.authContext.tenantId ?? 0,
          facilityId:
            dispensation.facilityId ?? req.authContext.facilityId ?? 0,
          patientId: dispensation.patientId,
          encounterId:
            typeof req.body.encounterId === 'number'
              ? req.body.encounterId
              : null,
          codes: tariffCodeCandidates('DRUG', drugName, [
            'PHARMACY',
            'MEDICATION',
          ]),
          quantity:
            typeof dispensation.quantityDispensed === 'number'
              ? dispensation.quantityDispensed
              : 1,
          sourceType: 'PHARMACY',
          sourceId: dispensation.id,
          itemType: 'Pharmacy',
          description: drugName,
          fallbackUnitPrice:
            typeof req.body.unitPrice === 'string' ||
            typeof req.body.unitPrice === 'number'
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
        .completeQueueTokensForPatient(
          req.authContext,
          result.dispensation.patientId,
          'Pharmacy',
        )
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
  });

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
      const facility = await requireScopedFacility(
        req,
        res,
        req.query.facilityId,
      );

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
    const value = department.trim().toLowerCase().replace(/[\s-]+/g, '_');
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
    const code = typeof input?.code === 'string' ? input.code.trim() : '';
    const description = typeof input?.description === 'string'
      ? input.description.trim()
      : '';
    const department = typeof input?.department === 'string'
      ? input.department.trim()
      : '';
    const unit = typeof input?.unit === 'string' ? input.unit.trim() : 'Service';
    const feeText = typeof input?.fee === 'string' || typeof input?.fee === 'number'
      ? String(input.fee).trim()
      : '';
    const shaStatus = typeof input?.shaStatus === 'string'
      ? input.shaStatus.trim()
      : 'Not Assessed';
    const shaNotes = input?.shaNotes == null
      ? null
      : typeof input.shaNotes === 'string'
        ? input.shaNotes.trim()
        : undefined;
    const moduleId = tariffModuleForDepartment(department);
    const fee = Number(feeText);

    if (
      !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,49}$/.test(code) ||
      !description || description.length > 500 ||
      !department || department.length > 100 || !moduleId ||
      !unit || unit.length > 50 ||
      !/^\d{1,8}(\.\d{1,2})?$/.test(feeText) ||
      !Number.isFinite(fee) || fee < 0 ||
      !shaStatus || shaStatus.length > 50 ||
      shaNotes === undefined || (shaNotes !== null && shaNotes.length > 1000)
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
    };
  };

  const facilityHasTariffModule = (
    facility: { enabledModules: unknown },
    moduleId: string,
  ): boolean =>
    Array.isArray(facility.enabledModules) &&
    facility.enabledModules.includes(moduleId);

  // Tariff pricing is restricted to tenant-level Facility Administrators.
  // This guard runs after requirePermission has loaded req.authContext.
  const requireFacilityAdminTariffRole = (
    req: AuthRequest,
    res: Response,
  ): boolean => {
    const context = req.authContext;

    if (!context) {
      res.status(401).json({
        success: false,
        error: 'AUTHORIZATION_CONTEXT_MISSING',
        message: 'Authorization context is required.',
      });
      return false;
    }

    if (
      context.isSuperAdmin ||
      !context.roles.includes('FACILITY_ADMIN')
    ) {
      res.status(403).json({
        success: false,
        error: 'FACILITY_ADMIN_REQUIRED',
        message: 'Only Facility Administrators can manage facility service tariffs.',
      });
      return false;
    }

    return true;
  };
  const resolveTariffFacility = async (
    req: AuthRequest,
    res: Response,
    requestedId: unknown,
  ) => {
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
      const facility = await queries.getFacilityByIdScoped(
        req.authContext,
        scopedId,
      );

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
        const facility = await resolveTariffFacility(
          req,
          res,
          req.query.facilityId,
        );
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
        const facility = await resolveTariffFacility(
          req,
          res,
          req.body?.facilityId,
        );
        if (!facility || !req.authContext) return;

        const input = validateTariffInput(req.body);
        if (!input) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_SERVICE_TARIFF',
            message: 'Provide a valid code, description, enabled department, unit, fee, and SHA status.',
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
        const facility = await resolveTariffFacility(
          req,
          res,
          req.body?.facilityId,
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

        const facilityId = resolveFacilityScope(
          req.authContext,
          requestedFacilityId,
        );

        const facility = await queries.getFacilityByIdScoped(
          req.authContext,
          facilityId,
        );

        if (!facility) {
          return res.status(404).json({
            success: false,
            error: 'FACILITY_NOT_FOUND',
            message: 'Facility not found.',
          });
        }

        if (!Array.isArray(facility.enabledModules) || !facility.enabledModules.includes('finance')) {
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

        const facility = await queries.getFacilityByIdScoped(
          req.authContext,
          invoice.facilityId,
        );

        if (!facility || facility.tenantId !== invoice.tenantId) {
          return res.status(404).json({
            success: false,
            error: 'INVOICE_NOT_FOUND',
            message: 'Invoice not found.',
          });
        }

        if (!Array.isArray(facility.enabledModules) || !facility.enabledModules.includes('finance')) {
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
        const detail = await queries.getInvoiceDetailScoped(
          context,
          Number(req.params.id),
        );

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

      const reason =
        typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

      if (!reason) {
        return res.status(400).json({
          success: false,
          error: 'VOID_REASON_REQUIRED',
          message: 'A reason is required to void an invoice.',
        });
      }

      try {
        const invoice = await queries.voidInvoiceScoped(
          context,
          Number(req.params.id),
          reason,
        );

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

        const report = await reporting.getOperationsReportScoped(
          context,
          facilityId,
        );

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

        const points = await reporting.getOccupancyTrendScoped(
          context,
          facilityId,
          days,
        );

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

        const [rows, totals] = await Promise.all([
          billing.getRevenueByServiceType(db, facilityId, range),
          billing.getRevenueTotals(db, facilityId, range),
        ]);

        const totalCents = rows.reduce(
          (sum, row) => sum + billing.toCents(row.revenue),
          0,
        );

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
            .sort(
              (a, b) =>
                billing.toCents(b.revenue) - billing.toCents(a.revenue),
            ),
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

        const facilityId = resolveFacilityScope(
          req.authContext,
          facilityIdInput,
        );
        const facility = await queries.getFacilityByIdScoped(
          req.authContext,
          facilityId,
        );

        if (!facility) {
          return res.status(404).json({
            success: false,
            error: 'FACILITY_NOT_FOUND',
            message: 'Facility not found.',
          });
        }

        if (!Array.isArray(facility.enabledModules) || !facility.enabledModules.includes('finance')) {
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

        const patient = await queries.getPatientByIdScoped(
          req.authContext,
          patientId,
        );

        if (!patient || patient.tenantId !== facility.tenantId) {
          return res.status(400).json({
            success: false,
            error: 'PATIENT_NOT_AVAILABLE',
            message: 'The patient is not available in this tenant scope.',
          });
        }

        const invoiceNumber =
          typeof invoiceInput.invoiceNumber === 'string'
            ? invoiceInput.invoiceNumber.trim()
            : '';

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

            if (
              typeof tariffId !== 'number' ||
              !Number.isSafeInteger(tariffId) ||
              tariffId <= 0
            ) {
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

            if (
              !tariffModule ||
              !facilityHasTariffModule(facility, tariffModule)
            ) {
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

          if (
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

        const payments = await billingPayments.getPaymentLedgerScoped(
          req.authContext,
          {
            facilityId: queryParam(req.query.facilityId),
            invoiceId: queryParam(req.query.invoiceId),
            method: queryParam(req.query.method),
            limit: queryParam(req.query.limit),
          },
        );

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

        const status =
          typeof req.body?.status === 'string' ? req.body.status.trim() : '';
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
          message:
            'A claim cannot be set back to Draft. Use submit, adjudicate or settle.',
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
          needsPreauth:
            typeof body.needsPreauth === 'boolean' ? body.needsPreauth : null,
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
            return res.json(
              await dha.getBenefitsScoped(context, patientId, facilityId),
            );

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
              await dha.getUtilizationScoped(
                context,
                patientId,
                interventionCode,
                facilityId,
              ),
            );
          }

          case 'pomsf-balances':
            return res.json(
              await dha.getPomsfBalancesScoped(
                context,
                patientId,
                query('policyYear'),
                facilityId,
              ),
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
          (
            typeof rawFacilityId !== 'string' ||
            !/^[1-9]\d*$/.test(rawFacilityId)
          )
        ) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_FACILITY_ID',
            message: 'facilityId must be a positive integer.',
          });
        }

        const requestedFacilityId =
          rawFacilityId === undefined
            ? undefined
            : Number(rawFacilityId);

        const facilityId = resolveFacilityScope(
          req.authContext,
          requestedFacilityId,
        );

        const facility = await queries.getFacilityByIdScoped(
          req.authContext,
          facilityId,
        );

        if (!facility) {
          return res.status(404).json({
            success: false,
            error: 'FACILITY_NOT_FOUND',
            message: 'The requested facility was not found.',
          });
        }

        const reports = await queries.getPublicHealthReports(
          facility.id,
        );

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

        if (
          body === null ||
          typeof body !== 'object' ||
          Array.isArray(body)
        ) {
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

        const casesCount =
          input.casesCount === undefined ? 1 : input.casesCount;

        const mortalityCount =
          input.mortalityCount === undefined ? 0 : input.mortalityCount;

        const ageGroup =
          input.ageGroup === undefined
            ? 'Over 5 Years'
            : input.ageGroup;

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

        const facilityId = resolveFacilityScope(
          req.authContext,
          requestedFacilityId,
        );

        const facility = await queries.getFacilityByIdScoped(
          req.authContext,
          facilityId,
        );

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
  "/api/audit-logs",
  requirePermission("audit.read"),
  async (req: AuthRequest, res: Response) => {
    if (!req.authContext) {
      return res.status(401).json({
        success: false,
        error: "AUTHORIZATION_CONTEXT_MISSING",
      });
    }

    const rawFacilityId = req.query.facilityId;
    let facilityId: number | undefined;

    if (rawFacilityId !== undefined) {
      if (
        typeof rawFacilityId !== "string" ||
        !/^[1-9]\d*$/.test(rawFacilityId) ||
        !Number.isSafeInteger(Number(rawFacilityId))
      ) {
        return res.status(400).json({
          success: false,
          error: "INVALID_FACILITY_ID",
          message: "facilityId must be a positive integer.",
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
        error: "FACILITY_ACCESS_DENIED",
        message: "You cannot view another facility's audit logs.",
      });
    }

    try {
      const list = await queries.getAuditLogs(context, facilityId);
      return res.json(list);
    } catch (err: unknown) {
      console.error("Failed to fetch audit logs:", err);

      return res.status(500).json({
        success: false,
        error: "AUDIT_LOG_FETCH_FAILED",
        message: "Unable to retrieve audit logs.",
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

            const patient = await queries.getPatientByIdScoped(
              req.authContext,
              patientId,
            );

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
                profile: [
                  'http://hl7.org/fhir/StructureDefinition/Patient',
                ],
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
                  given: [
                    patient.firstName,
                    ...(patient.middleName
                      ? [patient.middleName]
                      : []),
                  ],
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
              ...(patient.dateOfBirth
                ? { birthDate: patient.dateOfBirth }
                : {}),
              address: [
                {
                  ...(patient.residentialAddress
                    ? { line: [patient.residentialAddress] }
                    : {}),
                  ...(patient.subCounty
                    ? { city: patient.subCounty }
                    : {}),
                  ...(patient.county
                    ? { district: patient.county }
                    : {}),
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
          if (
            typeof rawFacilityId !== 'string' ||
            !/^[1-9]\d*$/.test(rawFacilityId)
          ) {
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

          const facility = await queries.getFacilityByIdScoped(
            req.authContext,
            requestedFacilityId,
          );

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
            db.select({ value: count() })
              .from(schema.patients)
              .where(and(
                eq(schema.patients.tenantId, tenantId),
                eq(schema.patients.registrationFacilityId, facilityId),
              )),

            db.select({ value: count() })
              .from(schema.queues)
              .where(and(
                eq(schema.queues.tenantId, tenantId),
                eq(schema.queues.facilityId, facilityId),
                sql`lower(coalesce(${schema.queues.status}, 'waiting')) IN ('waiting', 'in progress', 'serving')`,
              )),

            db.select({ value: count() })
              .from(schema.admissions)
              .where(and(
                eq(schema.admissions.tenantId, tenantId),
                eq(schema.admissions.facilityId, facilityId),
                sql`lower(coalesce(${schema.admissions.status}, 'admitted')) = 'admitted'`,
              )),

            db.select({
              total: count(),
              occupied: sql<number>`count(*) FILTER (WHERE lower(coalesce(${schema.beds.status}, '')) = 'occupied')`,
            })
              .from(schema.beds)
              .innerJoin(
                schema.wards,
                eq(schema.beds.wardId, schema.wards.id),
              )
              .where(eq(schema.wards.facilityId, facilityId)),

            db.select({ value: count() })
              .from(schema.theatreCases)
              .where(and(
                eq(schema.theatreCases.tenantId, tenantId),
                eq(schema.theatreCases.facilityId, facilityId),
                sql`lower(coalesce(${schema.theatreCases.status}, '')) = 'scheduled'`,
              )),

            db.select({ value: count() })
              .from(schema.labOrders)
              .where(and(
                eq(schema.labOrders.tenantId, tenantId),
                eq(schema.labOrders.facilityId, facilityId),
                sql`lower(coalesce(${schema.labOrders.status}, 'ordered')) NOT IN ('completed', 'cancelled', 'canceled', 'reported', 'rejected')`,
              )),

            db.select({
              revenue: sum(schema.billingInvoices.paidAmount),
              outstanding: sum(schema.billingInvoices.balanceAmount),
            })
              .from(schema.billingInvoices)
              .where(and(
                eq(schema.billingInvoices.tenantId, tenantId),
                eq(schema.billingInvoices.facilityId, facilityId),
              )),

            db.select({ value: count() })
              .from(schema.inventoryItems)
              .where(and(
                eq(schema.inventoryItems.facilityId, facilityId),
                eq(schema.inventoryItems.isActive, true),
                sql`${schema.inventoryItems.currentStock} <= coalesce(${schema.inventoryItems.reorderLevel}, 0)`,
              )),

            /*
             * Batches already expired or expiring within 30 days that
             * still hold stock. expiry_date is stored as ISO text, so a
             * lexicographic comparison is also a chronological one.
             */
            db.select({ value: count() })
              .from(schema.inventoryBatches)
              .innerJoin(
                schema.inventoryItems,
                eq(schema.inventoryBatches.itemId, schema.inventoryItems.id),
              )
              .where(and(
                eq(schema.inventoryItems.facilityId, facilityId),
                sql`${schema.inventoryBatches.quantityRemaining} > 0`,
                sql`${schema.inventoryBatches.expiryDate} <= ${expiryHorizon}`,
              )),
          ]);

          const totalBeds = Number(bedRows[0]?.total ?? 0);
          const occupiedBeds = Number(bedRows[0]?.occupied ?? 0);

          return res.json({
            totalPatients: Number(patientRows[0]?.value ?? 0),
            activeQueuesCount: Number(queueRows[0]?.value ?? 0),
            currentAdmissions: Number(admissionRows[0]?.value ?? 0),
            bedOccupancyRate: totalBeds > 0
              ? Math.round((occupiedBeds / totalBeds) * 1000) / 10
              : 0,
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
    const vite =
      await createViteServer({
        server: {
          middlewareMode: true,
        },

        appType: 'spa',
      });

    app.use(
      vite.middlewares
    );
  } else {
    app.use(
      express.static(
        path.resolve(
          __dirname,
          'dist'
        )
      )
    );

    app.get('*', (req, res) => {
      res.sendFile(
        path.resolve(
          __dirname,
          'dist',
          'index.html'
        )
      );
    });
  }

  // =========================================================


  return app;
}





