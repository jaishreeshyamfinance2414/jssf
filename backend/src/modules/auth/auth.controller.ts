import { Request, Response } from 'express';
import { env, isProd } from '../../config/env';
import { ok } from '../../shared/http';
import { Unauthorized } from '../../shared/errors';
import { authService } from './auth.service';
import { authRepository } from './auth.repository';

const REFRESH_COOKIE = 'jssf_rt';

function setRefreshCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE || isProd,
    sameSite: 'lax',
    // Host-only cookie unless a domain is explicitly configured — a hardcoded
    // Domain=localhost gets rejected by browsers when the app is reached via a
    // LAN IP like 192.168.1.2.
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    expires: expiresAt,
    path: '/',
  });
}

export const authController = {
  async login(req: Request, res: Response) {
    const { identifier, password, rememberMe } = req.body;
    const result = await authService.login({
      identifier,
      password,
      rememberMe,
      ip: req.ip,
      userAgent: req.headers['user-agent'] ?? null,
    });
    setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
    return ok(res, { accessToken: result.accessToken, user: result.user });
  },

  async refresh(req: Request, res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw Unauthorized('No refresh token');
    const result = await authService.refresh(token, req.ip, req.headers['user-agent'] ?? null);
    setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
    return ok(res, { accessToken: result.accessToken });
  },

  async logout(req: Request, res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token) await authService.logout(token, req.user?.sub);
    res.clearCookie(REFRESH_COOKIE, {
      ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
      path: '/',
    });
    return ok(res, { loggedOut: true });
  },

  /** Current authenticated user's profile + permissions (for the frontend). */
  async me(req: Request, res: Response) {
    if (!req.user) throw Unauthorized();
    const user = await authRepository.findByIdWithRole(req.user.sub);
    if (!user) throw Unauthorized();
    return ok(res, {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      mobile: user.mobile,
      role: user.role_name,
      permissions: req.user.perms,
      mustChangePassword: user.must_change_password,
    });
  },

  /** Self-service password change; clears must_change_password and re-issues tokens. */
  async changePassword(req: Request, res: Response) {
    if (!req.user) throw Unauthorized();
    const { currentPassword, newPassword } = req.body;
    await authService.changePassword(req.user.sub, currentPassword, newPassword, req.ip);
    // All sessions were revoked — issue a fresh pair so this session continues.
    const result = await authService.issueSession(
      req.user.sub,
      req.ip,
      req.headers['user-agent'] ?? null,
    );
    setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
    return ok(res, { accessToken: result.accessToken, user: result.user });
  },
};
