import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { parse } from 'dotenv';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { env } from '../../config/env';
import { r2 } from '../files/r2';

export type StorageStatus = { connected: boolean; checkedAt: string; message: string };

async function b2Config() {
  const path = process.env.BACKUP_ENV_FILE || join(homedir(), '.config', 'jssf', 'backup.env');
  let file: Record<string, string> = {};
  try {
    file = parse(await readFile(path));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const value = (key: string) => process.env[key] || file[key] || '';
  const bucket = value('B2_BUCKET');
  const keyId = value('B2_KEY_ID');
  const applicationKey = value('B2_APPLICATION_KEY');
  const endpoint = value('B2_ENDPOINT');
  if (!bucket || !keyId || !applicationKey || !endpoint) return null;
  const region = value('B2_REGION') || new URL(endpoint).hostname.match(/^s3\.([^.]+)\./)?.[1];
  if (!region) return null;
  return { bucket, keyId, applicationKey, endpoint, region };
}

export async function checkStorage(provider: 'b2' | 'r2'): Promise<StorageStatus> {
  const checkedAt = new Date().toISOString();
  try {
    if (provider === 'r2') {
      await r2.send(new HeadBucketCommand({ Bucket: env.R2_BUCKET }), { abortSignal: AbortSignal.timeout(10000) });
    } else {
      const config = await b2Config();
      if (!config) return { connected: false, checkedAt, message: 'B2 credentials are not configured on the server.' };
      const client = new S3Client({
        region: config.region,
        endpoint: config.endpoint,
        credentials: { accessKeyId: config.keyId, secretAccessKey: config.applicationKey },
      });
      try {
        await client.send(new HeadBucketCommand({ Bucket: config.bucket }), { abortSignal: AbortSignal.timeout(10000) });
      } finally {
        client.destroy();
      }
    }
    return { connected: true, checkedAt, message: 'Connection successful.' };
  } catch {
    return { connected: false, checkedAt, message: 'Could not access the storage bucket. Check server credentials and network access.' };
  }
}
