import { z } from 'zod';

export const updatePenaltySchema = z.object({
  per_day_pct: z.number().min(0.01, 'Minimum 0.01%').max(5, 'Maximum 5%'),
});

export type UpdatePenaltyBody = z.infer<typeof updatePenaltySchema>;
