import { z } from 'zod';

export const loginSchema = z.object({
  identifier: z.string().min(3, 'Enter email or mobile'),
  password: z.string().min(1, 'Password required'),
  rememberMe: z.boolean().optional().default(false),
});

export type LoginBody = z.infer<typeof loginSchema>;
