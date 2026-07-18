import { z } from 'zod';

export const createExpenseSchema = z.object({
  categoryId: z.string().uuid().optional().nullable(),
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  mode: z.enum(['cash', 'bank_transfer']).default('cash'),
  expenseDate: z.string().min(1).default(() => new Date().toISOString().slice(0, 10)),
  description: z.string().min(2, 'Description is required'),
});

export type CreateExpenseBody = z.infer<typeof createExpenseSchema>;
