# MVP Product Contract

- Status: Frozen for vertical slice
- Owner: Product/Coordinator
- Last reviewed: 2026-09-24
- Source: [`PROJECT_PLAN.md`](../../PROJECT_PLAN.md), sections 1, 2, 17 and 18

This document fixes observable MVP behaviour. Implementation details belong in the ADRs. A change to an acceptance criterion below requires coordinator approval and an additive contract change or a new ADR.

## 1. Actors and locales

The product has two actors:

- `Visitor`, in either an `anonymous` or `authenticated` state.
- `Admin`, with backend-enforced roles `EDITOR`, `REVIEWER` or `ADMIN`.

The MVP locales are Vietnamese (`vi`, default) and English (`en`). The UI ships both locales. Published POI content must contain both locales; the API fallback order is requested locale -> `vi`. Content is never machine-translated during a read request.

## 2. MVP user stories and acceptance criteria

### US-01 — Start as a visitor

As a visitor, I can choose a language, understand why location is requested and continue without creating an account.

- [ ] First launch offers `vi` and `en`, with `vi` selected by default.
- [ ] Location is requested only after a purpose screen and a user action.
- [ ] `denied`, `approximate`, `precise` and weak-signal states have distinct, translated UI.
- [ ] Denying location does not block browsing/search; routing explains that a start point is required.
- [ ] Continue-as-guest does not create a password account.

### US-02 — Register and authenticate

As a visitor, I can sign up/sign in with email and password, sign out, and retain my preferred locale.

- [ ] Email is normalized and unique; passwords are never logged or returned.
- [ ] Access and rotating refresh-token behaviour follows the auth contract produced in T10.
- [ ] Signing out revokes the active refresh session and removes local credentials.
- [ ] Social login and guest-data merge are not part of MVP.

### US-03 — View the park and nearby POIs

As a visitor, I can see the park map, my available location and published POIs.

- [ ] The map displays required provider/data attribution.
- [ ] The five seed POIs load from the real API after the workflow fixture publishes the initial draft; no production-path mock remains.
- [ ] POIs can be filtered by category and ordered by distance when location exists.
- [ ] Only `published` content appears; loading, empty, offline and error states are explicit.
- [ ] Distance is labelled unavailable when no usable location exists.

### US-04 — Find and understand a POI

As a visitor, I can search by name, open a POI and read/listen in my locale.

- [ ] MVP search supports Vietnamese with/without diacritics and English keyword matching.
- [ ] Detail includes name, short/long description, category, opening hours, media and entrance.
- [ ] Locale fallback is deterministic and visible to accessibility tooling.
- [ ] Audio can play, pause, resume and report failure; a previously cached file remains playable during a transient network loss.
- [ ] Semantic search and personalized ranking are not implied by this story.

### US-05 — Navigate to a POI

As a visitor, I can request a walking route from my current position to the selected POI entrance.

- [ ] The destination is an active `poi_entrance`, never the POI centroid by default.
- [ ] The route response contains a GeoJSON line, distance, ETA and ordered instructions.
- [ ] The app shows GPS accuracy and does not present confident turn guidance when accuracy is insufficient.
- [ ] Route progress is computed on-device; deviation across multiple samples triggers rerouting.
- [ ] Closed or inaccessible graph edges are excluded as specified by the routing contract.
- [ ] A deterministic simulated route and at least ten real field routes pass before MVP acceptance.

### US-06 — Manage POI content

As an editor/reviewer, I can prepare, review and publish POI content without direct database edits.

- [ ] An editor can create/update a POI, its two translations, entrance, hours, image and audio.
- [ ] Workflow is `draft -> pending_review -> published` or `rejected`; rejected content records a reason.
- [ ] A reviewer/admin, not an unprivileged visitor, can approve or reject.
- [ ] Unpublished versions never leak through public endpoints.
- [ ] Publish/reject and route-closure changes produce an audit record.

### US-07 — Record privacy-safe product events

As the product team, we can measure the main journey without retaining a visitor's raw movement trail.

- [ ] Versioned events cover POI view, audio start/complete and navigation start/complete.
- [ ] Analytics is disabled until the visitor makes the consent choice; refusal does not reduce core functionality.
- [ ] Events use a random installation/session identifier and do not contain exact GPS coordinates.
- [ ] Events are batched and retry safely without duplicate processing.

## 3. Anonymous and authenticated behaviour

| Capability | Anonymous | Authenticated visitor | Admin roles |
|---|---|---|---|
| Map, published POI, keyword search, narration, routing | Yes | Yes | Yes |
| Language and consent preferences | Stored locally | Stored locally and on account | Stored on account |
| Favorites/history sync | No (V1) | No (V1) | Not applicable |
| POI/content write | No | No | Role-dependent |
| Submit content for review | No | No | `EDITOR`, `ADMIN` |
| Approve/reject/publish | No | No | `REVIEWER`, `ADMIN` |
| User/role administration | No | No | `ADMIN` |

Anonymous identity is a random, resettable installation/session ID. It is not a hidden account. MVP signup does not migrate analytics history, favorites or browsing history.

## 4. GPS and event privacy contract

- Request foreground/`while in use` permission only. Background location is out of MVP.
- Prefer on-device route progress and off-route detection. Sending every GPS sample to the backend is prohibited.
- The routing request may send the current point because it is necessary to calculate a route. The service must not persist it in application logs, analytics payloads or route history.
- Operational request logs may retain request ID, result/error code, latency and coarse/non-location metadata; request bodies containing coordinates must be redacted.
- Analytics events must not include latitude/longitude, raw route polyline or a stable advertising identifier.
- A separate, explicit research consent and a new retention ADR are required before collecting GPS traces for map improvement.
- Account deletion, analytics-consent withdrawal and retention durations are finalized before public production; until then, staging uses synthetic/test identities only.

## 5. Explicitly outside MVP

- Semantic/vector search, recommendations and LTR.
- Favorites, synchronized history, reviews and ratings.
- Geofence/background notifications.
- Full offline map/graph packages; MVP only caches already fetched POI/audio assets.
- Social login, account recovery beyond a basic reset flow, and anonymous-to-account data merge.
- Live crowd heatmaps, Kafka/Flink, knowledge graph and A/B testing.
- Turn-by-turn voice synthesis at request time.
- Public release before map/POI rights and provider terms are approved.

## 6. Vertical-slice release gate

- [ ] Seed specification in [`SAMPLE_DATA_SPEC.md`](SAMPLE_DATA_SPEC.md) imports deterministically.
- [ ] Mobile displays all five POIs in both locales from the API.
- [ ] One supplied audio asset plays and can be replayed from cache.
- [ ] The mini graph returns a valid route to each active entrance.
- [ ] GPS simulation exercises normal progress, weak signal and reroute.
- [ ] Admin can take one record from draft through publish.
- [ ] No raw GPS appears in server logs or analytics fixtures.
- [ ] Map attribution is visible and license inventory is attached to the build/release review.
