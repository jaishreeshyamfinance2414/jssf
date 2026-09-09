import { Router } from 'express';
import { asyncHandler } from '../../shared/http';
import { authenticate, requireRole } from '../../middleware/auth';
import { requirePasskey } from '../../middleware/passkey';
import { validate } from '../../middleware/validate';
import { updatePenaltySchema } from './settings.schema';
import { settingsController } from './settings.controller';

const router = Router();
router.use(authenticate);

router.get('/', requireRole('admin'), asyncHandler(settingsController.getAll));
router.put(
  '/penalty',
  requireRole('admin'),
  requirePasskey(),
  validate({ body: updatePenaltySchema }),
  asyncHandler(settingsController.updatePenalty),
);

export default router;
