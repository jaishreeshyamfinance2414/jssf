import { Router } from 'express';
import { asyncHandler } from '../../shared/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { agentIdQuerySchema, recordHandoverSchema } from './agent-ledger.schema';
import { agentLedgerController } from './agent-ledger.controller';

const router = Router();
router.use(authenticate);

router.get(
  '/pending',
  requirePermission('collection.view'),
  validate({ query: agentIdQuerySchema }),
  asyncHandler(agentLedgerController.pending),
);
router.get('/history/:agentId', requirePermission('collection.view'), asyncHandler(agentLedgerController.history));
router.post(
  '/handover',
  requirePermission('collection.handover'),
  validate({ body: recordHandoverSchema }),
  asyncHandler(agentLedgerController.handover),
);

export default router;
