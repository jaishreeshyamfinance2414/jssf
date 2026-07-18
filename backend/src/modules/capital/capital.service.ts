import { withTransaction } from '../../db/pool';
import { audit } from '../audit/audit.service';
import { ledgerService } from '../accounts/ledger.service';
import { capitalRepository, CapitalEntryInput } from './capital.repository';

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
};
