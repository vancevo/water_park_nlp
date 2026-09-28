import type { SessionStore, StoredSession } from './model';

function copy(session: StoredSession): StoredSession {
  return {
    ...session,
    user: { ...session.user, roles: [...session.user.roles] },
  };
}

/**
 * Ephemeral store used by tests and until a native encrypted adapter is wired.
 * It intentionally does not persist credentials across an app restart.
 */
export function createMemorySessionStore(
  initialSession: StoredSession | null = null,
): SessionStore {
  let session = initialSession ? copy(initialSession) : null;

  return {
    async load() {
      return session ? copy(session) : null;
    },
    async save(nextSession) {
      session = copy(nextSession);
    },
    async clear() {
      session = null;
    },
  };
}
