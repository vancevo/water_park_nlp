# ADR 0007 — Configurable narration locales via a validated config file

- Status: Accepted (C02 / T25A–T25B backend)
- Date: 2026-09-30
- Deciders: Công (backend), coordinator
- Related: `docs/plans/CONFIGURABLE_MULTILINGUAL_NARRATION_PLAN.md`,
  `docs/plans/CONG_TU_WORK_SPLIT.md`, ADR 0004, ADR 0006

## Context

Narration locales were hard-coded to `vi | en` in several independent places:
the `SupportedLocale` union, narration and media DTOs, the SQL
`CHECK (locale IN ('vi','en'))`, the media object-key regex and the client UI
tabs. Adding a language meant editing all of them at once, which is error-prone
and blocks non-engineers from configuring content languages.

We want to add, disable and reorder **narration** languages by configuration and
redeploy only. Interface and POI-content languages stay `vi | en` (ADR 0006,
web-first visitor client); this ADR does not widen them.

## Decision

1. **The API is the runtime source of truth.** It reads one validated JSON file,
   default `config/narration-locales.json`, overridable with
   `NARRATION_LOCALES_CONFIG_PATH`. The file must always contain enabled `vi` and
   `en` for backward compatibility. Secrets, audio URLs and transcripts never
   live in this file.
2. **Config shape.** `{ defaultLocale, locales: [{ code, nativeLabel, speechTag,
   enabled, fallbackLocale }] }`. Validation (in `packages/config`): codes are
   canonicalised with `Intl.getCanonicalLocales` (no hand-rolled BCP 47 parser),
   at most 35 chars and unique; `defaultLocale` must be enabled; `fallbackLocale`
   must exist, be enabled, not point to itself and not form a cycle. Invalid
   config throws at API startup — the service fails fast instead of serving a
   broken catalog. Declared order is the display order.
3. **`NarrationLocaleCode` is a distinct `string` type**, not a reuse of
   `SupportedLocale`. The public catalog is served by `GET /v1/narration-locales`
   (enabled locales only, configured order, no filesystem details).
4. **Database (migration 009, additive).** `poi_narrations.locale` widens from
   `varchar(5)` to `varchar(35)`; the `vi/en` allow-list is replaced by a minimal
   BCP 47 form check. The `(poi_id, locale, revision)` unique key and the partial
   published/pending indexes are preserved. The down migration is guarded and
   refuses to run while any non-`vi/en` or over-length locale exists, so a
   rollback can never silently drop data.
5. **Read fallback.** `GET /v1/pois/:poiId/narration?locale=<code>` tries the
   requested locale then its fallback chain, and returns `requestedLocale`,
   `resolvedLocale` and `fallbackUsed`. An unknown or disabled requested locale
   resolves through the default locale rather than 404ing on a stale selection.
6. **Write boundaries.** Admin narration creation and media pre-sign accept only
   enabled locales (validated against the catalog, canonicalised), and the media
   object key `poi/<poiId>/<locale>/<sha256>.<ext>` restricts the locale segment
   to a safe character set instead of a `vi|en` literal.
7. **Contract-first.** OpenAPI and `packages/api-client` are updated in the same
   change; the locked C01 contract types are not modified.

## Consequences

- Adding a narration language is a config edit plus redeploy; disabling one hides
  it from the public catalog and blocks new content for it while keeping already
  stored transcripts and audio (and their URLs) intact.
- Locale validation is unified at the config loader and the API write boundaries;
  the database keeps only a coarse form check.
- Downstream clients (admin, visitor, mobile — Tú's T25C–T25E) treat the
  narration locale as a `string`; they widen from `vi|en` at integration I01.
- The config file is environment-specific and is not a place for secrets.
