import { Router } from 'express';
import { asyncHandler } from '../../shared/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { scopeByArea } from '../../middleware/area-scope';
import { dashboardController } from './dashboard.controller';

const router = Router();

router.get(
  '/summary',
  authenticate,
  scopeByArea(),
  requirePermission('dashboard.view'),
  asyncHandler(dashboardController.summary),
);

export default router;
