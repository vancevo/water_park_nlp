import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory()
        ? sourceFiles(path)
        : Promise.resolve(entry.name.endsWith('.ts') ? [path] : []);
    }),
  );
  return nested.flat();
}

describe('operations privacy guardrails', () => {
  it('does not log raw phone, token or GPS values in operations source', async () => {
    const files = await sourceFiles(resolve(process.cwd(), 'src/operations'));
    const realtimeFiles = await sourceFiles(
      resolve(process.cwd(), 'src/realtime'),
    );
    const source = (
      await Promise.all(
        [...files, ...realtimeFiles].map((path) => readFile(path, 'utf8')),
      )
    ).join('\n');
    expect(source).not.toMatch(/console\.(?:log|info|debug)\s*\(/);
    expect(source).not.toMatch(/logger\.(?:log|info|debug)\s*\(/i);
  });

  it('keeps exact coordinates out of the durable operations migration', async () => {
    const migration = await readFile(
      resolve(
        process.cwd(),
        '../../infra/migrations/017_demo_operations.up.sql',
      ),
      'utf8',
    );
    const durablePresenceSchema = migration.slice(
      migration.indexOf('CREATE TABLE presence_sessions'),
    );
    expect(durablePresenceSchema).not.toMatch(
      /\b(?:latitude|longitude|accuracy_meters)\b/i,
    );
  });
});
