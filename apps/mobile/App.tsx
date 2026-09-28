import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';

import './src/i18n';
import i18n from './src/i18n';
import { runtimeConfig } from './src/config/runtime';
import { AuthScreen } from './src/features/auth/AuthScreen';
import { createHttpAuthClient } from './src/features/auth/httpAuthClient';
import { createMemorySessionStore } from './src/features/auth/memorySessionStore';
import { SessionManager } from './src/features/auth/sessionManager';
import { useAuthSession } from './src/features/auth/useAuthSession';
import { useLocationSession } from './src/features/location/useLocationSession';
import { MapScreen } from './src/features/map/MapScreen';
import { createHttpRouteClient } from './src/features/navigation/httpRouteClient';
import { OnboardingScreen } from './src/features/onboarding/OnboardingScreen';
import { createHttpNarrationClient } from './src/features/poi/httpNarrationClient';
import { createHttpPoiClient } from './src/features/poi/httpPoiClient';
import type { SupportedLocale } from './src/features/poi/model';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

function AppContent() {
  const [onboarded, setOnboarded] = useState(false);
  const [authScreenOpen, setAuthScreenOpen] = useState(true);
  const [locale, setLocale] = useState<SupportedLocale>('vi');
  const location = useLocationSession();
  const authManager = useMemo(
    () =>
      new SessionManager(
        createHttpAuthClient(runtimeConfig.apiUrl),
        createMemorySessionStore(),
      ),
    [],
  );
  const auth = useAuthSession(authManager);
  const poiClient = useMemo(
    () => createHttpPoiClient(runtimeConfig.apiUrl),
    [],
  );
  const narrationClient = useMemo(
    () => createHttpNarrationClient(runtimeConfig.apiUrl),
    [],
  );
  const routeClient = useMemo(
    () => createHttpRouteClient(runtimeConfig.apiUrl),
    [],
  );

  function changeLocale(nextLocale: SupportedLocale) {
    setLocale(nextLocale);
    void i18n.changeLanguage(nextLocale);
  }

  if (!onboarded) {
    return (
      <OnboardingScreen
        locale={locale}
        onAllowLocation={location.start}
        onComplete={() => setOnboarded(true)}
        onLocaleChange={changeLocale}
      />
    );
  }

  if (authScreenOpen || auth.state.status === 'restoring') {
    return (
      <AuthScreen
        canClose={auth.state.status === 'authenticated'}
        locale={locale}
        onClose={() => setAuthScreenOpen(false)}
        onContinueAsGuest={auth.continueAsGuest}
        onLogin={auth.login}
        onLogout={async () => {
          await auth.logout();
          setAuthScreenOpen(false);
        }}
        onRegister={auth.register}
        state={auth.state}
      />
    );
  }

  return (
    <MapScreen
      accountLabel={
        auth.state.status === 'authenticated'
          ? auth.state.user.email
          : i18n.t('auth.guest')
      }
      client={poiClient}
      narrationClient={narrationClient}
      routeClient={routeClient}
      locale={locale}
      location={location.state}
      onAccountPress={() => setAuthScreenOpen(true)}
      onRequestLocation={location.start}
    />
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <AppContent />
    </QueryClientProvider>
  );
}
