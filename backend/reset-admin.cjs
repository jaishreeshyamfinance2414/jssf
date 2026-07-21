// One-off admin password reset. Usage:
//   node reset-admin.cjs                       -> list admin users
//   node reset-admin.cjs <email> <newPassword> -> reset that user's password
// Delete this file when done.
require('dotenv/config');
const argon2 = require('argon2');
const { Pool } = require('pg');
const pool = new Pool();

async function main() {
  const [email, password] = process.argv.slice(2);

  if (!email) {
    const r = await pool.query(
      `SELECT u.email, u.mobile, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE r.name = 'admin'`,
    );
    console.table(r.rows);
    console.log('Now run: node reset-admin.cjs <email> <newPassword>');
    return;
  }

  if (!password) {
    console.error('Usage: node reset-admin.cjs <email> <newPassword>');
    process.exit(1);
  }

  const hash = await argon2.hash(password);
  const r = await pool.query(
    `UPDATE users SET password_hash = $1, must_change_password = false
     WHERE email = $2 RETURNING email`,
    [hash, email],
  );
  console.log(r.rowCount ? `Password reset for ${r.rows[0].email}` : 'No user with that email');
}

main()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => pool.end());
