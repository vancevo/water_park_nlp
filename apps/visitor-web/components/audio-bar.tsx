'use client';

import type { ActivePlayback } from '@/lib/narration-player';
import type { UiText } from '@/lib/ui-text';

/**
 * Which place is being narrated, for screen readers only: nothing is drawn over the map.
 * Playback is controlled from the place card (Listen / Pause / Stop).
 */
export function AudioBar({
  t,
  active,
}: {
  t: UiText;
  active: ActivePlayback | null;
}) {
  if (!active) return null;
  return (
    <div className="sr-only" role="status" aria-label={t.audioBarLabel}>
      <span className="audio-bar-title">
        {t.audioBarState(active.status, active.poiName)}
      </span>
    </div>
  );
}
