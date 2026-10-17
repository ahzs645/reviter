/** Unwired, named original floor-face support. This does not certify a whole
 * floor solid, terminal contact, access, foreign clearance or a route. A curved
 * boundary is retained inside its COMPLETE analytic cylinder enclosure; its
 * sampled chord is only a reference winding operand outside that uncertainty. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  Rational,
  rational,
  nativeRationalOverlay,
  NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION,
  type NativeRationalPoint,
  type NativeRationalParts,
} from "./native-rational-overlay.ts";
import {
  encodeNativeExactTopology,
  nativeRationalPathSupported,
} from "./native-exact-planar-topology.ts";
import {
  revit2027OwnerMeshIndex,
  revit2027OwnerSurface,
} from "./revit-2027-owner-mesh-index.ts";
import {
  revit2027DirectedEdgeUvs,
  walkRevit2027DirectedLoopEdges,
} from "./revit-2027-owner-mesh-trim.ts";
import type {
  Revit2027PlaneSurface,
  Revit2027CylinderSurface,
} from "./revit-2027-surfaces.ts";
import type { Revit2027GRepReplay } from "./revit-2027-grep-replay.ts";
import { replayRevit2027GRepFifo } from "./revit-2027-grep-replay.ts";
import { decodeRevit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import {
  readOriginalForeignEnvelopeScopedFloor,
  type OriginalNativeForeignEnvelopeCensus,
} from "./native-source-foreign-envelope-census.ts";
import { exactClosedSourcePlanarContact } from "./native-source-planar-slab-envelope.ts";
import { nativeAxisAlignedSegmentInExactParts } from "./native-source-stair-stepped-stations.ts";
import { readSchema } from "./schema-reader.ts";
import { inspectOriginalElementLevelPrefix } from "./native-source-element-level-prefix.ts";

type Q = Rational;
type P2 = NativeRationalPoint;
const add = (a: Q, b: Q) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Q, b: Q) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q) => new Rational(a.n * b.n, a.d * b.d);
const cmp = (a: Q, b: Q) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const abs = (a: Q) => new Rational(a.n < 0n ? -a.n : a.n, a.d);
const div = (a: Q, b: Q) => new Rational(a.n * b.d, a.d * b.n);
const key = (p: readonly Q[]) => p.map((q) => `${q.n}/${q.d}`).join(":");
const cross = (a: P2, b: P2, c: P2) =>
  sub(
    mul(sub(b[0], a[0]), sub(c[1], a[1])),
    mul(sub(b[1], a[1]), sub(c[0], a[0])),
  );
const affine = (s: Revit2027PlaneSurface, uv: readonly number[]): P2 =>
  [0, 1].map((i) =>
    add(
      add(
        rational(s.origin[i]!),
        mul(rational(s.xVector[i]!), rational(uv[0]!)),
      ),
      mul(rational(s.yVector[i]!), rational(uv[1]!)),
    ),
  ) as P2;
function hull(values: readonly P2[]): P2[] {
  const a = [...new Map(values.map((p) => [key(p), p])).values()].sort(
    (p, q) => cmp(p[0], q[0]) || cmp(p[1], q[1]),
  );
  if (a.length < 3) return a;
  const half = (v: P2[]) => {
    const h: P2[] = [];
    for (const p of v) {
      while (h.length > 1 && cross(h.at(-2)!, h.at(-1)!, p).n <= 0n) h.pop();
      h.push(p);
    }
    return h;
  };
  return [...half(a).slice(0, -1), ...half([...a].reverse()).slice(0, -1)];
}
const polygon = (p: P2[]): NativeRationalParts => (p.length < 3 ? [] : [[p]]);
const union = (parts: NativeRationalParts[]) =>
  parts.length
    ? nativeRationalOverlay("union", parts[0]!, ...parts.slice(1))
    : [];

/** Exact validity of a reference operand, never a source geometry repair.
 * Vertex-only shell containment does not establish that a complete hole edge
 * stays in a concave shell. Every edge is checked with the original finite
 * rational cuts, including boundary-contact vertices and narrow notches. */
export function validateOriginalNamedCapReference(parts: NativeRationalParts) {
  encodeNativeExactTopology(
    {
      sourceModelSha256: "0".repeat(64),
      sourceGeometryKey: "untrusted-original-named-cap-reference",
      kernelVersion: NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION,
    },
    [{ id: "cap", parts }],
  );
  for (const part of parts) {
    const shell = part[0];
    if (!shell) throw Error("Missing original cap reference shell");
    for (const hole of part.slice(1))
      if (
        !hole.length ||
        !nativeRationalPathSupported([...hole, hole[0]!], [[shell]])
      )
        throw Error("Original cap hole edge leaves its complete shell");
  }
}

/** Exact Taylor/Lagrange bounds, not a tolerance. For real sin/cos all
 * derivatives have magnitude <=1, so the degree-24 remainder is bounded by
 * |u|^25/25!. The input angle and every arithmetic operation remain rational.
 * Refuse large source angles rather than perform an approximate reduction. */
export function originalCylinderTrigEnclosure(angle: number) {
  if (!Number.isFinite(angle) || Math.abs(angle) > 8)
    throw Error("Unsupported finite original cylinder angle");
  const x = rational(angle);
  let power = rational(1),
    factorial = 1n,
    sine = rational(0),
    cosine = rational(0);
  for (let n = 0; n <= 24; n++) {
    if (n) {
      power = mul(power, x);
      factorial *= BigInt(n);
    }
    const term = div(power, new Rational(factorial)),
      signed = Math.floor(n / 2) % 2 ? new Rational(-term.n, term.d) : term;
    if (n % 2) sine = add(sine, signed);
    else cosine = add(cosine, signed);
  }
  const remainder = div(abs(mul(power, x)), new Rational(factorial * 25n));
  return {
    sine: [sub(sine, remainder), add(sine, remainder)] as [Q, Q],
    cosine: [sub(cosine, remainder), add(cosine, remainder)] as [Q, Q],
    degree: 24 as const,
  };
}

function cylinderEndpointBox(
  s: Revit2027CylinderSurface,
  uv: readonly number[],
): P2[] {
  if (uv.length !== 2 || uv.some((v) => !Number.isFinite(v)))
    throw Error("Nonfinite original cylinder endpoint");
  const trig = originalCylinderTrigEnclosure(uv[0]!);
  const scaled = (bounds: [Q, Q], scale: Q): [Q, Q] =>
    scale.n >= 0n
      ? [mul(bounds[0], scale), mul(bounds[1], scale)]
      : [mul(bounds[1], scale), mul(bounds[0], scale)];
  const xy = [0, 1].map((axis) => {
    const c = scaled(
        trig.cosine,
        mul(rational(s.radius), rational(s.xVector[axis]!)),
      ),
      t = scaled(
        trig.sine,
        mul(rational(s.radius), rational(s.yVector[axis]!)),
      ),
      base = add(
        rational(s.center[axis]!),
        mul(rational(uv[1]!), rational(s.zVector[axis]!)),
      );
    return [add(base, add(c[0], t[0])), add(base, add(c[1], t[1]))] as [Q, Q];
  });
  return [
    [xy[0]![0], xy[1]![0]],
    [xy[0]![1], xy[1]![0]],
    [xy[0]![1], xy[1]![1]],
    [xy[0]![0], xy[1]![1]],
  ];
}

export type OriginalLocalFloorCapEnvelope = {
  nativeFloorElementId: number;
  originalFaceToken: number;
  originalFaceTag: number;
  originalPhysicalTopElevationFeet: Q;
  completeDeclaredFaceCount: number;
  completeDeclaredEdgeCount: number;
  originalCapLoopTokens: number[];
  originalCapEdgeTokens: number[];
  originalCurvedCapEdgeTokens: number[];
  originalCurvedAdjacentFaceTokens: number[];
  completeAnalyticCylinderUncertaintyPartsFeet: NativeRationalParts;
  originalReferenceWindingPartsFeet: NativeRationalParts;
  retainedPositiveBoundaryUncertaintyPartsFeet: NativeRationalParts;
  retainedZeroAreaBoundarySegmentsFeet: P2[][];
  originalBoundaryEnvelopeCellsFeet: {
    originalEdgeToken: number;
    partsFeet: NativeRationalParts;
    closedSegmentsFeet: P2[][];
  }[];
  guaranteedInnerSupportPartsFeet: NativeRationalParts;
  wholeFloorSolidApproved: false;
  originalSourceAuthorityGranted: false;
  terminalContactApproved: false;
  routeApproved: false;
};

/** Pure mathematics on an UNTRUSTED replay. A full source-bound wrapper below
 * obtains fresh owner/Floor/category bytes from an opaque actual-RVT context.
 * The scoped cap must have all its own declared loops/coedges, one exact
 * upward horizontal plane, face-bound fills and reciprocal finite boundaries.
 * Other original faces/edges remain in the complete census and are not
 * certified as material or support by this function. */
export function inspectOriginalNamedFloorCapSupport(
  replay: Revit2027GRepReplay,
  faceToken: number,
): OriginalLocalFloorCapEnvelope {
  const fail = (message: string): never => {
    throw Error(message);
  };
  const index = revit2027OwnerMeshIndex(replay),
    declaredSpans = replay.spans.filter(
      (s) => s.readerId === "Revit2027Geometry",
    );
  if (
    declaredSpans.length !== 1 ||
    replay.spans.some((s) => s.ownerElementId !== replay.ownerElementId)
  )
    fail("Missing, duplicate or foreign original floor Geometry");
  const positiveTokens = replay.spans
    .filter((s) => s.propertyToken > 0)
    .map((s) => s.propertyToken);
  if (new Set(positiveTokens).size !== positiveTokens.length)
    fail("Duplicate original positive property token");
  const geometrySpan = declaredSpans[0]!,
    declared = geometrySpan.value as {
      flags: number;
      faces: {
        count: number;
        entries: { token: number; sourceClassSlot: number }[];
      };
      edges: {
        count: number;
        entries: { token: number; sourceClassSlot: number }[];
      };
    };
  if (geometrySpan.parentReplayIndex !== null)
    fail(
      "Named floor Geometry has an unsupported source placement/selection parent",
    );
  const complete = (
    list: typeof declared.faces,
    actual: ReadonlyMap<number, unknown>,
    slot: number,
  ) =>
    list.count === actual.size &&
    list.entries.length === list.count &&
    new Set(list.entries.map((e) => e.token)).size === list.count &&
    list.entries.every(
      (e) => e.sourceClassSlot === slot && actual.has(e.token),
    );
  if (
    declared.flags !== 7 ||
    !complete(declared.faces, index.faces, 1825) ||
    !complete(declared.edges, index.edges, 1423) ||
    replay.spans.filter((s) => s.readerId === "Revit2027Face").length !==
      index.faces.size ||
    replay.spans.filter((s) => s.readerId === "Revit2027GEdge").length !==
      index.edges.size
  )
    fail("Incomplete declared original floor face/edge census");
  const face = index.faces.get(faceToken),
    faceSpan = replay.spans.find(
      (s) => s.readerId === "Revit2027Face" && s.propertyToken === faceToken,
    ),
    plane = revit2027OwnerSurface<Revit2027PlaneSurface>(index, 634, faceToken);
  if (
    !face ||
    !faceSpan ||
    faceSpan.parentReplayIndex !== geometrySpan.replayIndex ||
    ![4, 516].includes(face.faceFlags) ||
    face.cutType !== 0 ||
    face.faceRegions.count !== 0 ||
    face.firstLoop.token <= 0 ||
    face.surface.sourceClassSlot !== 634 ||
    !plane ||
    plane.kind !== "plane" ||
    plane.xVector[2] !== 0 ||
    plane.yVector[2] !== 0 ||
    !plane.surface.orientFlag ||
    [...plane.origin, ...plane.xVector, ...plane.yVector].some(
      (v) => !Number.isFinite(v),
    ) ||
    sub(
      mul(rational(plane.xVector[0]), rational(plane.yVector[1])),
      mul(rational(plane.xVector[1]), rational(plane.yVector[0])),
    ).n <= 0n
  )
    fail("Named original face is not a complete upward trimmed physical cap");
  const cap = face!,
    surface = plane!;
  const capDescendants = replay.spans.filter(
    (s) =>
      s.path.length > faceSpan!.path.length &&
      faceSpan!.path.every((p, i) => s.path[i] === p),
  );
  if (
    capDescendants.some(
      (s) =>
        ![
          "Revit2027EdgeLoop",
          "Revit2027GFilling",
          "Revit2027AnalyticSurface:634",
        ].includes(s.readerId),
    ) ||
    capDescendants.filter((s) => s.readerId === "Revit2027AnalyticSurface:634")
      .length !== 1 ||
    capDescendants.find((s) => s.readerId === "Revit2027AnalyticSurface:634")
      ?.propertyToken !== cap.surface.token
  )
    fail("Unsupported, duplicate or undeclared original cap branch");
  for (const pointer of [cap.foregroundFilling, cap.backgroundFilling]) {
    if (!pointer.token) continue;
    const span = replay.spans.find((s) => s.propertyToken === pointer.token),
      v = span?.value as
        | {
            faceIdReference?: number;
            data?: { token: number };
            queuedProperties?: unknown[];
          }
        | undefined;
    if (
      span?.readerId !== "Revit2027GFilling" ||
      span.parentReplayIndex !== faceSpan!.replayIndex ||
      v?.faceIdReference !== faceToken ||
      v.data?.token !== 0 ||
      v.queuedProperties?.length !== 0
    )
      fail("Unsupported or unowned original cap filling");
  }
  const loops: number[] = [],
    edges: number[] = [],
    curvedEdges: number[] = [],
    curvedFaces = new Set<number>(),
    rings: P2[][] = [],
    uncertainty: NativeRationalParts[] = [],
    cylinderParts: NativeRationalParts[] = [],
    zeroArea: P2[][] = [],
    boundaryCells: OriginalLocalFloorCapEnvelope["originalBoundaryEnvelopeCellsFeet"] =
      [];
  let next = cap.firstLoop.token;
  while (next) {
    const loop = index.loops.get(next);
    if (
      !loop ||
      loops.includes(next) ||
      loop.loop.open ||
      loop.loop.faceReference !== faceToken
    )
      fail("Incomplete, repeated or open original cap loop");
    const walked = walkRevit2027DirectedLoopEdges({
      faceToken,
      loop: loop!,
      edges: index.edges,
      loopArity: "open",
    });
    if (!walked.ok || walked.edges.length < 3)
      fail("Original cap loop coedge topology does not close");
    if (!walked.ok) throw Error("Unreachable original cap walk");
    loops.push(next);
    const reference: P2[] = [],
      embeddings: { points: P2[]; start: P2[]; end: P2[] }[] = [];
    for (const [i, e] of walked.edges.entries()) {
      if (
        edges.includes(e.token) ||
        e.edge.queuedPropertyCount !== 0 ||
        e.edge.previousReferences[e.side] !==
          (!i ? next : walked.edges[i - 1]!.token) ||
        e.edge.nextReferences[e.side] !==
          (i === walked.edges.length - 1 ? next : walked.edges[i + 1]!.token)
      )
        fail("Duplicated or nonreciprocal original cap coedge");
      edges.push(e.token);
      const uv = revit2027DirectedEdgeUvs(e);
      if (
        uv.length < 2 ||
        uv.some((p) => p.length !== 2 || p.some((v) => !Number.isFinite(v)))
      )
        fail("Nonfinite original cap coedge sample");
      const points = uv.map((p) => affine(surface, p));
      // Include every raw sample and both sides of a raw coedge join. They
      // supply only reference winding; all join sweeps remain below.
      for (const p of points)
        if (!reference.length || key(reference.at(-1)!) !== key(p))
          reference.push(p);
      const otherFaceToken = e.edge.faceReferences[e.side === 0 ? 1 : 0],
        other = index.faces.get(otherFaceToken);
      if (!other || otherFaceToken === faceToken)
        fail("Original cap boundary lacks an owned adjacent face");
      const adjacentSpan = replay.spans.find(
          (s) =>
            s.readerId === "Revit2027Face" &&
            s.propertyToken === otherFaceToken,
        ),
        adjacentSurfaceSpans = replay.spans.filter(
          (s) =>
            s.parentReplayIndex === adjacentSpan?.replayIndex &&
            s.readerId.startsWith("Revit2027AnalyticSurface:"),
        );
      if (
        !adjacentSpan ||
        adjacentSpan.parentReplayIndex !== geometrySpan.replayIndex ||
        adjacentSurfaceSpans.length !== 1
      )
        fail(
          "Original cap boundary surface ownership is incomplete or ambiguous",
        );
      const adjacentPlane = revit2027OwnerSurface<Revit2027PlaneSurface>(
        index,
        634,
        otherFaceToken,
      );
      const adjacentCylinder = revit2027OwnerSurface<Revit2027CylinderSurface>(
        index,
        1144,
        otherFaceToken,
      );
      const candidates = [...points],
        start = [points[0]!],
        end = [points.at(-1)!];
      if (adjacentCylinder) {
        const s = adjacentCylinder;
        if (
          s.kind !== "cylinder" ||
          !Number.isFinite(s.radius) ||
          s.radius <= 0 ||
          [...s.center, ...s.xVector, ...s.yVector, ...s.zVector].some(
            (v) => !Number.isFinite(v),
          ) ||
          s.zVector[0] !== 0 ||
          s.zVector[1] !== 0 ||
          s.zVector[2] === 0 ||
          s.xVector[2] !== 0 ||
          s.yVector[2] !== 0
        )
          fail("Unsupported original curved cap boundary");
        const delta = [0, 1].map((axis) =>
            mul(
              rational(s.radius),
              add(
                abs(rational(s.xVector[axis]!)),
                abs(rational(s.yVector[axis]!)),
              ),
            ),
          ),
          lo = [
            sub(rational(s.center[0]), delta[0]!),
            sub(rational(s.center[1]), delta[1]!),
          ],
          hi = [
            add(rational(s.center[0]), delta[0]!),
            add(rational(s.center[1]), delta[1]!),
          ];
        const box: P2[] = [
          [lo[0]!, lo[1]!],
          [hi[0]!, lo[1]!],
          [hi[0]!, hi[1]!],
          [lo[0]!, hi[1]!],
        ];
        // All analytic circle positions and every retained sample/chord are
        // enclosed, including any sample/analytic residual. No tessellation
        // becomes an authoritative replacement curved boundary.
        const completeCurveBound = polygon(hull([...candidates, ...box]));
        cylinderParts.push(completeCurveBound);
        uncertainty.push(completeCurveBound);
        // A whole circle encloses this boundary, while named source endpoint
        // parameters give much tighter exact transcendental enclosures for
        // its incidence with neighboring straight edges. The complete circle
        // remains an uncertainty operand and is never deleted.
        for (const [j, endpoint] of e.edge.firstAndLastEdgePoints.entries()) {
          const uv =
            e.side === 0 ? endpoint.secondFaceUv : endpoint.firstFaceUv;
          const bound = cylinderEndpointBox(s, uv);
          candidates.push(...bound);
          ((j === 0) === (e.direction === 1) ? start : end).push(...bound);
        }
        curvedEdges.push(e.token);
        curvedFaces.add(otherFaceToken);
      } else {
        if (
          !adjacentPlane ||
          adjacentPlane.kind !== "plane" ||
          e.edge.interiorEdgePoints.length ||
          [
            ...adjacentPlane.origin,
            ...adjacentPlane.xVector,
            ...adjacentPlane.yVector,
          ].some((v) => !Number.isFinite(v))
        )
          fail("Unsupported original non-cylinder curved boundary");
        for (const [j, endpoint] of e.edge.firstAndLastEdgePoints.entries()) {
          const otherUv =
            e.side === 0 ? endpoint.secondFaceUv : endpoint.firstFaceUv;
          if (otherUv.some((v) => !Number.isFinite(v)))
            fail("Nonfinite original adjacent plane embedding");
          const p = affine(adjacentPlane!, otherUv);
          candidates.push(p);
          ((j === 0) === (e.direction === 1) ? start : end).push(p);
        }
      }
      embeddings.push({ points: candidates, start, end });
    }
    if (reference.length > 1 && key(reference[0]!) === key(reference.at(-1)!))
      reference.pop();
    rings.push(reference);
    for (const [i, candidate] of embeddings.entries()) {
      // Declared coedge incidence correlates each endpoint with both original
      // neighboring edge uses. Keeping their complete hull also encloses every
      // unresolved raw endpoint join. A broad hull can only remove support.
      const all = [
          ...candidate.points,
          ...embeddings[(i + 1) % embeddings.length]!.start,
          ...embeddings[(i + embeddings.length - 1) % embeddings.length]!.end,
        ],
        sweep = hull(all);
      if (sweep.length > 2) uncertainty.push(polygon(sweep));
      else if (sweep.length) zeroArea.push(sweep);
      boundaryCells.push({
        originalEdgeToken: walked.edges[i]!.token,
        partsFeet: polygon(sweep),
        closedSegmentsFeet: sweep.length < 3 ? [sweep] : [],
      });
    }
    next = loop!.loop.nextLoop.token;
  }
  const capEdges = [...index.edges]
    .filter(([, e]) => e.faceReferences.includes(faceToken))
    .map(([token]) => token);
  if (
    capEdges.length !== edges.length ||
    capEdges.some((t) => !edges.includes(t)) ||
    [...index.loops].some(
      ([token, l]) =>
        l.loop.faceReference === faceToken && !loops.includes(token),
    )
  )
    fail("Named original cap omits a declared boundary");
  const reference: NativeRationalParts = [rings];
  // The original first loop/holes must be a valid exact winding operand; no
  // repair, union, simplification or invented bridge may make it valid.
  validateOriginalNamedCapReference(reference);
  const boundary = union(uncertainty),
    inner = boundary.length
      ? nativeRationalOverlay("difference", reference, boundary)
      : reference;
  return {
    nativeFloorElementId: Number(replay.ownerElementId),
    originalFaceToken: faceToken,
    originalFaceTag: cap.gInfo.tag,
    originalPhysicalTopElevationFeet: rational(surface.origin[2]),
    completeDeclaredFaceCount: index.faces.size,
    completeDeclaredEdgeCount: index.edges.size,
    originalCapLoopTokens: loops,
    originalCapEdgeTokens: edges,
    originalCurvedCapEdgeTokens: curvedEdges,
    originalCurvedAdjacentFaceTokens: [...curvedFaces],
    completeAnalyticCylinderUncertaintyPartsFeet: union(cylinderParts),
    originalReferenceWindingPartsFeet: reference,
    retainedPositiveBoundaryUncertaintyPartsFeet: boundary,
    retainedZeroAreaBoundarySegmentsFeet: zeroArea,
    originalBoundaryEnvelopeCellsFeet: boundaryCells,
    guaranteedInnerSupportPartsFeet: inner,
    wholeFloorSolidApproved: false,
    originalSourceAuthorityGranted: false,
    terminalContactApproved: false,
    routeApproved: false,
  };
}

/** Source-bound local cap operands, NOT an opaque body/route certificate. */
export function inspectOriginalNativeFloorLocalSupport(
  context: OriginalNativeForeignEnvelopeCensus,
  nativeFloorElementId: number,
  originalCapFaceToken: number,
) {
  const source = readOriginalForeignEnvelopeScopedFloor(
      context,
      nativeFloorElementId,
    ),
    bytes = source.originalGElementFrameBytes,
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const schema = readSchema(source.originalSourceSchemaBytes);
  if (!schema.ok) throw Error("Original local floor schema did not replay");
  if (
    bytesToHex(sha256(source.originalSourceSchemaBytes)) !==
    source.sourceSchemaSha256
  )
    throw Error("Original local floor schema checksum changed");
  const semantic = inspectOriginalElementLevelPrefix(
    source.originalFloorFrameBytes,
    schema.schema,
    "Floor",
  );
  if (semantic.nativeElementId !== nativeFloorElementId)
    throw Error("Original local floor semantic owner mismatch");
  const root = decodeRevit2027FramedGRepRoot(
    bytes,
    {
      offset: 0,
      elementId: nativeFloorElementId,
      marker: 2246,
      objectLength: bytes.length - 20,
      typeCode: view.getUint32(18, true),
    },
    2027,
  );
  if (!root.ok) throw Error(root.error);
  const replay = replayRevit2027GRepFifo(bytes, root.value);
  if (!replay.ok) throw Error(replay.error);
  if (Number(replay.value.ownerElementId) !== nativeFloorElementId)
    throw Error("Original floor cap owner mismatch");
  const geometry = inspectOriginalNamedFloorCapSupport(
    replay.value,
    originalCapFaceToken,
  );
  return {
    ...geometry,
    sourceModelSha256: source.sourceModelSha256,
    sourceSchemaSha256: source.sourceSchemaSha256,
    sourceCensusSha256: context.sourceCensusSha256,
    originalFloorFrameSha256: source.originalFloorFrameSha256,
    originalAssociatedNativeLevelId: semantic.nativeAssociatedLevelId,
    originalFloorSemanticPrefix: semantic,
    originalGElementFrameSha256: bytesToHex(sha256(bytes)),
    sourceBoundOriginalOperands: true as const,
  };
}

/** Exact full two-foot lateral contact demand. Logical/nominal terminal Z is
 * retained and compared with the actual physical cap, never snapped to it. */
export function inspectLocalFloorTwoFootStation(
  cap: OriginalLocalFloorCapEnvelope,
  center: readonly [number, number],
  lateralAxis: "x" | "y",
  unchangedNominalFootElevationFeet: number,
) {
  if (
    [...center, unchangedNominalFootElevationFeet].some(
      (v) => !Number.isFinite(v),
    )
  )
    throw Error("Nonfinite original station demand");
  const a: P2 = [rational(center[0]), rational(center[1])],
    b: P2 = [a[0], a[1]],
    axis = lateralAxis === "x" ? 0 : 1;
  a[axis] = sub(a[axis], rational(1));
  b[axis] = add(b[axis], rational(1));
  const boundaryContact = exactClosedSourcePlanarContact(
      [],
      cap.retainedPositiveBoundaryUncertaintyPartsFeet,
      cap.retainedZeroAreaBoundarySegmentsFeet,
      [[a, b]],
    ),
    supported =
      nativeAxisAlignedSegmentInExactParts(
        a,
        b,
        cap.guaranteedInnerSupportPartsFeet,
      ) && !boundaryContact;
  return {
    originalCenterFeet: [rational(center[0]), rational(center[1])],
    originalTwoFootLateralEndpointsFeet: [a, b],
    fullTwoFootStationWithinGuaranteedOriginalSupport: supported,
    retainedBoundaryUncertaintyContact: boundaryContact,
    unchangedNominalFootElevationFeet: rational(
      unchangedNominalFootElevationFeet,
    ),
    originalPhysicalSupportElevationFeet: cap.originalPhysicalTopElevationFeet,
    physicalMinusNominalElevationFeet: sub(
      cap.originalPhysicalTopElevationFeet,
      rational(unchangedNominalFootElevationFeet),
    ),
    exactOriginalTerminalHeightContact:
      cmp(
        cap.originalPhysicalTopElevationFeet,
        rational(unchangedNominalFootElevationFeet),
      ) === 0,
    terminalContactApproved: false as const,
    routeApproved: false as const,
  };
}
