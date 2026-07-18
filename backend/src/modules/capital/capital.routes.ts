import { Router } from 'express';
import { asyncHandler } from '../../shared/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { createCapitalEntrySchema } from './capital.schema';
import { capitalController } from './capital.controller';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('capital.view'), asyncHandler(capitalController.list));
router.post(
  '/',
  requirePermission('capital.manage'),
  validate({ body: createCapitalEntrySchema }),
  asyncHandler(capitalController.create),
);

export default router;
