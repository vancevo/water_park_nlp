import type { AuthResponse } from '@damsen/shared-types';

const KEY = 'damsen.visitor.session';

export function readVisitorSession(): AuthResponse | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AuthResponse) : null;
  } catch {
    return null;
  }
}

export function saveVisitorSession(session: AuthResponse): void {
  window.sessionStorage.setItem(KEY, JSON.stringify(session));
}

export function clearVisitorSession(): void {
  window.sessionStorage.removeItem(KEY);
}
