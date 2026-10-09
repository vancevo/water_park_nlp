/**
 * Minimal RIFF/WAVE reader: enough to validate a PCM WAV and compute its
 * duration/sample rate for the TTS artifact. Not a general WAV decoder.
 */

export interface WavInfo {
  sampleRateHz: number;
  channels: number;
  bitsPerSample: number;
  durationSeconds: number;
}

export class WavParseError extends Error {
  /** A provider that exits 0 but writes no valid WAV produced invalid audio (I04). */
  readonly code = 'TTS_AUDIO_INVALID';
  constructor(message: string) {
    super(`wav parse: ${message}`);
    this.name = 'WavParseError';
  }
}

function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/** Parse the `fmt ` and `data` chunks of a PCM WAV container. */
export function parseWav(audio: Uint8Array): WavInfo {
  if (
    audio.length < 12 ||
    !ascii(audio, 0, 'RIFF') ||
    !ascii(audio, 8, 'WAVE')
  ) {
    throw new WavParseError('not a RIFF/WAVE container');
  }
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);

  let sampleRateHz = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataBytes = 0;
  let fmtSeen = false;

  let offset = 12;
  while (offset + 8 <= audio.length) {
    const id = String.fromCharCode(
      audio[offset]!,
      audio[offset + 1]!,
      audio[offset + 2]!,
      audio[offset + 3]!,
    );
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (body + 16 > audio.length)
        throw new WavParseError('truncated fmt chunk');
      channels = view.getUint16(body + 2, true);
      sampleRateHz = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
      fmtSeen = true;
    } else if (id === 'data') {
      dataBytes = Math.min(size, audio.length - body);
    }
    // Chunks are word-aligned (padded to even length).
    offset = body + size + (size % 2);
  }

  if (!fmtSeen) throw new WavParseError('missing fmt chunk');
  if (sampleRateHz <= 0 || channels <= 0 || bitsPerSample <= 0) {
    throw new WavParseError('invalid fmt values');
  }
  const bytesPerSecond = (sampleRateHz * channels * bitsPerSample) / 8;
  const durationSeconds = bytesPerSecond > 0 ? dataBytes / bytesPerSecond : 0;

  return { sampleRateHz, channels, bitsPerSample, durationSeconds };
}
