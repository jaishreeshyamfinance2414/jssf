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

export const authService = {
  async login(input: LoginInput): Promise<AuthResult> {
    const user = await authRepository.findByIdentifier(input.identifier);

    // Uniform failure to avoid leaking which accounts exist.
    if (!user) throw Unauthorized('Invalid credentials');

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
    const accessToken = signAccessToken({ sub: user.id, role: user.role_name, perms });

    const { raw, hash } = createRefreshToken();
    const ttl = input.rememberMe ? env.JWT_REFRESH_TTL_REMEMBER : env.JWT_REFRESH_TTL;
    const refreshExpiresAt = new Date(Date.now() + ms(ttl));
    await authRepository.storeRefreshToken(
      user.id,
      hash,
      refreshExpiresAt,
      input.userAgent ?? null,
      input.ip ?? null,
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
    if (!record) throw Unauthorized('Invalid refresh token');

    const user = await authRepository.findByIdWithRole(record.user_id);
    if (!user || !user.is_active) throw Unauthorized('User unavailable');

    // Rotate: revoke the presented token, mint a fresh access + refresh pair.
    await authRepository.revokeRefreshToken(hash);
    const perms = await authRepository.permissionsFor(user.id);
    const accessToken = signAccessToken({ sub: user.id, role: user.role_name, perms });

    const { raw, hash: newHash } = createRefreshToken();
    const refreshExpiresAt = new Date(Date.now() + ms(env.JWT_REFRESH_TTL));
    await authRepository.storeRefreshToken(user.id, newHash, refreshExpiresAt, userAgent ?? null, ip ?? null);

    return { accessToken, refreshToken: raw, refreshExpiresAt };
  },

  async logout(rawRefreshToken: string, actorId?: string) {
    if (rawRefreshToken) await authRepository.revokeRefreshToken(hashRefreshToken(rawRefreshToken));
    if (actorId) await audit({ actorId, action: 'LOGOUT', entity: 'user', entityId: actorId });
  },
};
