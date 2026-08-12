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

/** Admin correction of an existing entry — any subset of amount/penalty/type/date. */
export const updateCollectionSchema = z
  .object({
    amount: z.coerce.number().min(0).optional(),
    penalty: z.coerce.number().min(0).optional(),
    type: z.enum(['full', 'partial', 'advance', 'missed']).optional(),
    collectedDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
      .optional(),
  })
  .refine(
    (v) => {
      const hasFields =
        v.amount !== undefined ||
        v.penalty !== undefined ||
        v.type !== undefined ||
        v.collectedDate !== undefined;
      if (!hasFields) return false;
      if (v.type === 'missed') return v.amount === undefined || v.amount === 0;
      if (v.type) return v.amount === undefined || v.amount > 0;
      return true;
    },
    { message: 'Must specify at least one valid field to update' },
  );

export type UpdateCollectionBody = z.infer<typeof updateCollectionSchema>;
