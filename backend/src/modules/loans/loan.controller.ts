import { Request, Response } from 'express';
import { created, ok } from '../../shared/http';
import { gateOrExecute } from '../approvals/approval.gate';
import { loanRepository, LoanStatus } from './loan.repository';
import { loanService } from './loan.service';

export const loanController = {
  async list(req: Request, res: Response) {
    const status = typeof req.query.status === 'string' ? (req.query.status as LoanStatus) : undefined;
    return ok(res, await loanRepository.list(status));
  },

  async search(req: Request, res: Response) {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    return ok(res, await loanRepository.searchActive(q));
  },

  async detail(req: Request, res: Response) {
    const loan = await loanRepository.findById(req.params.id);
    return ok(res, {
      loan,
      schedule: await loanRepository.emiSchedule(req.params.id),
      collections: await loanRepository.collectionsFor(req.params.id),
    });
  },

  async create(req: Request, res: Response) {
    return created(res, await loanService.create(req.body, req.user!.sub, req.ip));
  },

  async update(req: Request, res: Response) {
    return ok(res, await loanService.update(req.params.id, req.body, req.user!.sub, req.ip));
  },

  async approve(req: Request, res: Response) {
    return gateOrExecute(req, res, {
      actionType: 'loan.approve',
      entityType: 'loan',
      entityId: req.params.id,
      payload: {},
      execute: () => loanService.approve(req.params.id, req.user!.sub, req.ip),
    });
  },

  async unapprove(req: Request, res: Response) {
    return ok(res, { status: 'applied', result: await loanService.unapprove(req.params.id, req.user!.sub, req.ip) });
  },

  async remove(req: Request, res: Response) {
    return ok(res, await loanService.remove(req.params.id, req.user!.sub, req.ip));
  },

  async reject(req: Request, res: Response) {
    return gateOrExecute(req, res, {
      actionType: 'loan.reject',
      entityType: 'loan',
      entityId: req.params.id,
      payload: { reason: req.body.reason },
      execute: () => loanService.reject(req.params.id, req.body.reason, req.user!.sub, req.ip),
    });
  },

  async close(req: Request, res: Response) {
    return gateOrExecute(req, res, {
      actionType: 'loan.close',
      entityType: 'loan',
      entityId: req.params.id,
      payload: req.body,
      execute: () => loanService.close(req.params.id, req.body, req.user!.sub, req.ip),
    });
  },

  async disburse(req: Request, res: Response) {
    return gateOrExecute(req, res, {
      actionType: 'loan.disburse',
      entityType: 'loan',
      entityId: req.params.id,
      payload: { mode: req.body.mode, loanDate: req.body.loanDate },
      execute: () => loanService.disburse(req.params.id, req.body.mode, req.body.loanDate, req.user!.sub, req.ip),
    });
  },
};
