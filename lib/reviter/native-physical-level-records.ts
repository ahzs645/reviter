import pc from "polygon-clipping";

/** Mirror of openindoormaps app/indoor-project/native-physical-level-records.ts (keep identical). */
export const NATIVE_PHYSICAL_LEVEL_RECORDS_VERSION =
  "native-physical-level-records-v1";
/** A room may be labelled on a physical level within this vertical distance of
 * its own level only (a half-storey offset such as Floor 1.25 vs Floor 0.5). */
export const NATIVE_PHYSICAL_LEVEL_MAX_OFFSET_FEET = 7;
const SAME_PLANE_FEET = 0.05;

type Ring = [number, number][];
type Rings = Ring[];
type Floor = {
  nativeElementId: number;
  elevationFeet: number;
  ringsFeet: Rings;
  partsFeet?: Rings[];
};
type RecordLike = {
  key: string;
  levelId: number;
  elevationFeet: number;
  ringsFeet: Rings;
  stair: boolean;
  walkable: boolean;
};
export type NativePhysicalLevelData = {
  nativeLevels: { id: number; elevationFeet: number }[];
  records: RecordLike[];
  walkingSupport?: { floors: Floor[] };
  nativePhysicalLevels?: {
    levels: {
      nativeLevelId: number;
      elevationFeet: number;
      nativeFloorElementIds: number[];
    }[];
  };
};
export type NativePhysicalLevelAssignment = {
  roomKey: string;
  identityLevelId: number;
  physicalLevelId: number;
  ownSupportFraction: number;
  physicalSupportFraction: number;
  nativeFloorIds: number[];
};

const ringArea = (ring: Ring) => {
  const [x, y] = ring[0];
  return (
    Math.abs(
      ring.reduce((s, p, i) => {
        const q = ring[(i + 1) % ring.length];
        return s + (p[0] - x) * (q[1] - y) - (q[0] - x) * (p[1] - y);
      }, 0),
    ) / 2
  );
};
const area = (parts: Rings[]) =>
  parts.reduce(
    (sum, rings) =>
      sum +
      rings.reduce((a, ring, i) => a + (i ? -1 : 1) * ringArea(ring), 0),
    0,
  );
const box = (parts: Rings[]) => {
  const p = parts.flatMap((r) => r[0]);
  return [
    Math.min(...p.map((q) => q[0])),
    Math.min(...p.map((q) => q[1])),
    Math.max(...p.map((q) => q[0])),
    Math.max(...p.map((q) => q[1])),
  ];
};
const touches = (a: number[], b: number[]) =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const supported = (outline: Rings, floors: Floor[]) => {
  const b = box([outline]);
  const parts = floors
    .flatMap((f) => f.partsFeet ?? [f.ringsFeet])
    .filter((p) => p[0]?.length >= 3 && touches(box([p]), b));
  if (!parts.length) return 0;
  const union = parts.length === 1 ? [parts[0]] : pc.union(parts[0], ...parts.slice(1));
  return area(pc.intersection(outline, union as never) as Rings[]);
};

/** A registered room level is the room's directory and display identity. Its
 * native floor may still be an offset physical slab: a theatre whose stepped
 * floor descends to Floor 0.5 from its Floor 1.25 entrance, or a raised room.
 * When the identity outline is <50% on slabs at its own level's elevation and
 * >=50% on slabs that ONE other physical level lists (within a half-storey),
 * the room is labelled on that physical level. Nothing else changes: no floor
 * is invented, no geometry is cut, and levelId stays the identity. */
export function nativePhysicalLevelAssignment(
  data: NativePhysicalLevelData,
  record: RecordLike,
): NativePhysicalLevelAssignment | undefined {
  if (!data.nativePhysicalLevels || !data.walkingSupport) return undefined;
  if (record.stair || !record.walkable) return undefined;
  const own = data.nativeLevels.find((l) => l.id === record.levelId);
  const outline = record.ringsFeet;
  if (!own || !outline[0] || outline[0].length < 3) return undefined;
  const total = area([outline]);
  if (!(total > 0)) return undefined;
  try {
    const floors = data.walkingSupport.floors;
    const ownFraction =
      supported(
        outline,
        floors.filter(
          (f) => Math.abs(f.elevationFeet - own.elevationFeet) < SAME_PLANE_FEET,
        ),
      ) / total;
    if (ownFraction >= 0.5) return undefined;
    const candidates: NativePhysicalLevelAssignment[] = [];
    for (const level of data.nativePhysicalLevels.levels) {
      if (
        level.nativeLevelId === record.levelId ||
        Math.abs(level.elevationFeet - own.elevationFeet) >
          NATIVE_PHYSICAL_LEVEL_MAX_OFFSET_FEET
      )
        continue;
      const ids = new Set(level.nativeFloorElementIds);
      const slabs = floors.filter(
        (f) =>
          ids.has(f.nativeElementId) &&
          Math.abs(f.elevationFeet - level.elevationFeet) < SAME_PLANE_FEET,
      );
      if (!slabs.length) continue;
      const fraction = supported(outline, slabs) / total;
      if (fraction < 0.5) continue;
      const b = box([outline]);
      candidates.push({
        roomKey: record.key,
        identityLevelId: record.levelId,
        physicalLevelId: level.nativeLevelId,
        ownSupportFraction: ownFraction,
        physicalSupportFraction: fraction,
        nativeFloorIds: slabs
          .filter((f) => touches(box(f.partsFeet ?? [f.ringsFeet]), b))
          .map((f) => f.nativeElementId)
          .sort((a, c) => a - c),
      });
    }
    if (candidates.length === 1) return candidates[0];
    // Stacked slabs: only the one carrying the room's own surface evidence.
    const matching = candidates.filter(
      (c) =>
        Math.abs(
          data.nativeLevels.find((l) => l.id === c.physicalLevelId)!
            .elevationFeet - record.elevationFeet,
        ) < SAME_PLANE_FEET,
    );
    return matching.length === 1 ? matching[0] : undefined;
  } catch {
    /* Invalid source polygons keep their identity level. */
    return undefined;
  }
}

const cache = new WeakMap<
  object,
  {
    records: unknown;
    floors: unknown;
    physical: unknown;
    levels: unknown;
    byKey: Map<string, NativePhysicalLevelAssignment>;
  }
>();
/** All reassigned rooms, keyed by room key (cached per dataset arrays). */
export function nativePhysicalLevelAssignments(
  data: NativePhysicalLevelData,
): Map<string, NativePhysicalLevelAssignment> {
  const previous = cache.get(data);
  if (
    previous &&
    previous.records === data.records &&
    previous.floors === data.walkingSupport?.floors &&
    previous.physical === data.nativePhysicalLevels &&
    previous.levels === data.nativeLevels
  )
    return previous.byKey;
  const byKey = new Map<string, NativePhysicalLevelAssignment>();
  for (const record of data.records) {
    const a = nativePhysicalLevelAssignment(data, record);
    if (a) byKey.set(record.key, a);
  }
  cache.set(data, {
    records: data.records,
    floors: data.walkingSupport?.floors,
    physical: data.nativePhysicalLevels,
    levels: data.nativeLevels,
    byKey,
  });
  return byKey;
}
/** The level a room's native area is labelled on. */
export function nativeRecordPhysicalLevelId(
  data: NativePhysicalLevelData,
  record: RecordLike,
) {
  return (
    nativePhysicalLevelAssignments(data).get(record.key)?.physicalLevelId ??
    record.levelId
  );
}
/** Records labelled on this physical level, in dataset order. */
export function nativePhysicalLevelRecords<R extends RecordLike>(
  data: NativePhysicalLevelData & { records: R[] },
  levelId: number,
): R[] {
  const moved = nativePhysicalLevelAssignments(data);
  return (data.records as R[]).filter(
    (r) => (moved.get(r.key)?.physicalLevelId ?? r.levelId) === levelId,
  );
}
