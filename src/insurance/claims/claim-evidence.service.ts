import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { hasAllPermissions } from '../../auth/authorization.service.ts';
import { requireFacilityScope, requireTenantScope } from '../../auth/scope.service.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';

export class ClaimEvidenceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ClaimEvidenceError';
  }
}

type EvidenceChoice =
  | 'summary'
  | 'diagnoses'
  | 'laboratory'
  | 'radiology'
  | 'prescriptions'
  | 'procedures'
  | 'admission';
const choices: EvidenceChoice[] = [
  'summary',
  'diagnoses',
  'laboratory',
  'radiology',
  'prescriptions',
  'procedures',
  'admission',
];
function positiveId(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new ClaimEvidenceError('INVALID_EVIDENCE_INPUT', 'Use valid record IDs.', 400);
  return id;
}

/**
 * Internal preview only: never transmits, persists a claim attachment, or
 * treats local permissions as consent to disclose. Every clinical collection
 * is constrained to the finalized invoice's exact tenant/facility/patient and
 * encounter. Referral and authorization evidence must be explicitly selected.
 */
export async function previewClaimEvidence(
  context: AuthorizationContext,
  input: Record<string, unknown>,
) {
  const kind = input.payerKind;
  const payerCode = typeof input.payerCode === 'string' ? input.payerCode.trim().toUpperCase() : '';
  if (
    (kind !== 'SHA' && kind !== 'PRIVATE') ||
    !/^[A-Z0-9_-]{2,40}$/.test(payerCode) ||
    (kind === 'SHA' && payerCode !== 'SHA')
  )
    throw new ClaimEvidenceError(
      'INVALID_EVIDENCE_INPUT',
      'Choose the applicable payer workflow and payer code.',
      400,
    );
  const payerPermission =
    kind === 'SHA' ? 'insurance.sha.claims.prepare' : 'insurance.private.claims.prepare';
  if (!hasAllPermissions(context, ['billing.read', 'clinical.read', payerPermission]))
    throw new ClaimEvidenceError(
      'FORBIDDEN',
      'Clinical, billing and the selected payer preparation permissions are required.',
      403,
    );
  const invoiceId = positiveId(input.invoiceId);
  if (!invoiceId)
    throw new ClaimEvidenceError('INVALID_EVIDENCE_INPUT', 'Select a finalized invoice.', 400);
  const selected = input.categories;
  if (
    !Array.isArray(selected) ||
    selected.some((v) => typeof v !== 'string' || !choices.includes(v as EvidenceChoice)) ||
    new Set(selected).size !== selected.length
  )
    throw new ClaimEvidenceError(
      'INVALID_EVIDENCE_INPUT',
      'Select valid evidence categories.',
      400,
    );
  const includes = new Set(selected as EvidenceChoice[]);
  if (includes.has('laboratory') && !hasAllPermissions(context, ['laboratory.read']))
    throw new ClaimEvidenceError(
      'FORBIDDEN',
      'Laboratory read permission is required for laboratory evidence.',
      403,
    );
  if (includes.has('prescriptions') && !hasAllPermissions(context, ['pharmacy.read']))
    throw new ClaimEvidenceError(
      'FORBIDDEN',
      'Pharmacy read permission is required for prescription evidence.',
      403,
    );
  if (includes.has('admission') && !hasAllPermissions(context, ['inpatient.read']))
    throw new ClaimEvidenceError(
      'FORBIDDEN',
      'Inpatient read permission is required for admission evidence.',
      403,
    );
  const referralId = positiveId(input.referralId);
  const preauthorizationId = positiveId(input.preauthorizationId);
  if (referralId && input.referralRelevanceConfirmed !== true)
    throw new ClaimEvidenceError(
      'REFERRAL_REVIEW_REQUIRED',
      'Confirm that the selected referral relates to this encounter.',
      400,
    );

  return db.transaction(
    async (tx) => {
      const [invoice] = await tx
        .select()
        .from(schema.billingInvoices)
        .where(eq(schema.billingInvoices.id, invoiceId))
        .limit(1);
      if (!invoice) throw new ClaimEvidenceError('INVOICE_NOT_FOUND', 'Invoice not found.', 404);
      requireTenantScope(context, invoice.tenantId);
      requireFacilityScope(context, invoice.tenantId, invoice.facilityId);
      const [facility] = await tx
        .select({ enabledModules: schema.facilities.enabledModules })
        .from(schema.facilities)
        .where(
          and(
            eq(schema.facilities.id, invoice.facilityId),
            eq(schema.facilities.tenantId, invoice.tenantId),
          ),
        );
      if (
        !facility ||
        !Array.isArray(facility.enabledModules) ||
        !facility.enabledModules.includes('insurance') ||
        !facility.enabledModules.includes('finance')
      )
        throw new ClaimEvidenceError(
          'FACILITY_MODULE_DISABLED',
          'Finance and insurance must be enabled for this facility.',
          403,
        );
      const [finalization] = await tx
        .select()
        .from(schema.billingInvoiceFinalizations)
        .where(
          and(
            eq(schema.billingInvoiceFinalizations.invoiceId, invoice.id),
            eq(schema.billingInvoiceFinalizations.tenantId, invoice.tenantId),
            eq(schema.billingInvoiceFinalizations.facilityId, invoice.facilityId),
          ),
        );
      if (!invoice.finalizedAt || !finalization || invoice.voidedAt || invoice.status === 'Void')
        throw new ClaimEvidenceError(
          'FINALIZED_INVOICE_REQUIRED',
          'A non-void finalized invoice is required for this evidence preview.',
          409,
        );
      const [encounter] = invoice.encounterId
        ? await tx
            .select()
            .from(schema.encounters)
            .where(
              and(
                eq(schema.encounters.id, invoice.encounterId),
                eq(schema.encounters.tenantId, invoice.tenantId),
                eq(schema.encounters.facilityId, invoice.facilityId),
                eq(schema.encounters.patientId, invoice.patientId),
              ),
            )
        : [];
      if (!encounter)
        throw new ClaimEvidenceError(
          'ENCOUNTER_MISMATCH',
          'The invoice encounter is unavailable in this patient and facility.',
          409,
        );

      const diagnosisRows = includes.has('diagnoses')
        ? await tx
            .select({
              id: schema.diagnoses.id,
              codingSystem: schema.diagnoses.codingSystem,
              diagnosisCode: schema.diagnoses.diagnosisCode,
              diagnosisDisplay: schema.diagnoses.diagnosisDisplay,
              icd10Code: schema.diagnoses.icd10Code,
              icd10Description: schema.diagnoses.icd10Description,
              icd11Code: schema.diagnoses.icd11Code,
              icd11Title: schema.diagnoses.icd11Title,
              diagnosisType: schema.diagnoses.diagnosisType,
              status: schema.diagnoses.status,
            })
            .from(schema.diagnoses)
            .where(
              and(
                eq(schema.diagnoses.encounterId, encounter.id),
                eq(schema.diagnoses.patientId, invoice.patientId),
              ),
            )
            .orderBy(asc(schema.diagnoses.id))
            .limit(201)
        : [];
      const labs = includes.has('laboratory')
        ? await tx
            .select({
              id: schema.labOrders.id,
              testName: schema.labOrders.testName,
              status: schema.labOrders.status,
              orderedAt: schema.labOrders.orderedAt,
            })
            .from(schema.labOrders)
            .where(
              and(
                eq(schema.labOrders.tenantId, invoice.tenantId),
                eq(schema.labOrders.facilityId, invoice.facilityId),
                eq(schema.labOrders.patientId, invoice.patientId),
                eq(schema.labOrders.encounterId, encounter.id),
              ),
            )
            .orderBy(asc(schema.labOrders.id))
            .limit(201)
        : [];
      const labResults = labs.length
        ? await tx
            .select({
              id: schema.labResults.id,
              orderId: schema.labResults.orderId,
              parameterName: schema.labResults.parameterName,
              measuredValue: schema.labResults.measuredValue,
              unit: schema.labResults.unit,
              referenceRange: schema.labResults.referenceRange,
              flag: schema.labResults.flag,
              status: schema.labResults.status,
              verifiedAt: schema.labResults.verifiedAt,
            })
            .from(schema.labResults)
            .where(
              and(
                inArray(
                  schema.labResults.orderId,
                  labs.map((l) => l.id),
                ),
                eq(schema.labResults.patientId, invoice.patientId),
                eq(schema.labResults.status, 'Verified'),
              ),
            )
            .limit(501)
        : [];
      const radiology = includes.has('radiology')
        ? await tx
            .select({
              id: schema.radiologyOrders.id,
              modality: schema.radiologyOrders.modality,
              procedureName: schema.radiologyOrders.procedureName,
              status: schema.radiologyOrders.status,
              findings: schema.radiologyOrders.radiologistFindings,
              impression: schema.radiologyOrders.impression,
              reportedAt: schema.radiologyOrders.reportedAt,
            })
            .from(schema.radiologyOrders)
            .where(
              and(
                eq(schema.radiologyOrders.tenantId, invoice.tenantId),
                eq(schema.radiologyOrders.facilityId, invoice.facilityId),
                eq(schema.radiologyOrders.patientId, invoice.patientId),
                eq(schema.radiologyOrders.encounterId, encounter.id),
              ),
            )
            .orderBy(asc(schema.radiologyOrders.id))
            .limit(201)
        : [];
      const prescriptions = includes.has('prescriptions')
        ? await tx
            .select({
              id: schema.medications.id,
              drugName: schema.medications.drugName,
              dosage: schema.medications.dosage,
              frequency: schema.medications.frequency,
              duration: schema.medications.duration,
              route: schema.medications.route,
              status: schema.medications.status,
              prescribedAt: schema.medications.prescribedAt,
            })
            .from(schema.medications)
            .where(
              and(
                eq(schema.medications.patientId, invoice.patientId),
                eq(schema.medications.encounterId, encounter.id),
              ),
            )
            .orderBy(asc(schema.medications.id))
            .limit(201)
        : [];
      const procedures = includes.has('procedures')
        ? await tx
            .select({
              id: schema.clinicalProcedures.id,
              code: schema.clinicalProcedures.procedureCode,
              name: schema.clinicalProcedures.procedureName,
              status: schema.clinicalProcedures.status,
              performedAt: schema.clinicalProcedures.performedAt,
            })
            .from(schema.clinicalProcedures)
            .where(
              and(
                eq(schema.clinicalProcedures.patientId, invoice.patientId),
                eq(schema.clinicalProcedures.encounterId, encounter.id),
              ),
            )
            .orderBy(asc(schema.clinicalProcedures.id))
            .limit(201)
        : [];
      const admissions = includes.has('admission')
        ? await tx
            .select({
              id: schema.admissions.id,
              status: schema.admissions.status,
              admissionDate: schema.admissions.admissionDate,
              dischargeDate: schema.admissions.dischargeDate,
              dischargeType: schema.admissions.dischargeType,
              dischargeSummary: schema.admissions.dischargeSummary,
            })
            .from(schema.admissions)
            .where(
              and(
                eq(schema.admissions.tenantId, invoice.tenantId),
                eq(schema.admissions.facilityId, invoice.facilityId),
                eq(schema.admissions.patientId, invoice.patientId),
                eq(schema.admissions.encounterId, encounter.id),
              ),
            )
            .orderBy(asc(schema.admissions.id))
            .limit(201)
        : [];
      if (
        [diagnosisRows, labs, radiology, prescriptions, procedures, admissions].some(
          (rows) => rows.length > 200,
        ) ||
        labResults.length > 500
      )
        throw new ClaimEvidenceError(
          'EVIDENCE_TOO_LARGE',
          'This encounter has too many records for one preview. Review evidence manually.',
          409,
        );

      let referral = null;
      if (referralId) {
        const [row] = await tx
          .select({
            id: schema.referrals.id,
            referralNumber: schema.referrals.referralNumber,
            reason: schema.referrals.reason,
            clinicalSummary: schema.referrals.clinicalSummary,
            status: schema.referrals.status,
          })
          .from(schema.referrals)
          .where(
            and(
              eq(schema.referrals.id, referralId),
              eq(schema.referrals.patientId, invoice.patientId),
              or(
                and(
                  eq(schema.referrals.sourceTenantId, invoice.tenantId),
                  eq(schema.referrals.sourceFacilityId, invoice.facilityId),
                ),
                and(
                  eq(schema.referrals.destinationTenantId, invoice.tenantId),
                  eq(schema.referrals.destinationFacilityId, invoice.facilityId),
                ),
              ),
            ),
          )
          .limit(1);
        if (!row)
          throw new ClaimEvidenceError(
            'REFERRAL_NOT_AVAILABLE',
            'The selected referral is not available in this patient and facility.',
            404,
          );
        referral = row;
        await tx.insert(schema.referralAccessLogs).values({
          referralId: row.id,
          patientId: invoice.patientId,
          userId: context.userId,
          facilityId: invoice.facilityId,
          action: 'VIEW',
        });
      }
      let authorization = null;
      if (preauthorizationId) {
        const [row] = await tx
          .select({
            id: schema.insurancePreauthorizations.id,
            payerCode: schema.insurancePreauthorizations.payerCode,
            number: schema.insurancePreauthorizations.preauthNumber,
            status: schema.insurancePreauthorizations.status,
            source: schema.insurancePreauthorizations.source,
            isSimulated: schema.insurancePreauthorizations.isSimulated,
            payerReference: schema.insurancePreauthorizations.payerAuthReference,
          })
          .from(schema.insurancePreauthorizations)
          .where(
            and(
              eq(schema.insurancePreauthorizations.id, preauthorizationId),
              eq(schema.insurancePreauthorizations.tenantId, invoice.tenantId),
              eq(schema.insurancePreauthorizations.facilityId, invoice.facilityId),
              eq(schema.insurancePreauthorizations.patientId, invoice.patientId),
              eq(schema.insurancePreauthorizations.payerCode, payerCode),
              or(
                eq(schema.insurancePreauthorizations.invoiceId, invoice.id),
                eq(schema.insurancePreauthorizations.encounterId, encounter.id),
              ),
              or(
                isNull(schema.insurancePreauthorizations.invoiceId),
                eq(schema.insurancePreauthorizations.invoiceId, invoice.id),
              ),
              or(
                isNull(schema.insurancePreauthorizations.encounterId),
                eq(schema.insurancePreauthorizations.encounterId, encounter.id),
              ),
            ),
          )
          .limit(1);
        if (!row)
          throw new ClaimEvidenceError(
            'PREAUTH_NOT_AVAILABLE',
            'The selected authorization does not match this patient, payer and invoice or encounter.',
            404,
          );
        authorization = row;
      }
      await tx.insert(schema.patientRecordAccessLogs).values({
        patientId: invoice.patientId,
        userId: context.userId,
        tenantId: invoice.tenantId,
        facilityId: invoice.facilityId,
        action: 'VIEW',
        accessChannel: 'STAFF_PORTAL',
        recordType: 'ClaimEvidencePreview',
        recordId: invoice.id,
        purpose: 'BILLING',
      });
      return {
        notice:
          'Internal preview only. It does not attach, transmit, establish consent, coverage, approval or payment. Select and verify payer-required evidence separately.',
        payerKind: kind,
        payerCode,
        invoice: finalization.snapshot,
        summary: includes.has('summary')
          ? {
              chiefComplaint: encounter.chiefComplaint,
              historyOfPresentIllness: encounter.historyOfPresentIllness,
              physicalExamination: encounter.physicalExamination,
              clinicalNotes: encounter.clinicalNotes,
            }
          : null,
        diagnoses: diagnosisRows,
        laboratory: labs.map((l) => ({
          ...l,
          verifiedResults: labResults.filter((r) => r.orderId === l.id),
        })),
        radiology: radiology.map((r) =>
          r.reportedAt ? r : { ...r, findings: null, impression: null },
        ),
        prescriptions,
        procedures,
        admissions,
        referral,
        authorization,
        limitations: [
          'Clinical categories are selected explicitly; the finalized invoice itself includes recorded diagnoses.',
          'Radiology findings are omitted when a report time is not recorded.',
          'Laboratory results are limited to recorded verified results.',
          'Referrals have no direct encounter link in the current schema and require explicit relevance review.',
          'External documents, actual claim attachment and payer transmission are not implemented by this preview.',
        ],
      };
    },
    { isolationLevel: 'repeatable read' },
  );
}
