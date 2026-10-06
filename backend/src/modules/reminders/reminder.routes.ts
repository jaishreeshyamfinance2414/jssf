import { Router } from 'express';
import { authenticate, requirePermission, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../shared/http';
import { reminderController } from './reminder.controller';
import { createReminderSchema } from './reminder.schema';

const router = Router();
router.use(authenticate, requirePermission('dashboard.view'), requireRole('admin', 'manager'));
router.get('/', asyncHandler(reminderController.list));
router.get('/notifications', asyncHandler(reminderController.notifications));
router.post('/', validate({ body: createReminderSchema }), asyncHandler(reminderController.create));
router.post('/:id/complete', asyncHandler(reminderController.complete));
router.delete('/:id', asyncHandler(reminderController.delete));

export default router;
