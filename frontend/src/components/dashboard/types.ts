export interface DashboardData {
  kpis: {
    totalCustomers: number;
    activeLoans: number;
    todaysCollection: { cash: number; digital: number; total: number; previousTotal?: number };
    todaysDue: number;
    todaysMissed: number;
    pendingApprovals: number;
    availableCash: number;
    totalExpenses: number;
    // Extended fields (optional — graceful fallback when the backend hasn't shipped them yet)
    cashSplit?: { cashInHand: number; bankUpi: number };
    missedEmiAmount?: number;
    missedEmiAreas?: number;
    outstandingPrincipal?: number;
    newCustomersThisMonth?: number;
    pendingApprovalsValue?: number;
    overdueLoansCount?: number;
    overduePenalty?: number;
    disbursedThisMonth?: number;
    disbursedThisMonthCount?: number;
    salaryExpense?: number;
    pendingHandoverMine?: number;
    dueMine?: number;
  };
  areaWiseCollection: Array<{ area: string; amount: number }>;
  agentWiseCollection: Array<{
    agentId?: string | null;
    agent: string;
    area?: string;
    amount: number;
    shortAmount?: number;
  }>;
  collectionTrend: Array<{ date: string; amount: number; due?: number }>;
  pendingLoanApprovals?: Array<{
    id: string;
    loanNumber: string;
    customerName: string;
    area: string;
    amount: number;
    sequenceNo: number;
  }>;
  recentActivity?: Array<{
    id: string;
    action: string;
    entity: string;
    actorName: string;
    meta: Record<string, unknown> | null;
    createdAt: string;
  }>;
  pendingHandoverByAgent?: Array<{ agentId: string; agentName: string; pendingAmount: number; dueAmount: number }>;
}
