/** SHA gateway concern: benefits. */
import { randomUUID } from 'node:crypto';
import { asObj, readStr, readNumMoney } from './sha.values.ts';
import type { ShaGatewayContext } from './sha.context.ts';
import type {
  HieInterventionCoverageItem,
  HieBenefitsLookupRequest,
  HieBenefitsLookupResult,
} from './sha.types.ts';

export async function fetchPatientBenefitsAndInterventions(
  context: ShaGatewayContext,
  req: HieBenefitsLookupRequest,
): Promise<HieBenefitsLookupResult> {
  const cfg = context.resolveConfig(req.facilityRegistryOverride);
  const correlationId = req.correlationId ?? randomUUID();
  const crId = req.memberCrNumber.trim();

  if (cfg.mode === 'mock') {
    const allSimInterventions: HieInterventionCoverageItem[] = [
      {
        code: 'SHA-12-001',
        name: 'Outpatient Consultation & Primary Care',
        accessPoint: 'OP',
        fund: 'PHC',
        paymentMechanism: 'CAPITATION',
        overallTariff: '0.00',
        kephLevelTariff: '0.00',
        needsPreauth: false,
        needsManualPreauthApproval: false,
        needsDoctorAuthorization: false,
        needApprovalBeforeClaimSubmission: false,
        needsMemberAuthorization: true,
        numberOfDoctorsRequired: 0,
        applicableSchemes: ['PHC', 'SHIF'],
        requiredPreauthDocumentTypes: [],
        applicableDocumentTypes: ['CLAIM_FORM'],
        specialistFlags: {
          requiresSurgicalPreauth: false,
          requiresRenalPreauth: false,
          requiresOncologyPreauth: false,
          requiresRadiologyPreauth: false,
          requiresOpticalPreauth: false,
        },
      },
      {
        code: 'SHA-09-021',
        name: 'CT / MRI Specialized Diagnostic Imaging',
        accessPoint: 'OP',
        fund: 'SHIF',
        paymentMechanism: 'FEE FOR SERVICE',
        overallTariff: '8000.00',
        kephLevelTariff: '8000.00',
        needsPreauth: true,
        needsManualPreauthApproval: false,
        needsDoctorAuthorization: true,
        needApprovalBeforeClaimSubmission: true,
        needsMemberAuthorization: true,
        numberOfDoctorsRequired: 1,
        applicableSchemes: ['SHIF', 'POMSF'],
        requiredPreauthDocumentTypes: ['IMAGING_RESULT', 'MEDICAL_REPORT', 'PREAUTH_FORM'],
        applicableDocumentTypes: ['CLAIM_FORM', 'IMAGING_RESULT'],
        specialistFlags: {
          requiresSurgicalPreauth: false,
          requiresRenalPreauth: false,
          requiresOncologyPreauth: false,
          requiresRadiologyPreauth: true,
          requiresOpticalPreauth: false,
        },
      },
      {
        code: 'SHA-19-152',
        name: 'Elective Major Surgical Intervention',
        accessPoint: 'IP',
        fund: 'SHIF',
        paymentMechanism: 'FEE FOR SERVICE',
        overallTariff: '44800.00',
        kephLevelTariff: '44800.00',
        needsPreauth: true,
        needsManualPreauthApproval: true,
        needsDoctorAuthorization: true,
        needApprovalBeforeClaimSubmission: true,
        needsMemberAuthorization: true,
        numberOfDoctorsRequired: 1,
        applicableSchemes: ['SHIF', 'POMSF'],
        requiredPreauthDocumentTypes: [
          'IMAGING_RESULT',
          'LAB_RESULTS',
          'MEDICAL_REPORT',
          'PREAUTH_FORM',
        ],
        applicableDocumentTypes: ['CLAIM_FORM', 'DISCHARGE_SUMMARY', 'THEATRE_NOTES'],
        specialistFlags: {
          requiresSurgicalPreauth: true,
          requiresRenalPreauth: false,
          requiresOncologyPreauth: false,
          requiresRadiologyPreauth: false,
          requiresOpticalPreauth: false,
        },
      },
    ];

    const filtered = req.interventionCode
      ? allSimInterventions.filter(
          (i) => i.code.toUpperCase() === req.interventionCode!.trim().toUpperCase(),
        )
      : allSimInterventions;

    return {
      reachable: true,
      source: 'SANDBOX_SIMULATION',
      mode: 'mock',
      isSimulated: true,
      benefits: [
        { code: 'SHA-12', name: 'Outpatient Services', fund: 'PHC', status: 'ACTIVE' },
        {
          code: 'SHA-09',
          name: 'Medical Imaging & Other Investigations',
          fund: 'SHIF',
          status: 'ACTIVE',
        },
        { code: 'SHA-19', name: 'Surgical Services', fund: 'SHIF', status: 'ACTIVE' },
      ],
      subBenefits: [
        {
          code: 'SHA-19-SC-13',
          name: 'General & Orthopaedic Surgery',
          parentBenefitCode: 'SHA-19',
          fund: 'SHIF',
        },
      ],
      interventions: filtered,
      errorMessage: null,
      correlationId,
    };
  }

  if (!cfg.enabled || !cfg.middlewareBaseUrl) {
    return {
      reachable: false,
      source: 'UNAVAILABLE',
      mode: cfg.mode,
      isSimulated: false,
      benefits: [],
      subBenefits: [],
      interventions: [],
      errorMessage: cfg.disabledReason ?? 'SHA HIE credentials are not configured.',
      correlationId,
    };
  }

  try {
    const token = await context.obtainAccessToken(cfg, correlationId);
    const headers = context.buildServiceAccountHeaders(cfg, token, correlationId);

    const benUrl = new URL(`${cfg.middlewareBaseUrl}${cfg.benefitsPath}`);
    benUrl.searchParams.set('patient_id', crId);

    const intUrl = new URL(`${cfg.middlewareBaseUrl}${cfg.interventionsPath}`);
    intUrl.searchParams.set('patient_id', crId);
    if (req.subBenefitCode) intUrl.searchParams.set('sub_benefit_code', req.subBenefitCode);
    if (req.interventionCode) intUrl.searchParams.set('code', req.interventionCode);
    if (req.accessPoint) intUrl.searchParams.set('access_point', req.accessPoint);
    if (req.search) intUrl.searchParams.set('search', req.search);

    const [benRes, intRes] = await Promise.all([
      context.fetchGetWithBoundedRetry(
        benUrl.toString(),
        headers,
        cfg.timeoutMs,
        cfg.maxGetRetries,
      ),
      context.fetchGetWithBoundedRetry(
        intUrl.toString(),
        headers,
        cfg.timeoutMs,
        cfg.maxGetRetries,
      ),
    ]);

    let subBenefits: HieBenefitsLookupResult['subBenefits'] = [];
    if (req.parentBenefitCode) {
      const subUrl = new URL(`${cfg.middlewareBaseUrl}${cfg.subBenefitsPath}`);
      subUrl.searchParams.set('patient_id', crId);
      subUrl.searchParams.set('parent_benefit_code', req.parentBenefitCode);
      const subRes = await context.fetchGetWithBoundedRetry(
        subUrl.toString(),
        headers,
        cfg.timeoutMs,
        cfg.maxGetRetries,
      );
      if (subRes.ok) {
        const rawSub = await subRes.json().catch(() => null);
        const subJson = asObj(rawSub);
        const rows = Array.isArray(rawSub)
          ? rawSub
          : Array.isArray(subJson?.results)
            ? subJson.results
            : Array.isArray(subJson?.data)
              ? subJson.data
              : [];
        subBenefits = rows
          .map((r) => asObj(r))
          .filter((r): r is Record<string, unknown> => r !== null)
          .map((r) => ({
            code: readStr(r, 'code', 'sub_benefit_code') ?? 'UNKNOWN',
            name: readStr(r, 'name', 'sub_benefit_name') ?? 'Sub-Benefit',
            parentBenefitCode: req.parentBenefitCode,
            fund: readStr(r, 'fund'),
          }));
      }
    }

    if (!benRes.ok && !intRes.ok) {
      return {
        reachable: false,
        source: 'UNAVAILABLE',
        mode: cfg.mode,
        isSimulated: false,
        benefits: [],
        subBenefits: [],
        interventions: [],
        errorMessage: `SHA HIE benefits/interventions returned HTTP ${intRes.status}.`,
        correlationId,
      };
    }

    const rawBen = await benRes.json().catch(() => null);
    const rawInt = await intRes.json().catch(() => null);
    const benJson = asObj(rawBen);
    const intJson = asObj(rawInt);
    const benRows = Array.isArray(rawBen)
      ? rawBen
      : Array.isArray(benJson?.results)
        ? benJson.results
        : Array.isArray(benJson?.data)
          ? benJson.data
          : [];
    const intRows = Array.isArray(rawInt)
      ? rawInt
      : Array.isArray(intJson?.results)
        ? intJson.results
        : Array.isArray(intJson?.data)
          ? intJson.data
          : [];

    const benefits = benRows
      .map((r) => asObj(r))
      .filter((r): r is Record<string, unknown> => r !== null)
      .map((r) => ({
        code: readStr(r, 'code', 'benefit_code') ?? 'UNKNOWN',
        name: readStr(r, 'name', 'benefit_name') ?? 'Benefit',
        fund: readStr(r, 'fund'),
        status: readStr(r, 'status'),
      }));

    const interventions: HieInterventionCoverageItem[] = intRows
      .map((r) => asObj(r))
      .filter((r): r is Record<string, unknown> => r !== null)
      .map((r) => ({
        code: readStr(r, 'code', 'intervention_code') ?? 'UNKNOWN',
        name: readStr(r, 'name', 'intervention_name') ?? 'Intervention',
        accessPoint: readStr(r, 'accessPoint', 'access_point') ?? 'OP',
        fund: readStr(r, 'fund', 'intervention_fund') ?? 'SHIF',
        paymentMechanism:
          readStr(r, 'paymentMechanism', 'intervention_payment_mechanism') ?? 'FEE FOR SERVICE',
        overallTariff: readNumMoney(r.overallTariff ?? r.intervention_overall_tariff),
        kephLevelTariff: readNumMoney(r.kephLevelTarriff ?? r.keph_level_tarrif),
        needsPreauth: Boolean(r.needsPreauth ?? r.needs_preauth),
        needsManualPreauthApproval: Boolean(r.needsManualPreauthApproval),
        needsDoctorAuthorization: Boolean(r.needsDoctorAuthorization),
        needApprovalBeforeClaimSubmission: Boolean(r.needApprovalBeforeClaimSubmission),
        needsMemberAuthorization: Boolean(r.needsMemberAuthorization),
        numberOfDoctorsRequired:
          typeof r.numberOfDoctorsRequired === 'number' ? r.numberOfDoctorsRequired : 0,
        applicableSchemes: Array.isArray(r.applicableSchemes)
          ? r.applicableSchemes.map(String)
          : [],
        requiredPreauthDocumentTypes: Array.isArray(r.requiredPreauthDocumentTypes)
          ? r.requiredPreauthDocumentTypes.map(String)
          : [],
        applicableDocumentTypes: Array.isArray(r.applicableDocumentTypes)
          ? r.applicableDocumentTypes.map(String)
          : [],
        specialistFlags: {
          requiresSurgicalPreauth: Boolean(
            r.requiresSurgicalPreauth ?? r.requires_surgical_preauth,
          ),
          requiresRenalPreauth: Boolean(r.requiresRenalPreauth ?? r.requires_renal_preauth),
          requiresOncologyPreauth: Boolean(
            r.requiresOncologyPreauth ?? r.requires_oncology_preauth,
          ),
          requiresRadiologyPreauth: Boolean(
            r.requiresRadiologyPreauth ?? r.requires_radiology_preauth,
          ),
          requiresOpticalPreauth: Boolean(r.requiresOpticalPreauth ?? r.requires_optical_preauth),
        },
      }));

    return {
      reachable: true,
      source: 'AUTHORITATIVE_PAYER',
      mode: cfg.mode,
      isSimulated: false,
      benefits,
      subBenefits,
      interventions,
      errorMessage: null,
      correlationId,
    };
  } catch (error) {
    return {
      reachable: false,
      source: 'UNAVAILABLE',
      mode: cfg.mode,
      isSimulated: false,
      benefits: [],
      subBenefits: [],
      interventions: [],
      errorMessage:
        error instanceof Error
          ? `SHA HIE benefits lookup failed: ${error.message}`
          : 'SHA HIE benefits lookup failed.',
      correlationId,
    };
  }
}
