import { uiText, type UiLocale } from './ui-text';

export function formatDistance(
  meters?: number,
  locale: UiLocale = 'vi',
): string {
  if (meters === undefined) return uiText(locale).unknownDistance;
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(
  seconds: number,
  locale: UiLocale = 'vi',
): string {
  return uiText(locale).minutes(Math.max(1, Math.round(seconds / 60)));
}

export function categoryLabel(
  category: string,
  locale: UiLocale = 'vi',
): string {
  return uiText(locale).categories[category] ?? category;
}
