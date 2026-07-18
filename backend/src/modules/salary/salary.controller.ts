import { Request, Response } from 'express';
import { created, ok } from '../../shared/http';
import { salaryRepository } from './salary.repository';
import { salaryService } from './salary.service';

export const salaryController = {
  async list(_req: Request, res: Response) {
    return ok(res, await salaryRepository.list());
  },

  async create(req: Request, res: Response) {
    return created(res, await salaryService.create(req.body, req.user!.sub, req.ip));
  },

  async remove(req: Request, res: Response) {
    return ok(res, await salaryService.remove(req.params.id, req.user!.sub, req.ip));
  },
};
