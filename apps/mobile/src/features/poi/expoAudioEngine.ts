import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from 'expo-audio';

import type {
  AudioEngine,
  AudioEngineFactory,
  AudioEngineStatus,
} from './audioEngine';

const STATUS_EVENT = 'playbackStatusUpdate';

export const createExpoAudioEngine: AudioEngineFactory = () => {
  let player: AudioPlayer | null = null;
  let subscription: { remove(): void } | null = null;

  function normalizedStatus(): AudioEngineStatus {
    if (!player) {
      return {
        isLoaded: false,
        isBuffering: false,
        isPlaying: false,
        didJustFinish: false,
        positionSeconds: 0,
        durationSeconds: 0,
      };
    }
    const status = player.currentStatus;
    return {
      isLoaded: status.isLoaded,
      isBuffering: status.isBuffering,
      isPlaying: status.playing,
      didJustFinish: status.didJustFinish,
      positionSeconds: status.currentTime,
      durationSeconds: status.duration,
    };
  }

  const engine: AudioEngine = {
    async load(url, onStatus) {
      await engine.unload();
      await setAudioModeAsync({
        interruptionMode: 'doNotMix',
        playsInSilentMode: true,
        shouldPlayInBackground: false,
      });
      player = createAudioPlayer({ uri: url }, { updateInterval: 250 });
      subscription = player.addListener(STATUS_EVENT, () => {
        onStatus(normalizedStatus());
      });
      onStatus(normalizedStatus());
    },
    async play() {
      if (!player) throw new Error('Audio is not loaded');
      player.play();
    },
    async pause() {
      player?.pause();
    },
    async seekTo(seconds) {
      if (!player) throw new Error('Audio is not loaded');
      await player.seekTo(seconds);
    },
    async unload() {
      subscription?.remove();
      subscription = null;
      player?.pause();
      player?.remove();
      player = null;
    },
  };
  return engine;
};
