/**
 * The API surface, mounted.
 *
 * Everything that lives under `/api` *after* authentication: the facility
 * module gates, the administrator routers, and one router per clinical
 * domain. `src/app.ts` builds the server - security headers, body limits,
 * the pre-authentication mounts, `requireAuth` and `requireAuthorization` -
 * and then hands the API to this function.
 *
 * ORDER MATTERS, and it is the order these mounts had when they were
 * written inline in `createApp`:
 *
 *   1. The module gates. A facility that has not enabled `inpatient`
 *      cannot reach a ward route because the gate runs before the router
 *      does. Gates are registered per prefix, so `/api/medications` gets
 *      three of them - one per method - because the pharmacy and OPD
 *      modules gate it differently.
 *   2. The administrator routers: platform, staff invitations, staff roles,
 *      facility-module provisioning, compliance.
 *   3. The clinical domains.
 *
 * `facility-modules` is deliberately mounted outside the gates: it is the
 * route that turns those gates on and off, so it cannot require a module to
 * be enabled in order to run.
 *
 * Nothing here authenticates. `requireAuth` and `requireAuthorization` are
 * mounted on `/api` in `app.ts` before this router, so every route below is
 * already behind them.
 */

import { Router } from 'express';

import complianceRoutes from '../compliance/compliance.routes.ts';
import facilityModuleRoutes from '../config/facility-modules.routes.ts';
import clinicalRecordsRoutes from '../clinical/clinical-records.routes.ts';
import staffInvitationRoutes from '../auth/staff-invitation.routes.ts';
import staffRolesRoutes from '../auth/staff-roles.routes.ts';
import { requireFacilityModule } from '../middleware/facility-module.middleware.ts';
import queuesRoutes from './queues.routes.ts';
import appointmentsRoutes from './appointments.routes.ts';
import vitalsRoutes from './vitals.routes.ts';
import diagnosesRoutes from './diagnoses.routes.ts';
import medicationsRoutes from './medications.routes.ts';
import theatreRoutes from './theatre.routes.ts';
import laboratoryRoutes from './laboratory.routes.ts';
import radiologyRoutes from './radiology.routes.ts';
import pharmacyRoutes from './pharmacy.routes.ts';
import procurementRoutes from './procurement.routes.ts';
import serviceTariffsRoutes from './service-tariffs.routes.ts';
import billingRoutes from './billing.routes.ts';
import dhaRoutes from './dha.routes.ts';
import inpatientRoutes from './inpatient.routes.ts';
import maternalHealthRoutes from './maternal-health.routes.ts';
import platformRoutes from './platform.routes.ts';

import auditRoutes from './domains/audit.routes.ts';
import billingAnalyticsRoutes from './domains/billing-analytics.routes.ts';
import billingChargesRoutes from './domains/billing-charges.routes.ts';
import claimsRoutes from './domains/claims.routes.ts';
import encountersRoutes from './domains/encounters.routes.ts';
import interopRoutes from './domains/interop.routes.ts';
import invoicesRoutes from './domains/invoices.routes.ts';
import patientsRoutes from './domains/patients.routes.ts';
import publicHealthRoutes from './domains/public-health.routes.ts';
import serviceTariffLinksRoutes from './domains/service-tariff-links.routes.ts';
import tenancyRoutes from './domains/tenancy.routes.ts';

export function createApiRoutes(): Router {
  const api = Router();

  api.use('/platform', platformRoutes);
  api.use('/staff-invitations', staffInvitationRoutes);
  api.use('/staff-roles', staffRolesRoutes);

  /*
   * Facility module provisioning. Deliberately outside the
   * `requireFacilityModule` guards: this is the route that turns those
   * guards on and off, so it cannot depend on a module being enabled.
   */
  api.use('/facilities', facilityModuleRoutes);

  /*
   * DHA self-assessment. Read-only and compiled from the register, so the
   * figure cannot be edited in the browser or stored out of date.
   */
  api.use('/compliance', complianceRoutes);

  // Facility module enforcement. Keep platform administration, invitations,
  // tenants, and facility-context endpoints outside these operational guards.
  api.use('/patients', requireFacilityModule('registration'));

  /*
   * Consent and allergy records live under the patient they belong to.
   * Mounted after the module guard, so a facility without registration
   * enabled cannot reach them either.
   */
  api.use('/patients', clinicalRecordsRoutes);
  api.use('/appointments', requireFacilityModule('reception'));
  api.use('/queues', requireFacilityModule('reception'));

  api.use('/encounters', requireFacilityModule('opd'));
  api.use('/observations', requireFacilityModule('opd'));
  api.use('/diagnoses', requireFacilityModule('opd'));
  api.use('/procedures', requireFacilityModule('opd'));

  api.use('/maternity', requireFacilityModule('maternity'));

  /*
   * Immunisation rides on the maternity module on purpose: in Kenya the
   * doses are given in the MCH clinic, on the same visit as the mother's
   * postnatal check. A second module switch would let a facility open the
   * child register while the mother's record stayed closed.
   */
  api.use('/immunisation', requireFacilityModule('maternity'));

  api.use('/wards', requireFacilityModule('inpatient'));
  api.use('/beds', requireFacilityModule('inpatient'));
  api.use('/admissions', requireFacilityModule('inpatient'));
  api.use('/inpatient', requireFacilityModule('inpatient'));
  api.use('/nursing-notes', requireFacilityModule('inpatient'));
  api.use('/theatre-cases', requireFacilityModule('theatre'));

  api.use('/lab-tests', requireFacilityModule('laboratory'));
  api.use('/lab-orders', requireFacilityModule('laboratory'));
  api.use('/lab-results', requireFacilityModule('laboratory'));
  api.use('/radiology-orders', requireFacilityModule('radiology'));

  api.get('/medications', requireFacilityModule('pharmacy'));
  api.post('/medications', requireFacilityModule('opd'));
  api.put('/medications/:id/status', requireFacilityModule('pharmacy'));
  api.use('/pharmacy', requireFacilityModule('pharmacy'));
  api.use('/inventory', requireFacilityModule('inventory'));

  api.use('/suppliers', requireFacilityModule('procurement'));
  api.use('/purchase-orders', requireFacilityModule('procurement'));

  api.use('/claims', requireFacilityModule('insurance'));
  api.use('/integrations', requireFacilityModule('interoperability'));
  api.use('/public-health', requireFacilityModule('public_health'));
  api.use('/analytics', requireFacilityModule('analytics'));
  api.use('/reporting', requireFacilityModule('analytics'));
  api.use('/interoperability', requireFacilityModule('interoperability'));
  api.use('/audit-logs', requireFacilityModule('audit'));

  /*
   * Clinical domains that already had their own routers before this file
   * existed. They register absolute paths under their own prefixes, so they
   * mount at the router root rather than at a prefix.
   */
  api.use(maternalHealthRoutes);
  api.use(inpatientRoutes);
  api.use(dhaRoutes);
  api.use(billingRoutes);
  api.use(serviceTariffsRoutes);
  api.use(procurementRoutes);
  api.use(pharmacyRoutes);
  api.use(radiologyRoutes);
  api.use(laboratoryRoutes);
  api.use(theatreRoutes);
  api.use(medicationsRoutes);
  api.use(diagnosesRoutes);
  api.use(vitalsRoutes);
  api.use(appointmentsRoutes);
  api.use(queuesRoutes);

  /*
   * The domains that used to be registered inline in `createApp`.
   *
   * They mount last, and that is deliberate: they come after the module
   * gates above, which is the order they had when `app.use('/api', ...)`
   * handed them to the api router and the gates fell through to them.
   *
   * They also register absolute `/api/...` paths like the routers above, so
   * they mount at the router root rather than at a prefix.
   */
  api.use(tenancyRoutes);
  api.use(patientsRoutes);
  api.use(encountersRoutes);
  api.use(billingChargesRoutes);
  api.use(serviceTariffLinksRoutes);
  api.use(billingAnalyticsRoutes);
  api.use(claimsRoutes);
  api.use(invoicesRoutes);
  api.use(publicHealthRoutes);
  api.use(auditRoutes);
  api.use(interopRoutes);
  return api;
}
