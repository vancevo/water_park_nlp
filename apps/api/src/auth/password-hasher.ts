import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import type { PasswordHasher } from './auth.models.js';

const deriveArgon2 = promisify(argon2);
const PARAMETERS = { memory: 65_536, passes: 3, parallelism: 1, tagLength: 32 };

export class Argon2idPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const digest = (await deriveArgon2('argon2id', {
      ...PARAMETERS,
      message: Buffer.from(password),
      nonce: salt,
    })) as Buffer;
    return `argon2id$v=19$m=${PARAMETERS.memory},t=${PARAMETERS.passes},p=${PARAMETERS.parallelism}$${salt.toString('base64url')}$${digest.toString('base64url')}`;
  }

  async verify(encoded: string, password: string): Promise<boolean> {
    const parts = encoded.split('$');
    if (parts.length !== 5 || parts[0] !== 'argon2id') return false;
    const params = Object.fromEntries(
      (parts[2] ?? '').split(',').map((pair) => pair.split('=')),
    );
    const salt = Buffer.from(parts[3] ?? '', 'base64url');
    const expected = Buffer.from(parts[4] ?? '', 'base64url');
    if (!salt.length || !expected.length) return false;
    const actual = (await deriveArgon2('argon2id', {
      message: Buffer.from(password),
      nonce: salt,
      memory: Number(params.m),
      passes: Number(params.t),
      parallelism: Number(params.p),
      tagLength: expected.length,
    })) as Buffer;
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
}
