import { query } from '../../db/pool';

export type ApprovalActionType =
  | 'loan.approve'
  | 'loan.reject'
  | 'loan.disburse'
  | 'loan.close'
  | 'customer.delete'
  | 'collection.handover';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ApprovalRequestRow {
  id: string;
  action_type: ApprovalActionType;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  status: ApprovalStatus;
  requested_by: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

export const approvalRepository = {
  async create(input: {
    actionType: ApprovalActionType;
    entityType: string;
    entityId: string;
    payload: Record<string, unknown>;
    requestedBy: string;
  }): Promise<ApprovalRequestRow> {
    const { rows } = await query<ApprovalRequestRow>(
      `INSERT INTO approval_requests(action_type, entity_type, entity_id, payload, requested_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [input.actionType, input.entityType, input.entityId, JSON.stringify(input.payload), input.requestedBy],
    );
    return rows[0];
  },

  /** Full queue, optionally filtered by status — admin review view. */
  async list(status?: string) {
    const { rows } = await query(
      `SELECT ar.*, u.full_name AS requested_by_name, ru.full_name AS reviewed_by_name
         FROM approval_requests ar
         JOIN users u ON u.id = ar.requested_by
         LEFT JOIN users ru ON ru.id = ar.reviewed_by
        WHERE ($1::approval_status IS NULL OR ar.status = $1)
        ORDER BY ar.created_at DESC
        LIMIT 300`,
      [status ?? null],
    );
    return rows;
  },

  /** A requester's own submissions, any status — their own read-only view. */
  async listMine(userId: string) {
    const { rows } = await query(
      `SELECT ar.*, ru.full_name AS reviewed_by_name
         FROM approval_requests ar
         LEFT JOIN users ru ON ru.id = ar.reviewed_by
        WHERE ar.requested_by = $1
        ORDER BY ar.created_at DESC
        LIMIT 100`,
      [userId],
    );
    return rows;
  },

  async findById(id: string): Promise<ApprovalRequestRow | null> {
    const { rows } = await query<ApprovalRequestRow>(`SELECT * FROM approval_requests WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },

  async markApproved(id: string, reviewerId: string, note: string | null): Promise<void> {
    await query(
      `UPDATE approval_requests
          SET status = 'approved', reviewed_by = $2, reviewed_at = now(), review_note = $3
        WHERE id = $1`,
      [id, reviewerId, note],
    );
  },

  async markRejected(id: string, reviewerId: string, note: string | null): Promise<void> {
    await query(
      `UPDATE approval_requests
          SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_note = $3
        WHERE id = $1`,
      [id, reviewerId, note],
    );
  },
};
