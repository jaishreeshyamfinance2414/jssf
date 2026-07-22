import { Router } from 'express';
import { asyncHandler } from '../../shared/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { requirePasskey } from '../../middleware/passkey';
import { validate } from '../../middleware/validate';
import { uploadTo, storeUploadedFiles } from '../files/upload';
import {
  createCustomerSchema,
  CUSTOMER_UPLOAD_FIELDS,
  unstageSchema,
  updateCustomerSchema,
} from './customer.schema';
import { customerController } from './customer.controller';

const router = Router();
router.use(authenticate);

const upload = uploadTo('customers');
const stageUpload = uploadTo('staging');
const storeStaged = storeUploadedFiles('staging');

router.get('/', requirePermission('customer.view'), asyncHandler(customerController.list));

// ── Staged document uploads (Create form) ──────────────────────────────────
// Each document is uploaded the moment it's attached, before the customer is
// created, and lives under staging/ until commit. Declared before '/:id' so
// "staging" is never parsed as a customer id.
router.post(
  '/staging',
  requirePermission('customer.create'),
  stageUpload.single('file'),
  asyncHandler(storeStaged),
  asyncHandler(customerController.stageUpload),
);
router.delete(
  '/staging',
  requirePermission('customer.create'),
  validate({ body: unstageSchema }),
  asyncHandler(customerController.unstage),
);

router.get('/:id', requirePermission('customer.view'), asyncHandler(customerController.detail));
router.post(
  '/',
  requirePermission('customer.create'),
  validate({ body: createCustomerSchema }),
  asyncHandler(customerController.create),
);
router.put(
  '/:id',
  requirePermission('customer.update'),
  requirePasskey(),
  upload.fields(CUSTOMER_UPLOAD_FIELDS),
  asyncHandler(storeUploadedFiles('customers')),
  validate({ body: updateCustomerSchema }),
  asyncHandler(customerController.update),
);
router.delete('/:id', requirePermission('customer.delete'), requirePasskey(), asyncHandler(customerController.delete));

export default router;
