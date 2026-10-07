import pc from "polygon-clipping";
import type { IndoorDataset } from "./indoor-contract.ts";

type Point = [number, number];
type Rings = Point[][];
type Door = NonNullable<IndoorDataset["doors"]>[number];
/** Measured selection/display threshold correction. Never a physical wall,
 * physical door change, route permission or change to portal metadata. */
export type NativeDoorBoundaryClosures = {
  version: 1;
  sourceModelSha256: string;
  doors: {
    id: string;
    levelId: number;
    nativeElementId: number;
    /** Closes an evidenced unmatched threshold for selection only; admits no route. */
    selectionBarrierOnly?: true;
    /** Explicit measured exception for a supported two-sided portal; default 0.15 ft. */
    measuredTangentLimitFeet?: number;
    originalDoor: {
      pointFeet: Point;
      normalFeet: Point;
      footprintFeet: Point[];
      roomKeys: string[];
    };
    footprintFeet: Point[];
    jambEvidence: { nativeElementId: number; ringsFeet: Rings }[];
    evidenceSha256: string;
    notes: string;
  }[];
};
const point = (p: unknown): p is Point =>
  Array.isArray(p) &&
  p.length === 2 &&
  p.every(
    (n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e7,
  );
const ringArea = (r: Point[]) =>
  Math.abs(
    r.reduce((s, p, i) => {
      const q = r[(i + 1) % r.length]!;
      return s + p[0] * q[1] - q[0] * p[1];
    }, 0),
  ) / 2;
const area = (parts: Rings[]) =>
  parts.reduce(
    (s, r) =>
      s + ringArea(r[0]!) - r.slice(1).reduce((n, h) => n + ringArea(h), 0),
    0,
  );
const bounds = (ps: Point[], u: Point) =>
  [
    Math.min(...ps.map((p) => p[0] * u[0] + p[1] * u[1])),
    Math.max(...ps.map((p) => p[0] * u[0] + p[1] * u[1])),
  ] as [number, number];
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const hash = (s: string) => /^[a-f0-9]{64}$/.test(s);
const validFoot = (r: Point[]) =>
  Array.isArray(r) && r.length === 4 && r.every(point) && ringArea(r) > 1e-8;
const error = (message: string): never => {
  throw new Error(`Invalid native door boundary closure: ${message}`);
};

export function validateNativeDoorBoundaryClosures(
  value: unknown,
  modelSha?: string,
): asserts value is NativeDoorBoundaryClosures | undefined {
  if (value === undefined) return;
  const v = value as NativeDoorBoundaryClosures;
  if (
    !v ||
    v.version !== 1 ||
    !hash(v.sourceModelSha256) ||
    (modelSha !== undefined && modelSha !== v.sourceModelSha256) ||
    !Array.isArray(v.doors) ||
    v.doors.length > 10000
  )
    error("source identity or payload");
  const ids = new Set<string>();
  for (const d of v.doors) {
    const key = `${d.levelId}:${d.nativeElementId}`;
    if (
      !d ||
      typeof d.id !== "string" ||
      !d.id ||
      d.id.length > 200 ||
      !Number.isSafeInteger(d.levelId) ||
      !Number.isSafeInteger(d.nativeElementId) ||
      d.nativeElementId <= 0 ||
      ids.has(key) ||
      (d.measuredTangentLimitFeet !== undefined &&
        (typeof d.measuredTangentLimitFeet !== "number" ||
          !Number.isFinite(d.measuredTangentLimitFeet) ||
          d.measuredTangentLimitFeet < 0.15 ||
          d.measuredTangentLimitFeet > 0.2 ||
          d.selectionBarrierOnly === true)) ||
      !d.originalDoor ||
      !point(d.originalDoor.pointFeet) ||
      !point(d.originalDoor.normalFeet) ||
      Math.hypot(...d.originalDoor.normalFeet) < 1e-9 ||
      !validFoot(d.originalDoor.footprintFeet) ||
      !validFoot(d.footprintFeet) ||
      !Array.isArray(d.originalDoor.roomKeys) ||
      (d.selectionBarrierOnly !== undefined && d.selectionBarrierOnly !== true) ||
      d.originalDoor.roomKeys.length !== (d.selectionBarrierOnly ? 1 : 2) ||
      new Set(d.originalDoor.roomKeys).size !== d.originalDoor.roomKeys.length ||
      d.originalDoor.roomKeys.some((k) => typeof k !== "string" || !k) ||
      !Array.isArray(d.jambEvidence) ||
      d.jambEvidence.length !== 2 ||
      new Set(d.jambEvidence.map((j) => j.nativeElementId)).size !== 2 ||
      d.jambEvidence.some(
        (j) =>
          !j ||
          !Number.isSafeInteger(j.nativeElementId) ||
          j.nativeElementId <= 0 ||
          !Array.isArray(j.ringsFeet) ||
          j.ringsFeet.length !== 1 ||
          !validFoot(j.ringsFeet[0]!),
      ) ||
      !hash(d.evidenceSha256) ||
      typeof d.notes !== "string" ||
      !d.notes.trim() ||
      d.notes.length > 10000
    )
      error("geometry evidence or duplicate door");
    ids.add(key);
    const n: Point = d.originalDoor.normalFeet.map(
      (x) => x / Math.hypot(...d.originalDoor.normalFeet),
    ) as Point;
    const t: Point = [-n[1], n[0]];
    const oldT = bounds(d.originalDoor.footprintFeet, t),
      newT = bounds(d.footprintFeet, t),
      oldN = bounds(d.originalDoor.footprintFeet, n),
      newN = bounds(d.footprintFeet, n);
    if (
      Math.abs(oldN[0] - newN[0]) > 1e-7 ||
      Math.abs(oldN[1] - newN[1]) > 1e-7 ||
      newT[0] > oldT[0] + 1e-7 ||
      newT[1] < oldT[1] - 1e-7 ||
      oldT[0] - newT[0] > (d.measuredTangentLimitFeet ?? 0.15) + 1e-9 ||
      newT[1] - oldT[1] > (d.measuredTangentLimitFeet ?? 0.15) + 1e-9 ||
      (oldT[0] - newT[0] < 1e-7 && newT[1] - oldT[1] < 1e-7)
    )
      error("only a measured tangent extension within its checked limit is permitted");
    const rectangle = (
      r: Point[],
      ab: [number, number],
      cd: [number, number],
    ) =>
      r.every(
        (p) =>
          Math.min(...ab.map((x) => Math.abs(p[0] * t[0] + p[1] * t[1] - x))) <
            1e-7 &&
          Math.min(...cd.map((x) => Math.abs(p[0] * n[0] + p[1] * n[1] - x))) <
            1e-7,
      ) && Math.abs(ringArea(r) - (ab[1] - ab[0]) * (cd[1] - cd[0])) < 1e-7;
    if (
      !rectangle(d.originalDoor.footprintFeet, oldT, oldN) ||
      !rectangle(d.footprintFeet, newT, newN)
    )
      error("threshold must retain its measured rectangular normal depth");
  }
}

/** Returns disposable display/selection copies only. All native door metadata,
 * physical source bytes, graph, access and original dataset remain untouched. */
export function closedBoundaryDoors(
  data: IndoorDataset,
  levelId: number,
  value?: NativeDoorBoundaryClosures,
): Door[] {
  validateNativeDoorBoundaryClosures(value, data.source.modelSha256);
  const doors = (data.doors ?? []).filter((d) => d.levelId === levelId);
  const reviewed = (value?.doors ?? []).filter((d) => d.levelId === levelId);
  if (!reviewed.length) return doors;
  const level = data.nativeLevels.find((l) => l.id === levelId);
  if (
    !level ||
    data.walkingSupport?.sourceModelSha256 !== data.source.modelSha256
  )
    error("missing native floor support");
  const floors = data
    .walkingSupport!.floors.filter(
      (f) => Math.abs(f.elevationFeet - level!.elevationFeet) < 0.15,
    )
    .flatMap((f) => f.partsFeet ?? [f.ringsFeet]);
  if (!floors.length) error("missing native slabs");
  const ground = pc.union(floors[0]!, ...floors.slice(1));
  const virtual = new Map<number, Point[]>();
  for (const saved of reviewed) {
    const door = doors.find((d) => d.nativeElementId === saved.nativeElementId);
    if (
      !door ||
      door.state !== (saved.selectionBarrierOnly ? "unmatched" : "connected") ||
      !same(
        [door.pointFeet, door.normalFeet, door.footprintFeet, door.roomKeys],
        [
          saved.originalDoor.pointFeet,
          saved.originalDoor.normalFeet,
          saved.originalDoor.footprintFeet,
          saved.originalDoor.roomKeys,
        ],
      )
    )
      error("stale original doorway");
    const supportedPortal = data.edges.some(
      (e) =>
        e.id === door!.id &&
        e.enabled &&
        e.kind === "door" &&
        e.nativeElementId === door!.nativeElementId &&
        e.roomKeys.length === 2 &&
        e.roomKeys.every((k) => door!.roomKeys.includes(k)),
    );
    if (saved.selectionBarrierOnly) {
      // An unmatched physical door may still close a measured selection boundary.
      // It cannot acquire a pass-through permission or route through this metadata.
      if (data.edges.some((e) => e.enabled && (e.id === door!.id || (e.kind === "door" && e.nativeElementId === door!.nativeElementId))))
        error("unmatched selection barrier cannot have an enabled portal");
    } else if (!supportedPortal) error("missing original supported door portal");
    const jambs = saved.jambEvidence.map((j) => {
      const wall = data.walls.find(
        (w) =>
          w.levelId === levelId &&
          w.nativeElementId === j.nativeElementId &&
          !w.reviewPatchId &&
          !w.approximate &&
          w.kind === "wall",
      );
      if (!wall || !same(wall.ringsFeet, j.ringsFeet))
        error("stale or non-wall jamb evidence");
      return wall!;
    });
    const proposed: Rings = [saved.footprintFeet],
      original: Rings = [saved.originalDoor.footprintFeet];
    const extension = pc.difference(proposed, original);
    if (area(pc.difference(proposed, ground)) > 1e-6)
      error("threshold crosses a native slab opening or unsupported floor");
    const holes = data.records
      .filter((r) => r.levelId === levelId)
      .flatMap((r) =>
        ((r.properties.floorOpeningsFeet ?? []) as Point[][]).map((h) => [h]),
      );
    if (holes.some((h) => area(pc.intersection(proposed, h)) > 1e-8))
      error("threshold intersects a protected floor opening");
    const obstacles = data.walls.filter(
      (w) =>
        w.levelId === levelId &&
        !saved.jambEvidence.some(
          (j) => j.nativeElementId === w.nativeElementId,
        ),
    );
    if (
      obstacles.some(
        (w) => area(pc.intersection(extension, w.ringsFeet)) > 1e-8,
      )
    )
      error("extension crosses a foreign wall or column");
    if (
      data.circulationGeometry?.sourceModelSha256 === data.source.modelSha256 &&
      data.circulationGeometry.fixtures
        ?.filter((f) => f.levelIds.includes(levelId))
        .some((f) => area(pc.intersection(proposed, f.ringsFeet)) > 1e-8)
    )
      error("threshold crosses a physical fixture");
    const n: Point = saved.originalDoor.normalFeet.map(
        (x) => x / Math.hypot(...saved.originalDoor.normalFeet),
      ) as Point,
      t: Point = [-n[1], n[0]];
    const tb = bounds(saved.footprintFeet, t),
      nb = bounds(saved.footprintFeet, n),
      at = (a: number, b: number): Point => [
        t[0] * a + n[0] * b,
        t[1] * a + n[1] * b,
      ];
    const ends = tb.map((x, i) => [
      at(x + (i ? -0.001 : 0), nb[0]),
      at(x + (i ? 0 : 0.001), nb[0]),
      at(x + (i ? 0 : 0.001), nb[1]),
      at(x + (i ? -0.001 : 0), nb[1]),
    ]);
    const support = ends.map((end) =>
      jambs.map((j) => {
        const intersection = pc.intersection([end], j.ringsFeet);
        if (area(intersection) <= 1e-8) return 0;
        const projected = bounds(intersection.flat(2), n);
        return projected[1] - projected[0];
      }),
    );
    if (
      !(
        (support[0]![0]! > (nb[1] - nb[0]) * 0.5 &&
          support[1]![1]! > (nb[1] - nb[0]) * 0.5) ||
        (support[0]![1]! > (nb[1] - nb[0]) * 0.5 &&
          support[1]![0]! > (nb[1] - nb[0]) * 0.5)
      )
    )
      error(
        "both exact threshold ends must meet distinct named original jambs",
      );
    // A tiny overlap makes the native mask robust; it cannot bury a jamb.
    if (
      jambs.some(
        (j) =>
          area(pc.intersection(extension, j.ringsFeet)) >
          (nb[1] - nb[0]) * 0.002,
      )
    )
      error("extension penetrates a jamb beyond contact overlap");
    virtual.set(saved.nativeElementId, saved.footprintFeet);
  }
  return doors.map((d) =>
    virtual.has(d.nativeElementId)
      ? {
          ...d,
          footprintFeet: virtual
            .get(d.nativeElementId)!
            .map((p) => [...p] as Point),
        }
      : d,
  );
}

export function nativeDoorBoundaryClosureFootprints(
  data: IndoorDataset & {
    nativeDoorBoundaryClosures?: NativeDoorBoundaryClosures;
  },
  levelId: number,
): { nativeElementId: number; footprintFeet: Point[] }[] {
  const changed = closedBoundaryDoors(
    data,
    levelId,
    data.nativeDoorBoundaryClosures,
  );
  return changed
    .filter(
      (d) =>
        !same(
          d.footprintFeet,
          data.doors?.find(
            (original) =>
              original.levelId === levelId &&
              original.nativeElementId === d.nativeElementId,
          )?.footprintFeet,
        ),
    )
    .map((d) => ({
      nativeElementId: d.nativeElementId,
      footprintFeet: d.footprintFeet!,
    }));
}
export function validateNativeDoorBoundaryClosureBinding(
  source: { nativeDoorBoundaryClosures?: NativeDoorBoundaryClosures },
  data: IndoorDataset & {
    nativeDoorBoundaryClosures?: NativeDoorBoundaryClosures;
  },
): void {
  if (!same(source.nativeDoorBoundaryClosures, data.nativeDoorBoundaryClosures))
    error("source and prepared closure evidence differ; regenerate the master");
  for (const level of new Set(
    data.nativeDoorBoundaryClosures?.doors.map((d) => d.levelId) ?? [],
  ))
    nativeDoorBoundaryClosureFootprints(data, level);
}
