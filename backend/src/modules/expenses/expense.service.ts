import { withTransaction } from '../../db/pool';
import { accountsRepository } from '../accounts/accounts.repository';
import { ledgerService } from '../accounts/ledger.service';
import { audit } from '../audit/audit.service';
import { CreateExpenseBody } from './expense.schema';
import { expenseRepository } from './expense.repository';
import { BadRequest } from '../../shared/errors';

export const expenseService = {
  async create(input: CreateExpenseBody, actorId: string, ip?: string | null) {
    return withTransaction(async (client) => {
      const categoryName = await expenseRepository.categoryName(input.categoryId, client);
      if (input.categoryId && !categoryName) throw BadRequest('Expense category not found.');
      const isUserExpense = categoryName === 'User Expense';
      if (isUserExpense && !input.userId) throw BadRequest('Select the user who used the money.');
      if (!isUserExpense && input.userId) throw BadRequest('A user can only be linked to the User Expense category.');
      if (input.userId && !(await expenseRepository.activeUser(input.userId, client))) {
        throw BadRequest('Selected user is not active.');
      }
      const expense = await expenseRepository.create({ ...input, createdBy: actorId }, client);
      const account = await accountsRepository.getByType(input.mode === 'cash' ? 'cash' : 'bank', client);
      await ledgerService.post(client, {
        accountId: account.id,
        direction: 'debit',
        amount: input.amount,
        source: 'expense',
        referenceId: expense.id,
        description: input.description,
        createdBy: actorId,
      });
      await audit(
        {
          actorId,
          action: 'CREATE',
          entity: 'expense',
          entityId: expense.id,
          meta: { amount: input.amount, mode: input.mode, description: input.description, userId: input.userId ?? null },
          ip,
        },
        client,
      );
      return expense;
    });
  },
};
