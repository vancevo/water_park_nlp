import type { PoiRecord } from './poi.models.js';

const hours = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  opensAt: '08:00',
  closesAt: '18:00',
}));

interface FixtureInput {
  id: string;
  slug: string;
  category: string;
  viName: string;
  viSummary: string;
  enName: string;
  enSummary: string;
  longitude: number;
  latitude: number;
  node: string;
  entranceLongitude: number;
  entranceLatitude: number;
}

function fixture(input: FixtureInput): PoiRecord {
  const entranceId = input.id.replace(/1(\d\d)$/, '2$1');
  return {
    id: input.id,
    slug: input.slug,
    category: input.category,
    status: 'published',
    latitude: input.latitude,
    longitude: input.longitude,
    translations: {
      vi: {
        locale: 'vi',
        name: input.viName,
        shortDescription: input.viSummary,
        longDescription: `${input.viSummary} Tọa độ chỉ phục vụ nghiên cứu và cần được kiểm tra thực địa trước khi dùng để dẫn đường.`,
      },
      en: {
        locale: 'en',
        name: input.enName,
        shortDescription: input.enSummary,
        longDescription: `${input.enSummary} The coordinates are research references and require field verification before navigation use.`,
      },
    },
    entrances: [
      {
        id: entranceId,
        labelVi: 'Điểm vào gần lối đi OSM',
        labelEn: 'Nearest OSM walkway access',
        location: {
          latitude: input.entranceLatitude,
          longitude: input.entranceLongitude,
        },
        graphNodeRef: input.node,
        isPrimary: true,
        accessibility: 'standard',
      },
    ],
    operatingHours: hours.map((item) => ({ ...item })),
  };
}

export const POI_FIXTURES: readonly PoiRecord[] = [
  fixture({
    id: '00000000-0000-4000-8000-000000000101',
    slug: 'lau-dai',
    category: 'landmark',
    viName: 'Lâu Đài',
    viSummary:
      'Điểm tham quan được định vị theo đối tượng công khai trên OpenStreetMap.',
    enName: 'The Castle',
    enSummary: 'A landmark positioned from the public OpenStreetMap feature.',
    longitude: 106.6364528573,
    latitude: 10.7614385239,
    node: 'OSM-1274408728',
    entranceLongitude: 106.6363585,
    entranceLatitude: 10.761568,
  }),
  fixture({
    id: '00000000-0000-4000-8000-000000000102',
    slug: 'quang-truong-la-ma',
    category: 'landmark',
    viName: 'Quảng trường La Mã',
    viSummary: 'Quảng trường và điểm hẹn được định vị theo OpenStreetMap.',
    enName: 'Roman Square',
    enSummary: 'A square and meeting point positioned from OpenStreetMap.',
    longitude: 106.6368760878,
    latitude: 10.7666842395,
    node: 'OSM-11301680998',
    entranceLongitude: 106.6369184,
    entranceLatitude: 10.7666746,
  }),
  fixture({
    id: '00000000-0000-4000-8000-000000000103',
    slug: 'cinemax-8d',
    category: 'interactive',
    viName: 'Cinemax 8D',
    viSummary:
      'Khu phim tương tác được định vị theo đối tượng công khai trên OpenStreetMap.',
    enName: 'Cinemax 8D',
    enSummary:
      'An interactive cinema positioned from the public OpenStreetMap feature.',
    longitude: 106.6394141844,
    latitude: 10.7679152949,
    node: 'OSM-366406286',
    entranceLongitude: 106.6393441,
    entranceLatitude: 10.7673267,
  }),
  fixture({
    id: '00000000-0000-4000-8000-000000000104',
    slug: 'tham-hiem-vi-sao',
    category: 'thrill_ride',
    viName: 'Thám hiểm vì sao',
    viSummary:
      'Trò chơi cảm giác mạnh với vị trí tham khảo từ ảnh có tọa độ công khai.',
    enName: 'Space Adventure',
    enSummary:
      'A thrill ride positioned from a publicly geotagged reference photo.',
    longitude: 106.640444,
    latitude: 10.766306,
    node: 'OSM-3700972516',
    entranceLongitude: 106.6406945,
    entranceLatitude: 10.7660671,
  }),
  fixture({
    id: '00000000-0000-4000-8000-000000000105',
    slug: 'cong-1',
    category: 'landmark',
    viName: 'Cổng 1',
    viSummary:
      'Cổng vào phía đường Lạc Long Quân được đánh dấu trên OpenStreetMap.',
    enName: 'Gate 1',
    enSummary: 'The Lạc Long Quân-side entrance marked on OpenStreetMap.',
    longitude: 106.6418258,
    latitude: 10.7661062,
    node: 'OSM-3806809695',
    entranceLongitude: 106.6418258,
    entranceLatitude: 10.7661062,
  }),
];
