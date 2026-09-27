import { Router } from 'express';
import { asyncHandler } from '../../shared/http';
import { authenticate, requirePermission, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { createCapitalEntrySchema, createCapitalWithdrawalSchema } from './capital.schema';
import { capitalController } from './capital.controller';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('capital.view'), asyncHandler(capitalController.list));
router.post(
  '/',
  requirePermission('capital.manage'),
  requireRole('admin'),
  validate({ body: createCapitalEntrySchema }),
  asyncHandler(capitalController.create),
);
router.post(
  '/withdrawals',
  requirePermission('capital.manage'),
  requireRole('admin'),
  validate({ body: createCapitalWithdrawalSchema }),
  asyncHandler(capitalController.withdraw),
);

export default router;
