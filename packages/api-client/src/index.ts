export type {
  ApiErrorEnvelope,
  GeoPoint,
  HealthResponse,
  LocalizedContent,
  PoiDetail,
  PoiEntrance,
  PoiListQuery,
  PoiListResponse,
  PoiOperatingHours,
  PoiSummary,
  SupportedLocale,
  AdminPoi,
  AdminPoiInput,
  AuditLogEntry,
  AuthResponse,
  AuthTokens,
  AuthUser,
  LoginRequest,
  LogoutRequest,
  RefreshRequest,
  RegisterRequest,
  UserRole,
  WorkflowReasonRequest,
  RouteRequest,
  RouteOrigin,
  RouteResponse,
  SearchQuery,
  SearchResponse,
  AdminNarration,
  NarrationInput,
  PoiNarration,
  MediaUploadIntent,
  MediaUploadIntentRequest,
  AnalyticsBatchRequest,
  AnalyticsBatchResponse,
  NarrationLocaleCode,
  NarrationLocaleOption,
  NarrationLocaleCatalog,
  TtsJobStatus,
  TtsGenerationJob,
  CreateTtsJobRequest,
} from '@damsen/shared-types';

import type {
  ApiErrorEnvelope,
  HealthResponse,
  PoiDetail,
  PoiListQuery,
  PoiListResponse,
  AdminPoi,
  AdminPoiInput,
  AuditLogEntry,
  AuthResponse,
  LoginRequest,
  LogoutRequest,
  RefreshRequest,
  RegisterRequest,
  WorkflowReasonRequest,
  RouteRequest,
  RouteResponse,
  SearchQuery,
  SearchResponse,
  AdminNarration,
  NarrationInput,
  PoiNarration,
  MediaUploadIntent,
  MediaUploadIntentRequest,
  AnalyticsBatchRequest,
  AnalyticsBatchResponse,
  NarrationLocaleCatalog,
  TtsGenerationJob,
  CreateTtsJobRequest,
} from '@damsen/shared-types';

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorEnvelope,
  ) {
    super(body.message);
    this.name = 'ApiClientError';
  }
}

export class DamSenApiClient {
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly baseUrl: string;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImplementation =
      options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  getHealth(): Promise<HealthResponse> {
    return this.get('/health');
  }

  listPois(query: PoiListQuery = {}): Promise<PoiListResponse> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.get(`/v1/pois${suffix}`);
  }

  search(query: SearchQuery): Promise<SearchResponse> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    return this.get(`/v1/search?${params.toString()}`);
  }

  getPoi(id: string, locale: 'vi' | 'en' = 'vi'): Promise<PoiDetail> {
    return this.get(`/v1/pois/${encodeURIComponent(id)}?locale=${locale}`);
  }

  createRoute(input: RouteRequest): Promise<RouteResponse> {
    return this.request('/v1/routes', { method: 'POST', body: input });
  }

  sendAnalyticsEvents(
    input: AnalyticsBatchRequest,
    accessToken?: string,
  ): Promise<AnalyticsBatchResponse> {
    return this.request('/v1/events/batch', {
      method: 'POST',
      body: input,
      accessToken,
    });
  }

  getPoiNarration(
    poiId: string,
    locale: 'vi' | 'en' = 'vi',
  ): Promise<PoiNarration> {
    return this.get(
      `/v1/pois/${encodeURIComponent(poiId)}/narration?locale=${locale}`,
    );
  }

  createAudioUploadIntent(
    input: MediaUploadIntentRequest,
    accessToken: string,
  ): Promise<MediaUploadIntent> {
    return this.request('/v1/admin/media/presign', {
      method: 'POST',
      body: input,
      accessToken,
    });
  }

  listAdminNarrations(
    poiId: string,
    accessToken: string,
  ): Promise<AdminNarration[]> {
    return this.request(
      `/v1/admin/pois/${encodeURIComponent(poiId)}/narrations`,
      { accessToken },
    );
  }

  createAdminNarration(
    poiId: string,
    input: NarrationInput,
    accessToken: string,
  ): Promise<AdminNarration> {
    return this.request(
      `/v1/admin/pois/${encodeURIComponent(poiId)}/narrations`,
      { method: 'POST', body: input, accessToken },
    );
  }

  updateAdminNarration(
    narrationId: string,
    input: Partial<NarrationInput>,
    accessToken: string,
  ): Promise<AdminNarration> {
    return this.request(
      `/v1/admin/narrations/${encodeURIComponent(narrationId)}`,
      { method: 'PATCH', body: input, accessToken },
    );
  }

  deleteAdminNarration(
    narrationId: string,
    accessToken: string,
  ): Promise<void> {
    return this.request(
      `/v1/admin/narrations/${encodeURIComponent(narrationId)}`,
      { method: 'DELETE', accessToken },
    );
  }

  submitAdminNarration(
    narrationId: string,
    accessToken: string,
  ): Promise<AdminNarration> {
    return this.request(
      `/v1/admin/narrations/${encodeURIComponent(narrationId)}/submit`,
      { method: 'POST', accessToken },
    );
  }

  approveAdminNarration(
    narrationId: string,
    accessToken: string,
  ): Promise<AdminNarration> {
    return this.request(
      `/v1/admin/narrations/${encodeURIComponent(narrationId)}/approve`,
      { method: 'POST', accessToken },
    );
  }

  rejectAdminNarration(
    narrationId: string,
    input: WorkflowReasonRequest,
    accessToken: string,
  ): Promise<AdminNarration> {
    return this.request(
      `/v1/admin/narrations/${encodeURIComponent(narrationId)}/reject`,
      { method: 'POST', body: input, accessToken },
    );
  }

  // --- Configurable narration locales + TTS jobs (contract v1) ---

  getNarrationLocales(): Promise<NarrationLocaleCatalog> {
    return this.get('/v1/narration-locales');
  }

  createTtsJob(
    narrationId: string,
    input: CreateTtsJobRequest,
    accessToken: string,
  ): Promise<TtsGenerationJob> {
    return this.request(
      `/v1/admin/narrations/${encodeURIComponent(narrationId)}/tts-jobs`,
      { method: 'POST', body: input, accessToken },
    );
  }

  getTtsJob(jobId: string, accessToken: string): Promise<TtsGenerationJob> {
    return this.request(
      `/v1/admin/tts-jobs/${encodeURIComponent(jobId)}`,
      { accessToken },
    );
  }

  cancelTtsJob(jobId: string, accessToken: string): Promise<TtsGenerationJob> {
    return this.request(
      `/v1/admin/tts-jobs/${encodeURIComponent(jobId)}/cancel`,
      { method: 'POST', accessToken },
    );
  }

  register(input: RegisterRequest): Promise<AuthResponse> {
    return this.request('/v1/auth/register', { method: 'POST', body: input });
  }

  login(input: LoginRequest): Promise<AuthResponse> {
    return this.request('/v1/auth/login', { method: 'POST', body: input });
  }

  refresh(input: RefreshRequest): Promise<AuthResponse> {
    return this.request('/v1/auth/refresh', { method: 'POST', body: input });
  }

  logout(input: LogoutRequest): Promise<void> {
    return this.request('/v1/auth/logout', { method: 'POST', body: input });
  }

  listAdminPois(accessToken: string): Promise<AdminPoi[]> {
    return this.request('/v1/admin/pois', { accessToken });
  }

  createAdminPoi(input: AdminPoiInput, accessToken: string): Promise<AdminPoi> {
    return this.request('/v1/admin/pois', {
      method: 'POST',
      body: input,
      accessToken,
    });
  }

  updateAdminPoi(
    id: string,
    input: Partial<AdminPoiInput>,
    accessToken: string,
  ): Promise<AdminPoi> {
    return this.request(`/v1/admin/pois/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
      accessToken,
    });
  }

  deleteAdminPoi(id: string, accessToken: string): Promise<void> {
    return this.request(`/v1/admin/pois/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      accessToken,
    });
  }

  submitAdminPoi(id: string, accessToken: string): Promise<AdminPoi> {
    return this.request(`/v1/admin/pois/${encodeURIComponent(id)}/submit`, {
      method: 'POST',
      accessToken,
    });
  }

  approveContent(versionId: string, accessToken: string): Promise<AdminPoi> {
    return this.request(
      `/v1/admin/content/${encodeURIComponent(versionId)}/approve`,
      { method: 'POST', accessToken },
    );
  }

  rejectContent(
    versionId: string,
    input: WorkflowReasonRequest,
    accessToken: string,
  ): Promise<AdminPoi> {
    return this.request(
      `/v1/admin/content/${encodeURIComponent(versionId)}/reject`,
      { method: 'POST', body: input, accessToken },
    );
  }

  listAuditLogs(accessToken: string): Promise<AuditLogEntry[]> {
    return this.request('/v1/admin/audit-logs', { accessToken });
  }

  private async get<T>(path: string): Promise<T> {
    return this.request(path);
  }

  private async request<T>(
    path: string,
    options: { method?: string; body?: unknown; accessToken?: string } = {},
  ): Promise<T> {
    const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
        ...(options.accessToken
          ? { authorization: `Bearer ${options.accessToken}` }
          : {}),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
    if (response.status === 204) return undefined as T;
    const body = (await response.json()) as T | ApiErrorEnvelope;
    if (!response.ok) {
      throw new ApiClientError(response.status, body as ApiErrorEnvelope);
    }
    return body as T;
  }
}
