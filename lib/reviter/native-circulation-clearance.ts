import {
  nativeExactGeosOverlay,
  nativeExactGeosOverlayInitialized,
} from "./native-exact-geos-overlay.ts";
// JSTS publishes no typings; these ambient declarations keep its geometry operations checked.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./native-room-presentation-jsts.d.ts" />
import PrecisionModel from "jsts/org/locationtech/jts/geom/PrecisionModel.js";
import GeometryFactory from "jsts/org/locationtech/jts/geom/GeometryFactory.js";
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
function exactFloorDifference(floor: Rings, obstacles: Rings[]): Rings[] {
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
  return geometryParts(
    OverlayOp.overlayOp(subject, material, OverlayOp.DIFFERENCE),
  );
}

function exactFloorUnion(parts: Rings[]): Rings[] {
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

/** Coincident source diagonals can defeat a sweep intersection. The independent
 * zero-distance overlay keeps their exact area; it never closes a gap. */
function exactFloorIntersection(subject: Rings, parts: Rings[]): Rings[] {
  const reader = new GeoJSONReader(),
    params = new BufferParameters();
  const a = BufferOp.bufferOp(
    reader.read({ type: "Polygon", coordinates: closed(subject) }),
    0,
    params,
  );
  const b = BufferOp.bufferOp(
    reader.read({ type: "MultiPolygon", coordinates: parts.map(closed) }),
    0,
    params,
  );
  return geometryParts(OverlayOp.overlayOp(a, b, OverlayOp.INTERSECTION));
}
export type NativeOverlayPrecisionEvent = {
  operation: "difference" | "intersection" | "union";
  subject: Rings;
  parts: Rings[];
  gridFeet?: number;
  error: string;
};
let precisionRecorder:
  | ((event: NativeOverlayPrecisionEvent) => void)
  | undefined;
/** Optional evidence capture; no filesystem or authoring mutation in geometry. */
export function setNativeOverlayPrecisionRecorder(
  recorder: typeof precisionRecorder,
) {
  const previous = precisionRecorder;
  precisionRecorder = recorder;
  return previous;
}
function analyticalOverlay(
  operation: NativeOverlayPrecisionEvent["operation"],
  subject: Rings,
  parts: Rings[],
  error: unknown,
): Rings[] {
  const event = { operation, subject, parts, error: String(error) };
  precisionRecorder?.(event);
  if (nativeExactGeosOverlayInitialized())
    return nativeExactGeosOverlay(operation, [subject], [parts]);
  const origin = subject[0]?.[0];
  if (!origin) throw error;
  for (const grid of [1e-12, 1e-11, 1e-10]) {
    const collisions = new Map<string, RoomPoint[]>();
    let valid = true;
    const relative = (rings: Rings): Rings =>
      rings.map((r) => {
        const q = r.map((p) => {
          const dx = p[0] - origin[0],
            dy = p[1] - origin[1];
          if (
            Math.max(Math.abs(dx), Math.abs(dy)) / grid >
            Number.MAX_SAFE_INTEGER
          )
            valid = false;
          const point: [number, number] = [
            Math.round(dx / grid) * grid,
            Math.round(dy / grid) * grid,
          ];
          const key = point.join(",");
          const previous = collisions.get(key) ?? [];
          // A common grid may collapse only machine-precision duplicate contacts.
          // It must not join two deliberately distinct finite native vertices.
          for (const other of previous) {
            const ulp =
              4 *
              Number.EPSILON *
              Math.max(1, ...p.map(Math.abs), ...other.map(Math.abs));
            if (Math.hypot(p[0] - other[0], p[1] - other[1]) > ulp)
              valid = false;
          }
          previous.push(p);
          collisions.set(key, previous);
          return point;
        });
        if (new Set(q.map((p) => p.join(","))).size < 3) valid = false;
        return q;
      });
    const a = relative(subject),
      b = parts.map(relative);
    if (!valid) continue;
    try {
      const reader = new GeoJSONReader(
          new GeometryFactory(new PrecisionModel(1 / grid)),
        ),
        params = new BufferParameters();
      let result: Rings[];
      try {
        result = (
          operation === "difference"
            ? pc.difference(a, b)
            : operation === "intersection"
              ? pc.intersection(a, b)
              : pc.union(a, ...b)
        ) as Rings[];
      } catch {
        const x = BufferOp.bufferOp(
            reader.read({ type: "Polygon", coordinates: closed(a) }),
            0,
            params,
          ),
          y = BufferOp.bufferOp(
            reader.read({ type: "MultiPolygon", coordinates: b.map(closed) }),
            0,
            params,
          );
        result =
          operation === "difference"
            ? geometryParts(OverlayOp.overlayOp(x, y, OverlayOp.DIFFERENCE))
            : operation === "intersection"
              ? geometryParts(OverlayOp.overlayOp(x, y, OverlayOp.INTERSECTION))
              : geometryParts(
                  BufferOp.bufferOp(
                    reader.read({
                      type: "MultiPolygon",
                      coordinates: [closed(a), ...b.map(closed)],
                    }),
                    0,
                    params,
                  ),
                );
      }
      precisionRecorder?.({ ...event, gridFeet: grid });
      return result.map((r) =>
        r.map((h) =>
          h.map((p) => [p[0] + origin[0], p[1] + origin[1]] as RoomPoint),
        ),
      );
    } catch {
      /* A failed analytical noding remains unavailable; no wider grid. */
    }
  }
  throw error;
}
export function nativeFloorDifference(
  floor: Rings,
  obstacles: Rings[],
  options?: { strict: boolean },
): Rings[] {
  if (options?.strict) {
    try {
      return pc.difference(floor, ...obstacles) as Rings[];
    } catch {
      try {
        return nativeExactGeosOverlay("difference", [floor], [obstacles]);
      } catch {
        try {
          return nativeExactGeosOverlay("difference", [floor], [obstacles], {
            strategy: "sequential-difference",
          });
        } catch {
          return nativeExactGeosOverlay("difference", [floor], [obstacles], {
            strategy: "sequential-difference",
            maskOrder: "reverse",
          });
        }
      }
    }
  }
  try {
    return exactFloorDifference(floor, obstacles);
  } catch (error) {
    return analyticalOverlay("difference", floor, obstacles, error);
  }
}
export function nativeFloorUnion(
  parts: Rings[],
  options?: { strict: boolean },
): Rings[] {
  if (!parts.length) return [];
  if (options?.strict) {
    try {
      return pc.union(parts[0]!, ...parts.slice(1)) as Rings[];
    } catch {
      return nativeExactGeosOverlay("union", parts, []);
    }
  }
  try {
    return exactFloorUnion(parts);
  } catch (error) {
    return analyticalOverlay("union", parts[0]!, parts.slice(1), error);
  }
}
export function nativeFloorIntersection(
  subject: Rings,
  parts: Rings[],
  options?: { strict: boolean },
): Rings[] {
  if (!parts.length) return [];
  try {
    return pc.intersection(subject, parts) as Rings[];
  } catch {
    if (options?.strict)
      return nativeExactGeosOverlay("intersection", [subject], [parts]);
    try {
      return exactFloorIntersection(subject, parts);
    } catch (error) {
      return analyticalOverlay("intersection", subject, parts, error);
    }
  }
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
