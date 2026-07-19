import { PoolClient } from 'pg';
import { BaseRepository } from '../../shared/repository';
import { query } from '../../db/pool';

export interface UserRow {
  id: string;
  role_id: string;
  role_name: string;
  full_name: string;
  email: string | null;
  mobile: string;
  password_hash: string;
  is_active: boolean;
  failed_attempts: number;
  locked_until: Date | null;
  must_change_password: boolean;
}

export class AuthRepository extends BaseRepository<UserRow> {
  protected table = 'users';

  /** Look up an active user by email OR mobile, joined with role name. */
  async findByIdentifier(identifier: string): Promise<UserRow | null> {
    const { rows } = await query<UserRow>(
      `SELECT u.*, r.name AS role_name
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE (u.email = $1 OR u.mobile = $1)
        LIMIT 1`,
      [identifier],
    );
    return rows[0] ?? null;
  }

  /** Fetch a user by id joined with role name (for token minting on refresh). */
  async findByIdWithRole(userId: string): Promise<UserRow | null> {
    const { rows } = await query<UserRow>(
      `SELECT u.*, r.name AS role_name
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1 LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  /** All permission codes granted to a user via their role. */
  async permissionsFor(userId: string): Promise<string[]> {
    const { rows } = await query<{ code: string }>(
      `SELECT p.code
         FROM users u
         JOIN role_permissions rp ON rp.role_id = u.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE u.id = $1`,
      [userId],
    );
    return rows.map((r) => r.code);
  }

  async registerFailedAttempt(userId: string, lockUntil: Date | null): Promise<void> {
    await query(
      `UPDATE users
          SET failed_attempts = failed_attempts + 1,
              locked_until = COALESCE($2, locked_until)
        WHERE id = $1`,
      [userId, lockUntil],
    );
  }

  async resetLoginState(userId: string): Promise<void> {
    await query(
      `UPDATE users
          SET failed_attempts = 0, locked_until = NULL, last_login_at = now()
        WHERE id = $1`,
      [userId],
    );
  }

  /** Self-service password change — also clears the forced-change flag. */
  async changePassword(userId: string, passwordHash: string): Promise<void> {
    await query(
      `UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1`,
      [userId, passwordHash],
    );
  }

  // ── Refresh tokens ──
  async storeRefreshToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    ua: string | null,
    ip: string | null,
    remember = false,
  ): Promise<void> {
    await query(
      `INSERT INTO refresh_tokens(user_id, token_hash, expires_at, user_agent, ip, remember)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, tokenHash, expiresAt, ua, ip, remember],
    );
  }

  async findValidRefreshToken(tokenHash: string) {
    const { rows } = await query<{ id: string; user_id: string; remember: boolean }>(
      `SELECT id, user_id, remember FROM refresh_tokens
        WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
        LIMIT 1`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  /** Look up a token regardless of revocation state — used for reuse detection. */
  async findRefreshTokenIncludingRevoked(tokenHash: string) {
    const { rows } = await query<{
      id: string;
      user_id: string;
      revoked_at: Date | null;
      expires_at: Date;
      remember: boolean;
    }>(
      `SELECT id, user_id, revoked_at, expires_at, remember
         FROM refresh_tokens WHERE token_hash = $1 LIMIT 1`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  async revokeRefreshToken(tokenHash: string, client?: PoolClient): Promise<void> {
    const sql = `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1`;
    if (client) await client.query(sql, [tokenHash]);
    else await query(sql, [tokenHash]);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1`, [userId]);
  }
}

export const authRepository = new AuthRepository();
