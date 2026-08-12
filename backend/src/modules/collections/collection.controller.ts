import { Request, Response } from 'express';
import { created, ok } from '../../shared/http';
import { collectionRepository } from './collection.repository';
import { collectionService } from './collection.service';
import { sweepMissedEmis } from './missed-emi.job';

export const collectionController = {
  async list(_req: Request, res: Response) {
    return ok(res, await collectionRepository.list());
  },

  async due(_req: Request, res: Response) {
    return ok(res, await collectionRepository.todaysDue());
  },

  async sheet(_req: Request, res: Response) {
    return ok(res, await collectionRepository.sheet());
  },

  async sheetAgents(_req: Request, res: Response) {
    return ok(res, await collectionRepository.sheetAgents());
  },

  async sweep(_req: Request, res: Response) {
    const result = await sweepMissedEmis();
    return ok(res, result);
  },

  async create(req: Request, res: Response) {
    return created(res, await collectionService.record(req.body, req.user!.sub, req.user!.role, req.ip));
  },

  async update(req: Request, res: Response) {
    return ok(res, await collectionService.update(req.params.id, req.body, req.user!.sub, req.ip));
  },

  async remove(req: Request, res: Response) {
    return ok(res, await collectionService.remove(req.params.id, req.user!.sub, req.ip));
  },
};

