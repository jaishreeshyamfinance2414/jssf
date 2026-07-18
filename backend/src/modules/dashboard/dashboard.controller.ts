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
      r.totalCustomers(),
      r.activeLoans(),
      r.todaysCollection(),
      r.todaysDue(),
      r.todaysMissed(),
      r.pendingApprovals(),
      r.availableCash(),
      r.totalExpenses(),
      r.areaWiseCollection(),
      r.agentWiseCollection(),
      r.collectionTrend(),
      r.cashSplit(),
      r.missedEmiSummary(),
      r.outstandingPrincipal(),
      r.newCustomersThisMonth(),
      r.pendingApprovalsValue(),
      r.overdueLoans(),
      r.disbursedThisMonth(),
      r.salaryExpenseThisMonth(),
      r.pendingLoanApprovals(),
      r.recentActivity(),
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
      const [byAgent, dueByAgent] = await Promise.all([al.pendingByAgent(), al.lifetimeDueByAgent()]);
      const dueMap = new Map(dueByAgent.map((d) => [d.agentId, d.dueAmount]));
      return ok(res, {
        ...base,
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
