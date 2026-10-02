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
  if (walls.some((w) => !w || w.categoryId !== -2000011 || !w.solids?.length))
    return false;
  const segments = walls.flatMap((w) =>
    w!
      .solids!.filter(
        (s) =>
          s.baseElevation <= elevation + 0.05 &&
          s.topElevation >= elevation + 2,
      )
      .map((s) => ({ id: w!.elementId, s })),
  );
  // At least three actual wall pieces must surround the pin on this storey.
  // Openings may occupy up to three of the eight rays; a roof cannot be a stop.
  const hits = new Set<number>();
  let covered = 0;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4,
      dx = Math.cos(a),
      dy = Math.sin(a);
    let nearest = Infinity,
      wallId = 0;
    for (const { id, s } of segments) {
      const ex = s.end.x - s.start.x,
        ey = s.end.y - s.start.y,
        den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const ox = s.start.x - shaft.pointFeet[0],
        oy = s.start.y - shaft.pointFeet[1];
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
    walls: segments.map(({ s }) => {
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
  };
  // A nearby lobby behind a solid shaft wall is not a lift exit. Keep the
  // reviewed lobby point on the open side rather than snapping it to the pin.
  return (
    covered >= 5 &&
    hits.size >= 3 &&
    distance >= 1 &&
    distance <= 20 &&
    !nativeRouteBlocker(barriers, [])(shaft.pointFeet, entrance)
  );
}
