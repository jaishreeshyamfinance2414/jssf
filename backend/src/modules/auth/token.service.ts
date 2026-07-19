import crypto from 'node:crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../../config/env';

export interface AccessTokenPayload {
  sub: string; // user id
  role: string; // role name
  perms: string[]; // permission codes
  pwc?: boolean; // must change password before using the app
}

export const signAccessToken = (payload: AccessTokenPayload): string =>
  jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_TTL } as SignOptions);

export const verifyAccessToken = (token: string): AccessTokenPayload =>
  jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;

/**
 * Refresh tokens are opaque random strings. We return the raw value to the client
 * (as an httpOnly cookie) but persist only its SHA-256 hash — a DB leak can't be replayed.
 */
export const createRefreshToken = () => {
  const raw = crypto.randomBytes(48).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
};

export const hashRefreshToken = (raw: string) =>
  crypto.createHash('sha256').update(raw).digest('hex');
