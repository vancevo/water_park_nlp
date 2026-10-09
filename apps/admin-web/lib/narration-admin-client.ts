import { ApiClientError, DamSenApiClient } from '@damsen/api-client';
import type {
  AdminNarration,
  MediaUploadIntent,
  MediaUploadIntentRequest,
  NarrationInput,
  UserRole,
} from '@damsen/shared-types';
import { apiBase } from './api-poi-client';
import { requireAccessToken } from './auth-session';

type NarrationSdk = Pick<
  DamSenApiClient,
  | 'createAudioUploadIntent'
  | 'listAdminNarrations'
  | 'createAdminNarration'
  | 'updateAdminNarration'
  | 'submitAdminNarration'
  | 'approveAdminNarration'
  | 'rejectAdminNarration'
  | 'getAdminNarrationAudioPlayback'
>;

export class NarrationAdminAdapter {
  constructor(
    private readonly api: NarrationSdk,
    private readonly token: () => string,
    private readonly fetchImplementation: typeof fetch = globalThis.fetch,
  ) {}

  list(poiId: string) {
    return this.api.listAdminNarrations(poiId, this.token());
  }
  create(poiId: string, input: NarrationInput) {
    return this.api.createAdminNarration(poiId, input, this.token());
  }
  update(id: string, input: Partial<NarrationInput>) {
    return this.api.updateAdminNarration(id, input, this.token());
  }
  submit(id: string) {
    return this.api.submitAdminNarration(id, this.token());
  }
  approve(id: string) {
    return this.api.approveAdminNarration(id, this.token());
  }
  reject(id: string, reason: string) {
    return this.api.rejectAdminNarration(
      id,
      { reason: reason.trim() },
      this.token(),
    );
  }

  /** v1.1: ten-minute signed GET to preview the narration's current audio. */
  playback(id: string) {
    return this.api.getAdminNarrationAudioPlayback(id, this.token());
  }

  async uploadAudio(
    request: MediaUploadIntentRequest,
    body: Blob,
  ): Promise<MediaUploadIntent> {
    const intent = await this.api.createAudioUploadIntent(
      request,
      this.token(),
    );
    // Browsers own this forbidden header and derive the exact value from Blob.
    // The remaining signed headers must be sent byte-for-byte as returned.
    const { 'content-length': signedLength, ...browserHeaders } =
      intent.requiredHeaders;
    if (Number(signedLength) !== body.size)
      throw new Error('Kích thước audio không khớp với yêu cầu tải lên.');
    const response = await this.fetchImplementation(intent.uploadUrl, {
      method: intent.method,
      body,
      headers: browserHeaders,
    });
    if (!response.ok)
      throw new Error(`Tải audio thất bại (HTTP ${response.status}).`);
    return intent;
  }
}

/**
 * Codes the narration endpoints return because of AI generation (contract
 * v1.1). Mapped to Vietnamese so the editor never sees raw server text for
 * them; other failures keep the existing behaviour.
 */
const NARRATION_ERROR_LABELS: Record<string, string> = {
  TTS_JOB_IN_PROGRESS:
    'Không thể lưu hay gửi duyệt: máy chủ đang tạo audio AI cho bản nháp này. Chờ hoàn tất hoặc huỷ job trước.',
  NARRATION_NOT_DRAFT:
    'Không thể thao tác: bản thuyết minh không còn ở trạng thái nháp. Tải lại trang để xem trạng thái mới.',
  NARRATION_AUDIO_NOT_FOUND:
    'Không tìm thấy audio của bản thuyết minh này (có thể đã được thay hoặc gỡ). Tải lại trang.',
};

export function narrationErrorMessage(cause: unknown, fallback: string) {
  if (cause instanceof ApiClientError) {
    const known = NARRATION_ERROR_LABELS[cause.body?.code ?? ''];
    if (known) return known;
  }
  return cause instanceof Error ? cause.message : fallback;
}

export function narrationPermissions(roles: UserRole[]) {
  return {
    canEdit: roles.includes('EDITOR') || roles.includes('ADMIN'),
    canReview: roles.includes('REVIEWER') || roles.includes('ADMIN'),
  };
}

const sdk = new DamSenApiClient({ baseUrl: apiBase });
export const narrationAdminClient = new NarrationAdminAdapter(
  sdk,
  requireAccessToken,
);

export function newestNarration(
  narrations: AdminNarration[],
  locale: NarrationInput['locale'],
) {
  return narrations
    .filter((item) => item.locale === locale)
    .sort((a, b) => b.revision - a.revision)[0];
}
