import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import multer, { FileFilterCallback } from 'multer';
import { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env';
import { BadRequest } from '../../shared/errors';

/**
 * Multer disk storage: files land under uploads/<category>/<uuid>.<ext>. The
 * category comes from the route (customers, guarantors, expenses), never from
 * user input, so path traversal via filename isn't possible.
 *
 * Security: the stored extension comes from the whitelisted MIME type — the
 * client's filename (and its extension) is never trusted. After the write,
 * verifyUploadedFiles() sniffs each file's magic bytes and rejects anything
 * whose actual content doesn't match its declared type (e.g. HTML disguised
 * as image/png), deleting the offending files.
 */
const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

function storageFor(category: string) {
  const dir = path.join(env.UPLOAD_DIR, category);
  fs.mkdirSync(dir, { recursive: true });
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${MIME_EXT[file.mimetype] ?? ''}`),
  });
}

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
 * Post-upload content verification — mount immediately after the multer
 * middleware. Sniffs each stored file's magic bytes against its declared
 * MIME; on any mismatch every file from this request is deleted and the
 * request is rejected.
 */
export async function verifyUploadedFiles(req: Request, _res: Response, next: NextFunction) {
  const files = allUploadedFiles(req);
  try {
    for (const file of files) {
      const fd = await fsp.open(file.path, 'r');
      const buf = Buffer.alloc(12);
      try {
        await fd.read(buf, 0, 12, 0);
      } finally {
        await fd.close();
      }
      if (!magicBytesMatch(buf, file.mimetype)) {
        await Promise.allSettled(files.map((f) => fsp.unlink(f.path)));
        next(BadRequest(`File "${file.originalname}" content does not match its declared type`));
        return;
      }
    }
    next();
  } catch (err) {
    await Promise.allSettled(files.map((f) => fsp.unlink(f.path)));
    next(err);
  }
}

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
