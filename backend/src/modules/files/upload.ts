import { randomUUID } from 'node:crypto';
import multer, { FileFilterCallback } from 'multer';
import { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env';
import { BadRequest } from '../../shared/errors';
import { putObject } from './r2';

/**
 * Uploads are buffered in memory (not written to disk), verified by magic
 * bytes, then streamed to Cloudflare R2 under "<category>/<uuid>.<ext>". The
 * category comes from the route (customers, guarantors, expenses), never from
 * user input, so a malicious filename can't escape its prefix.
 *
 * Security: the stored extension comes from the whitelisted MIME type — the
 * client's filename is never trusted. Magic bytes are sniffed BEFORE the upload,
 * so content that doesn't match its declared type (e.g. HTML disguised as
 * image/png) is rejected without ever reaching R2.
 */
const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

const fileFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
  if (!MIME_EXT[file.mimetype]) {
    cb(new Error(`Unsupported file type: ${file.mimetype}`));
    return;
  }
  cb(null, true);
};

/** True when the file's leading bytes match its claimed MIME type. */
function magicBytesMatch(buf: Buffer, mimetype: string): boolean {
  switch (mimetype) {
    case 'image/jpeg':
      return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case 'image/png':
      return buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp':
      return buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';
    case 'application/pdf':
      return buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-';
    default:
      return false;
  }
}

/** Flatten multer's req.files (fields or array form) into one list. */
function allUploadedFiles(req: Request): Express.Multer.File[] {
  if (!req.files) return req.file ? [req.file] : [];
  if (Array.isArray(req.files)) return req.files;
  return Object.values(req.files).flat();
}

/**
 * Verify each buffered file's magic bytes, then upload it to R2. Mount
 * immediately after the multer middleware, scoped to the same category.
 *
 * On any content mismatch the request is rejected before any upload; files
 * already sent to R2 in this request are deleted so a rejected submission
 * leaves nothing behind. On success each file gets `.filename` (the R2 key's
 * basename) so relativeUploadPath() persists "<category>/<filename>" — the
 * exact string format the DB used under local-disk storage.
 */
export const storeUploadedFiles = (category: string) =>
  async function storeUploadedFilesMw(req: Request, _res: Response, next: NextFunction) {
    const files = allUploadedFiles(req);
    const uploadedKeys: string[] = [];
    try {
      for (const file of files) {
        if (!magicBytesMatch(file.buffer.subarray(0, 12), file.mimetype)) {
          throw BadRequest(`File "${file.originalname}" content does not match its declared type`);
        }
      }
      // All files passed verification — now upload. Done in a second pass so a
      // late mismatch never leaves half a submission in the bucket.
      for (const file of files) {
        const filename = `${randomUUID()}${MIME_EXT[file.mimetype] ?? ''}`;
        const key = `${category}/${filename}`;
        await putObject(key, file.buffer, file.mimetype);
        uploadedKeys.push(key);
        file.filename = filename;
      }
      next();
    } catch (err) {
      const { deleteObject } = await import('./r2');
      await Promise.allSettled(uploadedKeys.map((k) => deleteObject(k)));
      next(err);
    }
  };

/** Build an upload middleware scoped to a category. Files are held in memory. */
export const uploadTo = (_category: string) =>
  multer({
    storage: multer.memoryStorage(),
    fileFilter,
    limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 },
  });

/** Store the relative path (category/filename) — what we persist in the DB. */
export const relativeUploadPath = (category: string, file: Express.Multer.File) =>
  `${category}/${file.filename}`;
