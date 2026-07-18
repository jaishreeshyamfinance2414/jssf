import { Router } from 'express';
import { asyncHandler } from '../../shared/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { dashboardController } from './dashboard.controller';

const router = Router();

router.get(
  '/summary',
  authenticate,
  requirePermission('dashboard.view'),
  asyncHandler(dashboardController.summary),
);

export default router;
