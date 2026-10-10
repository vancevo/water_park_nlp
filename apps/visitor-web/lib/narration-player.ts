import type { ListenHistory } from './listen-history';

/**
 * The one narration player of the visitor app. Clicks on a place, the GPS and the
 * "Listen" buttons all go through `request()`; this is the only place that starts,
 * stops or counts audio, so two narrations never overlap and one content is never
 * started twice. Framework-free so it can be tested with a fake audio element.
 *
 * Rules (see docs/plans PLAN_1): `manual` always plays; `poi-click` and `auto-gps`
 * only play while the auto switch is on and the content was not heard yet; `auto-gps`
 * never interrupts audio that is already playing.
 */
export type PlaySource = 'manual' | 'poi-click' | 'auto-gps';
export type PlayerStatus =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'blocked'
  | 'error';

export interface Playable {
  /** `poiId|locale|contentVersion` (listen-history.narrationKey). */
  key: string;
  poiId: string;
  poiName: string;
  locale: string;
  audioUrl: string | null;
  /** Spoken with the browser voice when there is no audio file. */
  text: string | null;
  speechLang: string;
}

export interface PlayRequest {
  source: PlaySource;
  poiId: string;
  poiName: string;
  /** The narration language asked for (not necessarily what the server resolves). */
  locale: string;
  /** Resolves the content, or null when there is nothing to play. */
  load(): Promise<Playable | null>;
}

export type RequestResult =
  | 'played'
  | 'already-active'
  | 'duplicate'
  | 'heard'
  | 'busy'
  | 'ignored'
  | 'cancelled'
  | 'missing'
  | 'blocked'
  | 'error';

export interface ActivePlayback {
  poiId: string;
  poiName: string;
  key: string;
  locale: string;
  source: PlaySource;
  status: Exclude<PlayerStatus, 'idle'>;
  /** Plain `audio` (a file) or `speech` (browser voice). */
  engine: 'audio' | 'speech';
}

export interface PlayerState {
  status: PlayerStatus;
  active: ActivePlayback | null;
  /** A request waiting for its content (nothing may be playing yet). */
  pending: { poiId: string; source: PlaySource } | null;
  /** Bumps on every change, including the listen history. */
  version: number;
}

export interface AudioLike {
  src: string;
  currentTime: number;
  readonly duration: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface SpeechLike {
  /** Speaks `text`; returns false when no voice for `lang` exists. */
  speak(
    text: string,
    lang: string,
    handlers: { onStart(): void; onEnd(): void; onError(): void },
  ): boolean;
  cancel(): void;
}

export interface PlayerDeps {
  history: ListenHistory;
  createAudio(): AudioLike;
  speech?: SpeechLike | null;
  /** Seconds of playing that count as "heard" (or half the audio, if shorter). */
  heardSeconds?: number;
}

const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

const BUSY: ReadonlySet<PlayerStatus> = new Set([
  'loading',
  'playing',
  'paused',
]);

export class NarrationPlayer {
  private state: PlayerState = {
    status: 'idle',
    active: null,
    pending: null,
    version: 0,
  };
  private readonly listeners = new Set<() => void>();
  private audio: AudioLike | null = null;
  private audioHandlers: Array<[string, () => void]> = [];
  private speechTimer: ReturnType<typeof setTimeout> | null = null;
  private token = 0;
  private pending: {
    token: number;
    poiLocale: string;
    source: PlaySource;
  } | null = null;
  private autoEnabled = false;
  private readonly heardSeconds: number;

  constructor(private readonly deps: PlayerDeps) {
    this.heardSeconds = deps.heardSeconds ?? 5;
  }

  // ---------------------------------------------------------------- state ---

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PlayerState => this.state;

  get history(): ListenHistory {
    return this.deps.history;
  }

  isHeard(key: string): boolean {
    return this.deps.history.has(key);
  }

  isBusy(): boolean {
    return BUSY.has(this.state.status) || this.pending !== null;
  }

  /** Call after the listen history changed from outside (new visit). */
  touch(): void {
    this.emit({});
  }

  private emit(patch: Partial<PlayerState>): void {
    const next = { ...this.state, ...patch, version: this.state.version + 1 };
    next.status = next.active
      ? next.active.status
      : next.pending
        ? 'loading'
        : 'idle';
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }

  private markHeard(key: string): void {
    if (this.deps.history.has(key)) return;
    this.deps.history.mark(key);
    this.emit({});
  }

  private setActiveStatus(status: ActivePlayback['status']): void {
    if (!this.state.active) return;
    this.emit({ active: { ...this.state.active, status } });
  }

  // ------------------------------------------------------------ the switch ---

  /** Turning the switch off drops every automatic request and automatic audio. */
  setAutoEnabled(on: boolean): void {
    if (this.autoEnabled === on) return;
    this.autoEnabled = on;
    if (on) return;
    if (this.pending && this.pending.source !== 'manual') {
      this.token += 1;
      this.pending = null;
      this.emit({ pending: null });
    }
    const active = this.state.active;
    if (active && active.source !== 'manual') this.stop();
  }

  /**
   * Call from the tap that turns the switch on: lets the browser play audio later
   * without another tap (a silent clip + an empty utterance).
   */
  unlock(): void {
    try {
      const audio = (this.audio ??= this.deps.createAudio());
      if (this.state.status === 'idle') {
        audio.src = SILENT_WAV;
        void audio.play().catch(() => {});
      }
    } catch {
      // Nothing to unlock.
    }
  }

  // -------------------------------------------------------------- request ---

  async request(request: PlayRequest): Promise<RequestResult> {
    if (request.source !== 'manual' && !this.autoEnabled) return 'ignored';
    const poiLocale = `${request.poiId}|${request.locale}`;
    const active = this.state.active;

    if (active && `${active.poiId}|${active.locale}` === poiLocale) {
      if (active.status === 'paused' && request.source === 'manual') {
        this.resume();
        return 'already-active';
      }
      if (active.status === 'blocked' && request.source === 'manual') {
        return (await this.retryBlocked()) ? 'played' : 'blocked';
      }
      if (BUSY.has(active.status)) return 'already-active';
    }
    if (this.pending?.poiLocale === poiLocale) {
      if (request.source === 'manual') this.pending.source = 'manual';
      return 'duplicate';
    }
    // The GPS never cuts into audio that is playing or being loaded.
    if (request.source === 'auto-gps' && this.isBusy()) return 'busy';

    const token = ++this.token;
    this.pending = { token, poiLocale, source: request.source };
    this.emit({
      pending: { poiId: request.poiId, source: request.source },
    });

    let playable: Playable | null;
    try {
      playable = await request.load();
    } catch {
      if (token !== this.token) return 'cancelled';
      this.pending = null;
      this.emit({ pending: null });
      return 'error';
    }
    if (token !== this.token) return 'cancelled'; // a newer pick, or auto went off
    const source = this.pending?.source ?? request.source;
    this.pending = null;
    this.emit({ pending: null });

    if (!playable) return 'missing';
    if (source !== 'manual' && !this.autoEnabled) return 'cancelled';
    if (source !== 'manual' && this.deps.history.has(playable.key)) {
      return 'heard';
    }
    if (source === 'auto-gps' && BUSY.has(this.state.status)) return 'busy';
    return this.start(playable, source);
  }

  // ---------------------------------------------------------------- engine ---

  private async start(
    playable: Playable,
    source: PlaySource,
  ): Promise<RequestResult> {
    this.stopEngine();
    const active: ActivePlayback = {
      poiId: playable.poiId,
      poiName: playable.poiName,
      key: playable.key,
      locale: playable.locale,
      source,
      status: 'loading',
      engine: playable.audioUrl ? 'audio' : 'speech',
    };
    this.emit({ active });

    if (playable.audioUrl) {
      const audio = (this.audio ??= this.deps.createAudio());
      this.bindAudio(audio, playable.key);
      audio.src = playable.audioUrl;
      audio.currentTime = 0;
      try {
        await audio.play();
      } catch (cause) {
        if (this.state.active?.key !== playable.key) return 'cancelled';
        const blocked =
          typeof cause === 'object' &&
          cause !== null &&
          (cause as { name?: string }).name === 'NotAllowedError';
        this.setActiveStatus(blocked ? 'blocked' : 'error');
        return blocked ? 'blocked' : 'error';
      }
      if (this.state.active?.key !== playable.key) return 'cancelled';
      // `playing` is also reported by the element's own event.
      if (this.state.active?.status === 'loading') {
        this.setActiveStatus('playing');
      }
      return 'played';
    }

    const speech = this.deps.speech;
    if (!speech || !playable.text) {
      this.setActiveStatus('error');
      return 'error';
    }
    const ok = speech.speak(playable.text, playable.speechLang, {
      onStart: () => {
        if (this.state.active?.key !== playable.key) return;
        this.setActiveStatus('playing');
        this.speechTimer = setTimeout(
          () => this.markHeard(playable.key),
          this.heardSeconds * 1000,
        );
      },
      onEnd: () => {
        if (this.state.active?.key !== playable.key) return;
        this.markHeard(playable.key);
        this.finish();
      },
      onError: () => {
        if (this.state.active?.key !== playable.key) return;
        this.setActiveStatus('error');
      },
    });
    if (!ok) {
      this.setActiveStatus('error');
      return 'error';
    }
    return 'played';
  }

  private bindAudio(audio: AudioLike, key: string): void {
    this.unbindAudio(audio);
    const handler = (type: string, fn: () => void) => {
      audio.addEventListener(type, fn);
      this.audioHandlers.push([type, fn]);
    };
    const isCurrent = () => this.state.active?.key === key;
    handler('playing', () => {
      if (isCurrent()) this.setActiveStatus('playing');
    });
    handler('pause', () => {
      if (isCurrent() && this.state.active?.status === 'playing') {
        this.setActiveStatus('paused');
      }
    });
    handler('timeupdate', () => {
      if (!isCurrent()) return;
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      const needed = duration
        ? Math.min(this.heardSeconds, duration / 2)
        : this.heardSeconds;
      if (audio.currentTime >= needed) this.markHeard(key);
    });
    handler('ended', () => {
      if (!isCurrent()) return;
      this.markHeard(key);
      this.finish();
    });
    handler('error', () => {
      if (isCurrent()) this.setActiveStatus('error');
    });
  }

  private unbindAudio(audio: AudioLike): void {
    for (const [type, fn] of this.audioHandlers) {
      audio.removeEventListener(type, fn);
    }
    this.audioHandlers = [];
  }

  private stopEngine(): void {
    if (this.speechTimer) clearTimeout(this.speechTimer);
    this.speechTimer = null;
    this.deps.speech?.cancel();
    if (this.audio) {
      this.unbindAudio(this.audio);
      this.audio.pause();
    }
  }

  private finish(): void {
    this.stopEngine();
    this.emit({ active: null });
  }

  // -------------------------------------------------------------- controls ---

  pause(): void {
    const active = this.state.active;
    if (!active || active.status !== 'playing' || active.engine !== 'audio') {
      return;
    }
    this.audio?.pause();
  }

  resume(): void {
    const active = this.state.active;
    if (!active || active.status !== 'paused' || !this.audio) return;
    void this.audio.play().catch(() => this.setActiveStatus('blocked'));
  }

  /** The "tap to listen" button after the browser blocked autoplay. */
  async retryBlocked(): Promise<boolean> {
    const active = this.state.active;
    if (!active || active.status !== 'blocked' || !this.audio) return false;
    try {
      await this.audio.play();
      return true;
    } catch {
      return false;
    }
  }

  /** Stops the audio and drops any request that is still loading. */
  stop(): void {
    if (this.pending) {
      this.token += 1;
      this.pending = null;
    }
    this.stopEngine();
    this.emit({ active: null, pending: null });
  }

  /** Only drops a request that has not started playing (e.g. language changed). */
  cancelPending(): void {
    if (!this.pending) return;
    this.token += 1;
    this.pending = null;
    this.emit({ pending: null });
  }
}
