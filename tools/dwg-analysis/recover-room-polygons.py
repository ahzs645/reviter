#!/usr/bin/env python3

import json
import re
import sys
from pathlib import Path

try:
    import ezdxf
    from ezdxf.path import make_path
    from shapely.geometry import LineString, Point
    from shapely.ops import polygonize, unary_union
except ImportError as exc:  # pragma: no cover - runtime dependency
    print(
        json.dumps(
            {
                "error": (
                    "Missing Python dependency for wall recovery. "
                    "Install with: python3 -m pip install --user ezdxf shapely"
                )
            }
        ),
        file=sys.stderr,
    )
    raise SystemExit(2) from exc


EPSILON = 1e-6


def compile_patterns(patterns):
    return [re.compile(pattern, re.IGNORECASE) for pattern in patterns]


def layer_matches(layer, patterns):
    if not layer:
        return False
    return any(pattern.search(layer) for pattern in patterns)


def point_inside_bbox(point, bbox):
    if not bbox or len(bbox) != 4:
        return False
    x, y = point
    return bbox[0] <= x <= bbox[2] and bbox[1] <= y <= bbox[3]


def bbox_intersects(left, right):
    if not left or not right:
        return False
    return not (
        left[2] < right[0]
        or right[2] < left[0]
        or left[3] < right[1]
        or right[3] < left[1]
    )


def inflate_bbox(bbox, margin):
    if not bbox or len(bbox) != 4:
        return bbox
    return [
        bbox[0] - margin,
        bbox[1] - margin,
        bbox[2] + margin,
        bbox[3] + margin,
    ]


def bbox_area(bbox):
    if not bbox or len(bbox) != 4:
        return 0.0
    width = max(0.0, float(bbox[2]) - float(bbox[0]))
    height = max(0.0, float(bbox[3]) - float(bbox[1]))
    return width * height


def polygon_aspect_ratio(polygon):
    min_x, min_y, max_x, max_y = polygon.bounds
    width = max(float(max_x) - float(min_x), EPSILON)
    height = max(float(max_y) - float(min_y), EPSILON)
    return max(width / height, height / width)


def normalize_text(value):
    return (value or "").strip().lower()


def is_transport_room(anchor):
    searchable = " ".join(
        [
            normalize_text(anchor.get("roomUse")),
            normalize_text(anchor.get("roomNumber")),
            normalize_text(anchor.get("rawRoomNumber")),
        ]
    )
    return any(token in searchable for token in ("stair", "elev", "lift"))


def score_polygon_candidate(anchor_point, polygon, match_mode, layout_area, anchor):
    distance = float(polygon.distance(anchor_point))
    area = float(polygon.area)
    aspect_ratio = polygon_aspect_ratio(polygon)
    transport_room = is_transport_room(anchor)

    area_fraction = area / layout_area if layout_area > 0 else 0.0
    sliver_penalty = 0.0
    if area_fraction > 0 and area_fraction < 0.001:
        sliver_penalty += (0.001 - area_fraction) * 10000.0
    if area_fraction > 0 and area_fraction < 0.00025:
        sliver_penalty += (0.00025 - area_fraction) * 50000.0

    aspect_threshold = 24.0 if transport_room else 10.0
    aspect_penalty = max(0.0, aspect_ratio - aspect_threshold) * (
        2.0 if transport_room else 6.0
    )

    if match_mode == "buffer":
        sliver_penalty += distance * 0.25

    if not transport_room and area_fraction > 0:
        # Strongly prefer candidates with meaningful footprint over wall strips.
        sliver_penalty += 1.0 / max(area_fraction * 1000.0, EPSILON)

    return (
        0 if match_mode == "contains" else 1,
        distance,
        sliver_penalty,
        aspect_penalty,
        -area,
    )


def dedupe_points(points):
    deduped = []
    for point in points:
        normalized = (float(point[0]), float(point[1]))
        if deduped and abs(deduped[-1][0] - normalized[0]) < EPSILON and abs(
            deduped[-1][1] - normalized[1]
        ) < EPSILON:
            continue
        deduped.append(normalized)
    return deduped


def entity_bbox(entity):
    entity_type = entity.dxftype()

    if entity_type == "LINE":
        start = entity.dxf.start
        end = entity.dxf.end
        return [
            min(start.x, end.x),
            min(start.y, end.y),
            max(start.x, end.x),
            max(start.y, end.y),
        ]

    if entity_type in {"LWPOLYLINE", "POLYLINE"}:
        points = extract_entity_vertices(entity)
        if not points:
            return None
        xs = [point[0] for point in points]
        ys = [point[1] for point in points]
        return [min(xs), min(ys), max(xs), max(ys)]

    if entity_type in {"ARC", "CIRCLE"}:
        center = entity.dxf.center
        radius = float(entity.dxf.radius)
        return [
            center.x - radius,
            center.y - radius,
            center.x + radius,
            center.y + radius,
        ]

    if entity_type == "ELLIPSE":
        center = entity.dxf.center
        major_axis = entity.dxf.major_axis
        major_radius = (major_axis.x ** 2 + major_axis.y ** 2) ** 0.5
        minor_radius = major_radius * float(entity.dxf.ratio)
        radius = max(major_radius, minor_radius)
        return [
            center.x - radius,
            center.y - radius,
            center.x + radius,
            center.y + radius,
        ]

    if entity_type == "SPLINE":
        points = [
            (float(point[0]), float(point[1]))
            for point in getattr(entity, "control_points", [])
        ]
        if not points:
            return None
        xs = [point[0] for point in points]
        ys = [point[1] for point in points]
        return [min(xs), min(ys), max(xs), max(ys)]

    return None


def extract_entity_vertices(entity):
    entity_type = entity.dxftype()
    if entity_type == "LWPOLYLINE":
        return [(float(x), float(y)) for x, y, *_ in entity.get_points("xyb")]
    if entity_type == "POLYLINE":
        return [
            (float(vertex.dxf.location.x), float(vertex.dxf.location.y))
            for vertex in entity.vertices
        ]
    return []


def entity_is_closed(entity):
    entity_type = entity.dxftype()
    if entity_type == "LWPOLYLINE":
        return bool(entity.closed)
    if entity_type == "POLYLINE":
        return bool(entity.is_closed)
    if entity_type == "CIRCLE":
        return True
    return False


def flatten_entity_points(entity, flatten_distance):
    entity_type = entity.dxftype()

    if entity_type == "LINE":
        start = entity.dxf.start
        end = entity.dxf.end
        return dedupe_points([(start.x, start.y), (end.x, end.y)])

    try:
        path = make_path(entity)
    except TypeError:
        return []

    points = dedupe_points(
        [(vertex.x, vertex.y) for vertex in path.flattening(flatten_distance)]
    )
    if entity_is_closed(entity) and points and points[0] != points[-1]:
        points.append(points[0])
    return points


def entity_to_segments(entity, flatten_distance):
    points = flatten_entity_points(entity, flatten_distance)
    if len(points) < 2:
        return []

    segments = []
    for index in range(len(points) - 1):
        start = points[index]
        end = points[index + 1]
        if (
            abs(start[0] - end[0]) < EPSILON
            and abs(start[1] - end[1]) < EPSILON
        ):
            continue
        segments.append((start, end))
    return segments


def load_request(path):
    return json.loads(Path(path).read_text())


def recover_room_polygons(request):
    dxf_path = Path(request["dxfPath"]).resolve()
    document = ezdxf.readfile(dxf_path)
    modelspace = document.modelspace()

    geometry_config = request.get("geometry", {})
    boundary_patterns = compile_patterns(geometry_config.get("boundaryLayers", []))
    layout_margin = float(geometry_config.get("layoutMargin", 0) or 0)
    flatten_distance = float(geometry_config.get("flattenDistance", 250) or 250)
    anchor_tolerance = float(geometry_config.get("anchorTolerance", 0) or 0)
    min_polygon_area = float(geometry_config.get("minPolygonArea", 0) or 0)
    max_polygon_area = geometry_config.get("maxPolygonArea")

    layout_windows = {
        layout["id"]: layout
        for layout in request.get("layoutWindows", [])
        if layout.get("id")
        and isinstance(layout.get("bbox"), list)
        and len(layout["bbox"]) == 4
        and not layout.get("isOverview")
    }

    anchors_by_layout = {}
    for anchor in request.get("roomAnchors", []):
        layout_id = anchor.get("layoutWindowId")
        position = anchor.get("cadPosition")
        if (
            not layout_id
            or layout_id not in layout_windows
            or not isinstance(position, list)
            or len(position) != 2
        ):
            continue
        anchors_by_layout.setdefault(layout_id, []).append(anchor)

    boundary_records = []
    for entity in modelspace:
        layer = getattr(entity.dxf, "layer", "")
        if boundary_patterns and not layer_matches(layer, boundary_patterns):
            continue

        bbox = entity_bbox(entity)
        if bbox is None:
            continue

        boundary_records.append(
            {
                "bbox": bbox,
                "entity": entity,
            }
        )

    recovered_polygons = []
    layout_stats = []

    for layout_id, anchors in anchors_by_layout.items():
        layout = layout_windows[layout_id]
        scoped_bbox = inflate_bbox(layout["bbox"], layout_margin)
        scoped_entities = [
            record["entity"]
            for record in boundary_records
            if bbox_intersects(record["bbox"], scoped_bbox)
        ]

        segments = []
        for entity in scoped_entities:
            segments.extend(entity_to_segments(entity, flatten_distance))

        shapely_lines = [
            LineString(segment)
            for segment in segments
            if len(segment) == 2
        ]

        polygons = []
        if shapely_lines:
            for polygon in polygonize(unary_union(shapely_lines)):
                if polygon.is_empty or polygon.area < min_polygon_area:
                    continue
                if max_polygon_area is not None and polygon.area > max_polygon_area:
                    continue

                representative_point = polygon.representative_point()
                if not point_inside_bbox(
                    (representative_point.x, representative_point.y),
                    scoped_bbox,
                ):
                    continue
                polygons.append(polygon)

        consumed_polygon_indexes = set()
        matched_anchor_count = 0
        buffered_match_count = 0
        scoped_layout_area = bbox_area(scoped_bbox)

        for anchor in anchors:
            anchor_point = Point(anchor["cadPosition"])
            candidates = []

            for polygon_index, polygon in enumerate(polygons):
                if polygon_index in consumed_polygon_indexes:
                    continue

                if polygon.contains(anchor_point) or polygon.touches(anchor_point):
                    candidates.append(
                        (
                            score_polygon_candidate(
                                anchor_point,
                                polygon,
                                "contains",
                                scoped_layout_area,
                                anchor,
                            ),
                            polygon_index,
                            polygon,
                            "contains",
                        )
                    )
                    continue

                if anchor_tolerance > 0:
                    distance = float(polygon.distance(anchor_point))
                    if distance <= anchor_tolerance:
                        candidates.append(
                            (
                                score_polygon_candidate(
                                    anchor_point,
                                    polygon,
                                    "buffer",
                                    scoped_layout_area,
                                    anchor,
                                ),
                                polygon_index,
                                polygon,
                                "buffer",
                            )
                        )

            if not candidates:
                continue

            _, chosen_index, chosen_polygon, match_mode = min(
                candidates, key=lambda item: item[0]
            )
            if match_mode == "buffer":
                buffered_match_count += 1

            consumed_polygon_indexes.add(chosen_index)
            matched_anchor_count += 1
            recovered_polygons.append(
                {
                    "anchorId": anchor["id"],
                    "layoutWindowId": layout_id,
                    "cadPoints": [
                        [float(x), float(y)]
                        for x, y in list(chosen_polygon.exterior.coords)[:-1]
                    ],
                    "cadRings": [[[float(x), float(y)] for x, y in ring.coords]
                                 for ring in [chosen_polygon.exterior, *chosen_polygon.interiors]],
                    "area": float(chosen_polygon.area),
                    "rawBounds": [
                        float(chosen_polygon.bounds[0]),
                        float(chosen_polygon.bounds[1]),
                        float(chosen_polygon.bounds[2]),
                        float(chosen_polygon.bounds[3]),
                    ],
                    "matchMode": match_mode,
                    "sourceEntity": "POLYGONIZE",
                    "sourceLayer": "wall-recovery",
                }
            )

        layout_stats.append(
            {
                "layoutWindowId": layout_id,
                "anchorCount": len(anchors),
                "boundaryEntityCount": len(scoped_entities),
                "segmentCount": len(segments),
                "polygonCount": len(polygons),
                "matchedAnchorCount": matched_anchor_count,
                "bufferedMatchCount": buffered_match_count,
            }
        )

    return {
        "recoveredPolygons": recovered_polygons,
        "stats": {
            "layoutCount": len(layout_stats),
            "boundaryEntityCount": len(boundary_records),
            "matchedAnchorCount": len(recovered_polygons),
            "layoutStats": layout_stats,
        },
    }


def main():
    if len(sys.argv) != 2:
        print(
            "Usage: recover-room-polygons.py <path/to/request.json>",
            file=sys.stderr,
        )
        raise SystemExit(1)

    request = load_request(sys.argv[1])
    print(json.dumps(recover_room_polygons(request), indent=2))


if __name__ == "__main__":
    main()
