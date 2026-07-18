import { query } from '../../db/pool';

export interface UserListRow {
  id: string;
  full_name: string;
  email: string | null;
  mobile: string;
  role_name: string;
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
              u.is_active, u.locked_until, u.failed_attempts, u.last_login_at, u.created_at
         FROM users u JOIN roles r ON r.id = u.role_id
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
  }): Promise<{ id: string }> {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO users(role_id, full_name, email, mobile, password_hash, created_by)
       SELECT r.id, $1, $2, $3, $4, $5 FROM roles r WHERE r.name = $6
       RETURNING id`,
      [input.fullName, input.email, input.mobile, input.passwordHash, input.createdBy, input.roleName],
    );
    return rows[0];
  },

  async update(
    userId: string,
    input: { fullName?: string; email?: string | null; mobile?: string; roleName?: string },
  ): Promise<void> {
    // email is tri-state: key absent = leave untouched, key present with null = clear it,
    // key present with a value = set it. `'email' in input` distinguishes absent from null
    // because zod omits unset optional keys from the parsed body rather than setting undefined.
    await query(
      `UPDATE users
          SET full_name = COALESCE($2, full_name),
              email = CASE WHEN $3::boolean THEN $4 ELSE email END,
              mobile = COALESCE($5, mobile),
              role_id = COALESCE((SELECT id FROM roles WHERE name = $6), role_id)
        WHERE id = $1`,
      [
        userId,
        input.fullName ?? null,
        'email' in input,
        input.email ?? null,
        input.mobile ?? null,
        input.roleName ?? null,
      ],
    );
  },

  async resetPassword(userId: string, passwordHash: string): Promise<void> {
    await query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [userId, passwordHash]);
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
