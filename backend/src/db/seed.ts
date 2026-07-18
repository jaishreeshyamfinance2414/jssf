import argon2 from 'argon2';
import { pool, withTransaction } from './pool';
import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * Idempotent seed: roles, the full permission catalog, role→permission maps,
 * default settings (business rules), an expense category set, and the admin user.
 * Safe to re-run — uses upserts.
 */

// Permission catalog — code | module. RBAC checks these codes.
const PERMISSIONS: Array<[string, string, string]> = [
  ['dashboard.view', 'dashboard', 'View dashboard'],
  ['user.view', 'user', 'View users'],
  ['user.create', 'user', 'Create users'],
  ['user.update', 'user', 'Update users'],
  ['user.unlock', 'user', 'Unlock locked accounts'],
  ['user.delete', 'user', 'Deactivate a user'],
  ['role.manage', 'role', 'Manage roles & permissions'],
  ['area.view', 'area', 'View areas'],
  ['area.manage', 'area', 'Create/update areas & assign agents'],
  ['customer.view', 'customer', 'View customers'],
  ['customer.create', 'customer', 'Create customers'],
  ['customer.update', 'customer', 'Update customers'],
  ['customer.delete', 'customer', 'Delete customers'],
  ['loan.view', 'loan', 'View loans'],
  ['loan.create', 'loan', 'Create loans'],
  ['loan.update', 'loan', 'Update loan applications'],
  ['loan.approve', 'loan', 'Approve/reject loans'],
  ['loan.disburse', 'loan', 'Disburse approved loans'],
  ['loan.close', 'loan', 'Manually close a loan, optionally waiving the remaining balance'],
  ['loan.delete', 'loan', 'Delete a rejected loan'],
  ['approval.review', 'approval', 'View and decide manager approval requests'],
  ['collection.view', 'collection', 'View collections'],
  ['collection.create', 'collection', 'Record collections'],
  ['collection.handover', 'collection', 'Record agent cash handover / reconciliation'],
  ['collection.delete', 'collection', 'Delete a collection entry'],
  ['collection.update', 'collection', 'Edit a collection entry (date/amount)'],
  ['expense.view', 'expense', 'View expenses'],
  ['expense.manage', 'expense', 'Create/update expenses'],
  ['salary.view', 'salary', 'View salaries'],
  ['salary.manage', 'salary', 'Manage salaries'],
  ['report.view', 'report', 'View & export reports'],
  ['settings.manage', 'settings', 'Manage system settings'],
  ['audit.view', 'audit', 'View audit logs'],
  ['capital.view', 'capital', 'View capital entries & account balances'],
  ['capital.manage', 'capital', 'Record capital introduced into the business'],
];

// Role → permission codes. Admin gets everything.
const ROLE_PERMS: Record<string, string[]> = {
  manager: [
    'dashboard.view', 'user.view', 'area.view', 'area.manage',
    'customer.view', 'customer.create',
    'loan.view', 'loan.create',
    'collection.view', 'collection.create',
    'expense.view', 'salary.view', 'report.view', 'capital.view',
    // Manager gets these too, but each attempt is queued for admin sign-off
    // instead of applying immediately — see backend/src/modules/approvals.
    'loan.approve', 'loan.disburse', 'loan.close',
    'customer.delete', 'collection.handover',
  ],
  collection_agent: [
    'dashboard.view',
    'area.view',
    'customer.view', 'customer.create',
    'loan.view', 'loan.create',
    'collection.view', 'collection.create',
  ],
  accounts_dept: [
    'dashboard.view',
    'area.view',
    'customer.view', 'customer.create',
    'loan.view', 'loan.create',
    'collection.view', 'collection.create',
  ],
};

const COLLECTION_AGENTS = [
  {
    fullName: 'Collection Agent One',
    email: 'agent1@jssf.local',
    mobile: '8888888881',
  },
  {
    fullName: 'Collection Agent Two',
    email: 'agent2@jssf.local',
    mobile: '8888888882',
  },
];

const SETTINGS: Array<[string, unknown, string]> = [
  ['processing_fee', { first_loan_pct: 5, subsequent_pct: 1 }, 'Processing fee % by loan sequence'],
  ['penalty', { per_day_pct: 0.5 }, 'Penalty % of loan principal per missed day'],
  ['loan_number', { prefix: 'JSSF', pad: 7 }, 'Loan number format'],
  ['default_interest_rate', { pct: 10 }, 'Default flat interest %'],
];

async function seed() {
  await withTransaction(async (c) => {
    // Roles
    await c.query(
      `INSERT INTO roles(name,label,is_system) VALUES
        ('admin','Admin',true),
        ('manager','Manager',true),
        ('collection_agent','Collection Agent',true),
        ('accounts_dept','Accounts Dept',true)
       ON CONFLICT (name) DO NOTHING`,
    );

    // Permissions
    for (const [code, mod, desc] of PERMISSIONS) {
      await c.query(
        `INSERT INTO permissions(code,module,description) VALUES ($1,$2,$3)
         ON CONFLICT (code) DO UPDATE SET module=EXCLUDED.module, description=EXCLUDED.description`,
        [code, mod, desc],
      );
    }

    // Admin → all permissions
    await c.query(
      `INSERT INTO role_permissions(role_id, permission_id)
       SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
       WHERE r.name='admin'
       ON CONFLICT DO NOTHING`,
    );

    await c.query(
      `DELETE FROM role_permissions rp
        USING roles r
        WHERE rp.role_id = r.id
          AND r.name IN ('manager','collection_agent','accounts_dept')`,
    );

    // Manager / agent restricted subsets
    for (const [role, codes] of Object.entries(ROLE_PERMS)) {
      await c.query(
        `INSERT INTO role_permissions(role_id, permission_id)
         SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = ANY($2)
         WHERE r.name=$1
         ON CONFLICT DO NOTHING`,
        [role, codes],
      );
    }

    // Settings
    for (const [key, value, desc] of SETTINGS) {
      await c.query(
        `INSERT INTO settings(key,value,description) VALUES ($1,$2,$3)
         ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
        [key, JSON.stringify(value), desc],
      );
    }

    // Expense categories
    for (const name of ['Rent', 'Utilities', 'Fuel', 'Office', 'Salary', 'Misc']) {
      await c.query(
        `INSERT INTO expense_categories(name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
        [name],
      );
    }

    // Default branch (single-branch business for now; future multi-branch
    // rollout just adds more rows here — accounts/loans/etc. already carry branch_id).
    await c.query(
      `INSERT INTO branches(name, code) VALUES ('Head Office','HO') ON CONFLICT (code) DO NOTHING`,
    );

    await c.query(
      `INSERT INTO areas(name, code)
       SELECT 'General Area','GEN'
       WHERE NOT EXISTS (SELECT 1 FROM areas WHERE code = 'GEN')`,
    );

    // Default Cash + Bank accounts for the Head Office branch — the ledger's
    // two posting targets for every collection/disbursement/expense/salary.
    await c.query(
      `INSERT INTO accounts(branch_id, name, type)
       SELECT b.id, 'Cash In Hand', 'cash' FROM branches b WHERE b.code='HO'
       ON CONFLICT DO NOTHING`,
    );
    await c.query(
      `INSERT INTO accounts(branch_id, name, type)
       SELECT b.id, 'Bank Account', 'bank' FROM branches b WHERE b.code='HO'
       ON CONFLICT DO NOTHING`,
    );

    // Admin user
    const hash = await argon2.hash(env.SEED_ADMIN_PASSWORD);
    await c.query(
      `INSERT INTO users(role_id, full_name, email, mobile, password_hash)
       SELECT r.id, 'Administrator', $1, $2, $3 FROM roles r WHERE r.name='admin'
       ON CONFLICT (mobile) DO NOTHING`,
      [env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_MOBILE, hash],
    );

    const agentHash = await argon2.hash('Agent@123');
    for (const agent of COLLECTION_AGENTS) {
      await c.query(
        `INSERT INTO users(role_id, full_name, email, mobile, password_hash)
         SELECT r.id, $1, $2, $3, $4 FROM roles r WHERE r.name='collection_agent'
         ON CONFLICT (mobile) DO NOTHING`,
        [agent.fullName, agent.email, agent.mobile, agentHash],
      );
    }
  });

  logger.info(
    `Seed complete. Admin login → email:${env.SEED_ADMIN_EMAIL} mobile:${env.SEED_ADMIN_MOBILE} password:${env.SEED_ADMIN_PASSWORD}`,
  );
  await pool.end();
}

seed().catch((err) => {
  logger.error({ err }, 'Seed failed');
  process.exit(1);
});
