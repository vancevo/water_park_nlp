import { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { SupportedLocale } from '../poi/model';

interface Props {
  locale: SupportedLocale;
  onLocaleChange(locale: SupportedLocale): void;
  onAllowLocation(): Promise<void>;
  onComplete(): void;
}

export function OnboardingScreen({
  locale,
  onLocaleChange,
  onAllowLocation,
  onComplete,
}: Props) {
  const { t } = useTranslation();
  const [requesting, setRequesting] = useState(false);

  async function allowAndContinue() {
    setRequesting(true);
    await onAllowLocation();
    setRequesting(false);
    onComplete();
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>{t('appName')}</Text>
        <Text style={styles.heading}>{t('locationTitle')}</Text>
        <Text style={styles.body}>{t('locationPurpose')}</Text>

        <Text style={styles.label}>{t('chooseLanguage')}</Text>
        <View style={styles.languages} accessibilityRole="radiogroup">
          {(['vi', 'en'] as const).map((item) => (
            <Pressable
              key={item}
              accessibilityRole="radio"
              accessibilityState={{ checked: locale === item }}
              onPress={() => onLocaleChange(item)}
              style={[
                styles.language,
                locale === item && styles.languageSelected,
              ]}
            >
              <Text
                style={
                  locale === item
                    ? styles.languageTextSelected
                    : styles.languageText
                }
              >
                {item === 'vi' ? 'Tiếng Việt' : 'English'}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={requesting}
          onPress={() => void allowAndContinue()}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>{t('allowLocation')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onComplete}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>
            {t('continueWithoutLocation')}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f5fbf6' },
  content: { flex: 1, justifyContent: 'center', padding: 28, gap: 18 },
  eyebrow: { color: '#237a45', fontSize: 16, fontWeight: '700' },
  heading: {
    color: '#14251b',
    fontSize: 32,
    fontWeight: '800',
    lineHeight: 38,
  },
  body: { color: '#43534a', fontSize: 16, lineHeight: 24 },
  label: { color: '#14251b', fontSize: 15, fontWeight: '700', marginTop: 8 },
  languages: { flexDirection: 'row', gap: 10 },
  language: {
    borderColor: '#b8c7bd',
    borderRadius: 20,
    borderWidth: 1,
    padding: 12,
  },
  languageSelected: { backgroundColor: '#237a45', borderColor: '#237a45' },
  languageText: { color: '#314239' },
  languageTextSelected: { color: '#fff', fontWeight: '700' },
  primaryButton: {
    backgroundColor: '#176b3a',
    borderRadius: 14,
    marginTop: 14,
    padding: 16,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  secondaryButton: { padding: 12 },
  secondaryButtonText: {
    color: '#176b3a',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
});
