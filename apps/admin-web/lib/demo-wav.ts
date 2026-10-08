/**
 * Builds a short synthetic 16-bit mono PCM WAV tone for demo previews, so the
 * fixture TTS flow can be heard without shipping audio files in Git. It is not
 * speech and is labelled as a demo wherever it is played.
 */
export function createDemoToneWav(
  seconds = 1.2,
  frequency = 440,
  sampleRate = 16_000,
): Uint8Array {
  const samples = Math.max(1, Math.round(seconds * sampleRate));
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) =>
    [...text].forEach((char, index) =>
      view.setUint8(offset + index, char.charCodeAt(0)),
    );
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples * 2, true);
  const fade = Math.min(samples / 2, sampleRate * 0.05);
  for (let index = 0; index < samples; index += 1) {
    const envelope = Math.min(1, index / fade, (samples - index) / fade);
    const value =
      Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.3 * envelope;
    view.setInt16(44 + index * 2, Math.round(value * 32_767), true);
  }
  return bytes;
}
