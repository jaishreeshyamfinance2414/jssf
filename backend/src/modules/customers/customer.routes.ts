import { Router } from 'express';
import { asyncHandler } from '../../shared/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { uploadTo, verifyUploadedFiles } from '../files/upload';
import { createCustomerSchema, CUSTOMER_UPLOAD_FIELDS, updateCustomerSchema } from './customer.schema';
import { customerController } from './customer.controller';

const router = Router();
router.use(authenticate);

const upload = uploadTo('customers');

router.get('/', requirePermission('customer.view'), asyncHandler(customerController.list));
router.get('/:id', requirePermission('customer.view'), asyncHandler(customerController.detail));
router.post(
  '/',
  requirePermission('customer.create'),
  upload.fields(CUSTOMER_UPLOAD_FIELDS),
  asyncHandler(verifyUploadedFiles),
  validate({ body: createCustomerSchema }),
  asyncHandler(customerController.create),
);
router.put(
  '/:id',
  requirePermission('customer.update'),
  upload.fields(CUSTOMER_UPLOAD_FIELDS),
  asyncHandler(verifyUploadedFiles),
  validate({ body: updateCustomerSchema }),
  asyncHandler(customerController.update),
);
router.delete('/:id', requirePermission('customer.delete'), asyncHandler(customerController.delete));

export default router;
