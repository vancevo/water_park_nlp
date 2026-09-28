import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import type { SupportedLocale } from '../poi/model';
import type { AuthErrorCode, AuthSnapshot } from './model';

interface Props {
  locale: SupportedLocale;
  state: AuthSnapshot;
  canClose: boolean;
  onClose(): void;
  onContinueAsGuest(): void;
  onLogin(email: string, password: string): Promise<boolean>;
  onRegister(
    email: string,
    password: string,
    locale: SupportedLocale,
  ): Promise<boolean>;
  onLogout(): Promise<void>;
}

type FormMode = 'login' | 'register';

function errorKey(error: AuthErrorCode) {
  return `auth.errors.${error}` as const;
}

export function AuthScreen({
  locale,
  state,
  canClose,
  onClose,
  onContinueAsGuest,
  onLogin,
  onRegister,
  onLogout,
}: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<FormMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  if (state.status === 'restoring') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered} accessibilityRole="progressbar">
          <ActivityIndicator color="#176b3a" size="large" />
          <Text style={styles.helper}>{t('auth.restoring')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (state.status === 'authenticated') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <Text style={styles.eyebrow}>{t('appName')}</Text>
          <Text style={styles.heading}>{t('auth.account')}</Text>
          <Text style={styles.helper}>{state.user.email}</Text>
          {state.isRefreshing ? (
            <Text style={styles.helper}>{t('auth.refreshing')}</Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>{t('auth.backToMap')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => void onLogout()}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>{t('auth.logout')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const busy = state.status === 'authenticating';
  const remoteError = state.status === 'guest' ? state.error : null;

  async function submit() {
    const normalizedEmail = email.trim();
    if (!normalizedEmail.includes('@') || password.length === 0) {
      setValidationError(t('auth.errors.invalid_form'));
      return;
    }
    if (mode === 'register' && password.length < 10) {
      setValidationError(t('auth.errors.password_too_short'));
      return;
    }
    setValidationError(null);
    const succeeded =
      mode === 'login'
        ? await onLogin(normalizedEmail, password)
        : await onRegister(normalizedEmail, password, locale);
    if (succeeded) onClose();
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}
      >
        <View style={styles.content}>
          <Text style={styles.eyebrow}>{t('appName')}</Text>
          <Text style={styles.heading}>
            {t(mode === 'login' ? 'auth.loginTitle' : 'auth.registerTitle')}
          </Text>
          <Text style={styles.helper}>{t('auth.guestExplanation')}</Text>

          <View style={styles.tabs}>
            {(['login', 'register'] as const).map((item) => (
              <Pressable
                key={item}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === item }}
                disabled={busy}
                onPress={() => {
                  setMode(item);
                  setValidationError(null);
                }}
                style={[styles.tab, mode === item && styles.tabSelected]}
              >
                <Text
                  style={[
                    styles.tabText,
                    mode === item && styles.tabTextSelected,
                  ]}
                >
                  {t(item === 'login' ? 'auth.login' : 'auth.register')}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>{t('auth.email')}</Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            editable={!busy}
            keyboardType="email-address"
            onChangeText={setEmail}
            style={styles.input}
            value={email}
          />
          <Text style={styles.label}>{t('auth.password')}</Text>
          <TextInput
            autoCapitalize="none"
            autoComplete={
              mode === 'login' ? 'current-password' : 'new-password'
            }
            editable={!busy}
            onChangeText={setPassword}
            secureTextEntry
            style={styles.input}
            value={password}
          />

          {validationError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {validationError}
            </Text>
          ) : null}
          {remoteError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {t(errorKey(remoteError))}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void submit()}
            style={[styles.primaryButton, busy && styles.disabled]}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>
                {t(mode === 'login' ? 'auth.login' : 'auth.register')}
              </Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              onContinueAsGuest();
              onClose();
            }}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>
              {t('auth.continueAsGuest')}
            </Text>
          </Pressable>
          {canClose ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onClose}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>{t('close')}</Text>
            </Pressable>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f5fbf6' },
  keyboard: { flex: 1 },
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: 16,
    justifyContent: 'center',
  },
  content: { flex: 1, justifyContent: 'center', padding: 28, gap: 12 },
  eyebrow: { color: '#237a45', fontSize: 16, fontWeight: '700' },
  heading: { color: '#14251b', fontSize: 30, fontWeight: '800' },
  helper: { color: '#536159', fontSize: 14, lineHeight: 20 },
  tabs: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  tab: {
    borderColor: '#b8c7bd',
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  tabSelected: { backgroundColor: '#237a45', borderColor: '#237a45' },
  tabText: { color: '#314239', fontWeight: '700' },
  tabTextSelected: { color: '#fff' },
  label: { color: '#14251b', fontSize: 14, fontWeight: '700', marginTop: 4 },
  input: {
    backgroundColor: '#fff',
    borderColor: '#b8c7bd',
    borderRadius: 12,
    borderWidth: 1,
    color: '#14251b',
    fontSize: 16,
    padding: 13,
  },
  error: { color: '#a82c2c', fontSize: 13 },
  primaryButton: {
    backgroundColor: '#176b3a',
    borderRadius: 14,
    marginTop: 10,
    minHeight: 50,
    padding: 15,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  secondaryButton: { padding: 10 },
  secondaryButtonText: {
    color: '#176b3a',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  disabled: { opacity: 0.65 },
});
