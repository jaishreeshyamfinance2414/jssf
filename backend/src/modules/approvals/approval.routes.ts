import { Router } from 'express';
import { asyncHandler } from '../../shared/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { requirePasskey } from '../../middleware/passkey';
import { validate } from '../../middleware/validate';
import { rejectSchema, reviewSchema } from './approval.schema';
import { approvalController } from './approval.controller';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('approval.review'), asyncHandler(approvalController.list));
router.get('/mine', asyncHandler(approvalController.mine));
router.post(
  '/:id/approve',
  requirePermission('approval.review'),
  requirePasskey(),
  validate({ body: reviewSchema }),
  asyncHandler(approvalController.approve),
);
router.post(
  '/:id/reject',
  requirePermission('approval.review'),
  requirePasskey(),
  validate({ body: rejectSchema }),
  asyncHandler(approvalController.reject),
);

export default router;
