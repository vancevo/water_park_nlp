# Runbook — Narration locales (backend)

How to add, disable, reorder and roll back narration locales. Scope: **narration**
languages only; interface/POI-content languages stay `vi | en` (ADR 0006). See
ADR 0007 for the decision and `docs/plans/CONFIGURABLE_MULTILINGUAL_NARRATION_PLAN.md`.

## Where the catalog lives

- File: `config/narration-locales.json` (override the path with
  `NARRATION_LOCALES_CONFIG_PATH`).
- Loaded and validated at API startup. Invalid config **fails startup** — look
  for a log line beginning `narration-locales config:`.
- `vi` and `en` must always be present and `enabled` (backward compatibility).

Entry shape:

```json
{
  "code": "fr",
  "nativeLabel": "Français",
  "speechTag": "fr-FR",
  "enabled": true,
  "fallbackLocale": "en"
}
```

Rules enforced by the loader: `code` is a canonical BCP 47 tag (≤ 35 chars,
unique); `defaultLocale` must be enabled; `fallbackLocale` must exist, be
enabled, not point to itself and not form a cycle. Array order is display order.

## Add a locale

1. Add an entry to `config/narration-locales.json` (set `enabled: true` and a
   sensible `fallbackLocale`, e.g. `en` or `vi`).
2. Redeploy the API. If the config is invalid the API refuses to start — fix the
   reported error and redeploy.
3. Verify: `GET /v1/narration-locales` lists the new code. Admin and visitor
   clients pick it up with no code change.
4. No database change is needed for a new code — migration 009 already allows any
   BCP 47 code. Editors can now create transcripts/audio for it; until then,
   visitors requesting it see the fallback locale with `fallbackUsed: true`.

## Disable a locale

1. Set `"enabled": false` on its entry and redeploy.
2. Effect: it disappears from `GET /v1/narration-locales`, new narration/media
   writes for it are rejected at the API boundary, but **already stored
   transcripts, audio and their object keys are kept** and existing published
   audio URLs keep working.
3. Do not delete `vi` or `en`, and do not point another locale's
   `fallbackLocale` at a disabled one (the loader rejects that).

## Reorder / change label or fallback

Edit the entry (order, `nativeLabel`, `speechTag`, `fallbackLocale`) and
redeploy. The public catalog reflects the new order/labels immediately.

## Migration 009 (one-time schema widening)

- `infra/migrations/009_configurable_narration_locales.up.sql` widens
  `poi_narrations.locale` to `varchar(35)` and swaps the `vi/en` check for a
  minimal BCP 47 form check. Run it (`npm run db:migrate`) before serving any
  non-`vi/en` locale. It preserves existing rows, the unique key and indexes.
- Down migration is **guarded**: it refuses to run while any narration has a
  locale other than `vi/en` (or longer than 5 chars). To roll back, first disable
  and remove non-`vi/en` narrations, then run the down migration.

## Rollback of a bad config

Because config is validated at startup, a bad config file simply prevents boot.
Revert `config/narration-locales.json` to the last good version (or unset
`NARRATION_LOCALES_CONFIG_PATH` to fall back to the built-in `vi/en` default) and
redeploy.

## Privacy / safety

- The config file holds no secrets, audio URLs or transcript text.
- Error responses for a disabled/unknown locale return only the stable code
  `NARRATION_LOCALE_DISABLED` — never a stack, transcript or provider detail.
