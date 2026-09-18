import { Router } from 'express';
import { asyncHandler } from '../../shared/http';
import { authenticate, requireRole } from '../../middleware/auth';
import { requirePasskey } from '../../middleware/passkey';
import { validate } from '../../middleware/validate';
import { updatePenaltySchema, updateLoanNumberSchema, updateBrandingSchema, updateBackupCronSchema } from './settings.schema';
import { settingsController } from './settings.controller';
import { BadRequest } from '../../shared/errors';
import express from 'express';
import multer from 'multer';

const router = Router();
router.get('/branding', asyncHandler(settingsController.getBranding));
router.get('/branding/assets/:kind', asyncHandler(settingsController.getBrandingAsset));
router.get('/branding/manifest', asyncHandler(settingsController.getBrandingManifest));
router.use(authenticate);

router.get('/', requireRole('admin'), asyncHandler(settingsController.getAll));
router.get('/backup/cron', requireRole('admin'), asyncHandler(settingsController.getBackupCron));
router.put('/backup/cron', requireRole('admin'), requirePasskey(),
  validate({ body: updateBackupCronSchema }), asyncHandler(settingsController.updateBackupCron));
router.get('/backup/check/:provider', requireRole('admin'), asyncHandler((req, res) => {
  if (req.params.provider !== 'b2' && req.params.provider !== 'r2') throw BadRequest('Unknown storage provider');
  return settingsController.checkBackupStorage(req, res);
}));
router.post('/backup/download', requireRole('admin'), requirePasskey(), asyncHandler(settingsController.downloadBackup));
router.post('/backup/restore/uploads', requireRole('admin'), requirePasskey(), asyncHandler(settingsController.startRestoreUpload));
router.put('/backup/restore/uploads/:id/chunks/:index', requireRole('admin'),
  express.raw({ type: 'application/octet-stream', limit: '8mb' }),
  asyncHandler(settingsController.uploadRestoreChunk));
router.post('/backup/restore/uploads/:id/complete', requireRole('admin'), (req, _res, next) => {
  if (req.headers['x-restore-confirmation'] !== 'RESTORE') return next(BadRequest('Restore confirmation is required.'));
  next();
}, asyncHandler(settingsController.restoreBackup));
router.get('/backup/restore/uploads/:id/status', requireRole('admin'), asyncHandler(settingsController.getRestoreStatus));
router.put(
  '/penalty',
  requireRole('admin'),
  requirePasskey(),
  validate({ body: updatePenaltySchema }),
  asyncHandler(settingsController.updatePenalty),
);
router.put('/loan-number', requireRole('admin'), requirePasskey(),
  validate({ body: updateLoanNumberSchema }), asyncHandler(settingsController.updateLoanNumber));
router.put('/branding', requireRole('admin'), requirePasskey(),
  validate({ body: updateBrandingSchema }), asyncHandler(settingsController.updateBranding));
const brandingUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
router.put('/branding/assets/:kind', requireRole('admin'), requirePasskey(),
  brandingUpload.single('image'), asyncHandler(settingsController.uploadBrandingAsset));

export default router;
