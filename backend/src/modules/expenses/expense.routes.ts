import { Router } from 'express';
import { asyncHandler } from '../../shared/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { expenseController } from './expense.controller';
import { createExpenseSchema } from './expense.schema';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('expense.view'), asyncHandler(expenseController.list));
router.get('/categories', requirePermission('expense.view'), asyncHandler(expenseController.categories));
router.post(
  '/',
  requirePermission('expense.manage'),
  validate({ body: createExpenseSchema }),
  asyncHandler(expenseController.create),
);

export default router;
