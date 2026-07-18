import { withTransaction } from '../../db/pool';
import { BadRequest } from '../../shared/errors';
import { accountsRepository } from '../accounts/accounts.repository';
import { ledgerService } from '../accounts/ledger.service';
import { audit } from '../audit/audit.service';
import { agentLedgerRepository } from './agent-ledger.repository';
import { RecordHandoverBody } from './agent-ledger.schema';

export const agentLedgerService = {
  async recordHandover(input: RecordHandoverBody, actorId: string, ip?: string | null) {
    return withTransaction(async (client) => {
      const { ids, expected } = await agentLedgerRepository.unreconciledCollectionIds(input.agentId, client);
      if (!ids.length) throw BadRequest('This agent has no pending cash to hand over');

      const submitted = input.submittedAmount;
      const short = Math.max(expected - submitted, 0);

      const entry = await agentLedgerRepository.insertLedgerEntry(
        { agentId: input.agentId, expected, submitted, short, note: input.note, createdBy: actorId },
        client,
      );

      await agentLedgerRepository.markReconciled(ids, entry.id, client);

      if (submitted > 0) {
        const cashAccount = await accountsRepository.getByType('cash', client);
        const agentName = await agentLedgerRepository.agentName(input.agentId, client);
        await ledgerService.post(client, {
          accountId: cashAccount.id,
          direction: 'credit',
          amount: submitted,
          source: 'agent_submission',
          referenceId: entry.id,
          description: `Cash handover from ${agentName ?? 'agent'} (expected ₹${expected.toFixed(2)}, received ₹${submitted.toFixed(2)})`,
          createdBy: actorId,
        });
      }

      await audit(
        {
          actorId,
          action: 'CREATE',
          entity: 'agent_ledger',
          entityId: entry.id,
          meta: { agentId: input.agentId, expected, submitted, short, collectionsCount: ids.length },
          ip,
        },
        client,
      );

      return { id: entry.id, expected, submitted, short };
    });
  },
};
