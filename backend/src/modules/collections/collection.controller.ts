import { Request, Response } from 'express';
import { created, ok } from '../../shared/http';
import { collectionRepository } from './collection.repository';
import { collectionService } from './collection.service';
import { sweepMissedEmis } from './missed-emi.job';
import { query } from '../../db/pool';
import { NotFound } from '../../shared/errors';

async function requireLoanArea(req: Request, loanId: string) {
  if (!req.areaIds) return;
  const { rows } = await query(
    `SELECT 1 FROM loans l JOIN customers c ON c.id = l.customer_id
      WHERE l.id = $1 AND c.area_id = ANY($2::uuid[])`,
    [loanId, req.areaIds],
  );
  if (!rows[0]) throw NotFound('Loan not found');
}

async function requireCollectionArea(req: Request, collectionId: string) {
  if (!req.areaIds) return;
  const { rows } = await query(
    `SELECT 1 FROM collections co JOIN loans l ON l.id = co.loan_id
       JOIN customers c ON c.id = l.customer_id
      WHERE co.id = $1 AND c.area_id = ANY($2::uuid[])`,
    [collectionId, req.areaIds],
  );
  if (!rows[0]) throw NotFound('Collection entry not found');
}

export const collectionController = {
  async list(req: Request, res: Response) {
    return ok(res, await collectionRepository.list(req.areaIds));
  },

  async due(req: Request, res: Response) {
    return ok(res, await collectionRepository.todaysDue(req.areaIds));
  },

  async sheet(req: Request, res: Response) {
    return ok(res, await collectionRepository.sheet(req.areaIds));
  },

  async sheetAgents(req: Request, res: Response) {
    return ok(res, await collectionRepository.sheetAgents(req.areaIds));
  },

  async sweep(_req: Request, res: Response) {
    const result = await sweepMissedEmis();
    return ok(res, result);
  },

  async create(req: Request, res: Response) {
    await requireLoanArea(req, req.body.loanId);
    return created(res, await collectionService.record(req.body, req.user!.sub, req.user!.role, req.ip, req.areaIds));
  },

  async update(req: Request, res: Response) {
    await requireCollectionArea(req, req.params.id);
    return ok(res, await collectionService.update(req.params.id, req.body, req.user!.sub, req.user!.role, req.ip, req.areaIds));
  },

  async remove(req: Request, res: Response) {
    await requireCollectionArea(req, req.params.id);
    return ok(res, await collectionService.remove(req.params.id, req.user!.sub, req.user!.role, req.ip, req.areaIds));
  },
};

