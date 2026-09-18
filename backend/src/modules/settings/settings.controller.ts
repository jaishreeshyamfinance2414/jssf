import { Request, Response } from 'express';
import { settingsRepository } from './settings.repository';
import { UpdatePenaltyBody, UpdateLoanNumberBody, UpdateBrandingBody, UpdateBackupCronBody } from './settings.schema';
import { audit } from '../audit/audit.service';
import { ok } from '../../shared/http';
import { AppError, BadRequest, Conflict } from '../../shared/errors';
import { checkStorage } from './backup.service';
import { createDatabaseExport } from './database-export';
import { restoreDatabase } from './database-restore';
import { appendRestoreChunk, beginRestore, finishRestoreUpload, restoreUploadStatus, startRestoreUpload } from './restore-upload';
import { logger } from '../../config/logger';
import { backupCronStatus, setBackupCron } from './backup-cron.service';

let backupOperationInProgress = false;

export const settingsController = {
  async getBranding(_req: Request, res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return ok(res, await settingsRepository.branding());
  },

  async getBrandingAsset(req: Request, res: Response) {
    const kind = req.params.kind;
    if (kind !== 'logo' && kind !== 'favicon') throw BadRequest('Unknown branding asset');
    const asset = await settingsRepository.getBrandingAsset(kind);
    if (!asset) {
      if (kind === 'logo') return res.status(404).end();
      // A generated text placeholder keeps the browser tab free of bundled branding.
      const placeholder = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="20" fill="#f5f4ef"/><text x="64" y="69" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="bold" fill="#17251e">Upcoming</text></svg>';
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(placeholder);
    }
    res.setHeader('Content-Type', asset.content_type);
    res.setHeader('Content-Length', asset.bytes.length);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.end(asset.bytes);
  },

  async getBrandingManifest(_req: Request, res: Response) {
    const branding = await settingsRepository.branding();
    const icon = `/api/v1/settings/branding/assets/favicon${branding.faviconVersion ? `?v=${encodeURIComponent(branding.faviconVersion)}` : ''}`;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/manifest+json');
    return res.json({ name: branding.businessName, short_name: branding.businessName,
      description: 'Loan Management System', id: '/', start_url: '/', scope: '/', display: 'standalone',
      background_color: '#F5F4EF', theme_color: '#12805A',
      icons: [{ src: icon, sizes: 'any', type: branding.faviconVersion ? 'image/png' : 'image/svg+xml', purpose: 'any' }] });
  },
  async getAll(_req: Request, res: Response) {
    const settings = await settingsRepository.getAll();
    return ok(res, settings);
  },

  async getBackupCron(_req: Request, res: Response) {
    return ok(res, await backupCronStatus());
  },

  async updateBackupCron(req: Request, res: Response) {
    const { enabled, time } = req.body as UpdateBackupCronBody;
    const old = await backupCronStatus();
    const next = await setBackupCron(enabled, time);
    await audit({ actorId: req.user!.sub, action: 'SETTING_UPDATED', entity: 'setting',
      entityId: 'backup_cron', meta: { old, new: next }, ip: req.ip });
    return ok(res, next);
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

  async updateLoanNumber(req: Request, res: Response) {
    const { prefix } = req.body as UpdateLoanNumberBody;
    const oldValue = await settingsRepository.get<{ prefix: string; pad: number }>('loan_number');
    const next = { ...oldValue, prefix: prefix.toUpperCase() };
    await settingsRepository.update('loan_number', next);
    await audit({ actorId: req.user!.sub, action: 'SETTING_UPDATED', entity: 'setting',
      entityId: 'loan_number', meta: { old: oldValue, new: next }, ip: req.ip });
    return ok(res, next);
  },

  async updateBranding(req: Request, res: Response) {
    const { businessName } = req.body as UpdateBrandingBody;
    const old = await settingsRepository.branding();
    await settingsRepository.update('branding', { businessName });
    await audit({ actorId: req.user!.sub, action: 'SETTING_UPDATED', entity: 'setting',
      entityId: 'branding', meta: { old: old.businessName, new: businessName }, ip: req.ip });
    return ok(res, await settingsRepository.branding());
  },

  async uploadBrandingAsset(req: Request, res: Response) {
    const kind = req.params.kind;
    if (kind !== 'logo' && kind !== 'favicon') throw BadRequest('Unknown branding asset');
    const file = req.file;
    if (!file) throw BadRequest('Choose an image to upload');
    const b = file.buffer;
    const png = b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg = b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255;
    const webp = b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';
    const valid = (file.mimetype === 'image/png' && png) ||
      (kind === 'logo' && file.mimetype === 'image/jpeg' && jpeg) ||
      (kind === 'logo' && file.mimetype === 'image/webp' && webp);
    if (!valid) throw BadRequest(kind === 'favicon' ? 'Favicon must be a PNG image' : 'Logo must be a PNG, JPEG, or WebP image');
    if (kind === 'favicon') {
      const width = b.readUInt32BE(16);
      const height = b.readUInt32BE(20);
      if (width !== height || width < 48 || width > 1024) throw BadRequest('Favicon must be a square PNG between 48 and 1024 pixels');
    }
    await settingsRepository.putBrandingAsset(kind, file.mimetype, b);
    await audit({ actorId: req.user!.sub, action: 'SETTING_UPDATED', entity: 'setting',
      entityId: `branding.${kind}`, meta: { contentType: file.mimetype, bytes: b.length }, ip: req.ip });
    return ok(res, await settingsRepository.branding());
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
