import { DamSenApiClient } from '@damsen/api-client';

export const api = new DamSenApiClient({ baseUrl: '/api' });

export function formatVnd(value: number): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value);
}
