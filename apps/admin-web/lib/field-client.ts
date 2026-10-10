import { DamSenApiClient } from '@damsen/api-client';
import type {
  AdminPoi,
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
  async applyCheck(
    checkId: string,
    input: FieldCheckApplyInput,
  ): Promise<AdminPoi> {
    return sdk.applyFieldCheck(checkId, input, await token());
  },
};
