import argon2 from 'argon2';
import { NextFunction, Request, Response } from 'express';
import { query } from '../db/pool';
import { AppError, Forbidden } from '../shared/errors';

/**
 * Admin passkey — second factor for destructive/sensitive actions.
 *
 * The client sends the 4-digit PIN in the `x-admin-passkey` header. Wrong or
 * missing PIN → 428 PASSKEY_REQUIRED, which the frontend turns into a themed
 * prompt and a retry. Five consecutive failures lock verification for 15
 * minutes. The PIN is set/reset ONLY via `npm run passkey` on the server
 * shell (scripts/passkey.ts) — no API can change it.
 *
 * If no passkey row exists (feature not initialised), actions pass through —
 * so a fresh install works before the admin runs the script.
 */
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const PasskeyRequired = (msg = 'Admin passkey required') => new AppError(428, msg, 'PASSKEY_REQUIRED');

interface PasskeyRow {
  hash: string;
  failed_attempts: number;
  locked_until: string | null;
}

export function requirePasskey() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const { rows } = await query<PasskeyRow>(
        `SELECT hash, failed_attempts, locked_until FROM admin_passkey WHERE id = 1`,
      );
      const row = rows[0];
      if (!row) return next(); // not configured yet — feature disabled

      if (row.locked_until && new Date(row.locked_until) > new Date()) {
        return next(Forbidden(`Passkey locked due to failed attempts. Try again after ${LOCK_MINUTES} minutes.`));
      }

      const supplied = req.headers['x-admin-passkey'];
      if (typeof supplied !== 'string' || !/^\d{4}$/.test(supplied)) {
        return next(PasskeyRequired());
      }

      const ok = await argon2.verify(row.hash, supplied);
      if (!ok) {
        const attempts = row.failed_attempts + 1;
        await query(
          `UPDATE admin_passkey SET failed_attempts = $1,
             locked_until = CASE WHEN $1 >= $2 THEN now() + interval '${LOCK_MINUTES} minutes' END,
             updated_at = now()
           WHERE id = 1`,
          [attempts, MAX_ATTEMPTS],
        );
        return next(
          attempts >= MAX_ATTEMPTS
            ? Forbidden(`Too many wrong passkeys. Locked for ${LOCK_MINUTES} minutes.`)
            : PasskeyRequired('Incorrect passkey'),
        );
      }

      if (row.failed_attempts > 0) {
        await query(`UPDATE admin_passkey SET failed_attempts = 0, locked_until = NULL WHERE id = 1`);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
