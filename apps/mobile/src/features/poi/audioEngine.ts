export interface AudioEngineStatus {
  isLoaded: boolean;
  isBuffering: boolean;
  isPlaying: boolean;
  didJustFinish: boolean;
  positionSeconds: number;
  durationSeconds: number;
}

export interface AudioEngine {
  load(
    url: string,
    onStatus: (status: AudioEngineStatus) => void,
  ): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekTo(seconds: number): Promise<void>;
  unload(): Promise<void>;
}

export type AudioEngineFactory = () => AudioEngine;
