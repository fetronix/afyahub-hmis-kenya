/**
 * JaliCare HMIS — Backward-Compatible Frontend API Client Facade
 *
 * Domain clients live under `src/api/clients/`:
 *   - `http.ts` — shared session token storage, `ApiError`, and hardened `fetchJson`
 *   - `auth.client.ts` — login, session validation, logout, RBAC, subscriptions
 *   - `platform.client.ts` — health, tenants, facilities, public health, analytics, DHA
 *   - `patients-clinical.client.ts` — patients, consent, allergies, encounters, queues, vitals, meds
 *   - `maternity.client.ts` — ANC, labour, partograph, deliveries, postnatal, immunisation
 *   - `inpatient.client.ts` — wards, beds, admissions, nursing care, handover, theatre
 *   - `diagnostics-pharmacy.client.ts` — laboratory, radiology, pharmacy FEFO batches, procurement
 *   - `billing.client.ts` — invoices, tariffs, charge attempts, payments, insurance claims
 *
 * Existing imports from `src/api/client.ts` continue to work without modification.
 */

export {
  API_BASE,
  ApiError,
  type ApiErrorResponse,
  type ServiceCharge,
  clearSessionToken,
  fetchJson,
  getSessionToken,
  hasSessionToken,
  onUnauthorizedSession,
  setSessionToken,
} from './clients/http.ts';

export {
  authClient,
  type AuthenticatedUser,
  type LoginResponse,
  type RbacCatalogueApplyResult,
  type RbacCatalogueCoverage,
  type RbacCatalogueRole,
  type RbacPermission,
  type RbacRole,
  type RbacRolesResponse,
  type SessionResponse,
} from './clients/auth.client.ts';

export { platformClient } from './clients/platform.client.ts';

export {
  patientsClinicalClient,
  type AllergyCheckResult,
  type AllergyWarning,
  type PatientAllergy,
  type PatientConsent,
} from './clients/patients-clinical.client.ts';

export {
  maternityClient,
  type AncVisit,
  type DeliveryBaby,
  type DeliveryRecord,
  type GestationSummary,
  type ImmunisationAntigen,
  type ImmunisationCard,
  type ImmunisationDoseStatus,
  type ImmunisationDueRow,
  type ImmunisationRecord,
  type LabourRecord,
  type MaternityPatientRef,
  type MaternityPregnancy,
  type MaternityPregnancyDetail,
  type MaternitySummary,
  type PartographEntry,
  type PartographGuidance,
  type PartographLine,
  type PartographPlot,
  type PlottedReading,
  type PostnatalVisit,
} from './clients/maternity.client.ts';

export { inpatientClient } from './clients/inpatient.client.ts';
export { theatreClient } from './clients/theatre.client.ts';
export { diagnosticsPharmacyClient } from './clients/diagnostics-pharmacy.client.ts';
export { billingClient } from './clients/billing.client.ts';

import { authClient } from './clients/auth.client.ts';
import { billingClient } from './clients/billing.client.ts';
import { diagnosticsPharmacyClient } from './clients/diagnostics-pharmacy.client.ts';
import { inpatientClient } from './clients/inpatient.client.ts';
import { theatreClient } from './clients/theatre.client.ts';
import { maternityClient } from './clients/maternity.client.ts';
import { patientsClinicalClient } from './clients/patients-clinical.client.ts';
import { platformClient } from './clients/platform.client.ts';

export const api = {
  ...authClient,
  ...platformClient,
  ...patientsClinicalClient,
  ...maternityClient,
  ...inpatientClient,
  ...theatreClient,
  ...diagnosticsPharmacyClient,
  ...billingClient,
};
