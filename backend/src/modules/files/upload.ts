import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import multer, { FileFilterCallback } from 'multer';
import { Request } from 'express';
import { env } from '../../config/env';

/**
 * Multer disk storage: files land under uploads/<category>/<uuid>.<ext>. The
 * category comes from the route (customers, guarantors, expenses), never from
 * user input, so path traversal via filename isn't possible.
 */
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

function storageFor(category: string) {
  const dir = path.join(env.UPLOAD_DIR, category);
  fs.mkdirSync(dir, { recursive: true });
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname)}`),
  });
}

const fileFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    cb(new Error(`Unsupported file type: ${file.mimetype}`));
    return;
  }
  cb(null, true);
};

/** Build an upload middleware scoped to a category subfolder. */
export const uploadTo = (category: string) =>
  multer({
    storage: storageFor(category),
    fileFilter,
    limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 },
  });

/** Store the relative path (category/filename) — what we persist in the DB. */
export const relativeUploadPath = (category: string, file: Express.Multer.File) =>
  `${category}/${file.filename}`;
