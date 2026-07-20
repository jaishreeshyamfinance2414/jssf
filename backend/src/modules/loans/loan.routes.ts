import { Router } from 'express';
import { asyncHandler } from '../../shared/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { requirePasskey } from '../../middleware/passkey';
import { validate } from '../../middleware/validate';
import { loanController } from './loan.controller';
import { closeLoanSchema, createLoanSchema, disburseLoanSchema, rejectLoanSchema, updateLoanSchema } from './loan.schema';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('loan.view'), asyncHandler(loanController.list));
router.get('/search', requirePermission('loan.view'), asyncHandler(loanController.search));
router.get('/:id', requirePermission('loan.view'), asyncHandler(loanController.detail));
router.post('/', requirePermission('loan.create'), validate({ body: createLoanSchema }), asyncHandler(loanController.create));
router.put('/:id', requirePermission('loan.update'), requirePasskey(), validate({ body: updateLoanSchema }), asyncHandler(loanController.update));
router.post('/:id/approve', requirePermission('loan.approve'), requirePasskey(), asyncHandler(loanController.approve));
router.post('/:id/unapprove', requirePermission('loan.approve'), requirePasskey(), asyncHandler(loanController.unapprove));
router.post('/:id/reject', requirePermission('loan.approve'), requirePasskey(), validate({ body: rejectLoanSchema }), asyncHandler(loanController.reject));
router.post('/:id/disburse', requirePermission('loan.disburse'), requirePasskey(), validate({ body: disburseLoanSchema }), asyncHandler(loanController.disburse));
router.post('/:id/close', requirePermission('loan.close'), requirePasskey(), validate({ body: closeLoanSchema }), asyncHandler(loanController.close));
router.delete('/:id', requirePermission('loan.delete'), requirePasskey(), asyncHandler(loanController.remove));

export default router;
