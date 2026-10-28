/**
 * JaliCare HMIS — Maternity / MCH Service Facade
 *
 * Domain workflows live under `src/maternity/services/`:
 *   - `shared.ts` — domain error, scope guards, input/date helpers
 *   - `pregnancy.service.ts` — booking, listing, detail, closure/update
 *   - `anc.service.ts` — antenatal visit recording & listing
 *   - `labour.service.ts` — labour admission, partograph readings & chart plot
 *   - `delivery.service.ts` — delivery recording, newborn records & summary KPIs
 */

export {
  BABY_OUTCOMES,
  DELIVERY_MODES,
  LIQUORS,
  MEMBRANES,
  PERINEUM_STATES,
  PREGNANCY_STATUSES,
  PRESENTATIONS,
  URINE_DIPSTICK,
  deriveEdd,
  gestationAt,
  partographGuidance,
} from './maternity-contracts.ts';

export { MaternityDomainError, resolvePregnancy } from './services/shared.ts';

export {
  bookPregnancy,
  getPregnancy,
  listPregnancies,
  updatePregnancy,
  type BookPregnancyInput,
  type PregnancyListQuery,
  type UpdatePregnancyInput,
} from './services/pregnancy.service.ts';

export { listAncVisits, recordAncVisit, type AncVisitInput } from './services/anc.service.ts';

export {
  getLabour,
  listLabours,
  recordPartographEntry,
  startLabour,
  updateLabour,
  type PartographInput,
  type StartLabourInput,
  type UpdateLabourInput,
} from './services/labour.service.ts';

export {
  getDelivery,
  listDeliveries,
  maternitySummary,
  recordDelivery,
  type DeliveryBabyInput,
  type RecordDeliveryInput,
} from './services/delivery.service.ts';
