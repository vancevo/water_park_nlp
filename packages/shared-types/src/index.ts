export interface ApiErrorEnvelope {
  code: string;
  message: string;
  details: unknown;
  requestId: string;
}

export interface HealthResponse {
  status: 'ok';
}

export type SupportedLocale = 'vi' | 'en';

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface LocalizedContent {
  requestedLocale: SupportedLocale;
  resolvedLocale: SupportedLocale;
  fallbackUsed: boolean;
  name: string;
  shortDescription: string;
}

export interface PoiEntrance {
  id: string;
  label: string;
  location: GeoPoint;
  graphNodeRef: string;
  isPrimary: boolean;
  accessibility: 'standard' | 'step_free';
}

export interface PoiOperatingHours {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
}

export interface PoiSummary extends LocalizedContent {
  id: string;
  slug: string;
  category: string;
  location: GeoPoint;
  distanceMeters?: number;
  isOpen?: boolean;
}

export interface PoiDetail extends PoiSummary {
  longDescription: string;
  entrances: PoiEntrance[];
  operatingHours: PoiOperatingHours[];
}

export interface PoiListResponse {
  items: PoiSummary[];
  total: number;
}

export interface PoiListQuery {
  lat?: number;
  lng?: number;
  radius?: number;
  category?: string;
  openNow?: boolean;
  locale?: SupportedLocale;
}

export type SearchReason =
  | 'exact_name'
  | 'accent_insensitive_name'
  | 'text_match'
  | 'nearby'
  | 'open_now'
  | 'semantic';

export interface SearchQuery {
  q: string;
  locale?: SupportedLocale;
  category?: string;
  openNow?: boolean;
  lat?: number;
  lng?: number;
  radius?: number;
  limit?: number;
  offset?: number;
}

export interface SearchResult extends PoiSummary {
  score: number;
  reasons: SearchReason[];
}

export interface SearchResponse {
  items: SearchResult[];
  total: number;
  limit: number;
  offset: number;
  nextOffset?: number;
}

export type UserRole = 'VISITOR' | 'EDITOR' | 'REVIEWER' | 'ADMIN';
export type PoiWorkflowStatus =
  | 'draft'
  | 'pending_review'
  | 'published'
  | 'rejected';

export interface AuthUser {
  id: string;
  email: string;
  preferredLocale: SupportedLocale;
  roles: UserRole[];
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}

export interface AuthResponse extends AuthTokens {
  user: AuthUser;
}

export interface RegisterRequest {
  email: string;
  password: string;
  preferredLocale?: SupportedLocale;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface LogoutRequest {
  refreshToken: string;
}

export interface AdminPoiTranslationInput {
  locale: SupportedLocale;
  name: string;
  shortDescription: string;
  longDescription: string;
}

export interface AdminPoiEntranceInput {
  id?: string;
  labelVi: string;
  labelEn: string;
  location: GeoPoint;
  graphNodeRef: string;
  isPrimary: boolean;
  accessibility: 'standard' | 'step_free';
}

export interface AdminPoiInput {
  slug: string;
  category: string;
  location: GeoPoint;
  translations: AdminPoiTranslationInput[];
  entrances: AdminPoiEntranceInput[];
  operatingHours: PoiOperatingHours[];
}

export interface AdminPoi extends AdminPoiInput {
  id: string;
  status: PoiWorkflowStatus;
  pendingVersionId?: string;
  rejectionReason?: string;
}

export interface WorkflowReasonRequest {
  reason: string;
}

export interface AuditLogEntry {
  id: string;
  actorId: string;
  action: string;
  entityType: 'poi';
  entityId: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export interface RouteOrigin {
  lat: number;
  lng: number;
}

export interface RouteRequest {
  from: RouteOrigin;
  poiId: string;
  accessible?: boolean;
}

export interface GeoJsonLineString {
  type: 'LineString';
  coordinates: [number, number][];
}

export interface RouteStep {
  sequence: number;
  instruction: string;
  distanceMeters: number;
}

export interface RouteResponse {
  routeId: string;
  version: number;
  geometry: GeoJsonLineString;
  distanceMeters: number;
  etaSeconds: number;
  steps: RouteStep[];
}

export type AnalyticsEventType =
  | 'app_opened'
  | 'poi_viewed'
  | 'narration_started'
  | 'narration_completed'
  | 'route_requested'
  | 'route_started'
  | 'route_completed';

export type AnalyticsEventPayload = {
  poiId?: string;
  locale?: SupportedLocale;
  accessible?: boolean;
};

export interface AnalyticsEventInput {
  /** Client-generated UUID v4 used as the idempotency key. */
  eventId: string;
  schemaVersion: 1;
  eventType: AnalyticsEventType;
  occurredAt: string;
  payload: AnalyticsEventPayload;
}

export interface AnalyticsBatchRequest {
  /** Required only when no valid access token is supplied. */
  anonymousSessionId?: string;
  consent: {
    analytics: true;
    policyVersion: string;
  };
  events: AnalyticsEventInput[];
}

export interface AnalyticsBatchResponse {
  acceptedEventIds: string[];
  duplicateEventIds: string[];
}

export type NarrationWorkflowStatus =
  | 'draft'
  | 'pending_review'
  | 'published'
  | 'rejected'
  | 'superseded';

export interface NarrationAudioMetadataInput {
  objectKey: string;
  mimeType: 'audio/mpeg' | 'audio/mp4' | 'audio/ogg' | 'audio/wav';
  sizeBytes: number;
  sha256: string;
  durationSeconds: number;
  rightsOwner: string;
  rightsSource: string;
  usageRights: string;
}

export interface NarrationInput {
  locale: NarrationLocaleCode;
  transcript: string;
  audio?: NarrationAudioMetadataInput | null;
}

export interface NarrationAudioMetadata
  extends Omit<NarrationAudioMetadataInput, 'objectKey'> {
  playbackUrl: string;
  playbackExpiresAt: string;
  /**
   * Contract v1.2 (additive, ADR 0014 amendment): present only when the
   * published audio was generated by a TTS job, so visitor clients can label
   * it "AI-generated". Absent for editor-uploaded audio.
   */
  generatedBy?: PublicNarrationAudioProvenance;
}

/** AI provenance shown to visitors: {@link NarrationAudioGeneratedBy} without the internal job id. */
export type PublicNarrationAudioProvenance = Omit<
  NarrationAudioGeneratedBy,
  'jobId'
>;

export interface PoiNarration {
  id: string;
  poiId: string;
  requestedLocale: NarrationLocaleCode;
  resolvedLocale: NarrationLocaleCode;
  fallbackUsed: boolean;
  transcript: string;
  audio: NarrationAudioMetadata | null;
}

export interface AdminNarration extends NarrationInput {
  id: string;
  poiId: string;
  revision: number;
  status: NarrationWorkflowStatus;
  rejectionReason?: string;
  /**
   * Contract v1.1 (additive, ADR 0014): present only when the CURRENT audio was
   * generated by a TTS job. Response-only — never send it back in a write.
   */
  audioGeneratedBy?: NarrationAudioGeneratedBy;
  createdAt: string;
  updatedAt: string;
}

/** AI provenance of narration audio produced by a TTS job (contract v1.1). */
export interface NarrationAudioGeneratedBy {
  provider: string;
  model: string;
  modelVersion: string;
  voiceId: string;
  /** License of the voice/model artifact, as recorded in the voice registry. */
  license: string;
  jobId: string;
  generatedAt: string;
}

/** Short-lived signed GET for an admin to preview a narration's audio (v1.1). */
export interface NarrationAudioPlayback {
  playbackUrl: string;
  playbackExpiresAt: string;
}

export interface MediaUploadIntentRequest {
  poiId: string;
  locale: NarrationLocaleCode;
  mimeType: NarrationAudioMetadataInput['mimeType'];
  sizeBytes: number;
  sha256: string;
}

export interface MediaUploadIntent {
  objectKey: string;
  uploadUrl: string;
  method: 'PUT';
  expiresAt: string;
  requiredHeaders: {
    'content-type': string;
    'content-length': string;
    'x-amz-checksum-sha256': string;
    'x-amz-meta-sha256': string;
  };
}

// ============================================================================
// Configurable multilingual narration — contract v1 (C01)
// Locked shape per docs/plans/CONG_TU_WORK_SPLIT.md. Do not change without an
// ADR/proposal + a single integration commit that updates mock + OpenAPI.
// ============================================================================

/** BCP 47 locale code, e.g. "vi", "en", "fr". Free-form string on the wire. */
export type NarrationLocaleCode = string;

export interface NarrationLocaleOption {
  code: NarrationLocaleCode;
  nativeLabel: string;
  /** Tag passed to Web Speech / speechSynthesis, e.g. "vi-VN". */
  speechTag: string;
  fallbackLocale?: NarrationLocaleCode;
}

export interface NarrationLocaleCatalog {
  defaultLocale: NarrationLocaleCode;
  /** Enabled locales only, in configured order. */
  locales: NarrationLocaleOption[];
}

export type TtsJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface TtsGenerationJob {
  id: string;
  narrationId: string;
  status: TtsJobStatus;
  provider: string;
  model: string;
  modelVersion: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Stable error code only — never a stack, transcript or provider key.
   * Present only on `failed` jobs (contract v1.1 guarantees it is absent while
   * `queued`/`running`).
   */
  errorCode?: string;
  /**
   * Contract v1.1 (additive, ADR 0014): metadata of the generated audio, present
   * only on `succeeded` jobs. The audio itself is attached to the draft
   * narration (see `AdminNarration.audio` / `audioGeneratedBy`).
   */
  artifact?: TtsJobArtifactSummary;
}

/** Public, non-sensitive summary of a TTS job's output (contract v1.1). */
export interface TtsJobArtifactSummary {
  voiceId: string;
  license: string;
  audioSha256: string;
  sizeBytes: number;
  durationSeconds: number;
  sampleRateHz: number;
  mimeType: 'audio/wav';
}

/** `GET /v1/admin/narrations/:narrationId/tts-jobs/latest` (contract v1.1). */
export interface LatestTtsJobResponse {
  job: TtsGenerationJob | null;
}

export interface CreateTtsJobRequest {
  /** Locale to synthesize; must be an enabled catalog locale. */
  locale: NarrationLocaleCode;
  /** Optional override; defaults to the configured provider/model. */
  provider?: string;
  model?: string;
}

// Contract v1 locked — see docs/plans/CONG_TU_WORK_SPLIT.md
