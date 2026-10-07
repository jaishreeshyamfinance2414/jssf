import { z } from 'zod';

export const createSalarySchema = z.object({
  userId: z.string().uuid('Select a staff member'),
  periodYear: z.coerce.number().int().min(2000).max(2100),
  periodMonth: z.coerce.number().int().min(1).max(12),
  cashShortDeduct: z.coerce.number().min(0).default(0),
  advanceDeduct: z.coerce.number().min(0).default(0),
  mode: z.enum(['cash', 'bank_transfer']).default('cash'),
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Select the salary payment date'),
  note: z.string().optional().nullable(),
});

export const userExpensesQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Select an expense month'),
});

export const memberSalarySchema = z.object({
  userId: z.string().uuid('Select a staff member'),
  monthlySalary: z.coerce.number().positive('Monthly salary must be greater than zero'),
  salaryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Select a salary giving date'),
});

export const payableQuerySchema = z.object({
  userId: z.string().uuid(),
  periodYear: z.coerce.number().int().min(2000).max(2100),
  periodMonth: z.coerce.number().int().min(1).max(12),
  cashShortDeduct: z.coerce.number().min(0).default(0),
  advanceDeduct: z.coerce.number().min(0).default(0),
});

export type CreateSalaryBody = z.infer<typeof createSalarySchema>;
export type MemberSalaryBody = z.infer<typeof memberSalarySchema>;
