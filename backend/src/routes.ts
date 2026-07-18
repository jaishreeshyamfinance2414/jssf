import { Router } from 'express';
import authRoutes from './modules/auth/auth.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import userRoutes from './modules/users/user.routes';
import areaRoutes from './modules/areas/area.routes';
import customerRoutes from './modules/customers/customer.routes';
import loanRoutes from './modules/loans/loan.routes';
import collectionRoutes from './modules/collections/collection.routes';
import capitalRoutes from './modules/capital/capital.routes';
import accountsRoutes from './modules/accounts/accounts.routes';
import expenseRoutes from './modules/expenses/expense.routes';
import agentLedgerRoutes from './modules/agent-ledger/agent-ledger.routes';
import approvalRoutes from './modules/approvals/approval.routes';
import reportRoutes from './modules/reports/reports.routes';
import auditRoutes from './modules/audit/audit.routes';
import salaryRoutes from './modules/salary/salary.routes';

/**
 * Central API router. New modules (customers, loans, collections, expenses,
 * salary, reports, settings, audit) mount here — one line each.
 */
const api = Router();

api.use('/auth', authRoutes);
api.use('/dashboard', dashboardRoutes);
api.use('/users', userRoutes);
api.use('/areas', areaRoutes);
api.use('/customers', customerRoutes);
api.use('/loans', loanRoutes);
api.use('/collections', collectionRoutes);
api.use('/capital', capitalRoutes);
api.use('/accounts', accountsRoutes);
api.use('/expenses', expenseRoutes);
api.use('/agent-ledger', agentLedgerRoutes);
api.use('/approval-requests', approvalRoutes);
api.use('/reports', reportRoutes);
api.use('/audit', auditRoutes);
api.use('/salaries', salaryRoutes);

// Future modules — mount as they're implemented:
// api.use('/settings', settingRoutes);

export default api;
