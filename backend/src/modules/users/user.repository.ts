import { query, withTransaction } from '../../db/pool';
import { BadRequest } from '../../shared/errors';

const GLOBAL_ROLES = new Set(['admin', 'manager']);

export interface UserListRow {
  id: string;
  full_name: string;
  email: string | null;
  mobile: string;
  role_name: string;
  area_id: string | null;
  area_name: string | null;
  is_active: boolean;
  locked_until: Date | null;
  failed_attempts: number;
  last_login_at: Date | null;
  created_at: Date;
}

export const userRepository = {
  async list(): Promise<UserListRow[]> {
    const { rows } = await query<UserListRow>(
      `SELECT u.id, u.full_name, u.email, u.mobile, r.name AS role_name,
              u.area_id, a.name AS area_name,
              u.is_active, u.locked_until, u.failed_attempts, u.last_login_at, u.created_at
         FROM users u JOIN roles r ON r.id = u.role_id
         LEFT JOIN areas a ON a.id = u.area_id
        ORDER BY u.created_at DESC`,
    );
    return rows;
  },

  async create(input: {
    fullName: string;
    email: string | null;
    mobile: string;
    passwordHash: string;
    roleName: string;
    createdBy: string;
    areaId: string | null;
  }): Promise<{ id: string }> {
    return withTransaction(async (client) => {
      if (!GLOBAL_ROLES.has(input.roleName) && !input.areaId) throw BadRequest('Area is mandatory for this role');
      if (input.areaId) {
        const area = await client.query(`SELECT 1 FROM areas WHERE id = $1 AND is_active = true`, [input.areaId]);
        if (!area.rows[0]) throw BadRequest('Area not found or inactive');
      }
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO users(role_id, full_name, email, mobile, password_hash, created_by, area_id)
         SELECT r.id, $1, $2, $3, $4, $5, $7 FROM roles r WHERE r.name = $6
         RETURNING id`,
        [input.fullName, input.email, input.mobile, input.passwordHash, input.createdBy, input.roleName, input.areaId],
      );
      if (!rows[0]) throw BadRequest('Invalid role');
      if (input.areaId) {
        await client.query(`INSERT INTO area_agents(area_id, agent_id) VALUES ($1,$2)`, [input.areaId, rows[0].id]);
      }
      return rows[0];
    });
  },

  async update(
    userId: string,
    input: { fullName?: string; email?: string | null; mobile?: string; roleName?: string; areaId?: string | null },
  ): Promise<void> {
    // email is tri-state: key absent = leave untouched, key present with null = clear it,
    // key present with a value = set it. `'email' in input` distinguishes absent from null
    // because zod omits unset optional keys from the parsed body rather than setting undefined.
    await withTransaction(async (client) => {
      const current = await client.query<{ role_name: string; area_id: string | null }>(
        `SELECT r.name AS role_name, u.area_id FROM users u JOIN roles r ON r.id = u.role_id
          WHERE u.id = $1 FOR UPDATE OF u`,
        [userId],
      );
      if (!current.rows[0]) throw BadRequest('User not found');
      const roleName = input.roleName ?? current.rows[0].role_name;
      const areaId = 'areaId' in input ? (input.areaId ?? null) : current.rows[0].area_id;
      if (!GLOBAL_ROLES.has(roleName) && !areaId) throw BadRequest('Area is mandatory for this role');
      if (areaId) {
        const area = await client.query(`SELECT 1 FROM areas WHERE id = $1 AND is_active = true`, [areaId]);
        if (!area.rows[0]) throw BadRequest('Area not found or inactive');
      }
      await client.query(
        `UPDATE users
          SET full_name = COALESCE($2, full_name),
              email = CASE WHEN $3::boolean THEN $4 ELSE email END,
              mobile = COALESCE($5, mobile),
              role_id = COALESCE((SELECT id FROM roles WHERE name = $6), role_id),
              area_id = CASE WHEN $7::boolean THEN $8 ELSE area_id END
        WHERE id = $1`,
        [userId, input.fullName ?? null, 'email' in input, input.email ?? null,
          input.mobile ?? null, input.roleName ?? null, 'areaId' in input, input.areaId ?? null],
      );
      if ('areaId' in input) {
        await client.query(`DELETE FROM area_agents WHERE agent_id = $1`, [userId]);
        if (areaId) await client.query(`INSERT INTO area_agents(area_id, agent_id) VALUES ($1,$2)`, [areaId, userId]);
      }
    });
  },

  async resetPassword(userId: string, passwordHash: string): Promise<void> {
    // Admin-set temporary password: the user must replace it on next login.
    await query(
      `UPDATE users SET password_hash = $2, must_change_password = true WHERE id = $1`,
      [userId, passwordHash],
    );
  },

  async unlock(userId: string): Promise<void> {
    await query(
      `UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1`,
      [userId],
    );
  },

  async setActive(userId: string, active: boolean): Promise<void> {
    await query(`UPDATE users SET is_active = $2 WHERE id = $1`, [userId, active]);
  },

  /** Active admins other than the given user — guards against deactivating the last admin. */
  async countActiveAdminsExcluding(userId: string): Promise<number> {
    const { rows } = await query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE r.name = 'admin' AND u.is_active = true AND u.id <> $1`,
      [userId],
    );
    return Number(rows[0].n);
  },

};
