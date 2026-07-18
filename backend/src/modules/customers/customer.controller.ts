import { Request, Response } from 'express';
import { created, ok } from '../../shared/http';
import { gateOrExecute } from '../approvals/approval.gate';
import { customerRepository } from './customer.repository';
import { customerService } from './customer.service';
import { CreateCustomerBody } from './customer.schema';
import { UpdateCustomerBody } from './customer.schema';
import { NotFound } from '../../shared/errors';

export const customerController = {
  async list(req: Request, res: Response) {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    return ok(res, await customerRepository.list(search));
  },

  async detail(req: Request, res: Response) {
    const customer = await customerRepository.findById(req.params.id);
    if (!customer) throw NotFound('Customer not found');
    const loans = await customerRepository.loanHistory(req.params.id);
    return ok(res, { ...customer, loans });
  },

  async create(req: Request, res: Response) {
    const body = req.body as CreateCustomerBody;
    const files = (req.files as Record<string, Express.Multer.File[]>) ?? {};
    const customer = await customerService.create(body, files, req.user!.sub, req.ip);
    return created(res, customer);
  },

  async update(req: Request, res: Response) {
    const body = req.body as UpdateCustomerBody;
    const files = (req.files as Record<string, Express.Multer.File[]>) ?? {};
    const customer = await customerService.update(req.params.id, body, files, req.user!.sub, req.ip);
    return ok(res, customer);
  },

  async delete(req: Request, res: Response) {
    return gateOrExecute(req, res, {
      actionType: 'customer.delete',
      entityType: 'customer',
      entityId: req.params.id,
      payload: {},
      execute: () => customerService.delete(req.params.id, req.user!.sub, req.ip),
    });
  },
};
