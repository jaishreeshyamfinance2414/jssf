import { Request, Response } from 'express';
import { created, ok } from '../../shared/http';
import { salaryRepository } from './salary.repository';
import { salaryService } from './salary.service';

export const salaryController = {
  async list(_req: Request, res: Response) {
    return ok(res, await salaryRepository.list());
  },

  async members(_req: Request, res: Response) {
    return ok(res, await salaryRepository.members());
  },

  async userExpenses(_req: Request, res: Response) {
    return ok(res, await salaryRepository.userExpenses());
  },

  async payable(req: Request, res: Response) {
    return ok(res, await salaryService.payable(req.query as any));
  },

  async upsertMember(req: Request, res: Response) {
    return ok(res, await salaryService.upsertMember(req.body, req.user!.sub, req.ip));
  },

  async create(req: Request, res: Response) {
    return created(res, await salaryService.create(req.body, req.user!.sub, req.ip));
  },

  async remove(req: Request, res: Response) {
    return ok(res, await salaryService.remove(req.params.id, req.user!.sub, req.ip));
  },
};
