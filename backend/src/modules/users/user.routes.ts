import { Router } from 'express';
import { asyncHandler } from '../../shared/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { createUserSchema, resetPasswordSchema, updateUserSchema } from './user.schema';
import { userController } from './user.controller';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('user.view'), asyncHandler(userController.list));
router.post(
  '/',
  requirePermission('user.create'),
  validate({ body: createUserSchema }),
  asyncHandler(userController.create),
);
router.put(
  '/:id',
  requirePermission('user.update'),
  validate({ body: updateUserSchema }),
  asyncHandler(userController.update),
);
router.post(
  '/:id/reset-password',
  requirePermission('user.update'),
  validate({ body: resetPasswordSchema }),
  asyncHandler(userController.resetPassword),
);
router.post('/:id/unlock', requirePermission('user.unlock'), asyncHandler(userController.unlock));
router.delete('/:id', requirePermission('user.delete'), asyncHandler(userController.remove));
router.post('/:id/reactivate', requirePermission('user.delete'), asyncHandler(userController.reactivate));

export default router;
