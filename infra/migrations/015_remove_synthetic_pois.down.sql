BEGIN;

INSERT INTO pois (id, slug, category_id, status, location, source) VALUES
  ('00000000-0000-4000-8000-000000000101', 'vuon-cau-vong', '10000000-0000-4000-8000-000000000001', 'published', ST_SetSRID(ST_MakePoint(106.63500, 10.76700), 4326)::geography, 'synthetic_fixture'),
  ('00000000-0000-4000-8000-000000000102', 'tram-kham-pha-nuoc', '10000000-0000-4000-8000-000000000002', 'published', ST_SetSRID(ST_MakePoint(106.63535, 10.76700), 4326)::geography, 'synthetic_fixture'),
  ('00000000-0000-4000-8000-000000000103', 'san-khau-gio', '10000000-0000-4000-8000-000000000003', 'published', ST_SetSRID(ST_MakePoint(106.63570, 10.76700), 4326)::geography, 'synthetic_fixture'),
  ('00000000-0000-4000-8000-000000000104', 'nha-kham-pha-xanh', '10000000-0000-4000-8000-000000000004', 'published', ST_SetSRID(ST_MakePoint(106.63535, 10.76730), 4326)::geography, 'synthetic_fixture'),
  ('00000000-0000-4000-8000-000000000105', 'quang-truong-may', '10000000-0000-4000-8000-000000000005', 'published', ST_SetSRID(ST_MakePoint(106.63570, 10.76730), 4326)::geography, 'synthetic_fixture')
ON CONFLICT (id) DO NOTHING;

INSERT INTO poi_translations (poi_id, locale, name, short_description, long_description) VALUES
  ('00000000-0000-4000-8000-000000000101', 'vi', 'Vườn Cầu Vồng', 'Khu vườn giả lập nhiều màu dành cho bài kiểm thử.', 'Khu vườn giả lập nhiều màu dành cho bài kiểm thử. Nội dung này là dữ liệu giả lập phục vụ phát triển và kiểm thử.'),
  ('00000000-0000-4000-8000-000000000101', 'en', 'Rainbow Garden', 'A colourful fictional garden used for testing.', 'A colourful fictional garden used for testing. This synthetic content is for development and testing only.'),
  ('00000000-0000-4000-8000-000000000102', 'vi', 'Trạm Khám Phá Nước', 'Điểm trưng bày giả lập về vòng tuần hoàn nước.', 'Điểm trưng bày giả lập về vòng tuần hoàn nước. Nội dung này là dữ liệu giả lập phục vụ phát triển và kiểm thử.'),
  ('00000000-0000-4000-8000-000000000102', 'en', 'Water Discovery Station', 'A fictional exhibit about the water cycle.', 'A fictional exhibit about the water cycle. This synthetic content is for development and testing only.'),
  ('00000000-0000-4000-8000-000000000103', 'vi', 'Sân Khấu Gió', 'Sân khấu mẫu dùng kiểm thử lịch và audio.', 'Sân khấu mẫu dùng kiểm thử lịch và audio. Nội dung này là dữ liệu giả lập phục vụ phát triển và kiểm thử.'),
  ('00000000-0000-4000-8000-000000000103', 'en', 'Wind Stage', 'A sample stage for schedule and audio tests.', 'A sample stage for schedule and audio tests. This synthetic content is for development and testing only.'),
  ('00000000-0000-4000-8000-000000000104', 'vi', 'Nhà Khám Phá Xanh', 'Không gian trong nhà giả lập cho gia đình.', 'Không gian trong nhà giả lập cho gia đình. Nội dung này là dữ liệu giả lập phục vụ phát triển và kiểm thử.'),
  ('00000000-0000-4000-8000-000000000104', 'en', 'Green Discovery House', 'A fictional indoor family space.', 'A fictional indoor family space. This synthetic content is for development and testing only.'),
  ('00000000-0000-4000-8000-000000000105', 'vi', 'Quảng Trường Mây', 'Mốc gặp mặt giả lập trong bộ dữ liệu mẫu.', 'Mốc gặp mặt giả lập trong bộ dữ liệu mẫu. Nội dung này là dữ liệu giả lập phục vụ phát triển và kiểm thử.'),
  ('00000000-0000-4000-8000-000000000105', 'en', 'Cloud Square', 'A fictional meeting landmark in the fixture.', 'A fictional meeting landmark in the fixture. This synthetic content is for development and testing only.')
ON CONFLICT (poi_id, locale) DO NOTHING;

INSERT INTO poi_entrances (id, poi_id, label_vi, label_en, location, graph_node_ref, is_primary, is_active, accessibility) VALUES
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101', 'Cổng chính', 'Main entrance', ST_SetSRID(ST_MakePoint(106.63500, 10.76700), 4326)::geography, 'N2', true, true, 'standard'),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000102', 'Cổng chính', 'Main entrance', ST_SetSRID(ST_MakePoint(106.63535, 10.76700), 4326)::geography, 'N3', true, true, 'standard'),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000103', 'Cổng chính', 'Main entrance', ST_SetSRID(ST_MakePoint(106.63570, 10.76700), 4326)::geography, 'N4', true, true, 'standard'),
  ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000104', 'Cổng không bậc', 'Step-free entrance', ST_SetSRID(ST_MakePoint(106.63535, 10.76730), 4326)::geography, 'N6', true, true, 'step_free'),
  ('00000000-0000-4000-8000-000000000205', '00000000-0000-4000-8000-000000000105', 'Cổng chính', 'Main entrance', ST_SetSRID(ST_MakePoint(106.63570, 10.76730), 4326)::geography, 'N7', true, true, 'standard')
ON CONFLICT (id) DO NOTHING;

INSERT INTO poi_operating_hours (poi_id, day_of_week, opens_at, closes_at)
SELECT fixture_id, day_of_week, time '08:00', time '18:00'
FROM unnest(ARRAY[
  '00000000-0000-4000-8000-000000000101'::uuid,
  '00000000-0000-4000-8000-000000000102'::uuid,
  '00000000-0000-4000-8000-000000000103'::uuid,
  '00000000-0000-4000-8000-000000000104'::uuid,
  '00000000-0000-4000-8000-000000000105'::uuid
]) AS fixture_id
CROSS JOIN generate_series(0, 6) AS day_of_week
ON CONFLICT (poi_id, day_of_week) DO NOTHING;

COMMIT;
