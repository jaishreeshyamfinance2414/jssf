import { withTransaction } from '../../db/pool';
import { BadRequest, NotFound } from '../../shared/errors';
import { accountsRepository } from '../accounts/accounts.repository';
import { ledgerService } from '../accounts/ledger.service';
import { audit } from '../audit/audit.service';
import { customerRepository } from '../customers/customer.repository';
import { collectionRepository } from '../collections/collection.repository';
import { reconcileHistoricalPenalties } from '../collections/statement-history';
import { LoanNumberSetting, settingsRepository } from '../settings/settings.repository';
import { CreateLoanBody } from './loan.schema';
import { UpdateLoanBody, CloseLoanBody } from './loan.schema';
import { loanRepository } from './loan.repository';

const durationFor = (frequency: CreateLoanBody['emiFrequency'], tenure: number) => {
  if (frequency === 'daily') return tenure;
  if (frequency === 'weekly') return tenure * 7;
  return tenure * 30;
};

export const loanService = {
  async create(input: CreateLoanBody, actorId: string, actorRole: string, ip?: string | null) {
    const customer = await customerRepository.findById(input.customerId);
    if (!customer) throw NotFound('Customer not found');

    // Back-dated loan: only admins may set a past date.
    const today = new Date().toISOString().slice(0, 10);
    const loanDate = input.loanDate ?? today;
    if (loanDate < today && actorRole !== 'admin') {
      throw BadRequest('Only admins can create loans with a past date.');
    }
    if (loanDate > today) {
      throw BadRequest('Loan date cannot be in the future.');
    }

    const isBackDated = loanDate < today;

    // Back-dated loans require a disbursement mode since they auto-activate.
    if (isBackDated && !input.disbursedMode) {
      throw BadRequest('Disbursement mode is required for back-dated loans.');
    }

    const numberSetting = await settingsRepository.get<LoanNumberSetting>('loan_number');

    const sequenceNo = (await customerRepository.countLoansFor(input.customerId)) + 1;
    const totalPayable = Number((input.emiAmount * input.tenureCount).toFixed(2));
    if (totalPayable < input.principal) {
      throw BadRequest('Total EMI return cannot be less than loan amount');
    }
    const interestAmount = Number((totalPayable - input.principal).toFixed(2));
    const interestRate = input.principal > 0 ? Number(((interestAmount / input.principal) * 100).toFixed(3)) : 0;
    const year = new Date().getFullYear();
    const next = await loanRepository.nextSequenceNo(year);
    const loanNumber = `${numberSetting.prefix}-${year}-${String(next).padStart(numberSetting.pad, '0')}`;
    const durationDays = durationFor(input.emiFrequency, input.tenureCount);

    if (isBackDated) {
      // Back-dated loan: create → approve → disburse in one atomic transaction
      // with all timestamps (created_at, approved_at, disbursed_at) set to the loan date.
      const backDateTs = `${loanDate}T12:00:00`;
      const mode = input.disbursedMode!;

      const loanId = await withTransaction(async (client) => {
        const loan = await loanRepository.create({
          customerId: input.customerId,
          principal: input.principal,
          interestRate,
          interestAmount,
          totalPayable,
          emiAmount: input.emiAmount,
          emiFrequency: input.emiFrequency,
          tenureCount: input.tenureCount,
          durationDays,
          sequenceNo,
          loanNumber,
          loanDate,
          createdBy: actorId,
          createdAt: backDateTs,
        }, client);

        // Auto-approve with back-dated timestamp
        const account = await accountsRepository.getByType(mode === 'cash' ? 'cash' : 'bank', client);
        const availableBalance = await accountsRepository.totalAvailableBalance(client);
        if (availableBalance < input.principal) {
          throw BadRequest(
            `Cannot auto-approve this loan. Available business funds are ₹${availableBalance.toFixed(2)}, ` +
              `but this loan needs ₹${input.principal.toFixed(2)}. ` +
              'Add more capital or wait for EMI collections.',
          );
        }
        await loanRepository.approve(loan.id, actorId, client, backDateTs);

        // Auto-disburse with back-dated timestamp
        await ledgerService.post(client, {
          accountId: account.id,
          direction: 'debit',
          amount: input.principal,
          source: 'loan_disbursement',
          referenceId: loan.id,
          description: `Loan disbursed ${loanNumber} (back-dated)`,
          createdBy: actorId,
          txnDate: loanDate,
        });
        await loanRepository.markDisbursed(loan.id, mode, actorId, loanDate, durationDays, client, backDateTs);
        await loanRepository.generateSchedule(
          loan.id,
          loanDate,
          input.emiFrequency,
          input.tenureCount,
          totalPayable,
          client,
        );

        await audit({
          actorId,
          action: 'CREATE',
          entity: 'loan',
          entityId: loan.id,
          meta: { loanNumber, principal: input.principal, emiAmount: input.emiAmount, tenureCount: input.tenureCount, totalPayable, frequency: input.emiFrequency, loanDate, backDated: true, disbursedMode: mode },
          ip,
        }, client);

        return loan.id;
      });

      return loanRepository.findById(loanId);
    }

    // Normal (today) flow — just create with pending status.
    const loan = await loanRepository.create({
      customerId: input.customerId,
      principal: input.principal,
      interestRate,
      interestAmount,
      totalPayable,
      emiAmount: input.emiAmount,
      emiFrequency: input.emiFrequency,
      tenureCount: input.tenureCount,
      durationDays,
      sequenceNo,
      loanNumber,
      loanDate,
      createdBy: actorId,
    });

    await audit({
      actorId,
      action: 'CREATE',
      entity: 'loan',
      entityId: loan.id,
      meta: { loanNumber, principal: input.principal, emiAmount: input.emiAmount, tenureCount: input.tenureCount, totalPayable, frequency: input.emiFrequency, loanDate },
      ip,
    });

    return loanRepository.findById(loan.id);
  },

  async approve(id: string, actorId: string, ip?: string | null) {
    return withTransaction(async (client) => {
      const loan = await loanRepository.lockForUpdate(id, client);
      if (!loan) throw NotFound('Loan not found');
      if (loan.status !== 'pending') throw BadRequest('Only pending loans can be approved');

      const principal = Number(loan.principal);
      const availableBalance = await accountsRepository.totalAvailableBalance(client);
      if (availableBalance < principal) {
        throw BadRequest(
          `Cannot approve this loan. Available business funds are ₹${availableBalance.toFixed(2)}, ` +
            `but this loan needs ₹${principal.toFixed(2)}. ` +
            'Add more capital or wait for EMI collections before approval.',
        );
      }

      await loanRepository.approve(id, actorId, client);
      await audit(
        { actorId, action: 'APPROVE', entity: 'loan', entityId: id, meta: { availableBalance, principal }, ip },
        client,
      );
      return { approved: true };
    });
  },

  /** Undo a mistaken approval: an approved-but-not-yet-disbursed loan returns to pending. */
  async unapprove(id: string, actorId: string, ip?: string | null) {
    return withTransaction(async (client) => {
      const loan = await loanRepository.lockForUpdate(id, client);
      if (!loan) throw NotFound('Loan not found');
      if (loan.status !== 'approved') throw BadRequest('Only approved loans can be reverted to pending');
      await loanRepository.unapprove(id, client);
      await audit({ actorId, action: 'UNAPPROVE', entity: 'loan', entityId: id, meta: {}, ip }, client);
      return { unapproved: true };
    });
  },

  async update(id: string, input: UpdateLoanBody, actorId: string, ip?: string | null, actorRole?: string) {
    return withTransaction(async (client) => {
      const loan = await loanRepository.lockForUpdate(id, client);
      if (!loan) throw NotFound('Loan not found');
      if (!['pending', 'approved', 'active'].includes(loan.status)) {
        throw BadRequest('Only pending, approved, or active loans can be edited.');
      }

      const principal = input.principal ?? Number(loan.principal);
      const loanDate = input.loanDate ?? String(loan.loan_date).slice(0, 10);
      const dateChanged = loanDate !== String(loan.loan_date).slice(0, 10);
      if (input.loanDate && (!Number.isFinite(Date.parse(loanDate)) || new Date(loanDate).toISOString().slice(0, 10) !== loanDate)) {
        throw BadRequest('Invalid loan date.');
      }
      if (loanDate > new Date().toISOString().slice(0, 10)) throw BadRequest('Loan date cannot be in the future.');
      if (dateChanged && actorRole !== 'admin') throw BadRequest('Only admins can change a loan date.');
      const emiFrequency = input.emiFrequency ?? loan.emi_frequency;
      const tenureCount = input.tenureCount ?? Number(loan.tenure_count);
      const emiAmount = input.emiAmount ?? Number(loan.emi_amount);
      const totalPayable = Number((emiAmount * tenureCount).toFixed(2));
      if (totalPayable < principal) {
        throw BadRequest('Total EMI return cannot be less than loan amount');
      }
      // An active loan may already have collections against it — shrinking the
      // total below what's collected would make the remaining balance negative.
      const collected = await collectionRepository.totalCollectedForLoan(id, client);
      const { rows: penaltyRows } = await client.query(`SELECT COALESCE(sum(amount),0) AS amount
        FROM loan_daily_penalties WHERE loan_id = $1`,[id]);
      const accruedPenalty = Number(penaltyRows[0].amount);
      if (totalPayable + accruedPenalty < collected) {
        throw BadRequest(
          `Total EMI return (${totalPayable}) cannot be less than the amount already collected (${collected})`,
        );
      }
      const interestAmount = Number((totalPayable - principal).toFixed(2));
      const interestRate = principal > 0 ? Number(((interestAmount / principal) * 100).toFixed(3)) : 0;

      if (loan.status === 'active') {
        const { rows: earlyCollections } = await client.query(
          `SELECT 1 FROM collections WHERE loan_id = $1 AND collected_at::date < $2::date
             AND (amount + penalty > 0 OR created_by IS NOT NULL) LIMIT 1`,
          [id, loanDate],
        );
        if (earlyCollections.length) throw BadRequest('Loan date cannot be after an existing collection date.');

        const { rows: disbursements } = await client.query<{ id: string; account_id: string }>(
          `SELECT id, account_id FROM account_transactions
            WHERE source = 'loan_disbursement' AND reference_id = $1 FOR UPDATE`,
          [id],
        );
        if (disbursements.length !== 1) throw BadRequest('Loan disbursement ledger entry is missing or duplicated.');
        const disbursement = disbursements[0];
        await accountsRepository.lockForUpdate(disbursement.account_id, client);
        await client.query(
          `UPDATE account_transactions SET amount = $2, txn_date = $3::date WHERE id = $1`,
          [disbursement.id, principal, loanDate],
        );
        const { rows: negativeBalances } = await client.query(
          `WITH daily AS (
             SELECT txn_date, sum(CASE WHEN direction = 'credit' THEN amount ELSE -amount END) AS movement
               FROM account_transactions WHERE account_id = $1 GROUP BY txn_date
           ), running AS (
             SELECT txn_date, sum(movement) OVER (ORDER BY txn_date) AS balance FROM daily
           ) SELECT 1 FROM running WHERE txn_date >= $2::date AND balance < 0 LIMIT 1`,
          [disbursement.account_id, loanDate],
        );
        if (negativeBalances.length) throw BadRequest('Corrected disbursement would make the account balance negative.');
      }

      await loanRepository.updateTerms(
        id,
        {
          principal,
          interestRate,
          interestAmount,
          totalPayable: totalPayable + accruedPenalty,
          emiAmount,
          emiFrequency,
          tenureCount,
          durationDays: durationFor(emiFrequency, tenureCount),
          loanDate,
        },
        client,
      );
      if (loan.status === 'active') {
        await loanRepository.rescheduleOpenEmis(
          id,
          loanDate,
          emiFrequency,
          tenureCount,
          emiAmount,
          totalPayable,
          client,
        );
        if (dateChanged) {
          await client.query(
            `DELETE FROM collections WHERE loan_id = $1 AND collected_at::date < $2::date
               AND amount = 0 AND penalty = 0 AND created_by IS NULL`,
            [id, loanDate],
          );
        }
        await collectionRepository.rebuildEmiState(id, client);
        await collectionRepository.reconcileStatementCoverage(id, client);
        const { rows: reconciled } = await client.query<{ total_payable: string }>(
          `SELECT total_payable::text FROM loans WHERE id = $1`, [id],
        );
        if (Number(reconciled[0].total_payable) + 0.01 < collected) {
          throw BadRequest('Corrected loan total cannot be less than collections already recorded.');
        }
      }
      await audit(
        {
          actorId,
          action: 'UPDATE',
          entity: 'loan',
          entityId: id,
          meta: { principal, emiAmount, tenureCount, totalPayable, interestAmount, interestRate, emiFrequency, loanDate },
          ip,
        },
        client,
      );
      return loanRepository.findById(id, client);
    });
  },

  async reject(id: string, reason: string, actorId: string, ip?: string | null) {
    return withTransaction(async (client) => {
      const loan = await loanRepository.lockForUpdate(id, client);
      if (!loan) throw NotFound('Loan not found');
      if (loan.status !== 'pending') throw BadRequest('Only pending loans can be rejected');
      await loanRepository.reject(id, reason, client);
      await audit({ actorId, action: 'REJECT', entity: 'loan', entityId: id, meta: { reason }, ip }, client);
      return { rejected: true };
    });
  },

  /**
   * Admin-only hard delete of a rejected loan application. Rejected loans were
   * never disbursed, so there is no EMI schedule, collection, or ledger row to
   * unwind — only leftover approval_requests (no FK) need cleaning up.
   */
  async remove(id: string, actorId: string, ip?: string | null) {
    return withTransaction(async (client) => {
      const loan = await loanRepository.lockForUpdate(id, client);
      if (!loan) throw NotFound('Loan not found');
      if (loan.status !== 'rejected') throw BadRequest('Only rejected loans can be deleted');

      await client.query(
        `DELETE FROM approval_requests WHERE entity_type = 'loan' AND entity_id = $1`,
        [id],
      );
      await loanRepository.deleteById(id, client);

      await audit(
        {
          actorId,
          action: 'DELETE',
          entity: 'loan',
          entityId: id,
          meta: { loanNumber: loan.loan_number, customerId: loan.customer_id, status: 'rejected' },
          ip,
        },
        client,
      );
      return { deleted: true };
    });
  },

  /**
   * Admin-only manual close. A loan can only be closed once it's fully paid —
   * unless the admin explicitly applies a waiver, which forgives exactly
   * whatever balance remains (no partial/overshoot waiver amounts to reason
   * about) and marks any still-open EMI rows 'paid' so schedules and
   * dashboards stay consistent with the loan no longer being active.
   */
  async close(id: string, input: CloseLoanBody, actorId: string, ip?: string | null) {
    return withTransaction(async (client) => {
      const loan = await loanRepository.lockForUpdate(id, client);
      if (!loan) throw NotFound('Loan not found');
      if (loan.status !== 'active') throw BadRequest('Only active loans can be closed');

      await reconcileHistoricalPenalties(id, client);
      const currentLoan = await loanRepository.lockForUpdate(id, client);
      const totalPayable = Number(currentLoan.total_payable);
      const collected = await collectionRepository.totalCollectedForLoan(id, client);
      const remaining = Number((totalPayable - collected).toFixed(2));

      if (remaining > 0.01 && !input.waiver) {
        throw BadRequest(
          `Loan is not fully paid. Remaining balance: ₹${remaining.toFixed(2)}. ` +
            'Collect the balance first, or close with a waiver to forgive it.',
        );
      }

      const waiverAmount = input.waiver ? Math.max(0, remaining) : 0;

      await loanRepository.close(
        id,
        { closedBy: actorId, waiverAmount, waiverReason: waiverAmount > 0 ? input.reason ?? null : null },
        client,
      );
      await loanRepository.closeRemainingEmis(id, client);

      await audit(
        {
          actorId,
          action: 'CLOSE',
          entity: 'loan',
          entityId: id,
          meta: { remaining, waiverAmount, reason: input.reason ?? null },
          ip,
        },
        client,
      );

      return loanRepository.findById(id);
    });
  },

  async disburse(
    id: string,
    mode: 'cash' | 'upi' | 'bank_transfer',
    loanDate: string | undefined,
    actorId: string,
    ip?: string | null,
  ) {
    return withTransaction(async (client) => {
      const loan = await loanRepository.lockForUpdate(id, client);
      if (!loan) throw NotFound('Loan not found');
      if (loan.status !== 'approved') throw BadRequest('Only approved loans can be disbursed');

      const account = await accountsRepository.getByType(mode === 'cash' ? 'cash' : 'bank', client);
      const principal = Number(loan.principal);
      const startDate = loanDate ?? new Date().toISOString().slice(0, 10);
      if (!Number.isFinite(Date.parse(startDate)) || new Date(startDate).toISOString().slice(0, 10) !== startDate
          || startDate > new Date().toISOString().slice(0, 10)) {
        throw BadRequest('Loan date must be a valid date no later than today.');
      }

      // Debit the full principal from the account — the customer receives the
      // entire loan amount, no fee deducted.
      await ledgerService.post(client, {
        accountId: account.id,
        direction: 'debit',
        amount: principal,
        source: 'loan_disbursement',
        referenceId: id,
        description: `Loan disbursed ${loan.loan_number}`,
        createdBy: actorId,
        txnDate: startDate,
      });

      await loanRepository.markDisbursed(id, mode, actorId, startDate, Number(loan.duration_days), client,
        loanDate ? `${startDate}T12:00:00` : undefined);
      await loanRepository.generateSchedule(
        id,
        startDate,
        loan.emi_frequency,
        Number(loan.tenure_count),
        Number(loan.total_payable),
        client,
      );
      await audit(
        { actorId, action: 'DISBURSE', entity: 'loan', entityId: id, meta: { mode, principal }, ip },
        client,
      );
      return { disbursed: true };
    });
  },
};
