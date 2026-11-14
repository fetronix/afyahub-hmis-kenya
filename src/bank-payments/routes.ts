import { AccountingIntegrityError } from '../accounting/accounting.service.ts';
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../auth/auth.middleware.ts';
import { ScopeAccessError } from '../auth/scope.service.ts';
import { PaymentDomainError, settleVerifiedBankPayment } from '../billing/payments.service.ts';
import { PaymentHubError } from '../payment-hub/errors.ts';
import { BankPaymentError } from './policy.ts';
import * as bank from './service.ts';

const router = Router();
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
const idSchema = z.coerce.number().int().positive();
const wrap =
  (fn: (req: AuthRequest, res: Response) => Promise<void>) =>
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext || !req.user) {
        res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
        return;
      }
      await fn(req, res);
    } catch (e) {
      if (e instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'INVALID_BANK_INPUT',
          message: 'Check the required bank payment fields.',
        });
        return;
      }
      if (
        e instanceof AccountingIntegrityError ||
        e instanceof BankPaymentError ||
        e instanceof PaymentDomainError ||
        e instanceof PaymentHubError
      ) {
        res.status(e.status).json({ success: false, error: e.code, message: e.message });
        return;
      }
      if (e instanceof ScopeAccessError) {
        res.status(403).json({
          success: false,
          error: 'FACILITY_ACCESS_DENIED',
          message: 'Facility access denied.',
        });
        return;
      }
      if ((e as { code?: string })?.code === '23505') {
        res.status(409).json({
          success: false,
          error: 'BANK_RECORD_CONFLICT',
          message:
            'This account, retry identity or statement credit is already in use. Review before retrying.',
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: 'BANK_OPERATION_FAILED',
        message: 'Bank operation failed; review its history before retrying.',
      });
    }
  };
router.get(
  '/policy',
  wrap(async (req, res) => {
    res.json({
      success: true,
      ...(await bank.bankPolicy(req.authContext!, idSchema.parse(req.query.facilityId))),
    });
  }),
);
router.post(
  '/policy/enable',
  wrap(async (req, res) => {
    const b = bank.facilitySchema.parse(req.body);
    res.json({ success: true, ...(await bank.enableBankOnly(req.authContext!, b.facilityId)) });
  }),
);
router.get(
  '/',
  wrap(async (req, res) => {
    res.json({
      success: true,
      ...(await bank.listBankPayments(req.authContext!, idSchema.parse(req.query.facilityId))),
    });
  }),
);
router.post(
  '/',
  wrap(async (req, res) => {
    const result = await bank.submitBankPayment(req.authContext!, req.body);
    res.status(result.idempotentReplay ? 200 : 201).json({ success: true, ...result });
  }),
);
router.post(
  '/accounts',
  wrap(async (req, res) => {
    res
      .status(201)
      .json({ success: true, account: await bank.saveBankAccount(req.authContext!, req.body) });
  }),
);
router.patch(
  '/accounts/:id',
  wrap(async (req, res) => {
    res.json({
      success: true,
      account: await bank.saveBankAccount(
        req.authContext!,
        req.body,
        idSchema.parse(req.params.id),
      ),
    });
  }),
);
router.post(
  '/:id/verify',
  wrap(async (req, res) => {
    res.json({
      success: true,
      ...(await bank.verifyBankPayment(req.authContext!, idSchema.parse(req.params.id), req.body)),
    });
  }),
);
router.post(
  '/:id/reject',
  wrap(async (req, res) => {
    res.json({
      success: true,
      ...(await bank.rejectBankPayment(req.authContext!, idSchema.parse(req.params.id), req.body)),
    });
  }),
);
router.post(
  '/:id/approve-and-settle',
  wrap(async (req, res) => {
    const b = bank.facilitySchema.parse(req.body);
    res.json({
      success: true,
      ...(await settleVerifiedBankPayment(
        req.authContext!,
        b.facilityId,
        idSchema.parse(req.params.id),
        req.user!.fullName,
      )),
    });
  }),
);
export default router;
