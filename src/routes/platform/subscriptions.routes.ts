/**
 * JaliCare HMIS
 * Platform administration - subscription billing
 *
 * Split out of `platform.routes.ts` without editing a route. Each handler
 * moved with its middleware, validation and error handling; the paths are
 * unchanged, so mounting this router at "/" inside the platform router
 * leaves the HTTP API exactly as it was.
 *
 * These routes manage subscription records only. They do not yet enforce
 * subscription access against login or clinical routes.
 */

import { Router, type Request, type Response } from 'express';

import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';

import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import * as queries from '../../db/queries.ts';

import {
  auditActor,
  getContext,
  handleError,
  optionalText,
  parseId,
  parseMoneyCents,
  requireSuperAdmin,
  textValue,
  validCalendarDate,
} from './shared.ts';

const router = Router();

// SUBSCRIPTION BILLING API - INITIAL IMPLEMENTATION
// These routes manage subscription records only. They do not yet enforce
// subscription access against login or clinical routes.

router.get('/subscription-periods', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;

  try {
    const rows = await db
      .select({
        id: schema.facilitySubscriptionPeriods.id,
        tenantId: schema.facilitySubscriptionPeriods.tenantId,
        facilityId: schema.facilitySubscriptionPeriods.facilityId,
        subscriptionName: schema.facilitySubscriptionPeriods.subscriptionName,
        amountDue: schema.facilitySubscriptionPeriods.amountDue,
        currency: schema.facilitySubscriptionPeriods.currency,
        periodStart: schema.facilitySubscriptionPeriods.periodStart,
        periodEnd: schema.facilitySubscriptionPeriods.periodEnd,
        dueDate: schema.facilitySubscriptionPeriods.dueDate,
        gracePeriodEnd: schema.facilitySubscriptionPeriods.gracePeriodEnd,
        status: schema.facilitySubscriptionPeriods.status,
        notes: schema.facilitySubscriptionPeriods.notes,
        createdBy: schema.facilitySubscriptionPeriods.createdBy,
        updatedBy: schema.facilitySubscriptionPeriods.updatedBy,
        createdAt: schema.facilitySubscriptionPeriods.createdAt,
        updatedAt: schema.facilitySubscriptionPeriods.updatedAt,
        facilityName: schema.facilities.name,
        facilityCode: schema.facilities.code,
        accessStatus: schema.facilitySubscriptionAccess.accessStatus,
        suspendedAt: schema.facilitySubscriptionAccess.suspendedAt,
        suspensionReason: schema.facilitySubscriptionAccess.suspensionReason,
      })
      .from(schema.facilitySubscriptionPeriods)
      .leftJoin(
        schema.facilities,
        and(
          eq(schema.facilities.id, schema.facilitySubscriptionPeriods.facilityId),
          eq(schema.facilities.tenantId, schema.facilitySubscriptionPeriods.tenantId),
        ),
      )
      .leftJoin(
        schema.facilitySubscriptionAccess,
        and(
          eq(
            schema.facilitySubscriptionAccess.facilityId,
            schema.facilitySubscriptionPeriods.facilityId,
          ),
          eq(
            schema.facilitySubscriptionAccess.tenantId,
            schema.facilitySubscriptionPeriods.tenantId,
          ),
        ),
      )
      .orderBy(desc(schema.facilitySubscriptionPeriods.createdAt))
      .limit(200);

    res.json({ success: true, data: rows });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/subscription-periods', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;
  const context = getContext(req);
  if (!context) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const tenantId = parseId(String(body.tenantId ?? ''));
  const facilityId = parseId(String(body.facilityId ?? ''));
  const subscriptionName = textValue(body.subscriptionName);
  const amountDueCents = parseMoneyCents(body.amountDue);
  const amountDue = amountDueCents === null ? Number.NaN : amountDueCents / 100;
  const periodStart = textValue(body.periodStart);
  const periodEnd = textValue(body.periodEnd);
  const dueDate = textValue(body.dueDate);
  const gracePeriodEnd = optionalText(body, 'gracePeriodEnd');

  const validDate = (value: string | undefined): value is string =>
    Boolean(value && validCalendarDate(value));

  if (
    !tenantId ||
    !facilityId ||
    !subscriptionName ||
    !Number.isFinite(amountDue) ||
    amountDue <= 0 ||
    !validDate(periodStart) ||
    !validDate(periodEnd) ||
    !validDate(dueDate) ||
    (gracePeriodEnd !== undefined && gracePeriodEnd !== null && !validDate(gracePeriodEnd))
  ) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Provide tenant, facility, subscription name, positive fee, and valid period dates.',
    });
    return;
  }

  if (
    periodStart > periodEnd ||
    dueDate < periodStart ||
    (gracePeriodEnd && gracePeriodEnd < dueDate)
  ) {
    res.status(400).json({
      error: 'INVALID_PERIOD_DATES',
      message: 'Check the period start/end, due date, and grace-period end date.',
    });
    return;
  }

  try {
    const created = await db.transaction(async (tx) => {
      const [facility] = await tx
        .select({
          id: schema.facilities.id,
          tenantId: schema.facilities.tenantId,
        })
        .from(schema.facilities)
        .where(eq(schema.facilities.id, facilityId))
        .limit(1);

      if (!facility || facility.tenantId !== tenantId) {
        throw Object.assign(new Error('Facility does not belong to the supplied tenant.'), {
          statusCode: 400,
        });
      }

      const [period] = await tx
        .insert(schema.facilitySubscriptionPeriods)
        .values({
          tenantId,
          facilityId,
          subscriptionName,
          amountDue: amountDue.toFixed(2),
          currency: 'KES',
          periodStart,
          periodEnd,
          dueDate,
          gracePeriodEnd: gracePeriodEnd ?? null,
          status: 'PENDING',
          createdBy: auditActor(context),
          updatedBy: auditActor(context),
        })
        .returning();

      await tx.insert(schema.auditLogs).values({
        tenantId,
        facilityId,
        userId: auditActor(context),
        action: 'CREATE',
        resource: 'FACILITY_SUBSCRIPTION_PERIOD',
        resourceId: String(period.id),
        details: `Created subscription "${subscriptionName}" for KES ${amountDue.toFixed(2)} covering ${periodStart} to ${periodEnd}.`,
        severity: 'INFO',
      });

      return period;
    });

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 400) {
      res.status(400).json({
        error: 'FACILITY_TENANT_MISMATCH',
        message: 'The selected facility does not belong to the supplied tenant.',
      });
      return;
    }
    handleError(res, error);
  }
});

router.get('/subscription-periods/:id/payments', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;
  const periodId = parseId(req.params.id);

  if (!periodId) {
    res.status(400).json({ error: 'INVALID_ID' });
    return;
  }

  try {
    const [period] = await db
      .select({ id: schema.facilitySubscriptionPeriods.id })
      .from(schema.facilitySubscriptionPeriods)
      .where(eq(schema.facilitySubscriptionPeriods.id, periodId))
      .limit(1);

    if (!period) {
      res.status(404).json({ error: 'SUBSCRIPTION_NOT_FOUND' });
      return;
    }

    const payments = await db
      .select()
      .from(schema.facilitySubscriptionPayments)
      .where(eq(schema.facilitySubscriptionPayments.subscriptionPeriodId, periodId))
      .orderBy(desc(schema.facilitySubscriptionPayments.createdAt));

    res.json({ success: true, data: payments });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/subscription-periods/:id/payments', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;
  const context = getContext(req);
  if (!context) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  const periodId = parseId(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const transactionCode = textValue(body.transactionCode);
  const amountCents = parseMoneyCents(body.amount);
  const amount = amountCents === null ? Number.NaN : amountCents / 100;
  const paymentDateInput = textValue(body.paymentDate);
  const paymentDate = paymentDateInput ? new Date(paymentDateInput) : new Date();

  if (
    !periodId ||
    !transactionCode ||
    transactionCode.length > 100 ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    Number.isNaN(paymentDate.getTime())
  ) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message:
        'Provide a valid subscription ID, transaction code, positive amount, and optional valid payment date.',
    });
    return;
  }

  try {
    const created = await db.transaction(async (tx) => {
      const [period] = await tx
        .select()
        .from(schema.facilitySubscriptionPeriods)
        .where(eq(schema.facilitySubscriptionPeriods.id, periodId))
        .limit(1);

      if (!period) {
        throw Object.assign(new Error('Subscription not found.'), { statusCode: 404 });
      }

      const [payment] = await tx
        .insert(schema.facilitySubscriptionPayments)
        .values({
          tenantId: period.tenantId,
          facilityId: period.facilityId,
          subscriptionPeriodId: period.id,
          transactionCode,
          amount: amount.toFixed(2),
          paymentMethod: 'MPESA',
          paymentDate,
          verificationStatus: 'PENDING',
          createdBy: auditActor(context),
        })
        .returning();

      await tx.insert(schema.auditLogs).values({
        tenantId: period.tenantId,
        facilityId: period.facilityId,
        userId: auditActor(context),
        action: 'CREATE',
        resource: 'FACILITY_SUBSCRIPTION_PAYMENT',
        resourceId: String(payment.id),
        details: `Recorded M-Pesa transaction ${transactionCode} for KES ${amount.toFixed(2)} as PENDING verification. It has not yet been counted as paid.`,
        severity: 'INFO',
      });

      return payment;
    });

    res.status(201).json({
      success: true,
      message: 'Payment recorded and awaiting verification. It does not reduce the balance yet.',
      data: created,
    });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 404) {
      res.status(404).json({ error: 'SUBSCRIPTION_NOT_FOUND' });
      return;
    }
    handleError(res, error);
  }
});

router.post('/subscription-payments/:paymentId/verify', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;
  const context = getContext(req);
  if (!context) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  const paymentId = parseId(req.params.paymentId);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const decision = textValue(body.decision)?.toUpperCase();
  const verificationNotes = optionalText(body, 'verificationNotes');

  if (!paymentId || !['VERIFIED', 'REJECTED'].includes(decision ?? '')) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Decision must be VERIFIED or REJECTED.',
    });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [payment] = await tx
        .select()
        .from(schema.facilitySubscriptionPayments)
        .where(eq(schema.facilitySubscriptionPayments.id, paymentId))
        .for('update')
        .limit(1);

      if (!payment) {
        throw Object.assign(new Error('Payment not found.'), { statusCode: 404 });
      }
      if (payment.verificationStatus !== 'PENDING') {
        throw Object.assign(new Error('Payment has already been reviewed.'), { statusCode: 409 });
      }

      const [period] = await tx
        .select()
        .from(schema.facilitySubscriptionPeriods)
        .where(eq(schema.facilitySubscriptionPeriods.id, payment.subscriptionPeriodId))
        .for('update')
        .limit(1);

      if (
        !period ||
        period.tenantId !== payment.tenantId ||
        period.facilityId !== payment.facilityId
      ) {
        throw Object.assign(new Error('Payment subscription references are inconsistent.'), {
          statusCode: 409,
        });
      }

      const [updatedPayment] = await tx
        .update(schema.facilitySubscriptionPayments)
        .set({
          verificationStatus: decision!,
          verifiedBy: auditActor(context),
          verifiedAt: new Date(),
          verificationNotes: verificationNotes ?? null,
        })
        .where(eq(schema.facilitySubscriptionPayments.id, paymentId))
        .returning();

      const verifiedPayments = await tx
        .select({ amount: schema.facilitySubscriptionPayments.amount })
        .from(schema.facilitySubscriptionPayments)
        .where(
          and(
            eq(schema.facilitySubscriptionPayments.subscriptionPeriodId, period.id),
            eq(schema.facilitySubscriptionPayments.tenantId, period.tenantId),
            eq(schema.facilitySubscriptionPayments.facilityId, period.facilityId),
            eq(schema.facilitySubscriptionPayments.verificationStatus, 'VERIFIED'),
          ),
        );

      // Recalculate after either decision, using verified payments only.
      const paidCents = verifiedPayments.reduce(
        (total, item) => total + Math.round(Number(item.amount) * 100),
        0,
      );
      const dueCents = Math.round(Number(period.amountDue) * 100);
      const nextStatus =
        paidCents >= dueCents ? 'PAID' : paidCents > 0 ? 'PARTIALLY_PAID' : 'PENDING';

      const [updatedPeriod] = await tx
        .update(schema.facilitySubscriptionPeriods)
        .set({
          status: nextStatus,
          updatedBy: auditActor(context),
          updatedAt: new Date(),
        })
        .where(eq(schema.facilitySubscriptionPeriods.id, period.id))
        .returning();

      await tx.insert(schema.auditLogs).values({
        tenantId: payment.tenantId,
        facilityId: payment.facilityId,
        userId: auditActor(context),
        action: decision === 'VERIFIED' ? 'VERIFY' : 'REJECT',
        resource: 'FACILITY_SUBSCRIPTION_PAYMENT',
        resourceId: String(payment.id),
        details: `Payment ${payment.transactionCode} was ${decision}. Notes: ${verificationNotes ?? 'None provided'}.`,
        severity: decision === 'REJECTED' ? 'WARNING' : 'INFO',
      });

      return { payment: updatedPayment, period: updatedPeriod };
    });

    res.json({ success: true, data: result });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 404) {
      res.status(404).json({ error: 'PAYMENT_NOT_FOUND' });
      return;
    }
    if (statusCode === 409) {
      res.status(409).json({
        error: 'PAYMENT_REVIEW_CONFLICT',
        message:
          'The payment was already reviewed or its subscription references are inconsistent.',
      });
      return;
    }
    handleError(res, error);
  }
});

router.post('/subscription-periods/:id/suspend', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;
  const context = getContext(req);
  if (!context) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  const periodId = parseId(req.params.id);
  const reason = textValue((req.body ?? {}).reason);

  if (!periodId || !reason || reason.length > 1000) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Provide a subscription ID and a suspension reason of up to 1000 characters.',
    });
    return;
  }

  try {
    const access = await db.transaction(async (tx) => {
      const [period] = await tx
        .select()
        .from(schema.facilitySubscriptionPeriods)
        .where(eq(schema.facilitySubscriptionPeriods.id, periodId))
        .for('update')
        .limit(1);

      if (!period) {
        throw Object.assign(new Error('Subscription not found.'), { statusCode: 404 });
      }

      // Only allow suspension for a genuinely overdue period with a balance.
      const suspensionDeadline = String(period.gracePeriodEnd ?? period.dueDate).slice(0, 10);

      const suspensionDateParts = new Intl.DateTimeFormat('en', {
        timeZone: 'Africa/Nairobi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date());

      const suspensionDatePart = (type: string) =>
        suspensionDateParts.find((part) => part.type === type)?.value ?? '';

      const suspensionToday = `${suspensionDatePart('year')}-${suspensionDatePart('month')}-${suspensionDatePart('day')}`;

      if (suspensionToday <= suspensionDeadline) {
        throw Object.assign(
          new Error('This subscription has not passed its due date and grace period.'),
          { statusCode: 422 },
        );
      }

      const suspensionPayments = await tx
        .select({
          amount: schema.facilitySubscriptionPayments.amount,
        })
        .from(schema.facilitySubscriptionPayments)
        .where(
          and(
            eq(schema.facilitySubscriptionPayments.subscriptionPeriodId, period.id),
            eq(schema.facilitySubscriptionPayments.facilityId, period.facilityId),
            eq(schema.facilitySubscriptionPayments.tenantId, period.tenantId),
            eq(schema.facilitySubscriptionPayments.verificationStatus, 'VERIFIED'),
          ),
        );

      const suspensionPaidCents = suspensionPayments.reduce(
        (total, payment) => total + Math.round(Number(payment.amount) * 100),
        0,
      );
      const suspensionDueCents = Math.round(Number(period.amountDue) * 100);

      if (suspensionPaidCents >= suspensionDueCents) {
        throw Object.assign(new Error('This subscription has no outstanding balance.'), {
          statusCode: 422,
        });
      }

      const [existing] = await tx
        .select()
        .from(schema.facilitySubscriptionAccess)
        .where(eq(schema.facilitySubscriptionAccess.facilityId, period.facilityId))
        .for('update')
        .limit(1);

      if (existing && existing.tenantId !== period.tenantId) {
        throw Object.assign(new Error('Facility tenant mismatch.'), { statusCode: 409 });
      }
      if (existing?.accessStatus === 'SUSPENDED') {
        throw Object.assign(new Error('Facility is already suspended.'), { statusCode: 409 });
      }

      const now = new Date();
      let updated;

      if (existing) {
        const [row] = await tx
          .update(schema.facilitySubscriptionAccess)
          .set({
            accessStatus: 'SUSPENDED',
            suspendedAt: now,
            suspendedBy: auditActor(context),
            suspensionReason: reason,
            updatedBy: auditActor(context),
            updatedAt: now,
          })
          .where(eq(schema.facilitySubscriptionAccess.id, existing.id))
          .returning();
        updated = row;
      } else {
        const [row] = await tx
          .insert(schema.facilitySubscriptionAccess)
          .values({
            tenantId: period.tenantId,
            facilityId: period.facilityId,
            accessStatus: 'SUSPENDED',
            suspendedAt: now,
            suspendedBy: auditActor(context),
            suspensionReason: reason,
            createdBy: auditActor(context),
            updatedBy: auditActor(context),
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        updated = row;
      }

      await tx.insert(schema.auditLogs).values({
        tenantId: period.tenantId,
        facilityId: period.facilityId,
        userId: auditActor(context),
        action: 'SUSPEND',
        resource: 'FACILITY_SUBSCRIPTION_ACCESS',
        resourceId: String(period.facilityId),
        details:
          'Facility access suspended through subscription period ' +
          period.id +
          '. Reason: ' +
          reason,
        severity: 'HIGH',
      });

      return updated;
    });

    res.json({ success: true, data: access });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 404) {
      res.status(404).json({ error: 'SUBSCRIPTION_NOT_FOUND' });
      return;
    }
    if (statusCode === 409) {
      res.status(409).json({ error: 'FACILITY_ACCESS_CONFLICT' });
      return;
    }
    if (statusCode === 422) {
      res.status(422).json({
        error: 'SUBSCRIPTION_NOT_ELIGIBLE_FOR_SUSPENSION',
        message: (error as Error).message,
      });
      return;
    }
    handleError(res, error);
  }
});

router.post('/subscription-periods/:id/reactivate', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;
  const context = getContext(req);
  if (!context) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  const periodId = parseId(req.params.id);
  if (!periodId) {
    res.status(400).json({ error: 'INVALID_ID' });
    return;
  }

  try {
    const access = await db.transaction(async (tx) => {
      const [period] = await tx
        .select()
        .from(schema.facilitySubscriptionPeriods)
        .where(eq(schema.facilitySubscriptionPeriods.id, periodId))
        .for('update')
        .limit(1);

      if (!period) {
        throw Object.assign(new Error('Subscription not found.'), { statusCode: 404 });
      }

      const [currentAccess] = await tx
        .select()
        .from(schema.facilitySubscriptionAccess)
        .where(eq(schema.facilitySubscriptionAccess.facilityId, period.facilityId))
        .for('update')
        .limit(1);

      if (!currentAccess || currentAccess.tenantId !== period.tenantId) {
        throw Object.assign(new Error('Facility access record not found.'), { statusCode: 404 });
      }
      if (currentAccess.accessStatus !== 'SUSPENDED') {
        throw Object.assign(new Error('Facility is not suspended.'), { statusCode: 409 });
      }

      const verifiedPayments = await tx
        .select({ amount: schema.facilitySubscriptionPayments.amount })
        .from(schema.facilitySubscriptionPayments)
        .where(
          and(
            eq(schema.facilitySubscriptionPayments.subscriptionPeriodId, period.id),
            eq(schema.facilitySubscriptionPayments.facilityId, period.facilityId),
            eq(schema.facilitySubscriptionPayments.tenantId, period.tenantId),
            eq(schema.facilitySubscriptionPayments.verificationStatus, 'VERIFIED'),
          ),
        );

      const paidCents = verifiedPayments.reduce(
        (total, item) => total + Math.round(Number(item.amount) * 100),
        0,
      );
      const dueCents = Math.round(Number(period.amountDue) * 100);

      if (paidCents < dueCents) {
        throw Object.assign(new Error('Outstanding balance remains.'), { statusCode: 422 });
      }

      // Facility access is shared across its subscriptions. Do not reactivate
      // while any other subscription is overdue beyond its grace period.
      const facilityPeriods = await tx
        .select({
          id: schema.facilitySubscriptionPeriods.id,
          amountDue: schema.facilitySubscriptionPeriods.amountDue,
          dueDate: schema.facilitySubscriptionPeriods.dueDate,
          gracePeriodEnd: schema.facilitySubscriptionPeriods.gracePeriodEnd,
        })
        .from(schema.facilitySubscriptionPeriods)
        .where(
          and(
            eq(schema.facilitySubscriptionPeriods.facilityId, period.facilityId),
            eq(schema.facilitySubscriptionPeriods.tenantId, period.tenantId),
          ),
        );

      const facilityVerifiedPayments = await tx
        .select({
          subscriptionPeriodId: schema.facilitySubscriptionPayments.subscriptionPeriodId,
          amount: schema.facilitySubscriptionPayments.amount,
        })
        .from(schema.facilitySubscriptionPayments)
        .where(
          and(
            eq(schema.facilitySubscriptionPayments.facilityId, period.facilityId),
            eq(schema.facilitySubscriptionPayments.tenantId, period.tenantId),
            eq(schema.facilitySubscriptionPayments.verificationStatus, 'VERIFIED'),
          ),
        );

      const paidByPeriod = new Map<number, number>();
      for (const payment of facilityVerifiedPayments) {
        const previous = paidByPeriod.get(payment.subscriptionPeriodId) ?? 0;
        paidByPeriod.set(
          payment.subscriptionPeriodId,
          previous + Math.round(Number(payment.amount) * 100),
        );
      }

      const reactivationDateParts = new Intl.DateTimeFormat('en', {
        timeZone: 'Africa/Nairobi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date());

      const reactivationDatePart = (type: string) =>
        reactivationDateParts.find((part) => part.type === type)?.value ?? '';

      const reactivationToday = `${reactivationDatePart('year')}-${reactivationDatePart('month')}-${reactivationDatePart('day')}`;

      const overdueUnpaidPeriods = facilityPeriods.filter((item) => {
        const deadline = String(item.gracePeriodEnd ?? item.dueDate).slice(0, 10);
        const paid = paidByPeriod.get(item.id) ?? 0;
        const due = Math.round(Number(item.amountDue) * 100);

        return reactivationToday > deadline && paid < due;
      });

      if (overdueUnpaidPeriods.length > 0) {
        throw Object.assign(
          new Error('Other overdue subscription balances must be cleared before reactivation.'),
          { statusCode: 422 },
        );
      }

      const now = new Date();
      const [updated] = await tx
        .update(schema.facilitySubscriptionAccess)
        .set({
          accessStatus: 'ACTIVE',
          reactivatedAt: now,
          reactivatedBy: auditActor(context),
          updatedBy: auditActor(context),
          updatedAt: now,
        })
        .where(eq(schema.facilitySubscriptionAccess.id, currentAccess.id))
        .returning();

      await tx.insert(schema.auditLogs).values({
        tenantId: period.tenantId,
        facilityId: period.facilityId,
        userId: auditActor(context),
        action: 'REACTIVATE',
        resource: 'FACILITY_SUBSCRIPTION_ACCESS',
        resourceId: String(period.facilityId),
        details:
          'Facility access reactivated after checking verified payments for subscription period ' +
          period.id +
          '. Verified total: ' +
          (paidCents / 100).toFixed(2) +
          ' ' +
          period.currency +
          '.',
        severity: 'HIGH',
      });

      return updated;
    });

    res.json({ success: true, data: access });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 404) {
      res.status(404).json({ error: 'SUBSCRIPTION_OR_ACCESS_NOT_FOUND' });
      return;
    }
    if (statusCode === 409) {
      res.status(409).json({ error: 'FACILITY_ACCESS_CONFLICT' });
      return;
    }
    if (statusCode === 422) {
      res.status(422).json({
        error: 'OUTSTANDING_SUBSCRIPTIONS_REMAIN',
        message: (error as Error).message,
      });
      return;
    }
    handleError(res, error);
  }
});
router.post('/subscription-periods/:id/price-changes', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;

  const context = getContext(req);
  if (!context) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  const periodId = parseId(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const newAmountCents = parseMoneyCents(body.newAmount);
  const effectiveTiming = textValue(body.effectiveTiming)?.toUpperCase();
  const reason = textValue(body.reason);

  if (
    !periodId ||
    newAmountCents === null ||
    newAmountCents <= 0 ||
    !['CURRENT_PERIOD', 'NEXT_PERIOD'].includes(effectiveTiming ?? '') ||
    !reason ||
    reason.length > 1000
  ) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message:
        'Provide a valid subscription ID, positive fee, effective timing, and reason of up to 1000 characters.',
    });
    return;
  }

  const newAmount = newAmountCents / 100;

  const shiftDate = (value: string, days: number): string => {
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };

  const daysBetween = (start: string, end: string): number => {
    const startMs = new Date(`${String(start).slice(0, 10)}T00:00:00.000Z`).getTime();
    const endMs = new Date(`${String(end).slice(0, 10)}T00:00:00.000Z`).getTime();
    return Math.round((endMs - startMs) / 86400000);
  };

  try {
    const result = await db.transaction(async (tx) => {
      const [period] = await tx
        .select()
        .from(schema.facilitySubscriptionPeriods)
        .where(eq(schema.facilitySubscriptionPeriods.id, periodId))
        .for('update')
        .limit(1);

      if (!period) {
        throw Object.assign(new Error('Subscription not found.'), { statusCode: 404 });
      }

      const [facility] = await tx
        .select({
          id: schema.facilities.id,
          tenantId: schema.facilities.tenantId,
        })
        .from(schema.facilities)
        .where(eq(schema.facilities.id, period.facilityId))
        .limit(1);

      if (!facility || facility.tenantId !== period.tenantId) {
        throw Object.assign(new Error('Subscription facility and tenant do not match.'), {
          statusCode: 409,
        });
      }

      const verifiedPayments = await tx
        .select({ amount: schema.facilitySubscriptionPayments.amount })
        .from(schema.facilitySubscriptionPayments)
        .where(
          and(
            eq(schema.facilitySubscriptionPayments.subscriptionPeriodId, period.id),
            eq(schema.facilitySubscriptionPayments.facilityId, period.facilityId),
            eq(schema.facilitySubscriptionPayments.tenantId, period.tenantId),
            eq(schema.facilitySubscriptionPayments.verificationStatus, 'VERIFIED'),
          ),
        );

      const paidCents = verifiedPayments.reduce(
        (total, payment) => total + Math.round(Number(payment.amount) * 100),
        0,
      );

      const previousAmount = Number(period.amountDue);
      let changedPeriod: typeof period;

      if (effectiveTiming === 'CURRENT_PERIOD') {
        if (paidCents > newAmountCents) {
          throw Object.assign(
            new Error(
              'The new fee cannot be lower than payments already verified for this period.',
            ),
            { statusCode: 422 },
          );
        }

        const nextStatus =
          paidCents >= newAmountCents ? 'PAID' : paidCents > 0 ? 'PARTIALLY_PAID' : 'PENDING';

        const [updatedPeriod] = await tx
          .update(schema.facilitySubscriptionPeriods)
          .set({
            amountDue: newAmount.toFixed(2),
            status: nextStatus,
            updatedBy: auditActor(context),
            updatedAt: new Date(),
          })
          .where(eq(schema.facilitySubscriptionPeriods.id, period.id))
          .returning();

        changedPeriod = updatedPeriod;
      } else {
        const start = String(period.periodStart).slice(0, 10);
        const end = String(period.periodEnd).slice(0, 10);
        const due = String(period.dueDate).slice(0, 10);
        const grace = period.gracePeriodEnd ? String(period.gracePeriodEnd).slice(0, 10) : null;

        const durationDays = daysBetween(start, end);
        const dueOffset = daysBetween(start, due);
        const graceOffset = grace ? daysBetween(start, grace) : null;

        if (
          durationDays < 0 ||
          dueOffset < 0 ||
          (graceOffset !== null && graceOffset < dueOffset)
        ) {
          throw Object.assign(
            new Error(
              'The existing subscription dates are invalid. Correct them before changing the fee.',
            ),
            { statusCode: 422 },
          );
        }

        const nextStart = shiftDate(end, 1);
        const nextEnd = shiftDate(nextStart, durationDays);
        const nextDue = shiftDate(nextStart, dueOffset);
        const nextGrace = graceOffset === null ? null : shiftDate(nextStart, graceOffset);

        const existingPeriods = await tx
          .select({
            id: schema.facilitySubscriptionPeriods.id,
            periodStart: schema.facilitySubscriptionPeriods.periodStart,
            periodEnd: schema.facilitySubscriptionPeriods.periodEnd,
          })
          .from(schema.facilitySubscriptionPeriods)
          .where(
            and(
              eq(schema.facilitySubscriptionPeriods.tenantId, period.tenantId),
              eq(schema.facilitySubscriptionPeriods.facilityId, period.facilityId),
            ),
          );

        const overlaps = existingPeriods.some((existing) => {
          if (existing.id === period.id) return false;

          const existingStart = String(existing.periodStart).slice(0, 10);
          const existingEnd = String(existing.periodEnd).slice(0, 10);

          return existingStart <= nextEnd && existingEnd >= nextStart;
        });

        if (overlaps) {
          throw Object.assign(
            new Error('Another subscription period already overlaps the proposed next period.'),
            { statusCode: 409 },
          );
        }

        const [createdPeriod] = await tx
          .insert(schema.facilitySubscriptionPeriods)
          .values({
            tenantId: period.tenantId,
            facilityId: period.facilityId,
            subscriptionName: period.subscriptionName,
            amountDue: newAmount.toFixed(2),
            currency: period.currency,
            periodStart: nextStart,
            periodEnd: nextEnd,
            dueDate: nextDue,
            gracePeriodEnd: nextGrace,
            status: 'PENDING',
            notes: `Fee revised from KES ${previousAmount.toFixed(2)}. Reason: ${reason}`,
            createdBy: auditActor(context),
            updatedBy: auditActor(context),
          })
          .returning();

        changedPeriod = createdPeriod;
      }

      const [priceChange] = await tx
        .insert(schema.facilitySubscriptionPriceChanges)
        .values({
          tenantId: period.tenantId,
          facilityId: period.facilityId,
          subscriptionPeriodId: changedPeriod.id,
          previousAmount: previousAmount.toFixed(2),
          newAmount: newAmount.toFixed(2),
          effectiveTiming: effectiveTiming!,
          reason,
          changedBy: auditActor(context),
        })
        .returning();

      await tx.insert(schema.auditLogs).values({
        tenantId: period.tenantId,
        facilityId: period.facilityId,
        userId: auditActor(context),
        action: 'UPDATE',
        resource: 'FACILITY_SUBSCRIPTION_PRICE',
        resourceId: String(priceChange.id),
        details:
          `Subscription fee changed from KES ${previousAmount.toFixed(2)} to KES ${newAmount.toFixed(2)}. ` +
          `Timing: ${effectiveTiming}. Period ID: ${changedPeriod.id}. Reason: ${reason}`,
        severity: 'HIGH',
      });

      return { period: changedPeriod, priceChange };
    });

    res.status(200).json({
      success: true,
      message:
        effectiveTiming === 'CURRENT_PERIOD'
          ? 'Current subscription fee updated.'
          : 'Next subscription period created with the revised fee.',
      data: result,
    });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode;

    if (statusCode === 404) {
      res.status(404).json({ error: 'SUBSCRIPTION_NOT_FOUND' });
      return;
    }

    if (statusCode === 409) {
      res.status(409).json({
        error: 'SUBSCRIPTION_CONFLICT',
        message: (error as Error).message,
      });
      return;
    }

    if (statusCode === 422) {
      res.status(422).json({
        error: 'PRICE_CHANGE_NOT_ALLOWED',
        message: (error as Error).message,
      });
      return;
    }

    handleError(res, error);
  }
});

export default router;
