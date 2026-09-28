import { DamSenApiClient } from '@damsen/api-client';
import type { AdminPoi } from '@damsen/shared-types';
import {
  draftToAdminInput,
  type PoiAdminClient,
  type PoiQuery,
} from './poi-contract';
import { requireAccessToken } from './auth-session';

export const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api';
const sdk = new DamSenApiClient({ baseUrl: apiBase });
type AdminSdk = Pick<
  DamSenApiClient,
  | 'listAdminPois'
  | 'createAdminPoi'
  | 'updateAdminPoi'
  | 'deleteAdminPoi'
  | 'submitAdminPoi'
  | 'approveContent'
  | 'rejectContent'
>;

export class AdminPoiAdapter implements PoiAdminClient {
  constructor(
    private readonly api: AdminSdk,
    private readonly token: () => string,
  ) {}
  async list(query: PoiQuery = {}): Promise<AdminPoi[]> {
    const records = await this.api.listAdminPois(this.token());
    const search = query.search?.trim().toLocaleLowerCase();
    return records.filter(
      (poi) =>
        (!query.status ||
          query.status === 'all' ||
          poi.status === query.status) &&
        (!query.category || poi.category === query.category) &&
        (!search ||
          poi.slug.includes(search) ||
          poi.translations.some((item) =>
            item.name.toLocaleLowerCase().includes(search),
          )),
    );
  }
  async get(id: string) {
    const record = (await this.api.listAdminPois(this.token())).find(
      (poi) => poi.id === id,
    );
    if (!record)
      throw new Error('Không tìm thấy POI trong danh sách quản trị.');
    return record;
  }
  create(input: Parameters<PoiAdminClient['create']>[0]) {
    return this.api.createAdminPoi(draftToAdminInput(input), this.token());
  }
  update(id: string, input: Parameters<PoiAdminClient['update']>[1]) {
    return this.api.updateAdminPoi(id, draftToAdminInput(input), this.token());
  }
  remove(id: string) {
    return this.api.deleteAdminPoi(id, this.token());
  }
  submit(id: string) {
    return this.api.submitAdminPoi(id, this.token());
  }
  approve(versionId: string) {
    return this.api.approveContent(versionId, this.token());
  }
  reject(versionId: string, reason: string) {
    return this.api.rejectContent(
      versionId,
      { reason: reason.trim() },
      this.token(),
    );
  }
}
export const apiPoiClient: PoiAdminClient = new AdminPoiAdapter(
  sdk,
  requireAccessToken,
);
let clientPromise: Promise<PoiAdminClient> | undefined;
export function getPoiClient(): Promise<PoiAdminClient> {
  if (clientPromise) return clientPromise;
  const mode = process.env.NEXT_PUBLIC_POI_DATA_MODE;
  clientPromise =
    mode === 'demo' || mode === 'test'
      ? import('./fixture-poi-client').then(
          ({ fixturePoiClient }) => fixturePoiClient,
        )
      : Promise.resolve(apiPoiClient);
  return clientPromise;
}
