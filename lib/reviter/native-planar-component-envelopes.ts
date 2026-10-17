import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { canonicalClassTag } from "./revit-class-tags.ts";
import { decodeRevit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo, type Revit2027GRepReplay } from "./revit-2027-grep-replay.ts";
import { revit2027OwnerMeshIndex, revit2027OwnerSurface } from "./revit-2027-owner-mesh-index.ts";
import { revit2027DirectedEdgeUvs, walkRevit2027DirectedLoopEdges } from "./revit-2027-owner-mesh-trim.ts";
import type { Revit2027PlaneSurface } from "./revit-2027-surfaces.ts";
import { Rational, rational, nativeRationalScalarToIEEE } from "./native-rational-overlay.ts";
import type { Bounds3 } from "./types.ts";

type P3 = [Rational, Rational, Rational];
const add = (a: Rational, b: Rational) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d);
const cmp = (a: Rational, b: Rational) => {
  const difference = a.n * b.d - b.n * a.d;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
};
const affine = (plane: Revit2027PlaneSurface, uv: readonly number[]): P3 => [0, 1, 2].map((axis) =>
  add(add(rational(plane.origin[axis]!), mul(rational(plane.xVector[axis]!), rational(uv[0]!))),
    mul(rational(plane.yVector[axis]!), rational(uv[1]!))),
) as P3;

/** Directed conversion is necessary: ordinary rounding can shrink a material
 * envelope below an untouched original rational affine endpoint. */
export function outwardNativeRationalBound(value: Rational, direction: -1 | 1): number {
  let result = nativeRationalScalarToIEEE(value);
  if (!Number.isFinite(result)) throw Error("Non-finite original material bound");
  if (cmp(rational(result), value) * direction >= 0) return result;
  if (result === 0) return direction * Number.MIN_VALUE;
  const buffer = new ArrayBuffer(8), view = new DataView(buffer);
  view.setFloat64(0, result, false);
  const bits = view.getBigUint64(0, false);
  view.setBigUint64(0, bits + ((result > 0) === (direction > 0) ? 1n : -1n), false);
  result = view.getFloat64(0, false);
  if (!Number.isFinite(result) || cmp(rational(result), value) * direction < 0)
    throw Error("Original material bound failed directed enclosure");
  return result;
}

export type NativePlanarComponentEnvelope = {
  version: 1;
  use: "foreign-material-envelope-only";
  nativeElementId: number;
  sourceFrameSha256: string;
  originalFrameHex: string;
  boundsFeet: Bounds3;
  components: { faceTokens: number[]; boundsFeet: Bounds3 }[];
};

/** A conservative envelope, not a solid or walking-body proof. Every finite
 * plane DOMAIN and raw coedge endpoint is retained. The complete reciprocal
 * topological component is enclosed in its box, including its entire interior.
 * Unequal twin parametrizations enlarge the envelope; they are never welded.
 * Unknown primitives, branches, holes, null loops and open topology refuse.
 * This pure replay predicate grants no original-source membership by itself. */
export function planarComponentEnvelopeGeometry(replay: Revit2027GRepReplay): NativePlanarComponentEnvelope["components"] | undefined {
  try {
    const allowed = new Set(["Revit2027Geometry", "Revit2027Face", "Revit2027GEdge", "Revit2027EdgeLoop", "Revit2027AnalyticSurface:634"]);
    if (!replay.spans.length || replay.spans.length > 32768 || replay.spans.some((s) =>
      !allowed.has(s.readerId) || s.ownerElementId !== replay.ownerElementId)) return;
    if (new Set(replay.spans.map((s) => s.propertyToken)).size !== replay.spans.length) return;
    const index = revit2027OwnerMeshIndex(replay), counts = (reader: string) => replay.spans.filter((s) => s.readerId === reader).length;
    if (counts("Revit2027Geometry") !== 1 || !index.faces.size || index.faces.size > 8192 ||
      index.faces.size !== counts("Revit2027Face") || index.faces.size !== counts("Revit2027AnalyticSurface:634") ||
      index.edges.size !== counts("Revit2027GEdge") || index.loops.size !== counts("Revit2027EdgeLoop")) return;
    const facePoints = new Map<number, P3[]>(), usedLoops = new Set<number>(), uses = new Map<number, { face: number; direction: number }[]>();
    for (const [token, face] of index.faces) {
      if (face.faceFlags !== 4 || face.cutType !== 0 || face.faceRegions.count !== 0 || face.firstLoop.token <= 0 || face.surface.sourceClassSlot !== 634) return;
      const plane = revit2027OwnerSurface<Revit2027PlaneSurface>(index, 634, token), loop = index.loops.get(face.firstLoop.token);
      if (!plane || plane.kind !== "plane" || !plane.surface.orientFlag || !loop || usedLoops.has(loop.token) ||
        loop.loop.faceReference !== token || loop.loop.open || loop.loop.nextLoop.token !== 0) return;
      if ([...plane.origin, ...plane.xVector, ...plane.yVector].some((n) => !Number.isFinite(n))) return;
      // A degenerate plane cannot establish a bounded finite face domain.
      const [x, y] = [plane.xVector.map(rational), plane.yVector.map(rational)];
      if ([0, 1, 2].every((a) => cmp(mul(x[(a + 1) % 3]!, y[(a + 2) % 3]!), mul(x[(a + 2) % 3]!, y[(a + 1) % 3]!)) === 0)) return;
      const walk = walkRevit2027DirectedLoopEdges({ faceToken: token, loop, edges: index.edges, loopArity: "open" });
      if (!walk.ok || walk.edges.length < 3) return;
      usedLoops.add(loop.token);
      const uv = [plane.surface.envelope.firstCorner, plane.surface.envelope.secondCorner, loop.loop.envelope.minimum, loop.loop.envelope.maximum];
      for (const [i, edge] of walk.edges.entries()) {
        const next = i === walk.edges.length - 1 ? loop.token : walk.edges[i + 1]!.token;
        const previous = i === 0 ? loop.token : walk.edges[i - 1]!.token;
        if (edge.edge.nextReferences[edge.side] !== next || edge.edge.previousReferences[edge.side] !== previous) return;
        uv.push(...revit2027DirectedEdgeUvs(edge));
        const previousUses = uses.get(edge.token) ?? [];
        previousUses.push({ face: token, direction: edge.direction }); uses.set(edge.token, previousUses);
      }
      if (uv.some((point) => point.length !== 2 || point.some((n) => !Number.isFinite(n)))) return;
      const u = uv.map((p) => p[0]!), v = uv.map((p) => p[1]!);
      // The full original domain rectangle contains every original trim; no
      // finite positive residual is discarded, even if twins disagree.
      facePoints.set(token, [[Math.min(...u), Math.min(...v)], [Math.min(...u), Math.max(...v)],
        [Math.max(...u), Math.min(...v)], [Math.max(...u), Math.max(...v)]].map((point) => affine(plane, point)));
    }
    if (usedLoops.size !== index.loops.size) return;
    const adjacency = new Map<number, number[]>();
    for (const [token, edge] of index.edges) {
      const used = uses.get(token), [a, b] = edge.faceReferences;
      if (a === b || !facePoints.has(a) || !facePoints.has(b) || !used || used.length !== 2 ||
        new Set(used.map((u) => u.face)).size !== 2 || !used.every((u) => edge.faceReferences.includes(u.face)) || used[0]!.direction !== -used[1]!.direction) return;
      adjacency.set(a, [...(adjacency.get(a) ?? []), b]); adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
    }
    const visited = new Set<number>(), components: NativePlanarComponentEnvelope["components"] = [];
    for (const token of index.faces.keys()) {
      if (visited.has(token)) continue;
      const queue = [token]; visited.add(token);
      for (let i = 0; i < queue.length; i++) for (const next of adjacency.get(queue[i]!) ?? []) if (!visited.has(next)) { visited.add(next); queue.push(next); }
      if (queue.length < 4) return;
      const points = queue.flatMap((face) => facePoints.get(face)!);
      const lower = [0, 1, 2].map((axis) => points.reduce((best, p) => cmp(p[axis]!, best) < 0 ? p[axis]! : best, points[0]![axis]!));
      const upper = [0, 1, 2].map((axis) => points.reduce((best, p) => cmp(p[axis]!, best) > 0 ? p[axis]! : best, points[0]![axis]!));
      if (lower.some((lo, axis) => cmp(lo, upper[axis]!) >= 0)) return;
      const min = lower.map((q) => outwardNativeRationalBound(q, -1)), max = upper.map((q) => outwardNativeRationalBound(q, 1));
      components.push({ faceTokens: queue.sort((a, b) => a - b), boundsFeet: { min: { x: min[0]!, y: min[1]!, z: min[2]! }, max: { x: max[0]!, y: max[1]!, z: max[2]! } } });
    }
    return components;
  } catch { return undefined; }
}

/** Immutable original bytes must be supplied by the source-model producer.
 * Independently replaying the whole frame prevents prepared triangles, omitted
 * source operands or a freshly authored polygon from narrowing material. */
export function originalNativePlanarComponentEnvelope(originalFrame: Uint8Array): NativePlanarComponentEnvelope | undefined {
  try {
    const bytes = Uint8Array.from(originalFrame);
    if (bytes.length < 20 || bytes.length > 8 * 1024 * 1024) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const frame = { offset: 0, elementId: view.getUint32(0, true), marker: canonicalClassTag(view.getUint16(16, true)), objectLength: view.getUint32(12, true), typeCode: view.getUint32(18, true) };
    // Read the supplied COMPLETE frame directly. A legacy page scanner has a
    // 65,535-byte heuristic and would silently lose complete larger bodies.
    if (!Number.isSafeInteger(frame.elementId) || frame.elementId <= 0 || frame.marker !== 2246 || frame.objectLength + 20 !== bytes.length || view.getUint32(bytes.length - 4, true) !== frame.objectLength) return;
    // The frame index checks framing, not the original Adler checksum.
    let a = 1, b = 0;
    for (let i = 16; i < bytes.length - 4; i++) { a = (a + bytes[i]!) % 65521; b = (b + a) % 65521; }
    if (((b * 65536 + a) >>> 0) !== view.getUint32(8, true)) return;
    const root = decodeRevit2027FramedGRepRoot(bytes, frame, 2027);
    if (!root.ok || root.value.ownerElementId !== BigInt(frame.elementId) || root.value.objectType !== 3 || root.value.flags !== 2 || !root.value.localExtents.valid || !root.value.worldExtents.valid ||
      JSON.stringify(root.value.localExtents) !== JSON.stringify(root.value.worldExtents)) return;
    const replay = replayRevit2027GRepFifo(bytes, root.value, undefined, { maxReplayEntries: 32768, maxDescriptors: 65536 });
    if (!replay.ok) return;
    const components = planarComponentEnvelopeGeometry(replay.value);
    if (!components?.length) return;
    const box = root.value.worldExtents;
    return { version: 1, use: "foreign-material-envelope-only", nativeElementId: frame.elementId,
      sourceFrameSha256: bytesToHex(sha256(bytes)), originalFrameHex: bytesToHex(bytes),
      boundsFeet: { min: { x: box.minimum[0], y: box.minimum[1], z: box.minimum[2] }, max: { x: box.maximum[0], y: box.maximum[1], z: box.maximum[2] } }, components };
  } catch { return undefined; }
}
