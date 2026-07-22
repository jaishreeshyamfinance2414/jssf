import { Request, Response } from 'express';
import { created, ok } from '../../shared/http';
import { gateOrExecute } from '../approvals/approval.gate';
import { customerRepository } from './customer.repository';
import { customerService } from './customer.service';
import { CreateCustomerBody } from './customer.schema';
import { UpdateCustomerBody } from './customer.schema';
import { NotFound } from '../../shared/errors';
import { deleteObject } from '../files/r2';

export const customerController = {
  async list(req: Request, res: Response) {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const allowed = ['active', 'deactivated', 'closed_loan', 'all'] as const;
    const status = allowed.find((s) => s === req.query.status) ?? 'active';
    return ok(res, await customerRepository.list(search, status));
  },

  async detail(req: Request, res: Response) {
    const customer = await customerRepository.findById(req.params.id);
    if (!customer) throw NotFound('Customer not found');
    const loans = await customerRepository.loanHistory(req.params.id);
    return ok(res, { ...customer, loans });
  },

  // A single document, uploaded and content-verified into the staging area by
  // the middleware chain. Returns the staging key the form holds until submit.
  async stageUpload(req: Request, res: Response) {
    const file = req.file;
    if (!file) throw NotFound('No file uploaded');
    return created(res, { key: `staging/${file.filename}` });
  },

  // Discard an abandoned staged upload (form cancelled, file replaced, etc.).
  async unstage(req: Request, res: Response) {
    await deleteObject((req.body as { key: string }).key);
    return ok(res, { discarded: true });
  },

  async create(req: Request, res: Response) {
    const body = req.body as CreateCustomerBody;
    const customer = await customerService.create(body, req.user!.sub, req.ip);
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

  async deactivate(req: Request, res: Response) {
    return ok(res, await customerService.deactivate(req.params.id, req.user!.sub, req.ip));
  },

  async activate(req: Request, res: Response) {
    return ok(res, await customerService.activate(req.params.id, req.user!.sub, req.ip));
  },
};
