/**
 * What the visitor has already listened to in this tour. "Heard" is tracked per
 * `poiId + narration language + content version`, so a new language or an edited
 * narration can be heard again while the same content never replays by itself.
 * It lives in session storage of the tab (survives a reload, not a new tab) and is
 * only cleared by an explicit "new visit".
 */
export const LISTEN_HISTORY_KEY = 'damsen.visit.heard.v1';

export type HistoryStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>;

export function narrationKey(
  poiId: string,
  locale: string,
  contentVersion: string,
): string {
  return `${poiId}|${locale}|${contentVersion}`;
}

function browserStorage(): HistoryStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null; // blocked storage: the history just lives in memory
  }
}

export class ListenHistory {
  private readonly heard = new Map<string, number>();

  constructor(
    private readonly storage: HistoryStorage | null = browserStorage(),
  ) {
    try {
      const raw = this.storage?.getItem(LISTEN_HISTORY_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
      for (const [key, at] of Object.entries(parsed)) {
        if (typeof at === 'number') this.heard.set(key, at);
      }
    } catch {
      // A corrupt entry is the same as no history.
    }
  }

  has(key: string): boolean {
    return this.heard.has(key);
  }

  /** True when `poiId` was heard in any language or version (for list badges). */
  hasPoi(poiId: string): boolean {
    for (const key of this.heard.keys())
      if (key.startsWith(`${poiId}|`)) return true;
    return false;
  }

  mark(key: string, nowMs: number = Date.now()): void {
    if (this.heard.has(key)) return;
    this.heard.set(key, nowMs);
    this.persist();
  }

  get size(): number {
    return this.heard.size;
  }

  reset(): void {
    this.heard.clear();
    try {
      this.storage?.removeItem(LISTEN_HISTORY_KEY);
    } catch {
      // ignore
    }
  }

  private persist(): void {
    try {
      this.storage?.setItem(
        LISTEN_HISTORY_KEY,
        JSON.stringify(Object.fromEntries(this.heard)),
      );
    } catch {
      // Storage full or blocked: keep the in-memory history.
    }
  }
}
