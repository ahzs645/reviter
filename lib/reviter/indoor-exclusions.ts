import type {
  IndoorDataset,
  IndoorEdge,
  IndoorExclusions,
} from "./indoor-contract.ts";

type XY = readonly number[];
const ringArea = (r: XY[]) =>
  Math.abs(
    r.reduce((s, p, i) => {
      const q = r[(i + 1) % r.length]!;
      return s + p[0]! * q[1]! - q[0]! * p[1]!;
    }, 0),
  ) / 2;
/** Model-bound, explicit review only. An exposed floor edge is never an exclusion. */
export function validateIndoorExclusions(
  value: unknown,
  modelSha256?: string,
  levels?: { id: number; elevationFeet: number }[],
): asserts value is IndoorExclusions | undefined {
  if (value === undefined) return;
  const v = value as IndoorExclusions;
  if (
    !v ||
    v.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(v.sourceModelSha256) ||
    (modelSha256 !== undefined && v.sourceModelSha256 !== modelSha256) ||
    !Array.isArray(v.areas) ||
    v.areas.length > 5000
  )
    throw new Error("Invalid reviewed indoor exclusions or model identity.");
  const ids = new Set<string>();
  for (const a of v.areas) {
    if (
      !a ||
      (a.reason !== undefined &&
        !["outdoor", "off-limits"].includes(a.reason)) ||
      (a.connectorId !== undefined &&
        (a.reason !== "off-limits" ||
          typeof a.connectorId !== "string" ||
          !a.connectorId.trim() ||
          a.connectorId.length > 200)) ||
      typeof a.id !== "string" ||
      !a.id ||
      a.id.length > 200 ||
      ids.has(a.id) ||
      !Number.isSafeInteger(a.levelId) ||
      !Number.isFinite(a.elevationFeet) ||
      (levels &&
        !levels.some(
          (l) =>
            l.id === a.levelId &&
            Math.abs(l.elevationFeet - a.elevationFeet) < 0.15,
        )) ||
      typeof a.label !== "string" ||
      !a.label.trim() ||
      a.label.length > 200 ||
      (a.notes !== undefined &&
        (typeof a.notes !== "string" || a.notes.length > 10000)) ||
      !Array.isArray(a.nativeFloorIds) ||
      !a.nativeFloorIds.length ||
      a.nativeFloorIds.length > 10000 ||
      new Set(a.nativeFloorIds).size !== a.nativeFloorIds.length ||
      a.nativeFloorIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
      !Array.isArray(a.partsFeet) ||
      !a.partsFeet.length ||
      a.partsFeet.length > 10000 ||
      a.partsFeet.some(
        (rs) =>
          !Array.isArray(rs) ||
          !rs.length ||
          rs.length > 1000 ||
          rs.some(
            (r) =>
              !Array.isArray(r) ||
              r.length < 3 ||
              r.length > 60000 ||
              r.some(
                (p) =>
                  !Array.isArray(p) ||
                  p.length !== 2 ||
                  p.some(
                    (n) =>
                      typeof n !== "number" ||
                      !Number.isFinite(n) ||
                      Math.abs(n) > 1e8,
                  ),
              ) ||
              ringArea(r) < 1e-9,
          ),
      )
    )
      throw new Error("Invalid reviewed exclusion footprint.");
    ids.add(a.id);
  }
}
export function indoorExclusionParts(
  data: IndoorDataset,
  elevationFeet: number,
) {
  validateIndoorExclusions(
    data.indoorExclusions,
    data.source.modelSha256,
    data.nativeLevels,
  );
  return (data.indoorExclusions?.areas ?? [])
    .filter((a) => Math.abs(a.elevationFeet - elevationFeet) < 0.15)
    .flatMap((a) => a.partsFeet);
}
function onSegment(p: XY, a: XY, b: XY) {
  const dx = b[0]! - a[0]!,
    dy = b[1]! - a[1]!,
    n = dx * dx + dy * dy;
  if (n < 1e-20) return Math.hypot(p[0]! - a[0]!, p[1]! - a[1]!) < 1e-8;
  const t = ((p[0]! - a[0]!) * dx + (p[1]! - a[1]!) * dy) / n;
  return (
    t >= -1e-10 &&
    t <= 1 + 1e-10 &&
    Math.hypot(p[0]! - a[0]! - t * dx, p[1]! - a[1]! - t * dy) < 1e-8
  );
}
function inRing(p: XY, r: XY[]) {
  let yes = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[j]!,
      b = r[i]!;
    if (
      a[1]! > p[1]! !== b[1]! > p[1]! &&
      p[0]! < a[0]! + ((b[0]! - a[0]!) * (p[1]! - a[1]!)) / (b[1]! - a[1]!)
    )
      yes = !yes;
  }
  return yes;
}
const boundary = (p: XY, r: XY[]) =>
  r.some((a, i) => onSegment(p, a, r[(i + 1) % r.length]!));
const contains = (p: XY, rs: XY[][]) =>
  (inRing(p, rs[0]!) || boundary(p, rs[0]!)) &&
  !rs.slice(1).some((h) => inRing(p, h) && !boundary(p, h));
/** Exact XY and height interval cuts, including ramps/stair endpoints. No sampling,
 * room-name heuristics or absent-slab inference. Hole interiors remain excluded
 * from the exterior footprint, and routes on another floor are unaffected. */
export function createIndoorExclusionQuery(data: IndoorDataset) {
  validateIndoorExclusions(
    data.indoorExclusions,
    data.source.modelSha256,
    data.nativeLevels,
  );
  const areas = data.indoorExclusions?.areas ?? [];
  const edges = new Map(data.edges.map((e) => [e.id, e]));
  const nodes = new Map(data.nodes.map((n) => [n.id, n]));
  const samePoint = (a: XY, b: XY) =>
    a.length === 3 && b.length === 3 && a.every((v, i) => v === b[i]);
  const samePath = (a: readonly XY[], b: readonly XY[]) =>
    a.length === b.length && a.every((p, i) => samePoint(p, b[i]!));
  const areaHit = (a: (typeof areas)[number], p: XY) =>
    Math.abs(p[2]! - a.elevationFeet) <= 0.15 &&
    a.partsFeet.some((rs) => contains(p, rs));
  /** A shaft is unavailable to walking, but the reviewed lift can travel through
   * its own interior between its existing lobby stops. Context cannot authorize
   * new geometry, a different connector, or an endpoint inside an exclusion. */
  const liftTransit = (points: readonly XY[], context?: IndoorEdge) => {
    if (!context || context.kind !== "elevator") return undefined;
    const edge = edges.get(context.id);
    if (
      !edge ||
      edge !== context ||
      !edge.enabled ||
      edge.pointsFeet.length < 2 ||
      edge.kind !== "elevator"
    )
      return undefined;
    const connector = data.connectors?.find((c) => c.id === edge.connectorId);
    const shaft = connector?.reviewedShaft;
    if (
      !connector ||
      connector.kind !== "elevator" ||
      !shaft ||
      connector.sourceModelSha256 !== data.source.modelSha256 ||
      connector.nativeElementId !== edge.nativeElementId ||
      connector.direction !== edge.direction ||
      connector.evidence !== edge.evidence ||
      !Number.isSafeInteger(connector.nativeElementId) ||
      connector.nativeElementId <= 0 ||
      !connector.evidence.trim() ||
      !edge.evidence.trim() ||
      typeof shaft.pinId !== "string" ||
      !shaft.pinId.trim() ||
      shaft.pinId.length > 200 ||
      shaft.pointFeet.length !== 2 ||
      !shaft.pointFeet.every((p) => Number.isFinite(p) && Math.abs(p) < 1e7) ||
      shaft.wallElementIds.length < 3 ||
      shaft.wallElementIds.length > 100 ||
      new Set(shaft.wallElementIds).size !== shaft.wallElementIds.length ||
      !shaft.wallElementIds.every((id) => Number.isSafeInteger(id) && id > 0) ||
      !shaft.wallElementIds.includes(connector.nativeElementId) ||
      (!samePath(points, edge.pointsFeet) &&
        !samePath(points, [...edge.pointsFeet].reverse()))
    )
      return undefined;
    const from = nodes.get(edge.from),
      to = nodes.get(edge.to);
    if (
      !from ||
      !to ||
      from.id === to.id ||
      from.levelId === to.levelId ||
      from.kind !== "connector" ||
      to.kind !== "connector" ||
      !samePoint(edge.pointsFeet[0]!, from.pointFeet) ||
      !samePoint(edge.pointsFeet.at(-1)!, to.pointFeet) ||
      Math.abs(from.pointFeet[2] - to.pointFeet[2]) <= 0.15 ||
      [from, to].some(
        (n) =>
          connector.entrances.filter(
            (e) =>
              e.nodeId === n.id &&
              e.levelId === n.levelId &&
              e.roomKey === n.roomKey,
          ).length !== 1 || areas.some((a) => areaHit(a, n.pointFeet)),
      )
    )
      return undefined;
    return connector;
  };
  const query = (points: readonly XY[], context?: IndoorEdge): string[] => {
    const transit = liftTransit(points, context);
    const crossed = new Set<string>();
    for (const a of areas) {
      if (
        transit &&
        a.reason === "off-limits" &&
        a.connectorId === transit.id &&
        transit.entrances.some((e) => e.levelId === a.levelId) &&
        a.partsFeet.some((rs) => contains(transit.reviewedShaft!.pointFeet, rs))
      )
        continue;
      const hit = (p: XY) => areaHit(a, p);
      if (points.some(hit)) {
        crossed.add(a.id);
        continue;
      }
      for (let i = 1; i < points.length; i++) {
        const p = points[i - 1]!,
          q = points[i]!,
          dx = q[0]! - p[0]!,
          dy = q[1]! - p[1]!,
          dz = q[2]! - p[2]!;
        const cuts = [0, 1];
        if (Math.abs(dz) > 1e-12)
          for (const z of [a.elevationFeet - 0.15, a.elevationFeet + 0.15]) {
            const t = (z - p[2]!) / dz;
            if (t > 0 && t < 1) cuts.push(t);
          }
        for (const r of a.partsFeet.flat())
          for (let j = 0; j < r.length; j++) {
            const b = r[j]!,
              c = r[(j + 1) % r.length]!,
              x = c[0]! - b[0]!,
              y = c[1]! - b[1]!,
              den = dx * y - dy * x;
            if (Math.abs(den) < 1e-12) continue;
            const ox = b[0]! - p[0]!,
              oy = b[1]! - p[1]!,
              t = (ox * y - oy * x) / den,
              u = (ox * dy - oy * dx) / den;
            if (t >= 0 && t <= 1 && u >= 0 && u <= 1) cuts.push(t);
          }
        cuts.sort((x, y) => x - y);
        const at = (t: number) => [
          p[0]! + t * dx,
          p[1]! + t * dy,
          p[2]! + t * dz,
        ];
        if (
          cuts.some((t) => hit(at(t))) ||
          cuts.slice(1).some((t, j) => hit(at((t + cuts[j]!) / 2)))
        ) {
          crossed.add(a.id);
          break;
        }
      }
    }
    return [...crossed];
  };
  return Object.assign((points: readonly XY[]) => query(points), {
    forEdge: (points: readonly XY[], edge: IndoorEdge) => query(points, edge),
  });
}
