import { describe, expect, it } from 'vitest';
import {
  LISTEN_HISTORY_KEY,
  ListenHistory,
  narrationKey,
} from './listen-history';

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
};

describe('listen history', () => {
  it('keys by place, language and content version', () => {
    expect(narrationKey('p1', 'vi', 'v3')).toBe('p1|vi|v3');
    const history = new ListenHistory(memory());
    history.mark(narrationKey('p1', 'vi', 'v3'));
    expect(history.has('p1|vi|v3')).toBe(true);
    expect(history.has('p1|en|v3')).toBe(false); // other language
    expect(history.has('p1|vi|v4')).toBe(false); // edited narration
    expect(history.hasPoi('p1')).toBe(true);
    expect(history.hasPoi('p2')).toBe(false);
  });

  it('survives a reload of the tab (same session storage)', () => {
    const storage = memory();
    new ListenHistory(storage).mark('p1|vi|v1');
    const afterReload = new ListenHistory(storage);
    expect(afterReload.has('p1|vi|v1')).toBe(true);
    expect(afterReload.size).toBe(1);
  });

  it('is cleared only by an explicit reset', () => {
    const storage = memory();
    const history = new ListenHistory(storage);
    history.mark('p1|vi|v1');
    history.reset();
    expect(history.size).toBe(0);
    expect(storage.data.has(LISTEN_HISTORY_KEY)).toBe(false);
    expect(new ListenHistory(storage).has('p1|vi|v1')).toBe(false);
  });

  it('works in memory when storage is blocked or corrupt', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const history = new ListenHistory(blocked);
    history.mark('p1|vi|v1');
    expect(history.has('p1|vi|v1')).toBe(true);
    history.reset();

    const corrupt = memory();
    corrupt.data.set(LISTEN_HISTORY_KEY, '{not json');
    expect(new ListenHistory(corrupt).size).toBe(0);
  });
});
