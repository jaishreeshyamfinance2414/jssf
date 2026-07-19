import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../../shared/http';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/auth';
import { authController } from './auth.controller';
import { loginSchema, changePasswordSchema } from './auth.schema';

const router = Router();

// Tighter limit on the login endpoint specifically (brute-force defence,
// complementing per-account lockout).
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts' } },
});

router.post('/login', loginLimiter, validate({ body: loginSchema }), asyncHandler(authController.login));
router.post('/refresh', asyncHandler(authController.refresh));
router.post('/logout', asyncHandler(authController.logout));
router.get('/me', authenticate, asyncHandler(authController.me));
router.post(
  '/change-password',
  authenticate,
  validate({ body: changePasswordSchema }),
  asyncHandler(authController.changePassword),
);

export default router;
