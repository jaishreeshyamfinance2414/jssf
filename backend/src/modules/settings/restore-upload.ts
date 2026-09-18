import { randomUUID } from 'node:crypto';
import { appendFile, mkdtemp, rm, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequest, Conflict, NotFound } from '../../shared/errors';

export const RESTORE_CHUNK_BYTES = 8 * 1024 * 1024;
const SESSION_MS = 2 * 60 * 60 * 1000;
const DISK_RESERVE_BYTES = 1024 * 1024 * 1024;

type Session = {
  owner: string;
  name: string;
  size: number;
  received: number;
  nextIndex: number;
  busy: boolean;
  status: 'uploading' | 'restoring' | 'complete' | 'failed';
  error?: string;
  directory: string;
  path: string;
  expiresAt: number;
};
const sessions = new Map<string, Session>();

async function availableBytes() {
  const disk = await statfs(tmpdir());
  return Number(disk.bavail) * Number(disk.bsize);
}

async function discard(id: string, session: Session) {
  sessions.delete(id);
  await rm(session.directory, { recursive: true, force: true });
}

export async function startRestoreUpload(owner: string, name: string, size: number) {
  if (!name.toLowerCase().endsWith('.sql.gz') || !Number.isSafeInteger(size) || size <= 0) {
    throw BadRequest('Select a valid .sql.gz backup file.');
  }
  for (const [id, session] of sessions) {
    if (session.owner === owner) {
      if (session.busy || session.status === 'restoring') throw Conflict('A restore is already in progress.');
      await discard(id, session);
    }
  }
  if (size + DISK_RESERVE_BYTES > await availableBytes()) {
    throw Conflict('The server does not have enough temporary disk space for this backup.');
  }
  const directory = await mkdtemp(join(tmpdir(), 'jssf-upload-'));
  const id = randomUUID();
  sessions.set(id, { owner, name, size, received: 0, nextIndex: 0, busy: false, status: 'uploading',
    directory, path: join(directory, 'backup.sql.gz'), expiresAt: Date.now() + SESSION_MS });
  return { uploadId: id, chunkSize: RESTORE_CHUNK_BYTES };
}

function getSession(id: string, owner: string) {
  const session = sessions.get(id);
  if (!session || session.owner !== owner) throw NotFound('Restore upload not found. Start again.');
  if (session.expiresAt < Date.now() && session.status !== 'restoring') {
    void discard(id, session).catch(() => undefined);
    throw Conflict('Restore upload expired. Start again.');
  }
  return session;
}

export async function appendRestoreChunk(id: string, owner: string, index: number, chunk: Buffer) {
  const session = getSession(id, owner);
  if (session.status !== 'uploading') throw Conflict('This restore upload is no longer accepting chunks.');
  if (session.busy) throw Conflict('A restore chunk is already being saved.');
  if (!Number.isSafeInteger(index) || index !== session.nextIndex) throw Conflict('Restore chunks must be uploaded in order.');
  const remaining = session.size - session.received;
  if (chunk.length === 0 || chunk.length > RESTORE_CHUNK_BYTES || chunk.length !== Math.min(RESTORE_CHUNK_BYTES, remaining)) {
    throw BadRequest('Restore chunk has an unexpected size.');
  }
  session.busy = true;
  try {
    await appendFile(session.path, chunk);
  } catch (error) {
    await discard(id, session);
    throw error;
  } finally {
    session.busy = false;
  }
  session.received += chunk.length;
  session.nextIndex++;
  session.expiresAt = Date.now() + SESSION_MS;
  return { received: session.received, size: session.size };
}

export function completedRestoreUpload(id: string, owner: string) {
  const session = getSession(id, owner);
  if (session.status !== 'uploading') throw Conflict('This restore has already started.');
  if (session.busy) throw Conflict('Wait for the current restore chunk to finish.');
  if (session.received !== session.size) throw Conflict('Backup upload is incomplete.');
  return session;
}

export function beginRestore(id: string, owner: string) {
  const session = completedRestoreUpload(id, owner);
  session.status = 'restoring';
  session.expiresAt = Date.now() + SESSION_MS;
  return session;
}

export async function finishRestoreUpload(id: string, owner: string, error?: string) {
  const session = sessions.get(id);
  if (session?.owner !== owner) return;
  session.status = error ? 'failed' : 'complete';
  session.error = error;
  session.expiresAt = Date.now() + SESSION_MS;
  await rm(session.directory, { recursive: true, force: true });
}

export function restoreUploadStatus(id: string, owner: string) {
  const session = getSession(id, owner);
  return { status: session.status, error: session.error || null };
}

const cleanupTimer = setInterval(() => {
  for (const [id, session] of sessions) {
    if (session.expiresAt < Date.now() && !session.busy && session.status !== 'restoring') {
      void discard(id, session).catch(() => undefined);
    }
  }
}, 10 * 60 * 1000);
cleanupTimer.unref();
