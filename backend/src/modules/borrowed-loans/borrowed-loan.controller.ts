import { Request, Response } from 'express';
import { created, ok } from '../../shared/http';
import { borrowedLoanRepository } from './borrowed-loan.repository';
import { borrowedLoanService } from './borrowed-loan.service';

export const borrowedLoanController = {
  async list(_req: Request, res: Response) {
    return ok(res, await borrowedLoanRepository.list());
  },
  async payments(req: Request, res: Response) {
    return ok(res, await borrowedLoanRepository.payments(req.params.id));
  },
  async create(req: Request, res: Response) {
    return created(res, await borrowedLoanService.create(req.body, req.user!.sub, req.ip));
  },
  async recordPayment(req: Request, res: Response) {
    return created(res, await borrowedLoanService.recordPayment(req.params.id, req.body, req.user!.sub, req.ip));
  },
};
