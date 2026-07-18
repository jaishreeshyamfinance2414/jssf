import { z } from 'zod';

export const createCapitalEntrySchema = z.object({
  accountId: z.string().uuid(),
  sourceType: z.enum(['owner_capital', 'external_loan', 'other']).default('owner_capital'),
  contributorName: z.string().min(2, 'Contributor name is required'),
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  entryDate: z.string().min(1).default(() => new Date().toISOString().slice(0, 10)),
  note: z.string().optional().nullable(),
});
export type CreateCapitalEntryBody = z.infer<typeof createCapitalEntrySchema>;
