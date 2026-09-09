import { Request, Response } from 'express';
import { settingsRepository } from './settings.repository';
import { UpdatePenaltyBody } from './settings.schema';
import { audit } from '../audit/audit.service';
import { ok } from '../../shared/http';

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
};
