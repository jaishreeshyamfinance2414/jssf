import { z } from 'zod';

export const updatePenaltySchema = z.object({
  per_day_pct: z.number().min(0.01, 'Minimum 0.01%').max(5, 'Maximum 5%'),
});

export type UpdatePenaltyBody = z.infer<typeof updatePenaltySchema>;

export const updateLoanNumberSchema = z.object({
  prefix: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/, 'Use letters, numbers, and single hyphens'),
});
export type UpdateLoanNumberBody = z.infer<typeof updateLoanNumberSchema>;

export const updateBrandingSchema = z.object({
  businessName: z.string().trim().min(2).max(100),
});
export type UpdateBrandingBody = z.infer<typeof updateBrandingSchema>;

export const updateBackupCronSchema = z.object({
  enabled: z.boolean(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time such as 02:17'),
});
export type UpdateBackupCronBody = z.infer<typeof updateBackupCronSchema>;
