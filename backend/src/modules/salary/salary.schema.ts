import { z } from 'zod';

export const createSalarySchema = z.object({
  userId: z.string().uuid('Select a staff member'),
  periodYear: z.coerce.number().int().min(2000).max(2100),
  periodMonth: z.coerce.number().int().min(1).max(12),
  baseSalary: z.coerce.number().positive('Base salary must be greater than zero'),
  cashShortDeduct: z.coerce.number().min(0).default(0),
  advanceDeduct: z.coerce.number().min(0).default(0),
  expenseDeduct: z.coerce.number().min(0).default(0),
  mode: z.enum(['cash', 'bank_transfer']).default('cash'),
  paidDate: z.string().min(1).default(() => new Date().toISOString().slice(0, 10)),
  note: z.string().optional().nullable(),
});

export type CreateSalaryBody = z.infer<typeof createSalarySchema>;
