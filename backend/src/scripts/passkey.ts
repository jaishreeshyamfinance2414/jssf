/**
 * Set or reset the admin passkey from the server shell — the ONLY way to
 * change it (no API exists on purpose).
 *
 *   cd ~/jssf/backend && npm run passkey 1234
 *   npm run passkey --clear     # disable the passkey requirement
 */
import 'dotenv/config';
import argon2 from 'argon2';
import { pool } from '../db/pool';

async function main() {
  const arg = process.argv[2];

  if (arg === '--clear') {
    await pool.query(`DELETE FROM admin_passkey WHERE id = 1`);
    console.log('Admin passkey cleared — sensitive actions no longer require a PIN.');
    return;
  }

  if (!arg || !/^\d{4}$/.test(arg)) {
    console.error('Usage: npm run passkey <4-digit-pin>   (or --clear to disable)');
    process.exit(1);
  }

  const hash = await argon2.hash(arg);
  await pool.query(
    `INSERT INTO admin_passkey (id, hash) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET hash = EXCLUDED.hash,
       failed_attempts = 0, locked_until = NULL, updated_at = now()`,
    [hash],
  );
  console.log('Admin passkey set. Sensitive admin actions now require this PIN.');
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => pool.end());
