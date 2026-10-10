// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@damsen/shared-types';
import {
  ensureFreshAccessToken,
  readAuthSession,
  saveAuthSession,
} from './auth-session';

const user = {
  id: 'u',
  email: 'e@x.vn',
  roles: ['EDITOR'],
} as unknown as AuthUser;
const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
    dispatchEvent: () => true,
  });
  vi.stubGlobal('Event', class {});
});
afterEach(() => vi.unstubAllGlobals());

const next = {
  accessToken: 'new-access',
  refreshToken: 'new-refresh',
  accessTokenExpiresIn: 900,
  user,
};

describe('ensureFreshAccessToken', () => {
  it('returns the stored token while it is still valid', async () => {
    saveAuthSession({
      accessToken: 'a',
      refreshToken: 'r',
      accessTokenExpiresAt: 10_000_000,
      user,
    });
    const refresh = vi.fn();
    expect(await ensureFreshAccessToken(refresh, 1_000_000)).toBe('a');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('renews near expiry, stores the rotated tokens, and de-duplicates parallel calls', async () => {
    saveAuthSession({
      accessToken: 'old',
      refreshToken: 'r1',
      accessTokenExpiresAt: 1_000_030,
      user,
    });
    const refresh = vi.fn(async () => next);
    const [a, b] = await Promise.all([
      ensureFreshAccessToken(refresh, 1_000_000),
      ensureFreshAccessToken(refresh, 1_000_000),
    ]);
    expect([a, b]).toEqual(['new-access', 'new-access']);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('r1');
    expect(readAuthSession()?.refreshToken).toBe('new-refresh');
  });

  it('clears the session and explains when the refresh token is rejected', async () => {
    saveAuthSession({
      accessToken: 'old',
      refreshToken: 'bad',
      accessTokenExpiresAt: 1,
      user,
    });
    await expect(
      ensureFreshAccessToken(async () => {
        throw new Error('401');
      }, 1_000_000),
    ).rejects.toThrow(/hết hạn/);
    expect(readAuthSession()).toBeNull();
  });

  it('keeps working with an old session that has no refresh token', async () => {
    saveAuthSession({ accessToken: 'legacy', user });
    expect(await ensureFreshAccessToken(vi.fn(), 5)).toBe('legacy');
  });
});
