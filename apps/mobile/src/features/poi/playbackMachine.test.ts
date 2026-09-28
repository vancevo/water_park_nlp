import { describe, expect, it } from 'vitest';

import type { AudioEngineStatus } from './audioEngine';
import {
  initialPlaybackState,
  reducePlayback,
  type PlaybackState,
} from './playbackMachine';

function engineStatus(
  overrides: Partial<AudioEngineStatus> = {},
): AudioEngineStatus {
  return {
    isLoaded: true,
    isBuffering: false,
    isPlaying: false,
    didJustFinish: false,
    positionSeconds: 0,
    durationSeconds: 60,
    ...overrides,
  };
}

describe('reducePlayback', () => {
  it('loads without autoplay and becomes ready after the engine loads', () => {
    const loading = reducePlayback(initialPlaybackState, {
      type: 'LOAD',
      durationSeconds: 60,
    });
    expect(loading.status).toBe('loading');

    const ready = reducePlayback(loading, {
      type: 'ENGINE_STATUS',
      status: engineStatus(),
    });
    expect(ready).toEqual({
      status: 'ready',
      positionSeconds: 0,
      durationSeconds: 60,
    });
  });

  it('tracks playback progress and pauses', () => {
    const playing = reducePlayback(initialPlaybackState, {
      type: 'ENGINE_STATUS',
      status: engineStatus({ isPlaying: true, positionSeconds: 12 }),
    });
    const paused = reducePlayback(playing, { type: 'PAUSE' });

    expect(playing).toMatchObject({ status: 'playing', positionSeconds: 12 });
    expect(paused.status).toBe('paused');
  });

  it('clamps seek position to the known duration', () => {
    const state: PlaybackState = {
      status: 'paused',
      positionSeconds: 20,
      durationSeconds: 60,
    };
    expect(
      reducePlayback(state, { type: 'SEEK', positionSeconds: 99 }),
    ).toMatchObject({ status: 'paused', positionSeconds: 60 });
  });

  it('marks completion at the full duration', () => {
    const ended = reducePlayback(initialPlaybackState, {
      type: 'ENGINE_STATUS',
      status: engineStatus({ didJustFinish: true, positionSeconds: 59.8 }),
    });
    expect(ended).toEqual({
      status: 'ended',
      positionSeconds: 60,
      durationSeconds: 60,
    });
  });

  it.each([
    ['EXPIRE', 'expired'],
    ['FAIL', 'error'],
    ['RESET', 'idle'],
  ] as const)('handles %s as %s', (event, status) => {
    expect(reducePlayback(initialPlaybackState, { type: event }).status).toBe(
      status,
    );
  });
});
