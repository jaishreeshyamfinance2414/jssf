import argon2 from 'argon2';
import ms from './ms';
import { env } from '../../config/env';
import { Locked, Unauthorized } from '../../shared/errors';
import { audit } from '../audit/audit.service';
import { authRepository } from './auth.repository';
import {
  createRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from './token.service';

interface LoginInput {
  identifier: string; // email or mobile
  password: string;
  rememberMe?: boolean;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: { id: string; fullName: string; role: string; email: string | null; mobile: string };
}

// Progressive lock: after MAX attempts, lock for 15 minutes.
const LOCK_MINUTES = 15;

// A revoked token replayed within this window is treated as a benign race
// (parallel tabs, network retry) rather than theft — rejected, but without
// nuking the user's other sessions.
const REUSE_GRACE_MS = 30_000;

// Verified against when the identifier doesn't match any account, so unknown
// and known identifiers take the same time to reject (no user enumeration via
// response timing). Any valid argon2 hash of a throwaway string works.
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$9ahkZGOBt8Pm7ds/cr4Qrg$7bP2IYUPLuRJrHbb1U23ffbbBUSbpqw2SUrzx6+QJO0';

export const authService = {
  async login(input: LoginInput): Promise<AuthResult> {
    const user = await authRepository.findByIdentifier(input.identifier);

    // Uniform failure to avoid leaking which accounts exist — including via
    // timing: burn an argon2 verify against a dummy hash so "no such user"
    // takes as long as "wrong password".
    if (!user) {
      await argon2.verify(DUMMY_HASH, input.password).catch(() => false);
      throw Unauthorized('Invalid credentials');
    }

    if (!user.is_active) throw Unauthorized('Account is disabled');

    if (user.locked_until && user.locked_until > new Date()) {
      throw Locked('Account locked due to failed attempts. Try later or contact admin.');
    }

    const valid = await argon2.verify(user.password_hash, input.password);
    if (!valid) {
      const attempts = user.failed_attempts + 1;
      const lockUntil =
        attempts >= env.MAX_LOGIN_ATTEMPTS
          ? new Date(Date.now() + LOCK_MINUTES * 60_000)
          : null;
      await authRepository.registerFailedAttempt(user.id, lockUntil);
      await audit({
        actorId: user.id,
        action: 'LOGIN_FAILED',
        entity: 'user',
        entityId: user.id,
        meta: { attempts },
        ip: input.ip,
        userAgent: input.userAgent,
      });
      throw lockUntil
        ? Locked('Too many failed attempts. Account locked for 15 minutes.')
        : Unauthorized('Invalid credentials');
    }

    // Success — reset counters, issue tokens.
    await authRepository.resetLoginState(user.id);
    const perms = await authRepository.permissionsFor(user.id);
    const accessToken = signAccessToken({
      sub: user.id,
      role: user.role_name,
      perms,
      ...(user.must_change_password ? { pwc: true } : {}),
    });

    const { raw, hash } = createRefreshToken();
    const ttl = input.rememberMe ? env.JWT_REFRESH_TTL_REMEMBER : env.JWT_REFRESH_TTL;
    const refreshExpiresAt = new Date(Date.now() + ms(ttl));
    await authRepository.storeRefreshToken(
      user.id,
      hash,
      refreshExpiresAt,
      input.userAgent ?? null,
      input.ip ?? null,
      input.rememberMe ?? false,
    );

    await audit({
      actorId: user.id,
      action: 'LOGIN',
      entity: 'user',
      entityId: user.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return {
      accessToken,
      refreshToken: raw,
      refreshExpiresAt,
      user: {
        id: user.id,
        fullName: user.full_name,
        role: user.role_name,
        email: user.email,
        mobile: user.mobile,
      },
    };
  },

  /** Rotate a refresh token: revoke the presented one, issue a fresh pair. */
  async refresh(rawRefreshToken: string, ip?: string | null, userAgent?: string | null) {
    const hash = hashRefreshToken(rawRefreshToken);
    const record = await authRepository.findValidRefreshToken(hash);
    if (!record) {
      // Reuse detection: a known-but-revoked token being replayed means it was
      // already rotated. Within a short grace window this is almost always a
      // benign race (second browser tab, network retry, dev double-mount) — we
      // reject it but leave other sessions alone. Beyond the grace window it's
      // a theft indicator: kill every session for that user.
      const stale = await authRepository.findRefreshTokenIncludingRevoked(hash);
      if (stale?.revoked_at) {
        const ageMs = Date.now() - stale.revoked_at.getTime();
        if (ageMs > REUSE_GRACE_MS) {
          await authRepository.revokeAllForUser(stale.user_id);
          await audit({
            actorId: stale.user_id,
            action: 'REFRESH_TOKEN_REUSE',
            entity: 'user',
            entityId: stale.user_id,
            meta: { tokenId: stale.id, revokedAgoMs: ageMs },
            ip,
            userAgent,
          });
        }
      }
      throw Unauthorized('Invalid refresh token');
    }

    const user = await authRepository.findByIdWithRole(record.user_id);
    if (!user || !user.is_active) throw Unauthorized('User unavailable');
    if (user.locked_until && user.locked_until > new Date()) {
      throw Locked('Account locked due to failed attempts. Try later or contact admin.');
    }

    // Rotate: revoke the presented token, mint a fresh access + refresh pair.
    await authRepository.revokeRefreshToken(hash);
    const perms = await authRepository.permissionsFor(user.id);
    const accessToken = signAccessToken({
      sub: user.id,
      role: user.role_name,
      perms,
      ...(user.must_change_password ? { pwc: true } : {}),
    });

    // Preserve the session's original lifetime: a "remember me" login keeps its
    // long TTL across rotations instead of shrinking to the default on first refresh.
    const { raw, hash: newHash } = createRefreshToken();
    const ttl = record.remember ? env.JWT_REFRESH_TTL_REMEMBER : env.JWT_REFRESH_TTL;
    const refreshExpiresAt = new Date(Date.now() + ms(ttl));
    await authRepository.storeRefreshToken(
      user.id,
      newHash,
      refreshExpiresAt,
      userAgent ?? null,
      ip ?? null,
      record.remember,
    );

    return { accessToken, refreshToken: raw, refreshExpiresAt };
  },

  async logout(rawRefreshToken: string, actorId?: string) {
    if (rawRefreshToken) await authRepository.revokeRefreshToken(hashRefreshToken(rawRefreshToken));
    if (actorId) await audit({ actorId, action: 'LOGOUT', entity: 'user', entityId: actorId });
  },

  /**
   * Self-service password change (also clears must_change_password). Requires
   * the current password, and revokes every other session afterwards.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ip?: string | null,
  ) {
    const user = await authRepository.findByIdWithRole(userId);
    if (!user || !user.is_active) throw Unauthorized('User unavailable');

    const valid = await argon2.verify(user.password_hash, currentPassword);
    if (!valid) throw Unauthorized('Current password is incorrect');
    if (currentPassword === newPassword) {
      throw Unauthorized('New password must be different from the current one');
    }

    await authRepository.changePassword(userId, await argon2.hash(newPassword));
    // Invalidate every existing session — anyone holding the old credentials
    // (including whoever set the temporary password) is logged out.
    await authRepository.revokeAllForUser(userId);

    await audit({
      actorId: userId,
      action: 'PASSWORD_CHANGED',
      entity: 'user',
      entityId: userId,
      ip,
    });
    return { changed: true };
  },

  /**
   * Mint a fresh access + refresh pair for an already-verified user — used
   * right after a password change so the current session continues.
   */
  async issueSession(userId: string, ip?: string | null, userAgent?: string | null): Promise<AuthResult> {
    const user = await authRepository.findByIdWithRole(userId);
    if (!user || !user.is_active) throw Unauthorized('User unavailable');

    const perms = await authRepository.permissionsFor(user.id);
    const accessToken = signAccessToken({
      sub: user.id,
      role: user.role_name,
      perms,
      ...(user.must_change_password ? { pwc: true } : {}),
    });
    const { raw, hash } = createRefreshToken();
    const refreshExpiresAt = new Date(Date.now() + ms(env.JWT_REFRESH_TTL));
    await authRepository.storeRefreshToken(user.id, hash, refreshExpiresAt, userAgent ?? null, ip ?? null);

    return {
      accessToken,
      refreshToken: raw,
      refreshExpiresAt,
      user: {
        id: user.id,
        fullName: user.full_name,
        role: user.role_name,
        email: user.email,
        mobile: user.mobile,
      },
    };
  },
};
