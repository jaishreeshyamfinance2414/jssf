import { PoolClient } from 'pg';
import { query } from '../../db/pool';
import { logger } from '../../config/logger';

export interface AuditEntry {
  actorId?: string | null;
  action: string; // CREATE | UPDATE | LOGIN | APPROVAL | STATUS_CHANGE ...
  entity: string;
  entityId?: string | null;
  meta?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Fire-and-forget audit writer. Never throws into the business flow — a failed
 * audit write is logged but must not roll back the user's action, unless a
 * transaction client is supplied (then it's part of that atomic unit).
 */
export async function audit(entry: AuditEntry, client?: PoolClient): Promise<void> {
  const sql = `INSERT INTO audit_logs(actor_id, action, entity, entity_id, meta, ip, user_agent)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`;
  const params = [
    entry.actorId ?? null,
    entry.action,
    entry.entity,
    entry.entityId ?? null,
    entry.meta ? JSON.stringify(entry.meta) : null,
    entry.ip ?? null,
    entry.userAgent ?? null,
  ];
  try {
    if (client) await client.query(sql, params);
    else await query(sql, params);
  } catch (err) {
    logger.error({ err, entry }, 'Failed to write audit log');
  }
}
