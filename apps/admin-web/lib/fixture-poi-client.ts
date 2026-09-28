import {
  emptyPoiDraft,
  draftToAdminInput,
  type Poi,
  type PoiAdminClient,
} from './poi-contract';
const draft = emptyPoiDraft();
draft.slug = 'ho-cuu-long';
draft.category = 'attraction';
draft.entrances[0]!.graphNodeRef = 'N1';
draft.translations = [
  {
    locale: 'vi',
    name: 'Hồ Cửu Long',
    shortDescription: 'Điểm tham quan ven hồ.',
    longDescription: 'Khám phá cảnh quan Hồ Cửu Long.',
  },
  {
    locale: 'en',
    name: 'Nine Dragons Lake',
    shortDescription: 'A lakeside attraction.',
    longDescription: 'Explore the Nine Dragons Lake.',
  },
];
let records: Poi[] = [
  { ...draftToAdminInput(draft), id: 'demo-poi-1', status: 'draft' },
];
const copy = <T>(value: T): T => structuredClone(value);
export const fixturePoiClient: PoiAdminClient = {
  async list(query = {}) {
    const search = query.search?.toLowerCase();
    return copy(
      records.filter(
        (poi) =>
          (!query.status ||
            query.status === 'all' ||
            poi.status === query.status) &&
          (!query.category || poi.category === query.category) &&
          (!search ||
            poi.slug.includes(search) ||
            poi.translations.some((item) =>
              item.name.toLowerCase().includes(search),
            )),
      ),
    );
  },
  async get(id) {
    const item = records.find((poi) => poi.id === id);
    if (!item) throw new Error('Không tìm thấy POI demo.');
    return copy(item);
  },
  async create(input) {
    const item: Poi = {
      ...draftToAdminInput(input),
      id: crypto.randomUUID(),
      status: 'draft',
    };
    records = [item, ...records];
    return copy(item);
  },
  async update(id, input) {
    const before = records.find((poi) => poi.id === id);
    if (!before) throw new Error('Không tìm thấy POI demo.');
    const item: Poi = {
      ...draftToAdminInput(input),
      id,
      status: before.status,
      ...(before.pendingVersionId
        ? { pendingVersionId: before.pendingVersionId }
        : {}),
    };
    records = records.map((poi) => (poi.id === id ? item : poi));
    return copy(item);
  },
  async remove(id) {
    records = records.filter((poi) => poi.id !== id);
  },
  async submit(id) {
    const item = await this.get(id);
    const next = {
      ...item,
      status: 'pending_review' as const,
      pendingVersionId: crypto.randomUUID(),
    };
    records = records.map((poi) => (poi.id === id ? next : poi));
    return copy(next);
  },
  async approve(versionId) {
    const item = records.find((poi) => poi.pendingVersionId === versionId);
    if (!item) throw new Error('Không tìm thấy version demo.');
    const next = { ...item, status: 'published' as const };
    delete next.pendingVersionId;
    records = records.map((poi) => (poi.id === item.id ? next : poi));
    return copy(next);
  },
  async reject(versionId, reason) {
    const item = records.find((poi) => poi.pendingVersionId === versionId);
    if (!item) throw new Error('Không tìm thấy version demo.');
    const next = {
      ...item,
      status: 'rejected' as const,
      rejectionReason: reason,
    };
    delete next.pendingVersionId;
    records = records.map((poi) => (poi.id === item.id ? next : poi));
    return copy(next);
  },
};
