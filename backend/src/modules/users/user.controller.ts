import argon2 from 'argon2';
import { Request, Response } from 'express';
import { created, ok } from '../../shared/http';
import { BadRequest } from '../../shared/errors';
import { audit } from '../audit/audit.service';
import { authRepository } from '../auth/auth.repository';
import { userRepository } from './user.repository';
import { CreateUserBody, ResetPasswordBody, UpdateUserBody } from './user.schema';

export const userController = {
  async list(_req: Request, res: Response) {
    return ok(res, await userRepository.list());
  },

  async create(req: Request, res: Response) {
    const body = req.body as CreateUserBody;
    const passwordHash = await argon2.hash(body.password);
    const user = await userRepository.create({
      fullName: body.fullName,
      email: body.email ?? null,
      mobile: body.mobile,
      passwordHash,
      roleName: body.roleName,
      createdBy: req.user!.sub,
    });
    await audit({
      actorId: req.user!.sub,
      action: 'CREATE',
      entity: 'user',
      entityId: user.id,
      meta: { role: body.roleName, mobile: body.mobile },
      ip: req.ip,
    });
    return created(res, { id: user.id });
  },

  async update(req: Request, res: Response) {
    const body = req.body as UpdateUserBody;
    await userRepository.update(req.params.id, body);
    await audit({
      actorId: req.user!.sub,
      action: 'UPDATE',
      entity: 'user',
      entityId: req.params.id,
      meta: { fullName: body.fullName, mobile: body.mobile, roleName: body.roleName },
      ip: req.ip,
    });
    return ok(res, { updated: true });
  },

  async resetPassword(req: Request, res: Response) {
    const body = req.body as ResetPasswordBody;
    const passwordHash = await argon2.hash(body.newPassword);
    await userRepository.resetPassword(req.params.id, passwordHash);
    // Kill the target's existing sessions — old credentials must stop working.
    await authRepository.revokeAllForUser(req.params.id);
    await audit({
      actorId: req.user!.sub,
      action: 'PASSWORD_RESET',
      entity: 'user',
      entityId: req.params.id,
      ip: req.ip,
    });
    return ok(res, { reset: true });
  },

  async unlock(req: Request, res: Response) {
    await userRepository.unlock(req.params.id);
    await audit({
      actorId: req.user!.sub,
      action: 'STATUS_CHANGE',
      entity: 'user',
      entityId: req.params.id,
      meta: { unlocked: true },
      ip: req.ip,
    });
    return ok(res, { unlocked: true });
  },

  /**
   * "Delete" a user = deactivate. Users are referenced across loans,
   * collections, salaries and audit logs, so rows are never hard-deleted;
   * an inactive user simply can no longer log in or refresh a session.
   */
  async remove(req: Request, res: Response) {
    const targetId = req.params.id;
    if (targetId === req.user!.sub) throw BadRequest('You cannot deactivate your own account');

    const target = await authRepository.findByIdWithRole(targetId);
    if (!target) throw BadRequest('User not found');
    if (!target.is_active) return ok(res, { deactivated: true });

    if (target.role_name === 'admin' && (await userRepository.countActiveAdminsExcluding(targetId)) === 0) {
      throw BadRequest('Cannot deactivate the last active admin');
    }

    await userRepository.setActive(targetId, false);
    await authRepository.revokeAllForUser(targetId);
    await audit({
      actorId: req.user!.sub,
      action: 'DELETE',
      entity: 'user',
      entityId: targetId,
      meta: { deactivated: true, role: target.role_name, mobile: target.mobile },
      ip: req.ip,
    });
    return ok(res, { deactivated: true });
  },

  /** Reverse a deactivation — the user can log in again with their existing credentials. */
  async reactivate(req: Request, res: Response) {
    const targetId = req.params.id;
    const target = await authRepository.findByIdWithRole(targetId);
    if (!target) throw BadRequest('User not found');
    if (target.is_active) return ok(res, { reactivated: true });

    await userRepository.setActive(targetId, true);
    await audit({
      actorId: req.user!.sub,
      action: 'STATUS_CHANGE',
      entity: 'user',
      entityId: targetId,
      meta: { reactivated: true, role: target.role_name, mobile: target.mobile },
      ip: req.ip,
    });
    return ok(res, { reactivated: true });
  },
};
