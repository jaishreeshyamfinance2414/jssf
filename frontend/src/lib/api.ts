import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

// By default the API is same-origin: Next.js proxies /api/v1 and /uploads to
// the backend (see next.config.mjs rewrites). This works on localhost, LAN IPs,
// and HTTPS alike, with no CORS or cross-origin cookie concerns. Set
// NEXT_PUBLIC_API_URL only if the browser should hit the backend directly.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api/v1';

/** Backend origin without the /api/v1 prefix — for static assets like /uploads. */
export const API_ORIGIN = API_URL.replace(/\/api\/v1\/?$/, '');

/**
 * Axios instance with credentials (so the httpOnly refresh cookie flows) and an
 * in-memory access token. On 401 it transparently calls /auth/refresh once and
 * retries the original request — the app never sees the token juggling.
 */
export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
});

let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => {
  accessToken = t;
};
export const getAccessToken = () => accessToken;

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let refreshing: Promise<string> | null = null;

/**
 * Single-flight session refresh. Refresh tokens are single-use (rotated on
 * every call), so concurrent refreshes with the same cookie would race — the
 * loser presents an already-revoked token and gets 401. Everyone shares one
 * in-flight request instead.
 */
export function refreshAccessToken(): Promise<string> {
  refreshing ??= api
    .post<{ data: { accessToken: string } }>('/auth/refresh')
    .then((r) => {
      const token = r.data.data.accessToken;
      setAccessToken(token);
      return token;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    const isAuthCall = original?.url?.includes('/auth/');

    if (error.response?.status === 401 && !original?._retry && !isAuthCall) {
      original._retry = true;
      try {
        const token = await refreshAccessToken();
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch {
        setAccessToken(null);
        if (typeof window !== 'undefined') window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

/** Unwrap the { success, data } envelope. */
export async function apiGet<T>(url: string): Promise<T> {
  const { data } = await api.get<{ data: T }>(url);
  return data.data;
}
export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const { data } = await api.post<{ data: T }>(url, body);
  return data.data;
}
export async function apiPut<T>(url: string, body?: unknown): Promise<T> {
  const { data } = await api.put<{ data: T }>(url, body);
  return data.data;
}
export async function apiDelete<T>(url: string): Promise<T> {
  const { data } = await api.delete<{ data: T }>(url);
  return data.data;
}

/**
 * Fetch a protected uploaded document (PII — served only via the authenticated
 * /files route) and return an object URL for use in <img>/<iframe>/<a>.
 * Caller must revoke the URL when done (URL.revokeObjectURL).
 */
export async function fetchFileUrl(path: string): Promise<string> {
  const clean = path.replaceAll('\\', '/');
  const { data } = await api.get(`/files/${clean}`, { responseType: 'blob' });
  return URL.createObjectURL(data);
}
