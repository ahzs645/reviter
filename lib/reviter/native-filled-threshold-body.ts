/** Bounded diagnostics for one original six-face filled box and its persisted
 * placement. Every Face/Edge/Loop/Plane/GFilling operand is retained; fillings
 * are supported only as face-bound null-data hatches. No source is normalized,
 * no bound is substituted for a face, and no navigation capability is issued.
 * Hashes bind supplied extracted frames, not their independent RVT membership. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { activeClassTagTranslation } from "./revit-class-tags.ts";
import { activeElementIdBytes } from "./element-id-width.ts";
import { decodeRevit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
} from "./revit-2027-grep-replay.ts";
import { collectRevit2027GInstanceBindings } from "./revit-2027-nested-instance.ts";
import {
  revit2027OwnerMeshIndex,
  revit2027OwnerSurface,
} from "./revit-2027-owner-mesh-index.ts";
import {
  walkRevit2027DirectedLoopEdges,
  revit2027DirectedEdgeUvs,
} from "./revit-2027-owner-mesh-trim.ts";
import type { Revit2027GeometryStatic } from "./revit-2027-geometry.ts";
import type { Revit2027GFilling } from "./revit-2027-gfilling.ts";
import type { Revit2027PlaneSurface } from "./revit-2027-surfaces.ts";
import { inspectOriginalWallTrimObstacleBranches } from "./native-source-wall-trim-obstacles.ts";
import { Rational, rational } from "./native-rational-overlay.ts";

type P = [Rational, Rational, Rational];
export type ThresholdRational = [string, string];
export type ThresholdPoint = [
  ThresholdRational,
  ThresholdRational,
  ThresholdRational,
];
const add = (a: Rational, b: Rational) =>
  new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Rational, b: Rational) =>
  new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d);
const cmp = (a: Rational, b: Rational) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const same = (a: P, b: P) => a.every((v, i) => cmp(v, b[i]!) === 0);
const minus = (a: P, b: P) => a.map((v, i) => sub(v, b[i]!)) as P;
const cross = (a: P, b: P): P => [
  sub(mul(a[1], b[2]), mul(a[2], b[1])),
  sub(mul(a[2], b[0]), mul(a[0], b[2])),
  sub(mul(a[0], b[1]), mul(a[1], b[0])),
];
const dot = (a: P, b: P) =>
  a.reduce((s, v, i) => add(s, mul(v, b[i]!)), rational(0));
const pair = (q: Rational): ThresholdRational => [
  q.n.toString(),
  q.d.toString(),
];
const point = (p: P): ThresholdPoint => p.map(pair) as ThresholdPoint;
const unpack = (p: ThresholdPoint): P =>
  p.map(([n, d]) => new Rational(BigInt(n), BigInt(d))) as P;
const affine = (s: Revit2027PlaneSurface, uv: readonly number[]): P =>
  [0, 1, 2].map((i) =>
    add(
      add(
        rational(s.origin[i]!),
        mul(rational(s.xVector[i]!), rational(uv[0]!)),
      ),
      mul(rational(s.yVector[i]!), rational(uv[1]!)),
    ),
  ) as P;
const hash = (b: Uint8Array) => bytesToHex(sha256(b));

/** JSON-safe exact source ledger: bigint IDs remain decimal strings; doubles
 * remain their original finite values, including signed zero explicitly. */
export function thresholdSourceOperands(value: unknown): unknown {
  if (typeof value === "bigint") return { bigint: value.toString() };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw Error("Nonfinite source operand");
    return Object.is(value, -0) ? { binary64: "-0" } : value;
  }
  if (Array.isArray(value)) return value.map(thresholdSourceOperands);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, thresholdSourceOperands(v)]),
    );
  return value;
}
const authority = {
  originalSourceAuthorityGranted: false as const,
  walkingSupportApproved: false as const,
  clearanceApproved: false as const,
  routeApproved: false as const,
  wheelchairApproved: false as const,
};
export type FilledThresholdFace = {
  faceToken: number;
  faceFlags: number;
  surfaceToken: number;
  loopToken: number;
  fillingToken: number;
  edgeTokens: number[];
  localRingFeet: ThresholdPoint[];
};
export type FilledThresholdDefinition = {
  format: "original-filled-threshold-definition-v1";
  ok: boolean;
  definitionElementId: string;
  exactClosedSixFaceBox: boolean;
  faces: FilledThresholdFace[];
  sourceLedger: unknown;
  minimumFeet?: ThresholdPoint;
  maximumFeet?: ThresholdPoint;
  volumeCubicFeet?: ThresholdRational;
  topology?: {
    faceCount: 6;
    edgeCount: 12;
    vertexCount: 8;
    eulerCharacteristic: 2;
  };
  blockers: string[];
} & typeof authority;

/** Pure replay predicate, deliberately separate from source membership and
 * production threshold admission. Original box axes need not be world axes. */
export function inspectFilledThresholdDefinition(
  replay: Revit2027GRepReplay,
): FilledThresholdDefinition {
  const report: FilledThresholdDefinition = {
    format: "original-filled-threshold-definition-v1",
    ok: false,
    definitionElementId: String(replay.ownerElementId),
    exactClosedSixFaceBox: false,
    faces: [],
    sourceLedger: [],
    blockers: [],
    ...authority,
  };
  try {
    if (replay.spans.length > 128)
      throw Error("Threshold replay exceeds bounded operand census");
    report.sourceLedger = thresholdSourceOperands(replay);
    // This existing independent guard checks original Geometry ownership,
    // parentage, primitive census and every face-bound null-data hatch branch.
    const guarded = inspectOriginalWallTrimObstacleBranches(replay);
    if (!guarded.ok) throw Error(guarded.blockers.join("; "));
    const expected = new Map([
      ["Revit2027Geometry", 1],
      ["Revit2027Face", 6],
      ["Revit2027GEdge", 12],
      ["Revit2027EdgeLoop", 6],
      ["Revit2027GFilling", 6],
      ["Revit2027AnalyticSurface:634", 6],
    ]);
    if (
      replay.spans.length !== 37 ||
      [...expected].some(
        ([reader, n]) =>
          replay.spans.filter((s) => s.readerId === reader).length !== n,
      )
    )
      throw Error(
        "Requires exactly one complete six-face/twelve-edge filled box",
      );
    const geometry = replay.spans[0]!;
    const g = geometry.value as Revit2027GeometryStatic;
    if (
      geometry.readerId !== "Revit2027Geometry" ||
      geometry.parentReplayIndex !== null ||
      g.flags !== 7 ||
      g.tessEpsCntrl.type !== 0 ||
      g.tessEpsCntrl.version !== 1 ||
      g.sharedSurfaceInfo.count !== 0
    )
      throw Error("Unsupported original filled-box Geometry semantics");
    const index = revit2027OwnerMeshIndex(replay),
      byToken = new Map(replay.spans.map((s) => [s.propertyToken, s]));
    const surfaces = new Map<number, Revit2027PlaneSurface>(),
      rings = new Map<number, P[]>(),
      uses = new Map<number, number[]>();
    for (const [ft, f] of index.faces) {
      const fs = byToken.get(ft)!,
        s = revit2027OwnerSurface<Revit2027PlaneSurface>(index, 634, ft);
      const loop = index.loops.get(f.firstLoop.token);
      const filling = byToken.get(f.foregroundFilling.token),
        fill = filling?.value as Revit2027GFilling | undefined;
      if (
        fs.parentReplayIndex !== geometry.replayIndex ||
        ![4, 6].includes(f.faceFlags) ||
        f.cutType !== 0 ||
        f.faceRegions.count !== 0 ||
        f.backgroundFilling.token !== 0 ||
        !s ||
        s.kind !== "plane" ||
        s.surface.orientFlag !== true ||
        s.queuedProperties.length ||
        [...s.origin, ...s.xVector, ...s.yVector].some(
          (n) => !Number.isFinite(n),
        ) ||
        !loop ||
        loop.loop.nextLoop.token !== 0 ||
        loop.loop.open ||
        loop.loop.faceReference !== ft ||
        byToken.get(loop.token)?.parentReplayIndex !== fs.replayIndex ||
        !filling ||
        filling.readerId !== "Revit2027GFilling" ||
        filling.parentReplayIndex !== fs.replayIndex ||
        fill?.faceIdReference !== ft ||
        fill.data.token !== 0 ||
        fill.queuedProperties.length ||
        fill.flags !== 18 ||
        fill.patternElementId !== -1n ||
        fill.placer.placedDraft !== false ||
        byToken.get(f.surface.token)?.parentReplayIndex !== fs.replayIndex
      )
        throw Error(
          "Unsupported filled Face/Plane/Loop/hatch semantics or original parent",
        );
      const walk = walkRevit2027DirectedLoopEdges({
        faceToken: ft,
        loop,
        edges: index.edges,
        loopArity: "open",
      });
      if (!walk.ok || walk.edges.length !== 4)
        throw Error(
          "A threshold face must have one four-edge original closed loop",
        );
      const uv = walk.edges.map((e) => revit2027DirectedEdgeUvs(e));
      const ring: P[] = [];
      for (const [i, e] of walk.edges.entries()) {
        const next = walk.edges[(i + 1) % 4]!,
          prev = walk.edges[(i + 3) % 4]!;
        if (
          e.edge.interiorEdgePoints.length ||
          e.edge.flags < 0 ||
          e.edge.flags > 7 ||
          byToken.get(e.token)?.parentReplayIndex !== geometry.replayIndex ||
          e.edge.nextReferences[e.side] !==
            (i === 3 ? loop.token : next.token) ||
          e.edge.previousReferences[e.side] !==
            (i === 0 ? loop.token : prev.token) ||
          uv[i]!.length !== 2 ||
          uv[i]!.some(
            (p) => p.length !== 2 || p.some((v) => !Number.isFinite(v)),
          ) ||
          uv[i]![1]!.some((n, k) => n !== uv[(i + 1) % 4]![0]![k])
        )
          throw Error(
            "Curved, unsupported or nonreciprocal original coedge; exact UV closure required",
          );
        ring.push(affine(s, uv[i]![0]!));
        uses.set(e.token, [...(uses.get(e.token) ?? []), ft]);
      }
      const normal = cross(
        minus(ring[1]!, ring[0]!),
        minus(ring[2]!, ring[1]!),
      );
      const sourceNormal = cross(
        s.xVector.map(rational) as P,
        s.yVector.map(rational) as P,
      ).map((v) => (f.faceFlags === 6 ? new Rational(-v.n, v.d) : v)) as P;
      if (
        normal.every((q) => q.n === 0n) ||
        cross(normal, sourceNormal).some((q) => q.n !== 0n) ||
        dot(normal, sourceNormal).n <= 0n
      )
        throw Error(
          "Original face winding disagrees with its explicit Face/Plane orientation",
        );
      surfaces.set(ft, s);
      rings.set(ft, ring);
      report.faces.push({
        faceToken: ft,
        faceFlags: f.faceFlags,
        surfaceToken: f.surface.token,
        loopToken: loop.token,
        fillingToken: filling.propertyToken,
        edgeTokens: walk.edges.map((e) => e.token),
        localRingFeet: ring.map(point),
      });
    }
    for (const [et, e] of index.edges) {
      const a = surfaces.get(e.faceReferences[0]),
        b = surfaces.get(e.faceReferences[1]),
        used = uses.get(et);
      if (
        !a ||
        !b ||
        e.faceReferences[0] === e.faceReferences[1] ||
        used?.length !== 2 ||
        new Set(used).size !== 2 ||
        !used.every((f) => e.faceReferences.includes(f))
      )
        throw Error("An original edge lacks its two distinct reciprocal faces");
      for (const endpoint of e.firstAndLastEdgePoints)
        if (
          !same(
            affine(a, endpoint.firstFaceUv),
            affine(b, endpoint.secondFaceUv),
          )
        )
          throw Error(
            "Original twin-face endpoints disagree exactly; no snapping allowed",
          );
    }
    const vertices = [...rings.values()].flat(),
      minima = [0, 1, 2].map((i) =>
        vertices.reduce(
          (a, p) => (cmp(a, p[i]!) < 0 ? a : p[i]!),
          vertices[0]![i]!,
        ),
      ) as P,
      maxima = [0, 1, 2].map((i) =>
        vertices.reduce(
          (a, p) => (cmp(a, p[i]!) > 0 ? a : p[i]!),
          vertices[0]![i]!,
        ),
      ) as P;
    if (minima.some((q, i) => cmp(q, maxima[i]!) >= 0))
      throw Error("Degenerate original box extent");
    const cornerKey = (p: P) =>
      p
        .map((q, i) =>
          cmp(q, minima[i]!) === 0 ? "0" : cmp(q, maxima[i]!) === 0 ? "1" : "?",
        )
        .join("");
    if (
      new Set(vertices.map(cornerKey)).size !== 8 ||
      vertices.some((p) => cornerKey(p).includes("?"))
    )
      throw Error(
        "Original face vertices do not share exactly eight box corners",
      );
    const sides = new Set<string>();
    for (const ring of rings.values()) {
      const fixed = [0, 1, 2].filter((i) =>
        ring.every((p) => cmp(p[i]!, ring[0]![i]!) === 0),
      );
      if (fixed.length !== 1 || new Set(ring.map(cornerKey)).size !== 4)
        throw Error("Original face is not one complete finite box side");
      const axis = fixed[0]!,
        high = cmp(ring[0]![axis]!, maxima[axis]!) === 0;
      for (let i = 0; i < 4; i++)
        if (
          minus(ring[(i + 1) % 4]!, ring[i]!).filter((q) => q.n !== 0n)
            .length !== 1
        )
          throw Error("Original face contains a diagonal or crossed box edge");
      const normal = cross(
        minus(ring[1]!, ring[0]!),
        minus(ring[2]!, ring[1]!),
      );
      if (normal[axis]!.n === 0n || normal[axis]!.n > 0n !== high)
        throw Error("Original box face points into the body");
      const side = `${axis}:${high}`;
      if (sides.has(side)) throw Error("Duplicate original box side");
      sides.add(side);
    }
    if (sides.size !== 6 || uses.size !== 12)
      throw Error("Incomplete original box boundary");
    report.minimumFeet = point(minima);
    report.maximumFeet = point(maxima);
    report.volumeCubicFeet = pair(
      minima.reduce((v, q, i) => mul(v, sub(maxima[i]!, q)), rational(1)),
    );
    report.topology = {
      faceCount: 6,
      edgeCount: 12,
      vertexCount: 8,
      eulerCharacteristic: 2,
    };
    report.ok = report.exactClosedSixFaceBox = true;
  } catch (error) {
    report.blockers.push(
      error instanceof Error ? error.message : String(error),
    );
  }
  return report;
}

export type ThresholdFrameInput = {
  bytes: Uint8Array;
  nativeElementId: number;
  sha256: string;
};
function decodeFrame(input: ThresholdFrameInput) {
  if (
    activeClassTagTranslation() !== null ||
    activeElementIdBytes() !== 8 ||
    !Number.isSafeInteger(input.nativeElementId) ||
    input.nativeElementId <= 0 ||
    !/^[a-f0-9]{64}$/.test(input.sha256) ||
    input.bytes.length < 24 ||
    input.bytes.length > 1024 * 1024 ||
    hash(input.bytes) !== input.sha256
  )
    throw Error("Exact bounded wide-ID original frame bytes/ID/SHA required");
  const view = new DataView(
    input.bytes.buffer,
    input.bytes.byteOffset,
    input.bytes.length,
  );
  if (view.getBigUint64(0, true) !== BigInt(input.nativeElementId))
    throw Error("Original frame header owner mismatch");
  const length = view.getUint32(12, true);
  if (length + 20 !== input.bytes.length || view.getUint16(16, true) !== 2246)
    throw Error("Original frame length/marker mismatch");
  let a = 1,
    b = 0;
  for (let i = 16; i < 16 + length; i++) {
    a = (a + input.bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  if ((b * 65536 + a) >>> 0 !== view.getUint32(8, true))
    throw Error("Original frame inner checksum mismatch");
  const root = decodeRevit2027FramedGRepRoot(
    input.bytes,
    {
      offset: 0,
      elementId: input.nativeElementId,
      marker: 2246,
      objectLength: view.getUint32(12, true),
      typeCode: view.getUint32(18, true),
    },
    2027,
  );
  if (!root.ok) throw Error(root.error);
  if (
    root.value.ownerElementId !== BigInt(input.nativeElementId) ||
    root.value.dynamicPayloadEndOffset + 4 !== input.bytes.length
  )
    throw Error("Unexpected original root owner or frame tail");
  const replay = replayRevit2027GRepFifo(input.bytes, root.value);
  if (!replay.ok) throw Error(replay.error);
  if (replay.value.endOffset !== root.value.dynamicPayloadEndOffset)
    throw Error(
      "Original typed FIFO did not consume the complete frame payload",
    );
  return { root: root.value, replay: replay.value };
}
export type FilledThresholdPairReport = {
  format: "original-filled-threshold-pair-v1";
  ok: boolean;
  suppliedFrames: {
    placed: { nativeElementId: number; sha256: string };
    definition: { nativeElementId: number; sha256: string };
  };
  definition?: FilledThresholdDefinition;
  originalPlacement?: unknown;
  placedFaces?: { faceToken: number; ringFeet: ThresholdPoint[] }[];
  bottomCap?: {
    faceToken: number;
    ringFeet: ThresholdPoint[];
    elevationFeet: ThresholdRational;
  };
  topCap?: {
    faceToken: number;
    ringFeet: ThresholdPoint[];
    elevationFeet: ThresholdRational;
  };
  riseFeet?: ThresholdRational;
  sideFaceTokens?: number[];
  exactClosedPlacedBox: boolean;
  sourceMembershipIndependentlyRevalidated: false;
  blockers: string[];
} & typeof authority;

/** Decode an exact single persisted external instance and the referenced box.
 * Original affine operands, including tiny nonzero terms, are used as rationals.
 * A successful result is a closed mathematical body diagnostic only. */
export function inspectFilledThresholdFrames(
  placed: ThresholdFrameInput,
  definition: ThresholdFrameInput,
): FilledThresholdPairReport {
  const report: FilledThresholdPairReport = {
    format: "original-filled-threshold-pair-v1",
    ok: false,
    suppliedFrames: {
      placed: {
        nativeElementId: placed.nativeElementId,
        sha256: placed.sha256,
      },
      definition: {
        nativeElementId: definition.nativeElementId,
        sha256: definition.sha256,
      },
    },
    exactClosedPlacedBox: false,
    sourceMembershipIndependentlyRevalidated: false,
    blockers: [],
    ...authority,
  };
  try {
    const p = decodeFrame(placed),
      d = decodeFrame(definition);
    if (
      p.root.objectType !== 3 ||
      p.root.flags !== 0 ||
      d.root.objectType !== 3 ||
      d.root.flags !== 2 ||
      p.root.gInfo.controlCommand !== 0 ||
      d.root.gInfo.controlCommand !== 0 ||
      p.root.children.length !== 1 ||
      p.root.children[0]!.sourceClassSlot !== 2215 ||
      d.root.children.length !== 1 ||
      d.root.children[0]!.sourceClassSlot !== 2343
    )
      throw Error("Unsupported original placed/definition root semantics");
    const bindings = collectRevit2027GInstanceBindings(p.replay);
    if (
      !bindings.ok ||
      bindings.value.length !== 1 ||
      bindings.value[0]!.kind !== "external" ||
      p.replay.spans.length !== 2 ||
      p.replay.spans[0]!.readerId !== "Revit2027GInstance" ||
      p.replay.spans[1]!.readerId !== "Revit2027InstanceInfo"
    )
      throw Error(
        "Requires one complete original external placement, without conditions or additional bodies",
      );
    const instance = bindings.value[0]!.instance;
    if (
      instance.symbolElementId !== BigInt(definition.nativeElementId) ||
      instance.ownerElementId !== BigInt(placed.nativeElementId) ||
      instance.hasScale ||
      instance.resolveSymbolInView ||
      instance.forbiddenTarget !== 0 ||
      instance.tagElementId !== -1n ||
      instance.gRepId !== 0 ||
      instance.cda !== 1
    )
      throw Error(
        "Original instance target or placement semantics are unsupported",
      );
    report.originalPlacement = thresholdSourceOperands({
      root: p.root,
      replay: p.replay,
      instance,
      definitionRoot: d.root,
    });
    report.definition = inspectFilledThresholdDefinition(d.replay);
    if (!report.definition.ok)
      throw Error(report.definition.blockers.join("; "));
    const m = instance.transform.matrix.map(rational),
      columns = [0, 4, 8].map((i) => m.slice(i, i + 3) as P);
    if (
      m[3]!.n ||
      m[7]!.n ||
      m[11]!.n ||
      cmp(m[15]!, rational(1)) ||
      dot(columns[0]!, cross(columns[1]!, columns[2]!)).n <= 0n
    )
      throw Error(
        "Original placement is not a supported nonsingular orientation-preserving affine transform",
      );
    const transform = (p: P): P =>
      [0, 1, 2].map((i) =>
        p.reduce((q, v, j) => add(q, mul(m[j * 4 + i]!, v)), m[12 + i]!),
      ) as P;
    const faces = report.definition.faces.map((f) => ({
      faceToken: f.faceToken,
      ring: f.localRingFeet.map((p) => transform(unpack(p))),
    }));
    report.placedFaces = faces.map((f) => ({
      faceToken: f.faceToken,
      ringFeet: f.ring.map(point),
    }));
    const caps = faces
      .filter((f) => f.ring.every((p) => cmp(p[2], f.ring[0]![2]) === 0))
      .toSorted((a, b) => cmp(a.ring[0]![2], b.ring[0]![2]));
    if (
      caps.length !== 2 ||
      cmp(caps[0]!.ring[0]![2], caps[1]!.ring[0]![2]) >= 0
    )
      throw Error(
        "Placed threshold must have two distinct exactly horizontal original caps",
      );
    const bottom = caps[0]!,
      top = caps[1]!;
    if (
      !bottom.ring.every((p) =>
        top.ring.some((q) => cmp(p[0], q[0]) === 0 && cmp(p[1], q[1]) === 0),
      )
    )
      throw Error("Placed cap footprints disagree exactly");
    const side = faces.filter((f) => !caps.includes(f));
    for (const face of side) {
      if (
        face.ring.filter((p) => cmp(p[2], bottom.ring[0]![2]) === 0).length !==
          2 ||
        face.ring.filter((p) => cmp(p[2], top.ring[0]![2]) === 0).length !== 2
      )
        throw Error("Original placed side does not span both exact cap planes");
      for (let i = 0; i < 4; i++) {
        const a = face.ring[i]!,
          b = face.ring[(i + 1) % 4]!;
        if (
          cmp(a[2], b[2]) !== 0 &&
          (cmp(a[0], b[0]) !== 0 || cmp(a[1], b[1]) !== 0)
        )
          throw Error("Original placed riser edge is not exactly vertical");
      }
    }
    report.bottomCap = {
      faceToken: bottom.faceToken,
      ringFeet: bottom.ring.map(point),
      elevationFeet: pair(bottom.ring[0]![2]),
    };
    report.topCap = {
      faceToken: top.faceToken,
      ringFeet: top.ring.map(point),
      elevationFeet: pair(top.ring[0]![2]),
    };
    report.riseFeet = pair(sub(top.ring[0]![2], bottom.ring[0]![2]));
    report.sideFaceTokens = side.map((f) => f.faceToken);
    report.ok = report.exactClosedPlacedBox = true;
  } catch (error) {
    report.blockers.push(
      error instanceof Error ? error.message : String(error),
    );
  }
  return report;
}
