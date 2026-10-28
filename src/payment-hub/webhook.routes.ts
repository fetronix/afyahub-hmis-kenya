import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { PaymentHubError } from './errors.ts';
import { recordDarajaCallback } from './service.ts';
const router = Router();
router.use(
  rateLimit({
    windowMs: 60_000,
    limit: process.env.NODE_ENV === 'test' ? 10000 : 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  }),
);
router.post('/mpesa', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    await recordDarajaCallback(req.body);
    res.status(200).json({ received: true });
  } catch (error) {
    if (error instanceof PaymentHubError && error.code === 'INVALID_CALLBACK') {
      res.status(400).json({ received: false });
      return;
    }
    res.status(503).json({ received: false });
  }
});
export default router;
