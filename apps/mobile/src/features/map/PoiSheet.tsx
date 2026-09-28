import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { NarrationPlayer } from '../poi/NarrationPlayer';
import type { PoiDetailState } from '../poi/detailState';
import type { NarrationState } from '../poi/narrationModel';
import type { PoiSummary } from '../poi/model';

interface Props {
  poi: PoiSummary;
  detailed: boolean;
  detailState: PoiDetailState;
  narrationState: NarrationState;
  onShowDetails(): void;
  onRetryDetails(): void;
  onRetryNarration(): void;
  onClose(): void;
  onNavigate(): void;
}

export function PoiSheet({
  poi,
  detailed,
  detailState,
  narrationState,
  onShowDetails,
  onRetryDetails,
  onRetryNarration,
  onClose,
  onNavigate,
}: Props) {
  const { t } = useTranslation();
  const status =
    poi.isOpen == null ? null : poi.isOpen ? t('open') : t('closed');

  return (
    <View
      style={[styles.sheet, detailed && styles.detailSheet]}
      accessibilityViewIsModal={detailed}
    >
      <View style={styles.handle} />
      {detailed && poi.imageUrl ? (
        <Image
          source={{ uri: poi.imageUrl }}
          accessibilityLabel={poi.name}
          style={styles.image}
        />
      ) : null}
      <ScrollView>
        <Text style={styles.category}>{poi.categoryName}</Text>
        <Text style={styles.title}>{poi.name}</Text>
        {status ? (
          <Text style={poi.isOpen ? styles.open : styles.closed}>{status}</Text>
        ) : null}
        {!detailed && poi.description ? (
          <Text style={styles.description}>{poi.description}</Text>
        ) : null}
        {detailState.status === 'loading' ? (
          <Text accessibilityLiveRegion="polite" style={styles.notice}>
            {t('loadingDetails')}
          </Text>
        ) : null}
        {detailState.status === 'error' ? (
          <View accessibilityRole="alert" style={styles.errorBox}>
            <Text style={styles.errorText}>{t('detailLoadFailed')}</Text>
            <Pressable accessibilityRole="button" onPress={onRetryDetails}>
              <Text style={styles.retryText}>{t('retry')}</Text>
            </Pressable>
          </View>
        ) : null}
        {detailState.status === 'ready' ? (
          <PoiDetailContent
            detail={detailState.detail}
            narrationState={narrationState}
            onRetryNarration={onRetryNarration}
          />
        ) : null}
      </ScrollView>
      <View style={styles.actions}>
        {detailed ? (
          <Pressable
            accessibilityLabel={`${t('navigate')}: ${poi.name}`}
            accessibilityRole="button"
            onPress={onNavigate}
            style={styles.primary}
          >
            <Text style={styles.primaryText}>{t('navigate')}</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={onShowDetails}
            style={styles.primary}
          >
            <Text style={styles.primaryText}>{t('details')}</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={styles.secondary}
        >
          <Text style={styles.secondaryText}>{t('close')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function PoiDetailContent({
  detail,
  narrationState,
  onRetryNarration,
}: {
  detail: Extract<PoiDetailState, { status: 'ready' }>['detail'];
  narrationState: NarrationState;
  onRetryNarration(): void;
}) {
  const { t } = useTranslation();
  const entrances = [...detail.entrances].sort(
    (left, right) => Number(right.isPrimary) - Number(left.isPrimary),
  );
  const hours = [...detail.operatingHours].sort(
    (left, right) => left.dayOfWeek - right.dayOfWeek,
  );

  return (
    <View>
      {detail.fallbackUsed ? (
        <Text accessibilityRole="alert" style={styles.fallbackNotice}>
          {t('localeFallback', {
            language: t(`languageName.${detail.resolvedLocale}`),
          })}
        </Text>
      ) : null}
      <Text style={styles.description}>{detail.longDescription}</Text>
      <Text style={styles.sectionTitle}>{t('entrances')}</Text>
      {entrances.length > 0 ? (
        entrances.map((entrance) => (
          <View key={entrance.id} style={styles.detailRow}>
            <Text style={styles.detailLabel}>
              {entrance.label}
              {entrance.isPrimary ? ` · ${t('primaryEntrance')}` : ''}
            </Text>
            <Text style={styles.detailValue}>
              {t(`entranceAccessibility.${entrance.accessibility}`)}
            </Text>
          </View>
        ))
      ) : (
        <Text style={styles.notice}>{t('entranceUnavailable')}</Text>
      )}
      <Text style={styles.sectionTitle}>{t('operatingHours')}</Text>
      {hours.length > 0 ? (
        hours.map((item) => (
          <View key={item.dayOfWeek} style={styles.hoursRow}>
            <Text style={styles.detailLabel}>
              {t(`weekdays.${item.dayOfWeek}`)}
            </Text>
            <Text style={styles.detailValue}>
              {item.opensAt}–{item.closesAt}
            </Text>
          </View>
        ))
      ) : (
        <Text style={styles.notice}>{t('hoursUnavailable')}</Text>
      )}
      <NarrationPlayer state={narrationState} onRetry={onRetryNarration} />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    bottom: 0,
    elevation: 10,
    left: 0,
    maxHeight: '42%',
    padding: 18,
    position: 'absolute',
    right: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
  },
  detailSheet: { maxHeight: '75%' },
  handle: {
    alignSelf: 'center',
    backgroundColor: '#c5cec8',
    borderRadius: 2,
    height: 4,
    marginBottom: 14,
    width: 42,
  },
  image: { borderRadius: 14, height: 150, marginBottom: 14, width: '100%' },
  category: { color: '#237a45', fontSize: 13, fontWeight: '700' },
  title: { color: '#15251c', fontSize: 23, fontWeight: '800', marginTop: 3 },
  open: { color: '#237a45', marginTop: 5 },
  closed: { color: '#a33d36', marginTop: 5 },
  description: {
    color: '#43534a',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
  },
  notice: { color: '#5d6c63', marginTop: 12 },
  fallbackNotice: {
    backgroundColor: '#fff5d9',
    borderRadius: 8,
    color: '#705318',
    marginTop: 12,
    padding: 10,
  },
  errorBox: {
    backgroundColor: '#fff1ef',
    borderRadius: 8,
    marginTop: 12,
    padding: 10,
  },
  errorText: { color: '#8a302a' },
  retryText: { color: '#176b3a', fontWeight: '700', marginTop: 6 },
  sectionTitle: {
    color: '#243d2f',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 18,
  },
  detailRow: { marginTop: 8 },
  hoursRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 7,
  },
  detailLabel: { color: '#344a3d', fontWeight: '600' },
  detailValue: { color: '#5d6c63', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  primary: {
    backgroundColor: '#176b3a',
    borderRadius: 12,
    flex: 1,
    padding: 13,
  },
  primaryText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  secondary: {
    borderColor: '#9eaaa2',
    borderRadius: 12,
    borderWidth: 1,
    padding: 13,
  },
  secondaryText: { color: '#314239', fontWeight: '600' },
});
