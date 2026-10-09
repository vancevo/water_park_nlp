# Admin web — POI CRUD and workflow

Next.js admin UI integrated with `@damsen/api-client` and shared `AdminPoi` contracts.

```bash
npm run dev --workspace @damsen/admin-web # http://localhost:3001
npm run lint --workspace @damsen/admin-web
npm run typecheck --workspace @damsen/admin-web
npm run test --workspace @damsen/admin-web
```

Browser requests use same-origin `/api`, rewritten to `http://localhost:3000`. The explicit MVP login panel calls `/v1/auth/login` and keeps only the access token in `sessionStorage` (tab lifetime), then the generated API client sends it as a Bearer token. Backend RBAC remains authoritative. This deliberately minimal session does not persist the refresh token; an expired access token requires login again.

The adapter reflects the current backend:

- `GET /v1/admin/pois` returns `AdminPoi[]`; `get(id)` derives from that list because no admin detail endpoint exists.
- Create/update map the form to `AdminPoiInput`. Closed weekdays are omitted because the API has no `isClosed` field.
- Submit uses the POI id. Approve/reject use `pendingVersionId`; rejection requires a reason.
- Status is read-only in the form and changes only through workflow endpoints.
- POI detail lists narration revisions per locale from the narration-locale catalog (`NarrationLocaleCatalogPort`, keyboard-accessible tabs) and exposes role-aware draft/review actions. Audio selection validates MIME and the 50 MiB limit, hashes SHA-256 in the browser, uploads through the presigned PUT, and stores rights metadata with the narration. The selected local file can be previewed before submission; private object keys are not rendered.
- `NEXT_PUBLIC_POI_DATA_MODE=demo` selects the lazy fixture adapter for an explicit demo only.
- `NEXT_PUBLIC_NARRATION_DATA_MODE=api|demo` (default `api`): `api` reads the real catalog `GET /v1/narration-locales` (verified at I01, including a config-added FR locale); `demo` uses a VI/EN/FR fixture catalog.
- `NEXT_PUBLIC_TTS_GENERATION_MODE=off|demo|api` (default `off`) shows the AI audio generation panel (`TtsGenerationPort`): simulated job lifecycle in `demo`, the real AI04 endpoints in `api` (verified at I01 against the real API; the worker side ran through an uncommitted claim harness with a fake tone provider because the worker has no queue consumer yet). Output is labelled AI-generated with provider/model/version and never publishes. The default stays `off` until a TTS worker consumes the job queue, the AI08 kill switch/quota are wired and generated audio is attached to the draft — see `docs/runbooks/frontend-i01-integration-report.md` and `docs/runbooks/frontend-narration-locales-tts.md`.

Remaining contract limitation: fetching one admin POI costs a full list request until the backend provides `GET /v1/admin/pois/:id`.
