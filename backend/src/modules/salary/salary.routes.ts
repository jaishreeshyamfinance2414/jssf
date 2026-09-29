import { Router } from 'express';
import { asyncHandler } from '../../shared/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { salaryController } from './salary.controller';
import { createSalarySchema, memberSalarySchema, payableQuerySchema } from './salary.schema';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('salary.view'), asyncHandler(salaryController.list));
router.get('/members', requirePermission('salary.view'), asyncHandler(salaryController.members));
router.get('/user-expenses', requirePermission('salary.view'), asyncHandler(salaryController.userExpenses));
router.get('/payable', requirePermission('salary.view'), validate({ query: payableQuerySchema }), asyncHandler(salaryController.payable));
router.post('/members', requirePermission('salary.manage'), validate({ body: memberSalarySchema }), asyncHandler(salaryController.upsertMember));
router.post(
  '/',
  requirePermission('salary.manage'),
  validate({ body: createSalarySchema }),
  asyncHandler(salaryController.create),
);
router.delete('/:id', requirePermission('salary.manage'), asyncHandler(salaryController.remove));

export default router;
