/** Source-bound analytic wall placement corrections. Native model bytes and the
 * complete original footprint remain preserved in this portable sidecar. */
import pc from "polygon-clipping";
import type { IndoorDataset } from "./indoor-contract.ts";
import { nativeBarrierTopology } from "./native-barrier-topology.ts";
type Point = [number, number];
type Rings = Point[][];
export type NativeWallPositionRepair = {
  id: string;
  levelId: number;
  nativeElementId: number;
  originalRingsFeet: Rings;
  ringsFeet: Rings;
  supportEvidence: { nativeElementId: number; ringsFeet: Rings };
  evidenceSha256: string;
  notes: string;
};
export type NativeWallPositionRepairs = {
  version: 1;
  sourceModelSha256: string;
  walls: NativeWallPositionRepair[];
};
const sha = (x: unknown): x is string =>
  typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const rings = (x: unknown): x is Rings =>
  Array.isArray(x) &&
  x.length === 1 &&
  Array.isArray(x[0]) &&
  x[0].length === 4 &&
  x[0].every(
    (p: unknown) =>
      Array.isArray(p) &&
      p.length === 2 &&
      p.every(
        (n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e7,
      ),
  );
const area = (parts: Rings[]) =>
  parts.reduce(
    (sum, rs) =>
      sum +
      rs.reduce(
        (s, r, i) =>
          s +
          ((i ? -1 : 1) *
            Math.abs(
              r.reduce((v, p, j) => {
                const q = r[(j + 1) % r.length];
                return v + p[0] * q[1] - q[0] * p[1];
              }, 0),
            )) /
            2,
        0,
      ),
    0,
  );
export function validateNativeWallPositionRepairs(
  value: unknown,
  modelSha?: string,
): NativeWallPositionRepairs {
  const v = value as NativeWallPositionRepairs;
  if (
    !v ||
    v.version !== 1 ||
    !sha(v.sourceModelSha256) ||
    (modelSha !== undefined && v.sourceModelSha256 !== modelSha) ||
    !Array.isArray(v.walls) ||
    v.walls.length > 500
  )
    throw new Error(
      "Wall position corrections belong to a different native source.",
    );
  const ids = new Set<string>(),
    sources = new Set<string>();
  for (const r of v.walls) {
    if (
      !r ||
      typeof r.id !== "string" ||
      !r.id ||
      ids.has(r.id) ||
      !Number.isSafeInteger(r.levelId) ||
      !Number.isSafeInteger(r.nativeElementId) ||
      r.nativeElementId <= 0 ||
      sources.has(`${r.levelId}:${r.nativeElementId}`) ||
      !rings(r.originalRingsFeet) ||
      !rings(r.ringsFeet) ||
      !r.supportEvidence ||
      !Number.isSafeInteger(r.supportEvidence.nativeElementId) ||
      r.supportEvidence.nativeElementId <= 0 ||
      r.supportEvidence.nativeElementId === r.nativeElementId ||
      !rings(r.supportEvidence.ringsFeet) ||
      !sha(r.evidenceSha256) ||
      typeof r.notes !== "string" ||
      !r.notes.trim()
    )
      throw new Error(
        "Choose a unique measured native wall placement correction with preserved source evidence.",
      );
    ids.add(r.id);
    sources.add(`${r.levelId}:${r.nativeElementId}`);
    const a = r.originalRingsFeet[0],
      b = r.ringsFeet[0],
      dx = b[0][0] - a[0][0],
      dy = b[0][1] - a[0][1],
      length = Math.hypot(dx, dy);
    if (
      length < 1e-9 ||
      length > 0.01 ||
      b.some(
        (p, i) => Math.hypot(p[0] - a[i][0] - dx, p[1] - a[i][1] - dy) > 1e-8,
      )
    )
      throw new Error(
        "Move the complete original wall only; preserve every vertex, thickness and axis.",
      );
    const es = a.map((p, i) => {
      const q = a[(i + 1) % 4];
      return {
        x: q[0] - p[0],
        y: q[1] - p[1],
        length: Math.hypot(q[0] - p[0], q[1] - p[1]),
      };
    });
    const axis = es.reduce((p, q) => (p.length > q.length ? p : q));
    if (
      Math.abs(dx * axis.x + dy * axis.y) > 1e-8 * axis.length ||
      es.some((e, i) => {
        const next = es[(i + 1) % 4];
        return (
          e.length < 1e-6 ||
          Math.abs(e.x * next.x + e.y * next.y) > 1e-8 * e.length * next.length
        );
      })
    )
      throw new Error(
        "The correction must be a small normal translation of a complete native rectangular wall.",
      );
  }
  return structuredClone(v);
}
/** Validated immutable replacement; the caller keeps original source geometry.
 * Uses the same exact floor, physical door and fixture guards as wall patches. */
export function nativeWallPositionRepairedWalls(
  data: IndoorDataset & {
    nativeWallPositionRepairs?: NativeWallPositionRepairs;
  },
  options: { deferPhysicalChecks?: boolean; requireOriginal?: boolean } = {},
): IndoorDataset["walls"] {
  if (!data.nativeWallPositionRepairs) return data.walls;
  const repairs = validateNativeWallPositionRepairs(
    data.nativeWallPositionRepairs,
    data.source.modelSha256,
  );
  const replacements = new Map<string, Rings>();
  for (const r of repairs.walls) {
    if (
      options.deferPhysicalChecks &&
      !data.walls.some((w) => w.levelId === r.levelId)
    )
      continue;
    const source = data.walls.filter(
        (w) =>
          w.levelId === r.levelId && w.nativeElementId === r.nativeElementId,
      ),
      support = data.walls.find(
        (w) =>
          w.levelId === r.levelId &&
          w.nativeElementId === r.supportEvidence.nativeElementId &&
          !w.approximate,
      );
    if (
      source.length !== 1 ||
      source[0].kind === "column" ||
      source[0].approximate ||
      (JSON.stringify(source[0].ringsFeet) !==
        JSON.stringify(r.originalRingsFeet) &&
        (options.requireOriginal ||
          JSON.stringify(source[0].ringsFeet) !==
            JSON.stringify(r.ringsFeet))) ||
      !support ||
      support.kind === "column" ||
      JSON.stringify(support.ringsFeet) !==
        JSON.stringify(r.supportEvidence.ringsFeet)
    )
      throw new Error(
        "The original wall or supporting parallel face has stale native evidence.",
      );
    const origin = r.ringsFeet[0][0];
    const local = (rs: Rings): Rings =>
      rs.map((ring) => ring.map((p) => [p[0] - origin[0], p[1] - origin[1]]));
    const intersection = (a: Rings, b: Rings) => {
      const [x, y] = nativeBarrierTopology([local(a), local(b)], 1e8);
      return area(pc.intersection(x, y));
    };
    const a = r.originalRingsFeet[0],
      b = r.ringsFeet[0],
      dx = b[0][0] - a[0][0],
      dy = b[0][1] - a[0][1],
      distance = Math.hypot(dx, dy);
    // An original parallel side must be separated by less than the proposed
    // translation, with positive overlap along that original side.
    const parallelContact = a.some((p, i) => {
      const q = a[(i + 1) % 4],
        vx = q[0] - p[0],
        vy = q[1] - p[1],
        len = Math.hypot(vx, vy);
      if (Math.abs(vx * dx + vy * dy) > 1e-8 * len) return false;
      return r.supportEvidence.ringsFeet[0].some((s, j) => {
        const t = r.supportEvidence.ringsFeet[0][(j + 1) % 4],
          wx = t[0] - s[0],
          wy = t[1] - s[1];
        if (Math.abs(vx * wy - vy * wx) > 1e-8 * len * Math.hypot(wx, wy))
          return false;
        const gap = ((s[0] - p[0]) * dx + (s[1] - p[1]) * dy) / distance;
        const u = ((s[0] - p[0]) * vx + (s[1] - p[1]) * vy) / len,
          v = ((t[0] - p[0]) * vx + (t[1] - p[1]) * vy) / len;
        return (
          gap > 0 &&
          gap < distance &&
          Math.min(len, Math.max(u, v)) - Math.max(0, Math.min(u, v)) > 1e-6
        );
      });
    });
    if (
      !parallelContact ||
      intersection(r.originalRingsFeet, support.ringsFeet) > 1e-8 ||
      intersection(r.ringsFeet, support.ringsFeet) <= 1e-8
    )
      throw new Error(
        "A measured original parallel face gap must close against the named physical support.",
      );
    const level = data.nativeLevels.find((l) => l.id === r.levelId),
      parts =
        data.walkingSupport?.sourceModelSha256 === data.source.modelSha256 &&
        level
          ? data.walkingSupport.floors
              .filter(
                (f) => Math.abs(f.elevationFeet - level.elevationFeet) < 0.15,
              )
              .flatMap((f) => f.partsFeet ?? [f.ringsFeet])
          : [];
    const openings = data.nativeIndoorEnvelopes ? [] : data.records
      .filter((x) => x.levelId === r.levelId)
      .flatMap((x) => (x.properties.floorOpeningsFeet ?? []) as Point[][]);
    if (
      !options.deferPhysicalChecks &&
      (!parts.length ||
        area(
          pc.difference(r.ringsFeet, pc.union(parts[0], ...parts.slice(1))),
        ) > 1e-8 ||
        openings.some((x) => intersection(r.ringsFeet, [x]) > 1e-8) ||
        data.doors?.some(
          (d) =>
            d.levelId === r.levelId &&
            d.footprintFeet &&
            intersection(r.ringsFeet, [d.footprintFeet]) > 1e-8,
        ) ||
        data.walls.some(
          (w) =>
            w.levelId === r.levelId &&
            w.kind === "column" &&
            intersection(r.ringsFeet, w.ringsFeet) > 1e-8,
        ) ||
        data.circulationGeometry?.fixtures?.some(
          (f) =>
            f.levelIds.includes(r.levelId) &&
            intersection(r.ringsFeet, f.ringsFeet) > 1e-8,
        ))
    )
      throw new Error(
        "The corrected complete wall crosses unsupported floor, an opening, a measured door, column or fixture.",
      );
    replacements.set(`${r.levelId}:${r.nativeElementId}`, r.ringsFeet);
  }
  return data.walls.map((w) => {
    const rs = replacements.get(`${w.levelId}:${w.nativeElementId}`);
    return rs ? { ...w, ringsFeet: structuredClone(rs) } : w;
  });
}

/** Project only explicitly translated complete walls into plan geometry. Multiple
 * retained parts of an aperture-cut native host must keep their own polygons. */
export function nativeWallPositionRepairedPlanWalls<
  T extends { elementId: number; polygon: Point[] },
>(walls: T[], data: IndoorDataset, levelId: number): T[] {
  const moved = new Set(
    data.nativeWallPositionRepairs?.walls
      .filter((r) => r.levelId === levelId)
      .map((r) => r.nativeElementId) ?? [],
  );
  return walls.map((w) => {
    if (!moved.has(w.elementId)) return w;
    const prepared = data.walls.filter(
      (p) =>
        p.levelId === levelId &&
        p.nativeElementId === w.elementId &&
        p.kind !== "column",
    );
    if (prepared.length !== 1 || prepared[0].ringsFeet.length !== 1)
      throw new Error(
        "A translated native plan wall must retain one complete prepared footprint.",
      );
    return { ...w, polygon: structuredClone(prepared[0].ringsFeet[0]) };
  });
}

/** Physical source binding excludes authoring prose only. All original and
 * translated material, identity, support and evidence bytes remain relevant. */
export function nativeWallPositionMaterialBinding(
  value: NativeWallPositionRepairs | undefined,
) {
  return (
    value && {
      version: value.version,
      sourceModelSha256: value.sourceModelSha256,
      walls: value.walls.map(({ notes: _, ...physical }) => physical),
    }
  );
}
