import { Router } from 'express';
import { authenticate, requirePermission, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../shared/http';
import { borrowedLoanController } from './borrowed-loan.controller';
import { createBorrowedLoanPaymentSchema, createBorrowedLoanSchema } from './borrowed-loan.schema';

const router = Router();
router.use(authenticate, requirePermission('capital.view'), requireRole('admin', 'manager'));
router.get('/', asyncHandler(borrowedLoanController.list));
router.get('/:id/payments', asyncHandler(borrowedLoanController.payments));
router.post('/', validate({ body: createBorrowedLoanSchema }), asyncHandler(borrowedLoanController.create));
router.post('/:id/payments', validate({ body: createBorrowedLoanPaymentSchema }), asyncHandler(borrowedLoanController.recordPayment));

export default router;
