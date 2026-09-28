import { NextFunction, Request, Response } from 'express';
import { Forbidden, Unauthorized } from '../shared/errors';
import { query } from '../db/pool';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      areaIds?: string[];
    }
  }
}

async function requireAreaScope(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      return next(Unauthorized());
    }

    // Always resolve the current assignment from the database. Area access
    // and role changes must take effect immediately, not when a token expires.
    const result = await query<{ role_name: string; area_id: string | null; area_active: boolean | null }>(
      `SELECT r.name AS role_name, u.area_id, a.is_active AS area_active
         FROM users u JOIN roles r ON r.id = u.role_id
         LEFT JOIN areas a ON a.id = u.area_id
        WHERE u.id = $1 AND u.is_active = true`,
      [req.user.sub],
    );
    const current = result.rows[0];
    if (!current) return next(Unauthorized('User unavailable'));
    if (current.role_name === 'admin' || current.role_name === 'manager') {
      req.areaIds = undefined;
      return next();
    }
    const areaIds = current.area_id && current.area_active ? [current.area_id] : [];

    if (areaIds.length === 0) {
      return next(Forbidden('No area assigned to your account. Contact your administrator to assign an area.'));
    }

    req.areaIds = areaIds;
    next();
  } catch (err) {
    next(err);
  }
}

/** Factory wrapper — matches the pattern used by requirePasskey(). */
export function scopeByArea() {
  return requireAreaScope;
}
