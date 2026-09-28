import { Request, Response } from 'express';
import { created, ok } from '../../shared/http';
import { gateOrExecute } from '../approvals/approval.gate';
import { loanRepository, LoanStatus } from './loan.repository';
import { loanService } from './loan.service';
import { Forbidden, NotFound } from '../../shared/errors';
import { customerRepository } from '../customers/customer.repository';

async function verifyLoanArea(req: Request, loanId: string) {
  if (!req.areaIds) return;
  const loan = await loanRepository.findById(loanId);
  if (!loan) throw NotFound('Loan not found');
  if (!loan.area_id || !req.areaIds.includes(loan.area_id)) throw Forbidden('You do not have access to this loan');
}

export const loanController = {
  async list(req: Request, res: Response) {
    const status = typeof req.query.status === 'string' ? (req.query.status as LoanStatus) : undefined;
    return ok(res, await loanRepository.list(status, req.areaIds));
  },

  async search(req: Request, res: Response) {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    return ok(res, await loanRepository.searchActive(q, req.areaIds));
  },

  async detail(req: Request, res: Response) {
    const loan = await loanRepository.findById(req.params.id);
    if (!loan) throw NotFound('Loan not found');
    if (req.areaIds && (!loan.area_id || !req.areaIds.includes(loan.area_id))) throw Forbidden('You do not have access to this loan');
    return ok(res, {
      loan,
      schedule: await loanRepository.emiSchedule(req.params.id),
      collections: await loanRepository.collectionsFor(req.params.id),
    });
  },

  async create(req: Request, res: Response) {
    if (req.areaIds) {
      const customer = await customerRepository.findById(req.body.customerId);
      if (!customer || !customer.area_id || !req.areaIds.includes(customer.area_id)) throw Forbidden('Customer is not in your assigned area');
    }
    return created(res, await loanService.create(req.body, req.user!.sub, req.user!.role, req.ip));
  },

  async update(req: Request, res: Response) {
    await verifyLoanArea(req, req.params.id);
    return ok(res, await loanService.update(req.params.id, req.body, req.user!.sub, req.ip, req.user!.role));
  },

  async approve(req: Request, res: Response) {
    await verifyLoanArea(req, req.params.id);
    return gateOrExecute(req, res, {
      actionType: 'loan.approve',
      entityType: 'loan',
      entityId: req.params.id,
      payload: {},
      execute: () => loanService.approve(req.params.id, req.user!.sub, req.ip),
    });
  },

  async unapprove(req: Request, res: Response) {
    await verifyLoanArea(req, req.params.id);
    return ok(res, { status: 'applied', result: await loanService.unapprove(req.params.id, req.user!.sub, req.ip) });
  },

  async remove(req: Request, res: Response) {
    await verifyLoanArea(req, req.params.id);
    return ok(res, await loanService.remove(req.params.id, req.user!.sub, req.ip));
  },

  async reject(req: Request, res: Response) {
    await verifyLoanArea(req, req.params.id);
    return gateOrExecute(req, res, {
      actionType: 'loan.reject',
      entityType: 'loan',
      entityId: req.params.id,
      payload: { reason: req.body.reason },
      execute: () => loanService.reject(req.params.id, req.body.reason, req.user!.sub, req.ip),
    });
  },

  async close(req: Request, res: Response) {
    await verifyLoanArea(req, req.params.id);
    return gateOrExecute(req, res, {
      actionType: 'loan.close',
      entityType: 'loan',
      entityId: req.params.id,
      payload: req.body,
      execute: () => loanService.close(req.params.id, req.body, req.user!.sub, req.ip),
    });
  },

  async disburse(req: Request, res: Response) {
    await verifyLoanArea(req, req.params.id);
    return gateOrExecute(req, res, {
      actionType: 'loan.disburse',
      entityType: 'loan',
      entityId: req.params.id,
      payload: { mode: req.body.mode, loanDate: req.body.loanDate },
      execute: () => loanService.disburse(req.params.id, req.body.mode, req.body.loanDate, req.user!.sub, req.ip),
    });
  },
};
