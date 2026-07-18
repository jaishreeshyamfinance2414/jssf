import { Request, Response } from 'express';
import { created, ok } from '../../shared/http';
import { expenseRepository } from './expense.repository';
import { expenseService } from './expense.service';

export const expenseController = {
  async list(_req: Request, res: Response) {
    return ok(res, await expenseRepository.list());
  },

  async categories(_req: Request, res: Response) {
    return ok(res, await expenseRepository.categories());
  },

  async create(req: Request, res: Response) {
    return created(res, await expenseService.create(req.body, req.user!.sub, req.ip));
  },
};
