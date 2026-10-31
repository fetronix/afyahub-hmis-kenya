/**
 * Inpatient care: wards, beds, admissions, transfers, discharge and the
 * nursing record.
 *
 * These twenty-two routes sat inside `createApp` interleaved with the
 * prescriptions section, under a banner that had been pasted twice and
 * named only part of what followed it. They are pulled out together
 * because they share one facility-module gate (`inpatient`) and one set of
 * rules about occupancy, so a change to any of them is really a change to
 * all of them.
 *
 * The rules that matter here, unchanged by the move:
 *
 *   - Tenant and facility scope come from `req.authContext`. A tenantId or
 *     facilityId supplied by the client is never trusted for scoping.
 *   - Occupancy is created only by admitting a patient and released only
 *     by discharging one, so a bed's status cannot be forged by writing to
 *     it directly.
 *   - Bed-day charges accrue through `accrueBedDaysScoped`, which is
 *     idempotent: running it repeatedly bills each night once, so a
 *     scheduled job and a discharge cannot both bill the same night.
 *
 * Paths are relative because the router is mounted at `/api`.
 */

import { Router, type Response } from 'express';

import type { AuthRequest } from '../auth/auth.middleware.ts';
import { requireAnyPermission, requirePermission } from '../auth/authorization.middleware.ts';
import { eq } from 'drizzle-orm';

import * as billing from '../billing/billing.service.ts';
import { billingServiceKeys } from '../billing/tariff-codes.ts';
import { codesForFamily } from '../billing/tariff-matching.ts';
import { db } from '../db/index.ts';
import * as queries from '../db/queries.ts';
import * as schema from '../db/schema.ts';
import * as wardBed from '../inpatient/ward-bed.service.ts';
import * as nursing from '../nursing/nursing.service.ts';
import { chargeSafely } from './shared/charges.ts';
import { admissionChargeRequest } from '../billing/service-charges.ts';
import { handleInpatientError } from './shared/errors.ts';
import { parseOptionalPositiveId, requireAuthContext } from './shared/request.ts';

const router = Router();

// =========================================================
// INPATIENT: WARDS, BEDS AND ADMISSIONS
// =========================================================
//
// Tenant and facility scope are derived from req.authContext.
// Client-supplied tenantId / facilityId are never trusted.
//
// Occupancy is created only by admitting a patient and released
// only by discharging one, so bed status cannot forge a bed.

router.get(
  '/wards',
  requirePermission('inpatient.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const facilityId = parseOptionalPositiveId(req.query.facilityId, 'facility ID');

      const list = await queries.getWardsScoped(context, facilityId);

      res.json(list);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Ward list error:', err);
      res.status(500).json({
        success: false,
        error: 'WARD_LIST_FAILED',
      });
    }
  },
);

/*
 * Ward set-up.
 *
 * The board was read-only before this: wards could only exist if the
 * demo seed had been run, so a real facility had an empty dropdown and
 * nowhere to fill it from. These are the write paths, each with its
 * own permission so a facility can decide who configures the ward
 * while keeping admission rights separate.
 */
router.post(
  '/wards',
  requirePermission('inpatient.wards.create'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const created = await wardBed.createWard(context, req.body ?? {});

      await queries.logAuditEvent(
        context.tenantId,
        context.facilityId,
        String(context.userId),
        'CREATE',
        'Ward',
        String(created.id),
        `Created ward ${created.code} — ${created.name}`,
      );

      res.status(201).json(created);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Ward creation error:', err);
      res.status(500).json({
        success: false,
        error: 'WARD_CREATION_FAILED',
      });
    }
  },
);

router.put(
  '/wards/:id',
  requirePermission('inpatient.wards.update'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const updated = await wardBed.updateWard(context, req.params.id, req.body ?? {});

      await queries.logAuditEvent(
        context.tenantId,
        context.facilityId,
        String(context.userId),
        'UPDATE',
        'Ward',
        String(updated.id),
        `Updated ward ${updated.code}`,
      );

      res.json(updated);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Ward update error:', err);
      res.status(500).json({
        success: false,
        error: 'WARD_UPDATE_FAILED',
      });
    }
  },
);

router.delete(
  '/wards/:id',
  requirePermission('inpatient.wards.delete'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const result = await wardBed.deleteWard(context, req.params.id);

      await queries.logAuditEvent(
        context.tenantId,
        context.facilityId,
        String(context.userId),
        'DELETE',
        'Ward',
        String(result.wardId),
        `Deleted unused ward ${result.code}`,
      );

      res.json(result);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Ward deletion error:', err);
      res.status(500).json({
        success: false,
        error: 'WARD_DELETION_FAILED',
      });
    }
  },
);

/*
 * Bed set-up. Beds are created in a batch because a ward is set up in
 * one sitting: a prefix, a first number and a count, or an explicit
 * list of numbers.
 */
router.post(
  '/beds',
  requirePermission('inpatient.beds.create'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const result = await wardBed.createBeds(context, req.body ?? {});

      await queries.logAuditEvent(
        context.tenantId,
        context.facilityId,
        String(context.userId),
        'CREATE',
        'Bed',
        String(result.wardId),
        `Added ${result.totalBeds} bed(s) to ward ${result.wardId}`,
      );

      res.status(201).json(result);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Bed creation error:', err);
      res.status(500).json({
        success: false,
        error: 'BED_CREATION_FAILED',
      });
    }
  },
);

router.put(
  '/beds/:id',
  requirePermission('inpatient.beds.update'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const updated = await wardBed.updateBed(context, req.params.id, req.body ?? {});

      await queries.logAuditEvent(
        context.tenantId,
        context.facilityId,
        String(context.userId),
        'UPDATE',
        'Bed',
        String(updated.id),
        `Updated bed ${updated.bedNumber}`,
      );

      res.json(updated);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Bed update error:', err);
      res.status(500).json({
        success: false,
        error: 'BED_UPDATE_FAILED',
      });
    }
  },
);

router.delete(
  '/beds/:id',
  requirePermission('inpatient.beds.delete'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const result = await wardBed.deleteBed(context, req.params.id);

      await queries.logAuditEvent(
        context.tenantId,
        context.facilityId,
        String(context.userId),
        'DELETE',
        'Bed',
        String(result.bedId),
        `Deleted unused bed ${result.bedNumber}`,
      );

      res.json(result);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Bed deletion error:', err);
      res.status(500).json({
        success: false,
        error: 'BED_DELETION_FAILED',
      });
    }
  },
);

router.get(
  '/beds',
  requirePermission('inpatient.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const wardId = parseOptionalPositiveId(req.query.wardId, 'ward ID');

      const list = await queries.getBedsScoped(context, wardId);

      res.json(list);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Bed list error:', err);
      res.status(500).json({
        success: false,
        error: 'BED_LIST_FAILED',
      });
    }
  },
);

/*
 * Change a bed's housekeeping status.
 *
 * 'Occupied' is rejected by the query layer: occupancy must come
 * from an admission. A bed holding a patient cannot be changed
 * until that patient is discharged or transferred.
 */
router.put(
  '/beds/:id/status',
  requirePermission('inpatient.admit'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const bed = await queries.setBedStatusScoped(
        context,
        Number(req.params.id),
        req.body?.status,
      );

      await queries.logAuditEvent(
        context.tenantId,
        context.facilityId,
        String(context.userId),
        'UPDATE',
        'Bed',
        String(bed?.id ?? req.params.id),
        `Bed status set to ${String(req.body?.status)}`,
      );

      res.json(bed);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Bed status update error:', err);
      res.status(500).json({
        success: false,
        error: 'BED_STATUS_UPDATE_FAILED',
      });
    }
  },
);

/*
 * Release a cleaned bed back into service (Cleaning -> Available).
 *
 * Without this, every discharge permanently removes a bed from the
 * usable board because nothing else restores 'Available'.
 */
router.put(
  '/beds/:id/release',
  requirePermission('inpatient.admit'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const bed = await queries.releaseBedScoped(context, Number(req.params.id));

      await queries.logAuditEvent(
        context.tenantId,
        context.facilityId,
        String(context.userId),
        'UPDATE',
        'Bed',
        String(bed?.id ?? req.params.id),
        'Bed released to Available after terminal cleaning',
      );

      res.json(bed);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Bed release error:', err);
      res.status(500).json({
        success: false,
        error: 'BED_RELEASE_FAILED',
      });
    }
  },
);

router.get(
  '/admissions',
  requirePermission('inpatient.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const facilityId = parseOptionalPositiveId(req.query.facilityId, 'facility ID');

      const status = typeof req.query.status === 'string' ? req.query.status : undefined;

      const list = await queries.getAdmissionsScoped(context, facilityId, status);

      res.json(list);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Admission list error:', err);
      res.status(500).json({
        success: false,
        error: 'ADMISSION_LIST_FAILED',
      });
    }
  },
);

router.post(
  '/admissions',
  requirePermission('inpatient.admit'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const admission = await queries.createAdmissionScoped(context, req.body ?? {});

      const charge = await chargeSafely(admissionChargeRequest(admission));

      res.status(201).json({ ...admission, billing: charge });
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Admission creation error:', err);
      res.status(500).json({
        success: false,
        error: 'ADMISSION_CREATION_FAILED',
      });
    }
  },
);

router.post(
  '/admissions/:id/discharge',
  requirePermission('inpatient.discharge'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const admission = await queries.dischargeAdmissionScoped(
        context,
        Number(req.params.id),
        req.body ?? {},
      );

      /*
       * Bill the stay through the one bed-day engine.
       *
       * Discharge does not have its own billing loop: it closes the
       * occupancy, then asks the same accrual that transfers and the
       * nightly job use for the nights. Every night is keyed
       * BED_DAY:<admissionId>:<date>, so re-running this — or a job
       * that already billed last week — adds nothing.
       *
       * A missing tariff leaves the night unpriced and reported; it
       * never rolls back the discharge or the bed's Cleaning status.
       */
      const accrual = await queries.accrueBedDaysScoped(context, admission.id);

      res.json({
        ...admission,
        billing: {
          nights: accrual.nights,
          bedDays: accrual.charges,
        },
      });
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Discharge error:', err);
      res.status(500).json({
        success: false,
        error: 'DISCHARGE_FAILED',
      });
    }
  },
);

// =========================================================
// INPATIENT EXTRAS: TRANSFER, BED-DAYS, NURSING NOTES
// =========================================================

router.post(
  '/admissions/:id/transfer',
  requirePermission('inpatient.admit'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const { admission, transfer } = await queries.transferAdmissionScoped(
        context,
        Number(req.params.id),
        {
          toWardId: req.body?.toWardId,
          toBedId: req.body?.toBedId,
          reason: req.body?.reason,
          transferredBy:
            typeof req.body?.transferredBy === 'string'
              ? req.body.transferredBy
              : (req.user?.fullName ?? 'Unknown'),
        },
      );

      /*
       * Close the departing ward's bed-day segment using the OLD ward
       * rate, so a stay that moves between wards is not re-priced.
       */
      const accrual = await queries.accrueBedDaysScoped(context, admission.id);

      res.json({ admission, transfer, billing: accrual });
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Admission transfer error:', err);
      res.status(500).json({
        success: false,
        error: 'ADMISSION_TRANSFER_FAILED',
      });
    }
  },
);

router.get(
  '/admissions/:id/transfers',
  requirePermission('inpatient.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const list = await queries.getAdmissionTransfersScoped(context, Number(req.params.id));

      res.json(list);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Admission transfer list error:', err);
      res.status(500).json({
        success: false,
        error: 'ADMISSION_TRANSFERS_FETCH_FAILED',
      });
    }
  },
);

/**
 * Accrue bed-day charges on demand.
 *
 * Called by discharge and transfer. Exposed so a scheduled job can
 * bill long stays without waiting for discharge — it is idempotent,
 * so running it repeatedly bills each night once.
 */
router.post(
  '/admissions/:id/accrue-bed-days',
  requirePermission('billing.create'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const accrual = await queries.accrueBedDaysScoped(
        context,
        Number(req.params.id),
        typeof req.body?.untilDate === 'string' ? req.body.untilDate : undefined,
      );

      res.json(accrual);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Bed-day accrual error:', err);
      res.status(500).json({
        success: false,
        error: 'BED_DAY_ACCRUAL_FAILED',
      });
    }
  },
);

/**
 * Ward board: occupancy, per-admission vitals status and note counts.
 * One scoped call so the ward screen and dashboard do not fan out.
 */
router.get(
  '/inpatient/board',
  requirePermission('inpatient.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const facilityId = parseOptionalPositiveId(req.query.facilityId, 'facility ID');

      const board = await nursing.getInpatientBoardScoped(context, facilityId);

      res.json(board);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Inpatient board error:', err);
      res.status(500).json({
        success: false,
        error: 'INPATIENT_BOARD_FAILED',
      });
    }
  },
);

/**
 * Vitals history for one admission, with abnormality flags derived
 * from adult reference ranges.
 */
router.get(
  '/admissions/:id/vitals',
  requirePermission('inpatient.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const vitals = await nursing.getVitalsForAdmissionScoped(
        context,
        Number(req.params.id),
        req.query.limit ? Number(req.query.limit) : 20,
      );

      res.json(
        vitals.map((observation) => ({
          ...observation,
          flags: nursing.assessVitals(observation),
        })),
      );
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Admission vitals error:', err);
      res.status(500).json({
        success: false,
        error: 'ADMISSION_VITALS_FETCH_FAILED',
      });
    }
  },
);

/**
 * Record ward vitals against an admission.
 *
 * Separate from POST /api/observations so that ward care does not
 * depend on the OPD module being enabled for the facility.
 */
router.post(
  '/admissions/:id/vitals',
  requirePermission('clinical.create'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const observation = await nursing.recordVitalsScoped(context, {
        ...req.body,
        admissionId: Number(req.params.id),
        recordedBy:
          typeof req.body?.recordedBy === 'string'
            ? req.body.recordedBy
            : (req.user?.fullName ?? null),
      });

      await queries.logAuditEvent(
        context.tenantId,
        context.facilityId,
        String(context.userId),
        'CREATE',
        'Observation',
        String(observation.id ?? ''),
        `Ward vitals recorded for admission ${req.params.id}`,
      );

      res.status(201).json(observation);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Ward vitals error:', err);
      res.status(500).json({
        success: false,
        error: 'WARD_VITALS_CREATION_FAILED',
      });
    }
  },
);

/**
 * Shift handover: notes for a day grouped by shift.
 * Defaults to today; pass ?date=YYYY-MM-DD&shift=Morning to narrow.
 */
router.get(
  '/nursing-notes/handover',
  requirePermission('inpatient.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const handover = await nursing.getShiftHandoverScoped(context, {
        date: typeof req.query.date === 'string' ? req.query.date : undefined,
        shift: typeof req.query.shift === 'string' ? req.query.shift : undefined,
      });

      res.json(handover);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Shift handover error:', err);
      res.status(500).json({
        success: false,
        error: 'SHIFT_HANDOVER_FAILED',
      });
    }
  },
);

router.get(
  '/nursing-notes',
  requirePermission('inpatient.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const admissionId = req.query.admissionId ? Number(req.query.admissionId) : undefined;

      const patientId = req.query.patientId ? Number(req.query.patientId) : undefined;

      const list = await queries.getNursingNotesScoped(context, {
        admissionId,
        patientId,
      });

      res.json(list);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Nursing note list error:', err);
      res.status(500).json({
        success: false,
        error: 'NURSING_NOTES_FETCH_FAILED',
      });
    }
  },
);

router.post(
  '/nursing-notes',
  requirePermission('clinical.create'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const note = await queries.createNursingNoteScoped(context, {
        admissionId: req.body?.admissionId,
        patientId: req.body?.patientId,
        encounterId: req.body?.encounterId,
        noteType: req.body?.noteType,
        shift: req.body?.shift,
        note: req.body?.note,
        recordedBy:
          typeof req.body?.recordedBy === 'string'
            ? req.body.recordedBy
            : (req.user?.fullName ?? 'Unknown'),
      });

      await queries.logAuditEvent(
        note.tenantId,
        note.facilityId,
        String(context.userId),
        'CREATE',
        'NursingNote',
        String(note.id),
        `Nursing note recorded for patient ${note.patientId}`,
      );

      res.status(201).json(note);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Nursing note creation error:', err);
      res.status(500).json({
        success: false,
        error: 'NURSING_NOTE_CREATION_FAILED',
      });
    }
  },
);

export default router;
