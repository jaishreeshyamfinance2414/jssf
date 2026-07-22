import { query } from '../../db/pool';

/**
 * Read-only accessor for configurable business rules (penalty rate, loan
 * number format, default interest). A full settings CRUD
 * UI can be added later without touching this — it's the single place every
 * module reads business-rule values from, keeping them out of application code.
 */
export const settingsRepository = {
  async get<T>(key: string): Promise<T> {
    const { rows } = await query<{ value: T }>(`SELECT value FROM settings WHERE key = $1`, [key]);
    if (!rows[0]) throw new Error(`Missing required setting: ${key}`);
    return rows[0].value;
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
