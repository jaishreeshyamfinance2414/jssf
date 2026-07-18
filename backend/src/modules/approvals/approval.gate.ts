import { Request, Response } from 'express';
import { created, ok } from '../../shared/http';
import { approvalService } from './approval.service';
import { ApprovalActionType } from './approval.repository';

/**
 * Shared branch for the 5 actions a manager can attempt but must be signed
 * off by admin: manager's attempt is queued instead of applied; admin (or any
 * other role holding the permission) executes immediately as before.
 */
export async function gateOrExecute(
  req: Request,
  res: Response,
  opts: {
    actionType: ApprovalActionType;
    entityType: string;
    entityId: string;
    payload: Record<string, unknown>;
    execute: () => Promise<unknown>;
  },
) {
  if (req.user!.role === 'manager') {
    const request = await approvalService.queue({
      actionType: opts.actionType,
      entityType: opts.entityType,
      entityId: opts.entityId,
      payload: opts.payload,
      requestedBy: req.user!.sub,
      ip: req.ip,
    });
    return created(res, { status: 'pending', request });
  }
  return ok(res, { status: 'applied', result: await opts.execute() });
}
