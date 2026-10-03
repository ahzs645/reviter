import { nativeMeshBarrierCuts } from "./native-mesh-barrier-cuts.ts";
import type { ConvertResult } from "./types.ts";
import {
  containsRoomPoint,
  nativeRouteBlocker,
  type RoomPoint,
} from "./room-directory.ts";

/** A user identifies the lift; native walls and slabs verify its physical stops.
 * This is deliberately separate from discovery of a native elevator family. */
export type ReviewedShaft = {
  pinId: string;
  pointFeet: RoomPoint;
  wallElementIds: number[];
};

export function validReviewedShaft(value: unknown): value is ReviewedShaft {
  const s = value as ReviewedShaft;
  return (
    !!s &&
    typeof s.pinId === "string" &&
    !!s.pinId.trim() &&
    s.pinId.length <= 200 &&
    Array.isArray(s.pointFeet) &&
    s.pointFeet.length === 2 &&
    s.pointFeet.every((p) => Number.isFinite(p) && Math.abs(p) < 1e7) &&
    Array.isArray(s.wallElementIds) &&
    s.wallElementIds.length >= 3 &&
    s.wallElementIds.length <= 100 &&
    new Set(s.wallElementIds).size === s.wallElementIds.length &&
    s.wallElementIds.every((id) => Number.isSafeInteger(id) && id > 0)
  );
}

const shaftCuts = new WeakMap<
  ConvertResult,
  Map<string, ReturnType<typeof nativeMeshBarrierCuts>>
>();
function shaftMaterial(
  model: ConvertResult,
  shaft: ReviewedShaft,
  elevation: number,
) {
  if (!model.meshes?.length || !model.origin) return [];
  let cache = shaftCuts.get(model);
  if (!cache) shaftCuts.set(model, (cache = new Map()));
  const key = `${elevation}:${[...shaft.wallElementIds].sort((a, b) => a - b).join(",")}`;
  if (!cache.has(key)) {
    const ids = new Set(shaft.wallElementIds);
    const hosts = new Map<number, Set<number>>();
    for (const relation of model.nativeHostRelations ?? []) {
      if (relation.evidence !== "persisted") continue;
      const owners = hosts.get(relation.elementId) ?? new Set<number>();
      owners.add(relation.hostId);
      hosts.set(relation.elementId, owners);
    }
    // Glass and frame members are physical material too. Require unique native
    // parentage and closed native BRep cuts; the curtain container is no proof.
    const curtainHosts = new Set(
      model.elementBounds
        .filter((e) => ids.has(e.elementId) && e.wallKind === "curtain")
        .map((e) => e.elementId),
    );
    const memberHost = (id: number) => {
      const owners = hosts.get(id);
      return owners?.size === 1 && curtainHosts.has([...owners][0]!)
        ? [...owners][0]
        : undefined;
    };
    const records = model.elementBounds.filter(
      (e) =>
        ids.has(e.elementId) ||
        (memberHost(e.elementId) !== undefined &&
          [-2000170, -2000171].includes(e.categoryId ?? 0)),
    );
    const cuts = nativeMeshBarrierCuts(
      { ...model, elementBounds: records },
      0,
      elevation + 2,
    );
    cache.set(
      key,
      cuts.map((c) => ({
        ...c,
        nativeElementId: memberHost(c.nativeElementId) ?? c.nativeElementId,
      })),
    );
  }
  return cache.get(key)!;
}
export function supportedShaftStop(
  model: ConvertResult,
  shaft: ReviewedShaft,
  floorId: number,
  entrance: RoomPoint,
  elevation: number,
) {
  if (!Number.isFinite(elevation)) return false;
  const floor = model.elementBounds.find((e) => e.elementId === floorId);
  if (
    !floor ||
    floor.categoryId !== -2000032 ||
    Math.abs(floor.boundsFeet.max.z - elevation) > 0.15
  )
    return false;
  const loops = floor.loops?.map((loop) =>
    loop.map((p) => [p[0], p[1]] as RoomPoint),
  );
  if (
    !loops?.[0] ||
    !containsRoomPoint(entrance, loops[0]) ||
    loops.slice(1).some((h) => containsRoomPoint(entrance, h))
  )
    return false;
  const walls = shaft.wallElementIds.map((id) =>
    model.elementBounds.find((e) => e.elementId === id),
  );
  if (walls.some((w) => !w || w.categoryId !== -2000011)) return false;
  const material = shaftMaterial(model, shaft, elevation).filter(
    (w) => w.ringsFeet.length === 1,
  );
  const materialIds = new Set(material.map((w) => w.nativeElementId));
  const segments = walls.flatMap((w) =>
    (materialIds.has(w!.elementId) ? [] : (w!.solids ?? []))
      .filter(
        (s) =>
          s.baseElevation <= elevation + 0.05 &&
          s.topElevation >= elevation + 2,
      )
      .map((s) => ({ id: w!.elementId, s })),
  );
  // Certified native BRep sections retain complete wall faces when recovered
  // centre-plane solids describe only a short return (e.g. a shaft back wall).
  // Never stretch that return to its bounding box or bridge a lift opening.
  const rays = [
    ...segments.map(({ id, s }) => ({
      id,
      start: [s.start.x, s.start.y] as RoomPoint,
      end: [s.end.x, s.end.y] as RoomPoint,
    })),
    ...material.flatMap((w) =>
      w.ringsFeet[0]!.map((a, i, ring) => ({
        id: w.nativeElementId,
        start: a,
        end: ring[(i + 1) % ring.length]!,
      })),
    ),
  ];
  // At least three actual wall pieces must surround the pin on this storey.
  // Sample narrow wall returns between opposing doorways as well as the long
  // side walls. Eight compass rays can miss those returns in a real shaft.
  // Preserve the required 5/8 angular enclosure; a roof cannot be a stop.
  const rayCount = 32;
  const hits = new Set<number>();
  let covered = 0;
  for (let i = 0; i < rayCount; i++) {
    const a = (i * Math.PI * 2) / rayCount,
      dx = Math.cos(a),
      dy = Math.sin(a);
    let nearest = Infinity,
      wallId = 0;
    for (const { id, start, end } of rays) {
      const ex = end[0] - start[0],
        ey = end[1] - start[1],
        den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const ox = start[0] - shaft.pointFeet[0],
        oy = start[1] - shaft.pointFeet[1];
      const t = (ox * ey - oy * ex) / den,
        u = (ox * dy - oy * dx) / den;
      if (t > 0 && t < nearest && u >= 0 && u <= 1) {
        nearest = t;
        wallId = id;
      }
    }
    if (nearest <= 20) {
      covered++;
      hits.add(wallId);
    }
  }
  const distance = Math.hypot(
    entrance[0] - shaft.pointFeet[0],
    entrance[1] - shaft.pointFeet[1],
  );
  const barriers = {
    columns: [],
    walls: [
      ...material.map((w) => ({ polygon: w.ringsFeet[0]! })),
      ...segments.map(({ s }) => {
        const dx = s.end.x - s.start.x,
          dy = s.end.y - s.start.y,
          length = Math.hypot(dx, dy);
        const nx = ((-dy / length) * s.thickness) / 2,
          ny = ((dx / length) * s.thickness) / 2;
        return {
          polygon: [
            [s.start.x + nx, s.start.y + ny],
            [s.end.x + nx, s.end.y + ny],
            [s.end.x - nx, s.end.y - ny],
            [s.start.x - nx, s.start.y - ny],
          ] as RoomPoint[],
        };
      }),
    ],
  };
  // A nearby lobby behind a solid shaft wall is not a lift exit. Keep the
  // reviewed lobby point on the open side rather than snapping it to the pin.
  return (
    covered >= Math.ceil((rayCount * 5) / 8) &&
    hits.size >= 3 &&
    distance >= 1 &&
    distance <= 20 &&
    !nativeRouteBlocker(barriers, [])(shaft.pointFeet, entrance)
  );
}
