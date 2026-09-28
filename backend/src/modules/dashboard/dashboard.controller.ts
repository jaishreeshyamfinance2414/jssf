import { Request, Response } from 'express';
import { ok } from '../../shared/http';
import { dashboardRepository as r } from './dashboard.repository';
import { agentLedgerRepository as al } from '../agent-ledger/agent-ledger.repository';

const ADMIN_LIKE = ['admin', 'manager'];

export const dashboardController = {
  /** All KPIs + breakdowns in one payload, computed concurrently. */
  async summary(req: Request, res: Response) {
    const [
      totalCustomers,
      activeLoans,
      todaysCollection,
      todaysDue,
      todaysMissed,
      pendingApprovals,
      availableCash,
      totalExpenses,
      areaWise,
      agentWise,
      trend,
      cashSplit,
      missedEmi,
      outstandingPrincipal,
      newCustomersThisMonth,
      pendingApprovalsValue,
      overdueLoans,
      disbursedThisMonth,
      salaryExpense,
      pendingLoanApprovals,
      recentActivity,
    ] = await Promise.all([
      r.totalCustomers(req.areaIds),
      r.activeLoans(req.areaIds),
      r.todaysCollection(req.areaIds),
      r.todaysDue(req.areaIds),
      r.todaysMissed(req.areaIds),
      r.pendingApprovals(req.areaIds),
      r.availableCash(),
      r.totalExpenses(),
      r.areaWiseCollection(req.areaIds),
      r.agentWiseCollection(req.areaIds),
      r.collectionTrend(req.areaIds),
      r.cashSplit(),
      r.missedEmiSummary(req.areaIds),
      r.outstandingPrincipal(req.areaIds),
      r.newCustomersThisMonth(req.areaIds),
      r.pendingApprovalsValue(req.areaIds),
      r.overdueLoans(req.areaIds),
      r.disbursedThisMonth(req.areaIds),
      r.salaryExpenseThisMonth(),
      r.pendingLoanApprovals(req.areaIds),
      r.recentActivity(req.areaIds),
    ]);

    const base = {
      kpis: {
        totalCustomers,
        activeLoans,
        todaysCollection,
        todaysDue,
        todaysMissed,
        pendingApprovals,
        availableCash,
        totalExpenses,
        cashSplit,
        missedEmiAmount: missedEmi.amount,
        missedEmiAreas: missedEmi.areas,
        outstandingPrincipal,
        newCustomersThisMonth,
        pendingApprovalsValue,
        overdueLoansCount: overdueLoans.count,
        overduePenalty: overdueLoans.penalty,
        disbursedThisMonth: disbursedThisMonth.amount,
        disbursedThisMonthCount: disbursedThisMonth.count,
        salaryExpense,
      },
      areaWiseCollection: areaWise,
      agentWiseCollection: agentWise,
      collectionTrend: trend,
      pendingLoanApprovals,
      recentActivity,
    };

    if (ADMIN_LIKE.includes(req.user!.role)) {
      const [byAgent, dueByAgent, borrowedLoans, borrowedLoanReminders] = await Promise.all([
        al.pendingByAgent(), al.lifetimeDueByAgent(), r.borrowedLoanSummary(req.areaIds), r.borrowedLoanReminders(req.areaIds),
      ]);
      const dueMap = new Map(dueByAgent.map((d) => [d.agentId, d.dueAmount]));
      return ok(res, {
        ...base,
        borrowedLoans,
        borrowedLoanReminders,
        pendingHandoverByAgent: byAgent.map((a) => ({ ...a, dueAmount: dueMap.get(a.agentId) ?? 0 })),
      });
    }

    // collection_agent (or any other non-admin/manager role): self-scoped only.
    const [pendingHandoverMine, dueMine] = await Promise.all([
      al.pendingForAgent(req.user!.sub),
      al.lifetimeDue(req.user!.sub),
    ]);
    return ok(res, {
      ...base,
      kpis: { ...base.kpis, pendingHandoverMine, dueMine },
    });
  },
};
