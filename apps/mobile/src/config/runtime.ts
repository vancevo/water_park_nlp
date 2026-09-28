const DEFAULT_API_URL = 'http://localhost:3000';
const DEFAULT_MAP_STYLE = 'https://demotiles.maplibre.org/style.json';

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export const runtimeConfig = {
  apiUrl: withoutTrailingSlash(
    process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL,
  ),
  mapStyleUrl: process.env.EXPO_PUBLIC_MAP_STYLE_URL ?? DEFAULT_MAP_STYLE,
} as const;
