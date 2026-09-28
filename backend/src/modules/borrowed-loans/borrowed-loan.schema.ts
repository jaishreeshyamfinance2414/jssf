import { z } from 'zod';

const isoDate = z.string().date('A valid date is required');
const todayInIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

const commonCreateFields = {
  lenderName: z.string().trim().min(2, 'Lender name is required'),
  receivingAccountId: z.string().uuid('A valid receiving account is required'),
  loanAmount: z.coerce.number().positive('Loan amount must be greater than zero'),
  receivedDate: isoDate,
  firstPaymentDate: isoDate,
  note: z.string().trim().optional().nullable(),
};

const reducingBalanceLoanSchema = z.object({
  ...commonCreateFields,
  loanType: z.literal('reducing_balance'),
  installmentCount: z.coerce.number().int().positive('Number of EMIs must be greater than zero'),
  installmentAmount: z.coerce.number().positive('EMI amount must be greater than zero'),
}).strict();

const interestOnlyLoanSchema = z.object({
  ...commonCreateFields,
  loanType: z.literal('interest_only'),
  interestPaymentAmount: z.coerce.number().positive('Monthly interest amount must be greater than zero'),
}).strict();

const creditCardLoanSchema = z.object({
  ...commonCreateFields,
  loanType: z.literal('credit_card'),
  financeChargeAmount: z.coerce.number().min(0, 'Credit-card interest and charges cannot be negative'),
}).strict();

const personalBorrowedLoanSchema = z.object({
  ...commonCreateFields,
  loanType: z.literal('personal_borrowed'),
  interestAmount: z.coerce.number().min(0, 'Interest cannot be negative'),
}).strict();

export const createBorrowedLoanSchema = z.discriminatedUnion('loanType', [
  reducingBalanceLoanSchema,
  interestOnlyLoanSchema,
  creditCardLoanSchema,
  personalBorrowedLoanSchema,
]).superRefine((value, ctx) => {
  if (value.receivedDate > todayInIndia()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['receivedDate'], message: 'Received date cannot be in the future' });
  }
  if (value.firstPaymentDate < value.receivedDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['firstPaymentDate'], message: 'Payment date cannot be before the received date' });
  }
  if (value.loanType === 'reducing_balance'
      && value.installmentCount * value.installmentAmount < value.loanAmount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['installmentAmount'],
      message: 'Total payable cannot be less than the borrowed amount',
    });
  }
});

export const createBorrowedLoanPaymentSchema = z.object({
  accountId: z.string().uuid(),
  paymentDate: isoDate.refine((value) => value <= todayInIndia(), 'Payment date cannot be in the future'),
  principalAmount: z.coerce.number().min(0).optional().default(0),
});

export type CreateBorrowedLoanBody = z.infer<typeof createBorrowedLoanSchema>;
export type CreateBorrowedLoanPaymentBody = z.infer<typeof createBorrowedLoanPaymentSchema>;
