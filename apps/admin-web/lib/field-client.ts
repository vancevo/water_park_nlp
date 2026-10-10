import { DamSenApiClient } from '@damsen/api-client';
import type {
  AdminPoi,
  AdminPoiInput,
  FieldCheck,
  FieldCheckApplyInput,
  FieldCheckInput,
} from '@damsen/shared-types';
import { apiBase } from './api-poi-client';
import { ensureFreshAccessToken } from './auth-session';

const sdk = new DamSenApiClient({ baseUrl: apiBase });
const token = () =>
  ensureFreshAccessToken((refreshToken) => sdk.refresh({ refreshToken }));

/** Field verification calls; the access token is renewed automatically (15-minute tokens). */
export const fieldApi = {
  async listPois(): Promise<AdminPoi[]> {
    return sdk.listAdminPois(await token());
  },
  async listChecks(
    query: { poiId?: string; unappliedOnly?: boolean } = {},
  ): Promise<FieldCheck[]> {
    return sdk.listFieldChecks(await token(), query);
  },
  async createCheck(
    poiId: string,
    input: FieldCheckInput,
  ): Promise<FieldCheck> {
    return sdk.createFieldCheck(poiId, input, await token());
  },
  async createPoi(input: AdminPoiInput): Promise<AdminPoi> {
    return sdk.createAdminPoi(input, await token());
  },
  async submitPoi(id: string): Promise<AdminPoi> {
    return sdk.submitAdminPoi(id, await token());
  },
  async approveVersion(versionId: string): Promise<AdminPoi> {
    return sdk.approveContent(versionId, await token());
  },
  async rejectVersion(versionId: string, reason: string): Promise<AdminPoi> {
    return sdk.rejectContent(versionId, { reason }, await token());
  },
  async applyCheck(
    checkId: string,
    input: FieldCheckApplyInput,
  ): Promise<AdminPoi> {
    return sdk.applyFieldCheck(checkId, input, await token());
  },
};
