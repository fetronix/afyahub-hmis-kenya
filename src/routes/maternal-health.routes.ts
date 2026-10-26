/**
 * Maternal and child health.
 *
 * Maternity, deliveries and postnatal care, plus the immunisation record
 * that hangs off them. Both mounts sit behind the `maternity` facility
 * module, so a facility that does not deliver babies cannot call these at
 * all, and each route additionally checks its own permission — the module
 * gate says whether the facility offers the service, the permission says
 * whether this clinician may use it.
 *
 * Moved out of `createApp` unchanged: same paths, same middleware, same
 * order of checks, same error handling. The paths below are relative
 * because the router is mounted at `/api`, which is the same prefix the
 * routes carried when they were registered directly on the app.
 */

import { Router, type Response } from 'express';

import type { AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import * as immunisation from '../immunisation/immunisation.service.ts';
import * as maternity from '../maternity/maternity.service.ts';
import * as postnatal from '../maternity/postnatal.service.ts';
import { handleImmunisationError, handleMaternityError } from './shared/errors.ts';
import { billingServiceKeys } from '../billing/tariff-codes.ts';
import { codesForFamily } from '../billing/tariff-matching.ts';
import { chargeSafely } from './shared/charges.ts';
import { parseOptionalPositiveId, requireAuthContext } from './shared/request.ts';

const router = Router();

// =========================================================
// MATERNITY / MCH
// =========================================================
//
// The module gate sits on the mount, the permission on the route.
// A facility that does not deliver babies turns the module off; a
// clinician who may not record a delivery is stopped by the code.
// =========================================================

router.get(
  '/maternity/summary',
  requirePermission('maternity.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const facilityId = parseOptionalPositiveId(req.query.facilityId, 'facility ID');

      const summary = await maternity.maternitySummary(context, facilityId);

      res.json(summary);
    } catch (err: unknown) {
      if (handleMaternityError(err, res)) return;

      console.error('Maternity summary error:', err);
      res.status(500).json({
        success: false,
        error: 'MATERNITY_SUMMARY_FAILED',
        message: 'The maternity summary could not be loaded.',
      });
    }
  },
);

router.get(
  '/maternity/pregnancies',
  requirePermission('maternity.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const facilityId = parseOptionalPositiveId(req.query.facilityId, 'facility ID');
      const patientId = parseOptionalPositiveId(req.query.patientId, 'patient ID');

      const list = await maternity.listPregnancies(context, {
        facilityId,
        patientId,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });

      res.json(list);
    } catch (err: unknown) {
      if (handleMaternityError(err, res)) return;

      console.error('Pregnancy list error:', err);
      res.status(500).json({
        success: false,
        error: 'PREGNANCY_LIST_FAILED',
        message: 'The pregnancy register could not be loaded.',
      });
    }
  },
);

router.post(
  '/maternity/pregnancies',
  requirePermission('maternity.create'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const created = await maternity.bookPregnancy(context, req.body ?? {});

      res.status(201).json(created);
    } catch (err: unknown) {
      if (handleMaternityError(err, res)) return;

      console.error('Pregnancy booking error:', err);
      res.status(500).json({
        success: false,
        error: 'PREGNANCY_BOOKING_FAILED',
        message: 'The pregnancy could not be booked.',
      });
    }
  },
);

router.get(
  '/maternity/pregnancies/:id',
  requirePermission('maternity.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const record = await maternity.getPregnancy(context, Number(req.params.id));

      res.json(record);
    } catch (err: unknown) {
      if (handleMaternityError(err, res)) return;

      console.error('Pregnancy detail error:', err);
      res.status(500).json({
        success: false,
        error: 'PREGNANCY_FETCH_FAILED',
        message: 'The pregnancy record could not be loaded.',
      });
    }
  },
);

router.patch(
  '/maternity/pregnancies/:id',
  requirePermission('maternity.update'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const updated = await maternity.updatePregnancy(
        context,
        Number(req.params.id),
        req.body ?? {},
      );

      res.json(updated);
    } catch (err: unknown) {
      if (handleMaternityError(err, res)) return;

      console.error('Pregnancy update error:', err);
      res.status(500).json({
        success: false,
        error: 'PREGNANCY_UPDATE_FAILED',
        message: 'The pregnancy record could not be updated.',
      });
    }
  },
);

router.get(
  '/maternity/pregnancies/:id/anc-visits',
  requirePermission('maternity.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const visits = await maternity.listAncVisits(context, Number(req.params.id));

      res.json(visits);
    } catch (err: unknown) {
      if (handleMaternityError(err, res)) return;

      console.error('ANC visit list error:', err);
      res.status(500).json({
        success: false,
        error: 'ANC_VISIT_LIST_FAILED',
        message: 'The antenatal visits could not be loaded.',
      });
    }
  },
);

router.post(
  '/maternity/anc-visits',
  requirePermission('maternity.create'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const created = await maternity.recordAncVisit(context, req.body ?? {});

      res.status(201).json(created);
    } catch (err: unknown) {
      if (handleMaternityError(err, res)) return;

      console.error('ANC visit creation error:', err);
      res.status(500).json({
        success: false,
        error: 'ANC_VISIT_CREATION_FAILED',
        message: 'The antenatal visit could not be recorded.',
      });
    }
  },
);

router.get(
  '/maternity/labours',
  requirePermission('maternity.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const facilityId = parseOptionalPositiveId(req.query.facilityId, 'facility ID');

      const list = await maternity.listLabours(context, {
        facilityId,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
      });

      res.json(list);
    } catch (err: unknown) {
      if (handleMaternityError(err, res)) return;

      console.error('Labour list error:', err);
      res.status(500).json({
        success: false,
        error: 'LABOUR_LIST_FAILED',
        message: 'The labour board could not be loaded.',
      });
    }
  },
);

router.post(
  '/maternity/labours',
  requirePermission('maternity.create'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const created = await maternity.startLabour(context, req.body ?? {});

      res.status(201).json(created);
    } catch (err: unknown) {
      if (handleMaternityError(err, res)) return;

      console.error('Labour start error:', err);
      res.status(500).json({
        success: false,
        error: 'LABOUR_START_FAILED',
        message: 'The labour record could not be opened.',
      });
    }
  },
);

router.get(
  '/maternity/labours/:id',
  requirePermission('maternity.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const record = await maternity.getLabour(context, Number(req.params.id));

      res.json(record);
    } catch (err: unknown) {
      if (handleMaternityError(err, res)) return;

      console.error('Labour detail error:', err);
      res.status(500).json({
        success: false,
        error: 'LABOUR_FETCH_FAILED',
        message: 'The labour record could not be loaded.',
      });
    }
  },
);

router.patch(
  '/maternity/labours/:id',
  requirePermission('maternity.update'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const updated = await maternity.updateLabour(context, Number(req.params.id), req.body ?? {});

      res.json(updated);
    } catch (err: unknown) {
      if (handleMaternityError(err, res)) return;

      console.error('Labour update error:', err);
      res.status(500).json({
        success: false,
        error: 'LABOUR_UPDATE_FAILED',
        message: 'The labour record could not be updated.',
      });
    }
  },
);

router.post(
  '/maternity/partograph',
  requirePermission('maternity.create'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const created = await maternity.recordPartographEntry(context, req.body ?? {});

      res.status(201).json(created);
    } catch (err: unknown) {
      if (handleMaternityError(err, res)) return;

      console.error('Partograph entry error:', err);
      res.status(500).json({
        success: false,
        error: 'PARTOGRAPH_ENTRY_FAILED',
        message: 'The partograph reading could not be recorded.',
      });
    }
  },
);

router.get(
  '/maternity/deliveries',
  requirePermission('maternity.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const facilityId = parseOptionalPositiveId(req.query.facilityId, 'facility ID');

      const list = await maternity.listDeliveries(context, {
        facilityId,
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        to: typeof req.query.to === 'string' ? req.query.to : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });

      res.json(list);
    } catch (err: unknown) {
      if (handleMaternityError(err, res)) return;

      console.error('Delivery list error:', err);
      res.status(500).json({
        success: false,
        error: 'DELIVERY_LIST_FAILED',
        message: 'The delivery register could not be loaded.',
      });
    }
  },
);

router.post(
  '/maternity/deliveries',
  requirePermission('maternity.update'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const created = await maternity.recordDelivery(context, req.body ?? {});

      /*
       * A delivery is a billable event, and until now it raised nothing.
       *
       * The price comes from `facility_service_tariffs` and nowhere else.
       * No fallback price is passed, so a facility with no delivery tariff
       * gets `charged: false, reason: 'TARIFF_NOT_CONFIGURED'` and the UI
       * says so. It does not invent a number to fill the invoice.
       *
       * One charge per delivery, not per baby: twins are one delivery with
       * two babies, and the tariff is for the delivery.
       */
      const charge = await chargeSafely({
        tenantId: created.delivery.tenantId,
        facilityId: created.delivery.facilityId,
        patientId: created.delivery.patientId,
        encounterId: null,
        codes: codesForFamily({
          family: 'DELIVERY',
          name: created.delivery.deliveryMode,
        }),
        serviceKeys: billingServiceKeys('DELIVERY', [created.delivery.deliveryMode]),
        family: 'DELIVERY',
        serviceName: 'delivery',
        aliases: [created.delivery.deliveryMode],
        sourceType: 'MATERNITY',
        sourceId: created.delivery.id,
        itemType: 'Maternity',
        description: `Delivery — ${created.delivery.deliveryMode}`,
      });

      res.status(201).json({ ...created, billing: charge });
    } catch (err: unknown) {
      if (handleMaternityError(err, res)) return;

      console.error('Delivery creation error:', err);
      res.status(500).json({
        success: false,
        error: 'DELIVERY_CREATION_FAILED',
        message: 'The delivery could not be recorded.',
      });
    }
  },
);

router.get(
  '/maternity/deliveries/:id',
  requirePermission('maternity.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const record = await maternity.getDelivery(context, Number(req.params.id));

      res.json(record);
    } catch (err: unknown) {
      if (handleMaternityError(err, res)) return;

      console.error('Delivery detail error:', err);
      res.status(500).json({
        success: false,
        error: 'DELIVERY_FETCH_FAILED',
        message: 'The delivery record could not be loaded.',
      });
    }
  },
);

// =========================================================
// POSTNATAL CARE
//
// Six weeks of contacts after a delivery, hung off the pregnancy so a
// woman who delivered elsewhere still has a record here.
// =========================================================

router.get(
  '/maternity/postnatal',
  requirePermission('maternity.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const facilityId = parseOptionalPositiveId(req.query.facilityId, 'facility ID');

      const list = await postnatal.listPostnatalVisitsForFacility(context, facilityId);

      res.json(list);
    } catch (err: unknown) {
      if (handleMaternityError(err, res)) return;

      console.error('Postnatal register error:', err);
      res.status(500).json({
        success: false,
        error: 'POSTNATAL_LIST_FAILED',
        message: 'The postnatal register could not be loaded.',
      });
    }
  },
);

router.get(
  '/maternity/pregnancies/:id/postnatal',
  requirePermission('maternity.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const visits = await postnatal.listPostnatalVisits(context, Number(req.params.id));

      res.json(visits);
    } catch (err: unknown) {
      if (handleMaternityError(err, res)) return;

      console.error('Postnatal visit list error:', err);
      res.status(500).json({
        success: false,
        error: 'POSTNATAL_VISITS_FAILED',
        message: 'The postnatal visits could not be loaded.',
      });
    }
  },
);

router.post(
  '/maternity/postnatal',
  requirePermission('maternity.create'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const created = await postnatal.recordPostnatalVisit(context, req.body ?? {});

      res.status(201).json(created);
    } catch (err: unknown) {
      if (handleMaternityError(err, res)) return;

      console.error('Postnatal visit creation error:', err);
      res.status(500).json({
        success: false,
        error: 'POSTNATAL_CREATION_FAILED',
        message: 'The postnatal visit could not be recorded.',
      });
    }
  },
);

// =========================================================
// IMMUNISATION
//
// The schedule is in `immunisation-contracts.ts`; this is the record
// of what was given. Mounted under the maternity module (see the gate
// at the top of this file).
// =========================================================

/*
 * The reference schedule, straight from the module that computes
 * against it. The screen reads its antigen list from here rather than
 * carrying a second copy that would drift the first time a dose is
 * added.
 */
router.get(
  '/immunisation/schedule',
  requirePermission('maternity.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    res.json({
      antigens: immunisation.ANTIGENS,
      note: immunisation.SCHEDULE_AGREES_NOTE,
    });
  },
);

router.get(
  '/immunisation/card',
  requirePermission('maternity.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const patientId = parseOptionalPositiveId(req.query.patientId, 'patient ID');

      if (!patientId) {
        res.status(400).json({
          success: false,
          error: 'PATIENT_REQUIRED',
          message: 'A valid patientId is required.',
        });

        return;
      }

      const card = await immunisation.immunisationCard(context, patientId);

      res.json(card);
    } catch (err: unknown) {
      if (handleImmunisationError(err, res)) return;

      console.error('Immunisation card error:', err);
      res.status(500).json({
        success: false,
        error: 'IMMUNISATION_CARD_FAILED',
        message: 'The immunisation card could not be loaded.',
      });
    }
  },
);

router.get(
  '/immunisation/records',
  requirePermission('maternity.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const patientId = parseOptionalPositiveId(req.query.patientId, 'patient ID');

      if (!patientId) {
        res.status(400).json({
          success: false,
          error: 'PATIENT_REQUIRED',
          message: 'A valid patientId is required.',
        });

        return;
      }

      const records = await immunisation.listImmunisationRecords(context, patientId);

      res.json(records);
    } catch (err: unknown) {
      if (handleImmunisationError(err, res)) return;

      console.error('Immunisation record list error:', err);
      res.status(500).json({
        success: false,
        error: 'IMMUNISATION_RECORDS_FAILED',
        message: 'The immunisation records could not be loaded.',
      });
    }
  },
);

router.post(
  '/immunisation/records',
  requirePermission('maternity.create'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const created = await immunisation.recordImmunisation(context, req.body ?? {});

      res.status(201).json(created);
    } catch (err: unknown) {
      if (handleImmunisationError(err, res)) return;

      console.error('Immunisation record error:', err);
      res.status(500).json({
        success: false,
        error: 'IMMUNISATION_CREATION_FAILED',
        message: 'The dose could not be recorded.',
      });
    }
  },
);

router.get(
  '/immunisation/due',
  requirePermission('maternity.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const facilityId = parseOptionalPositiveId(req.query.facilityId, 'facility ID');

      const list = await immunisation.immunisationDueList(context, facilityId);

      res.json(list);
    } catch (err: unknown) {
      if (handleImmunisationError(err, res)) return;

      console.error('Immunisation due list error:', err);
      res.status(500).json({
        success: false,
        error: 'IMMUNISATION_DUE_FAILED',
        message: 'The immunisation list could not be loaded.',
      });
    }
  },
);

export default router;
