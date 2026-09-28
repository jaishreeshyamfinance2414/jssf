import { z } from 'zod';

const ROLE_NAMES = ['admin', 'manager', 'collection_agent', 'accounts_dept'] as const;

export const createUserSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  mobile: z.string().min(10).max(15),
  password: z.string().min(8, 'Min 8 characters'),
  roleName: z.enum(ROLE_NAMES),
  areaId: z.string().uuid().optional().nullable(),
}).superRefine((data, ctx) => {
  if (data.roleName !== 'admin' && data.roleName !== 'manager' && !data.areaId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['areaId'],
      message: 'Area is mandatory for this role',
    });
  }
});

export const updateUserSchema = z.object({
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional().nullable(),
  mobile: z.string().min(10).max(15).optional(),
  roleName: z.enum(ROLE_NAMES).optional(),
  areaId: z.string().uuid().optional().nullable(),
});

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, 'Min 8 characters'),
});

export type CreateUserBody = z.infer<typeof createUserSchema>;
export type UpdateUserBody = z.infer<typeof updateUserSchema>;
export type ResetPasswordBody = z.infer<typeof resetPasswordSchema>;
