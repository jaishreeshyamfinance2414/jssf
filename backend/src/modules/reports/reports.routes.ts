import { Router } from 'express';
import { asyncHandler } from '../../shared/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { reportsController } from './reports.controller';

const router = Router();
router.use(authenticate, requirePermission('report.view'));

router.get('/profit-loss', asyncHandler(reportsController.profitLoss));
router.get('/daily-collection', asyncHandler(reportsController.dailyCollection));
router.get('/missed-emi', asyncHandler(reportsController.missedEmi));
router.get('/customer-ledger', asyncHandler(reportsController.customerLedger));
router.get('/agent-performance', asyncHandler(reportsController.agentPerformance));
router.get('/account-ledger', asyncHandler(reportsController.accountLedger));

export default router;
