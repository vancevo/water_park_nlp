import type { AuthUser } from '@damsen/shared-types';

const SESSION_KEY = 'damsen.admin.session.v1';
export const AUTH_SESSION_EVENT = 'damsen-auth-session';
export interface AdminAuthSession {
  accessToken: string;
  user: AuthUser;
}

export function readAuthSession(): AdminAuthSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AdminAuthSession;
  } catch {
    clearAuthSession();
    return null;
  }
}
export function saveAuthSession(session: AdminAuthSession) {
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
}
export function clearAuthSession() {
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(SESSION_KEY);
    window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
  }
}
export function requireAccessToken(): string {
  const token = readAuthSession()?.accessToken;
  if (!token)
    throw new Error('Bạn cần đăng nhập phiên quản trị trước khi gọi API.');
  return token;
}
