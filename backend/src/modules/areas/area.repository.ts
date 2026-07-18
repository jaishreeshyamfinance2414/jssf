import { query } from '../../db/pool';

export const areaRepository = {
  async list() {
    const { rows } = await query(
      `SELECT a.id, a.name, a.code, a.is_active,
              (SELECT count(*) FROM customers c WHERE c.area_id = a.id AND c.is_active) AS customer_count,
              (SELECT count(*) FROM area_agents aa WHERE aa.area_id = a.id) AS agent_count
         FROM areas a WHERE a.is_active = true ORDER BY a.name`,
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
  async agents(areaId: string) {
    const { rows } = await query(
      `SELECT aa.agent_id, u.full_name, u.mobile, r.name AS role_name, aa.assigned_at
         FROM area_agents aa
         JOIN users u ON u.id = aa.agent_id
         JOIN roles r ON r.id = u.role_id
        WHERE aa.area_id = $1
        ORDER BY u.full_name`,
      [areaId],
    );
    return rows;
  },

  async assignAgent(areaId: string, agentId: string) {
    await query(
      `INSERT INTO area_agents(area_id, agent_id) VALUES ($1,$2)
       ON CONFLICT (area_id, agent_id) DO NOTHING`,
      [areaId, agentId],
    );
  },

  async unassignAgent(areaId: string, agentId: string) {
    await query(`DELETE FROM area_agents WHERE area_id = $1 AND agent_id = $2`, [areaId, agentId]);
  },

  /** Area ids an agent is assigned to (empty = no assignment). */
  async areaIdsForAgent(agentId: string): Promise<string[]> {
    const { rows } = await query<{ area_id: string }>(
      `SELECT area_id FROM area_agents WHERE agent_id = $1`,
      [agentId],
    );
    return rows.map((r) => r.area_id);
  },
};
