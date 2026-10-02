import type { ConvertResult, ElementBoundsRecord } from "./types.ts";
import {
  containsRoomPoint,
  roomArea,
  type RoomPoint,
} from "./room-directory.ts";

/** Revit profiles can have several separate shells, not just one exterior and
 * a list of holes. Containment depth distinguishes shells, voids and islands. */
export function nativeFloorPolygons(
  record: Pick<ElementBoundsRecord, "loops">,
): RoomPoint[][][] {
  const rings = (record.loops ?? [])
    .filter((r) => r.length >= 3)
    .map((r) => r.map((p) => [p[0], p[1]] as RoomPoint));
  const areas = rings.map(roomArea);
  const contains = (point: RoomPoint, ring: RoomPoint[]) =>
    containsRoomPoint(point, ring) ||
    ring.some((a, i) => {
      const b = ring[(i + 1) % ring.length]!,
        dx = b[0] - a[0],
        dy = b[1] - a[1];
      const t =
        ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) /
        (dx * dx + dy * dy || 1);
      return (
        t >= 0 &&
        t <= 1 &&
        Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy) < 1e-7
      );
    });
  const parents = rings.map((ring, index) => {
    const containers = rings
      .map((other, i) => ({ other, i }))
      .filter(
        ({ other, i }) =>
          i !== index &&
          areas[i]! > areas[index]! + 1e-8 &&
          ring.every((p) => contains(p, other)),
      );
    containers.sort((a, b) => areas[a.i]! - areas[b.i]!);
    return containers[0]?.i;
  });
  const depth = (index: number): number =>
    parents[index] === undefined ? 0 : 1 + depth(parents[index]!);
  return rings.flatMap((ring, i) =>
    depth(i) % 2
      ? []
      : [
          [
            ring,
            ...rings.filter((_, j) => parents[j] === i && depth(j) % 2 === 1),
          ],
        ],
  );
}

const FLOOR_CATEGORY = -2_000_032;
/** Persisted low slabs, including fixture tops, obstruct this walking plane. */
export function nativeLowSlabRecords(
  model: Pick<ConvertResult, "elementBounds">,
  z: number,
): ElementBoundsRecord[] {
  return model.elementBounds.filter(
    (r) =>
      r.categoryId === FLOOR_CATEGORY &&
      r.boundsFeet.min.z > z + 0.05 &&
      r.boundsFeet.min.z < z + 6 &&
      r.loops?.length &&
      r.loops.every((l) => l.length >= 3) &&
      r.loops.flat().every((p) => p.every(Number.isFinite)) &&
      Math.max(...r.loops.flat().map((p) => p[2])) -
        Math.min(...r.loops.flat().map((p) => p[2])) <
        0.05,
  );
}
const cache = new WeakMap<object, Map<number, ElementBoundsRecord[]>>();

/** Physical support cannot depend on an optional Revit level relationship.
 * Keep exact sketches and their holes; never substitute an element bounds box.
 * Flat-floor recovery excludes sloping sketches and slabs on another storey. */
export function routingFloorPlateRecords(
  model: Pick<ConvertResult, "elementBounds">,
  elevationFeet: number,
): ElementBoundsRecord[] {
  if (!Number.isFinite(elevationFeet)) return [];
  let elevations = cache.get(model);
  if (!elevations) {
    elevations = new Map();
    cache.set(model, elevations);
  }
  const saved = elevations.get(elevationFeet);
  if (saved) return saved;
  const records = model.elementBounds.filter((record) => {
    if (
      record.categoryId !== FLOOR_CATEGORY ||
      !Number.isFinite(record.boundsFeet.max.z) ||
      Math.abs(record.boundsFeet.max.z - elevationFeet) > 0.05 ||
      !record.loops?.length ||
      record.loops.some((loop) => loop.length < 3)
    )
      return false;
    const points = record.loops.flat();
    if (
      points.some(
        (point) =>
          point.length !== 3 || point.some((value) => !Number.isFinite(value)),
      )
    )
      return false;
    // The sketch may be stored at the slab's base, but must describe a flat
    // surface. A bounding top elevation alone cannot flatten a ramp.
    const zs = points.map((p) => p[2]);
    return Math.max(...zs) - Math.min(...zs) <= 0.05;
  });
  elevations.set(elevationFeet, records);
  return records;
}
