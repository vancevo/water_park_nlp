import { DamSenApiClient } from '@damsen/api-client';

export const visitorApi = new DamSenApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api',
});
