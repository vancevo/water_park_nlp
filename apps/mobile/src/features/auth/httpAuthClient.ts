import { DamSenApiClient } from '@damsen/api-client';

import type { AuthClient } from './model';

export function createHttpAuthClient(baseUrl: string): AuthClient {
  const client = new DamSenApiClient({ baseUrl });
  return {
    login: (input) => client.login(input),
    register: (input) => client.register(input),
    refresh: (refreshToken) => client.refresh({ refreshToken }),
    logout: (refreshToken) => client.logout({ refreshToken }),
  };
}
