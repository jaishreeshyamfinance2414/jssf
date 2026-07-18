import { Request, Response } from 'express';
import { ok } from '../../shared/http';
import { BadRequest } from '../../shared/errors';
import { reportsRepository as r } from './reports.repository';

/** Parse ?from=YYYY-MM-DD&to=YYYY-MM-DD, defaulting to the current month. */
function range(req: Request): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';
  const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : monthStart;
  const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw BadRequest('Invalid date range. Use YYYY-MM-DD.');
  }
  if (from > to) throw BadRequest('"From" date must be before "to" date.');
  return { from, to };
}

export const reportsController = {
  async profitLoss(req: Request, res: Response) {
    const { from, to } = range(req);
    return ok(res, { from, to, ...(await r.profitLoss(from, to)) });
  },

  async dailyCollection(req: Request, res: Response) {
    const { from, to } = range(req);
    return ok(res, await r.dailyCollection(from, to));
  },

  async missedEmi(_req: Request, res: Response) {
    return ok(res, await r.missedEmi());
  },

  async customerLedger(req: Request, res: Response) {
    const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : '';
    if (!customerId) throw BadRequest('customerId is required.');
    return ok(res, await r.customerLedger(customerId));
  },

  async agentPerformance(req: Request, res: Response) {
    const { from, to } = range(req);
    return ok(res, await r.agentPerformance(from, to));
  },

  async accountLedger(req: Request, res: Response) {
    const { from, to } = range(req);
    return ok(res, await r.accountLedger(from, to));
  },
};
