import { Request, Response } from 'express';
import { settingsRepository } from './settings.repository';
import { UpdatePenaltyBody } from './settings.schema';
import { audit } from '../audit/audit.service';
import { ok } from '../../shared/http';
import { AppError, BadRequest, Conflict } from '../../shared/errors';
import { checkStorage } from './backup.service';
import { createDatabaseExport } from './database-export';
import { restoreDatabase } from './database-restore';
import { appendRestoreChunk, beginRestore, finishRestoreUpload, restoreUploadStatus, startRestoreUpload } from './restore-upload';
import { logger } from '../../config/logger';

let backupOperationInProgress = false;

export const settingsController = {
  async getAll(_req: Request, res: Response) {
    const settings = await settingsRepository.getAll();
    return ok(res, settings);
  },

  async updatePenalty(req: Request, res: Response) {
    const body = req.body as UpdatePenaltyBody;
    const oldValue = await settingsRepository.get<{ per_day_pct: number }>('penalty');
    await settingsRepository.update('penalty', { per_day_pct: body.per_day_pct });
    await audit({
      actorId: req.user!.sub,
      action: 'SETTING_UPDATED',
      entity: 'setting',
      entityId: 'penalty',
      meta: { old: oldValue, new: { per_day_pct: body.per_day_pct } },
      ip: req.ip,
    });
    return ok(res, { per_day_pct: body.per_day_pct });
  },

  async checkBackupStorage(req: Request, res: Response) {
    const provider = req.params.provider as 'b2' | 'r2';
    return ok(res, await checkStorage(provider));
  },

  async downloadBackup(req: Request, res: Response) {
    if (backupOperationInProgress) throw Conflict('A backup operation is already in progress. Try again shortly.');
    backupOperationInProgress = true;
    let archive: Awaited<ReturnType<typeof createDatabaseExport>> | undefined;
    try {
      archive = await createDatabaseExport();
      await audit({
        actorId: req.user!.sub,
        action: 'DATABASE_BACKUP_REQUESTED',
        entity: 'database',
        entityId: 'jssf',
        meta: { filename: archive.filename },
        ip: req.ip,
      });
      res.download(archive.path, archive.filename, (error) => {
        void archive!.cleanup().finally(() => { backupOperationInProgress = false; });
        if (error && !res.headersSent) res.status(500).end();
      });
    } catch (error) {
      if (archive) await archive.cleanup();
      backupOperationInProgress = false;
      throw error;
    }
  },

  async startRestoreUpload(req: Request, res: Response) {
    if (backupOperationInProgress) throw Conflict('A backup operation is already in progress. Try again shortly.');
    const { filename, size } = req.body as { filename?: string; size?: number };
    if (!filename || typeof size !== 'number') throw BadRequest('Backup filename and size are required.');
    return ok(res, await startRestoreUpload(req.user!.sub, filename, size));
  },

  async uploadRestoreChunk(req: Request, res: Response) {
    if (!Buffer.isBuffer(req.body)) throw BadRequest('Expected a backup file chunk.');
    return ok(res, await appendRestoreChunk(req.params.id, req.user!.sub, Number(req.params.index), req.body));
  },

  async restoreBackup(req: Request, res: Response) {
    if (backupOperationInProgress) throw Conflict('A backup operation is already in progress. Try again shortly.');
    const owner = req.user!.sub;
    const id = req.params.id;
    const upload = beginRestore(id, owner);
    backupOperationInProgress = true;
    const ip = req.ip;
    void (async () => {
      let errorMessage: string | undefined;
      try {
        await restoreDatabase(upload.path);
        await audit({
          actorId: owner,
          action: 'DATABASE_BACKUP_RESTORED',
          entity: 'database',
          entityId: 'jssf',
          meta: { filename: upload.name, bytes: upload.size },
          ip,
        });
      } catch (error) {
        logger.error({ err: error }, 'Database restore failed');
        errorMessage = error instanceof AppError
          ? error.message : 'Restore failed. Check the server logs and backup file.';
      } finally {
        await finishRestoreUpload(id, owner, errorMessage).catch((error) => logger.error({ err: error }, 'Restore cleanup failed'));
        backupOperationInProgress = false;
      }
    })();
    return ok(res, { status: 'restoring' }, 202);
  },

  async getRestoreStatus(req: Request, res: Response) {
    return ok(res, restoreUploadStatus(req.params.id, req.user!.sub));
  },
};
