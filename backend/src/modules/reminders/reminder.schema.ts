import { z } from 'zod';

const todayInIndia = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
}).format(new Date());

export const createReminderSchema = z.object({
  customerId: z.string().uuid('Select a valid customer'),
  reminderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid reminder date')
    .refine((value) => value >= todayInIndia(), 'Reminder date cannot be in the past'),
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  note: z.string().trim().min(1, 'Note is required').max(500, 'Note is too long'),
});

export type CreateReminderBody = z.infer<typeof createReminderSchema>;
