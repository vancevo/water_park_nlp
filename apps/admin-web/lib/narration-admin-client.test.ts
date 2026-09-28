import type { AdminNarration } from '@damsen/shared-types';
import { describe, expect, it, vi } from 'vitest';
import {
  NarrationAdminAdapter,
  narrationPermissions,
  newestNarration,
} from './narration-admin-client';

const narration = (revision = 1): AdminNarration => ({
  id: `n${revision}`,
  poiId: 'p1',
  locale: 'vi',
  revision,
  status: 'draft',
  transcript: 'Nội dung thuyết minh đủ dài để kiểm thử.',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

function fakeApi() {
  return {
    createAudioUploadIntent: vi.fn(async () => ({
      objectKey: 'private/object.mp3',
      uploadUrl: 'https://upload.example/audio',
      method: 'PUT' as const,
      expiresAt: '2026-01-01T00:05:00.000Z',
      requiredHeaders: {
        'content-type': 'audio/mpeg',
        'content-length': '5',
        'x-amz-checksum-sha256': 'base64-checksum',
        'x-amz-meta-sha256': 'a'.repeat(64),
      },
    })),
    listAdminNarrations: vi.fn(async () => [narration()]),
    createAdminNarration: vi.fn(async () => narration()),
    updateAdminNarration: vi.fn(async () => narration()),
    submitAdminNarration: vi.fn(async () => narration()),
    approveAdminNarration: vi.fn(async () => narration()),
    rejectAdminNarration: vi.fn(async () => narration()),
  };
}

describe('NarrationAdminAdapter', () => {
  it('uses the current session token for narration state and workflow', async () => {
    const api = fakeApi();
    const adapter = new NarrationAdminAdapter(api, () => 'access-token');
    await adapter.list('p1');
    await adapter.submit('n1');
    await adapter.approve('n1');
    await adapter.reject('n1', '  Chưa đúng nội dung  ');
    expect(api.listAdminNarrations).toHaveBeenCalledWith('p1', 'access-token');
    expect(api.submitAdminNarration).toHaveBeenCalledWith('n1', 'access-token');
    expect(api.approveAdminNarration).toHaveBeenCalledWith(
      'n1',
      'access-token',
    );
    expect(api.rejectAdminNarration).toHaveBeenCalledWith(
      'n1',
      { reason: 'Chưa đúng nội dung' },
      'access-token',
    );
  });

  it('uploads exact browser-safe signed headers and lets fetch derive content-length', async () => {
    const api = fakeApi();
    const put = vi.fn(async () => new Response(null, { status: 200 }));
    const adapter = new NarrationAdminAdapter(api, () => 'token', put);
    const body = new Blob(['audio']);
    const request = {
      poiId: 'p1',
      locale: 'vi' as const,
      mimeType: 'audio/mpeg' as const,
      sizeBytes: 5,
      sha256: 'a'.repeat(64),
    };
    const intent = await adapter.uploadAudio(request, body);
    expect(api.createAudioUploadIntent).toHaveBeenCalledWith(request, 'token');
    expect(put).toHaveBeenCalledWith(intent.uploadUrl, {
      method: 'PUT',
      body,
      headers: {
        'content-type': 'audio/mpeg',
        'x-amz-checksum-sha256': 'base64-checksum',
        'x-amz-meta-sha256': 'a'.repeat(64),
      },
    });
    expect(request.sizeBytes).toBe(body.size);
  });

  it('surfaces failed object storage uploads', async () => {
    const adapter = new NarrationAdminAdapter(
      fakeApi(),
      () => 'token',
      vi.fn(async () => new Response(null, { status: 403 })),
    );
    await expect(
      adapter.uploadAudio(
        {
          poiId: 'p1',
          locale: 'vi',
          mimeType: 'audio/mpeg',
          sizeBytes: 5,
          sha256: 'a'.repeat(64),
        },
        new Blob(['audio']),
      ),
    ).rejects.toThrow('HTTP 403');
  });
});

describe('narration UI state', () => {
  it('selects the newest locale revision and derives role permissions', () => {
    expect(newestNarration([narration(1), narration(3)], 'vi')?.revision).toBe(
      3,
    );
    expect(narrationPermissions(['EDITOR'])).toEqual({
      canEdit: true,
      canReview: false,
    });
    expect(narrationPermissions(['ADMIN'])).toEqual({
      canEdit: true,
      canReview: true,
    });
    expect(narrationPermissions(['VISITOR'])).toEqual({
      canEdit: false,
      canReview: false,
    });
  });
});
