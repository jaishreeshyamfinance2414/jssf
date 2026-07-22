import { withTransaction } from '../../db/pool';
import { BadRequest, NotFound } from '../../shared/errors';
import { accountsRepository } from '../accounts/accounts.repository';
import { ledgerService } from '../accounts/ledger.service';
import { audit } from '../audit/audit.service';
import { customerRepository } from '../customers/customer.repository';
import { collectionRepository } from '../collections/collection.repository';
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
  async create(input: CreateLoanBody, actorId: string, ip?: string | null) {
    const customer = await customerRepository.findById(input.customerId);
    if (!customer) throw NotFound('Customer not found');

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

    const loan = await loanRepository.create({
      customerId: input.customerId,
      principal: input.principal,
      interestRate,
      interestAmount,
      totalPayable,
      emiAmount: input.emiAmount,
      emiFrequency: input.emiFrequency,
      tenureCount: input.tenureCount,
      durationDays: durationFor(input.emiFrequency, input.tenureCount),
      sequenceNo,
      loanNumber,
      createdBy: actorId,
    });

    await audit({
      actorId,
      action: 'CREATE',
      entity: 'loan',
      entityId: loan.id,
      meta: { loanNumber, principal: input.principal, emiAmount: input.emiAmount, tenureCount: input.tenureCount, totalPayable, frequency: input.emiFrequency },
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

  async update(id: string, input: UpdateLoanBody, actorId: string, ip?: string | null) {
    return withTransaction(async (client) => {
      const loan = await loanRepository.lockForUpdate(id, client);
      if (!loan) throw NotFound('Loan not found');
      if (!['pending', 'approved', 'active'].includes(loan.status)) {
        throw BadRequest('Only pending, approved, or active loans can be edited.');
      }

      const principal = input.principal ?? Number(loan.principal);
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
      if (totalPayable < collected) {
        throw BadRequest(
          `Total EMI return (${totalPayable}) cannot be less than the amount already collected (${collected})`,
        );
      }
      const interestAmount = Number((totalPayable - principal).toFixed(2));
      const interestRate = principal > 0 ? Number(((interestAmount / principal) * 100).toFixed(3)) : 0;

      await loanRepository.updateTerms(
        id,
        {
          principal,
          interestRate,
          interestAmount,
          totalPayable,
          emiAmount,
          emiFrequency,
          tenureCount,
          durationDays: durationFor(emiFrequency, tenureCount),
        },
        client,
      );
      if (loan.status === 'active') {
        await loanRepository.rescheduleOpenEmis(
          id,
          loan.loan_date,
          emiFrequency,
          emiAmount,
          totalPayable,
          client,
        );
      }
      await audit(
        {
          actorId,
          action: 'UPDATE',
          entity: 'loan',
          entityId: id,
          meta: { principal, emiAmount, tenureCount, totalPayable, interestAmount, interestRate, emiFrequency },
          ip,
        },
        client,
      );
      return loanRepository.findById(id);
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

      const totalPayable = Number(loan.total_payable);
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
      });

      const startDate = loanDate ?? new Date().toISOString().slice(0, 10);
      await loanRepository.markDisbursed(id, mode, actorId, startDate, Number(loan.duration_days), client);
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
