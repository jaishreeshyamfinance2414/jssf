import { Request, Response } from 'express';
import { created, ok } from '../../shared/http';
import { capitalRepository } from './capital.repository';
import { capitalService } from './capital.service';
import { CreateCapitalEntryBody } from './capital.schema';

export const capitalController = {
  async list(_req: Request, res: Response) {
    return ok(res, {
      entries: await capitalRepository.list(),
      totalIntroduced: await capitalRepository.totalIntroduced(),
    });
  },

  async create(req: Request, res: Response) {
    const body = req.body as CreateCapitalEntryBody;
    const entry = await capitalService.recordEntry(
      { ...body, createdBy: req.user!.sub },
      req.ip,
    );
    return created(res, entry);
  },
};
