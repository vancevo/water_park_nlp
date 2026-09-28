# ADR 0004: Object storage and narration lifecycle

- Status: Accepted
- Date: 2026-09-24

## Context

POI images/audio are large immutable-ish assets. Narration must start reliably and support locale-specific editorial review without adding live synthesis latency or leaking credentials.

## Decision

- Store media objects outside PostgreSQL behind an S3-compatible adapter. PostgreSQL stores object key, locale, MIME type, size, SHA-256, duration/dimensions, rights/provenance and publication state.
- Use a pinned MinIO container in local development and AWS S3 in the initial production deployment. T02 records the exact MinIO image digest/license notices; the application still depends only on the S3-compatible adapter so a future provider change is configuration plus infrastructure review.
- Upload with short-lived presigned URLs after backend authorization. Validate extension-independent MIME signature, size and metadata, quarantine/scan, then publish an immutable versioned object.
- Deliver published objects through short-lived signed URLs or an approved CDN. Buckets are private; credentials never reach mobile/admin.
- MVP narration is editor-uploaded, project-owned/authorized audio. It must have an approved transcript for the same locale before publish.
- TTS, when later enabled, is an asynchronous pre-publication worker: text -> generated candidate -> human review -> immutable audio. No runtime/on-demand TTS occurs in MVP.
- Use `vi` and `en` tracks independently. Missing requested audio may fall back to text; it must not silently play the wrong language.
- Mobile may cache downloaded published audio by content hash and evict it under a bounded policy.

## Rights and retention

Every production asset requires owner/source, usage rights, locale and review record. Replacing content creates a new key/version; unreferenced objects are deleted only through a separately audited lifecycle job after the recovery window. Synthetic fixtures must be generated/owned by the project.

## Consequences

Provider lock-in is limited to the S3 protocol. Publication is slightly slower because validation and review are deliberate. Pre-generated narration is predictable in latency/cost and editorial quality. TTS provider/voice selection is not an MVP blocker because uploaded narration is the accepted source; enabling TTS later requires a provider-specific ADR covering Vietnamese/English quality, pricing, retention and generated-audio rights.

## Alternatives rejected

- Database BLOBs: increase backup/replication cost and complicate media delivery.
- Public buckets: make unpublished content and enumeration harder to control.
- Live TTS in the playback request: creates latency/cost variance and bypasses content review.
