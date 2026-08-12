import { withTransaction } from '../../db/pool';
import { BadRequest } from '../../shared/errors';
import { accountsRepository } from '../accounts/accounts.repository';
import { ledgerService } from '../accounts/ledger.service';
import { agentLedgerRepository } from '../agent-ledger/agent-ledger.repository';
import { areaRepository } from '../areas/area.repository';
import { audit } from '../audit/audit.service';
import { loanRepository } from '../loans/loan.repository';
import { CreateCollectionBody, UpdateCollectionBody } from './collection.schema';
import { collectionRepository } from './collection.repository';

export const collectionService = {
  async record(input: CreateCollectionBody, actorId: string, actorRole: string, ip?: string | null) {
    return withTransaction(async (client) => {
      const loan = await loanRepository.lockForUpdate(input.loanId, client);
      if (!loan) throw BadRequest('Loan not found');
      if (loan.status !== 'active') throw BadRequest('Collections can be recorded only for active loans');

      // Area routing: a collection agent may only record entries for loans of
      // customers inside their assigned area(s). Admin/manager are exempt.
      if (actorRole === 'collection_agent') {
        const myAreas = await areaRepository.areaIdsForAgent(actorId);
        if (myAreas.length) {
          const { rows: cust } = await client.query<{ area_id: string | null; area_name: string | null; my_areas: string | null }>(
            `SELECT c.area_id, a.name AS area_name,
                    (SELECT string_agg(ar.name, ', ' ORDER BY ar.name)
                       FROM area_agents aa JOIN areas ar ON ar.id = aa.area_id
                      WHERE aa.agent_id = $2) AS my_areas
               FROM customers c
               LEFT JOIN areas a ON a.id = c.area_id
              WHERE c.id = $1`,
            [loan.customer_id, actorId],
          );
          const customerArea = cust[0];
          if (!customerArea?.area_id || !myAreas.includes(customerArea.area_id)) {
            throw BadRequest(
              `You cannot make an entry for this loan — it belongs to ${
                customerArea?.area_name ? `area "${customerArea.area_name}"` : 'a customer with no area'
              }. You can only make entries in your assigned area${myAreas.length > 1 ? 's' : ''}: ${customerArea?.my_areas ?? '-'}.`,
            );
          }
        }
      }

      // The anchor EMI must belong to this loan — otherwise a crafted emiId
      // could flip/penalize another loan's EMI.
      if (input.emiId) {
        const { rows: emi } = await client.query(
          `SELECT 1 FROM emi_schedule WHERE id = $1 AND loan_id = $2`,
          [input.emiId, input.loanId],
        );
        if (!emi[0]) throw BadRequest('EMI does not belong to this loan');
      }

      // Strict one-entry-per-day rule: any entry (payment or missed marker)
      // already recorded today blocks a second one — the next entry can only
      // be made tomorrow. Also the backstop against accidental double-taps.
      // The loan row lock above serializes concurrent attempts, so two
      // simultaneous requests can't both pass this check.
      const { rows: todays } = await client.query<{ type: string }>(
        `SELECT type FROM collections WHERE loan_id = $1 AND collected_at::date = CURRENT_DATE LIMIT 1`,
        [input.loanId],
      );
      if (todays[0]) {
        throw BadRequest(
          todays[0].type === 'missed'
            ? "This loan is already marked missed for today. Only one entry per day is allowed — record the next entry tomorrow."
            : "Today's collection for this loan is already recorded. Only one entry per day is allowed — record the next entry tomorrow.",
        );
      }

      // Zero-amount "missed" day entry: the agent visited but collected
      // nothing. No money moves — just the entry row + the EMI flip, so the
      // daily ledger shows an entry for every loan every day.
      if (input.type === 'missed') {
        const collection = await collectionRepository.create(
          { ...input, agentId: actorId, createdBy: actorId, reconciledImmediately: true },
          client,
        );
        await collectionRepository.markEmiMissed(input.emiId!, client);
        await audit(
          {
            actorId,
            action: 'CREATE',
            entity: 'collection',
            entityId: collection.id,
            meta: { loanId: input.loanId, type: 'missed', emiId: input.emiId },
            ip,
          },
          client,
        );
        return collection;
      }

      // Strictly cap collection at the loan's remaining balance (total_payable
      // = principal + interest, e.g. ₹10,000 over 120 days @ ₹100/day = ₹12,000
      // payable). Locking the loan row above serializes concurrent collection
      // attempts for the same loan, so this check can't be raced.
      const totalPayable = Number(loan.total_payable);
      const alreadyCollected = await collectionRepository.totalCollectedForLoan(input.loanId, client);
      const remaining = Number((totalPayable - alreadyCollected).toFixed(2));
      if (input.amount > remaining + 0.01) {
        throw BadRequest(
          remaining <= 0
            ? 'This loan is already fully paid. No further collection can be recorded.'
            : `Amount exceeds the remaining loan balance. Remaining: ₹${remaining.toFixed(2)}.`,
        );
      }

      // Classify the entry from what's actually due today: paying more than
      // the anchor EMI's remaining due is an advance (the surplus fills the
      // following EMIs), exactly the due is full, less is partial.
      const type = await classifyPayment(input, client);

      // Admin collects directly (e.g. at the office/counter) — that cash is
      // already in hand, so it needs no agent handover/confirmation step.
      // Only collection_agent/manager cash collections stay pending until
      // physically handed over — see the agent-ledger module.
      const isDirectAdminCash = input.mode === 'cash' && actorRole === 'admin';

      const collection = await collectionRepository.create(
        { ...input, type, agentId: actorId, createdBy: actorId, reconciledImmediately: isDirectAdminCash },
        client,
      );

      // Redistribute the loan's collected total across the schedule — an
      // overpayment marks today paid and upcoming EMIs 'advance'.
      await collectionRepository.rebuildEmiState(input.loanId, client);
      await loanRepository.markClosedIfFullyPaid(input.loanId, client);

      if (input.mode !== 'cash' || isDirectAdminCash) {
        const account = await accountsRepository.getByType(input.mode === 'cash' ? 'cash' : 'bank', client);
        await ledgerService.post(client, {
          accountId: account.id,
          direction: 'credit',
          amount: input.amount + input.penalty,
          source: 'collection',
          referenceId: collection.id,
          description: `Collection for ${loan.loan_number}`,
          createdBy: actorId,
        });
      }

      await audit(
        {
          actorId,
          action: 'CREATE',
          entity: 'collection',
          entityId: collection.id,
          meta: { loanId: input.loanId, amount: input.amount, penalty: input.penalty, mode: input.mode, type },
          ip,
        },
        client,
      );
      return collection;
    });
  },

  /**
   * Admin correction: update an entry's amount, penalty, type and/or date, then
   * rebuild everything derived from it — EMI fill/status, the cash/bank
   * ledger row, agent handover expectations, and the loan's closed state.
   */
  async update(id: string, input: UpdateCollectionBody, actorId: string, ip?: string | null) {
    return withTransaction(async (client) => {
      const collection = await collectionRepository.findByIdForUpdate(id, client);
      if (!collection) throw BadRequest('Collection entry not found');

      const loan = await loanRepository.lockForUpdate(collection.loan_id, client);
      if (!loan) throw BadRequest('Loan not found');
      if (loan.closed_by || Number(loan.waiver_amount) > 0) {
        throw BadRequest('This loan was manually closed/settled. Its collection entries cannot be edited.');
      }

      const isConvertingToMissed = collection.type !== 'missed' && input.type === 'missed';
      const isConvertingToPaid = collection.type === 'missed' && input.type !== undefined && input.type !== 'missed';

      // Block amount changes on missed entries unless changing type away from missed
      if (collection.type === 'missed' && !isConvertingToPaid && input.amount !== undefined && input.amount > 0) {
        throw BadRequest('A missed entry cannot have an amount. Change the type to record a payment.');
      }

      const oldAmount = Number(collection.amount);
      const oldPenalty = Number(collection.penalty);

      let newAmount = input.amount ?? oldAmount;
      let newPenalty = input.penalty ?? oldPenalty;
      const newType = input.type ?? collection.type;

      if (isConvertingToMissed) {
        newAmount = 0;
        newPenalty = 0;
      } else if (isConvertingToPaid) {
        if (!input.amount || input.amount <= 0) {
          throw BadRequest('Amount must be greater than 0 when converting a missed entry to a payment.');
        }
        newAmount = input.amount;
        newPenalty = input.penalty ?? 0;
      }

      // The edited amount must still fit in the loan's total payable.
      const totalPayable = Number(loan.total_payable);
      const collected = await collectionRepository.totalCollectedForLoan(collection.loan_id, client);
      if (collected - oldAmount + newAmount > totalPayable + 0.01) {
        const room = Number((totalPayable - (collected - oldAmount)).toFixed(2));
        throw BadRequest(`Amount exceeds the loan's total payable. Maximum for this entry: ₹${room.toFixed(2)}.`);
      }

      // New date keeps the entry's original time-of-day so intra-day ordering
      // survives the move.
      let collectedAt: string | null = null;
      if (input.collectedDate) {
        const time = new Date(collection.collected_at).toISOString().slice(11);
        collectedAt = `${input.collectedDate}T${time}`;
      }

      await collectionRepository.updateEntry(
        id,
        { amount: newAmount, penalty: newPenalty, type: newType, collectedAt },
        client,
      );

      // Handle ledger adjustments for type conversions & amount edits:
      if (isConvertingToMissed) {
        // Paid → Missed: remove cash/bank ledger posting & reduce agent handover
        await accountsRepository.deleteBySourceRef('collection', id, client);
        if (collection.agent_ledger_id && oldAmount + oldPenalty > 0) {
          await agentLedgerRepository.reduceExpected(collection.agent_ledger_id, oldAmount + oldPenalty, client);
        }
      } else if (isConvertingToPaid) {
        // Missed → Paid: post new credit to cash/bank
        const account = await accountsRepository.getByType(collection.mode === 'cash' ? 'cash' : 'bank', client);
        await ledgerService.post(client, {
          accountId: account.id,
          direction: 'credit',
          amount: newAmount + newPenalty,
          source: 'collection',
          referenceId: id,
          description: `Collection (type correction) for ${loan.loan_number}`,
          createdBy: actorId,
        });
      } else if (collection.type !== 'missed') {
        // Regular amount/penalty/date edit on a payment entry
        await accountsRepository.updateBySourceRef(
          'collection',
          id,
          { amount: newAmount + newPenalty, txnDate: input.collectedDate ?? null },
          client,
        );
        const delta = oldAmount + oldPenalty - (newAmount + newPenalty);
        if (collection.agent_ledger_id && delta > 0) {
          await agentLedgerRepository.reduceExpected(collection.agent_ledger_id, delta, client);
        }
      }

      await collectionRepository.rebuildEmiState(collection.loan_id, client);

      // The edit may complete the loan — or reopen one that auto-closed.
      const closed = await loanRepository.markClosedIfFullyPaid(collection.loan_id, client);
      if (!closed && loan.status === 'closed' && !loan.closed_by) {
        await loanRepository.reopen(collection.loan_id, client);
      }

      await audit(
        {
          actorId,
          action: 'UPDATE',
          entity: 'collection',
          entityId: id,
          meta: {
            loanId: collection.loan_id,
            type: { from: collection.type, to: newType },
            amount: { from: oldAmount, to: newAmount },
            penalty: { from: oldPenalty, to: newPenalty },
            collectedDate: input.collectedDate ?? null,
          },
          ip,
        },
        client,
      );
      return { updated: true };
    });
  },

  /**
   * Admin correction: hard-delete a collection entry and reverse everything it
   * touched — EMI paid amounts/status, the cash/bank ledger row, and an
   * automatic full-payment loan closure. Loan "remaining" is computed from
   * SUM(collections.amount), so removing the row restores the balance itself.
   */
  async remove(id: string, actorId: string, ip?: string | null) {
    return withTransaction(async (client) => {
      const collection = await collectionRepository.findByIdForUpdate(id, client);
      if (!collection) throw BadRequest('Collection entry not found');

      // Serialize with concurrent collection recording on the same loan.
      const loan = await loanRepository.lockForUpdate(collection.loan_id, client);
      if (!loan) throw BadRequest('Loan not found');

      if (loan.closed_by || Number(loan.waiver_amount) > 0) {
        throw BadRequest(
          'This loan was manually closed/settled. Its collection entries cannot be deleted.',
        );
      }

      // Entry already reconciled in an agent cash handover: shrink that
      // handover's expected total so the agent's shortfall isn't overstated.
      // The submitted amount (physical cash received) and its cash-account
      // credit stay untouched — deleting a data-entry mistake doesn't change
      // how much cash was actually handed over.
      if (collection.agent_ledger_id) {
        await agentLedgerRepository.reduceExpected(
          collection.agent_ledger_id,
          Number(collection.amount) + Number(collection.penalty),
          client,
        );
      }

      // Non-cash and admin-direct-cash entries posted a credit to cash/bank —
      // remove it. Safe no-op for unreconciled agent cash (never hit the ledger).
      await accountsRepository.deleteBySourceRef('collection', id, client);

      await collectionRepository.deleteById(id, client);

      // Deleting a 'missed' day entry also takes back the penalty it accrued
      // onto the EMI due and the loan total (unless another missed entry for
      // the same EMI remains).
      if (collection.type === 'missed' && collection.emi_id) {
        await collectionRepository.reverseMissedPenalty(collection.emi_id, id, client);
      }

      await collectionRepository.rebuildEmiState(collection.loan_id, client);

      // If this collection had auto-closed the loan (closed_by stays NULL for
      // markClosedIfFullyPaid closures), reopen it.
      if (loan.status === 'closed' && !loan.closed_by) {
        await loanRepository.reopen(collection.loan_id, client);
      }

      await audit(
        {
          actorId,
          action: 'DELETE',
          entity: 'collection',
          entityId: id,
          meta: {
            loanId: collection.loan_id,
            amount: Number(collection.amount),
            penalty: Number(collection.penalty),
            mode: collection.mode,
            type: collection.type,
            agentId: collection.agent_id,
            agentLedgerId: collection.agent_ledger_id ?? null,
          },
          ip,
        },
        client,
      );
      return { deleted: true };
    });
  },
};

/** full = exactly the anchor EMI's remaining due, advance = more, partial = less. */
async function classifyPayment(
  input: CreateCollectionBody,
  client: import('pg').PoolClient,
): Promise<'full' | 'partial' | 'advance'> {
  if (!input.emiId) return 'advance';
  const { rows } = await client.query<{ due_amount: string; paid_amount: string }>(
    `SELECT due_amount::text, paid_amount::text FROM emi_schedule WHERE id = $1`,
    [input.emiId],
  );
  if (!rows[0]) return 'advance';
  const emiRemaining = Number(rows[0].due_amount) - Number(rows[0].paid_amount);
  if (input.amount > emiRemaining + 0.01) return 'advance';
  if (input.amount >= emiRemaining - 0.01) return 'full';
  return 'partial';
}
