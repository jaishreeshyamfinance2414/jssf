import { BadRequest, NotFound } from '../../shared/errors';
import { audit } from '../audit/audit.service';
import { loanService } from '../loans/loan.service';
import { customerService } from '../customers/customer.service';
import { agentLedgerService } from '../agent-ledger/agent-ledger.service';
import { approvalRepository, ApprovalActionType, ApprovalRequestRow } from './approval.repository';

interface QueueInput {
  actionType: ApprovalActionType;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  requestedBy: string;
  ip?: string | null;
}

/**
 * Replays the same service function the action would have called directly,
 * with the reviewing admin as the actor. Each of these functions already
 * recomputes live state (available balance, remaining balance, unreconciled
 * collections) inside its own transaction, so replaying here at approval time
 * — rather than trusting a stale snapshot from when the manager submitted —
 * is automatically safe and correct.
 */
async function applyRequest(request: ApprovalRequestRow, reviewerId: string, ip?: string | null) {
  const payload = request.payload as Record<string, any>;
  switch (request.action_type) {
    case 'loan.approve':
      return loanService.approve(request.entity_id, reviewerId, ip);
    case 'loan.reject':
      return loanService.reject(request.entity_id, payload.reason, reviewerId, ip);
    case 'loan.disburse':
      return loanService.disburse(request.entity_id, payload.mode, payload.loanDate, reviewerId, ip);
    case 'loan.close':
      return loanService.close(request.entity_id, payload as { waiver: boolean; reason?: string | null }, reviewerId, ip);
    case 'customer.delete':
      return customerService.delete(request.entity_id, reviewerId, ip);
    case 'collection.handover':
      return agentLedgerService.recordHandover(
        { agentId: request.entity_id, submittedAmount: payload.submittedAmount, note: payload.note ?? null },
        reviewerId,
        ip,
      );
    default:
      throw BadRequest('Unknown action type');
  }
}

export const approvalService = {
  async queue(input: QueueInput): Promise<ApprovalRequestRow> {
    const request = await approvalRepository.create(input);
    await audit({
      actorId: input.requestedBy,
      action: 'REQUEST_SUBMITTED',
      entity: 'approval_request',
      entityId: request.id,
      meta: {
        actionType: input.actionType,
        entityType: input.entityType,
        entityId: input.entityId,
        payload: input.payload,
      },
      ip: input.ip,
    });
    return request;
  },

  async approve(id: string, reviewerId: string, note: string | null, ip?: string | null) {
    const exists = await approvalRepository.findById(id);
    if (!exists) throw NotFound('Approval request not found');

    // Atomically claim the request (pending → approved). Only one concurrent
    // reviewer wins the claim, so the underlying action can never run twice.
    const request = await approvalRepository.claim(id, 'approved', reviewerId, note);
    if (!request) throw BadRequest('This request has already been reviewed');

    let result;
    try {
      // applyRequest recomputes live state inside its own transaction. If it
      // throws (e.g. balance now insufficient), release the claim so the
      // request goes back to pending — nothing stays approved unless the
      // underlying action actually succeeded.
      result = await applyRequest(request, reviewerId, ip);
    } catch (err) {
      await approvalRepository.revertToPending(id);
      throw err;
    }

    await audit({
      actorId: reviewerId,
      action: 'REQUEST_APPROVED',
      entity: 'approval_request',
      entityId: id,
      meta: { actionType: request.action_type, note },
      ip,
    });
    return result;
  },

  async reject(id: string, reviewerId: string, reason: string, ip?: string | null) {
    const exists = await approvalRepository.findById(id);
    if (!exists) throw NotFound('Approval request not found');

    // Same atomic claim as approve — a request can't be rejected after (or
    // while) another reviewer approves it.
    const request = await approvalRepository.claim(id, 'rejected', reviewerId, reason);
    if (!request) throw BadRequest('This request has already been reviewed');

    await audit({
      actorId: reviewerId,
      action: 'REQUEST_REJECTED',
      entity: 'approval_request',
      entityId: id,
      meta: { actionType: request.action_type, reason },
      ip,
    });
    return { rejected: true };
  },
};
