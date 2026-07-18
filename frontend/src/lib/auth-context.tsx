'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, apiGet, apiPost, setAccessToken } from './api';

export interface AuthUser {
  id: string;
  fullName: string;
  email: string | null;
  mobile: string;
  role: string;
  permissions: string[];
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (identifier: string, password: string, rememberMe: boolean) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount, try to restore a session via the refresh cookie.
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.post<{ data: { accessToken: string } }>('/auth/refresh');
        setAccessToken(data.data.accessToken);
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

  const can = useCallback(
    (permission: string) => !!user && user.permissions.includes(permission),
    [user],
  );

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
