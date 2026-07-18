import { z } from 'zod';

export const createLoanSchema = z.object({
  customerId: z.string().uuid(),
  principal: z.coerce.number().positive(),
  emiFrequency: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
  tenureCount: z.coerce.number().int().positive().default(100),
  emiAmount: z.coerce.number().positive(),
});

export const updateLoanSchema = z.object({
  principal: z.coerce.number().positive().optional(),
  emiFrequency: z.enum(['daily', 'weekly', 'monthly']).optional(),
  tenureCount: z.coerce.number().int().positive().optional(),
  emiAmount: z.coerce.number().positive().optional(),
});

export const rejectLoanSchema = z.object({
  reason: z.string().min(3),
});

export const disburseLoanSchema = z.object({
  mode: z.enum(['cash', 'upi', 'bank_transfer']).default('cash'),
  loanDate: z.string().optional(),
});

export const closeLoanSchema = z.object({
  waiver: z.boolean().default(false),
  reason: z.string().optional().nullable(),
});

export type CreateLoanBody = z.infer<typeof createLoanSchema>;
export type UpdateLoanBody = z.infer<typeof updateLoanSchema>;
export type CloseLoanBody = z.infer<typeof closeLoanSchema>;
