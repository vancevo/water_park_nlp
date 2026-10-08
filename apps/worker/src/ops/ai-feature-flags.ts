/**
 * AI feature kill-switches (AI08). Independent flags so an operator can disable
 * TTS generation without a redeploy (rollback). Default ON — turning a flag off
 * is the kill switch. Hybrid search has its own flag in the API search module.
 */

export interface AiFeatureFlags {
  ttsGenerationEnabled: boolean;
}

export class AiFeatureDisabledError extends Error {
  readonly code = 'AI_FEATURE_DISABLED';
  constructor(feature: string) {
    super(`AI feature disabled: ${feature}`);
    this.name = 'AiFeatureDisabledError';
  }
}

export function loadAiFeatureFlags(
  env: NodeJS.ProcessEnv = process.env,
): AiFeatureFlags {
  // Default ON; only the explicit string "false" disables generation.
  return {
    ttsGenerationEnabled: env.TTS_GENERATION_ENABLED !== 'false',
  };
}

export function assertTtsGenerationEnabled(flags: AiFeatureFlags): void {
  if (!flags.ttsGenerationEnabled) {
    throw new AiFeatureDisabledError('tts_generation');
  }
}
