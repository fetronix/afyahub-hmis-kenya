/**
 * JaliCare HMIS
 * Kenya eClaims FHIR R4 v0.1.0 (https://fhir.dha.go.ke/ig/eclaims/) — Builder, Validator & Parser
 *
 * Implements the published Kenya eClaims FHIR Implementation Guide v0.1.0 (FHIR R4 4.0.1,
 * Draft CI-Build), DHA HIE Intervention Combination Rules, MOH-Kenya OCL / ICD-11
 * terminology constraints (strictly prohibiting SNOMED CT and non-KES currencies),
 * and AfyaLink / HIE response contracts without inventing undocumented resources or fake IDs.
 */

export const KE_ECLAIMS_CANONICAL_BASE = 'https://nshr-uat.sha.go.ke/fhir';
export const MOH_KENYA_OCL_BASE = 'https://ilm-hie.dha.go.ke/ocl/orgs/MOH-KENYA';
export const ICD11_SYSTEM_URI = 'http://id.who.int/icd/release/11/mms';
export const ICD10_TRANSITIONAL_SYSTEM_URI = 'http://hl7.org/fhir/sid/icd-10';
export const SNOMED_CT_URI = 'http://snomed.info/sct';

export const KE_ECLAIMS_PROFILES = {
  claimSubmissionBundle: `${KE_ECLAIMS_CANONICAL_BASE}/StructureDefinition/ke-eclaims-claimsubmission`,
  organization: `${KE_ECLAIMS_CANONICAL_BASE}/StructureDefinition/ke-eclaims-organization`,
  patient: `${KE_ECLAIMS_CANONICAL_BASE}/StructureDefinition/ke-eclaims-patient`,
  coverage: `${KE_ECLAIMS_CANONICAL_BASE}/StructureDefinition/ke-eclaims-coverage`,
  encounter: `${KE_ECLAIMS_CANONICAL_BASE}/StructureDefinition/ke-eclaims-encounter`,
  episodeOfCare: `${KE_ECLAIMS_CANONICAL_BASE}/StructureDefinition/ke-eclaims-episodeofcare`,
  condition: `${KE_ECLAIMS_CANONICAL_BASE}/StructureDefinition/ke-eclaims-condition`,
  practitioner: `${KE_ECLAIMS_CANONICAL_BASE}/StructureDefinition/ke-eclaims-practitioner`,
  diagnosticReport: `${KE_ECLAIMS_CANONICAL_BASE}/StructureDefinition/ke-eclaims-diagnosticreport`,
  medicationRequest: `${KE_ECLAIMS_CANONICAL_BASE}/StructureDefinition/ke-eclaims-medicationrequest`,
  medicationDispense: `${KE_ECLAIMS_CANONICAL_BASE}/StructureDefinition/ke-eclaims-medicationdispense`,
  claim: `${KE_ECLAIMS_CANONICAL_BASE}/StructureDefinition/ke-eclaims-claim`,
  claimResponse: `${KE_ECLAIMS_CANONICAL_BASE}/StructureDefinition/ke-eclaims-claimresponse`,
  imagingPreauth: `${KE_ECLAIMS_CANONICAL_BASE}/StructureDefinition/ke-eclaims-imagingpreauth`,
  oncologyPreauth: `${KE_ECLAIMS_CANONICAL_BASE}/StructureDefinition/ke-eclaims-oncologypreauth`,
  opticalPreauth: `${KE_ECLAIMS_CANONICAL_BASE}/StructureDefinition/ke-eclaims-opticalpreauth`,
  renalPreauth: `${KE_ECLAIMS_CANONICAL_BASE}/StructureDefinition/ke-eclaims-renalpreauth`,
  surgicalPreauth: `${KE_ECLAIMS_CANONICAL_BASE}/StructureDefinition/ke-eclaims-surgicalpreauth`,
  paymentNotice: `${KE_ECLAIMS_CANONICAL_BASE}/StructureDefinition/ke-eclaims-paymentnotice`,
} as const;

export const ALLOWED_PRACTITIONER_REGULATORS = ['KMPDC', 'COC', 'NCK', 'PPB'] as const;
export type PractitionerRegulator = (typeof ALLOWED_PRACTITIONER_REGULATORS)[number];

/**
 * Per DHA HIE Eligibility & Coverage spec:
 * Never hard-code exact string equality against `"POMSF"`. Match by prefix (`POMSF*`)
 * plus designated public-officer schemes (`TSC`, `USALAMA`).
 */
export function isPomsfSchemeCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const upper = code.trim().toUpperCase();
  return upper.startsWith('POMSF') || upper === 'TSC' || upper === 'USALAMA';
}

/**
 * Validates whether a service code follows official SHA Benefit / Intervention
 * Catalogue or PMF tariff formatting (`SHA-01-001`, `SHA-19-SC-13`, `SHA-IMG-010`, `PMF-001`, etc.),
 * rejecting SNOMED CT concept IDs or unprefixed codes.
 */
export function isValidShaCatalogueCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const trimmed = code.trim().toUpperCase();
  if (trimmed.includes('SNOMED') || /^\d{6,18}$/.test(trimmed)) return false;
  return /^SHA-[A-Z0-9]{2,4}(?:-[A-Z0-9]+)+$/.test(trimmed) || /^PMF-[A-Z0-9-]+$/.test(trimmed);
}

const STANDALONE_SHA_PACKAGES = new Set([
  'SHA-01', // Ambulance and Emergency Services
  'SHA-05', // Optical Health Services
  'SHA-06', // Haematology and Oncology Services
  'SHA-09', // Medical Imaging & Other Investigations
  'SHA-10', // Mental Wellness Services
  'SHA-12', // Outpatient Services
  'SHA-18', // Essential Diagnostic Laboratory Listing for NCDs
]);

const ALLOWED_SECONDARY_BY_PRIMARY: Record<string, ReadonlySet<string>> = {
  'SHA-03': new Set(['SHA-07', 'SHA-06', 'SHA-16', 'SHA-09', 'SHA-13', 'SHA-08', 'SHA-19']),
  'SHA-07': new Set(['SHA-03', 'SHA-06', 'SHA-16', 'SHA-09', 'SHA-19']),
  'SHA-08': new Set(['SHA-03', 'SHA-09', 'SHA-07']),
  'SHA-13': new Set(['SHA-03', 'SHA-06', 'SHA-07', 'SHA-09', 'SHA-16', 'SHA-19']),
  'SHA-16': new Set(['SHA-03', 'SHA-07']),
  'SHA-19': new Set(['SHA-07', 'SHA-09', 'SHA-03', 'SHA-13']),
};

const STANDALONE_RENAL_CODES = new Set(['SHA-16-001', 'SHA-16-002', 'SHA-16-004']);

function extractShaPackagePrefix(code: string): string | null {
  const m = code
    .trim()
    .toUpperCase()
    .match(/^(SHA-\d{2})\b/);
  return m ? m[1] : null;
}

export interface ShaCombinationCheckResult {
  valid: boolean;
  primaryPackage: string | null;
  distinctPackages: string[];
  violations: string[];
}

/**
 * Enforces official DHA HIE SHA Intervention Combination Rules
 * (`https://hie-docs.dha.go.ke/docs/claims/guides/sha-combination-rules`).
 */
export function evaluateShaInterventionCombinations(
  interventionCodes: string[],
): ShaCombinationCheckResult {
  const normalizedCodes = interventionCodes
    .map((c) => c.trim().toUpperCase())
    .filter((c) => c.length > 0);
  const packages: string[] = [];
  for (const code of normalizedCodes) {
    const pkg = extractShaPackagePrefix(code);
    if (pkg && !packages.includes(pkg)) {
      packages.push(pkg);
    }
  }

  if (packages.length <= 1) {
    // Check standalone renal sub-codes if multiple distinct SHA-16 codes are combined
    const distinctCodes = Array.from(new Set(normalizedCodes));
    const violations: string[] = [];
    if (distinctCodes.length > 1) {
      for (const c of distinctCodes) {
        if (STANDALONE_RENAL_CODES.has(c)) {
          violations.push(
            `Renal intervention ${c} must be billed ALONE and cannot be combined with other interventions (${distinctCodes.join(', ')}).`,
          );
        }
      }
    }
    return {
      valid: violations.length === 0,
      primaryPackage: packages[0] ?? null,
      distinctPackages: packages,
      violations,
    };
  }

  const primary = packages[0];
  const violations: string[] = [];

  for (const c of normalizedCodes) {
    if (STANDALONE_RENAL_CODES.has(c)) {
      violations.push(
        `Renal intervention ${c} must be reported ALONE and cannot share a claim with ${packages.join(', ')}.`,
      );
    }
  }

  if (STANDALONE_SHA_PACKAGES.has(primary)) {
    violations.push(
      `Primary intervention package ${primary} must be billed ALONE per SHA Combination Rules; cannot combine with ${packages.slice(1).join(', ')}.`,
    );
  } else {
    const allowed = ALLOWED_SECONDARY_BY_PRIMARY[primary];
    if (allowed) {
      for (const secondary of packages.slice(1)) {
        if (!allowed.has(secondary)) {
          violations.push(
            `Intervention package ${secondary} is not an allowed combination with primary package ${primary} per SHA Combination Rules.`,
          );
        }
      }
    }
  }

  return {
    valid: violations.length === 0,
    primaryPackage: primary,
    distinctPackages: packages,
    violations,
  };
}

export interface ShaFhirPatientInput {
  internalId: number;
  shaNumber?: string | null;
  nationalId?: string | null;
  crNumber?: string | null;
  fullName: string;
  firstName?: string | null;
  lastName?: string | null;
  gender?: string | null;
  birthDate?: string | null;
}

export interface ShaFhirDiagnosisInput {
  code: string;
  display: string;
  system?: string;
  type?: 'principal' | 'admitting' | 'secondary' | string;
}

export interface ShaFhirClaimItemInput {
  sequence: number;
  payerServiceCode: string;
  payerServiceName: string;
  servicedStart: string;
  servicedEnd: string;
  quantity: number;
  unitPriceKes: string;
  netKes: string;
}

export interface ShaFhirPractitionerInput {
  registrationNumber: string;
  regulator: PractitionerRegulator | string;
  fullName?: string | null;
  qualificationCode?: string | null;
}

export interface ShaFhirMedicationInput {
  id: string | number;
  drugCode?: string | null;
  drugName: string;
  dosageInstruction?: string | null;
  quantityDispensed?: number | null;
  authoredOn?: string | null;
  dispensedOn?: string | null;
}

export interface ShaFhirDiagnosticReportInput {
  id: string | number;
  category: 'LAB' | 'IMAGING';
  code: string;
  display: string;
  conclusion?: string | null;
  effectiveDate?: string | null;
}

export interface BuildShaFhirBundleInput {
  bundleUuid: string;
  claimUuid: string;
  claimNumber: string;
  use: 'claim' | 'preauthorization';
  preauthCategory?: string | null;
  claimType: 'institutional' | 'pharmacy' | 'professional';
  subType: 'op' | 'ip';
  schemeCode: string;
  facilityRegistryCode: string;
  facilityName: string;
  patient: ShaFhirPatientInput;
  encounterId?: number | null;
  admissionDate?: string | null;
  dischargeDate?: string | null;
  billableStart: string;
  billableEnd: string;
  createdIso: string;
  isPhcClaim?: boolean;
  totalClaimedKes: string;
  preAuthReferences?: string[];
  previousClaimReference?: string | null;
  attendingPractitioner?: ShaFhirPractitionerInput | null;
  medications?: ShaFhirMedicationInput[];
  diagnosticReports?: ShaFhirDiagnosticReportInput[];
  diagnoses: ShaFhirDiagnosisInput[];
  items: ShaFhirClaimItemInput[];
}

function normalizeFhirGender(gender?: string | null): 'male' | 'female' | 'other' | 'unknown' {
  const g = (gender ?? '').trim().toLowerCase();
  if (g === 'male' || g === 'm') return 'male';
  if (g === 'female' || g === 'f') return 'female';
  if (g === 'other') return 'other';
  return 'unknown';
}

function splitHumanName(patient: ShaFhirPatientInput): {
  family: string;
  given: string[];
  text: string;
} {
  const full = patient.fullName.trim();
  if (patient.lastName?.trim()) {
    const given = (patient.firstName ?? '').trim().split(/\s+/).filter(Boolean);
    return {
      family: patient.lastName.trim(),
      given: given.length > 0 ? given : [patient.lastName.trim()],
      text: full || [patient.firstName, patient.lastName].filter(Boolean).join(' '),
    };
  }
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { family: 'Unknown', given: ['Unknown'], text: 'Unknown' };
  }
  if (parts.length === 1) {
    return { family: parts[0], given: [parts[0]], text: parts[0] };
  }
  return {
    family: parts[parts.length - 1],
    given: parts.slice(0, -1),
    text: full,
  };
}

function resolveClaimProfile(use: 'claim' | 'preauthorization', category?: string | null): string {
  if (use !== 'preauthorization') return KE_ECLAIMS_PROFILES.claim;
  const cat = (category ?? '').trim().toUpperCase();
  if (cat === 'IMAGING' || cat === 'RADIOLOGY') return KE_ECLAIMS_PROFILES.imagingPreauth;
  if (cat === 'ONCOLOGY') return KE_ECLAIMS_PROFILES.oncologyPreauth;
  if (cat === 'OPTICAL') return KE_ECLAIMS_PROFILES.opticalPreauth;
  if (cat === 'RENAL' || cat === 'DIALYSIS') return KE_ECLAIMS_PROFILES.renalPreauth;
  if (cat === 'SURGICAL' || cat === 'SURGERY' || cat === 'THEATRE') {
    return KE_ECLAIMS_PROFILES.surgicalPreauth;
  }
  return KE_ECLAIMS_PROFILES.claim;
}

function toFhirMoneyNumber(amount: string): number {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(2));
}

export function buildShaFhirBundle(input: BuildShaFhirBundleInput): Record<string, unknown> {
  const orgFullUrl = `Organization/${input.facilityRegistryCode}`;
  const insurerFullUrl = 'Organization/sha-insurer';
  const patientFullUrl = `Patient/patient-${input.patient.internalId}`;
  const coverageFullUrl = `Coverage/coverage-${input.patient.internalId}-${input.schemeCode.toLowerCase()}`;
  const claimFullUrl = `Claim/${input.claimUuid}`;

  const patientIdentifiers: Array<Record<string, unknown>> = [];
  if (input.patient.crNumber) {
    patientIdentifiers.push({
      use: 'official',
      type: {
        coding: [
          {
            system: `${KE_ECLAIMS_CANONICAL_BASE}/CodeSystem/identifier-type`,
            code: 'CR-NUMBER',
            display: 'Client Registry Identifier',
          },
        ],
      },
      system: `${KE_ECLAIMS_CANONICAL_BASE}/identifier/cr-number`,
      value: input.patient.crNumber,
    });
  }
  if (input.patient.shaNumber) {
    patientIdentifiers.push({
      use: 'official',
      type: {
        coding: [
          {
            system: `${KE_ECLAIMS_CANONICAL_BASE}/CodeSystem/identifier-type`,
            code: 'SHA-NUMBER',
            display: 'SHA Member Number',
          },
        ],
      },
      system: `${KE_ECLAIMS_CANONICAL_BASE}/identifier/sha-number`,
      value: input.patient.shaNumber,
    });
  }
  if (input.patient.nationalId) {
    patientIdentifiers.push({
      use: 'secondary',
      type: {
        coding: [
          {
            system: `${KE_ECLAIMS_CANONICAL_BASE}/CodeSystem/identifier-type`,
            code: 'NATIONAL-ID',
            display: 'Kenya National ID',
          },
        ],
      },
      system: `${KE_ECLAIMS_CANONICAL_BASE}/identifier/national-id`,
      value: input.patient.nationalId,
    });
  }

  const humanName = splitHumanName(input.patient);

  const entries: Array<Record<string, unknown>> = [
    {
      fullUrl: orgFullUrl,
      resource: {
        resourceType: 'Organization',
        id: input.facilityRegistryCode,
        meta: { profile: [KE_ECLAIMS_PROFILES.organization] },
        active: true,
        identifier: [
          {
            use: 'official',
            system: `${KE_ECLAIMS_CANONICAL_BASE}/identifier/fr-code`,
            value: input.facilityRegistryCode,
          },
        ],
        name: input.facilityName,
      },
    },
    {
      fullUrl: insurerFullUrl,
      resource: {
        resourceType: 'Organization',
        id: 'sha-insurer',
        meta: { profile: [KE_ECLAIMS_PROFILES.organization] },
        active: true,
        identifier: [
          {
            use: 'official',
            system: `${KE_ECLAIMS_CANONICAL_BASE}/identifier/payer-code`,
            value: 'SHA',
          },
        ],
        name: 'Social Health Authority (SHA)',
      },
    },
    {
      fullUrl: patientFullUrl,
      resource: {
        resourceType: 'Patient',
        id: `patient-${input.patient.internalId}`,
        meta: { profile: [KE_ECLAIMS_PROFILES.patient] },
        identifier: patientIdentifiers,
        name: [
          {
            use: 'official',
            family: humanName.family,
            given: humanName.given,
            text: humanName.text,
          },
        ],
        gender: normalizeFhirGender(input.patient.gender),
        ...(input.patient.birthDate ? { birthDate: input.patient.birthDate } : {}),
      },
    },
    {
      fullUrl: coverageFullUrl,
      resource: {
        resourceType: 'Coverage',
        id: `coverage-${input.patient.internalId}-${input.schemeCode.toLowerCase()}`,
        meta: { profile: [KE_ECLAIMS_PROFILES.coverage] },
        status: 'active',
        type: {
          coding: [
            {
              system: `${KE_ECLAIMS_CANONICAL_BASE}/CodeSystem/sha-fund`,
              code: input.schemeCode,
              display: input.schemeCode,
            },
          ],
        },
        subscriber: { reference: patientFullUrl },
        beneficiary: { reference: patientFullUrl },
        payor: [{ reference: insurerFullUrl, display: 'Social Health Authority (SHA)' }],
        class: [
          {
            type: {
              coding: [
                {
                  system: 'http://terminology.hl7.org/CodeSystem/coverage-class',
                  code: 'plan',
                },
              ],
            },
            value: input.schemeCode,
            name: input.schemeCode,
          },
        ],
      },
    },
  ];

  let practitionerFullUrl: string | undefined;
  if (input.attendingPractitioner?.registrationNumber?.trim()) {
    const regNo = input.attendingPractitioner.registrationNumber.trim();
    const regulator = (input.attendingPractitioner.regulator || 'KMPDC').trim().toUpperCase();
    practitionerFullUrl = `Practitioner/practitioner-${regNo.replace(/[^a-zA-Z0-9-]/g, '-')}`;
    entries.push({
      fullUrl: practitionerFullUrl,
      resource: {
        resourceType: 'Practitioner',
        id: `practitioner-${regNo.replace(/[^a-zA-Z0-9-]/g, '-')}`,
        meta: { profile: [KE_ECLAIMS_PROFILES.practitioner] },
        active: true,
        identifier: [
          {
            use: 'official',
            system: `${KE_ECLAIMS_CANONICAL_BASE}/identifier/hwr-${regulator.toLowerCase()}`,
            value: regNo,
          },
        ],
        ...(input.attendingPractitioner.fullName
          ? { name: [{ use: 'official', text: input.attendingPractitioner.fullName }] }
          : {}),
      },
    });
  }

  let encounterRef: string | undefined;
  if (input.encounterId) {
    encounterRef = `Encounter/encounter-${input.encounterId}`;
    entries.push({
      fullUrl: encounterRef,
      resource: {
        resourceType: 'Encounter',
        id: `encounter-${input.encounterId}`,
        meta: { profile: [KE_ECLAIMS_PROFILES.encounter] },
        status: 'finished',
        class: {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
          code: input.subType === 'ip' ? 'IMP' : 'AMB',
          display: input.subType === 'ip' ? 'inpatient encounter' : 'ambulatory',
        },
        subject: { reference: patientFullUrl },
        serviceProvider: { reference: orgFullUrl },
        period: {
          start: input.billableStart,
          end: input.billableEnd,
        },
      },
    });
  }

  if (input.subType === 'ip') {
    entries.push({
      fullUrl: `EpisodeOfCare/episode-${input.claimUuid}`,
      resource: {
        resourceType: 'EpisodeOfCare',
        id: `episode-${input.claimUuid}`,
        meta: { profile: [KE_ECLAIMS_PROFILES.episodeOfCare] },
        status: input.dischargeDate ? 'finished' : 'active',
        patient: { reference: patientFullUrl },
        managingOrganization: { reference: orgFullUrl },
        period: {
          start: input.admissionDate ?? input.billableStart,
          ...(input.dischargeDate ? { end: input.dischargeDate } : {}),
        },
      },
    });
  }

  // Inline Condition resources for coded diagnoses
  input.diagnoses.forEach((diag, idx) => {
    const condId = `condition-${input.claimUuid}-${idx + 1}`;
    entries.push({
      fullUrl: `Condition/${condId}`,
      resource: {
        resourceType: 'Condition',
        id: condId,
        meta: { profile: [KE_ECLAIMS_PROFILES.condition] },
        clinicalStatus: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
              code: 'active',
            },
          ],
        },
        code: {
          coding: [
            {
              system: diag.system === 'ICD-10' ? ICD10_TRANSITIONAL_SYSTEM_URI : ICD11_SYSTEM_URI,
              code: diag.code,
              display: diag.display,
            },
          ],
        },
        subject: { reference: patientFullUrl },
        ...(encounterRef ? { encounter: { reference: encounterRef } } : {}),
      },
    });
  });

  // Inline MedicationRequest & MedicationDispense resources (Kenya eClaims IG T-04)
  if (Array.isArray(input.medications)) {
    for (const med of input.medications) {
      const medReqId = `medreq-${med.id}`;
      const medCodingCode = med.drugCode?.trim() || `OCL-MED-${med.id}`;
      entries.push({
        fullUrl: `MedicationRequest/${medReqId}`,
        resource: {
          resourceType: 'MedicationRequest',
          id: medReqId,
          meta: { profile: [KE_ECLAIMS_PROFILES.medicationRequest] },
          status: 'completed',
          intent: 'order',
          medicationCodeableConcept: {
            coding: [
              {
                system: `${MOH_KENYA_OCL_BASE}/sources/MOH-KENYA/concepts`,
                code: medCodingCode,
                display: med.drugName,
              },
            ],
            text: med.drugName,
          },
          subject: { reference: patientFullUrl },
          ...(encounterRef ? { encounter: { reference: encounterRef } } : {}),
          ...(med.authoredOn ? { authoredOn: med.authoredOn } : {}),
          ...(med.dosageInstruction
            ? { dosageInstruction: [{ text: med.dosageInstruction }] }
            : {}),
        },
      });

      if (med.quantityDispensed && med.quantityDispensed > 0) {
        const medDispId = `meddisp-${med.id}`;
        entries.push({
          fullUrl: `MedicationDispense/${medDispId}`,
          resource: {
            resourceType: 'MedicationDispense',
            id: medDispId,
            meta: { profile: [KE_ECLAIMS_PROFILES.medicationDispense] },
            status: 'completed',
            medicationCodeableConcept: {
              coding: [
                {
                  system: `${MOH_KENYA_OCL_BASE}/sources/MOH-KENYA/concepts`,
                  code: medCodingCode,
                  display: med.drugName,
                },
              ],
              text: med.drugName,
            },
            subject: { reference: patientFullUrl },
            authorizingPrescription: [{ reference: `MedicationRequest/${medReqId}` }],
            quantity: { value: med.quantityDispensed },
            ...(med.dispensedOn ? { whenHandedOver: med.dispensedOn } : {}),
          },
        });
      }
    }
  }

  // Inline DiagnosticReport resources for lab/imaging clinical evidence (Kenya eClaims IG T-05)
  const supportingInfoEntries: Array<Record<string, unknown>> = [];
  if (Array.isArray(input.diagnosticReports)) {
    input.diagnosticReports.forEach((rep, idx) => {
      const repId = `diagreport-${rep.category.toLowerCase()}-${rep.id}`;
      entries.push({
        fullUrl: `DiagnosticReport/${repId}`,
        resource: {
          resourceType: 'DiagnosticReport',
          id: repId,
          meta: { profile: [KE_ECLAIMS_PROFILES.diagnosticReport] },
          status: 'final',
          code: {
            coding: [
              {
                system: `${MOH_KENYA_OCL_BASE}/sources/MOH-KENYA/concepts`,
                code: rep.code,
                display: rep.display,
              },
            ],
            text: rep.display,
          },
          subject: { reference: patientFullUrl },
          ...(encounterRef ? { encounter: { reference: encounterRef } } : {}),
          ...(rep.effectiveDate ? { effectiveDateTime: rep.effectiveDate } : {}),
          ...(rep.conclusion ? { conclusion: rep.conclusion } : {}),
        },
      });
      supportingInfoEntries.push({
        sequence: idx + 1,
        category: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/claiminformationcategory',
              code: 'info',
            },
          ],
        },
        valueReference: { reference: `DiagnosticReport/${repId}` },
      });
    });
  }

  // Per AfyaLink specification: Primary Healthcare (PHC) claims carry total 0.00 KES.
  const effectiveTotalNumber = input.isPhcClaim ? 0 : toFhirMoneyNumber(input.totalClaimedKes);

  const claimResource: Record<string, unknown> = {
    resourceType: 'Claim',
    id: input.claimUuid,
    meta: { profile: [resolveClaimProfile(input.use, input.preauthCategory)] },
    identifier: [
      {
        system: 'urn:jalicare:hmis:sha-eclaim-number',
        value: input.claimNumber,
      },
    ],
    status: 'active',
    type: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/claim-type',
          code: input.claimType,
        },
      ],
    },
    subType: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/ex-claimsubtype',
          code: input.subType,
        },
      ],
    },
    use: input.use,
    patient: { reference: patientFullUrl },
    billablePeriod: {
      start: input.billableStart,
      end: input.billableEnd,
    },
    created: input.createdIso,
    insurer: { reference: insurerFullUrl },
    provider: { reference: orgFullUrl },
    priority: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/processpriority',
          code: 'normal',
        },
      ],
    },
    ...(practitionerFullUrl
      ? {
          careTeam: [
            {
              sequence: 1,
              provider: { reference: practitionerFullUrl },
              responsible: true,
            },
          ],
        }
      : {}),
    ...(supportingInfoEntries.length > 0 ? { supportingInfo: supportingInfoEntries } : {}),
    insurance: [
      {
        sequence: 1,
        focal: true,
        coverage: { reference: coverageFullUrl },
        ...(input.preAuthReferences && input.preAuthReferences.length > 0
          ? { preAuthRef: input.preAuthReferences }
          : {}),
      },
    ],
    ...(input.previousClaimReference
      ? {
          related: [
            {
              claim: { identifier: { value: input.previousClaimReference } },
              relationship: {
                coding: [
                  {
                    system: 'http://terminology.hl7.org/CodeSystem/ex-relatedclaimrelationship',
                    code: 'prior',
                  },
                ],
              },
            },
          ],
        }
      : {}),
    diagnosis: input.diagnoses.map((diag, idx) => ({
      sequence: idx + 1,
      diagnosisCodeableConcept: {
        coding: [
          {
            system: diag.system === 'ICD-10' ? ICD10_TRANSITIONAL_SYSTEM_URI : ICD11_SYSTEM_URI,
            code: diag.code,
            display: diag.display,
          },
        ],
      },
      type: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/ex-diagnosistype',
              code: idx === 0 ? 'principal' : (diag.type ?? 'secondary'),
            },
          ],
        },
      ],
    })),
    item: input.items.map((item) => ({
      sequence: item.sequence,
      productOrService: {
        coding: [
          {
            system: `${KE_ECLAIMS_CANONICAL_BASE}/CodeSystem/sha-interventions`,
            code: item.payerServiceCode,
            display: item.payerServiceName,
          },
        ],
      },
      servicedPeriod: {
        start: item.servicedStart,
        end: item.servicedEnd,
      },
      ...(encounterRef ? { encounter: [{ reference: encounterRef }] } : {}),
      quantity: { value: item.quantity },
      unitPrice: {
        value: input.isPhcClaim ? 0 : toFhirMoneyNumber(item.unitPriceKes),
        currency: 'KES',
      },
      net: {
        value: input.isPhcClaim ? 0 : toFhirMoneyNumber(item.netKes),
        currency: 'KES',
      },
    })),
    total: {
      value: effectiveTotalNumber,
      currency: 'KES',
    },
  };

  entries.push({
    fullUrl: claimFullUrl,
    resource: claimResource,
  });

  return {
    resourceType: 'Bundle',
    id: input.bundleUuid,
    meta: {
      profile: [KE_ECLAIMS_PROFILES.claimSubmissionBundle],
    },
    type: 'collection',
    timestamp: input.createdIso,
    entry: entries,
  };
}

export interface FhirBundleValidationIssue {
  code: string;
  severity: 'ERROR' | 'WARNING';
  path: string;
  message: string;
}

export interface FhirBundleValidationResult {
  valid: boolean;
  issues: FhirBundleValidationIssue[];
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return null;
}

function walkBundleForTerminologyAndCurrency(
  node: unknown,
  path: string,
  issues: FhirBundleValidationIssue[],
): void {
  if (Array.isArray(node)) {
    node.forEach((child, idx) =>
      walkBundleForTerminologyAndCurrency(child, `${path}[${idx}]`, issues),
    );
    return;
  }
  const obj = asObject(node);
  if (!obj) return;

  if (typeof obj.system === 'string' && obj.system.toLowerCase().includes('snomed.info')) {
    issues.push({
      code: 'FHIR_PROHIBITED_SNOMED_CT',
      severity: 'ERROR',
      path: `${path}.system`,
      message: `SNOMED CT (${obj.system}) is strictly prohibited by the Kenya eClaims FHIR R4 IG; use MOH-Kenya OCL, ICD-11, or SHA catalogue codes.`,
    });
  }

  if (typeof obj.currency === 'string' && obj.currency !== 'KES') {
    issues.push({
      code: 'FHIR_NON_KES_CURRENCY',
      severity: 'ERROR',
      path: `${path}.currency`,
      message: `Invalid currency "${obj.currency}"; Kenya eClaims FHIR IG requires ISO 4217 "KES" on all monetary amounts.`,
    });
  }

  for (const [k, v] of Object.entries(obj)) {
    walkBundleForTerminologyAndCurrency(v, `${path}.${k}`, issues);
  }
}

/**
 * Validates a FHIR R4 Bundle against Kenya eClaims IG v0.1.0 cardinalities,
 * terminology bindings (no SNOMED CT, ICD-11 primary diagnosis, SHA-* catalogue),
 * KES currency constraint, and SHA Intervention Combination Rules.
 */
export function validateShaFhirBundle(bundle: unknown): FhirBundleValidationResult {
  const issues: FhirBundleValidationIssue[] = [];
  const root = asObject(bundle);
  if (!root || root.resourceType !== 'Bundle') {
    return {
      valid: false,
      issues: [
        {
          code: 'FHIR_INVALID_BUNDLE_ROOT',
          severity: 'ERROR',
          path: 'Bundle',
          message: 'Root resource must be a FHIR R4 Bundle.',
        },
      ],
    };
  }

  walkBundleForTerminologyAndCurrency(root, 'Bundle', issues);

  const entries = Array.isArray(root.entry) ? root.entry : [];
  if (entries.length === 0) {
    issues.push({
      code: 'FHIR_EMPTY_BUNDLE',
      severity: 'ERROR',
      path: 'Bundle.entry',
      message:
        'FHIR Bundle must contain inline Patient, Coverage, Organization, and Claim entries.',
    });
    return { valid: false, issues };
  }

  const resources = entries
    .map((e) => asObject(asObject(e)?.resource))
    .filter((r): r is Record<string, unknown> => r !== null);

  const patient = resources.find((r) => r.resourceType === 'Patient');
  const coverage = resources.find((r) => r.resourceType === 'Coverage');
  const organizations = resources.filter((r) => r.resourceType === 'Organization');
  const claim = resources.find((r) => r.resourceType === 'Claim');

  if (!patient) {
    issues.push({
      code: 'FHIR_MISSING_PATIENT',
      severity: 'ERROR',
      path: 'Bundle.entry[Patient]',
      message: 'Bundle is missing required EClaimsPatient resource.',
    });
  } else {
    const idents = Array.isArray(patient.identifier) ? patient.identifier : [];
    if (idents.length === 0) {
      issues.push({
        code: 'FHIR_PATIENT_MISSING_IDENTIFIER',
        severity: 'ERROR',
        path: 'Patient.identifier',
        message:
          'EClaimsPatient requires at least one identifier (CR-NUMBER, SHA-NUMBER, or NATIONAL-ID).',
      });
    }
    const names = Array.isArray(patient.name) ? patient.name : [];
    const firstFamily = names[0] ? readString(asObject(names[0]) ?? {}, 'family') : null;
    if (!firstFamily) {
      issues.push({
        code: 'FHIR_PATIENT_MISSING_FAMILY_NAME',
        severity: 'ERROR',
        path: 'Patient.name[0].family',
        message: 'EClaimsPatient requires Patient.name.family (1..1).',
      });
    }
    if (!readString(patient, 'gender')) {
      issues.push({
        code: 'FHIR_PATIENT_MISSING_GENDER',
        severity: 'ERROR',
        path: 'Patient.gender',
        message: 'EClaimsPatient requires Patient.gender (1..1).',
      });
    }
    if (!readString(patient, 'birthDate')) {
      issues.push({
        code: 'FHIR_PATIENT_MISSING_BIRTHDATE',
        severity: 'WARNING',
        path: 'Patient.birthDate',
        message: 'EClaimsPatient recommends Patient.birthDate (YYYY-MM-DD) for registry matching.',
      });
    }
  }

  if (!coverage) {
    issues.push({
      code: 'FHIR_MISSING_COVERAGE',
      severity: 'ERROR',
      path: 'Bundle.entry[Coverage]',
      message: 'Bundle is missing required EclaimsCoverage resource.',
    });
  } else {
    if (!asObject(coverage.subscriber)) {
      issues.push({
        code: 'FHIR_COVERAGE_MISSING_SUBSCRIBER',
        severity: 'ERROR',
        path: 'Coverage.subscriber',
        message: 'EclaimsCoverage requires Coverage.subscriber (1..1).',
      });
    }
    if (!asObject(coverage.beneficiary)) {
      issues.push({
        code: 'FHIR_COVERAGE_MISSING_BENEFICIARY',
        severity: 'ERROR',
        path: 'Coverage.beneficiary',
        message: 'EclaimsCoverage requires Coverage.beneficiary (1..1).',
      });
    }
    const classes = Array.isArray(coverage.class) ? coverage.class : [];
    if (classes.length === 0) {
      issues.push({
        code: 'FHIR_COVERAGE_MISSING_CLASS',
        severity: 'ERROR',
        path: 'Coverage.class',
        message: 'EclaimsCoverage requires Coverage.class (1..*) specifying scheme/plan.',
      });
    }
  }

  if (organizations.length === 0) {
    issues.push({
      code: 'FHIR_MISSING_ORGANIZATION',
      severity: 'ERROR',
      path: 'Bundle.entry[Organization]',
      message:
        'Bundle is missing provider EClaimsOrganization resource with Facility Registry fr-code.',
    });
  }

  if (!claim) {
    issues.push({
      code: 'FHIR_MISSING_CLAIM',
      severity: 'ERROR',
      path: 'Bundle.entry[Claim]',
      message: 'Bundle is missing required KenyaClaimBase / preauthorization Claim resource.',
    });
  } else {
    const diags = Array.isArray(claim.diagnosis) ? claim.diagnosis : [];
    if (diags.length === 0) {
      issues.push({
        code: 'FHIR_CLAIM_MISSING_DIAGNOSIS',
        severity: 'ERROR',
        path: 'Claim.diagnosis',
        message: 'Claim requires at least one coded diagnosis (1..*, ICD-11 primary).',
      });
    } else {
      diags.forEach((d, idx) => {
        const dObj = asObject(d);
        const cc = dObj ? asObject(dObj.diagnosisCodeableConcept) : null;
        const coding = cc && Array.isArray(cc.coding) ? asObject(cc.coding[0]) : null;
        const sys = coding ? readString(coding, 'system') : null;
        const code = coding ? readString(coding, 'code') : null;
        if (!sys || !code) {
          issues.push({
            code: 'FHIR_DIAGNOSIS_UNCODED',
            severity: 'ERROR',
            path: `Claim.diagnosis[${idx}]`,
            message:
              'Diagnosis must carry a coded system URI and code; free-text-only diagnoses are rejected.',
          });
        } else if (sys === ICD10_TRANSITIONAL_SYSTEM_URI) {
          issues.push({
            code: 'FHIR_ICD10_TRANSITIONAL_CODING',
            severity: 'WARNING',
            path: `Claim.diagnosis[${idx}].system`,
            message: `Diagnosis ${code} uses transitional ICD-10 coding; DHA HIE mandates migration to ICD-11 (${ICD11_SYSTEM_URI}).`,
          });
        } else if (sys !== ICD11_SYSTEM_URI) {
          issues.push({
            code: 'FHIR_UNSUPPORTED_DIAGNOSIS_SYSTEM',
            severity: 'ERROR',
            path: `Claim.diagnosis[${idx}].system`,
            message: `Unsupported diagnosis coding system "${sys}"; expected ICD-11 (${ICD11_SYSTEM_URI}).`,
          });
        }
      });
    }

    const items = Array.isArray(claim.item) ? claim.item : [];
    if (items.length === 0) {
      issues.push({
        code: 'FHIR_CLAIM_MISSING_ITEMS',
        severity: 'ERROR',
        path: 'Claim.item',
        message: 'Claim requires at least one service/intervention line item (1..*).',
      });
    } else {
      const itemCodes: string[] = [];
      items.forEach((it, idx) => {
        const itObj = asObject(it);
        const pos = itObj ? asObject(itObj.productOrService) : null;
        const coding = pos && Array.isArray(pos.coding) ? asObject(pos.coding[0]) : null;
        const code = coding ? readString(coding, 'code') : null;
        if (!code) {
          issues.push({
            code: 'FHIR_ITEM_MISSING_CODE',
            severity: 'ERROR',
            path: `Claim.item[${idx}].productOrService`,
            message: 'Claim line item is missing SHA intervention code.',
          });
        } else {
          itemCodes.push(code);
          if (!isValidShaCatalogueCode(code)) {
            issues.push({
              code: 'FHIR_NON_STANDARD_SHA_CODE',
              severity: 'WARNING',
              path: `Claim.item[${idx}].productOrService.coding[0].code`,
              message: `Code "${code}" does not match standard SHA catalogue pattern (SHA-xx-xxx or PMF-xxx).`,
            });
          }
        }
      });

      const combo = evaluateShaInterventionCombinations(itemCodes);
      for (const violation of combo.violations) {
        issues.push({
          code: 'SHA_INTERVENTION_COMBINATION_VIOLATION',
          severity: 'ERROR',
          path: 'Claim.item',
          message: violation,
        });
      }
    }
  }

  return {
    valid: !issues.some((i) => i.severity === 'ERROR'),
    issues,
  };
}

export interface ParsedShaBundleResponse {
  accepted: boolean;
  outcome: 'ACKNOWLEDGED' | 'APPROVED' | 'PARTIALLY_APPROVED' | 'REJECTED' | 'FAILED';
  mediatorId: string | null;
  payerReference: string | null;
  upstreamState: string | null;
  approvedAmountKes: string | null;
  rejectionReason: string | null;
  errors: string[];
}

/**
 * Parse a FHIR R4 ClaimResponse, OperationOutcome, HIE virtual-claim response, or
 * AfyaLink `/v1/shr-med/bundle` mediator response without ever fabricating identifiers on failure.
 */
export function parseShaBundleSubmissionResponse(
  httpStatus: number,
  body: unknown,
): ParsedShaBundleResponse {
  const root = asObject(body);
  if (!root) {
    return {
      accepted: false,
      outcome: 'FAILED',
      mediatorId: null,
      payerReference: null,
      upstreamState: null,
      approvedAmountKes: null,
      rejectionReason: null,
      errors: [`Unparseable response payload (HTTP ${httpStatus})`],
    };
  }

  // Case 1: FHIR OperationOutcome
  if (root.resourceType === 'OperationOutcome') {
    const issues = Array.isArray(root.issue) ? root.issue : [];
    const errors = issues
      .map((iss) => {
        const o = asObject(iss);
        if (!o) return null;
        const details = asObject(o.details);
        return readString(o, 'diagnostics') ?? (details ? readString(details, 'text') : null);
      })
      .filter((msg): msg is string => Boolean(msg));

    return {
      accepted: false,
      outcome: 'FAILED',
      mediatorId: null,
      payerReference: null,
      upstreamState: 'operation_outcome_error',
      approvedAmountKes: null,
      rejectionReason: errors[0] ?? `FHIR OperationOutcome error (HTTP ${httpStatus})`,
      errors: errors.length > 0 ? errors : [`FHIR OperationOutcome error (HTTP ${httpStatus})`],
    };
  }

  // Case 2: FHIR ClaimResponse
  if (root.resourceType === 'ClaimResponse') {
    const disposition = readString(root, 'disposition');
    const preAuthRef = readString(root, 'preAuthRef');
    const id = readString(root, 'id');
    const fhirOutcome = (readString(root, 'outcome') ?? '').toLowerCase();

    let approvedAmountKes: string | null = null;
    if (Array.isArray(root.total)) {
      for (const entry of root.total) {
        const entryObj = asObject(entry);
        const amountObj = entryObj ? asObject(entryObj.amount) : null;
        if (amountObj && typeof amountObj.value === 'number' && Number.isFinite(amountObj.value)) {
          approvedAmountKes = amountObj.value.toFixed(2);
          break;
        }
      }
    }

    if (httpStatus >= 400 || fhirOutcome === 'error') {
      return {
        accepted: false,
        outcome: root.preAuthRef || disposition ? 'REJECTED' : 'FAILED',
        mediatorId: null,
        payerReference: preAuthRef ?? id,
        upstreamState: fhirOutcome || 'error',
        approvedAmountKes: null,
        rejectionReason: disposition ?? `ClaimResponse error (HTTP ${httpStatus})`,
        errors: [disposition ?? `ClaimResponse error (HTTP ${httpStatus})`],
      };
    }

    if (fhirOutcome === 'queued') {
      return {
        accepted: true,
        outcome: 'ACKNOWLEDGED',
        mediatorId: null,
        payerReference: preAuthRef ?? id,
        upstreamState: 'queued',
        approvedAmountKes,
        rejectionReason: null,
        errors: [],
      };
    }

    if (fhirOutcome === 'partial') {
      return {
        accepted: true,
        outcome: 'PARTIALLY_APPROVED',
        mediatorId: null,
        payerReference: preAuthRef ?? id,
        upstreamState: 'partial',
        approvedAmountKes,
        rejectionReason: disposition,
        errors: [],
      };
    }

    if (disposition && /reject|denied|declin/i.test(disposition)) {
      return {
        accepted: false,
        outcome: 'REJECTED',
        mediatorId: null,
        payerReference: preAuthRef ?? id,
        upstreamState: 'rejected',
        approvedAmountKes: '0.00',
        rejectionReason: disposition,
        errors: [disposition],
      };
    }

    return {
      accepted: true,
      outcome: preAuthRef || approvedAmountKes ? 'APPROVED' : 'ACKNOWLEDGED',
      mediatorId: null,
      payerReference: preAuthRef ?? id,
      upstreamState: fhirOutcome || 'complete',
      approvedAmountKes,
      rejectionReason: null,
      errors: [],
    };
  }

  // Case 3: HIE v1 / AfyaLink / Mediator JSON envelope
  const data = asObject(root.data) ?? asObject(root.message) ?? root;
  const mediatorId = readString(data, 'mediator_id', 'mediatorId', 'edi_claim_guid');
  const payerReference = readString(
    data,
    'preauth_ref',
    'preAuthRef',
    'authorization_number',
    'authorization_code',
    'guid',
    'payer_claim_id',
    'claim_id',
    'reference_number',
    'reference',
    'id',
  );
  const upstreamState = (
    readString(data, 'workflow_state', 'state', 'status', 'claim_status', 'claim_auth_status') ?? ''
  ).toLowerCase();
  const rawErrors = Array.isArray(data.errors)
    ? data.errors.filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
    : [];
  const messageText = readString(data, 'reason', 'message', 'detail', 'error_description');

  let approvedAmountKes: string | null = null;
  const rawApproved =
    data.finalApprovedAmount ??
    data.approved_amount ??
    data.approvedAmount ??
    data.totalInterimApprovedAmountForPreauth;
  if (typeof rawApproved === 'number' && Number.isFinite(rawApproved)) {
    approvedAmountKes = rawApproved.toFixed(2);
  } else if (typeof rawApproved === 'string' && /^\d+(\.\d{1,2})?$/.test(rawApproved.trim())) {
    approvedAmountKes = Number(rawApproved.trim()).toFixed(2);
  }

  if (httpStatus >= 400 || upstreamState === 'failed_dispatch' || upstreamState === 'error') {
    const errs =
      rawErrors.length > 0 ? rawErrors : messageText ? [messageText] : [`HTTP ${httpStatus}`];
    return {
      accepted: false,
      outcome: 'FAILED',
      mediatorId,
      payerReference,
      upstreamState: upstreamState || `http_${httpStatus}`,
      approvedAmountKes: null,
      rejectionReason: errs[0] ?? null,
      errors: errs,
    };
  }

  if (upstreamState === 'rejected' || upstreamState === 'denied' || upstreamState === 'declined') {
    const reason = messageText ?? rawErrors[0] ?? 'Rejected by payer adjudication';
    return {
      accepted: false,
      outcome: 'REJECTED',
      mediatorId,
      payerReference,
      upstreamState,
      approvedAmountKes: '0.00',
      rejectionReason: reason,
      errors: [reason],
    };
  }

  if (upstreamState === 'partially_approved' || upstreamState === 'partial') {
    return {
      accepted: true,
      outcome: 'PARTIALLY_APPROVED',
      mediatorId,
      payerReference,
      upstreamState,
      approvedAmountKes,
      rejectionReason: messageText,
      errors: [],
    };
  }

  if (upstreamState === 'approved' || upstreamState === 'finalised') {
    return {
      accepted: true,
      outcome: 'APPROVED',
      mediatorId,
      payerReference,
      upstreamState,
      approvedAmountKes,
      rejectionReason: null,
      errors: [],
    };
  }

  if (
    upstreamState === 'queued' ||
    upstreamState === 'received' ||
    upstreamState === 'in-review' ||
    upstreamState === 'submitted' ||
    upstreamState === 'submitted_claim' ||
    upstreamState === 'pending' ||
    (httpStatus >= 200 && httpStatus < 300 && (mediatorId !== null || payerReference !== null))
  ) {
    return {
      accepted: true,
      outcome: 'ACKNOWLEDGED',
      mediatorId,
      payerReference,
      upstreamState: upstreamState || 'queued',
      approvedAmountKes,
      rejectionReason: null,
      errors: [],
    };
  }

  return {
    accepted: false,
    outcome: 'FAILED',
    mediatorId: null,
    payerReference: null,
    upstreamState: upstreamState || 'unrecognized_payload',
    approvedAmountKes: null,
    rejectionReason: 'Response did not contain a recognized acknowledgement or reference',
    errors: ['Response did not contain a recognized acknowledgement or reference'],
  };
}

export interface ParsedShaClaimStatus {
  recognized: boolean;
  mappedStatus:
    | 'ACKNOWLEDGED'
    | 'PARTIALLY_ADJUDICATED'
    | 'ADJUDICATED'
    | 'REJECTED'
    | 'PAID'
    | 'SUBMISSION_FAILED'
    | null;
  upstreamState: string | null;
  payerClaimReference: string | null;
  approvedAmountKes: string | null;
  paidAmountKes: string | null;
  rejectionReason: string | null;
}

export function parseShaClaimStatusResponse(
  httpStatus: number,
  body: unknown,
): ParsedShaClaimStatus {
  if (httpStatus < 200 || httpStatus >= 300) {
    return {
      recognized: false,
      mappedStatus: null,
      upstreamState: `http_${httpStatus}`,
      payerClaimReference: null,
      approvedAmountKes: null,
      paidAmountKes: null,
      rejectionReason: null,
    };
  }

  const root = asObject(body);
  if (!root) {
    return {
      recognized: false,
      mappedStatus: null,
      upstreamState: null,
      payerClaimReference: null,
      approvedAmountKes: null,
      paidAmountKes: null,
      rejectionReason: null,
    };
  }

  if (root.resourceType === 'ClaimResponse') {
    const parsed = parseShaBundleSubmissionResponse(httpStatus, root);
    return {
      recognized: parsed.outcome !== 'FAILED',
      mappedStatus:
        parsed.outcome === 'APPROVED'
          ? 'ADJUDICATED'
          : parsed.outcome === 'PARTIALLY_APPROVED'
            ? 'PARTIALLY_ADJUDICATED'
            : parsed.outcome === 'REJECTED'
              ? 'REJECTED'
              : parsed.outcome === 'ACKNOWLEDGED'
                ? 'ACKNOWLEDGED'
                : null,
      upstreamState: parsed.upstreamState,
      payerClaimReference: parsed.payerReference,
      approvedAmountKes: parsed.approvedAmountKes,
      paidAmountKes: null,
      rejectionReason: parsed.rejectionReason,
    };
  }

  // Handle FHIR Bundle searchset wrapping ClaimResponse (`GET /fhir/ClaimResponse?request=...`)
  if (root.resourceType === 'Bundle' && Array.isArray(root.entry) && root.entry.length > 0) {
    const firstResource = asObject(asObject(root.entry[0])?.resource);
    if (firstResource?.resourceType === 'ClaimResponse') {
      return parseShaClaimStatusResponse(httpStatus, firstResource);
    }
  }

  const data = asObject(root.data) ?? asObject(root.message) ?? root;
  const state = (
    readString(data, 'workflow_state', 'state', 'claim_status', 'status') ?? ''
  ).toLowerCase();
  const payerRef = readString(
    data,
    'payer_claim_id',
    'claim_id',
    'edi_claim_guid',
    'reference_number',
    'reference',
    'id',
  );
  const reason = readString(data, 'rejection_reason', 'cancel_reason_text', 'reason', 'message');

  const parseAmount = (raw: unknown): string | null => {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw.toFixed(2);
    if (typeof raw === 'string' && /^\d+(\.\d{1,2})?$/.test(raw.trim())) {
      return Number(raw.trim()).toFixed(2);
    }
    return null;
  };

  const approvedAmountKes = parseAmount(
    data.approved_amount ?? data.approvedAmount ?? data.total_claim_net_amount,
  );
  const paidAmountKes = parseAmount(data.paid_amount ?? data.paidAmount);

  if (
    state === 'queued' ||
    state === 'in-review' ||
    state === 'in_review' ||
    state === 'received' ||
    state === 'acknowledged' ||
    state === 'submitted' ||
    state === 'submitted_claim' ||
    state === 'qa_review'
  ) {
    return {
      recognized: true,
      mappedStatus: 'ACKNOWLEDGED',
      upstreamState: state,
      payerClaimReference: payerRef,
      approvedAmountKes,
      paidAmountKes,
      rejectionReason: null,
    };
  }
  if (state === 'partially_approved' || state === 'partially_adjudicated' || state === 'partial') {
    return {
      recognized: true,
      mappedStatus: 'PARTIALLY_ADJUDICATED',
      upstreamState: state,
      payerClaimReference: payerRef,
      approvedAmountKes,
      paidAmountKes,
      rejectionReason: reason,
    };
  }
  if (state === 'approved' || state === 'adjudicated' || state === 'approved_for_payment') {
    return {
      recognized: true,
      mappedStatus: 'ADJUDICATED',
      upstreamState: state,
      payerClaimReference: payerRef,
      approvedAmountKes,
      paidAmountKes,
      rejectionReason: null,
    };
  }
  if (state === 'paid' || state === 'settled' || state === 'remitted') {
    return {
      recognized: true,
      mappedStatus: 'PAID',
      upstreamState: state,
      payerClaimReference: payerRef,
      approvedAmountKes,
      paidAmountKes,
      rejectionReason: null,
    };
  }
  if (state === 'rejected' || state === 'denied' || state === 'declined') {
    return {
      recognized: true,
      mappedStatus: 'REJECTED',
      upstreamState: state,
      payerClaimReference: payerRef,
      approvedAmountKes: '0.00',
      paidAmountKes: '0.00',
      rejectionReason: reason ?? 'Rejected by payer',
    };
  }
  if (state === 'failed_dispatch') {
    return {
      recognized: true,
      mappedStatus: 'SUBMISSION_FAILED',
      upstreamState: state,
      payerClaimReference: payerRef,
      approvedAmountKes: null,
      paidAmountKes: null,
      rejectionReason: reason ?? 'Upstream mediator dispatch failed',
    };
  }

  return {
    recognized: false,
    mappedStatus: null,
    upstreamState: state || null,
    payerClaimReference: payerRef,
    approvedAmountKes: null,
    paidAmountKes: null,
    rejectionReason: null,
  };
}

export interface ParsedPaymentNotice {
  payerRemittanceRef: string;
  paymentDate: string;
  amountKes: string;
  claimReference: string | null;
}

export function parseShaPaymentNotice(body: unknown): ParsedPaymentNotice | null {
  const root = asObject(body);
  if (!root || root.resourceType !== 'PaymentNotice') return null;

  const id = readString(root, 'id');
  let identifierVal: string | null = null;
  if (Array.isArray(root.identifier)) {
    for (const ident of root.identifier) {
      const identObj = asObject(ident);
      if (identObj) {
        identifierVal = readString(identObj, 'value');
        if (identifierVal) break;
      }
    }
  }

  const paymentDate = readString(root, 'paymentDate') ?? readString(root, 'created')?.slice(0, 10);
  const amountObj = asObject(root.amount);
  const amountVal =
    amountObj && typeof amountObj.value === 'number' && Number.isFinite(amountObj.value)
      ? amountObj.value.toFixed(2)
      : null;

  const requestObj = asObject(root.request);
  let claimReference: string | null = null;
  if (requestObj) {
    const reqRef = readString(requestObj, 'reference');
    const reqIdent = asObject(requestObj.identifier);
    claimReference =
      (reqIdent ? readString(reqIdent, 'value') : null) ??
      (reqRef ? reqRef.replace(/^Claim\//, '') : null);
  }

  const payerRemittanceRef = identifierVal ?? id;
  if (!payerRemittanceRef || !paymentDate || !amountVal) {
    return null;
  }

  return {
    payerRemittanceRef,
    paymentDate,
    amountKes: amountVal,
    claimReference,
  };
}
