import { Request, Response } from 'express';
import { ok } from '../../shared/http';
import { Forbidden } from '../../shared/errors';
import { gateOrExecute } from '../approvals/approval.gate';
import { agentLedgerRepository } from './agent-ledger.repository';
import { agentLedgerService } from './agent-ledger.service';

const ADMIN_LIKE = ['admin', 'manager'];

export const agentLedgerController = {
  /** GET /agent-ledger/pending?agentId= — self for agents, any/all for admin+manager. */
  async pending(req: Request, res: Response) {
    const role = req.user!.role;
    const requestedAgentId = req.query.agentId as string | undefined;

    if (!ADMIN_LIKE.includes(role)) {
      const pendingAmount = await agentLedgerRepository.pendingForAgent(req.user!.sub);
      const dueAmount = await agentLedgerRepository.lifetimeDue(req.user!.sub);
      return ok(res, { agentId: req.user!.sub, pendingAmount, dueAmount });
    }

    if (requestedAgentId) {
      const pendingAmount = await agentLedgerRepository.pendingForAgent(requestedAgentId);
      const dueAmount = await agentLedgerRepository.lifetimeDue(requestedAgentId);
      return ok(res, { agentId: requestedAgentId, pendingAmount, dueAmount });
    }

    const [byAgent, dueByAgent] = await Promise.all([
      agentLedgerRepository.pendingByAgent(),
      agentLedgerRepository.lifetimeDueByAgent(),
    ]);
    const dueMap = new Map(dueByAgent.map((d) => [d.agentId, d.dueAmount]));
    return ok(
      res,
      byAgent.map((a) => ({ ...a, dueAmount: dueMap.get(a.agentId) ?? 0 })),
    );
  },

  /** GET /agent-ledger/history/:agentId — self or admin/manager. */
  async history(req: Request, res: Response) {
    const role = req.user!.role;
    const targetId = req.params.agentId;
    if (!ADMIN_LIKE.includes(role) && targetId !== req.user!.sub) {
      throw Forbidden("Cannot view another agent's ledger");
    }
    return ok(res, await agentLedgerRepository.history(targetId));
  },

  /**
   * POST /agent-ledger/handover — admin executes immediately; manager's
   * attempt is queued for admin sign-off (see approvals module).
   */
  async handover(req: Request, res: Response) {
    return gateOrExecute(req, res, {
      actionType: 'collection.handover',
      entityType: 'agent_ledger',
      entityId: req.body.agentId,
      payload: { submittedAmount: req.body.submittedAmount, note: req.body.note ?? null },
      execute: () => agentLedgerService.recordHandover(req.body, req.user!.sub, req.ip),
    });
  },
};
