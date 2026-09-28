import { ApiClientError, type AuthResponse } from '@damsen/api-client';

import type {
  AuthClient,
  AuthErrorCode,
  AuthSnapshot,
  SessionStore,
  StoredSession,
} from './model';

type Listener = () => void;

function toStoredSession(response: AuthResponse, now: number): StoredSession {
  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    accessTokenExpiresAt: now + response.accessTokenExpiresIn * 1_000,
    user: response.user,
  };
}

function loginError(error: unknown): AuthErrorCode {
  return error instanceof ApiClientError && error.status === 401
    ? 'invalid_credentials'
    : 'login_failed';
}

export class SessionManager {
  private snapshot: AuthSnapshot = { status: 'restoring', error: null };
  private session: StoredSession | null = null;
  private readonly listeners = new Set<Listener>();
  private refreshPromise: Promise<string | null> | null = null;

  constructor(
    private readonly client: AuthClient,
    private readonly store: SessionStore,
    private readonly now: () => number = Date.now,
  ) {}

  getSnapshot = (): AuthSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async restore(): Promise<void> {
    try {
      const session = await this.store.load();
      if (!session) {
        this.update({ status: 'guest', error: null });
        return;
      }
      this.session = session;
      if (session.accessTokenExpiresAt > this.now()) {
        this.setAuthenticated(session, false, null);
        return;
      }
      await this.refreshAccessToken();
    } catch {
      this.session = null;
      await this.clearStoreSafely();
      this.update({ status: 'guest', error: 'storage_failed' });
    }
  }

  async login(email: string, password: string): Promise<boolean> {
    this.update({ status: 'authenticating', operation: 'login', error: null });
    try {
      const response = await this.client.login({
        email: email.trim().toLowerCase(),
        password,
      });
      await this.accept(response);
      return true;
    } catch (error) {
      this.update({ status: 'guest', error: loginError(error) });
      return false;
    }
  }

  async register(
    email: string,
    password: string,
    preferredLocale: 'vi' | 'en',
  ): Promise<boolean> {
    this.update({
      status: 'authenticating',
      operation: 'register',
      error: null,
    });
    try {
      const response = await this.client.register({
        email: email.trim().toLowerCase(),
        password,
        preferredLocale,
      });
      await this.accept(response);
      return true;
    } catch {
      this.update({ status: 'guest', error: 'registration_failed' });
      return false;
    }
  }

  async refreshAccessToken(): Promise<string | null> {
    if (!this.session) return null;
    if (this.refreshPromise) return this.refreshPromise;

    const currentSession = this.session;
    this.setAuthenticated(currentSession, true, null);
    this.refreshPromise = this.performRefresh(currentSession.refreshToken);
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  async logout(): Promise<void> {
    const refreshToken = this.session?.refreshToken;
    this.session = null;
    await this.clearStoreSafely();
    this.update({ status: 'guest', error: null });

    if (!refreshToken) return;
    try {
      await this.client.logout(refreshToken);
    } catch {
      this.update({ status: 'guest', error: 'logout_failed' });
    }
  }

  continueAsGuest(): void {
    if (this.session) return;
    this.update({ status: 'guest', error: null });
  }

  private async performRefresh(refreshToken: string): Promise<string | null> {
    try {
      const response = await this.client.refresh(refreshToken);
      await this.accept(response);
      return response.accessToken;
    } catch {
      this.session = null;
      await this.clearStoreSafely();
      this.update({ status: 'guest', error: 'session_expired' });
      return null;
    }
  }

  private async accept(response: AuthResponse): Promise<void> {
    const session = toStoredSession(response, this.now());
    await this.store.save(session);
    this.session = session;
    this.setAuthenticated(session, false, null);
  }

  private setAuthenticated(
    session: StoredSession,
    isRefreshing: boolean,
    error: AuthErrorCode | null,
  ): void {
    this.update({
      status: 'authenticated',
      user: session.user,
      accessToken: session.accessToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt,
      isRefreshing,
      error,
    });
  }

  private async clearStoreSafely(): Promise<void> {
    try {
      await this.store.clear();
    } catch {
      // Local state is still cleared; credentials are never included in errors.
    }
  }

  private update(snapshot: AuthSnapshot): void {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
}
