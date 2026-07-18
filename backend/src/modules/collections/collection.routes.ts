import { Router } from 'express';
import { asyncHandler } from '../../shared/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { collectionController } from './collection.controller';
import { createCollectionSchema, updateCollectionSchema } from './collection.schema';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('collection.view'), asyncHandler(collectionController.list));
router.get('/due', requirePermission('collection.view'), asyncHandler(collectionController.due));
router.get('/sheet', requirePermission('collection.view'), asyncHandler(collectionController.sheet));
router.get('/sheet/agents', requirePermission('collection.view'), asyncHandler(collectionController.sheetAgents));
router.post(
  '/',
  requirePermission('collection.create'),
  validate({ body: createCollectionSchema }),
  asyncHandler(collectionController.create),
);
router.put(
  '/:id',
  requirePermission('collection.update'),
  validate({ body: updateCollectionSchema }),
  asyncHandler(collectionController.update),
);
router.delete('/:id', requirePermission('collection.delete'), asyncHandler(collectionController.remove));

export default router;
