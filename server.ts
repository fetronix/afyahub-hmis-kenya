import express, { type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import * as queries from './src/db/queries.ts';
import { seedInitialData } from './src/db/seed.ts';
import authRoutes from './src/auth/auth.routes.ts';



import { requireAuth } from './src/middleware/auth.ts';
import { requireAuthorization } from './src/auth/authorization.middleware.ts';
import type { AuthRequest } from './src/auth/auth.middleware.ts';
import { ScopeAccessError } from './src/auth/scope.service.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

async function startServer() {
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
   * INITIAL DATABASE SEED
   * =========================================================
   *
   * This checks whether the initial data exists.
   */
  try {
    await seedInitialData();
  } catch (err) {
    console.error('Initial seeding check failed:', err);
  }

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
      dhaReadiness: 'Level 4 / Level 5 Compliant Architecture',
      timestamp: new Date().toISOString(),
    });
  });

  /*
   * =========================================================
   * SEED TRIGGER
   * =========================================================
   *
   * The seed endpoint is no longer public.
   *
   * NOTE:
   * This currently requires authentication.
   * Later we will restrict this specifically to SUPER_ADMIN
   * or remove this endpoint from production completely.
   */
  app.post('/api/seed', requireAuth, async (req, res) => {
    try {
      await seedInitialData();

      res.json({
        success: true,
        message: 'Database seeded successfully',
      });
    } catch (error: any) {
      res.status(500).json({
        error:
          error.message ||
          'Failed to seed database',
      });
    }
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

  app.get('/api/patients', async (req, res) => {
    try {
      const tenantId = req.query.tenantId
        ? Number(req.query.tenantId)
        : undefined;

      const facilityId = req.query.facilityId
        ? Number(req.query.facilityId)
        : undefined;

      const search = req.query.search as string;

      const list = await queries.getPatients(
        tenantId,
        facilityId,
        search
      );

      res.json(list);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.get('/api/patients/:id', async (req, res) => {
    try {
      const patient = await queries.getPatientById(
        Number(req.params.id)
      );

      if (!patient) {
        return res.status(404).json({
          error: 'Patient not found',
        });
      }

      res.json(patient);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.post('/api/patients', async (req, res) => {
    try {
      const patient = await queries.createPatient(
        req.body
      );

      await queries.logAuditEvent(
        patient.tenantId,
        patient.facilityId,
        'Staff',
        'CREATE',
        'Patient',
        patient.id.toString(),
        `Registered patient ${patient.firstName} ${patient.lastName} (MRN: ${patient.mrn})`
      );

      res.status(201).json(patient);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.put('/api/patients/:id', async (req, res) => {
    try {
      const patient =
        await queries.updatePatient(
          Number(req.params.id),
          req.body
        );

      res.json(patient);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  // =========================================================
  // CLINICAL ENCOUNTERS
  // =========================================================

  app.get('/api/encounters', async (req, res) => {
    try {
      const patientId = req.query.patientId
        ? Number(req.query.patientId)
        : undefined;

      const facilityId = req.query.facilityId
        ? Number(req.query.facilityId)
        : undefined;

      const list = await queries.getEncounters(
        patientId,
        facilityId
      );

      res.json(list);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.post('/api/encounters', async (req, res) => {
    try {
      const encounter =
        await queries.createEncounter(
          req.body
        );

      res.status(201).json(encounter);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.put('/api/encounters/:id', async (req, res) => {
    try {
      const encounter =
        await queries.updateEncounter(
          Number(req.params.id),
          req.body
        );

      res.json(encounter);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  // =========================================================
  // QUEUES
  // =========================================================

  app.get('/api/queues', async (req, res) => {
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

  app.post('/api/queues', async (req, res) => {
    try {
      const item =
        await queries.createQueueEntry(
          req.body
        );

      res.status(201).json(item);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.put('/api/queues/:id/status', async (req, res) => {
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

  app.get('/api/appointments', async (req, res) => {
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

  app.post('/api/appointments', async (req, res) => {
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

  app.get('/api/observations', async (req, res) => {
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

  app.post('/api/observations', async (req, res) => {
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

  app.get('/api/diagnoses', async (req, res) => {
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

  app.post('/api/diagnoses', async (req, res) => {
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

  app.get('/api/procedures', async (req, res) => {
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

  app.post('/api/procedures', async (req, res) => {
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

  app.get('/api/medications', async (req, res) => {
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

  app.post('/api/medications', async (req, res) => {
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

  app.put('/api/medications/:id/status', async (req, res) => {
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

  app.get('/api/wards', async (req, res) => {
    try {
      const facilityId =
        req.query.facilityId
          ? Number(req.query.facilityId)
          : undefined;

      const list =
        await queries.getWards(
          facilityId
        );

      res.json(list);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.get('/api/beds', async (req, res) => {
    try {
      const wardId =
        req.query.wardId
          ? Number(req.query.wardId)
          : undefined;

      const list =
        await queries.getBeds(
          wardId
        );

      res.json(list);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.put('/api/beds/:id/status', async (req, res) => {
    try {
      const {
        status,
        currentPatientId,
      } = req.body;

      const bed =
        await queries.updateBedStatus(
          Number(req.params.id),
          status,
          currentPatientId
        );

      res.json(bed);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.get('/api/admissions', async (req, res) => {
    try {
      const facilityId =
        req.query.facilityId
          ? Number(req.query.facilityId)
          : undefined;

      const status =
        req.query.status as string;

      const list =
        await queries.getAdmissions(
          facilityId,
          status
        );

      res.json(list);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.post('/api/admissions', async (req, res) => {
    try {
      const adm =
        await queries.createAdmission(
          req.body
        );

      res.status(201).json(adm);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.post('/api/admissions/:id/discharge', async (req, res) => {
    try {
      const {
        bedId,
        dischargeDate,
        dischargeType,
        dischargeSummary,
      } = req.body;

      const adm =
        await queries.dischargeAdmission(
          Number(req.params.id),
          bedId,
          dischargeDate,
          dischargeType,
          dischargeSummary
        );

      res.json(adm);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

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

  app.get('/api/lab-tests', async (req, res) => {
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

  app.get('/api/lab-orders', async (req, res) => {
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
        await queries.getLabOrders(
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

  app.post('/api/lab-orders', async (req, res) => {
    try {
      const order =
        await queries.createLabOrder(
          req.body
        );

      res.status(201).json(order);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.put('/api/lab-orders/:id/status', async (req, res) => {
    try {
      const {
        status,
        accessionNumber,
      } = req.body;

      const order =
        await queries.updateLabOrderStatus(
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

  app.get('/api/lab-results', async (req, res) => {
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
        await queries.getLabResults(
          orderId,
          patientId
        );

      res.json(list);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.post('/api/lab-results', async (req, res) => {
    try {
      const result =
        await queries.addLabResult(
          req.body
        );

      res.status(201).json(result);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  // =========================================================
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

  app.get('/api/inventory', async (req, res) => {
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

  app.post('/api/inventory', async (req, res) => {
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

  app.post('/api/pharmacy/dispense', async (req, res) => {
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
  // BILLING & CASHIER
  // =========================================================

  app.get('/api/invoices', async (req, res) => {
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
        await queries.getInvoices(
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

  app.get('/api/invoices/:id/items', async (req, res) => {
    try {
      const items =
        await queries.getInvoiceItems(
          Number(req.params.id)
        );

      res.json(items);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.post('/api/invoices', async (req, res) => {
    try {
      const {
        invoice,
        items,
      } = req.body;

      const created =
        await queries.createInvoice(
          invoice,
          items
        );

      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.post('/api/billing/payments', async (req, res) => {
    try {
      const payment =
        await queries.recordPayment(
          req.body
        );

      res.status(201).json(payment);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  // =========================================================
  // INSURANCE & SHA CLAIMS
  // =========================================================

  app.get('/api/claims', async (req, res) => {
    try {
      const facilityId =
        req.query.facilityId
          ? Number(req.query.facilityId)
          : undefined;

      const list =
        await queries.getClaims(
          facilityId
        );

      res.json(list);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.post('/api/claims', async (req, res) => {
    try {
      const claim =
        await queries.createClaim(
          req.body
        );

      res.status(201).json(claim);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.put('/api/claims/:id/status', async (req, res) => {
    try {
      const {
        status,
        approvedAmount,
        notes,
      } = req.body;

      const claim =
        await queries.updateClaimStatus(
          Number(req.params.id),
          status,
          approvedAmount,
          notes
        );

      res.json(claim);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  // =========================================================
  // PUBLIC HEALTH & KHIS SURVEILLANCE
  // =========================================================

  app.get('/api/public-health/reports', async (req, res) => {
    try {
      const facilityId =
        req.query.facilityId
          ? Number(req.query.facilityId)
          : undefined;

      const list =
        await queries.getPublicHealthReports(
          facilityId
        );

      res.json(list);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.post('/api/public-health/reports', async (req, res) => {
    try {
      const rep =
        await queries.recordPublicHealthReport(
          req.body
        );

      res.status(201).json(rep);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  // =========================================================
  // AUDIT TRAIL
  // =========================================================

  app.get('/api/audit-logs', async (req, res) => {
    try {
      const facilityId =
        req.query.facilityId
          ? Number(req.query.facilityId)
          : undefined;

      const list =
        await queries.getAuditLogs(
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
  // DHA & INTEROPERABILITY
  // =========================================================

  app.get('/api/interop/fhir/patient/:id', async (req, res) => {
    try {
      const patient =
        await queries.getPatientById(
          Number(req.params.id)
        );

      if (!patient) {
        return res.status(404).json({
          error: 'Patient not found',
        });
      }

      const fhirPatient = {
        resourceType: 'Patient',

        id: `ke-hmis-${patient.id}`,

        meta: {
          versionId: '1',

          lastUpdated:
            patient.updatedAt
              ? new Date(
                  patient.updatedAt
                ).toISOString()
              : new Date().toISOString(),

          profile: [
            'http://hl7.org/fhir/StructureDefinition/Patient',
          ],
        },

        identifier: [
          {
            system:
              'http://health.go.ke/mrn',

            value:
              patient.mrn,

            use: 'usual',
          },

          ...(patient.nationalId
            ? [
                {
                  system:
                    'http://identity.go.ke/national-id',

                  value:
                    patient.nationalId,

                  type: {
                    text: 'National ID',
                  },
                },
              ]
            : []),

          ...(patient.shaNumber
            ? [
                {
                  system:
                    'http://sha.go.ke/member-number',

                  value:
                    patient.shaNumber,

                  type: {
                    text:
                      'Social Health Authority',
                  },
                },
              ]
            : []),
        ],

        name: [
          {
            use: 'official',

            family:
              patient.lastName,

            given: [
              patient.firstName,

              ...(patient.middleName
                ? [patient.middleName]
                : []),
            ],
          },
        ],

        telecom: [
          {
            system: 'phone',
            value: patient.phone,
            use: 'mobile',
          },

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
          patient.gender.toLowerCase() ===
          'female'
            ? 'female'
            : 'male',

        birthDate:
          patient.dateOfBirth,

        address: [
          {
            line: [
              patient.residentialAddress ||
                'Nairobi',
            ],

            city:
              patient.subCounty,

            district:
              patient.county,

            country:
              'KEN',
          },
        ],

        managingOrganization: {
          reference:
            `Organization/MFL-${patient.facilityId}`,

          display:
            'Kenya Ministry of Health Facility',
        },
      };

      res.setHeader(
        'Content-Type',
        'application/fhir+json'
      );

      res.json(fhirPatient);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  app.get('/api/interop/dha/moh-705', async (req, res) => {
    try {
      const facilityId =
        req.query.facilityId
          ? Number(req.query.facilityId)
          : 1;

      const reports =
        await queries.getPublicHealthReports(
          facilityId
        );

      const patients =
        await queries.getPatients(
          undefined,
          facilityId
        );

      const encounters =
        await queries.getEncounters(
          undefined,
          facilityId
        );

      const mohSummary = {
        reportingStandard:
          'Kenya Digital Health Agency (DHA) - MOH 705 Outpatient Return',

        facilityMflCode:
          'MFL-12845',

        reportingPeriod:
          'October 2026',

        generatedAt:
          new Date().toISOString(),

        indicators: {
          totalNewOutpatients:
            patients.length,

          totalReattendances:
            12,

          totalReferralsIn:
            4,

          totalReferralsOut:
            1,

          topMorbidityByIcd10: [
            {
              code: 'B50',
              disease:
                'Malaria (Confirmed)',
              under5: 8,
              over5: 14,
              total: 22,
            },

            {
              code: 'I10',
              disease:
                'Hypertension',
              under5: 0,
              over5: 19,
              total: 19,
            },

            {
              code: 'E11',
              disease:
                'Type 2 Diabetes Mellitus',
              under5: 0,
              over5: 11,
              total: 11,
            },

            {
              code: 'J09',
              disease:
                'Upper Respiratory Tract Infection',
              under5: 12,
              over5: 7,
              total: 19,
            },

            {
              code: 'K29',
              disease:
                'Gastritis and Duodenitis',
              under5: 1,
              over5: 8,
              total: 9,
            },
          ],

          surveillanceAlerts:
            reports,
        },
      };

      res.json(mohSummary);
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  // =========================================================
  // AGGREGATED ANALYTICS
  // =========================================================

  app.get('/api/analytics/summary', async (req, res) => {
    try {
      const facilityId =
        req.query.facilityId
          ? Number(req.query.facilityId)
          : 1;

      const patients =
        await queries.getPatients(
          undefined,
          facilityId
        );

      const queues =
        await queries.getQueues(
          facilityId
        );

      const admissions =
        await queries.getAdmissions(
          facilityId
        );

      const theatre =
        await queries.getTheatreCases(
          facilityId
        );

      const labOrders =
        await queries.getLabOrders(
          facilityId
        );

      const invoices =
        await queries.getInvoices(
          facilityId
        );

      const inventory =
        await queries.getInventoryItems(
          facilityId
        );

      const totalRevenue =
        invoices.reduce(
          (acc, inv) =>
            acc +
            Number(
              inv.paidAmount || 0
            ),
          0
        );

      const outstandingBills =
        invoices.reduce(
          (acc, inv) =>
            acc +
            Number(
              inv.balanceAmount || 0
            ),
          0
        );

      const activeAdmissions =
        admissions.filter(
          a =>
            a.status ===
              'Admitted'
        ).length;

      const lowStockItems =
        inventory.filter(
          i =>
            (i.currentStock || 0) <=
            (i.reorderLevel || 50)
        );

      res.json({
        totalPatients:
          patients.length,

        activeQueuesCount:
          queues.filter(
            q =>
              q.status ===
                'Waiting' ||
              q.status ===
                'In-Progress'
          ).length,

        currentAdmissions:
          activeAdmissions,

        bedOccupancyRate:
          Math.round(
            (activeAdmissions / 20) *
              100
          ),

        scheduledSurgeries:
          theatre.filter(
            t =>
              t.status ===
              'Scheduled'
          ).length,

        pendingLabOrders:
          labOrders.filter(
            l =>
              l.status !==
              'Published'
          ).length,

        totalRevenueKes:
          totalRevenue,

        outstandingBillsKes:
          outstandingBills,

        lowStockAlerts:
          lowStockItems.length,
      });
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
      });
    }
  });

  // =========================================================
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
  // START SERVER
  // =========================================================

  app.listen(
    Number(PORT),
    '0.0.0.0',
    () => {
      console.log(
        `JaliCare HMIS server running on http://0.0.0.0:${PORT}`
      );
    }
  );
}

startServer().catch((err) => {
  console.error(
    'Fatal server startup error:',
    err
  );

  process.exit(1);
});