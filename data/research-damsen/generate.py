#!/usr/bin/env python3
"""Generate a deterministic research-only Dam Sen dataset.

Names/categories are factual references from public official pages. Every
coordinate, entrance and walkway edge is synthetic and must not be used for
real navigation.
"""

from __future__ import annotations

import json
import math
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parent
NAMESPACE = uuid.UUID("83d56290-4775-4ac1-9145-591ed2b0f043")
CENTER_LNG = 106.6350
CENTER_LAT = 10.7670
SPACING = 0.00055

SOURCES = {
    "official_home": "https://damsenpark.vn/",
    "thrill": "https://damsenpark.vn/tro-choi-cam-giac-manh/",
    "entertainment": "https://damsenpark.vn/category/cac-tro-choi-tai-cong-vien-van-hoa-dam-sen/tro-choi-giai-tri-dam-sen-kho/",
    "virtual": "https://damsenpark.vn/category/cac-tro-choi-tai-cong-vien-van-hoa-dam-sen/tro-choi-tuong-tac-ao-dam-sen-kho/",
    "children": "https://damsenpark.vn/tro-choi-lien-hoan/",
    "stage": "https://damsenpark.vn/lien-hoan-ban-nhac-sinh-vien-2019-chao-mung-quoc-khanh/",
}

# Descriptions and English labels below are newly written for this dataset;
# they are not copied from the linked pages.
CATALOG = [
    ("thuy-cung", "Thủy cung", "Aquarium", "exhibit", "official_home", "Điểm tham quan chủ đề sinh vật thủy sinh."),
    ("bang-dang", "Băng đăng", "Ice Sculpture Hall", "exhibit", "entertainment", "Không gian tham quan các tác phẩm điêu khắc băng."),
    ("du-quay-dung", "Đu quay đứng Ferris wheel", "Ferris Wheel", "ride", "entertainment", "Trò chơi vòng quay quan sát từ trên cao."),
    ("monorail", "Monorail", "Monorail", "ride", "entertainment", "Tuyến tàu tham quan trong khu vui chơi."),
    ("dap-vit-pedalo", "Đạp vịt Pedalo", "Pedalo Boats", "ride", "entertainment", "Hoạt động đạp thuyền giải trí trên mặt nước."),
    ("lau-dai-ky-thu", "Lâu đài kỳ thú", "Wonder Castle", "interactive", "virtual", "Khu trải nghiệm tương tác dành cho nhiều nhóm tuổi."),
    ("cinemax-8d", "Cinemax 8D", "Cinemax 8D", "interactive", "virtual", "Không gian phim tương tác với hiệu ứng chuyển động."),
    ("9d-virtual-reality", "9D Virtual Reality", "9D Virtual Reality", "interactive", "virtual", "Trải nghiệm nội dung thực tế ảo đa chiều."),
    ("turbo-racing", "Đua xe Turbo Racing", "Turbo Racing", "interactive", "virtual", "Trò chơi mô phỏng điều khiển xe đua."),
    ("run-raider", "Bắn súng Run Raider", "Run Raider", "interactive", "virtual", "Trò chơi bắn súng tương tác theo nhóm."),
    ("tau-luon-sieu-toc", "Tàu lượn siêu tốc", "Roller Coaster", "thrill_ride", "thrill", "Trò chơi tàu lượn dành cho người đáp ứng điều kiện an toàn."),
    ("tau-vuot-thac", "Tàu vượt thác", "Log Flume", "thrill_ride", "thrill", "Trò chơi đường nước có các đoạn lên và xuống dốc."),
    ("tau-xoay-cao-toc", "Tàu xoay cao tốc", "Spinning Coaster", "thrill_ride", "thrill", "Trò chơi tàu chạy tốc độ cao kết hợp chuyển động xoay."),
    ("ca-chep-nhao-lon", "Cá chép nhào lộn", "Flying Carp", "thrill_ride", "thrill", "Trò chơi chuyển động mạnh theo vòng quay."),
    ("phuong-hoang-bay", "Phượng hoàng bay", "Flying Phoenix", "thrill_ride", "thrill", "Trò chơi cảm giác mạnh với chuyển động trên cao."),
    ("tham-bay", "Thảm bay", "Flying Carpet", "thrill_ride", "thrill", "Trò chơi chuyển động qua lại và nâng cao."),
    ("vong-quay-khong-gian", "Vòng quay không gian", "Space Spinner", "thrill_ride", "thrill", "Trò chơi vòng quay tốc độ cao."),
    ("xe-dien-dung", "Xe điện đụng", "Bumper Cars", "ride", "entertainment", "Khu điều khiển xe điện va chạm giải trí."),
    ("kids-playground", "Kids Playground", "Kids Playground", "children", "children", "Khu vận động và vui chơi dành cho trẻ em."),
    ("pokids", "Trạm không gian sáng tạo Pokids", "Pokids Creative Station", "children", "children", "Khu hoạt động sáng tạo và khám phá cho trẻ em."),
    ("nam-tu-thuong-uyen", "Nam Tú Thượng Uyển", "Nam Tu Garden", "garden", "official_home", "Không gian vườn cảnh phục vụ tham quan."),
    ("quang-truong-la-ma", "Quảng trường La Mã", "Roman Square", "landmark", "entertainment", "Không gian quảng trường và điểm hẹn trong công viên."),
    ("san-khau-ngoi-sao", "Sân khấu Ngôi Sao", "Star Stage", "show", "stage", "Khu vực tổ chức chương trình biểu diễn và sự kiện."),
    ("cong-1a", "Cổng 1A", "Gate 1A", "entrance", "official_home", "Một trong các cổng được website chính thức nhắc đến."),
]


def point(row: int, column: int) -> tuple[float, float]:
    return (
        round(CENTER_LNG + (column - 2) * SPACING, 6),
        round(CENTER_LAT + (row - 2) * SPACING, 6),
    )


def stable_id(kind: str, value: str) -> str:
    return str(uuid.uuid5(NAMESPACE, f"{kind}:{value}"))


def distance_meters(a: tuple[float, float], b: tuple[float, float]) -> float:
    latitude = math.radians((a[1] + b[1]) / 2)
    dx = (b[0] - a[0]) * 111_320 * math.cos(latitude)
    dy = (b[1] - a[1]) * 110_540
    return round(math.hypot(dx, dy), 2)


def feature_collection(name: str, features: list[dict]) -> dict:
    return {
        "type": "FeatureCollection",
        "name": name,
        "research_only": True,
        "navigation_use": "prohibited_until_field_verified",
        "features": features,
    }


def main() -> None:
    nodes = []
    node_coordinates: dict[str, tuple[float, float]] = {}
    for row in range(5):
        for column in range(5):
            node_ref = f"R{row * 5 + column + 1:02d}"
            coordinate = point(row, column)
            node_coordinates[node_ref] = coordinate
            nodes.append(
                {
                    "type": "Feature",
                    "id": stable_id("node", node_ref),
                    "geometry": {"type": "Point", "coordinates": coordinate},
                    "properties": {
                        "external_id": node_ref,
                        "coordinate_accuracy": "synthetic_approximation",
                        "field_verified": False,
                    },
                }
            )

    edges = []
    edge_number = 1
    for row in range(5):
        for column in range(5):
            current = f"R{row * 5 + column + 1:02d}"
            neighbors = []
            if column < 4:
                neighbors.append(f"R{row * 5 + column + 2:02d}")
            if row < 4:
                neighbors.append(f"R{(row + 1) * 5 + column + 1:02d}")
            for target in neighbors:
                start = node_coordinates[current]
                end = node_coordinates[target]
                length = distance_meters(start, end)
                edges.append(
                    {
                        "type": "Feature",
                        "id": stable_id("edge", f"{current}-{target}"),
                        "geometry": {"type": "LineString", "coordinates": [start, end]},
                        "properties": {
                            "external_id": f"RE{edge_number:02d}",
                            "source": current,
                            "target": target,
                            "length_m": length,
                            "cost": length,
                            "reverse_cost": length,
                            "status": "research_only",
                            "accessibility": "unknown",
                            "field_verified": False,
                        },
                    }
                )
                edge_number += 1

    pois = []
    entrances = []
    for index, (slug, name_vi, name_en, category, source, description_vi) in enumerate(CATALOG):
        node_ref = f"R{index + 1:02d}"
        coordinate = node_coordinates[node_ref]
        poi_id = stable_id("poi", slug)
        entrance_id = stable_id("entrance", slug)
        pois.append(
            {
                "type": "Feature",
                "id": poi_id,
                "geometry": {"type": "Point", "coordinates": coordinate},
                "properties": {
                    "slug": slug,
                    "category": category,
                    "status": "draft",
                    "source": "official_fact_research",
                    "source_url": SOURCES[source],
                    "source_checked_at": "2026-09-25",
                    "coordinate_accuracy": "synthetic_approximation",
                    "field_verified": False,
                    "navigation_use": "prohibited_until_field_verified",
                    "translations": {
                        "vi": {
                            "name": name_vi,
                            "short_description": description_vi,
                            "long_description": f"{description_vi} Nội dung nghiên cứu được viết mới; vị trí trên bản đồ hiện là giả lập.",
                        },
                        "en": {
                            "name": name_en,
                            "short_description": "Research-only attraction record with an approximate synthetic position.",
                            "long_description": "This original research description does not reproduce official promotional copy. The map position is synthetic and must not be used for navigation.",
                        },
                    },
                },
            }
        )
        entrances.append(
            {
                "type": "Feature",
                "id": entrance_id,
                "geometry": {"type": "Point", "coordinates": coordinate},
                "properties": {
                    "poi_id": poi_id,
                    "label_vi": "Lối vào nghiên cứu",
                    "label_en": "Research entrance",
                    "graph_node_ref": node_ref,
                    "is_primary": True,
                    "is_active": True,
                    "accessibility": "unknown",
                    "field_verified": False,
                },
            }
        )

    outputs = {
        "pois.geojson": feature_collection("damsen_research_pois", pois),
        "entrances.geojson": feature_collection("damsen_research_entrances", entrances),
        "walk_nodes.geojson": feature_collection("damsen_research_walk_nodes", nodes),
        "walk_edges.geojson": feature_collection("damsen_research_walk_edges", edges),
        "sources.json": {
            "generated_at": "2026-09-25",
            "policy": "Names/categories are factual references. Descriptions and all geometry are newly generated.",
            "sources": SOURCES,
        },
    }
    for filename, payload in outputs.items():
        (ROOT / filename).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    print(
        f"Generated {len(pois)} research POIs, {len(nodes)} nodes and {len(edges)} edges."
    )


if __name__ == "__main__":
    main()
