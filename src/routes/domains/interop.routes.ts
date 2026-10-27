/**
 * Interoperability (FHIR and DHA).
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions, same order. `src/routes/index.ts` mounts this router after the
 * facility-module gates, which is exactly where these routes sat when they
 * were registered inline in `app.ts`.
 */

import { Router, type Response } from 'express';
import type { AuthRequest } from '../../auth/auth.middleware.ts';
import { and, count, eq, sql, sum } from 'drizzle-orm';
import * as dha from '../../integrations/dha/dha.service.ts';
import {
  handleClaimError,
  handleDhaError,
  handleEncounterValidationError,
  handleInpatientError,
  handleInventoryError,
  handlePaymentError,
  handleScopeError,
  respondInternalError,
} from '../../routes/shared/errors.ts';
import { logPatientAccess } from '../../clinical/access-log.service.ts';
import * as queries from '../../db/queries.ts';
import * as reporting from '../../reporting/reporting.service.ts';
import {
  requireAuthorization,
  requirePermission,
  requireAnyPermission,
  requireSuperAdmin,
} from '../../auth/authorization.middleware.ts';

const router = Router();

// =========================================================
// DHA & INTEROPERABILITY
// =========================================================

router.get(
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

router.get(
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

export default router;
