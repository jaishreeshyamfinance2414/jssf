import { withTransaction } from '../../db/pool';
import { BadRequest, NotFound } from '../../shared/errors';
import { accountsRepository } from '../accounts/accounts.repository';
import { ledgerService } from '../accounts/ledger.service';
import { audit } from '../audit/audit.service';
import { CreateSalaryBody } from './salary.schema';
import { salaryRepository } from './salary.repository';

export const salaryService = {
  /** Pay a staff salary: record the row and debit cash/bank via the shared ledger. */
  async create(input: CreateSalaryBody, actorId: string, ip?: string | null) {
    const finalSalary = Number(
      (input.baseSalary - input.cashShortDeduct - input.advanceDeduct - input.expenseDeduct).toFixed(2),
    );
    if (finalSalary < 0) throw BadRequest('Deductions exceed the base salary.');

    return withTransaction(async (client) => {
      const existing = await salaryRepository.findForPeriod(input.userId, input.periodYear, input.periodMonth, client);
      if (existing) throw BadRequest('Salary for this staff member and month is already recorded.');

      const salary = await salaryRepository.create({ ...input, finalSalary, createdBy: actorId }, client);
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
          meta: { userId: input.userId, period: `${input.periodMonth}/${input.periodYear}`, finalSalary, mode: input.mode },
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
