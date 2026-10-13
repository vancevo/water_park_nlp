import { createHmac } from 'node:crypto';

export function normalizeDemoPhone(value: string): string {
  const compact = value.trim().replace(/[\s.-]/g, '');
  const normalized = compact.startsWith('0')
    ? `+84${compact.slice(1)}`
    : compact;
  if (!/^\+84[1-9][0-9]{8}$/.test(normalized)) {
    throw new Error('INVALID_PHONE');
  }
  return normalized;
}

export function hashDemoPhone(normalized: string, secret: string): string {
  return createHmac('sha256', secret).update(normalized).digest('hex');
}

export function last4DemoPhone(normalized: string): string {
  return normalized.slice(-4);
}
