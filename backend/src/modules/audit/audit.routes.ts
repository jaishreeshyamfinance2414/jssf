import { Request, Response } from 'express';
import { Router } from 'express';
import { query } from '../../db/pool';
import { ok, asyncHandler } from '../../shared/http';
import { BadRequest } from '../../shared/errors';
import { authenticate, requirePermission } from '../../middleware/auth';

const PAGE_SIZE = 50;

/**
 * Read side of the audit trail. Writes happen via audit.service inside each
 * module; this exposes a filterable, paginated view for compliance review.
 */
async function list(req: Request, res: Response) {
  const q = req.query;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  const entity = str(q.entity);
  const action = str(q.action);
  const actorId = str(q.actorId);
  const search = str(q.search);
  const from = str(q.from);
  const to = str(q.to);
  for (const d of [from, to]) {
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw BadRequest('Invalid date. Use YYYY-MM-DD.');
  }
  const page = Math.max(1, Number(q.page) || 1);

  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace('?', `$${params.length}`));
  };
  if (entity) add('al.entity = ?', entity);
  if (action) add('al.action = ?', action);
  if (actorId) add('al.actor_id = ?', actorId);
  if (from) add('al.created_at >= ?::date', from);
  if (to) add(`al.created_at < ?::date + INTERVAL '1 day'`, to);
  // Free-text search over the actor name, entity id and meta payload.
  if (search) {
    params.push(search);
    const p = `$${params.length}`;
    where.push(`(u.full_name ILIKE '%'||${p}||'%' OR al.entity_id ILIKE '%'||${p}||'%' OR al.meta::text ILIKE '%'||${p}||'%')`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const base = `FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_id ${whereSql}`;

  const [{ rows: countRows }, { rows }] = await Promise.all([
    query<{ c: string }>(`SELECT count(*)::text AS c ${base}`, params),
    query(
      `SELECT al.id, al.action, al.entity, al.entity_id, al.meta, al.ip, al.created_at,
              u.full_name AS actor_name, u.mobile AS actor_mobile
         ${base}
        ORDER BY al.created_at DESC
        LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
      params,
    ),
  ]);

  return ok(res, {
    rows,
    total: Number(countRows[0].c),
    page,
    pageSize: PAGE_SIZE,
  });
}

/** Distinct entities/actions/actors, for the filter dropdowns. */
async function filters(_req: Request, res: Response) {
  const [entities, actions, actors] = await Promise.all([
    query<{ entity: string }>(`SELECT DISTINCT entity FROM audit_logs ORDER BY entity`),
    query<{ action: string }>(`SELECT DISTINCT action FROM audit_logs ORDER BY action`),
    query<{ id: string; full_name: string }>(
      `SELECT DISTINCT u.id, u.full_name FROM audit_logs al JOIN users u ON u.id = al.actor_id ORDER BY u.full_name`,
    ),
  ]);
  return ok(res, {
    entities: entities.rows.map((r) => r.entity),
    actions: actions.rows.map((r) => r.action),
    actors: actors.rows,
  });
}

const router = Router();
router.use(authenticate, requirePermission('audit.view'));
router.get('/', asyncHandler(list));
router.get('/filters', asyncHandler(filters));

export default router;
