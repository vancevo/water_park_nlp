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
- `NEXT_PUBLIC_TTS_GENERATION_MODE=off|demo|api` (default `api` since I03) shows the AI audio generation panel (`TtsGenerationPort`): simulated job lifecycle in `demo`, the real endpoints (contract v1.1, ADR 0014) in `api`. The worker attaches the audio to the draft; the editor plays it through the admin playback URL (`NarrationAudioPreview`) with AI-generated provenance, tracking resumes after a reload via the latest-job endpoint, and nothing is ever published without a reviewer. `off` (or any unknown value) hides the panel and is the rollback; the backend kill switch `TTS_GENERATION_ENABLED=false` stops generation without a rebuild. Acceptance evidence: `docs/runbooks/frontend-i03-acceptance-report.md`; operations: `docs/runbooks/frontend-narration-locales-tts.md`.

Remaining contract limitation: fetching one admin POI costs a full list request until the backend provides `GET /v1/admin/pois/:id`.
