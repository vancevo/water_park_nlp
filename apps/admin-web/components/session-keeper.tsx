'use client';
import { DamSenApiClient } from '@damsen/api-client';
import { useEffect } from 'react';
import { apiBase } from '@/lib/api-poi-client';
import { ensureFreshAccessToken, readAuthSession } from '@/lib/auth-session';

const authApi = new DamSenApiClient({ baseUrl: apiBase });

/** Renews the 15-minute access token in the background while the admin stays open. */
export function SessionKeeper() {
  useEffect(() => {
    const tick = () => {
      if (readAuthSession()) {
        void ensureFreshAccessToken((refreshToken) =>
          authApi.refresh({ refreshToken }),
        ).catch(() => undefined);
      }
    };
    tick();
    const timer = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return null;
}
