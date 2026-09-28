import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { NavigationState } from './navigationMachine';

interface Props {
  state: NavigationState;
  onStop(): void;
}

function formatDistance(meters: number): string {
  if (meters >= 1_000) return `${(meters / 1_000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function formatEta(seconds: number): string {
  return `${Math.max(1, Math.ceil(seconds / 60))} min`;
}

export function NavigationCard({ state, onStop }: Props) {
  const { t } = useTranslation();
  const remaining = state.match?.remainingMeters ?? state.route?.distanceMeters;
  const eta =
    state.route && remaining != null && state.route.distanceMeters > 0
      ? state.route.etaSeconds * (remaining / state.route.distanceMeters)
      : state.route?.etaSeconds;
  const instruction =
    state.route?.steps[state.match?.stepIndex ?? 0]?.instruction;

  return (
    <View style={styles.card} accessibilityRole="summary">
      <Text style={styles.status}>{t(`navigation.${state.status}`)}</Text>
      {remaining != null && eta != null ? (
        <Text style={styles.metrics}>
          {formatDistance(remaining)} · {formatEta(eta)}
        </Text>
      ) : null}
      {instruction && state.status !== 'arrived' ? (
        <Text style={styles.instruction}>{instruction}</Text>
      ) : null}
      {state.gpsSuppressed ? (
        <Text style={styles.warning}>{t('navigation.gpsSuppressed')}</Text>
      ) : null}
      {state.status === 'error' ? (
        <Text style={styles.warning}>{t('navigation.routeFailed')}</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={onStop}
        style={styles.stop}
      >
        <Text style={styles.stopText}>{t('navigation.stop')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'center',
    backgroundColor: '#fffffff5',
    borderRadius: 16,
    elevation: 4,
    marginTop: 8,
    maxWidth: 340,
    padding: 14,
    width: '94%',
  },
  status: { color: '#176b3a', fontSize: 13, fontWeight: '800' },
  metrics: { color: '#15251c', fontSize: 22, fontWeight: '800', marginTop: 3 },
  instruction: { color: '#43534a', fontSize: 15, marginTop: 6 },
  warning: { color: '#a05b16', fontSize: 13, marginTop: 5 },
  stop: { alignSelf: 'flex-end', marginTop: 7, padding: 5 },
  stopText: { color: '#8c332d', fontWeight: '700' },
});
