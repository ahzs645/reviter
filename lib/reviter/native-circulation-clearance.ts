// JSTS publishes no typings; these ambient declarations keep its geometry operations checked.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./native-room-presentation-jsts.d.ts" />
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import GeoJSONWriter from "jsts/org/locationtech/jts/io/GeoJSONWriter.js";
import BufferOp from "jsts/org/locationtech/jts/operation/buffer/BufferOp.js";
import BufferParameters from "jsts/org/locationtech/jts/operation/buffer/BufferParameters.js";
import OverlayOp from "jsts/org/locationtech/jts/operation/overlay/OverlayOp.js";
import pc from "polygon-clipping";
import type { RoomPoint } from "./room-directory.ts";
type Rings = RoomPoint[][];
const closed = (rings: Rings): Rings =>
  rings.map((r) =>
    r.length && (r[0]![0] !== r.at(-1)![0] || r[0]![1] !== r.at(-1)![1])
      ? [...r, r[0]!]
      : r,
  );
const geometryParts = (geometry: unknown): Rings[] => {
  const json = new GeoJSONWriter().write(geometry) as {
    type: string;
    coordinates: Rings | Rings[];
  };
  const parts =
    json.type === "MultiPolygon"
      ? (json.coordinates as Rings[])
      : json.type === "Polygon"
        ? [json.coordinates as Rings]
        : [];
  return parts.filter(
    (p) => p[0]?.length >= 3 && new Set(p[0].map((q) => q.join(","))).size >= 3,
  );
};

/** Independent exact overlay fallback for coincident native diagonals which
 * polygon-clipping cannot sweep. Zero-distance buffers dissolve material;
 * they do not dilate floors or join a physical gap. */
export function nativeFloorDifference(
  floor: Rings,
  obstacles: Rings[],
): Rings[] {
  const reader = new GeoJSONReader(),
    params = new BufferParameters();
  const subject = BufferOp.bufferOp(
    reader.read({ type: "Polygon", coordinates: closed(floor) }),
    0,
    params,
  );
  if (!obstacles.length) return geometryParts(subject);
  const material = BufferOp.bufferOp(
    reader.read({ type: "MultiPolygon", coordinates: obstacles.map(closed) }),
    0,
    params,
  );
  return geometryParts(OverlayOp.difference(subject, material));
}

export function nativeFloorUnion(parts: Rings[]): Rings[] {
  return geometryParts(
    BufferOp.bufferOp(
      new GeoJSONReader().read({
        type: "MultiPolygon",
        coordinates: parts.map(closed),
      }),
      0,
      new BufferParameters(),
    ),
  );
}
const precise = (rings: Rings): Rings =>
  rings.map((r) =>
    r.map(
      (p) =>
        [
          Math.round(p[0] * 1e6) / 1e6,
          Math.round(p[1] * 1e6) / 1e6,
        ] as RoomPoint,
    ),
  );

/** Separate physical floor components through which a two-foot walking strip
 * can pass. Erosion tests clearance; expansion restores native faces, clipped
 * back to the original physical floor. No source contour generates an edge,
 * no wall seam becomes a public passage, and no new floor is introduced. */
export function clearanceSeparatedNativeCells(
  rings: Rings,
  widthFeet = 2,
): Rings[] {
  const reader = new GeoJSONReader();
  const params = new BufferParameters();
  params.setJoinStyle(BufferParameters.JOIN_MITRE);
  const core = BufferOp.bufferOp(
    reader.read({ type: "Polygon", coordinates: closed(precise(rings)) }),
    -widthFeet / 2,
    params,
  );
  return geometryParts(core).flatMap((part) => {
    const expanded = geometryParts(
      BufferOp.bufferOp(
        reader.read({ type: "Polygon", coordinates: part }),
        widthFeet / 2,
        params,
      ),
    ).map(precise);
    return expanded.length
      ? (pc.intersection(precise(rings), expanded) as Rings[]).map(precise)
      : [];
  });
}
