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

  async branding() {
    const { rows } = await query<{ business_name: string; logo_version: string | null; favicon_version: string | null }>(
      `SELECT COALESCE((SELECT value->>'businessName' FROM settings WHERE key='branding'), 'Jai Shree Shyam Finance') AS business_name,
        (SELECT extract(epoch FROM updated_at)::text FROM branding_assets WHERE kind='logo') AS logo_version,
        (SELECT extract(epoch FROM updated_at)::text FROM branding_assets WHERE kind='favicon') AS favicon_version`,
    );
    return { businessName: rows[0].business_name, logoVersion: rows[0].logo_version, faviconVersion: rows[0].favicon_version };
  },

  async getBrandingAsset(kind: 'logo' | 'favicon') {
    const { rows } = await query<{ content_type: string; bytes: Buffer }>(
      'SELECT content_type, bytes FROM branding_assets WHERE kind=$1', [kind]);
    return rows[0];
  },

  async putBrandingAsset(kind: 'logo' | 'favicon', contentType: string, bytes: Buffer) {
    await query(`INSERT INTO branding_assets(kind, content_type, bytes) VALUES($1,$2,$3)
      ON CONFLICT(kind) DO UPDATE SET content_type=EXCLUDED.content_type, bytes=EXCLUDED.bytes, updated_at=now()`,
    [kind, contentType, bytes]);
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
