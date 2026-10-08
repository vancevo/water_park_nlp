# Dam Sen mobile app

Expo/React Native visitor app for authentication, map, foreground GPS, and navigation sessions.

## Run locally

From the repository root, install workspace dependencies once, then create a native development build:

```bash
npm install
npm run ios --workspace @damsen/mobile
# or
npm run android --workspace @damsen/mobile
```

MapLibre contains native code, so this app does **not** run in Expo Go. Use `expo run:ios`,
`expo run:android`, or an EAS development build. After installing the development build, start Metro with:

```bash
npm run start --workspace @damsen/mobile
```

Copy `apps/mobile/.env.example` to `apps/mobile/.env.local` and set:

- `EXPO_PUBLIC_API_URL`: API origin. An iOS simulator can normally use `localhost`; Android emulator normally uses `10.0.2.2`.
- `EXPO_PUBLIC_MAP_STYLE_URL`: licensed MapLibre-compatible style URL for the selected provider.

The default public demo style is for development only. Provider attribution must remain visible and a production style/license must be configured before release.

## Contract boundary

`src/features/poi/model.ts` defines the narrow `PoiClient` boundary used by the
map. `httpPoiClient.ts` is the real HTTP adapter for `GET /v1/pois`; it contains
no fixture fallback. Auth, narration and routing reuse `@damsen/api-client`.
UI and query hooks remain isolated from transport details through these ports. The mobile
workspace is aligned with Expo SDK 57, React Native 0.86 and Node.js 24.

Authentication reuses `@damsen/api-client`. `SessionManager` owns login, signup,
rotating refresh, logout, and single-flight refresh behavior. Its `SessionStore` boundary is
ready for a native encrypted storage adapter. The current app deliberately uses the ephemeral
memory adapter: credentials are not written to plain storage, but users must sign in again after
an app restart. Wire Expo SecureStore/Keychain in the audited native upgrade before release.

## Narration and signed playback

Opening a POI detail fetches its exact-locale published narration through
`@damsen/api-client`. The transcript remains visible when audio is missing or fails. Audio uses
the Expo SDK 57-compatible `expo-audio` module and never autoplays. Closing the POI or changing
POI/locale unloads the player.

The narration transport treats the locale as any BCP 47 `NarrationLocaleCode` (T25E):
`narrationLocale.ts` canonicalises it (`Intl.getCanonicalLocales`, with a shape-check fallback for
runtimes without it) and `httpNarrationClient` accepts any requested/resolved locale returned by
the API's fallback chain. Per ADR 0006 the prototype adds no narration-language selector: it still
requests the UI locale, so `vi | en` remains only in UI/POI-content code, never in the transport.

The MVP streams the reviewed asset. Its signed playback URL only lives in the active React Query
observer (`gcTime: 0`) and is never written to storage or an offline cache. Expired URLs stop
playback and require a fresh API response. A later offline cache may retain verified audio bytes
by content SHA-256, but must never persist the signed URL beyond its expiry.

## Location/privacy behavior

- Foreground permission is requested only after an explicit user action.
- Samples stay in React state and are rendered locally; this feature does not upload raw GPS.
- The watch policy uses balanced accuracy, a five-second interval, and five-metre movement threshold.
- Permission precision and current signal quality are separate states: denied, approximate, precise, acquiring, weak, ready, or unavailable.

Use the iOS/Android simulator location controls to test precise, weak, missing, and moving GPS scenarios. Unit tests cover deterministic reducer/geometry behavior:

```bash
npm run test --workspace @damsen/mobile
npm run typecheck --workspace @damsen/mobile
```
