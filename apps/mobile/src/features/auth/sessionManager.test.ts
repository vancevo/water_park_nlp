import type { AuthResponse } from '@damsen/api-client';
import { describe, expect, it, vi } from 'vitest';

import { createMemorySessionStore } from './memorySessionStore';
import type { AuthClient, StoredSession } from './model';
import { SessionManager } from './sessionManager';

const NOW = 1_800_000_000_000;

function response(suffix = 'one'): AuthResponse {
  return {
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    accessTokenExpiresIn: 900,
    user: {
      id: 'user-1',
      email: 'visitor@example.test',
      preferredLocale: 'vi',
      roles: ['VISITOR'],
    },
  };
}

function client(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    login: vi.fn().mockResolvedValue(response()),
    register: vi.fn().mockResolvedValue(response()),
    refresh: vi.fn().mockResolvedValue(response('rotated')),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function stored(expiresAt = NOW + 60_000): StoredSession {
  const value = response();
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    accessTokenExpiresAt: expiresAt,
    user: value.user,
  };
}

describe('SessionManager', () => {
  it('restores an empty store as a guest session', async () => {
    const manager = new SessionManager(
      client(),
      createMemorySessionStore(),
      () => NOW,
    );

    await manager.restore();

    expect(manager.getSnapshot()).toEqual({ status: 'guest', error: null });
  });

  it('restores a valid authenticated session without refreshing', async () => {
    const authClient = client();
    const manager = new SessionManager(
      authClient,
      createMemorySessionStore(stored()),
      () => NOW,
    );

    await manager.restore();

    expect(manager.getSnapshot()).toMatchObject({
      status: 'authenticated',
      accessToken: 'access-one',
      isRefreshing: false,
    });
    expect(authClient.refresh).not.toHaveBeenCalled();
  });

  it('normalizes login email and stores the resulting token rotation', async () => {
    const authClient = client();
    const store = createMemorySessionStore();
    const manager = new SessionManager(authClient, store, () => NOW);

    await expect(
      manager.login('  Visitor@Example.Test ', 'not-logged-password'),
    ).resolves.toBe(true);

    expect(authClient.login).toHaveBeenCalledWith({
      email: 'visitor@example.test',
      password: 'not-logged-password',
    });
    expect(await store.load()).toMatchObject({
      accessToken: 'access-one',
      refreshToken: 'refresh-one',
      accessTokenExpiresAt: NOW + 900_000,
    });
  });

  it('passes locale when registering', async () => {
    const authClient = client();
    const manager = new SessionManager(
      authClient,
      createMemorySessionStore(),
      () => NOW,
    );

    await manager.register('new@example.test', 'long-enough-password', 'en');

    expect(authClient.register).toHaveBeenCalledWith({
      email: 'new@example.test',
      password: 'long-enough-password',
      preferredLocale: 'en',
    });
  });

  it('coalesces concurrent refresh calls and stores rotated tokens', async () => {
    let resolveRefresh: ((value: AuthResponse) => void) | undefined;
    const refreshResult = new Promise<AuthResponse>((resolve) => {
      resolveRefresh = resolve;
    });
    const authClient = client({
      refresh: vi.fn().mockReturnValue(refreshResult),
    });
    const store = createMemorySessionStore(stored());
    const manager = new SessionManager(authClient, store, () => NOW);
    await manager.restore();

    const first = manager.refreshAccessToken();
    const second = manager.refreshAccessToken();
    resolveRefresh?.(response('rotated'));

    await expect(Promise.all([first, second])).resolves.toEqual([
      'access-rotated',
      'access-rotated',
    ]);
    expect(authClient.refresh).toHaveBeenCalledTimes(1);
    expect(await store.load()).toMatchObject({
      accessToken: 'access-rotated',
      refreshToken: 'refresh-rotated',
    });
  });

  it('clears local credentials when refresh fails', async () => {
    const store = createMemorySessionStore(stored(NOW - 1));
    const manager = new SessionManager(
      client({ refresh: vi.fn().mockRejectedValue(new Error('network')) }),
      store,
      () => NOW,
    );

    await manager.restore();

    expect(manager.getSnapshot()).toEqual({
      status: 'guest',
      error: 'session_expired',
    });
    expect(await store.load()).toBeNull();
  });

  it('clears credentials locally and revokes the refresh token on logout', async () => {
    const authClient = client();
    const store = createMemorySessionStore(stored());
    const manager = new SessionManager(authClient, store, () => NOW);
    await manager.restore();

    await manager.logout();

    expect(authClient.logout).toHaveBeenCalledWith('refresh-one');
    expect(await store.load()).toBeNull();
    expect(manager.getSnapshot()).toEqual({ status: 'guest', error: null });
  });
});
