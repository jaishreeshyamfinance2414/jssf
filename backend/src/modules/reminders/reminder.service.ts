import { withTransaction } from '../../db/pool';
import { audit } from '../audit/audit.service';
import { NotFound } from '../../shared/errors';
import { CreateReminderBody } from './reminder.schema';
import { reminderRepository } from './reminder.repository';

export const reminderService = {
  async create(body: CreateReminderBody, actorId: string, ip?: string) {
    return withTransaction(async (client) => {
      const reminder = await reminderRepository.create({ ...body, createdBy: actorId }, client);
      await audit({ actorId, action: 'CREATE', entity: 'reminder', entityId: reminder.id,
        meta: { customerId: body.customerId, reminderDate: body.reminderDate, amount: body.amount }, ip }, client);
      return reminder;
    });
  },

  async complete(id: string, actorId: string, ip?: string) {
    return withTransaction(async (client) => {
      const reminder = await reminderRepository.complete(id, actorId, client);
      if (!reminder) throw NotFound('Pending reminder not found');
      await audit({ actorId, action: 'COMPLETE', entity: 'reminder', entityId: id, ip }, client);
      return reminder;
    });
  },
};
