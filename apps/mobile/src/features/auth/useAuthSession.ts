import { useEffect, useState } from 'react';

import type { AuthSnapshot } from './model';
import type { SessionManager } from './sessionManager';

export function useAuthSession(manager: SessionManager) {
  const [state, setState] = useState<AuthSnapshot>(manager.getSnapshot());

  useEffect(
    () => manager.subscribe(() => setState(manager.getSnapshot())),
    [manager],
  );
  useEffect(() => {
    void manager.restore();
  }, [manager]);

  return {
    state,
    login: manager.login.bind(manager),
    register: manager.register.bind(manager),
    logout: manager.logout.bind(manager),
    continueAsGuest: manager.continueAsGuest.bind(manager),
    refreshAccessToken: manager.refreshAccessToken.bind(manager),
  };
}
