import { Request, Response } from 'express';
import { created, ok } from '../../shared/http';
import { reminderRepository } from './reminder.repository';
import { reminderService } from './reminder.service';

export const reminderController = {
  async list(_req: Request, res: Response) {
    return ok(res, await reminderRepository.list());
  },
  async notifications(_req: Request, res: Response) {
    return ok(res, await reminderRepository.notifications());
  },
  async create(req: Request, res: Response) {
    return created(res, await reminderService.create(req.body, req.user!.sub, req.ip));
  },
  async complete(req: Request, res: Response) {
    return ok(res, await reminderService.complete(req.params.id, req.user!.sub, req.ip));
  },
  async delete(req: Request, res: Response) {
    return ok(res, await reminderService.delete(req.params.id, req.user!.sub, req.ip));
  },
};
