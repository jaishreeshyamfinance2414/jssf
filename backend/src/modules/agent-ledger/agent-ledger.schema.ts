import { z } from 'zod';

export const recordHandoverSchema = z.object({
  agentId: z.string().uuid(),
  submittedAmount: z.coerce.number().min(0),
  note: z.string().optional().nullable(),
});
export type RecordHandoverBody = z.infer<typeof recordHandoverSchema>;

export const agentIdQuerySchema = z.object({
  agentId: z.string().uuid().optional(),
});
