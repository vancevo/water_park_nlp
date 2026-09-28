import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import type { NarrationState } from './narrationModel';
import { useNarrationPlayback } from './useNarrationPlayback';

export interface NarrationPlayerProps {
  state: NarrationState;
  onRetry(): void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const rounded = Math.floor(seconds);
  const minutes = Math.floor(rounded / 60);
  return `${minutes}:${String(rounded % 60).padStart(2, '0')}`;
}

export function NarrationPlayer({ state, onRetry }: NarrationPlayerProps) {
  const { t } = useTranslation();
  const audio = state.status === 'ready' ? state.narration.audio : null;
  const playback = useNarrationPlayback(
    audio
      ? {
          url: audio.playbackUrl,
          expiresAt: audio.playbackExpiresAt,
          durationSeconds: audio.durationSeconds,
        }
      : null,
  );

  return (
    <View style={styles.container} accessibilityRole="summary">
      <Text style={styles.label}>{t('narration')}</Text>
      {state.status === 'loading' ? (
        <View style={styles.inline} accessibilityLiveRegion="polite">
          <ActivityIndicator color="#176b3a" />
          <Text style={styles.notice}>{t('narrationLoading')}</Text>
        </View>
      ) : null}
      {state.status === 'unavailable' ? (
        <Text style={styles.notice}>{t('narrationUnavailable')}</Text>
      ) : null}
      {state.status === 'error' ? (
        <ErrorNotice message={t('narrationLoadFailed')} onRetry={onRetry} />
      ) : null}
      {state.status === 'ready' ? (
        <>
          <Text
            accessibilityLabel={t('narrationTranscript')}
            style={styles.transcript}
          >
            {state.narration.transcript}
          </Text>
          {audio ? (
            <View style={styles.controls}>
              <View
                accessibilityRole="progressbar"
                accessibilityValue={{
                  min: 0,
                  max: Math.max(1, playback.state.durationSeconds),
                  now: playback.state.positionSeconds,
                  text: `${formatTime(playback.state.positionSeconds)} / ${formatTime(playback.state.durationSeconds)}`,
                }}
                style={styles.progressTrack}
              >
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.min(
                        100,
                        playback.state.durationSeconds > 0
                          ? (playback.state.positionSeconds /
                              playback.state.durationSeconds) *
                              100
                          : 0,
                      )}%`,
                    },
                  ]}
                />
              </View>
              <Text style={styles.time}>
                {formatTime(playback.state.positionSeconds)} /{' '}
                {formatTime(playback.state.durationSeconds)}
              </Text>
              {playback.state.status === 'expired' ? (
                <ErrorNotice message={t('audioExpired')} onRetry={onRetry} />
              ) : playback.state.status === 'error' ? (
                <ErrorNotice
                  message={t('audioPlaybackFailed')}
                  onRetry={onRetry}
                />
              ) : (
                <View style={styles.buttonRow}>
                  <ControlButton
                    disabled={
                      playback.state.status === 'idle' ||
                      playback.state.status === 'loading'
                    }
                    label={t('seekBackward')}
                    onPress={() => void playback.seekBy(-15)}
                    text="−15s"
                  />
                  <ControlButton
                    disabled={playback.state.status === 'loading'}
                    label={t(
                      playback.state.status === 'playing'
                        ? 'pauseNarration'
                        : 'playNarration',
                    )}
                    onPress={() =>
                      void (playback.state.status === 'playing'
                        ? playback.pause()
                        : playback.play())
                    }
                    text={t(
                      playback.state.status === 'playing'
                        ? 'pauseNarration'
                        : 'playNarration',
                    )}
                  />
                  <ControlButton
                    disabled={
                      playback.state.status === 'idle' ||
                      playback.state.status === 'loading'
                    }
                    label={t('seekForward')}
                    onPress={() => void playback.seekBy(15)}
                    text="+15s"
                  />
                </View>
              )}
            </View>
          ) : (
            <Text style={styles.notice}>{t('audioUnavailable')}</Text>
          )}
        </>
      ) : null}
    </View>
  );
}

function ErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry(): void;
}) {
  const { t } = useTranslation();
  return (
    <View accessibilityRole="alert" style={styles.errorBox}>
      <Text style={styles.error}>{message}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry}>
        <Text style={styles.retry}>{t('retry')}</Text>
      </Pressable>
    </View>
  );
}

function ControlButton({
  disabled,
  label,
  onPress,
  text,
}: {
  disabled: boolean;
  label: string;
  onPress(): void;
  text: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && styles.disabled]}
    >
      <Text style={styles.buttonText}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f2f5f3',
    borderRadius: 10,
    marginTop: 14,
    padding: 12,
  },
  label: { color: '#243d2f', fontWeight: '700' },
  notice: { color: '#5d6c63', marginTop: 5 },
  transcript: { color: '#43534a', lineHeight: 21, marginTop: 9 },
  inline: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  controls: { marginTop: 12 },
  progressTrack: {
    backgroundColor: '#d8e0db',
    borderRadius: 3,
    height: 6,
    overflow: 'hidden',
  },
  progressFill: { backgroundColor: '#176b3a', height: 6 },
  time: { color: '#5d6c63', fontSize: 12, marginTop: 5, textAlign: 'right' },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 9,
  },
  button: {
    backgroundColor: '#e0eee4',
    borderRadius: 10,
    minWidth: 66,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  buttonText: { color: '#176b3a', fontWeight: '700', textAlign: 'center' },
  disabled: { opacity: 0.45 },
  errorBox: { marginTop: 7 },
  error: { color: '#8a302a' },
  retry: { color: '#176b3a', fontWeight: '700', marginTop: 5 },
});
