import { Router } from 'express';
import rateLimit from 'express-rate-limit';

const router = Router();
router.use(
  rateLimit({
    windowMs: 60_000,
    limit: process.env.NODE_ENV === 'test' ? 10000 : 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  }),
);

// The existing Daraja reference does not establish a facility-specific,
// provider-authenticated callback contract. A guessed signature or a shared
// bearer secret would falsely imply verification. Reject every delivery until
// a reviewed provider-specific verifier and replay/transaction checks exist.
router.post('/mpesa', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(503).json({ received: false, error: 'CALLBACK_VERIFICATION_UNAVAILABLE' });
});
export default router;
