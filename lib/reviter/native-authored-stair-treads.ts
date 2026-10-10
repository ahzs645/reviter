import * as DMath from "./deterministic-math.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { strictNativeFloorPolygons } from "./strict-native-floor-polygons.ts";
type P3 = [number, number, number];
type Span = { start: number; end: number; sha256: string };
type Line = {
  token: number;
  sourceSpan: Span;
  origin: P3;
  direction: P3;
  endParameters: [number, number];
};
export type NativeAuthoredStairTreadRoles = {
  version: 1;
  sourceModelSha256: string;
  geometrySha256: string;
  evidenceSha256: string;
  sourceSchemaSha256: string;
  runs: {
    nativeRunId: number;
    nativeStairId: number;
    originalFrameSha256: string;
    completeOriginalTypedRootAndFifoByteReplay: true;
    geometry: { token: number; sourceSpan: Span; declaredFaceTokens: number[] };
    faces: {
      faceToken: number;
      sourceSpan: Span;
      role: "typed-tread" | "reference";
      originalTrianglesFeet: [P3, P3, P3][];
      originalOwnedBodyCorrespondenceSha256?: string;
      typed?: {
        index: number;
        sourceSpan: Span;
        origin: P3;
        startLine: Line;
        endLine: Line;
      };
    }[];
  }[];
};
export function nativeAuthoredStairTreadRolesHash(
  value:
    | Omit<NativeAuthoredStairTreadRoles, "geometrySha256">
    | NativeAuthoredStairTreadRoles,
) {
  const { geometrySha256: _, ...physical } =
    value as NativeAuthoredStairTreadRoles;
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(physical))));
}
const hash = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const point = (p: unknown): p is P3 =>
  Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const keys = (value: unknown, allowed: readonly string[]) =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => allowed.includes(key));
const span = (s: Span) =>
  !!s &&
  keys(s, ["start", "end", "sha256"]) &&
  Number.isSafeInteger(s.start) &&
  Number.isSafeInteger(s.end) &&
  s.start >= 0 &&
  s.end > s.start &&
  hash(s.sha256);
const close = (a: number, b: number) =>
  Math.abs(a - b) <= 4 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
/** Exact original triangle edge census reconstructs the exterior; no mesh
 * rounding, height grouping, small-face deletion or cached tread counts. */
function exterior(triangles: [P3, P3, P3][]): P3[] {
  const ids = new Map<string, number>(),
    points: P3[] = [],
    edges = new Map<
      string,
      { a: number; b: number; count: number; balance: number }
    >();
  const id = (p: P3) => {
    const key = JSON.stringify(p);
    if (!ids.has(key)) {
      ids.set(key, points.length);
      points.push(p);
    }
    return ids.get(key)!;
  };
  for (const original of triangles) {
    const t = [...original] as [P3, P3, P3];
    if (t.length !== 3 || !t.every(point))
      throw Error("Incomplete original tread face");
    const [a, b, c] = t;
    const orientation =
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (orientation === 0)
      throw Error("Original tread face has a degenerate triangle");
    if (orientation < 0) [t[1], t[2]] = [t[2], t[1]];
    for (let i = 0; i < 3; i++) {
      const a = id(t[i]!),
        b = id(t[(i + 1) % 3]!);
      if (a === b) throw Error("Degenerate original triangle");
      const key = [Math.min(a, b), Math.max(a, b)].join(":");
      const e = edges.get(key) ?? { a, b, count: 0, balance: 0 };
      e.count++;
      e.balance += a < b ? 1 : -1;
      edges.set(key, e);
    }
  }
  if (
    [...edges.values()].some(
      (e) => e.count > 2 || (e.count === 2 && e.balance !== 0),
    )
  )
    throw Error("Non-manifold original face");
  const boundary = [...edges.values()].filter((e) => e.count === 1),
    next = new Map<number, number>();
  for (const e of boundary) {
    if (next.has(e.a)) throw Error("Branched original face");
    next.set(e.a, e.b);
  }
  if (boundary.length < 3) throw Error("Original face has no exterior");
  const loop: P3[] = [],
    start = boundary[0]!.a;
  let at = start;
  do {
    if (loop.length >= boundary.length || !next.has(at))
      throw Error("Incomplete original face exterior");
    loop.push(points[at]!);
    at = next.get(at)!;
  } while (at !== start);
  if (loop.length !== boundary.length)
    throw Error("Original tread has multiple loops");
  strictNativeFloorPolygons({ loops: [loop] });
  return loop;
}
function lineEnds(line: Line): P3[] {
  if (
    !line ||
    !keys(line, [
      "token",
      "sourceSpan",
      "origin",
      "direction",
      "endParameters",
    ]) ||
    !Number.isSafeInteger(line.token) ||
    line.token <= 0 ||
    !span(line.sourceSpan) ||
    !point(line.origin) ||
    !point(line.direction) ||
    line.direction[2] !== 0 ||
    DMath.hypot(line.direction[0], line.direction[1]) === 0 ||
    !Array.isArray(line.endParameters) ||
    line.endParameters.length !== 2 ||
    !line.endParameters.every(Number.isFinite) ||
    line.endParameters[0] === line.endParameters[1]
  )
    throw Error("Unresolved finite original tread span");
  return line.endParameters.map(
    (t) => line.origin.map((v, i) => v + t * line.direction[i]!) as P3,
  );
}
function onBoundary(p: P3, ring: P3[]) {
  return ring.some((a, i) => {
    const b = ring[(i + 1) % ring.length]!,
      error =
        4 *
        Number.EPSILON *
        Math.max(
          1,
          ...p.slice(0, 2).map(Math.abs),
          ...a.slice(0, 2).map(Math.abs),
          ...b.slice(0, 2).map(Math.abs),
        );
    const near = (x: number, y: number) => Math.abs(x - y) <= error;
    if (
      (near(p[0], a[0]) && near(p[1], a[1])) ||
      (near(p[0], b[0]) && near(p[1], b[1]))
    )
      return true;
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
    return (
      Number.isFinite(t) &&
      t >= 0 &&
      t <= 1 &&
      near(p[0], a[0] + t * dx) &&
      near(p[1], a[1] + t * dy)
    );
  });
}
function boundarySpan(a: P3, b: P3, loop: P3[]) {
  if (!onBoundary(a, loop) || !onBoundary(b, loop)) return false;
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = dx * dx + dy * dy;
  if (!length) return false;
  const cuts = [0, 1];
  for (const p of loop) {
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length;
    if (
      t > 0 &&
      t < 1 &&
      close(p[0], a[0] + t * dx) &&
      close(p[1], a[1] + t * dy)
    )
      cuts.push(t);
  }
  cuts.sort((a, b) => a - b);
  return cuts
    .slice(1)
    .every(
      (t, i) =>
        t === cuts[i] ||
        onBoundary(
          [
            a[0] + ((t + cuts[i]!) / 2) * dx,
            a[1] + ((t + cuts[i]!) / 2) * dy,
            a[2],
          ],
          loop,
        ),
    );
}
function contains(p: P3, loop: P3[]) {
  if (onBoundary(p, loop)) return true;
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[j]!,
      b = loop[i]!;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < a[0] + ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1])
    )
      inside = !inside;
  }
  return inside;
}
/** Proven typed origins and finite source lines bind walking roles to complete
 * authored original faces. Reference/base faces remain explicit non-treads. */
export function nativeAuthoredStairTreads(
  value: NativeAuthoredStairTreadRoles | undefined,
  sourceModelSha256: string,
) {
  const out = new Map<
    number,
    {
      runElementId: number;
      elevationFeet: number;
      ringFeet: [number, number][];
    }[]
  >();
  if (value === undefined) return out;
  if (
    !keys(value, [
      "version",
      "sourceModelSha256",
      "geometrySha256",
      "evidenceSha256",
      "sourceSchemaSha256",
      "runs",
    ]) ||
    value.version !== 1 ||
    value.sourceModelSha256 !== sourceModelSha256 ||
    !hash(value.sourceModelSha256) ||
    !hash(value.evidenceSha256) ||
    !hash(value.sourceSchemaSha256) ||
    value.geometrySha256 !== nativeAuthoredStairTreadRolesHash(value) ||
    !Array.isArray(value.runs) ||
    value.runs.length > 1000 ||
    new Set(value.runs.map((r) => r.nativeRunId)).size !== value.runs.length
  )
    throw Error("Invalid original authored stair role binding");
  for (const r of value.runs) {
    if (
      !keys(r, [
        "nativeRunId",
        "nativeStairId",
        "originalFrameSha256",
        "completeOriginalTypedRootAndFifoByteReplay",
        "geometry",
        "faces",
      ]) ||
      !Number.isSafeInteger(r.nativeRunId) ||
      r.nativeRunId <= 0 ||
      !Number.isSafeInteger(r.nativeStairId) ||
      r.nativeStairId <= 0 ||
      !hash(r.originalFrameSha256) ||
      r.completeOriginalTypedRootAndFifoByteReplay !== true ||
      !r.geometry ||
      !keys(r.geometry, ["token", "sourceSpan", "declaredFaceTokens"]) ||
      !span(r.geometry.sourceSpan) ||
      !Number.isSafeInteger(r.geometry.token) ||
      r.geometry.token <= 0 ||
      !Array.isArray(r.faces) ||
      !r.faces.length ||
      r.faces.length > 1000 ||
      JSON.stringify(r.geometry.declaredFaceTokens) !==
        JSON.stringify(r.faces.map((f) => f.faceToken)) ||
      new Set(r.geometry.declaredFaceTokens).size !== r.faces.length
    )
      throw Error("Incomplete declared original stair geometry");
    const indices: number[] = [],
      treads: {
        runElementId: number;
        elevationFeet: number;
        ringFeet: [number, number][];
      }[] = [];
    for (const f of r.faces) {
      if (
        !keys(f, [
          "faceToken",
          "sourceSpan",
          "role",
          "originalTrianglesFeet",
          "originalOwnedBodyCorrespondenceSha256",
          "typed",
        ]) ||
        !Number.isSafeInteger(f.faceToken) ||
        f.faceToken <= 0 ||
        !span(f.sourceSpan) ||
        !Array.isArray(f.originalTrianglesFeet) ||
        !f.originalTrianglesFeet.length ||
        f.originalTrianglesFeet.length > 10000 ||
        f.originalTrianglesFeet.some(
          (t) => !Array.isArray(t) || t.length !== 3 || !t.every(point),
        ) ||
        (f.originalOwnedBodyCorrespondenceSha256 !== undefined &&
          !hash(f.originalOwnedBodyCorrespondenceSha256))
      )
        throw Error("Missing original authored face inventory");
      if (f.role === "reference") {
        if (f.typed !== undefined)
          throw Error("Reference face cannot supply tread role");
        continue;
      }
      const typed = f.typed;
      if (
        f.role !== "typed-tread" ||
        !typed ||
        !keys(typed, [
          "index",
          "sourceSpan",
          "origin",
          "startLine",
          "endLine",
        ]) ||
        !Number.isSafeInteger(typed.index) ||
        typed.index < 0 ||
        !span(typed.sourceSpan) ||
        !point(typed.origin)
      )
        throw Error("Missing positive original typed tread role");
      indices.push(typed.index);
      const loop = exterior(f.originalTrianglesFeet),
        z = typed.origin[2];
      if (f.originalTrianglesFeet.flat().some((p) => !close(p[2], z)))
        throw Error("Authored face differs from exact typed elevation");
      const a = lineEnds(typed.startLine),
        b = lineEnds(typed.endLine);
      // Original control lines can supply two sides of a six-vertex winder.
      // They establish finite source role contacts, never replace its footprint.
      if (
        !contains(typed.origin, loop) ||
        !boundarySpan(a[0]!, a[1]!, loop) ||
        !boundarySpan(b[0]!, b[1]!, loop)
      )
        throw Error(
          `Authored run ${r.nativeRunId} face ${f.faceToken} has unsupported finite typed span`,
        );
      treads.push({
        runElementId: r.nativeRunId,
        elevationFeet: z,
        ringFeet: loop.map((p) => [p[0], p[1]]),
      });
    }
    indices.sort((a, b) => a - b);
    if (!indices.length || indices.some((n, i) => n !== i))
      throw Error("Original typed tread inventory is incomplete");
    out.set(r.nativeRunId, treads);
  }
  return out;
}
