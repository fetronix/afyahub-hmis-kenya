import staffInvitationRoutes from './auth/staff-invitation.routes';
import staffRolesRoutes from './auth/staff-roles.routes';
import express, { type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { createApiRoutes } from './routes/index.ts';
import facilityModuleRoutes from './config/facility-modules.routes.ts';
import complianceRoutes from './compliance/compliance.routes.ts';
import portalRoutes from './portal/portal.routes.ts';
import portalAdminRoutes from './portal/portal-admin.routes.ts';
import clinicalRecordsRoutes from './clinical/clinical-records.routes.ts';
import { checkMedicationAllergies } from './clinical/allergy.service.ts';
import { logPatientAccess } from './clinical/access-log.service.ts';
import { resolveLocation } from './constants/kenya-locations.ts';

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
import { chargeSafely } from './routes/shared/charges.ts';
import {
  handleClaimError,
  handleDhaError,
  handleEncounterValidationError,
  handleInpatientError,
  handleInventoryError,
  handlePaymentError,
  handleScopeError,
  respondInternalError,
} from './routes/shared/errors.ts';
import { requestedFacilityHint, requireScopedFacility } from './routes/shared/scoping.ts';
import {
  facilityHasTariffModule,
  requireFacilityAdminTariffRole,
  resolveTariffFacility,
  sendTariffWriteError,
  tariffModuleForDepartment,
  validateTariffInput,
} from './routes/shared/tariffs.ts';
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

  /*
   * Everything below `/api` authentication: module gates, administrator
   * routers and the clinical domains. See ./routes/index.ts.
   */
  app.use('/api', createApiRoutes());

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

      respondInternalError(res, err, 'GET /api/tenants', 'Failed to fetch tenants');
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

      respondInternalError(res, err, 'GET /api/tenants/:id', 'Failed to fetch tenant');
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

      respondInternalError(res, err, 'GET /api/facilities', 'Failed to fetch facilities');
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

      respondInternalError(res, err, 'GET /api/facilities/:id', 'Failed to fetch facility');
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

        respondInternalError(res, err, 'GET /api/departments');
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

        /* The pair is checked before anything is written: a sub-county that
           is not in its county is a refusal, not a value to store. */
        const body = req.body ?? {};
        const location = resolveLocation(body.county, body.subCounty);

        if (!location.ok) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_SUB_COUNTY',
            message: location.message,
          });
        }

        const patient = await queries.createPatientScoped(req.authContext, {
          ...body,
          county: location.county,
          subCounty: location.subCounty,
        });

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

        // A partial update may carry neither field, either one, or both. The
        // pair is only checkable together, so a sub-county on its own is
        // refused rather than stored against a county nobody looked at. A
        // county on its own clears the sub-county: the old one belonged to
        // the county that has just been replaced.
        const body = req.body ?? {};
        const touchesLocation = 'county' in body || 'subCounty' in body;

        let locationPatch: Partial<{ county: string | null; subCounty: string | null }> = {};

        if (touchesLocation) {
          const location = resolveLocation(body.county, body.subCounty);

          if (!location.ok) {
            return res.status(400).json({
              success: false,
              error: 'INVALID_SUB_COUNTY',
              message: location.message,
            });
          }

          locationPatch = { county: location.county, subCounty: location.subCounty };
        }

        const patient = await queries.updatePatientScoped(req.authContext, patientId, {
          ...body,
          ...locationPatch,
        });

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
