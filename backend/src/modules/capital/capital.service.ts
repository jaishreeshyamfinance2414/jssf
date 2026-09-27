import { withTransaction } from '../../db/pool';
import { BadRequest } from '../../shared/errors';
import { audit } from '../audit/audit.service';
import { ledgerService } from '../accounts/ledger.service';
import { capitalRepository, CapitalEntryInput, CapitalWithdrawalInput } from './capital.repository';

export const capitalService = {
  async recordEntry(input: CapitalEntryInput, ip?: string | null) {
    return withTransaction(async (client) => {
      const entry = await capitalRepository.create(input, client);
      await ledgerService.post(client, {
        accountId: input.accountId,
        direction: 'credit',
        amount: input.amount,
        source: 'capital',
        referenceId: entry.id,
        description: `Capital introduced by ${input.contributorName}`,
        createdBy: input.createdBy,
        txnDate: input.entryDate,
      });
      await audit(
        {
          actorId: input.createdBy,
          action: 'CREATE',
          entity: 'capital_entry',
          entityId: entry.id,
          meta: { amount: input.amount, sourceType: input.sourceType, contributorName: input.contributorName },
          ip,
        },
        client,
      );
      return entry;
    });
  },

  async withdraw(input: CapitalWithdrawalInput, ip?: string | null) {
    return withTransaction(async (client) => {
      // Serialize withdrawals across cash and bank accounts so two requests
      // cannot both withdraw the same remaining invested capital.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('capital_withdrawal'))`);
      const { rows } = await client.query<{ available: string }>(
        `SELECT (
           COALESCE((SELECT sum(amount) FROM capital_entries), 0) -
           COALESCE((SELECT sum(amount) FROM capital_withdrawals), 0)
         )::text AS available`,
      );
      const availableCapital = Number(rows[0].available);
      if (availableCapital < input.amount) {
        throw BadRequest(
          `Withdrawal exceeds invested capital. Available capital: ₹${availableCapital.toFixed(2)}, ` +
            `requested: ₹${input.amount.toFixed(2)}.`,
        );
      }

      const withdrawal = await capitalRepository.createWithdrawal(input, client);
      await ledgerService.post(client, {
        accountId: input.accountId,
        direction: 'debit',
        amount: input.amount,
        source: 'capital_withdrawal',
        referenceId: withdrawal.id,
        description: 'Capital withdrawn',
        createdBy: input.createdBy,
        txnDate: input.withdrawalDate,
      });
      await audit(
        {
          actorId: input.createdBy,
          action: 'CREATE',
          entity: 'capital_withdrawal',
          entityId: withdrawal.id,
          meta: { amount: input.amount, accountId: input.accountId, withdrawalDate: input.withdrawalDate },
          ip,
        },
        client,
      );
      return withdrawal;
    });
  },
};
