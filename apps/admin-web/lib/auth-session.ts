import type { AuthUser } from '@damsen/shared-types';

const SESSION_KEY = 'damsen.admin.session.v1';
export const AUTH_SESSION_EVENT = 'damsen-auth-session';
export interface AdminAuthSession {
  accessToken: string;
  user: AuthUser;
  /** Lets a long field session renew the 15-minute access token. */
  refreshToken?: string;
  /** Epoch ms the access token stops working. */
  accessTokenExpiresAt?: number;
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

const REFRESH_MARGIN_MS = 60_000;
let refreshing: Promise<string> | undefined;

/**
 * Returns an access token, renewing it first when it expires within a minute. Calls
 * are de-duplicated (a refresh token rotates, so two parallel refreshes would lose
 * one). Throws a Vietnamese message when the session cannot be renewed.
 */
export async function ensureFreshAccessToken(
  refresh: (refreshToken: string) => Promise<{
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresIn: number;
    user: AuthUser;
  }>,
  now: number = Date.now(),
): Promise<string> {
  const session = readAuthSession();
  if (!session) {
    throw new Error('Bạn cần đăng nhập phiên quản trị trước khi gọi API.');
  }
  const expiresAt = session.accessTokenExpiresAt;
  if (!expiresAt || expiresAt - now > REFRESH_MARGIN_MS) {
    return session.accessToken;
  }
  if (!session.refreshToken) return session.accessToken; // old session: try as is
  refreshing ??= refresh(session.refreshToken)
    .then((next) => {
      saveAuthSession({
        accessToken: next.accessToken,
        refreshToken: next.refreshToken,
        accessTokenExpiresAt: Date.now() + next.accessTokenExpiresIn * 1000,
        user: next.user,
      });
      return next.accessToken;
    })
    .catch(() => {
      clearAuthSession();
      throw new Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');
    })
    .finally(() => {
      refreshing = undefined;
    });
  return refreshing;
}
