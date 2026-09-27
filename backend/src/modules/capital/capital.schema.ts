import { z } from 'zod';

const todayInIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const transactionDate = z.string().date('A valid date is required').refine(
  (value) => value <= todayInIndia(),
  'Date cannot be in the future',
);

export const createCapitalEntrySchema = z.object({
  accountId: z.string().uuid(),
  sourceType: z.enum(['owner_capital', 'external_loan', 'other']).default('owner_capital'),
  contributorName: z.string().min(2, 'Contributor name is required'),
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  entryDate: transactionDate.default(todayInIndia),
  note: z.string().optional().nullable(),
});
export type CreateCapitalEntryBody = z.infer<typeof createCapitalEntrySchema>;

export const createCapitalWithdrawalSchema = z.object({
  accountId: z.string().uuid(),
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  withdrawalDate: transactionDate.default(todayInIndia),
  note: z.string().optional().nullable(),
});
export type CreateCapitalWithdrawalBody = z.infer<typeof createCapitalWithdrawalSchema>;
