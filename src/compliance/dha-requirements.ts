/**
 * JaliCare HMIS
 * DHA readiness — requirement register
 *
 * Why this file exists
 * ====================
 *
 * The DHA assessment supplied for this audit arrives with four
 * percentages (96 / 84 / 100 / 74) and an overall of about 90. No code
 * in this repository produced those numbers. Before this register, the
 * only readiness surface in the product was the DHA configuration
 * report (`src/integrations/dha/dha.readiness.ts`), which answers a
 * different question — *can this installation reach DHA right now* —
 * and deliberately publishes no score at all.
 *
 * A percentage without a per-requirement status is the exact failure
 * mode this audit is meant to prevent: a high average conceals a
 * missing legal control. So every figure shown to an administrator is
 * now computed from this register, and every row carries:
 *
 *   - what the requirement is,
 *   - where it lives,
 *   - how it was verified,
 *   - what evidence exists in this repository,
 *   - how severe the gap is,
 *   - and what external party, if any, must act.
 *
 * STATUS VOCABULARY
 * =================
 *
 *   VERIFIED              exercised by a test that runs in this repo,
 *                         and the code path was read during the audit.
 *   IMPLEMENTED_UNTESTED  the code exists and compiles; no test walks it.
 *   PARTIAL               part of the requirement is met.
 *   MISSING               not built.
 *   BLOCKED               built as far as this repository can go, but an
 *                         external party or credential is required.
 *   NOT_APPLICABLE        the requirement does not apply, and the reason
 *                         is recorded rather than assumed.
 *
 * VERIFIED here means "verified in this repository". It is not a DHA
 * certification, and the UI and the audit documents say so.
 */

export type RequirementStatus =
  'VERIFIED' | 'IMPLEMENTED_UNTESTED' | 'PARTIAL' | 'MISSING' | 'BLOCKED' | 'NOT_APPLICABLE';

export type RequirementCategory = 'functionality' | 'security' | 'reporting' | 'interoperability';

export type GapSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface DhaRequirement {
  id: string;
  category: RequirementCategory;
  title: string;
  /** The DHA expectation, in one sentence. */
  requirement: string;
  /** Where the capability lives, or where it is absent. */
  module: string;
  status: RequirementStatus;
  severity: GapSeverity;
  /** Exact evidence: test file, endpoint, table, or document. */
  evidence: string;
  /** How it was checked. Never "assumed". */
  verification: string;
  /** Who must act when the gap is not purely technical. */
  externalDependency?: string;
  /** Anything a reader must not misread. */
  note?: string;
}

export const DHA_CATEGORY_WEIGHTS: Record<RequirementCategory, number> = {
  functionality: 0.35,
  security: 0.3,
  reporting: 0.2,
  interoperability: 0.15,
};

export const DHA_CATEGORY_LABELS: Record<RequirementCategory, string> = {
  functionality: 'Clinical functionality',
  security: 'Security & privacy',
  reporting: 'Public health reporting',
  interoperability: 'Interoperability',
};

export const DHA_REQUIREMENTS: readonly DhaRequirement[] = Object.freeze([
  /* ==========================================================
     CLINICAL FUNCTIONALITY — 35%
     ========================================================== */
  {
    id: 'FN-01',
    category: 'functionality',
    title: 'Patient registration and MRN',
    requirement: 'Every patient is registered once with a unique medical record number.',
    module: 'Patient Directory · src/components/modules/PatientRegistrationModule.tsx',
    status: 'VERIFIED',
    severity: 'critical',
    evidence:
      'patients.mrn (schema.ts), POST /api/patients, src/tests/opd-journey.test.ts, src/tests/migrations.test.ts',
    verification: 'Automated test suite plus code inspection.',
  },
  {
    id: 'FN-02',
    category: 'functionality',
    title: 'Demographics',
    requirement:
      'Sex, date of birth, age, residence and contact details are captured and validated.',
    module: 'Patient Directory · src/db/schema.ts',
    status: 'VERIFIED',
    severity: 'critical',
    evidence:
      'patients.gender, date_of_birth, county, sub_county, residential_address, phone; src/tests/opd-journey.test.ts',
    verification: 'Automated test plus column inspection.',
  },
  {
    id: 'FN-03',
    category: 'functionality',
    title: 'Next of kin and guardian',
    requirement: 'A next of kin or guardian is recorded, including relationship and contact.',
    module: 'Patient Directory',
    status: 'VERIFIED',
    severity: 'high',
    evidence: 'patients.guardian_name, guardian_relationship, guardian_phone, emergency_contact_*',
    verification: 'Schema inspection and registration form review.',
  },
  {
    id: 'FN-04',
    category: 'functionality',
    title: 'National identifiers',
    requirement:
      'National ID, SHA number and the DHA client-registry reference are held where applicable.',
    module: 'Patient Directory · DHA eligibility',
    status: 'VERIFIED',
    severity: 'high',
    evidence: 'patients.national_id, sha_number, dha_client_registry_id; eligibility service',
    verification: 'Schema and DHA eligibility code inspection.',
  },
  {
    id: 'FN-05',
    category: 'functionality',
    title: 'Duplicate patient detection',
    requirement:
      'A likely duplicate is detected before a second record is created, and records can be reconciled.',
    module: 'Patient Directory',
    status: 'PARTIAL',
    severity: 'high',
    evidence:
      'Duplicate detection on registration compares national ID, SHA number, phone and name+date-of-birth and warns before saving. Since the portal round the database also enforces one portal account per patient (UNIQUE patient_id) and one account per login identifier; activation refuses to attach a contact already owned by another patient, parks the account as PENDING_VERIFICATION and asks for staff verification instead of merging. The portal administration screen lists shared identifiers and accounts awaiting verification as a review list and corrects nothing automatically.',
    verification:
      'Registration path read; portal constraints and refusal path read; the unique indexes are asserted by test:patient-portal and test:migrations. No database was available, so neither the duplicate query nor the constraints were executed.',
    note: 'Still partial: registration-time matching remains heuristic (it warns, it does not decide), there is no master patient index and no merge or split workflow. The portal closes the two-accounts-for-one-person route, not the identity-resolution problem.',
  },
  {
    id: 'FN-06',
    category: 'functionality',
    title: 'Patient consent capture',
    requirement:
      'Consent is recorded with version, method and evidence, and access is restricted accordingly.',
    module: 'src/clinical/consent.service.ts',
    status: 'PARTIAL',
    severity: 'critical',
    evidence:
      "Consent can be granted, listed and revoked with purpose, method, scope and expiry; status is derived (ACTIVE / REVOKED / EXPIRED) rather than trusted from the client; revocation is a state change, never a delete; every write is audited. Routes live at /api/patients/:id/consents and the panel is the Consent and Allergies tab of the patient record. Unit tests cover status derivation and input validation (80 assertions, consent-allergy.test.ts). The portal round did not change consent gating: the portal is an access channel for the patient's own record and does not read the consent table.",
    verification:
      'Read the service, routes and panel; ran test:consent-allergy. The PostgreSQL paths (grantConsent, revokeConsent, listConsents) have NOT been executed: this environment has no database and migration 0017 is unapplied.',
    note: 'Still partial: consent is captured but does not gate clinical reads. hasActiveConsent() is exposed for that policy decision, which is a clinical-governance call rather than a coding default. The portal adds a disclosure channel that does not consult consent; that is defensible only because the patient is retrieving their own record, and the facility must confirm that reading rather than have it assumed. DHA consent authorisation (OTP) is separately blocked.',
    remainingGap:
      "Wire consent checks into cross-facility sharing, portal-initiated sharing and insurer submission, not into the treating clinician's own access.",
  },
  {
    id: 'FN-07',
    category: 'functionality',
    title: 'Computerised medication orders',
    requirement: 'A clinician can order medication, and the order reaches dispensing.',
    module: 'Outpatient · Pharmacy',
    status: 'VERIFIED',
    severity: 'critical',
    evidence: 'prescriptions routes; src/tests/pharmacy-batches.test.ts (80 assertions)',
    verification: 'Automated test plus route inspection.',
  },
  {
    id: 'FN-08',
    category: 'functionality',
    title: 'Laboratory orders and specimen tracking',
    requirement:
      'A lab order is created, tracked through specimen collection, resulted, verified and published.',
    module: 'Laboratory',
    status: 'VERIFIED',
    severity: 'critical',
    evidence:
      'lab_orders, lab_results, migrations 0008; laboratory routes; src/tests/nursing-contracts.test.ts',
    verification: 'Automated tests and migration inspection.',
  },
  {
    id: 'FN-09',
    category: 'functionality',
    title: 'Radiology orders and reports',
    requirement:
      'An imaging order is created, reported by a radiologist, and returned to the record.',
    module: 'Radiology',
    status: 'IMPLEMENTED_UNTESTED',
    severity: 'high',
    evidence: 'GET/POST /api/radiology-orders, PUT /api/radiology-orders/:id/report',
    verification:
      'Routes inspected and scoped during this audit; no automated test exercises them.',
    note: 'Before this audit these routes had no permission check and no facility scope.',
  },
  {
    id: 'FN-10',
    category: 'functionality',
    title: 'Physiotherapy, occupational therapy, nutrition, social work, counselling',
    requirement: 'Allied-health orders and notes are captured as part of the encounter.',
    module: 'Not implemented',
    status: 'MISSING',
    severity: 'medium',
    evidence: 'No table, route, screen or test for any of the five disciplines.',
    verification: 'Repository-wide search for each discipline returned zero matches.',
  },
  {
    id: 'FN-11',
    category: 'functionality',
    title: 'Family history',
    requirement: 'Family history is recorded against the patient.',
    module: 'Not implemented',
    status: 'MISSING',
    severity: 'medium',
    evidence: 'No family-history table, field, route or screen.',
    verification: 'Repository-wide search returned zero matches.',
  },
  {
    id: 'FN-12',
    category: 'functionality',
    title: 'Vital signs and growth',
    requirement: 'Vital signs are recorded per encounter; BMI and growth are derived for children.',
    module: 'Outpatient · observations',
    status: 'PARTIAL',
    severity: 'high',
    evidence: 'observations routes and table; no BMI or growth-chart derivation found',
    verification: 'Route and schema inspection.',
  },
  {
    id: 'FN-13',
    category: 'functionality',
    title: 'Diagnoses and problem list',
    requirement:
      'Primary and secondary diagnoses are coded, retained over time, and correctable without erasing history.',
    module: 'Outpatient · diagnoses',
    status: 'PARTIAL',
    severity: 'high',
    evidence:
      'GET/POST /api/diagnoses, diagnoses table; no persistent problem list and no code-system validation',
    verification: 'Route inspection; ICD-10 codes are free text, not constrained.',
  },
  {
    id: 'FN-14',
    category: 'functionality',
    title: 'Medication catalogue',
    requirement: 'A maintained catalogue supplies the products that can be prescribed.',
    module: 'Pharmacy',
    status: 'VERIFIED',
    severity: 'high',
    evidence: 'medications table; GET/POST /api/medications; PUT /api/medications/:id/status',
    verification: 'Route inspection and pharmacy test suite.',
  },
  {
    id: 'FN-15',
    category: 'functionality',
    title: 'Allergy and interaction checking',
    requirement: 'Known allergies and clinically significant interactions warn the prescriber.',
    module: 'src/clinical/allergy.service.ts',
    status: 'PARTIAL',
    severity: 'critical',
    evidence:
      'A structured allergy registry (allergen type, reaction, severity, status) can be recorded and resolved from the patient record. The prescription route calls checkMedicationAllergies before writing; a match returns 409 ALLERGY_CONFLICT and the prescriber must acknowledge it, which is written to the audit trail as a PRESCRIBE override. Matching is name-based (equal, containment at four characters or more, shared leading word); unit tests cover it.',
    verification:
      'Read the service, the prescription route and the prescribing screen; ran test:consent-allergy. No database was available, so the registry queries were not executed.',
    note: 'Still partial: there is no drug-drug interaction engine and no cross-reactivity table. The UI says an empty check is not a guarantee of safety rather than implying one.',
    remainingGap:
      'A pharmacological interaction dataset is a licensed-content decision, not a code change.',
  },
  {
    id: 'FN-16',
    category: 'functionality',
    title: 'Clinical decision support',
    requirement: 'Rules evaluate clinical inputs and surface prioritised, non-disappearing alerts.',
    module: 'Not implemented',
    status: 'MISSING',
    severity: 'high',
    evidence: 'No rules engine, threshold table or alert queue.',
    verification: 'Repository-wide search returned zero matches.',
  },
  {
    id: 'FN-17',
    category: 'functionality',
    title: 'Clinical summary',
    requirement:
      'A summary assembles demographics, encounters, diagnoses, medication, vitals and results for one patient only.',
    module: 'PatientJourneyModal · OPD',
    status: 'PARTIAL',
    severity: 'high',
    evidence:
      'The patient record screen assembles a visit-centred summary. Since the portal round the same record can be produced as a patient-facing text summary generated on request at GET /api/portal/records/download: visits with released diagnoses, verified laboratory results, prescriptions, allergies and appointments, streamed as an attachment with no stored file. Staff-side clinical summaries remain visit-centred rather than a longitudinal shared-health-record document.',
    verification:
      'Record service and portal download path read; test:patient-portal asserts the download is generated per request and that the portal writes no clinical table. The download has not been executed against a database.',
  },
  {
    id: 'FN-18',
    category: 'functionality',
    title: 'Electronic prescribing lifecycle',
    requirement:
      'A prescription can be created, authorised, amended or cancelled, dispensed and audited.',
    module: 'Outpatient · Pharmacy',
    status: 'VERIFIED',
    severity: 'critical',
    evidence: 'src/tests/pharmacy-batches.test.ts; prescription and dispensing routes',
    verification: 'Automated test plus route inspection.',
  },
  {
    id: 'FN-19',
    category: 'functionality',
    title: 'Quality measures',
    requirement: 'Indicators are calculated from real, period-filtered facility data.',
    module: 'Reports & revenue',
    status: 'PARTIAL',
    severity: 'medium',
    evidence: 'GET /api/analytics/summary, GET /api/analytics/revenue; facility scoping enforced',
    verification:
      'Route inspection. Operational aggregates exist; no defined quality-indicator set or denominator rules.',
  },
  {
    id: 'FN-20',
    category: 'functionality',
    title: 'Maternal and child health',
    requirement: 'Antenatal, labour, delivery, postnatal and immunisation encounters are recorded.',
    module: 'Maternity & MCH',
    status: 'VERIFIED',
    severity: 'high',
    evidence:
      'src/tests/maternity.test.ts (131), src/tests/postnatal-immunisation.test.ts (151); migrations 0015, 0016',
    verification: 'Automated tests and migration inspection.',
  },

  /* ==========================================================
     SECURITY & PRIVACY — 30%
     ========================================================== */
  {
    id: 'SP-01',
    category: 'security',
    title: 'ODPC registration',
    requirement:
      'The responsible legal entity is registered as a data controller/processor with the ODPC.',
    module: 'Organisational — not software',
    status: 'BLOCKED',
    severity: 'critical',
    evidence: 'No registration certificate, number or entity record exists in the repository.',
    verification:
      'Repository search. A registration cannot be inferred from source code, and none was fabricated.',
    externalDependency:
      'The facility/company must register with the Office of the Data Protection Commissioner and supply the certificate.',
  },
  {
    id: 'SP-02',
    category: 'security',
    title: 'Data Protection Impact Assessment',
    requirement:
      'A DPIA covering the actual deployment and processing is documented, reviewed and approved.',
    module: 'Organisational — not software',
    status: 'BLOCKED',
    severity: 'critical',
    evidence:
      'No DPIA exists in the repository. A populated draft template is delivered with this audit.',
    verification:
      'Repository search. The draft is prepared from verified system facts and is explicitly not approved.',
    externalDependency:
      'Data protection officer or responsible officer must review, sign and date the DPIA.',
  },
  {
    id: 'SP-03',
    category: 'security',
    title: 'Authentication',
    requirement:
      'Passwords are hashed with a memory-hard function; sessions are random, hashed at rest, expiring and revocable.',
    module: 'src/auth · src/utils/password.ts',
    status: 'VERIFIED',
    severity: 'critical',
    evidence:
      'Staff: argon2 password hashes, 48-byte random session tokens stored as SHA-256, 8-hour expiry and security_version invalidation. The portal round added a second, separate identity namespace: patient_portal_accounts (argon2id, 12-character minimum, five failures then a 15-minute lock) and patient_portal_sessions (48-byte token, SHA-256 only, 2-hour expiry, revoked on logout, password change, suspension and revocation). A patient token is validated only against the patient session table, so a patient credential can never satisfy a staff route and vice versa. Sign-in verifies the password before it discloses whether an account is suspended, revoked or unverified.',
    verification:
      'Auth service, portal auth service and both middlewares read; test:patient-portal asserts the separation, the generic pre-authentication error and the password rules. No runtime sign-in was performed in this environment.',
  },
  {
    id: 'SP-04',
    category: 'security',
    title: 'Role-based access control',
    requirement: 'Every sensitive endpoint enforces a permission, not merely a session.',
    module: 'src/auth/authorization.middleware.ts',
    status: 'PARTIAL',
    severity: 'critical',
    evidence:
      'The audit closed 8 of the 13 unguarded /api routes (theatre, radiology, suppliers, purchase orders). The portal round added 38 routes (19 patient, 19 staff) with no unguarded route: every staff endpoint carries requirePermission with one of five new portal codes or patients.read, and every patient endpoint is behind requirePortalAuth, which accepts only a patient session. test:patient-portal fails if a portal staff route lacks a guard or if the patient router reads a patient id from the request.',
    verification:
      'Static enumeration of route declarations and route-by-route reading; automated assertions in test:patient-portal (permission count, requireAuth present, requirePortalAuth absent from the admin router) and test:route-scope. The five pre-existing unguarded routes were not re-reviewed this round and remain.',
    note: 'Still partial for the same reason as before: five pre-existing unguarded routes and the object-level ownership of id-addressed routes outside the portal are unchanged. The portal added guarded surface; it did not fix the legacy surface.',
  },
  {
    id: 'SP-05',
    category: 'security',
    title: 'Tenant and facility isolation',
    requirement:
      'A facility cannot read or modify another facility’s records, including by guessing an id.',
    module: 'src/auth/scope.service.ts · src/db/queries.ts',
    status: 'PARTIAL',
    severity: 'critical',
    evidence:
      "Theatre cases, radiology orders, suppliers and purchase orders were readable across facilities before the audit and are now scoped. Portal reads are scoped to the patient's registration facility union the account facility, applied to encounters, appointments, laboratory orders, admissions, allergies and prescriptions (through encounters), and an empty facility set is refused rather than widening the query. Portal administration is scoped on tenant_id and facility_id and answers 404 rather than 403 for another facility's account, so the response cannot confirm that an account exists elsewhere. test:patient-portal asserts each facility filter and the absence of any request-supplied patient id.",
    verification:
      'Portal record and admin services read line by line; automated source assertions in test:patient-portal. The portal queries have not been executed against a database, so isolation is asserted structurally, not demonstrated with rows.',
    note: 'Still the most serious finding of the audit: the legacy id-addressed routes outside the portal remain unaudited for object-level ownership. The portal is evidence that the pattern can be applied; it is not evidence that it has been applied everywhere.',
  },
  {
    id: 'SP-06',
    category: 'security',
    title: 'Audit trail',
    requirement:
      'Sensitive actions are recorded with actor, action, target, time and outcome, and ordinary users cannot alter the history.',
    module: 'audit_logs · Audit Trail screen',
    status: 'PARTIAL',
    severity: 'high',
    evidence:
      'audit_logs records staff actions; patient_record_access_logs records reads with a purpose and channel. The portal round widened the second: eight patient read paths write an access row with accessChannel PATIENT_PORTAL (dashboard, visits, laboratory, medications, appointments, discharge summaries, download, sharing redemption), card lookup writes one under the staff session, and every portal administration action writes an audit row. Reading the portal audit trail is itself audited. Migration 0017 (append-only triggers plus REVOKE UPDATE, DELETE, TRUNCATE) is written but has not been applied to any database.',
    verification:
      'Read the access-log and audit call sites; test:patient-portal asserts at least eight logPortalRecordAccess calls and that the portal never writes a clinical table. The triggers were not executed.',
    note: 'Still partial: the append-only guarantee exists only in an unapplied migration, so a database that has not run 0017 can still have its audit rows edited by a privileged role. Retention and review ownership are also undecided.',
  },
  {
    id: 'SP-07',
    category: 'security',
    title: 'Encryption in transit',
    requirement: 'Client traffic and database traffic use TLS with certificate verification.',
    module: 'src/config/env.ts · deployment',
    status: 'PARTIAL',
    severity: 'critical',
    evidence:
      'Helmet and CORS are configured; the database connection previously hard-coded ssl:false and is now SQL_SSL-controlled with verification on by default. The application itself terminates no TLS.',
    verification:
      'Configuration inspection. TLS termination must be proven at the deployment layer, which is not in this repository.',
    externalDependency:
      'Deployment/operations must terminate TLS 1.2+ and set SQL_SSL=true for any non-local database.',
  },
  {
    id: 'SP-08',
    category: 'security',
    title: 'Encryption at rest',
    requirement:
      'The database, its backups and any object storage are encrypted, with keys managed and rotated.',
    module: 'src/security/field-crypto.ts',
    status: 'PARTIAL',
    severity: 'critical',
    evidence:
      'Direct identifiers (national ID, SHA number) can be sealed with AES-256-GCM before they reach PostgreSQL, with an HMAC blind index for exact lookups and legacy plaintext passthrough. The key comes from FIELD_ENCRYPTION_KEY and there is no compiled-in default; 48 assertions cover round-trip, tamper detection, wrong-key refusal and key absence. The portal stores the digital-card code the same way: a SHA-256 hash is the lookup key and the sealed copy is readable only by the account that owns the card. Whole-volume, snapshot and backup encryption are untouched.',
    verification:
      'Ran test:field-encryption against the real crypto module; read the card issue and render paths. The volume, its snapshots and backups are NOT encrypted by anything in this repository.',
    note: 'Still an operational control: whole-volume and backup encryption, key custody and rotation remain the hosting provider and facility responsibility. Application-level sealing of two columns does not make the database encrypted at rest.',
    externalDependency:
      'Hosting provider or DBA must enable storage encryption and document key custody.',
  },
  {
    id: 'SP-09',
    category: 'security',
    title: 'Backup and disaster recovery',
    requirement:
      'Backups are automated, encrypted, retained, access-controlled and restoration-tested.',
    module: 'Operations',
    status: 'MISSING',
    severity: 'critical',
    evidence:
      'No backup script, schedule, retention policy or restoration runbook in the repository.',
    verification: 'Repository search. Nothing was executed against a database.',
    externalDependency:
      'Operations must implement and test a restore; the recovery document supplied with this audit is a template, not evidence.',
  },
  {
    id: 'SP-10',
    category: 'security',
    title: 'Brute-force protection',
    requirement: 'Repeated failed sign-ins are rate limited and lock the account.',
    module: 'src/middleware · src/auth/auth.service.ts',
    status: 'VERIFIED',
    severity: 'high',
    evidence:
      'Per-IP rate limits on staff sign-in and the API, plus account lockout. The portal adds public endpoints that need it: activation and login are limited to 10 requests per 15 minutes per address, and a patient account locks for 15 minutes after five failed passwords, counted per account so rotating addresses does not escape it. The lock is checked only after the password verifies, so the endpoint cannot be used to enumerate accounts. http-security and patient-portal tests assert the limiter shape and the lock constants.',
    verification:
      'Read the limiter factory and the login path; ran test:security and test:patient-portal. Rate limiting was not exercised under load and the trust-proxy configuration at the edge is unverified.',
  },
  {
    id: 'SP-11',
    category: 'security',
    title: 'Multi-factor authentication',
    requirement:
      'A second factor protects privileged and remote access where the risk assessment requires it.',
    module: 'Not implemented',
    status: 'MISSING',
    severity: 'medium',
    evidence: 'No TOTP, WebAuthn or SMS second factor anywhere in the codebase.',
    verification: 'Repository-wide search returned zero matches.',
  },
  {
    id: 'SP-12',
    category: 'security',
    title: 'Secrets handling',
    requirement: 'Credentials are not committed, and production secrets are managed and rotated.',
    module: '.gitignore · .env.example',
    status: 'PARTIAL',
    severity: 'high',
    evidence:
      '.env and firebase-applet-config.json are ignored; .env.example carries names only; DHA credentials are read from the environment and never returned by the readiness endpoint.',
    verification:
      'git ls-files and grep for literal secrets. No rotation mechanism or secret manager is present.',
  },

  /* ==========================================================
     PUBLIC HEALTH REPORTING — 20%
     ========================================================== */
  {
    id: 'PH-01',
    category: 'reporting',
    title: 'Immediate reportable disease capture',
    requirement:
      'A suspected reportable disease is captured immediately with condition, counts, age group and epi-week.',
    module: 'Public health · POST /api/public-health/reports',
    status: 'PARTIAL',
    severity: 'critical',
    evidence:
      'Validated route (ICD-10 code, epi-week pattern, counts), scoped to the facility; screen rewritten in this audit to stop claiming national transmission',
    verification:
      'Route inspection and validation review. No submission channel, no acknowledgement, no retry.',
  },
  {
    id: 'PH-02',
    category: 'reporting',
    title: 'IDSR weekly reporting',
    requirement: 'A weekly IDSR return is generated for the reporting period and submitted.',
    module: 'Not implemented',
    status: 'MISSING',
    severity: 'critical',
    evidence:
      'No IDSR aggregate, period table or return generator. The MOH 705 endpoint returns 501 by design.',
    verification: 'Route inventory and repository search.',
  },
  {
    id: 'PH-03',
    category: 'reporting',
    title: 'Public health events and IHR',
    requirement:
      'Events of international concern can be recorded, classified and notified under IHR processes.',
    module: 'Not implemented',
    status: 'MISSING',
    severity: 'high',
    evidence: 'No event, risk-assessment or notification entity exists.',
    verification: 'Repository search returned zero matches.',
  },
  {
    id: 'PH-04',
    category: 'reporting',
    title: 'MOH 705 routine return',
    requirement:
      'The outpatient morbidity return is produced from encounter data for a stated period.',
    module: 'GET /api/interop/dha/moh-705',
    status: 'MISSING',
    severity: 'high',
    evidence:
      'The endpoint deliberately returns 501 MOH705_REPORT_NOT_IMPLEMENTED; the screen now shows that reason.',
    verification: 'Route inspection and UI review.',
    note: 'The previous screen displayed an empty table, a hard-coded period and an export button that downloaded JSON null.',
  },
  {
    id: 'PH-05',
    category: 'reporting',
    title: 'Reporting-period correctness',
    requirement: 'Reports are bound to a computed period, not a constant.',
    module: 'Public health · Maternity',
    status: 'PARTIAL',
    severity: 'medium',
    evidence:
      'The epi-week was hard-coded as 2026-W40 in the screen and is now derived (currentEpiWeek); the server validates the pattern.',
    verification: 'Source inspection before and after the fix. No server-side period table exists.',
  },
  {
    id: 'PH-06',
    category: 'reporting',
    title: 'Submission, retry and duplicate handling',
    requirement:
      'Failed submissions are recorded and retried safely; duplicates are prevented and history preserved.',
    module: 'Not implemented',
    status: 'MISSING',
    severity: 'high',
    evidence:
      'No outbox, submission status, retry counter or idempotency key for public-health reporting.',
    verification: 'Repository search returned zero matches.',
  },

  /* ==========================================================
     INTEROPERABILITY — 15%
     ========================================================== */
  {
    id: 'IO-01',
    category: 'interoperability',
    title: 'DHA authentication and configuration',
    requirement:
      'The system authenticates to DHA with client credentials and separates mock, sandbox and production.',
    module: 'src/integrations/dha/dha.config.ts · dha.client.ts',
    status: 'IMPLEMENTED_UNTESTED',
    severity: 'high',
    evidence:
      'Three explicit modes; production disabled unless DHA_ALLOW_PRODUCTION=true; token cache and retry; src/tests/dha.test.ts (176 assertions) against fixtures',
    verification:
      'Automated fixture tests. No sandbox credential was available, so no live token exchange was attempted.',
    externalDependency: 'DHA must issue a client id, secret and facility registry code.',
  },
  {
    id: 'IO-02',
    category: 'interoperability',
    title: 'SHA eligibility and benefits',
    requirement:
      'Eligibility, benefits, interventions and POMSF balances are retrieved for a patient.',
    module: 'src/integrations/dha/dha.eligibility.ts',
    status: 'IMPLEMENTED_UNTESTED',
    severity: 'high',
    evidence:
      'Six implemented operations in DHA_OPERATIONS; mock fixtures; readiness endpoint reports them',
    verification:
      'Fixture tests only. Contracts were taken from the published DHA reference pages listed in the audit.',
    externalDependency: 'Sandbox credentials and an approved facility.',
  },
  {
    id: 'IO-03',
    category: 'interoperability',
    title: 'Claims, authorisation and consent',
    requirement:
      'Claim creation, line items, diagnoses, pre-authorisation and remittance are exchanged with DHA.',
    module: 'src/integrations/dha/dha.readiness.ts',
    status: 'MISSING',
    severity: 'high',
    evidence:
      'Declared not implemented, with the reason recorded per operation; consent capture has no OTP or biometric channel.',
    verification: 'The readiness register is explicit rather than optimistic.',
  },
  {
    id: 'IO-04',
    category: 'interoperability',
    title: 'FHIR Patient',
    requirement: 'A patient can be exported as a FHIR Patient resource.',
    module: 'GET /api/interop/fhir/patient/:id',
    status: 'PARTIAL',
    severity: 'medium',
    evidence:
      'One read-only Patient resource with an identifier and managing organization; access is audited.',
    verification: 'Route inspection. No validator was run, and no other resource exists.',
  },
  {
    id: 'IO-05',
    category: 'interoperability',
    title: 'FHIR clinical resources',
    requirement:
      'Encounter, Condition, Observation, MedicationRequest, DiagnosticReport and related resources are exchanged.',
    module: 'Not implemented',
    status: 'MISSING',
    severity: 'medium',
    evidence: 'No builder or endpoint for any resource other than Patient.',
    verification: 'Repository search for resourceType.',
  },
  {
    id: 'IO-06',
    category: 'interoperability',
    title: 'Terminology and coding',
    requirement:
      'Diagnoses, medicines, laboratory tests and procedures use agreed code systems with mappings.',
    module: 'Partial — ICD-10 text only',
    status: 'PARTIAL',
    severity: 'high',
    evidence:
      'ICD-10 codes are captured as free text in the public-health form; no KNHTS, LOINC or ATC mapping table exists.',
    verification: 'Schema and form inspection.',
    externalDependency: 'KNHTS release files and the DHA terminology service.',
  },
  {
    id: 'IO-07',
    category: 'interoperability',
    title: 'Integration reliability',
    requirement: 'Integrations have timeouts, retries, idempotency, logging and reconciliation.',
    module: 'src/integrations/dha/dha.client.ts',
    status: 'PARTIAL',
    severity: 'medium',
    evidence:
      'Timeout and retry settings (DHA_TIMEOUT_MS, DHA_MAX_RETRIES); structured errors; readiness probe',
    verification:
      'Code inspection. No outbound message store, idempotency key or reconciliation job.',
  },
  {
    id: 'IO-08',
    category: 'interoperability',
    title: 'SDMX / statistical exchange',
    requirement:
      'Statistical exchange is implemented only where a reporting requirement demands it.',
    module: 'Not applicable',
    status: 'NOT_APPLICABLE',
    severity: 'low',
    evidence: 'No supplied DHA requirement or specification calls for SDMX in this deployment.',
    verification: 'The audit did not invent a standard to raise a score.',
    note: 'Re-open if the certification scope names SDMX explicitly.',
  },
] as const);

export function requirementsByCategory(category: RequirementCategory): DhaRequirement[] {
  return DHA_REQUIREMENTS.filter((item) => item.category === category);
}

export function findRequirement(id: string): DhaRequirement | undefined {
  return DHA_REQUIREMENTS.find((item) => item.id === id);
}
