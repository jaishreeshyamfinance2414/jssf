import { Router } from 'express';
import { asyncHandler } from '../../shared/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { salaryController } from './salary.controller';
import { createSalarySchema } from './salary.schema';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('salary.view'), asyncHandler(salaryController.list));
router.post(
  '/',
  requirePermission('salary.manage'),
  validate({ body: createSalarySchema }),
  asyncHandler(salaryController.create),
);
router.delete('/:id', requirePermission('salary.manage'), asyncHandler(salaryController.remove));

export default router;
