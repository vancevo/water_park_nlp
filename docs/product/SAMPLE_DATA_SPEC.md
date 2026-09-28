# Five-POI Vertical-Slice Seed Specification

- Status: Contract for T04/T20/T32 fixtures
- Data classification: synthetic, development/test only
- Coordinate system: WGS84 / EPSG:4326

The names, descriptions, geometry and audio below are fictional test data. They do not claim to represent current attractions, opening hours or official content of Dam Sen. They may be committed under the repository's project license because they are authored for this project. Production data requires provenance, owner permission and a license record.

## 1. Common rules

- IDs/slugs are stable across resets; import is idempotent.
- Every POI has `vi` and `en`, one active entrance, one placeholder image and one short project-owned audio fixture per locale.
- Seed media should be generated in-repository (tone/silence plus spoken-content transcript if needed), not downloaded from an unverified website.
- All coordinates are fixture coordinates near a synthetic test zone and must carry `source=synthetic_fixture`; they must not be shipped as authoritative park data.
- Time zone is `Asia/Ho_Chi_Minh`; sample hours are daily `08:00–18:00` and are not real business hours.

## 2. POI records

| Stable ID | Slug | Category | Vietnamese name / summary | English name / summary | Point (lon, lat) | Entrance node |
|---|---|---|---|---|---|---|
| `00000000-0000-4000-8000-000000000101` | `vuon-cau-vong` | `garden` | Vườn Cầu Vồng / Khu vườn giả lập nhiều màu dành cho bài kiểm thử. | Rainbow Garden / A colourful fictional garden used for testing. | `106.63500,10.76700` | `N2` |
| `00000000-0000-4000-8000-000000000102` | `tram-kham-pha-nuoc` | `exhibit` | Trạm Khám Phá Nước / Điểm trưng bày giả lập về vòng tuần hoàn nước. | Water Discovery Station / A fictional exhibit about the water cycle. | `106.63535,10.76700` | `N3` |
| `00000000-0000-4000-8000-000000000103` | `san-khau-gio` | `show` | Sân Khấu Gió / Sân khấu mẫu dùng kiểm thử lịch và audio. | Wind Stage / A sample stage for schedule and audio tests. | `106.63570,10.76700` | `N4` |
| `00000000-0000-4000-8000-000000000104` | `nha-kham-pha-xanh` | `indoor` | Nhà Khám Phá Xanh / Không gian trong nhà giả lập cho gia đình. | Green Discovery House / A fictional indoor family space. | `106.63535,10.76730` | `N6` |
| `00000000-0000-4000-8000-000000000105` | `quang-truong-may` | `landmark` | Quảng Trường Mây / Mốc gặp mặt giả lập trong bộ dữ liệu mẫu. | Cloud Square / A fictional meeting landmark in the fixture. | `106.63570,10.76730` | `N7` |

Long descriptions expand the corresponding summaries without factual claims. Search tags are likewise synthetic: `garden,family`, `water,education`, `show,music`, `indoor,family`, and `meeting,landmark`.

## 3. Entrance contract

Each entrance contains:

```text
id, poi_id, label_vi, label_en, location(Point,4326), graph_node_ref,
is_primary=true, is_active=true, accessibility in {standard, step_free}
```

Entrance geometry must be within 15 m of its referenced graph node. POI display points may differ from entrance points; routing always resolves the primary active entrance.

## 4. Deterministic walkway mini graph

Nodes:

| Node | lon, lat | Meaning |
|---|---|---|
| `N1` | `106.63470,10.76700` | simulated visitor start |
| `N2` | `106.63500,10.76700` | POI 101 entrance |
| `N3` | `106.63535,10.76700` | POI 102 entrance |
| `N4` | `106.63570,10.76700` | POI 103 entrance |
| `N5` | `106.63500,10.76730` | upper-west junction |
| `N6` | `106.63535,10.76730` | POI 104 entrance |
| `N7` | `106.63570,10.76730` | POI 105 entrance |

Bidirectional edges: `N1-N2`, `N2-N3`, `N3-N4`, `N2-N5`, `N3-N6`, `N4-N7`, `N5-N6`, `N6-N7`. Edge cost is derived from geodesic length; reverse cost equals forward cost. All are pedestrian/standard, except `N3-N6`, which is marked `stairs`; a step-free route must use the alternative connected edges. Tests may close `N3-N4` to verify exclusion/rerouting.

## 5. Content and media assertions

- `vi` and `en` are independently authored; neither is a runtime translation.
- Fixture narration transcript is 1–2 sentences and matches its locale description.
- Audio format contract: AAC-LC in `.m4a` or MP3, a supported MIME type, duration at most 30 seconds for fixtures, with SHA-256 and byte length recorded.
- Placeholder images contain no third-party brand or copyrighted park artwork and include descriptive alt text in both locales.
- At least one POI begins as `draft`; four may be `published` for public-read tests. Workflow tests publish the draft rather than mutating production state directly.

## 6. Fixture acceptance checklist

- [ ] Schema validation rejects missing locale, invalid coordinate and unknown graph node.
- [ ] Re-running the import neither duplicates nor silently mutates IDs.
- [ ] All active entrances snap within 15 m.
- [ ] Every POI is reachable from `N1` under the default profile.
- [ ] Step-free routing avoids `N3-N6`.
- [ ] Closing `N3-N4` still leaves a valid path to `N4`/`N7`.
- [ ] Fixture files contain license/provenance metadata and no claim of official Dam Sen accuracy.

