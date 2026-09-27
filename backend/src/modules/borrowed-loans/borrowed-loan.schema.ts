import { z } from 'zod';

const isoDate = z.string().date('A valid date is required');
const todayInIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export const createBorrowedLoanSchema = z.object({
  lenderName: z.string().trim().min(2, 'Lender name is required'),
  loanType: z.enum(['reducing_balance', 'interest_only', 'credit_card', 'personal_borrowed']),
  receivingAccountId: z.string().uuid(),
  loanAmount: z.coerce.number().positive('Loan amount must be greater than zero'),
  receivedDate: isoDate,
  firstPaymentDate: isoDate,
  installmentCount: z.coerce.number().int().positive().optional(),
  installmentAmount: z.coerce.number().positive().optional(),
  interestPaymentAmount: z.coerce.number().positive().optional(),
  interestAmount: z.coerce.number().min(0, 'Interest cannot be negative').optional(),
  note: z.string().trim().optional().nullable(),
}).superRefine((value, ctx) => {
  if (value.receivedDate > todayInIndia()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['receivedDate'], message: 'Received date cannot be in the future' });
  }
  if (value.firstPaymentDate < value.receivedDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['firstPaymentDate'], message: 'First payment date cannot be before the received date' });
  }
  if (value.loanType === 'reducing_balance') {
    if (!value.installmentCount) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['installmentCount'], message: 'Number of EMIs is required' });
    if (!value.installmentAmount) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['installmentAmount'], message: 'EMI amount is required' });
    if (value.installmentCount && value.installmentAmount && value.installmentCount * value.installmentAmount < value.loanAmount) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['installmentAmount'], message: 'Total payable cannot be less than the borrowed amount' });
    }
  } else if (value.loanType === 'interest_only' && !value.interestPaymentAmount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['interestPaymentAmount'], message: 'Monthly interest amount is required' });
  } else if ((value.loanType === 'credit_card' || value.loanType === 'personal_borrowed') && value.interestAmount == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['interestAmount'], message: 'Interest amount is required (enter zero when there is no interest)' });
  }
});

export const createBorrowedLoanPaymentSchema = z.object({
  accountId: z.string().uuid(),
  paymentDate: isoDate.refine((value) => value <= todayInIndia(), 'Payment date cannot be in the future'),
  principalAmount: z.coerce.number().min(0).optional().default(0),
});

export type CreateBorrowedLoanBody = z.infer<typeof createBorrowedLoanSchema>;
export type CreateBorrowedLoanPaymentBody = z.infer<typeof createBorrowedLoanPaymentSchema>;
