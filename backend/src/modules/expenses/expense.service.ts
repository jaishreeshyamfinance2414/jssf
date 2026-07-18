import { withTransaction } from '../../db/pool';
import { accountsRepository } from '../accounts/accounts.repository';
import { ledgerService } from '../accounts/ledger.service';
import { audit } from '../audit/audit.service';
import { CreateExpenseBody } from './expense.schema';
import { expenseRepository } from './expense.repository';

export const expenseService = {
  async create(input: CreateExpenseBody, actorId: string, ip?: string | null) {
    return withTransaction(async (client) => {
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
          meta: { amount: input.amount, mode: input.mode, description: input.description },
          ip,
        },
        client,
      );
      return expense;
    });
  },
};
