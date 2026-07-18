import { Request, Response } from 'express';
import { ok } from '../../shared/http';
import { accountsRepository } from './accounts.repository';

export const accountsController = {
  async list(_req: Request, res: Response) {
    return ok(res, await accountsRepository.listWithBalances());
  },

  async transactions(req: Request, res: Response) {
    return ok(res, await accountsRepository.transactionsFor(req.params.id));
  },
};
