import { z } from 'zod';

export const createCollectionSchema = z
  .object({
    loanId: z.string().uuid(),
    emiId: z.string().uuid().optional().nullable(),
    amount: z.coerce.number().min(0),
    penalty: z.coerce.number().min(0).default(0),
    type: z.enum(['full', 'partial', 'advance', 'missed']).default('full'),
    mode: z.enum(['cash', 'upi', 'bank_transfer']).default('cash'),
    note: z.string().optional().nullable(),
  })
  .refine((v) => (v.type === 'missed' ? v.amount === 0 && !!v.emiId : v.amount > 0), {
    message: 'Missed entries need an EMI and zero amount; money entries need a positive amount',
    path: ['amount'],
  });

export type CreateCollectionBody = z.infer<typeof createCollectionSchema>;

/** Admin correction of an existing entry — any subset of amount/penalty/date. */
export const updateCollectionSchema = z
  .object({
    amount: z.coerce.number().positive().optional(),
    penalty: z.coerce.number().min(0).optional(),
    collectedDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
      .optional(),
  })
  .refine((v) => v.amount !== undefined || v.penalty !== undefined || v.collectedDate !== undefined, {
    message: 'Nothing to update',
  });

export type UpdateCollectionBody = z.infer<typeof updateCollectionSchema>;
