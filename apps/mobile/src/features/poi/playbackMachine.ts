import type { AudioEngineStatus } from './audioEngine';

export type PlaybackStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'expired'
  | 'error';

export interface PlaybackState {
  status: PlaybackStatus;
  positionSeconds: number;
  durationSeconds: number;
}

export type PlaybackEvent =
  | { type: 'LOAD'; durationSeconds: number }
  | { type: 'ENGINE_STATUS'; status: AudioEngineStatus }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'SEEK'; positionSeconds: number }
  | { type: 'EXPIRE' }
  | { type: 'FAIL' }
  | { type: 'RESET' };

export const initialPlaybackState: PlaybackState = {
  status: 'idle',
  positionSeconds: 0,
  durationSeconds: 0,
};

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function reducePlayback(
  state: PlaybackState,
  event: PlaybackEvent,
): PlaybackState {
  switch (event.type) {
    case 'LOAD':
      return {
        status: 'loading',
        positionSeconds: 0,
        durationSeconds: finiteNonNegative(event.durationSeconds),
      };
    case 'ENGINE_STATUS': {
      const durationSeconds =
        finiteNonNegative(event.status.durationSeconds) ||
        state.durationSeconds;
      const positionSeconds = Math.min(
        finiteNonNegative(event.status.positionSeconds),
        durationSeconds || Number.POSITIVE_INFINITY,
      );
      if (event.status.didJustFinish) {
        return {
          status: 'ended',
          positionSeconds: durationSeconds,
          durationSeconds,
        };
      }
      if (event.status.isPlaying) {
        return { status: 'playing', positionSeconds, durationSeconds };
      }
      if (event.status.isBuffering || !event.status.isLoaded) {
        return { status: 'loading', positionSeconds, durationSeconds };
      }
      return {
        status:
          state.status === 'paused' || state.status === 'ended'
            ? state.status
            : 'ready',
        positionSeconds,
        durationSeconds,
      };
    }
    case 'PLAY':
      return { ...state, status: 'playing' };
    case 'PAUSE':
      return { ...state, status: 'paused' };
    case 'SEEK':
      return {
        ...state,
        status: state.status === 'ended' ? 'paused' : state.status,
        positionSeconds: Math.min(
          finiteNonNegative(event.positionSeconds),
          state.durationSeconds || Number.POSITIVE_INFINITY,
        ),
      };
    case 'EXPIRE':
      return { ...state, status: 'expired' };
    case 'FAIL':
      return { ...state, status: 'error' };
    case 'RESET':
      return initialPlaybackState;
  }
}
