import { NextFunction, Request, Response } from 'express';
import { verifyAccessToken, AccessTokenPayload } from '../modules/auth/token.service';
import { Forbidden, Unauthorized } from '../shared/errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

/** Require a valid access token (Bearer header). Attaches req.user. */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(Unauthorized('Missing access token'));
  try {
    req.user = verifyAccessToken(header.slice(7));
    next();
  } catch {
    next(Unauthorized('Invalid or expired token'));
  }
}

/** Require the user to hold ALL of the given permission codes (RBAC). */
export function requirePermission(...required: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(Unauthorized());
    const held = new Set(req.user.perms);
    const missing = required.filter((p) => !held.has(p));
    if (missing.length) return next(Forbidden(`Missing permission: ${missing.join(', ')}`));
    next();
  };
}

/** Require one of the given role names. */
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(Unauthorized());
    if (!roles.includes(req.user.role)) return next(Forbidden('Role not permitted'));
    next();
  };
}
