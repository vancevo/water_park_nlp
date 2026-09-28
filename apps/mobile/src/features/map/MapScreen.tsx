import MapLibreGL, { type CameraRef } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { runtimeConfig } from '../../config/runtime';
import { accuracyCircle } from '../location/geo';
import type { LocationState } from '../location/locationMachine';
import { getLocationNotice } from '../location/locationStatus';
import { NavigationCard } from '../navigation/NavigationCard';
import type { RouteClient } from '../navigation/model';
import { useNavigationSession } from '../navigation/useNavigationSession';
import { findPoiFromMapPress, poisToFeatureCollection } from '../poi/geojson';
import type { NarrationClient } from '../poi/narrationModel';
import { resolveNarrationState } from '../poi/narrationState';
import { resolvePoiDetailState } from '../poi/detailState';
import type { PoiClient, PoiSummary, SupportedLocale } from '../poi/model';
import { usePoiDetail } from '../poi/usePoiDetail';
import { usePoiNarration } from '../poi/usePoiNarration';
import { usePois } from '../poi/usePois';
import { PoiSheet } from './PoiSheet';

const DAM_SEN_CENTER: [number, number] = [106.6358, 10.7682];

interface Props {
  accountLabel: string;
  client: PoiClient;
  narrationClient: NarrationClient;
  routeClient: RouteClient;
  locale: SupportedLocale;
  location: LocationState;
  onAccountPress(): void;
  onRequestLocation(): Promise<void>;
}

function StatusCard({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.statusCard} accessibilityRole="alert">
      <Text style={styles.statusText}>{children}</Text>
    </View>
  );
}

export function MapScreen({
  accountLabel,
  client,
  narrationClient,
  routeClient,
  locale,
  location,
  onAccountPress,
  onRequestLocation,
}: Props) {
  const { t } = useTranslation();
  const query = usePois(client, locale);
  const navigation = useNavigationSession(routeClient, location);
  const [selected, setSelected] = useState<PoiSummary | null>(null);
  const [detailed, setDetailed] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [followLocation, setFollowLocation] = useState(false);
  const camera = useRef<CameraRef>(null);
  const pois = query.data?.items ?? [];
  const detailQuery = usePoiDetail(
    client,
    selected?.id ?? null,
    locale,
    detailed,
  );
  const detailState = resolvePoiDetailState({
    detailed,
    isPending: detailQuery.isPending,
    isError: detailQuery.isError,
    data: detailQuery.data,
  });
  const narrationQuery = usePoiNarration(
    narrationClient,
    selected?.id ?? null,
    locale,
    detailed,
  );
  const narrationState = resolveNarrationState({
    enabled: detailed && selected !== null,
    isPending: narrationQuery.isPending,
    error: narrationQuery.error,
    data: narrationQuery.data,
  });
  const poiGeoJson = useMemo(() => poisToFeatureCollection(pois), [pois]);
  const sample = location.sample;
  const accuracyGeoJson = useMemo(
    () =>
      sample
        ? accuracyCircle(
            sample.latitude,
            sample.longitude,
            sample.accuracyMeters,
          )
        : null,
    [sample],
  );

  useEffect(() => {
    if (!followLocation || !sample) return;
    camera.current?.setCamera({
      animationDuration: 600,
      animationMode: 'easeTo',
      centerCoordinate: [sample.longitude, sample.latitude],
      zoomLevel: 16,
    });
  }, [followLocation, sample]);

  function choosePoi(poi: PoiSummary) {
    setSelected(poi);
    setDetailed(false);
  }

  const locationNotice = getLocationNotice(location);
  const gpsMessage = locationNotice
    ? t(
        locationNotice.key,
        'meters' in locationNotice ? { meters: locationNotice.meters } : {},
      )
    : null;

  return (
    <View style={styles.container}>
      <MapLibreGL.MapView
        attributionEnabled
        attributionPosition={{ right: 8, top: 8 }}
        compassEnabled
        logoPosition={{ right: 8, top: 42 }}
        onDidFailLoadingMap={() => setMapFailed(true)}
        onDidFinishLoadingMap={() => setMapLoaded(true)}
        onRegionDidChange={(feature) => {
          if (feature.properties.isUserInteraction) setFollowLocation(false);
        }}
        style={styles.map}
        mapStyle={runtimeConfig.mapStyleUrl}
      >
        <MapLibreGL.Camera
          ref={camera}
          defaultSettings={{ centerCoordinate: DAM_SEN_CENTER, zoomLevel: 16 }}
        />

        <MapLibreGL.ShapeSource
          id="pois"
          cluster
          clusterRadius={42}
          onPress={(event) => {
            const poi = findPoiFromMapPress(pois, event.features[0]);
            if (poi) choosePoi(poi);
          }}
          shape={poiGeoJson}
        >
          <MapLibreGL.CircleLayer
            id="poi-clusters"
            filter={['has', 'point_count']}
            style={{
              circleColor: '#176b3a',
              circleRadius: 20,
              circleStrokeColor: '#fff',
              circleStrokeWidth: 2,
            }}
          />
          <MapLibreGL.SymbolLayer
            id="poi-cluster-count"
            filter={['has', 'point_count']}
            style={{
              textColor: '#fff',
              textField: ['get', 'point_count_abbreviated'],
              textSize: 13,
            }}
          />
          <MapLibreGL.CircleLayer
            id="poi-points"
            filter={['!', ['has', 'point_count']]}
            style={{
              circleColor: '#ef8a30',
              circleRadius: 9,
              circleStrokeColor: '#fff',
              circleStrokeWidth: 3,
            }}
          />
        </MapLibreGL.ShapeSource>

        {navigation.state.route ? (
          <MapLibreGL.ShapeSource
            id="navigation-route"
            shape={navigation.state.route.geometry}
          >
            <MapLibreGL.LineLayer
              id="navigation-route-line"
              style={{
                lineCap: 'round',
                lineColor: '#2774d8',
                lineJoin: 'round',
                lineOpacity: 0.9,
                lineWidth: 6,
              }}
            />
          </MapLibreGL.ShapeSource>
        ) : null}

        {sample && accuracyGeoJson ? (
          <>
            <MapLibreGL.ShapeSource id="user-accuracy" shape={accuracyGeoJson}>
              <MapLibreGL.FillLayer
                id="user-accuracy-fill"
                style={{ fillColor: '#2774d8', fillOpacity: 0.14 }}
              />
            </MapLibreGL.ShapeSource>
            <MapLibreGL.PointAnnotation
              id="user-position"
              coordinate={[sample.longitude, sample.latitude]}
            >
              <View style={styles.userDot} />
            </MapLibreGL.PointAnnotation>
          </>
        ) : null}
      </MapLibreGL.MapView>

      <SafeAreaView pointerEvents="box-none" style={styles.overlay}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('appName')}</Text>
          <Text style={styles.attribution}>{t('mapAttribution')}</Text>
        </View>
        <Pressable
          accessibilityLabel={t('auth.openAccount')}
          accessibilityRole="button"
          onPress={onAccountPress}
          style={styles.accountButton}
        >
          <Text numberOfLines={1} style={styles.accountButtonText}>
            {accountLabel}
          </Text>
        </Pressable>

        {!mapLoaded && !mapFailed ? (
          <StatusCard>{t('mapLoading')}</StatusCard>
        ) : null}
        {mapFailed ? <StatusCard>{t('mapFailed')}</StatusCard> : null}
        {gpsMessage ? <StatusCard>{gpsMessage}</StatusCard> : null}
        {navigation.state.status !== 'idle' ? (
          <NavigationCard state={navigation.state} onStop={navigation.stop} />
        ) : null}
        {location.permission === 'denied' ||
        location.permission === 'unknown' ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void onRequestLocation()}
            style={styles.locationButton}
          >
            <Text style={styles.locationButtonText}>{t('allowLocation')}</Text>
          </Pressable>
        ) : null}
        {sample ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: followLocation }}
            onPress={() => setFollowLocation((current) => !current)}
            style={styles.followButton}
          >
            <Text style={styles.locationButtonText}>
              {t(followLocation ? 'stopFollowing' : 'followLocation')}
            </Text>
          </Pressable>
        ) : null}

        <View
          style={[
            styles.poiRail,
            navigation.state.status !== 'idle' && styles.hidden,
          ]}
        >
          <Text style={styles.poiRailTitle}>{t('places')}</Text>
          {query.isPending ? (
            <Text style={styles.railMessage}>{t('loadingPlaces')}</Text>
          ) : null}
          {query.isError ? (
            <View style={styles.inlineRow}>
              <Text style={styles.railMessage}>{t('loadFailed')}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void query.refetch()}
              >
                <Text style={styles.retry}>{t('retry')}</Text>
              </Pressable>
            </View>
          ) : null}
          {query.isSuccess && pois.length === 0 ? (
            <Text style={styles.railMessage}>{t('noPlaces')}</Text>
          ) : null}
          {pois.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {pois.map((poi) => (
                <Pressable
                  key={poi.id}
                  accessibilityLabel={`${poi.name}${poi.categoryName ? `, ${poi.categoryName}` : ''}`}
                  accessibilityRole="button"
                  onPress={() => choosePoi(poi)}
                  style={styles.poiChip}
                >
                  <Text numberOfLines={1} style={styles.poiChipText}>
                    {poi.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
        </View>
      </SafeAreaView>

      {selected ? (
        <PoiSheet
          detailState={detailState}
          detailed={detailed}
          narrationState={narrationState}
          onClose={() => setSelected(null)}
          onNavigate={() => {
            setSelected(null);
            void navigation.start(selected.id);
          }}
          onRetryDetails={() => void detailQuery.refetch()}
          onRetryNarration={() => void narrationQuery.refetch()}
          onShowDetails={() => setDetailed(true)}
          poi={selected}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFill, paddingHorizontal: 14 },
  header: {
    alignSelf: 'flex-start',
    backgroundColor: '#fffffff2',
    borderRadius: 14,
    marginTop: 10,
    padding: 12,
  },
  title: { color: '#15251c', fontSize: 19, fontWeight: '800' },
  attribution: { color: '#66736b', fontSize: 10, marginTop: 2 },
  accountButton: {
    alignSelf: 'flex-end',
    backgroundColor: '#fff',
    borderRadius: 18,
    elevation: 2,
    marginTop: -42,
    maxWidth: 170,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  accountButtonText: { color: '#176b3a', fontSize: 12, fontWeight: '700' },
  statusCard: {
    alignSelf: 'center',
    backgroundColor: '#15251ce8',
    borderRadius: 10,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  statusText: { color: '#fff', fontSize: 13 },
  locationButton: {
    alignSelf: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    elevation: 2,
    marginTop: 8,
    padding: 10,
  },
  locationButtonText: { color: '#176b3a', fontWeight: '700' },
  followButton: {
    alignSelf: 'flex-end',
    backgroundColor: '#fff',
    borderRadius: 10,
    elevation: 2,
    marginTop: 8,
    padding: 10,
  },
  poiRail: {
    backgroundColor: '#fffffff2',
    borderRadius: 16,
    bottom: 18,
    left: 14,
    padding: 12,
    position: 'absolute',
    right: 14,
  },
  poiRailTitle: {
    color: '#15251c',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 8,
  },
  railMessage: { color: '#536159', fontSize: 13 },
  inlineRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  retry: { color: '#176b3a', fontWeight: '800' },
  poiChip: {
    backgroundColor: '#e4f2e8',
    borderRadius: 18,
    marginRight: 8,
    maxWidth: 190,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  poiChipText: { color: '#19482c', fontWeight: '700' },
  userDot: {
    backgroundColor: '#2774d8',
    borderColor: '#fff',
    borderRadius: 10,
    borderWidth: 3,
    height: 20,
    width: 20,
  },
  hidden: { display: 'none' },
});
