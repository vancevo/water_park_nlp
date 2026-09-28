import { describe, expect, it } from 'vitest';

import { createMemorySessionStore } from './memorySessionStore';
import type { StoredSession } from './model';

const session: StoredSession = {
  accessToken: 'access',
  refreshToken: 'refresh',
  accessTokenExpiresAt: 123,
  user: {
    id: 'user-1',
    email: 'visitor@example.test',
    preferredLocale: 'vi',
    roles: ['VISITOR'],
  },
};

describe('createMemorySessionStore', () => {
  it('does not expose mutable references and can clear the session', async () => {
    const store = createMemorySessionStore();
    await store.save(session);

    const loaded = await store.load();
    loaded?.user.roles.push('ADMIN');

    expect((await store.load())?.user.roles).toEqual(['VISITOR']);
    await store.clear();
    expect(await store.load()).toBeNull();
  });
});
