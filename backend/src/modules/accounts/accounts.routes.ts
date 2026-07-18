import { Router } from 'express';
import { asyncHandler } from '../../shared/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { accountsController } from './accounts.controller';

const router = Router();
router.use(authenticate, requirePermission('capital.view'));

router.get('/', asyncHandler(accountsController.list));
router.get('/:id/transactions', asyncHandler(accountsController.transactions));

export default router;
