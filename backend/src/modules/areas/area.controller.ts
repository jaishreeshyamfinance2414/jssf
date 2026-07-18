import { Request, Response } from 'express';
import { z } from 'zod';
import { created, ok } from '../../shared/http';
import { audit } from '../audit/audit.service';
import { areaRepository } from './area.repository';

export const createAreaSchema = z.object({
  name: z.string().min(2),
  code: z.string().optional().nullable(),
});

export const assignAgentSchema = z.object({
  agentId: z.string().uuid('Select an agent'),
});

export const areaController = {
  async list(_req: Request, res: Response) {
    return ok(res, await areaRepository.list());
  },

  async agents(req: Request, res: Response) {
    return ok(res, await areaRepository.agents(req.params.id));
  },

  async assignAgent(req: Request, res: Response) {
    const { agentId } = req.body as z.infer<typeof assignAgentSchema>;
    await areaRepository.assignAgent(req.params.id, agentId);
    await audit({ actorId: req.user!.sub, action: 'CREATE', entity: 'area_agent', entityId: req.params.id, meta: { agentId }, ip: req.ip });
    return ok(res, { assigned: true });
  },

  async unassignAgent(req: Request, res: Response) {
    await areaRepository.unassignAgent(req.params.id, req.params.agentId);
    await audit({ actorId: req.user!.sub, action: 'DELETE', entity: 'area_agent', entityId: req.params.id, meta: { agentId: req.params.agentId }, ip: req.ip });
    return ok(res, { unassigned: true });
  },

  async create(req: Request, res: Response) {
    const body = req.body as z.infer<typeof createAreaSchema>;
    const area = await areaRepository.create(body.name, body.code ?? null);
    await audit({ actorId: req.user!.sub, action: 'CREATE', entity: 'area', entityId: area.id, ip: req.ip });
    return created(res, area);
  },
};
