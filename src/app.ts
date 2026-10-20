import staffInvitationRoutes from "./auth/staff-invitation.routes";
import express, { type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';


import platformRoutes from './routes/platform.routes.ts';




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
} from './auth/authorization.middleware.ts';
import type { AuthRequest } from './auth/auth.middleware.ts';
import {
  ScopeAccessError,
  resolveFacilityScope,
} from './auth/scope.service.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.resolve(path.dirname(__filename), '..');

const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;


export async function createApp() {

  const app = express();

  app.use(express.json());

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

// Facility module enforcement. Keep platform administration, invitations,
// tenants, and facility-context endpoints outside these operational guards.
app.use('/api/patients', requireFacilityModule('registration'));
app.use('/api/appointments', requireFacilityModule('reception'));
app.use('/api/queues', requireFacilityModule('reception'));

app.use('/api/encounters', requireFacilityModule('opd'));
app.use('/api/observations', requireFacilityModule('opd'));
app.use('/api/diagnoses', requireFacilityModule('opd'));
app.use('/api/procedures', requireFacilityModule('opd'));

app.use('/api/wards', requireFacilityModule('inpatient'));
app.use('/api/beds', requireFacilityModule('inpatient'));
app.use('/api/admissions', requireFacilityModule('inpatient'));
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
app.use('/api/public-health', requireFacilityModule('public_health'));
app.use('/api/analytics', requireFacilityModule('analytics'));
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
      res.status(403).json({
        success: false,
        error: error.code,
        message: error.message,
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

  app.get('/api/departments', async (req, res) => {
    try {
      const facilityId = req.query.facilityId
        ? Number(req.query.facilityId)
        : undefined;

      const list = await queries.getDepartments(
        facilityId
      );

      res.json(list);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });


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

                  // Record sensitive patient-data access before returning data.
            // If this insert fails, the outer catch returns an error
            // instead of silently serving an unaudited FHIR response.
            await db.insert(schema.patientRecordAccessLogs).values({
              patientId: patient.id,
              userId: req.authContext.userId,
              tenantId: patient.tenantId,
              facilityId: patient.registrationFacilityId,
              action: 'EXPORT',
              accessChannel: 'FHIR',
              recordType: 'Patient',
              recordId: patient.id,
              purpose: 'FHIR patient resource retrieval',
              ipAddress: req.ip ?? null,
              userAgent: req.get('user-agent') ?? null,
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

      return res.status(201).json(encounter);
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

  app.put('/api/queues/:id/status', requirePermission('appointments.update'), async (req, res) => {
    try {
      const { status } = req.body;

      const updated =
        await queries.updateQueueStatus(
          Number(req.params.id),
          status
        );

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
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

  app.get('/api/observations', requirePermission('clinical.read'), async (req, res) => {
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
        await queries.getObservations(
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

  app.post('/api/observations', requirePermission('clinical.create'), async (req, res) => {
    try {
      const obs =
        await queries.recordObservation(
          req.body
        );

      res.status(201).json(obs);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  // =========================================================
  // DIAGNOSES & PROCEDURES
  // =========================================================

  app.get('/api/diagnoses', requirePermission('clinical.read'), async (req, res) => {
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
        await queries.getDiagnoses(
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

  app.post('/api/diagnoses', requirePermission('clinical.create'), async (req, res) => {
    try {
      const diag =
        await queries.recordDiagnosis(
          req.body
        );

      res.status(201).json(diag);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.get('/api/procedures', requirePermission('clinical.read'), async (req, res) => {
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
        await queries.getProcedures(
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

  app.post('/api/procedures', requirePermission('clinical.create'), async (req, res) => {
    try {
      const proc =
        await queries.recordProcedure(
          req.body
        );

      res.status(201).json(proc);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
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

  app.post('/api/medications', requirePermission('clinical.create'), async (req, res) => {
    try {
      const med =
        await queries.createMedication(
          req.body
        );

      res.status(201).json(med);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

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

        res.status(201).json(admission);
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

        res.json(admission);
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
  // THEATRE CASES
  // =========================================================

  app.get('/api/theatre-cases', async (req, res) => {
    try {
      const facilityId =
        req.query.facilityId
          ? Number(req.query.facilityId)
          : undefined;

      const list =
        await queries.getTheatreCases(
          facilityId
        );

      res.json(list);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.post('/api/theatre-cases', async (req, res) => {
    try {
      const tc =
        await queries.createTheatreCase(
          req.body
        );

      res.status(201).json(tc);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.put('/api/theatre-cases/:id', async (req, res) => {
    try {
      const tc =
        await queries.updateTheatreCase(
          Number(req.params.id),
          req.body
        );

      res.json(tc);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

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
        return res.status(201).json(result);
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

      res.status(201).json(order);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

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

  app.get('/api/radiology-orders', async (req, res) => {
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
        await queries.getRadiologyOrders(
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

  app.post('/api/radiology-orders', async (req, res) => {
    try {
      const order =
        await queries.createRadiologyOrder(
          req.body
        );

      res.status(201).json(order);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.put('/api/radiology-orders/:id/report', async (req, res) => {
    try {
      const {
        findings,
        impression,
        reportedBy,
      } = req.body;

      const order =
        await queries.updateRadiologyReport(
          Number(req.params.id),
          findings,
          impression,
          reportedBy
        );

      res.json(order);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  // =========================================================
  // PHARMACY & INVENTORY
  // =========================================================

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

  app.post('/api/pharmacy/dispense', requirePermission('pharmacy.dispense'), async (req, res) => {
    try {
      const disp =
        await queries.dispenseMedication(
          req.body
        );

      res.status(201).json(disp);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  // =========================================================
  // PROCUREMENT
  // =========================================================

  app.get('/api/suppliers', async (req, res) => {
    try {
      const tenantId =
        req.query.tenantId
          ? Number(req.query.tenantId)
          : undefined;

      const list =
        await queries.getSuppliers(
          tenantId
        );

      res.json(list);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.get('/api/purchase-orders', async (req, res) => {
    try {
      const facilityId =
        req.query.facilityId
          ? Number(req.query.facilityId)
          : undefined;

      const list =
        await queries.getPurchaseOrders(
          facilityId
        );

      res.json(list);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.post('/api/purchase-orders', async (req, res) => {
    try {
      const po =
        await queries.createPurchaseOrder(
          req.body
        );

      res.status(201).json(po);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

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

        const input = req.body;
        const invoiceId = Number(input?.invoiceId);
        const amount = Number(input?.amount);
        const receiptNumber =
          typeof input?.receiptNumber === 'string'
            ? input.receiptNumber.trim()
            : '';
        const paymentMethod =
          typeof input?.paymentMethod === 'string'
            ? input.paymentMethod.trim()
            : '';

        if (
          !Number.isSafeInteger(invoiceId) ||
          invoiceId <= 0 ||
          !Number.isFinite(amount) ||
          amount <= 0 ||
          !/^\d+(\.\d{1,2})?$/.test(String(input?.amount)) ||
          !receiptNumber ||
          receiptNumber.length > 100 ||
          !paymentMethod ||
          paymentMethod.length > 40
        ) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_PAYMENT',
            message: 'Invoice, receipt, payment method, and amount must be valid.',
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

        const balanceCents = Math.round(Number(invoice.balanceAmount ?? 0) * 100);
        const paymentCents = Math.round(amount * 100);

        if (
          !Number.isSafeInteger(balanceCents) ||
          balanceCents <= 0 ||
          paymentCents > balanceCents
        ) {
          return res.status(400).json({
            success: false,
            error: 'PAYMENT_EXCEEDS_BALANCE',
            message: 'Payment must be positive and cannot exceed the invoice balance.',
          });
        }

        const payment = await queries.recordPayment({
          invoiceId,
          receiptNumber,
          paymentMethod,
          amount: (paymentCents / 100).toFixed(2),
          referenceCode:
            typeof input.referenceCode === 'string'
              ? input.referenceCode.trim().slice(0, 150)
              : null,
          cashierName: req.user.fullName,
        });

        return res.status(201).json(payment);
      } catch (err: unknown) {
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

  app.post(
    '/api/claims',
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

        const input = req.body;
        const facilityIdInput = Number(input?.facilityId);
        const invoiceId = Number(input?.invoiceId);
        const patientId = Number(input?.patientId);
        const claimNumber =
          typeof input?.claimNumber === 'string'
            ? input.claimNumber.trim()
            : '';
        const claimAmount = Number(input?.claimAmount);

        if (
          !Number.isSafeInteger(facilityIdInput) ||
          facilityIdInput <= 0 ||
          !Number.isSafeInteger(invoiceId) ||
          invoiceId <= 0 ||
          !Number.isSafeInteger(patientId) ||
          patientId <= 0 ||
          !claimNumber ||
          claimNumber.length > 100 ||
          !Number.isFinite(claimAmount) ||
          claimAmount <= 0 ||
          !/^\d+(\.\d{1,2})?$/.test(String(input?.claimAmount))
        ) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_CLAIM',
            message: 'Facility, invoice, patient, claim number, and claim amount must be valid.',
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

        const [invoice] = await db
          .select()
          .from(schema.billingInvoices)
          .where(eq(schema.billingInvoices.id, invoiceId))
          .limit(1);

        if (
          !invoice ||
          invoice.facilityId !== facilityId ||
          invoice.tenantId !== facility.tenantId ||
          invoice.patientId !== patientId
        ) {
          return res.status(400).json({
            success: false,
            error: 'CLAIM_INVOICE_MISMATCH',
            message: 'The selected invoice must belong to the selected patient and facility.',
          });
        }

        const invoiceCents = Math.round(Number(invoice.totalAmount ?? 0) * 100);
        const claimCents = Math.round(claimAmount * 100);

        if (
          !Number.isSafeInteger(invoiceCents) ||
          !Number.isSafeInteger(claimCents) ||
          claimCents > invoiceCents
        ) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_CLAIM_AMOUNT',
            message: 'The claim amount cannot exceed the invoice total.',
          });
        }

        const canSubmit = req.authContext.permissions.includes(
          'insurance.claims.submit',
        );

        const claim = await queries.createClaim({
          tenantId: facility.tenantId,
          facilityId,
          patientId,
          invoiceId,
          claimNumber,
          payerName:
            typeof input.payerName === 'string'
              ? input.payerName.slice(0, 200)
              : 'Social Health Authority (SHA)',
          policyNumber:
            typeof input.policyNumber === 'string'
              ? input.policyNumber.slice(0, 100)
              : null,
          preAuthCode:
            typeof input.preAuthCode === 'string'
              ? input.preAuthCode.slice(0, 100)
              : null,
          claimAmount: (claimCents / 100).toFixed(2),
          status: canSubmit ? 'Submitted' : 'Draft',
          submittedAt: canSubmit ? new Date() : null,
          adjudicationNotes:
            typeof input.adjudicationNotes === 'string'
              ? input.adjudicationNotes.slice(0, 2000)
              : null,
        });

        return res.status(201).json(claim);
      } catch (err: unknown) {
        if (handleScopeError(err, res)) return;

        console.error('Failed to create claim:', err);
        return res.status(500).json({
          success: false,
          error: 'CLAIM_CREATE_FAILED',
          message: 'Failed to create insurance claim.',
        });
      }
    },
  );

  app.put(
    '/api/claims/:id/status',
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

        const claimId = Number(req.params.id);
        const input = req.body;
        const status =
          typeof input?.status === 'string'
            ? input.status.trim()
            : '';
        const allowedStatuses = [
          'Draft',
          'Submitted',
          'Approved',
          'Settled',
          'Rejected',
        ];

        if (
          !Number.isSafeInteger(claimId) ||
          claimId <= 0 ||
          !allowedStatuses.includes(status)
        ) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_CLAIM_UPDATE',
            message: 'A valid claim ID and status are required.',
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

        const claims = await queries.getClaims(facilityId);
        const existingClaim = claims.find((claim) => claim.id === claimId);

        if (!existingClaim || existingClaim.tenantId !== facility.tenantId) {
          return res.status(404).json({
            success: false,
            error: 'CLAIM_NOT_FOUND',
            message: 'Claim not found.',
          });
        }

        let approvedAmount: string | undefined;

        if (input.approvedAmount !== undefined) {
          const parsedAmount = Number(input.approvedAmount);
          const maximumAmount = Number(existingClaim.claimAmount);

          if (
            !Number.isFinite(parsedAmount) ||
            parsedAmount < 0 ||
            !/^\d+(\.\d{1,2})?$/.test(String(input.approvedAmount)) ||
            parsedAmount > maximumAmount
          ) {
            return res.status(400).json({
              success: false,
              error: 'INVALID_APPROVED_AMOUNT',
              message: 'The approved amount must be non-negative and cannot exceed the claim amount.',
            });
          }

          approvedAmount = parsedAmount.toFixed(2);
        }

        if (
          (status === 'Approved' || status === 'Settled') &&
          approvedAmount === undefined &&
          Number(existingClaim.approvedAmount ?? 0) <= 0
        ) {
          return res.status(400).json({
            success: false,
            error: 'APPROVED_AMOUNT_REQUIRED',
            message: 'An approved amount is required before approving or settling a claim.',
          });
        }

        const notes =
          typeof input.notes === 'string'
            ? input.notes.slice(0, 2000)
            : undefined;

        const claim = await queries.updateClaimStatus(
          claimId,
          status,
          approvedAmount,
          notes,
        );

        if (!claim) {
          return res.status(404).json({
            success: false,
            error: 'CLAIM_NOT_FOUND',
            message: 'Claim not found.',
          });
        }

        return res.json(claim);
      } catch (err: unknown) {
        if (handleScopeError(err, res)) return;

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

          const [
            patientRows,
            queueRows,
            admissionRows,
            bedRows,
            surgeryRows,
            labRows,
            invoiceRows,
            inventoryRows,
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





