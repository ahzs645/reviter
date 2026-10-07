import pc from "polygon-clipping";
import type { IndoorDataset } from "./indoor-contract.ts";
import type { RoomDirectoryData } from "./room-directory.ts";
import { nativeBarrierTopology } from "./native-barrier-topology.ts";

type Point = [number, number];
export const REVIEWED_PARTITION_WIDTH_FEET = 0.0002;
export const reviewedAreaPartitionKinds = {
  shutter: "Shutter / flexiglide opening",
  "open-entrance": "Doorless entrance",
  "pickup-front": "Pickup counter front",
  "missing-partition": "Missing partition — virtual boundary only",
  "shaft-boundary": "Shaft outline — inspection only",
} as const;
/** An authoring outline, never a physical wall or a navigation permission. */
export type ReviewedAreaPartition = {
  id: string;
  levelId: number;
  elevationFeet: number;
  geometrySha256: string;
  kind: keyof typeof reviewedAreaPartitionKinds;
  pointsFeet: Point[];
  closed: boolean;
  status: "proposed" | "applied";
  label: string;
  notes: string;
  evidence: {
    kind: "native-endpoints" | "reviewed-assumption";
    nativeElementIds: number[];
    reason: string;
  };
  selection: "closed";
  navigation: "unchanged";
};
export type ReviewedAreaPartitions = {
  version: 1;
  sourceModelSha256: string;
  partitions: ReviewedAreaPartition[];
  /** Append-only authoring transitions. Archived descriptors retain their original evidence. */
  history?: {
    action: "propose" | "apply" | "restore" | "remove";
    id: string;
    at: string;
    before?: ReviewedAreaPartition;
    after?: ReviewedAreaPartition;
  }[];
};
const sha = (s: unknown) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
const point = (p: unknown): p is Point =>
  Array.isArray(p) &&
  p.length === 2 &&
  p.every(
    (n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e7,
  );
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function closest(p: Point, a: Point, b: Point): Point {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    n = dx * dx + dy * dy;
  const t = n
    ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / n))
    : 0;
  return [a[0] + t * dx, a[1] + t * dy];
}
function segments(p: ReviewedAreaPartition): [Point, Point][] {
  return p.pointsFeet
    .slice(1)
    .map((b, i) => [p.pointsFeet[i]!, b] as [Point, Point])
    .concat(p.closed ? [[p.pointsFeet.at(-1)!, p.pointsFeet[0]!]] : []);
}
function crossing(a: Point, b: Point, c: Point, d: Point) {
  const cross = (x: Point, y: Point, z: Point) =>
    (y[0] - x[0]) * (z[1] - x[1]) - (y[1] - x[1]) * (z[0] - x[0]);
  const n = cross(a, b, c),
    m = cross(a, b, d),
    u = cross(c, d, a),
    v = cross(c, d, b);
  if (n * m < 0 && u * v < 0) return true;
  return (
    [c, d].some(
      (p) =>
        Math.abs(cross(a, b, p)) < 1e-10 &&
        distance(p, closest(p, a, b)) < 1e-8,
    ) ||
    [a, b].some(
      (p) =>
        Math.abs(cross(c, d, p)) < 1e-10 &&
        distance(p, closest(p, c, d)) < 1e-8,
    )
  );
}
export function validateReviewedAreaPartitions(
  value: unknown,
  modelSha256?: string,
): asserts value is ReviewedAreaPartitions | undefined {
  if (value === undefined) return;
  const v = value as ReviewedAreaPartitions;
  if (
    !v ||
    v.version !== 1 ||
    !sha(v.sourceModelSha256) ||
    (modelSha256 !== undefined && v.sourceModelSha256 !== modelSha256) ||
    !Array.isArray(v.partitions) ||
    v.partitions.length > 5000
  )
    throw new Error("Invalid logical boundary source identity.");
  const ids = new Set<string>();
  for (const p of v.partitions) {
    if (
      !p ||
      typeof p.id !== "string" ||
      !p.id ||
      p.id.length > 200 ||
      ids.has(p.id) ||
      !Number.isSafeInteger(p.levelId) ||
      !Number.isFinite(p.elevationFeet) ||
      !sha(p.geometrySha256) ||
      !Object.hasOwn(reviewedAreaPartitionKinds, p.kind) ||
      !["proposed", "applied"].includes(p.status) ||
      typeof p.closed !== "boolean" ||
      !Array.isArray(p.pointsFeet) ||
      p.pointsFeet.length < (p.closed ? 3 : 2) ||
      p.pointsFeet.length > 100 ||
      !p.pointsFeet.every(point) ||
      typeof p.label !== "string" ||
      !p.label.trim() ||
      p.label.length > 200 ||
      typeof p.notes !== "string" ||
      !p.notes.trim() ||
      p.notes.length > 10000 ||
      !p.evidence ||
      !["native-endpoints", "reviewed-assumption"].includes(p.evidence.kind) ||
      typeof p.evidence.reason !== "string" ||
      !p.evidence.reason.trim() ||
      p.evidence.reason.length > 10000 ||
      !Array.isArray(p.evidence.nativeElementIds) ||
      p.evidence.nativeElementIds.length > 100 ||
      new Set(p.evidence.nativeElementIds).size !==
        p.evidence.nativeElementIds.length ||
      p.evidence.nativeElementIds.some(
        (id) => !Number.isSafeInteger(id) || id <= 0,
      ) ||
      (p.evidence.kind === "native-endpoints" &&
        !p.evidence.nativeElementIds.length) ||
      p.selection !== "closed" ||
      p.navigation !== "unchanged" ||
      (p.kind === "shaft-boundary" && (!p.closed || p.status === "applied"))
    )
      throw new Error(
        "Invalid logical boundary. Shaft outlines are proposed inspection metadata only.",
      );
    const edges = segments(p);
    if (
      new Set(p.pointsFeet.map((q) => JSON.stringify(q))).size !==
        p.pointsFeet.length ||
      edges.some(([a, b], i) => {
        const next = edges[i + 1] ?? (p.closed ? edges[0] : undefined);
        if (!next) return false;
        const c = next[1],
          dx = b[0] - a[0],
          dy = b[1] - a[1],
          ex = c[0] - b[0],
          ey = c[1] - b[1];
        return Math.abs(dx * ey - dy * ex) < 1e-10 && dx * ex + dy * ey < 0;
      }) ||
      edges.some(([a, b]) => distance(a, b) < 0.05 || distance(a, b) > 300) ||
      edges.reduce((n, [a, b]) => n + distance(a, b), 0) > 1000 ||
      edges.some(([a, b], i) =>
        edges.some(
          ([c, d], j) =>
            j > i + 1 &&
            !(p.closed && i === 0 && j === edges.length - 1) &&
            crossing(a, b, c, d),
        ),
      )
    )
      throw new Error("Logical boundary is degenerate, crossed, or too long.");
    ids.add(p.id);
  }
  if (v.history !== undefined) {
    if (!Array.isArray(v.history) || v.history.length > 10000)
      throw new Error("Invalid logical boundary history.");
    for (const h of v.history) {
      if (
        !h ||
        !["propose", "apply", "restore", "remove"].includes(h.action) ||
        typeof h.id !== "string" ||
        !h.id ||
        h.id.length > 200 ||
        typeof h.at !== "string" ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(h.at) ||
        !Number.isFinite(Date.parse(h.at)) ||
        (!h.before && !h.after) ||
        (h.before && h.before.id !== h.id) ||
        (h.after && h.after.id !== h.id) ||
        (h.action === "remove" && (!h.before || h.after)) ||
        (h.action !== "remove" && !h.after) ||
        (h.action === "apply" &&
          (!h.before || h.after?.status !== "applied")) ||
        (h.action === "restore" &&
          (!h.before || h.after?.status !== "proposed")) ||
        (h.action === "propose" && h.after?.status !== "proposed")
      )
        throw new Error("Invalid logical boundary history transition.");
      validateReviewedAreaPartitions({
        version: 1,
        sourceModelSha256: v.sourceModelSha256,
        partitions: [...(h.before ? [h.before] : [])],
      });
      validateReviewedAreaPartitions({
        version: 1,
        sourceModelSha256: v.sourceModelSha256,
        partitions: [...(h.after ? [h.after] : [])],
      });
    }
  }
}
/** Deliberately excludes authoring notes and logical boundaries: applying a second boundary cannot stale the first. */
export async function reviewedAreaPartitionGeometrySha256(
  data: IndoorDataset,
  levelId: number,
): Promise<string> {
  const level = data.nativeLevels.find((l) => l.id === levelId);
  if (!level) throw new Error("Logical boundary level is absent.");
  const value = JSON.stringify([
    "logical-area-partition-physical-v1",
    data.source.modelSha256,
    level,
    data.walkingSupport?.sourceModelSha256,
    data.walkingSupport?.floors.filter(
      (f) => Math.abs(f.elevationFeet - level.elevationFeet) < 0.15,
    ),
    data.walls.filter((w) => w.levelId === levelId),
    data.doors?.filter((d) => d.levelId === levelId),
    data.records
      .filter((r) => r.levelId === levelId)
      .map((r) => [r.key, r.properties.floorOpeningsFeet]),
    data.circulationGeometry?.fixtures?.filter((f) =>
      f.levelIds.includes(levelId),
    ),
    data.indoorExclusions?.areas.filter(
      (a) => Math.abs(a.elevationFeet - level.elevationFeet) < 0.15,
    ),
    data.nativeDoorBoundaryClosures,
    data.nativeWallPositionRepairs,
  ]);
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
const area = (parts: pc.MultiPolygon) =>
  parts.reduce(
    (sum, rings) =>
      sum +
      rings.reduce(
        (s, r, i) =>
          s +
          ((i ? -1 : 1) *
            Math.abs(
              r.reduce((n, p, j) => {
                const q = r[(j + 1) % r.length]!;
                return n + p[0] * q[1] - q[0] * p[1];
              }, 0),
            )) /
            2,
        0,
      ),
    0,
  );
export type ReviewedAreaPartitionCheck = {
  valid: boolean;
  errors: string[];
  footprintsFeet: Point[][];
  nativeFloorIds: number[];
  provisional: boolean;
};
export function checkReviewedAreaPartition(
  data: IndoorDataset,
  p: ReviewedAreaPartition,
  physicalGeometrySha256: string,
): ReviewedAreaPartitionCheck {
  const errors: string[] = [];
  try {
    validateReviewedAreaPartitions(
      {
        version: 1,
        sourceModelSha256: data.source.modelSha256,
        partitions: [{ ...p, status: "proposed" }],
      },
      data.source.modelSha256,
    );
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
    return {
      valid: false,
      errors,
      footprintsFeet: [],
      nativeFloorIds: [],
      provisional: true,
    };
  }
  if (p.geometrySha256 !== physicalGeometrySha256)
    errors.push(
      "Physical evidence changed; review this logical boundary again.",
    );
  const level = data.nativeLevels.find((l) => l.id === p.levelId);
  if (!level || Math.abs(level.elevationFeet - p.elevationFeet) > 1e-8)
    errors.push("Native level or elevation changed.");
  if (p.kind === "shaft-boundary")
    errors.push(
      "Shaft outline is inspection only. Use the explicit non-traversable footprint review to restrict selection and routes.",
    );
  const floors =
    data.walkingSupport?.sourceModelSha256 === data.source.modelSha256
      ? data.walkingSupport.floors.filter(
          (f) => Math.abs(f.elevationFeet - p.elevationFeet) < 0.15,
        )
      : [];
  if (!floors.length)
    errors.push("No model-bound native floor supports this boundary.");
  const walls = data.walls.filter(
    (w) => w.levelId === p.levelId && !w.approximate,
  );
  const supports = walls.filter((w) =>
    p.evidence.nativeElementIds.includes(w.nativeElementId),
  );
  if (
    p.evidence.nativeElementIds.some(
      (id) => !supports.some((w) => w.nativeElementId === id),
    )
  )
    errors.push("A declared endpoint support is absent or approximate.");
  if (!p.closed && p.evidence.kind === "native-endpoints")
    for (const end of [p.pointsFeet[0]!, p.pointsFeet.at(-1)!]) {
      if (
        !supports.some((w) =>
          w.ringsFeet.some((r) =>
            r.some(
              (a, i) =>
                distance(end, closest(end, a, r[(i + 1) % r.length]!)) <=
                0.00011,
            ),
          ),
        )
      )
        errors.push(
          "Endpoint does not touch its exact native wall or column face. Snap it before applying.",
        );
    }
  const width = REVIEWED_PARTITION_WIDTH_FEET,
    half = width / 2;
  const strips = segments(p).map(([a, b]) => {
    const len = distance(a, b),
      dx = (b[0] - a[0]) / len,
      dy = (b[1] - a[1]) / len,
      nx = -dy * half,
      ny = dx * half;
    return [
      [a[0] - dx * half + nx, a[1] - dy * half + ny],
      [b[0] + dx * half + nx, b[1] + dy * half + ny],
      [b[0] + dx * half - nx, b[1] + dy * half - ny],
      [a[0] - dx * half - nx, a[1] - dy * half - ny],
    ] as Point[];
  });
  let footprintsFeet: Point[][] = [];
  try {
    const floorParts = floors.flatMap((f) => f.partsFeet ?? [f.ringsFeet]);
    const originalContactFloors = nativeBarrierTopology(
      floorParts,
      1e10,
      floorParts[0]?.[0]?.[0] ?? [0, 0],
      1e-12,
    );
    const floor = originalContactFloors.length
      ? pc.union(originalContactFloors[0]!, ...originalContactFloors.slice(1))
      : [];
    const holes = floorParts
      .flatMap((rs) => rs.slice(1))
      .concat(
        data.records
          .filter((r) => r.levelId === p.levelId)
          .flatMap((r) => (r.properties.floorOpeningsFeet ?? []) as Point[][]),
      );
    const exclusions =
      data.indoorExclusions?.areas
        .filter((a) => Math.abs(a.elevationFeet - p.elevationFeet) < 0.15)
        .flatMap((a) => a.partsFeet) ?? [];
    const fixtures =
      data.circulationGeometry?.fixtures?.filter((f) =>
        f.levelIds.includes(p.levelId),
      ) ?? [];
    for (const strip of strips) {
      const polygon = [strip];
      if (area(pc.difference(polygon, floor)) > 1e-7)
        errors.push("The boundary leaves supported native floor.");
      if (holes.some((h) => area(pc.intersection(polygon, [h])) > 1e-12))
        errors.push("The boundary touches a protected floor or stair opening.");
      if (exclusions.some((rs) => area(pc.intersection(polygon, rs)) > 1e-12))
        errors.push("The boundary touches an excluded footprint.");
      if (
        (data.doors ?? []).some(
          (d) =>
            d.levelId === p.levelId &&
            d.footprintFeet &&
            area(pc.intersection(polygon, [d.footprintFeet])) > 1e-12,
        )
      )
        errors.push(
          "A measured physical door occupies this boundary. Use its selection-threshold controls.",
        );
      if (
        fixtures.some(
          (f) =>
            area(pc.intersection(polygon, f.ringsFeet)) > width * width * 2,
        )
      )
        errors.push("The boundary crosses a protected fixture.");
      if (
        walls.some(
          (w) =>
            area(pc.intersection(polygon, w.ringsFeet)) > width * width * 2,
        )
      )
        errors.push(
          "The boundary crosses a physical wall or column instead of its opening.",
        );
      footprintsFeet.push(
        ...pc.intersection(polygon, floor).map((rs) => rs[0] as Point[]),
      );
    }
  } catch {
    errors.push(
      "Native floor geometry cannot support a checked logical boundary.",
    );
  }
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    footprintsFeet: errors.length ? [] : footprintsFeet,
    nativeFloorIds: floors.map((f) => f.nativeElementId),
    provisional: p.evidence.kind === "reviewed-assumption",
  };
}
/** Bounded click snapping. Returns evidence; never translates a physical native element. */
export function snapReviewedAreaPartitionPoints(
  data: IndoorDataset,
  levelId: number,
  points: [Point, Point],
  maxFeet = 0.5,
) {
  if (
    !points.every(point) ||
    !Number.isFinite(maxFeet) ||
    maxFeet < 0 ||
    maxFeet > 0.5
  )
    throw new Error("Invalid logical boundary click snap.");
  const walls = data.walls.filter(
    (w) => w.levelId === levelId && !w.approximate,
  );
  const details = points.map((original) => {
    let best:
      | { pointFeet: Point; nativeElementId: number; distanceFeet: number }
      | undefined;
    for (const w of walls)
      for (const ring of w.ringsFeet)
        for (let i = 0; i < ring.length; i++) {
          const q = closest(original, ring[i]!, ring[(i + 1) % ring.length]!),
            n = distance(q, original);
          if (n <= maxFeet && (!best || n < best.distanceFeet))
            best = {
              pointFeet: q,
              nativeElementId: w.nativeElementId,
              distanceFeet: n,
            };
        }
    return {
      originalPointFeet: original,
      ...best,
      pointFeet: best?.pointFeet ?? original,
    };
  });
  return {
    pointsFeet: details.map((d) => d.pointFeet) as [Point, Point],
    nativeElementIds: [
      ...new Set(
        details.flatMap((d) =>
          d.nativeElementId === undefined ? [] : [d.nativeElementId],
        ),
      ),
    ],
    details,
  };
}
export function validateReviewedAreaPartitionBinding(
  rooms: Pick<RoomDirectoryData, "reviewedAreaPartitions">,
  data: IndoorDataset,
) {
  validateReviewedAreaPartitions(
    rooms.reviewedAreaPartitions,
    data.source.modelSha256,
  );
  validateReviewedAreaPartitions(
    data.reviewedAreaPartitions,
    data.source.modelSha256,
  );
  if (
    JSON.stringify(rooms.reviewedAreaPartitions) !==
    JSON.stringify(data.reviewedAreaPartitions)
  )
    throw new Error("Source and prepared logical boundaries differ.");
  for (const p of data.reviewedAreaPartitions?.partitions ?? [])
    if (
      !data.nativeLevels.some(
        (l) =>
          l.id === p.levelId &&
          Math.abs(l.elevationFeet - p.elevationFeet) < 1e-8,
      )
    )
      throw new Error("Logical boundary belongs to a missing native level.");
}
