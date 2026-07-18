import { Request, Response } from 'express';
import { ok } from '../../shared/http';
import { approvalRepository } from './approval.repository';
import { approvalService } from './approval.service';
import { RejectBody, ReviewBody } from './approval.schema';

export const approvalController = {
  async list(req: Request, res: Response) {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    return ok(res, await approvalRepository.list(status));
  },

  async mine(req: Request, res: Response) {
    return ok(res, await approvalRepository.listMine(req.user!.sub));
  },

  async approve(req: Request, res: Response) {
    const body = req.body as ReviewBody;
    const result = await approvalService.approve(req.params.id, req.user!.sub, body.note ?? null, req.ip);
    return ok(res, { approved: true, result });
  },

  async reject(req: Request, res: Response) {
    const body = req.body as RejectBody;
    const result = await approvalService.reject(req.params.id, req.user!.sub, body.reason, req.ip);
    return ok(res, result);
  },
};
