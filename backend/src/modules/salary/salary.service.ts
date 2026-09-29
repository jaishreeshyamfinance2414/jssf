import { withTransaction } from '../../db/pool';
import { BadRequest, NotFound } from '../../shared/errors';
import { accountsRepository } from '../accounts/accounts.repository';
import { ledgerService } from '../accounts/ledger.service';
import { audit } from '../audit/audit.service';
import { CreateSalaryBody } from './salary.schema';
import { salaryRepository } from './salary.repository';

function salaryCycle(year: number, month: number, paymentDay: number) {
  const scheduledMonth = new Date(Date.UTC(year, month - 1, 1));
  const previousMonth = new Date(Date.UTC(year, month - 2, 1));
  const formatScheduledDate = (value: Date) => {
    const lastDay = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate();
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), Math.min(paymentDay, lastDay)))
      .toISOString().slice(0, 10);
  };
  return { lastSalaryDate: formatScheduledDate(previousMonth), upcomingSalaryDate: formatScheduledDate(scheduledMonth) };
}

export const salaryService = {
  async upsertMember(input: { userId: string; monthlySalary: number; salaryDate: string }, actorId: string, ip?: string | null) {
    const member = await salaryRepository.upsertMember({ ...input, createdBy: actorId });
    if (!member) throw BadRequest('Selected user is not active.');
    await audit({ actorId, action: 'UPDATE', entity: 'member_salary', entityId: input.userId, meta: input, ip });
    return member;
  },

  async payable(input: { userId: string; periodYear: number; periodMonth: number; cashShortDeduct: number; advanceDeduct: number }) {
    const member = await salaryRepository.member(input.userId);
    if (!member) throw BadRequest('Add a fixed salary for this active user first.');
    const baseSalary = Number(member.monthly_salary);
    const otherDeductions = input.cashShortDeduct + input.advanceDeduct;
    if (otherDeductions > baseSalary) throw BadRequest('Deductions exceed the monthly salary.');
    const cycle = salaryCycle(input.periodYear, input.periodMonth, member.payment_day);
    const pending = await salaryRepository.pendingExpenses(input.userId, cycle.lastSalaryDate, cycle.upcomingSalaryDate);
    const pendingExpense = pending.reduce((sum, expense) => sum + Number(expense.remaining), 0);
    const expenseDeduct = Math.min(pendingExpense, baseSalary - otherDeductions);
    return {
      baseSalary,
      pendingExpense: Number(pendingExpense.toFixed(2)),
      expenseDeduct: Number(expenseDeduct.toFixed(2)),
      finalSalary: Number((baseSalary - otherDeductions - expenseDeduct).toFixed(2)),
      ...cycle,
    };
  },

  /** Pay a staff salary: record the row and debit cash/bank via the shared ledger. */
  async create(input: CreateSalaryBody, actorId: string, ip?: string | null) {
    return withTransaction(async (client) => {
      const member = await salaryRepository.member(input.userId, client);
      if (!member) throw BadRequest('Add a fixed salary for this active user first.');
      const existing = await salaryRepository.findForPeriod(input.userId, input.periodYear, input.periodMonth, client);
      if (existing) throw BadRequest('Salary for this staff member and month is already recorded.');
      const baseSalary = Number(member.monthly_salary);
      const otherDeductions = input.cashShortDeduct + input.advanceDeduct;
      if (otherDeductions > baseSalary) throw BadRequest('Deductions exceed the monthly salary.');
      const cycle = salaryCycle(input.periodYear, input.periodMonth, member.payment_day);
      const pending = await salaryRepository.pendingExpenses(input.userId, cycle.lastSalaryDate, cycle.upcomingSalaryDate, client);
      const pendingExpense = pending.reduce((sum, expense) => sum + Number(expense.remaining), 0);
      const expenseDeduct = Number(Math.min(pendingExpense, baseSalary - otherDeductions).toFixed(2));
      const finalSalary = Number((baseSalary - otherDeductions - expenseDeduct).toFixed(2));

      const salary = await salaryRepository.create({ ...input, baseSalary, expenseDeduct, finalSalary, createdBy: actorId }, client);
      await salaryRepository.allocateExpenses(salary.id, pending, expenseDeduct, client);
      const nextMonth = new Date(Date.UTC(input.periodYear, input.periodMonth, 1));
      const lastDay = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 0)).getUTCDate();
      const nextSalaryDate = new Date(Date.UTC(
        nextMonth.getUTCFullYear(), nextMonth.getUTCMonth(), Math.min(member.payment_day, lastDay),
      )).toISOString().slice(0, 10);
      await salaryRepository.advanceSalaryDate(input.userId, nextSalaryDate, client);
      if (finalSalary > 0) {
        const account = await accountsRepository.getByType(input.mode === 'cash' ? 'cash' : 'bank', client);
        await ledgerService.post(client, {
          accountId: account.id,
          direction: 'debit',
          amount: finalSalary,
          source: 'salary',
          referenceId: salary.id,
          description: `Salary ${input.periodMonth}/${input.periodYear}`,
          createdBy: actorId,
        });
      }
      await audit(
        {
          actorId,
          action: 'CREATE',
          entity: 'salary',
          entityId: salary.id,
          meta: { userId: input.userId, period: `${input.periodMonth}/${input.periodYear}`, ...cycle, baseSalary, expenseDeduct, finalSalary, mode: input.mode },
          ip,
        },
        client,
      );
      return salary;
    });
  },

  /** Delete a salary record and credit the paid amount back to the account. */
  async remove(id: string, actorId: string, ip?: string | null) {
    return withTransaction(async (client) => {
      const salary = await salaryRepository.remove(id, client);
      if (!salary) throw NotFound('Salary record not found');
      const finalSalary = Number(salary.final_salary);
      if (finalSalary > 0) {
        const account = await accountsRepository.getByType(salary.mode === 'cash' ? 'cash' : 'bank', client);
        await ledgerService.post(client, {
          accountId: account.id,
          direction: 'credit',
          amount: finalSalary,
          source: 'salary',
          referenceId: salary.id,
          description: `Salary reversal ${salary.period_month}/${salary.period_year}`,
          createdBy: actorId,
        });
      }
      await audit(
        { actorId, action: 'DELETE', entity: 'salary', entityId: id, meta: { finalSalary }, ip },
        client,
      );
      return { id };
    });
  },
};
