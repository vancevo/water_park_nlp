import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ListenHistory } from './listen-history';
import {
  NarrationPlayer,
  type AudioLike,
  type Playable,
  type PlayRequest,
  type SpeechLike,
} from './narration-player';

class FakeAudio implements AudioLike {
  src = '';
  currentTime = 0;
  duration = 60;
  playCalls = 0;
  pauseCalls = 0;
  failWith: string | null = null;
  private readonly handlers = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: () => void) {
    this.handlers.get(type)?.delete(listener);
  }
  emit(type: string) {
    for (const listener of [...(this.handlers.get(type) ?? [])]) listener();
  }
  async play() {
    this.playCalls += 1;
    if (this.failWith) {
      const error = new Error(this.failWith);
      error.name = this.failWith;
      throw error;
    }
    this.emit('playing');
  }
  pause() {
    this.pauseCalls += 1;
    this.emit('pause');
  }
}

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
};

const playable = (poiId: string, version = 'v1', locale = 'vi'): Playable => ({
  key: `${poiId}|${locale}|${version}`,
  poiId,
  poiName: `POI ${poiId}`,
  locale,
  audioUrl: `https://audio/${poiId}.mp3`,
  text: null,
  speechLang: 'vi-VN',
});

const request = (
  source: PlayRequest['source'],
  poiId: string,
  load?: PlayRequest['load'],
): PlayRequest => ({
  source,
  poiId,
  poiName: `POI ${poiId}`,
  locale: 'vi',
  load: load ?? (async () => playable(poiId)),
});

let audio: FakeAudio;
let history: ListenHistory;
let player: NarrationPlayer;
beforeEach(() => {
  audio = new FakeAudio();
  history = new ListenHistory(memoryStorage());
  player = new NarrationPlayer({ history, createAudio: () => audio });
});

describe('who may start audio', () => {
  it('plays a manual request even with the auto switch off', async () => {
    expect(await player.request(request('manual', 'a'))).toBe('played');
    expect(player.getSnapshot().status).toBe('playing');
    expect(audio.src).toBe('https://audio/a.mp3');
  });

  it('ignores a click or GPS request while the switch is off', async () => {
    expect(await player.request(request('poi-click', 'a'))).toBe('ignored');
    expect(await player.request(request('auto-gps', 'a'))).toBe('ignored');
    expect(audio.playCalls).toBe(0);
  });

  it('plays an unheard click once with the switch on, then never restarts it', async () => {
    player.setAutoEnabled(true);
    expect(await player.request(request('poi-click', 'a'))).toBe('played');
    expect(await player.request(request('poi-click', 'a'))).toBe(
      'already-active',
    );
    audio.currentTime = 6;
    audio.emit('timeupdate');
    audio.emit('ended');
    expect(player.getSnapshot().status).toBe('idle');
    expect(await player.request(request('poi-click', 'a'))).toBe('heard');
    expect(await player.request(request('auto-gps', 'a'))).toBe('heard');
    expect(audio.playCalls).toBe(1);
  });

  it('replays on demand even when heard, with the switch off', async () => {
    history.mark('a|vi|v1');
    expect(await player.request(request('manual', 'a'))).toBe('played');
    expect(audio.playCalls).toBe(1);
  });

  it('never restarts a playing item for a second manual press', async () => {
    await player.request(request('manual', 'a'));
    expect(await player.request(request('manual', 'a'))).toBe('already-active');
    expect(audio.playCalls).toBe(1);
  });

  it('resumes a paused item on a manual press instead of restarting', async () => {
    await player.request(request('manual', 'a'));
    player.pause();
    expect(player.getSnapshot().status).toBe('paused');
    await player.request(request('manual', 'a'));
    expect(audio.playCalls).toBe(2);
    expect(audio.currentTime).toBe(0); // not reset to the start by the second call
  });
});

describe('requests that overlap', () => {
  it('starts one load for ten rapid clicks', async () => {
    player.setAutoEnabled(true);
    const load = vi.fn(async () => playable('a'));
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        player.request(request('poi-click', 'a', load)),
      ),
    );
    expect(load).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r === 'played')).toHaveLength(1);
    expect(audio.playCalls).toBe(1);
  });

  it('a click and the GPS on the same place give one playback', async () => {
    player.setAutoEnabled(true);
    const [click, gps] = await Promise.all([
      player.request(request('poi-click', 'a')),
      player.request(request('auto-gps', 'a')),
    ]);
    expect([click, gps].filter((r) => r === 'played')).toHaveLength(1);
    expect(audio.playCalls).toBe(1);
  });

  it('A then B while A loads slowly: A never plays after B', async () => {
    player.setAutoEnabled(true);
    let releaseA!: (value: Playable) => void;
    const slowA = new Promise<Playable>((resolve) => (releaseA = resolve));
    const a = player.request(request('poi-click', 'a', () => slowA));
    const b = player.request(request('poi-click', 'b'));
    expect(await b).toBe('played');
    releaseA(playable('a'));
    expect(await a).toBe('cancelled');
    expect(audio.src).toBe('https://audio/b.mp3');
    expect(audio.playCalls).toBe(1);
  });

  it('a click on another place stops the old audio and plays the new one', async () => {
    player.setAutoEnabled(true);
    await player.request(request('poi-click', 'a'));
    expect(await player.request(request('poi-click', 'b'))).toBe('played');
    expect(audio.src).toBe('https://audio/b.mp3');
    expect(player.getSnapshot().active?.poiId).toBe('b');
  });

  it('a click on a place already heard does not interrupt what is playing', async () => {
    player.setAutoEnabled(true);
    history.mark('b|vi|v1');
    await player.request(request('poi-click', 'a'));
    expect(await player.request(request('poi-click', 'b'))).toBe('heard');
    expect(player.getSnapshot().active?.poiId).toBe('a');
    expect(player.getSnapshot().status).toBe('playing');
  });

  it('the GPS never interrupts audio that is playing', async () => {
    player.setAutoEnabled(true);
    await player.request(request('manual', 'a'));
    expect(await player.request(request('auto-gps', 'b'))).toBe('busy');
    expect(player.getSnapshot().active?.poiId).toBe('a');
  });
});

describe('the auto switch', () => {
  it('drops a pending automatic request when switched off', async () => {
    player.setAutoEnabled(true);
    let release!: (value: Playable) => void;
    const slow = new Promise<Playable>((resolve) => (release = resolve));
    const pending = player.request(request('poi-click', 'a', () => slow));
    player.setAutoEnabled(false);
    release(playable('a'));
    expect(await pending).toBe('cancelled');
    expect(audio.playCalls).toBe(0);
    expect(player.getSnapshot().status).toBe('idle');
  });

  it('stops automatic audio but keeps audio the visitor started', async () => {
    player.setAutoEnabled(true);
    await player.request(request('poi-click', 'a'));
    player.setAutoEnabled(false);
    expect(player.getSnapshot().status).toBe('idle');

    await player.request(request('manual', 'b'));
    player.setAutoEnabled(true);
    player.setAutoEnabled(false);
    expect(player.getSnapshot().status).toBe('playing');
    expect(player.getSnapshot().active?.poiId).toBe('b');
  });
});

describe('what counts as heard', () => {
  it('needs min(5 s, half the audio) of real playing, or the end', async () => {
    await player.request(request('manual', 'a'));
    audio.currentTime = 4;
    audio.emit('timeupdate');
    expect(history.has('a|vi|v1')).toBe(false);
    audio.currentTime = 5;
    audio.emit('timeupdate');
    expect(history.has('a|vi|v1')).toBe(true);

    audio.duration = 8; // half is 4 s
    await player.request(request('manual', 'b'));
    audio.currentTime = 3.9;
    audio.emit('timeupdate');
    expect(history.has('b|vi|v1')).toBe(false);
    audio.currentTime = 4;
    audio.emit('timeupdate');
    expect(history.has('b|vi|v1')).toBe(true);
  });

  it('does not mark when stopped early, blocked, missing or failed to load', async () => {
    await player.request(request('manual', 'a'));
    audio.currentTime = 2;
    audio.emit('timeupdate');
    player.stop();
    expect(history.has('a|vi|v1')).toBe(false);

    audio.failWith = 'NotAllowedError';
    expect(await player.request(request('manual', 'b'))).toBe('blocked');
    expect(player.getSnapshot().status).toBe('blocked');
    expect(history.has('b|vi|v1')).toBe(false);

    expect(await player.request(request('manual', 'c', async () => null))).toBe(
      'missing',
    );
    expect(
      await player.request(
        request('manual', 'd', async () => {
          throw new Error('network');
        }),
      ),
    ).toBe('error');
    expect(history.size).toBe(0);
  });

  it('a new content version or language can be heard again', async () => {
    player.setAutoEnabled(true);
    history.mark('a|vi|v1');
    expect(
      await player.request(
        request('poi-click', 'a', async () => playable('a', 'v2')),
      ),
    ).toBe('played');
    expect(
      await player.request({
        ...request('poi-click', 'a', async () => playable('a', 'v1', 'en')),
        locale: 'en',
      }),
    ).toBe('played');
  });
});

describe('blocked autoplay', () => {
  it('lets a manual tap play it, without a retry loop', async () => {
    player.setAutoEnabled(true);
    audio.failWith = 'NotAllowedError';
    expect(await player.request(request('poi-click', 'a'))).toBe('blocked');
    expect(audio.playCalls).toBe(1);
    audio.failWith = null;
    expect(await player.retryBlocked()).toBe(true);
    expect(player.getSnapshot().status).toBe('playing');
  });
});

describe('browser voice fallback', () => {
  it('speaks the text, marks it heard after 5 s, and reports an unavailable voice', async () => {
    vi.useFakeTimers();
    const handlers: { onStart(): void; onEnd(): void; onError(): void }[] = [];
    const speech: SpeechLike = {
      speak: (_text, _lang, h) => {
        handlers.push(h);
        return true;
      },
      cancel: vi.fn(),
    };
    const spoken = new NarrationPlayer({
      history,
      createAudio: () => audio,
      speech,
    });
    const text: Playable = {
      ...playable('a'),
      audioUrl: null,
      text: 'xin chào',
    };
    await spoken.request(request('manual', 'a', async () => text));
    handlers[0]!.onStart();
    expect(spoken.getSnapshot().status).toBe('playing');
    vi.advanceTimersByTime(5000);
    expect(history.has('a|vi|v1')).toBe(true);
    handlers[0]!.onEnd();
    expect(spoken.getSnapshot().status).toBe('idle');

    const mute: SpeechLike = { speak: () => false, cancel: () => {} };
    const noVoice = new NarrationPlayer({
      history,
      createAudio: () => audio,
      speech: mute,
    });
    expect(
      await noVoice.request(
        request('manual', 'b', async () => ({
          ...text,
          key: 'b|vi|v1',
          poiId: 'b',
        })),
      ),
    ).toBe('error');
    vi.useRealTimers();
  });
});
