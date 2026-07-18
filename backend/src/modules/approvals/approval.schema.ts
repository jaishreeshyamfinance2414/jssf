import { z } from 'zod';

export const reviewSchema = z.object({
  note: z.string().optional().nullable(),
});

export const rejectSchema = z.object({
  reason: z.string().min(1, 'Reason is required'),
});

export type ReviewBody = z.infer<typeof reviewSchema>;
export type RejectBody = z.infer<typeof rejectSchema>;
