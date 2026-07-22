import { Router } from 'express';
import { asyncHandler } from '../../shared/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { NotFound } from '../../shared/errors';
import { getObject } from './r2';

const router = Router();

// Object keys are "<category>/<uuid>.<ext>" — category and filename are each a
// single path segment with no slashes or dots-dots, so no traversal is possible.
const SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Every uploaded document (customer/guarantor photos, Aadhaar, PAN, bills) is
 * PII, so it's served only to authenticated users holding customer.view. The
 * bytes are streamed from the private R2 bucket through this route — the bucket
 * is never public and the browser never sees R2 credentials.
 */
router.get(
  '/:category/:filename',
  authenticate,
  requirePermission('customer.view'),
  asyncHandler(async (req, res) => {
    const { category, filename } = req.params;
    if (!SEGMENT.test(category) || !SEGMENT.test(filename)) throw NotFound('File not found');

    const object = await getObject(`${category}/${filename}`);
    if (!object) throw NotFound('File not found');

    // Defense-in-depth against stored XSS: never let the browser execute an
    // uploaded file in the API origin, even if a malicious one slipped through.
    res.set('Content-Disposition', 'attachment');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'; sandbox");
    if (object.contentType) res.set('Content-Type', object.contentType);

    object.body.on('error', () => {
      if (!res.headersSent) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'File not found' } });
      } else {
        res.destroy();
      }
    });
    object.body.pipe(res);
  }),
);

export default router;
