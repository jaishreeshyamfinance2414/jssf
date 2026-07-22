import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { env } from '../../config/env';

/**
 * Cloudflare R2 client (S3-compatible). All customer documents live in one
 * private bucket, keyed as "<category>/<uuid>.<ext>" — the same string we store
 * in the DB, so switching from local disk to R2 needed no schema change.
 *
 * The bucket is private: objects are never public-readable. They're streamed
 * back to the browser only through the authenticated /files route, which holds
 * the credentials — the client never talks to R2 directly.
 */
export const r2 = new S3Client({
  region: env.R2_REGION,
  endpoint: env.R2_ENDPOINT,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

/** Upload a buffer under the given key. Content-Type drives the download later. */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await r2.send(
    new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Body: body, ContentType: contentType }),
  );
}

/** Fetch an object for streaming. Returns null when the key doesn't exist. */
export async function getObject(key: string): Promise<{ body: Readable; contentType?: string } | null> {
  try {
    const res = await r2.send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
    return { body: res.Body as Readable, contentType: res.ContentType };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** Copy an object within the bucket (used to commit staged uploads). */
export async function copyObject(srcKey: string, destKey: string): Promise<void> {
  await r2.send(
    new CopyObjectCommand({
      Bucket: env.R2_BUCKET,
      // CopySource must include the bucket name and be URI-encoded.
      CopySource: encodeURI(`${env.R2_BUCKET}/${srcKey}`),
      Key: destKey,
    }),
  );
}

/** Best-effort delete; a missing key is treated as already gone. */
export async function deleteObject(key: string): Promise<void> {
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
}

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
}
