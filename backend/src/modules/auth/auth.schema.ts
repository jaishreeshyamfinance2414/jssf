import { z } from 'zod';

export const loginSchema = z.object({
  identifier: z.string().min(3, 'Enter email or mobile'),
  password: z.string().min(1, 'Password required'),
  rememberMe: z.boolean().optional().default(false),
});

export type LoginBody = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password required'),
  newPassword: z
    .string()
    .min(8, 'At least 8 characters')
    .regex(/[a-zA-Z]/, 'Must contain a letter')
    .regex(/[0-9]/, 'Must contain a number'),
});

export type ChangePasswordBody = z.infer<typeof changePasswordSchema>;
