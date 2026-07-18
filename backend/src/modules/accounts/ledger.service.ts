import { PoolClient } from 'pg';
import { BadRequest } from '../../shared/errors';
import { accountsRepository } from './accounts.repository';

export type LedgerSource =
  | 'capital'
  | 'collection'
  | 'agent_submission'
  | 'loan_disbursement'
  | 'expense'
  | 'salary'
  | 'adjustment';

interface PostEntryInput {
  accountId: string;
  direction: 'credit' | 'debit';
  amount: number;
  source: LedgerSource;
  referenceId?: string | null;
  description?: string | null;
  createdBy?: string | null;
}

/**
 * The single writer for every cash movement in the system. Every module that
 * moves money (capital, collections, disbursement, expenses, salary) posts
 * through this instead of INSERTing account_transactions directly.
 *
 * MUST be called with the PoolClient of an already-open transaction (the
 * caller owns BEGIN/COMMIT via withTransaction). The FOR UPDATE lock on the
 * account row is what makes the balance check safe under concurrency — two
 * simultaneous disbursements against the same account serialize here instead
 * of both reading a passing balance before either commits.
 */
export const ledgerService = {
  async post(client: PoolClient, input: PostEntryInput): Promise<{ balanceAfter: number }> {
    await accountsRepository.lockForUpdate(input.accountId, client);

    if (input.direction === 'debit') {
      const balance = await accountsRepository.getBalance(input.accountId, client);
      if (balance < input.amount) {
        throw BadRequest(
          `Insufficient balance. Available: ₹${balance.toFixed(2)}, required: ₹${input.amount.toFixed(2)}. ` +
            `Introduce capital or collect more before proceeding.`,
        );
      }
    }

    await client.query(
      `INSERT INTO account_transactions(account_id, direction, amount, source, reference_id, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.accountId,
        input.direction,
        input.amount,
        input.source,
        input.referenceId ?? null,
        input.description ?? null,
        input.createdBy ?? null,
      ],
    );

    const balanceAfter = await accountsRepository.getBalance(input.accountId, client);
    return { balanceAfter };
  },
};
