import { Request, Response } from 'express';
import { created, ok } from '../../shared/http';
import { capitalRepository } from './capital.repository';
import { capitalService } from './capital.service';
import { CreateCapitalEntryBody, CreateCapitalWithdrawalBody } from './capital.schema';

export const capitalController = {
  async list(_req: Request, res: Response) {
    const [entries, withdrawals, totalIntroduced, totalWithdrawn] = await Promise.all([
      capitalRepository.list(),
      capitalRepository.listWithdrawals(),
      capitalRepository.totalIntroduced(),
      capitalRepository.totalWithdrawn(),
    ]);
    return ok(res, {
      entries,
      withdrawals,
      totalIntroduced,
      totalWithdrawn,
      netCapital: totalIntroduced - totalWithdrawn,
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

  async withdraw(req: Request, res: Response) {
    const body = req.body as CreateCapitalWithdrawalBody;
    const withdrawal = await capitalService.withdraw(
      { ...body, createdBy: req.user!.sub },
      req.ip,
    );
    return created(res, withdrawal);
  },
};
