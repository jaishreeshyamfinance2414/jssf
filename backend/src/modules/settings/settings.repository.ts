import { query } from '../../db/pool';

/**
 * Accessor for configurable business rules (penalty rate, loan
 * number format, default interest). The `update` method allows
 * admin-driven changes from the settings UI.
 */
export const settingsRepository = {
  async get<T>(key: string): Promise<T> {
    const { rows } = await query<{ value: T }>(`SELECT value FROM settings WHERE key = $1`, [key]);
    if (!rows[0]) throw new Error(`Missing required setting: ${key}`);
    return rows[0].value;
  },

  async getAll(): Promise<Array<{ key: string; value: unknown; description: string }>> {
    const { rows } = await query<{ key: string; value: unknown; description: string }>(
      `SELECT key, value, description FROM settings ORDER BY key`,
    );
    return rows;
  },

  async update(key: string, value: unknown): Promise<void> {
    const { rowCount } = await query(
      `UPDATE settings SET value = $2 WHERE key = $1`,
      [key, JSON.stringify(value)],
    );
    if (!rowCount) throw new Error(`Setting not found: ${key}`);
  },
};

export interface PenaltySetting {
  per_day_pct: number;
}
export interface LoanNumberSetting {
  prefix: string;
  pad: number;
}
export interface DefaultInterestSetting {
  pct: number;
}
