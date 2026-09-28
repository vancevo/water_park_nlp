import { useCallback, useEffect, useReducer, useRef } from 'react';

import type { AudioEngine, AudioEngineFactory } from './audioEngine';
import { createExpoAudioEngine } from './expoAudioEngine';
import { initialPlaybackState, reducePlayback } from './playbackMachine';

export interface PlaybackSource {
  url: string;
  expiresAt: string;
  durationSeconds: number;
}

export function useNarrationPlayback(
  source: PlaybackSource | null,
  engineFactory: AudioEngineFactory = createExpoAudioEngine,
  now: () => number = Date.now,
) {
  const [state, dispatch] = useReducer(reducePlayback, initialPlaybackState);
  const engineRef = useRef<AudioEngine | null>(null);
  if (engineRef.current === null) engineRef.current = engineFactory();

  useEffect(() => {
    const engine = engineRef.current!;
    if (!source) {
      dispatch({ type: 'RESET' });
      void engine.unload();
      return;
    }

    const expiresAt = Date.parse(source.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now()) {
      dispatch({ type: 'EXPIRE' });
      void engine.unload();
      return;
    }

    let active = true;
    dispatch({ type: 'LOAD', durationSeconds: source.durationSeconds });
    void engine
      .load(source.url, (status) => {
        if (active) dispatch({ type: 'ENGINE_STATUS', status });
      })
      .catch(() => {
        if (active) dispatch({ type: 'FAIL' });
      });

    const expiryDelay = Math.min(expiresAt - now(), 2_147_483_647);
    const expiryTimer = setTimeout(() => {
      if (!active) return;
      dispatch({ type: 'EXPIRE' });
      void engine.unload();
    }, expiryDelay);

    return () => {
      active = false;
      clearTimeout(expiryTimer);
      void engine.unload();
    };
  }, [now, source?.durationSeconds, source?.expiresAt, source?.url]);

  const play = useCallback(async () => {
    if (!source) return;
    const expiresAt = Date.parse(source.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now()) {
      dispatch({ type: 'EXPIRE' });
      await engineRef.current?.unload();
      return;
    }
    try {
      if (state.status === 'ended') {
        await engineRef.current?.seekTo(0);
        dispatch({ type: 'SEEK', positionSeconds: 0 });
      }
      await engineRef.current?.play();
      dispatch({ type: 'PLAY' });
    } catch {
      dispatch({ type: 'FAIL' });
    }
  }, [now, source, state.status]);

  const pause = useCallback(async () => {
    try {
      await engineRef.current?.pause();
      dispatch({ type: 'PAUSE' });
    } catch {
      dispatch({ type: 'FAIL' });
    }
  }, []);

  const seekBy = useCallback(
    async (deltaSeconds: number) => {
      const positionSeconds = Math.max(
        0,
        Math.min(
          state.positionSeconds + deltaSeconds,
          state.durationSeconds || Number.POSITIVE_INFINITY,
        ),
      );
      try {
        await engineRef.current?.seekTo(positionSeconds);
        dispatch({ type: 'SEEK', positionSeconds });
      } catch {
        dispatch({ type: 'FAIL' });
      }
    },
    [state.durationSeconds, state.positionSeconds],
  );

  return { state, play, pause, seekBy };
}
