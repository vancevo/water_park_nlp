import type {
  NarrationLocaleCode,
  PublicNarrationAudioProvenance,
} from '@damsen/shared-types';

const AI_AUDIO_LABELS: Record<string, string> = {
  vi: 'Giọng đọc do AI tạo',
  en: 'AI-generated voice',
};

/**
 * Visitor-facing label for audio produced by a TTS job (contract v1.2
 * `audio.generatedBy`). Returns null for editor-uploaded audio so no label is
 * shown. The text follows the audio's language; unknown locales use English.
 */
export function aiAudioLabel(
  locale: NarrationLocaleCode,
  generatedBy: PublicNarrationAudioProvenance | undefined,
): { text: string; lang: string; detail: string } | null {
  if (!generatedBy) return null;
  const base = locale.split('-')[0]?.toLowerCase() ?? '';
  const text = AI_AUDIO_LABELS[base];
  return {
    text: text ?? 'AI-generated voice',
    lang: text ? base : 'en',
    detail: `${generatedBy.provider} · ${generatedBy.model} ${generatedBy.modelVersion}`,
  };
}
