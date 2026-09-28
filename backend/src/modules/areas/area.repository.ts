import { query, withTransaction } from '../../db/pool';
import { BadRequest } from '../../shared/errors';

export const areaRepository = {
  async list(areaIds?: string[]) {
    const { rows } = await query(
      `SELECT a.id, a.name, a.code, a.is_active,
              (SELECT count(*) FROM customers c WHERE c.area_id = a.id AND c.is_active) AS customer_count,
              (SELECT count(*) FROM users u WHERE u.area_id = a.id AND u.is_active) AS agent_count
         FROM areas a WHERE a.is_active = true
          ${areaIds ? 'AND a.id = ANY($1::uuid[])' : ''}
         ORDER BY a.name`,
      areaIds ? [areaIds] : [],
    );
    return rows;
  },

  async create(name: string, code: string | null): Promise<{ id: string }> {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO areas(name, code) VALUES ($1,$2) RETURNING id`,
      [name, code],
    );
    return rows[0];
  },

  /** Agents assigned to each area (for the areas page). */
  async agents(areaId: string, areaIds?: string[]) {
    const { rows } = await query(
      `SELECT u.id AS agent_id, u.full_name, u.mobile, r.name AS role_name, u.updated_at AS assigned_at
         FROM users u
         JOIN roles r ON r.id = u.role_id
        WHERE u.area_id = $1 ${areaIds ? 'AND u.area_id = ANY($2::uuid[])' : ''}
        ORDER BY u.full_name`,
      areaIds ? [areaId, areaIds] : [areaId],
    );
    return rows;
  },

  async assignAgent(areaId: string, agentId: string) {
    await withTransaction(async (client) => {
      const area = await client.query(`SELECT 1 FROM areas WHERE id = $1 AND is_active = true`, [areaId]);
      if (!area.rows[0]) throw BadRequest('Area not found or inactive');
      await client.query(`UPDATE users SET area_id = $2 WHERE id = $1`, [agentId, areaId]);
      await client.query(`DELETE FROM area_agents WHERE agent_id = $1`, [agentId]);
      await client.query(`INSERT INTO area_agents(area_id, agent_id) VALUES ($1,$2)`, [areaId, agentId]);
    });
  },

  async unassignAgent(areaId: string, agentId: string) {
    await withTransaction(async (client) => {
      const user = await client.query<{ role_name: string }>(
        `SELECT r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1 FOR UPDATE OF u`,
        [agentId],
      );
      if (!user.rows[0]) throw BadRequest('User not found');
      if (!['admin', 'manager'].includes(user.rows[0].role_name)) {
        throw BadRequest('This role requires an area. Assign a different area instead.');
      }
      await client.query(`UPDATE users SET area_id = NULL WHERE id = $1 AND area_id = $2`, [agentId, areaId]);
      await client.query(`DELETE FROM area_agents WHERE area_id = $1 AND agent_id = $2`, [areaId, agentId]);
    });
  },

  /** Area ids an agent is assigned to (empty = no assignment). */
  async areaIdsForAgent(agentId: string): Promise<string[]> {
    const { rows } = await query<{ area_id: string }>(
      `SELECT area_id FROM users WHERE id = $1 AND area_id IS NOT NULL`,
      [agentId],
    );
    return rows.map((r) => r.area_id);
  },
};
