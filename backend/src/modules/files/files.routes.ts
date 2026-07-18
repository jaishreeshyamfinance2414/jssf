import path from 'node:path';
import { Router } from 'express';
import { asyncHandler } from '../../shared/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { NotFound } from '../../shared/errors';
import { env } from '../../config/env';

const router = Router();

const UPLOAD_ROOT = path.resolve(env.UPLOAD_DIR);

/**
 * Every uploaded document (customer/guarantor photos, Aadhaar, PAN, bills) is
 * PII, so it's served only to authenticated users holding customer.view —
 * never via unauthenticated express.static. Path is resolved and checked
 * against the upload root to reject traversal (../../etc/passwd style).
 */
router.get(
  '/:category/:filename',
  authenticate,
  requirePermission('customer.view'),
  asyncHandler(async (req, res) => {
    const { category, filename } = req.params;
    const resolved = path.resolve(UPLOAD_ROOT, category, filename);
    if (!resolved.startsWith(UPLOAD_ROOT + path.sep)) throw NotFound('File not found');
    res.sendFile(resolved, (err) => {
      if (err && !res.headersSent) res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'File not found' } });
    });
  }),
);

export default router;
