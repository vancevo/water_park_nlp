import { describe, expect, it, vi } from 'vitest';
import type { AdminPoi } from '@damsen/shared-types';
import { AdminPoiAdapter } from './api-poi-client';
import { emptyPoiDraft } from './poi-contract';

const poi: AdminPoi = {
  id: 'p1',
  slug: 'lake',
  category: 'nature',
  status: 'pending_review',
  pendingVersionId: 'v1',
  location: { latitude: 10, longitude: 106 },
  translations: [
    {
      locale: 'vi',
      name: 'Hồ',
      shortDescription: 'Ngắn',
      longDescription: 'Dài',
    },
    {
      locale: 'en',
      name: 'Lake',
      shortDescription: 'Short',
      longDescription: 'Long',
    },
  ],
  entrances: [],
  operatingHours: [],
};
const fakeApi = () => ({
  listAdminPois: vi.fn(async () => [poi]),
  createAdminPoi: vi.fn(async () => poi),
  updateAdminPoi: vi.fn(async () => poi),
  deleteAdminPoi: vi.fn(async () => undefined),
  submitAdminPoi: vi.fn(async () => poi),
  approveContent: vi.fn(async () => poi),
  rejectContent: vi.fn(async () => poi),
});

describe('AdminPoiAdapter', () => {
  it('derives get from the backend list endpoint and passes bearer token', async () => {
    const api = fakeApi();
    const adapter = new AdminPoiAdapter(api, () => 'token');
    await expect(adapter.get('p1')).resolves.toEqual(poi);
    expect(api.listAdminPois).toHaveBeenCalledWith('token');
    await expect(adapter.get('missing')).rejects.toThrow('Không tìm thấy');
  });
  it('maps draft and routes workflow to version endpoints', async () => {
    const api = fakeApi();
    const adapter = new AdminPoiAdapter(api, () => 'token');
    const draft = emptyPoiDraft();
    await adapter.create(draft);
    await adapter.submit('p1');
    await adapter.approve('v1');
    await adapter.reject('v1', '  incomplete  ');
    expect(api.createAdminPoi).toHaveBeenCalledWith(
      expect.objectContaining({ slug: '' }),
      'token',
    );
    expect(api.submitAdminPoi).toHaveBeenCalledWith('p1', 'token');
    expect(api.approveContent).toHaveBeenCalledWith('v1', 'token');
    expect(api.rejectContent).toHaveBeenCalledWith(
      'v1',
      { reason: 'incomplete' },
      'token',
    );
  });
  it('filters the unwrapped AdminPoi array client-side', async () => {
    const adapter = new AdminPoiAdapter(fakeApi(), () => 'token');
    await expect(
      adapter.list({ search: 'lake', status: 'pending_review' }),
    ).resolves.toHaveLength(1);
    await expect(adapter.list({ search: 'missing' })).resolves.toEqual([]);
  });
});
