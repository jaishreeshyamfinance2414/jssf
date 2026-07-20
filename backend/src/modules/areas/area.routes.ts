import { Router } from 'express';
import { asyncHandler } from '../../shared/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { requirePasskey } from '../../middleware/passkey';
import { validate } from '../../middleware/validate';
import { areaController, assignAgentSchema, createAreaSchema } from './area.controller';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('area.view'), asyncHandler(areaController.list));
router.post(
  '/',
  requirePermission('area.manage'),
  requirePasskey(),
  validate({ body: createAreaSchema }),
  asyncHandler(areaController.create),
);
router.get('/:id/agents', requirePermission('area.view'), asyncHandler(areaController.agents));
router.post(
  '/:id/agents',
  requirePermission('area.manage'),
  requirePasskey(),
  validate({ body: assignAgentSchema }),
  asyncHandler(areaController.assignAgent),
);
router.delete('/:id/agents/:agentId', requirePermission('area.manage'), requirePasskey(), asyncHandler(areaController.unassignAgent));

export default router;
