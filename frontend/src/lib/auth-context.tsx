'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiGet, apiPost, refreshAccessToken, setAccessToken } from './api';

export interface AuthUser {
  id: string;
  fullName: string;
  email: string | null;
  mobile: string;
  role: string;
  permissions: string[];
  mustChangePassword?: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (identifier: string, password: string, rememberMe: boolean) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount, try to restore a session via the refresh cookie. Uses the shared
  // single-flight refresh so this can't race the 401-retry interceptor (the
  // refresh token is single-use — two parallel refreshes would log us out).
  // React 18 StrictMode also double-invokes effects in dev; single-flight
  // makes the second invocation reuse the first request instead of burning
  // the freshly-rotated token.
  useEffect(() => {
    (async () => {
      try {
        await refreshAccessToken();
        setUser(await apiGet<AuthUser>('/auth/me'));
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (identifier: string, password: string, rememberMe: boolean) => {
    const res = await apiPost<{ accessToken: string; user: Omit<AuthUser, 'permissions'> }>(
      '/auth/login',
      { identifier, password, rememberMe },
    );
    setAccessToken(res.accessToken);
    setUser(await apiGet<AuthUser>('/auth/me'));
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiPost('/auth/logout');
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const res = await apiPost<{ accessToken: string }>('/auth/change-password', {
      currentPassword,
      newPassword,
    });
    setAccessToken(res.accessToken);
    setUser(await apiGet<AuthUser>('/auth/me'));
  }, []);

  const can = useCallback(
    (permission: string) => !!user && user.permissions.includes(permission),
    [user],
  );

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, changePassword, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
