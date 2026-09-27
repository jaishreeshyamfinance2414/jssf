import { withTransaction } from '../../db/pool';
import { BadRequest, NotFound } from '../../shared/errors';
import { ledgerService } from '../accounts/ledger.service';
import { audit } from '../audit/audit.service';
import { CreateBorrowedLoanBody, CreateBorrowedLoanPaymentBody } from './borrowed-loan.schema';
import { borrowedLoanRepository } from './borrowed-loan.repository';

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export const borrowedLoanService = {
  async create(input: CreateBorrowedLoanBody, actorId: string, ip?: string | null) {
    const isFixedRepayment = input.loanType === 'credit_card' || input.loanType === 'personal_borrowed';
    const totalInterest = isFixedRepayment
      ? round2(input.interestAmount!)
      : input.loanType === 'reducing_balance'
        ? round2(input.installmentCount! * input.installmentAmount! - input.loanAmount)
        : 0;
    const totalPayable = input.loanType === 'reducing_balance'
      ? round2(input.installmentCount! * input.installmentAmount!)
      : isFixedRepayment
        ? round2(input.loanAmount + totalInterest)
        : undefined;

    return withTransaction(async (client) => {
      const loan = await borrowedLoanRepository.create({
        lenderName: input.lenderName,
        loanType: input.loanType,
        receivingAccountId: input.receivingAccountId,
        loanAmount: input.loanAmount,
        installmentCount: input.installmentCount,
        installmentAmount: input.installmentAmount,
        totalPayable,
        totalInterest,
        periodicInterest: input.interestPaymentAmount,
        receivedDate: input.receivedDate,
        firstPaymentDate: input.firstPaymentDate,
        note: input.note,
        createdBy: actorId,
      }, client);

      if (input.loanType === 'reducing_balance') {
        let principalAllocated = 0;
        const schedule = Array.from({ length: input.installmentCount! }, (_, index) => {
          const isLast = index === input.installmentCount! - 1;
          const principal = isLast
            ? round2(input.loanAmount - principalAllocated)
            : round2(input.loanAmount / input.installmentCount!);
          principalAllocated = round2(principalAllocated + principal);
          const interest = round2(input.installmentAmount! - principal);
          return {
            installmentNo: index + 1,
            dueDate: addMonths(input.firstPaymentDate, index),
            principal,
            interest,
            total: input.installmentAmount!,
          };
        });
        await borrowedLoanRepository.createSchedule(loan.id, schedule, client);
      } else if (isFixedRepayment) {
        await borrowedLoanRepository.createSchedule(loan.id, [{
          installmentNo: 1,
          dueDate: input.firstPaymentDate,
          principal: input.loanAmount,
          interest: totalInterest,
          total: totalPayable!,
        }], client);
      }

      await ledgerService.post(client, {
        accountId: input.receivingAccountId,
        direction: 'credit',
        amount: input.loanAmount,
        source: 'borrowed_loan',
        referenceId: loan.id,
        description: `Borrowed from ${input.lenderName}`,
        createdBy: actorId,
        txnDate: input.receivedDate,
      });
      await audit({
        actorId, action: 'CREATE', entity: 'borrowed_loan', entityId: loan.id,
        meta: { lenderName: input.lenderName, loanType: input.loanType, amount: input.loanAmount }, ip,
      }, client);
      return loan;
    });
  },

  async recordPayment(loanId: string, input: CreateBorrowedLoanPaymentBody, actorId: string, ip?: string | null) {
    return withTransaction(async (client) => {
      const loan = await borrowedLoanRepository.lockById(loanId, client);
      if (!loan) throw NotFound('Borrowed loan not found');
      if (loan.status === 'closed') throw BadRequest('This borrowed loan is already closed');
      if (input.paymentDate < loan.received_date) {
        throw BadRequest('Payment date cannot be before the loan received date');
      }

      const paid = await borrowedLoanRepository.totalsPaid(loanId, client);
      const outstanding = round2(Number(loan.original_principal) - paid.principal);
      let principal = 0;
      let interest = 0;
      let scheduleId: string | undefined;

      if (loan.loan_type !== 'interest_only') {
        const schedule = await borrowedLoanRepository.nextSchedule(loanId, client);
        if (!schedule) throw BadRequest('All EMIs for this loan are already paid');
        principal = Number(schedule.principal_due);
        interest = Number(schedule.interest_due);
        scheduleId = schedule.id;
      } else {
        principal = round2(input.principalAmount);
        interest = Number(loan.periodic_interest);
        if (principal > outstanding) {
          throw BadRequest(`Principal payment exceeds outstanding principal of ₹${outstanding.toFixed(2)}`);
        }
      }

      const total = round2(principal + interest);
      const payment = await borrowedLoanRepository.createPayment({
        loanId, accountId: input.accountId, scheduleId, paymentDate: input.paymentDate,
        principal, interest, total, createdBy: actorId,
      }, client);
      await ledgerService.post(client, {
        accountId: input.accountId,
        direction: 'debit',
        amount: total,
        source: 'borrowed_loan_payment',
        referenceId: payment.id,
        description: `${loan.lender_name} loan payment (principal ₹${principal.toFixed(2)}, interest ₹${interest.toFixed(2)})`,
        createdBy: actorId,
        txnDate: input.paymentDate,
      });

      if (round2(outstanding - principal) <= 0) await borrowedLoanRepository.close(loanId, client);
      await audit({
        actorId, action: 'CREATE', entity: 'borrowed_loan_payment', entityId: payment.id,
        meta: { loanId, principal, interest, total, paymentDate: input.paymentDate }, ip,
      }, client);
      return { ...payment, principal, interest, total };
    });
  },
};
