/** Unwired original-source clearance prerequisite. No dataset or route mutation. */
import {
  projectStatedTwoFootWalkingVolume,
  type SourceWalkingPoint3,
} from "./native-source-walking-volume.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { openRevitContainer } from "./convert-container.ts";
import {
  activeClassTagTranslation,
  setActiveClassTagTranslation,
} from "./revit-class-tags.ts";
import {
  activeElementIdBytes,
  setActiveElementIdBytes,
} from "./element-id-width.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  stripRevitPageChecksums,
} from "./revit-container.ts";
import { createSplitFrameStream } from "./split-frame-stream.ts";
import { decodeRevit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
} from "./revit-2027-grep-replay.ts";
import {
  revit2027OwnerMeshIndex,
  revit2027OwnerSurface,
} from "./revit-2027-owner-mesh-index.ts";
import {
  walkRevit2027DirectedLoopEdges,
  revit2027DirectedEdgeUvs,
} from "./revit-2027-owner-mesh-trim.ts";
import type { Revit2027PlaneSurface } from "./revit-2027-surfaces.ts";
import {
  Rational,
  rational,
  nativeRationalOverlay,
  type NativeRationalPoint,
  type NativeRationalParts,
  NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION,
} from "./native-rational-overlay.ts";
import {
  encodeNativeExactTopology,
  nativeRationalMeasuredArea,
  nativeRationalPointInParts,
  nativeRationalPathSupported,
} from "./native-exact-planar-topology.ts";
import {
  readOriginalNativeStairPhysicalSource,
  inspectOriginalNativeStairPhysicalInventory,
  type OriginalNativeStairPhysicalContext,
} from "./native-source-stair-physical-inventory.ts";

type Q = Rational;
type P3 = [Q, Q, Q];
const add = (a: Q, b: Q) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Q, b: Q) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q) => new Rational(a.n * b.n, a.d * b.d);
const cmp = (a: Q, b: Q) => {
  const n = a.n * b.d - b.n * a.d;
  return n < 0n ? -1 : n > 0n ? 1 : 0;
};
const pair = (a: Q): [string, string] => [a.n.toString(), a.d.toString()];
const hash = (b: Uint8Array) => bytesToHex(sha256(b));
const objectHash = (v: unknown) =>
  hash(new TextEncoder().encode(JSON.stringify(v)));
const affine = (s: Revit2027PlaneSurface, uv: readonly number[]): P3 =>
  [0, 1, 2].map((axis) =>
    add(
      add(
        rational(s.origin[axis]!),
        mul(rational(s.xVector[axis]!), rational(uv[0]!)),
      ),
      mul(rational(s.yVector[axis]!), rational(uv[1]!)),
    ),
  ) as P3;
const area2 = (r: NativeRationalPoint[]) =>
  r.reduce((n, p, i) => {
    const q = r[(i + 1) % r.length]!;
    return add(n, sub(mul(p[0], q[1]), mul(q[0], p[1])));
  }, new Rational(0n));
function hull(points: NativeRationalPoint[]): NativeRationalPoint[] {
  const sorted = points
    .toSorted((a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1]))
    .filter(
      (p, i, a) => !i || cmp(p[0], a[i - 1]![0]) || cmp(p[1], a[i - 1]![1]),
    );
  const cross = (
    a: NativeRationalPoint,
    b: NativeRationalPoint,
    c: NativeRationalPoint,
  ) =>
    sub(
      mul(sub(b[0], a[0]), sub(c[1], a[1])),
      mul(sub(b[1], a[1]), sub(c[0], a[0])),
    );
  const half = (list: NativeRationalPoint[]) => {
    const out: NativeRationalPoint[] = [];
    for (const p of list) {
      while (
        out.length >= 2 &&
        cross(out[out.length - 2]!, out.at(-1)!, p).n <= 0n
      )
        out.pop();
      out.push(p);
    }
    return out;
  };
  if (sorted.length <= 2) return sorted;
  return [
    ...half(sorted).slice(0, -1),
    ...half(sorted.toReversed()).slice(0, -1),
  ];
}

/** Closed contact preserves tangent material and zero-thickness source
 * boundaries that an area-only polygon operation intentionally omits. */
export function exactClosedSourcePlanarContact(
  subject: NativeRationalParts,
  material: NativeRationalParts,
  sourceSegments: NativeRationalPoint[][] = [],
  subjectSegments: NativeRationalPoint[][] = [],
): boolean {
  if (nativeRationalOverlay("intersection", subject, material).length)
    return true;
  const edges = (parts: NativeRationalParts) =>
    parts.flatMap((p) =>
      p.flatMap((r) => r.map((a, i) => [a, r[(i + 1) % r.length]!] as const)),
    );
  const boundary = edges(subject),
    materialBoundary = edges(material);
  const cross = (
    a: NativeRationalPoint,
    b: NativeRationalPoint,
    p: NativeRationalPoint,
  ) =>
    sub(
      mul(sub(b[0], a[0]), sub(p[1], a[1])),
      mul(sub(b[1], a[1]), sub(p[0], a[0])),
    );
  const on = (
    p: NativeRationalPoint,
    a: NativeRationalPoint,
    b: NativeRationalPoint,
  ) =>
    cross(a, b, p).n === 0n &&
    [0, 1].every(
      (axis) =>
        cmp(p[axis]!, cmp(a[axis]!, b[axis]!) < 0 ? a[axis]! : b[axis]!) >= 0 &&
        cmp(p[axis]!, cmp(a[axis]!, b[axis]!) > 0 ? a[axis]! : b[axis]!) <= 0,
    );
  const intersects = (
    a: NativeRationalPoint,
    b: NativeRationalPoint,
    c: NativeRationalPoint,
    d: NativeRationalPoint,
  ) => {
    const ab1 = cross(a, b, c).n,
      ab2 = cross(a, b, d).n,
      cd1 = cross(c, d, a).n,
      cd2 = cross(c, d, b).n;
    return (
      (((ab1 < 0n && ab2 > 0n) || (ab1 > 0n && ab2 < 0n)) &&
        ((cd1 < 0n && cd2 > 0n) || (cd1 > 0n && cd2 < 0n))) ||
      on(a, c, d) ||
      on(b, c, d) ||
      on(c, a, b) ||
      on(d, a, b)
    );
  };
  if (
    boundary.some(([a, b]) =>
      materialBoundary.some(([c, d]) => intersects(a, b, c, d)),
    )
  )
    return true;
  if (
    sourceSegments.some(
      (segment) =>
        segment.some((point) => nativeRationalPointInParts(point, subject)) ||
        segment.some((a, i) =>
          boundary.some(([c, d]) =>
            intersects(a, segment[Math.min(i + 1, segment.length - 1)]!, c, d),
          ),
        ),
    )
  )
    return true;
  return subjectSegments.some(
    (segment) =>
      segment.some((point) => nativeRationalPointInParts(point, material)) ||
      segment.some((a, i) => {
        const b = segment[Math.min(i + 1, segment.length - 1)]!;
        return (
          materialBoundary.some(([c, d]) => intersects(a, b, c, d)) ||
          sourceSegments.some((source) =>
            source.some((c, j) =>
              intersects(a, b, c, source[Math.min(j + 1, source.length - 1)]!),
            ),
          )
        );
      }),
  );
}

type Face = {
  token: number;
  surface: Revit2027PlaneSurface;
  loops: { token: number; points: P3[]; edges: number[] }[];
  domainPoints: P3[];
};
/** Whole hole edges, including those between contact vertices, must remain
 * inside the unchanged shell. A fresh wrapper prevents a frozen topology
 * index shortcut from omitting these exact segment checks. */
export function originalSourceReferenceHolesContained(
  parts: NativeRationalParts,
) {
  return parts.every((part) => {
    const shell = part[0];
    if (!shell?.length) return false;
    return part
      .slice(1)
      .every(
        (hole) =>
          hole.length >= 3 &&
          nativeRationalPathSupported([...hole, hole[0]!], [[shell]]),
      );
  });
}

export type OriginalPlanarMaterialCell = {
  role: "cap-bounded-core" | "original-boundary-domain";
  originalFaceTokens: number[];
  partsFeet: NativeRationalParts;
  closedSegmentsFeet: NativeRationalPoint[][];
  minimumElevationFeet: Q;
  maximumElevationFeet: Q;
};
export type OriginalPlanarSlabEnvelopeGeometry = {
  nativeElementId: number;
  originalFaces: number;
  originalEdges: number;
  originalLoops: number;
  capFaceTokens: [number, number];
  originalHoleCount: number;
  sideFaceTokens: number[];
  minimumElevationFeet: Q;
  maximumElevationFeet: Q;
  originalTopElevationFeet: Q;
  originalCapPartsFeet: NativeRationalParts;
  enclosingPartsFeet: NativeRationalParts;
  guaranteedInnerSupportPartsFeet: NativeRationalParts;
  sideUncertaintyPartsFeet: NativeRationalParts;
  sourceBoundarySegmentsFeet: NativeRationalPoint[][];
  materialCellsFeet: OriginalPlanarMaterialCell[];
  sideDomainPositiveResidualAreaSqFt: number;
  completeDeclaredSourceCensus: true;
  completeConservativeSlabEnvelope: true;
  exactPhysicalBodyApproved: false;
  routeApproved: false;
};

/** Mathematical original-record predicate; source membership is supplied only
 * by certifyOriginalNativePlanarSlabEnvelope. It retains all exact cap holes,
 * every original finite side-domain point and every cap/twin representation.
 * The side strips ENLARGE an envelope; they do not repair the physical model. */
export function inspectOriginalPlanarSlabEnvelopeGeometry(
  replay: Revit2027GRepReplay,
):
  | { ok: true; geometry: OriginalPlanarSlabEnvelopeGeometry }
  | { ok: false; blockers: string[] } {
  function fail(reason: string): never {
    throw Error(reason);
  }
  try {
    const allowed = new Set([
      "Revit2027Geometry",
      "Revit2027Face",
      "Revit2027GEdge",
      "Revit2027EdgeLoop",
      "Revit2027AnalyticSurface:634",
      "Revit2027GFilling",
    ]);
    if (
      !replay.spans.length ||
      replay.spans.length > 100000 ||
      replay.spans.some(
        (s) =>
          !allowed.has(s.readerId) ||
          s.ownerElementId !== replay.ownerElementId,
      )
    )
      fail("Unsupported original slab branch, primitive or owner");
    if (
      new Set(replay.spans.map((s) => s.propertyToken)).size !==
      replay.spans.length
    )
      fail("Duplicate original slab property token");
    const index = revit2027OwnerMeshIndex(replay),
      count = (id: string) =>
        replay.spans.filter((s) => s.readerId === id).length;
    if (
      count("Revit2027Geometry") !== 1 ||
      !index.faces.size ||
      index.faces.size !== count("Revit2027Face") ||
      index.faces.size !== count("Revit2027AnalyticSurface:634") ||
      index.edges.size !== count("Revit2027GEdge") ||
      index.loops.size !== count("Revit2027EdgeLoop")
    )
      fail("Incomplete original slab primitive census");
    const geometry = replay.spans.find(
      (span) => span.readerId === "Revit2027Geometry",
    )!;
    const declared = geometry.value as {
      flags: number;
      faces: {
        count: number;
        entries: { token: number; sourceClassSlot: number }[];
      };
      edges: {
        count: number;
        entries: { token: number; sourceClassSlot: number }[];
      };
      sharedSurfaceInfo: { count: number };
    };
    const completeList = (
      list: typeof declared.faces,
      expected: ReadonlyMap<number, unknown>,
      slot: number,
    ) =>
      list.count === expected.size &&
      list.entries.length === list.count &&
      new Set(list.entries.map((e) => e.token)).size === list.count &&
      list.entries.every(
        (e) => e.sourceClassSlot === slot && expected.has(e.token),
      );
    if (
      declared.flags !== 7 ||
      declared.sharedSurfaceInfo.count !== 0 ||
      !completeList(declared.faces, index.faces, 1825) ||
      !completeList(declared.edges, index.edges, 1423)
    )
      fail("Original declared slab Geometry omits or duplicates an operand");
    const faces = new Map<number, Face>(),
      usedLoops = new Set<number>(),
      usedFills = new Set<number>(),
      uses = new Map<number, { face: number; direction: number }[]>();
    for (const [token, face] of index.faces) {
      if (
        ![4, 516].includes(face.faceFlags) ||
        face.cutType !== 0 ||
        face.faceRegions.count !== 0 ||
        face.surface.sourceClassSlot !== 634 ||
        face.firstLoop.token <= 0
      )
        fail("Unsupported original slab face/Boolean/region semantics");
      const s = revit2027OwnerSurface<Revit2027PlaneSurface>(index, 634, token);
      if (
        !s ||
        s.kind !== "plane" ||
        !s.surface.orientFlag ||
        [...s.origin, ...s.xVector, ...s.yVector].some(
          (v) => !Number.isFinite(v),
        )
      )
        fail("Unsupported finite original slab plane");
      const horizontal = s.xVector[2] === 0 && s.yVector[2] === 0;
      const vertical =
        (s.xVector[2] === 0 &&
          (s.xVector[0] !== 0 || s.xVector[1] !== 0) &&
          s.yVector[0] === 0 &&
          s.yVector[1] === 0 &&
          s.yVector[2] !== 0) ||
        (s.yVector[2] === 0 &&
          (s.yVector[0] !== 0 || s.yVector[1] !== 0) &&
          s.xVector[0] === 0 &&
          s.xVector[1] === 0 &&
          s.xVector[2] !== 0);
      if (!horizontal && !vertical)
        fail("Original slab has an unsupported inclined face");
      if (
        horizontal &&
        sub(
          mul(rational(s.xVector[0]), rational(s.yVector[1])),
          mul(rational(s.xVector[1]), rational(s.yVector[0])),
        ).n === 0n
      )
        fail("Degenerate original horizontal slab plane");
      // GFilling is an original face-bound hatch, not a second physical body.
      for (const pointer of [face.foregroundFilling, face.backgroundFilling]) {
        if (pointer.token === 0) continue;
        const span = replay.spans.find(
          (entry) => entry.propertyToken === pointer.token,
        );
        const value = span?.value as
          | {
              faceIdReference?: number;
              data?: { token: number };
              queuedProperties?: unknown[];
            }
          | undefined;
        if (
          !span ||
          span.readerId !== "Revit2027GFilling" ||
          span.parentReplayIndex === null ||
          replay.spans[span.parentReplayIndex]?.propertyToken !== token ||
          value?.faceIdReference !== token ||
          value.data?.token !== 0 ||
          value.queuedProperties?.length !== 0 ||
          usedFills.has(pointer.token)
        )
          fail("Unsupported or unowned original filling branch");
        usedFills.add(pointer.token);
      }
      const loops: Face["loops"] = [];
      const uvPoints: (readonly number[])[] = [
        s.surface.envelope.firstCorner,
        s.surface.envelope.secondCorner,
      ];
      let next = face.firstLoop.token;
      while (next) {
        const loop = index.loops.get(next);
        if (
          !loop ||
          usedLoops.has(next) ||
          loop.loop.open ||
          loop.loop.faceReference !== token
        )
          fail("Missing, open, repeated or unowned original slab loop");
        usedLoops.add(next);
        const walk = walkRevit2027DirectedLoopEdges({
          faceToken: token,
          loop,
          edges: index.edges,
          loopArity: "open",
        });
        if (!walk.ok || walk.edges.length < 3)
          fail("Original slab loop topology is not closed");
        const uv = walk.edges.map(revit2027DirectedEdgeUvs);
        for (const [i, edge] of walk.edges.entries()) {
          const previous = i ? walk.edges[i - 1]!.token : loop.token,
            following =
              i === walk.edges.length - 1
                ? loop.token
                : walk.edges[i + 1]!.token;
          if (
            edge.edge.previousReferences[edge.side] !== previous ||
            edge.edge.nextReferences[edge.side] !== following
          )
            fail("Original slab coedge links are not reciprocal");
          if (
            uv[i]!.length !== 2 ||
            uv[i]!.some((p) => p.some((n) => !Number.isFinite(n)))
          )
            fail("Unsupported sampled/curved original slab edge");
          const end = uv[i]![1]!,
            start = uv[(i + 1) % uv.length]![0]!;
          if (end[0] !== start[0] || end[1] !== start[1])
            fail("Original raw slab coedges have a positive unresolved gap");
          uvPoints.push(...uv[i]!);
          uses.set(edge.token, [
            ...(uses.get(edge.token) ?? []),
            { face: token, direction: edge.direction },
          ]);
        }
        uvPoints.push(loop.loop.envelope.minimum, loop.loop.envelope.maximum);
        loops.push({
          token: next,
          points: uv.map((points) => affine(s, points[0]!)),
          edges: walk.edges.map((e) => e.token),
        });
        next = loop.loop.nextLoop.token;
      }
      if (
        uvPoints.some(
          (p) => p.length !== 2 || p.some((v) => !Number.isFinite(v)),
        )
      )
        fail("Non-finite original slab domain");
      const us = uvPoints.map((p) => p[0]!),
        vs = uvPoints.map((p) => p[1]!);
      const domainPoints = [
        [Math.min(...us), Math.min(...vs)],
        [Math.min(...us), Math.max(...vs)],
        [Math.max(...us), Math.min(...vs)],
        [Math.max(...us), Math.max(...vs)],
      ].map((p) => affine(s, p));
      if (
        !horizontal &&
        (loops.length !== 1 ||
          loops[0]!.edges.length !== 4 ||
          face.faceFlags !== 4)
      )
        fail("Original slab side is not one finite quadrilateral");
      faces.set(token, { token, surface: s, loops, domainPoints });
    }
    if (
      usedLoops.size !== index.loops.size ||
      usedFills.size !== count("Revit2027GFilling")
    )
      fail("Unconsumed original slab loop/filling");
    for (const [token, edge] of index.edges) {
      const usage = uses.get(token),
        [a, b] = edge.faceReferences;
      if (
        a === b ||
        !faces.has(a) ||
        !faces.has(b) ||
        usage?.length !== 2 ||
        !usage.some((u) => u.face === a) ||
        !usage.some((u) => u.face === b) ||
        usage[0]!.direction !== -usage[1]!.direction
      )
        fail("Incomplete original slab twin topology");
    }
    const caps = [...faces.values()]
      .filter((f) => f.surface.xVector[2] === 0 && f.surface.yVector[2] === 0)
      .sort((a, b) =>
        cmp(rational(a.surface.origin[2]), rational(b.surface.origin[2])),
      );
    if (
      caps.length !== 2 ||
      caps[0]!.loops.length !== caps[1]!.loops.length ||
      cmp(
        rational(caps[0]!.surface.origin[2]),
        rational(caps[1]!.surface.origin[2]),
      ) >= 0
    )
      fail("Original slab lacks two corresponding finite caps");
    const parts = caps.map((cap) => [
      cap.loops.map((loop) =>
        loop.points.map((p) => [p[0], p[1]] as NativeRationalPoint),
      ),
    ]);
    for (const part of parts) {
      if (!originalSourceReferenceHolesContained(part))
        fail("Original slab hole edge leaves its source shell");
      encodeNativeExactTopology(
        {
          sourceModelSha256: "0".repeat(64),
          sourceGeometryKey: "original-slab-cap-math-only",
          kernelVersion: NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION,
        },
        [{ id: "cap", parts: part }],
      );
    }
    if (nativeRationalOverlay("xor", parts[0]!, parts[1]!).length)
      fail("Original slab cap footprints differ exactly");
    if (area2(parts[0]![0]![0]!).n >= 0n || area2(parts[1]![0]![0]!).n <= 0n)
      fail("Original slab caps are not consistently outward oriented");
    const capIds = new Set(caps.map((f) => f.token)),
      sides = [...faces.values()].filter((f) => !capIds.has(f.token));
    for (const cap of caps)
      for (const loop of cap.loops)
        for (const edgeToken of loop.edges) {
          const twins = index.edges.get(edgeToken)!.faceReferences;
          if (
            twins.filter((face) => capIds.has(face)).length !== 1 ||
            twins.filter((face) => !capIds.has(face) && faces.has(face))
              .length !== 1
          )
            fail(
              "Original cap boundary lacks exactly one reciprocal side face",
            );
        }
    const contributors: NativeRationalParts[] = [parts[0]!],
      sourceBoundarySegmentsFeet: NativeRationalPoint[][] = [];
    const materialCellsFeet: OriginalPlanarMaterialCell[] = [
      {
        role: "cap-bounded-core",
        originalFaceTokens: caps.map((cap) => cap.token),
        partsFeet: parts[0]!,
        closedSegmentsFeet: [],
        minimumElevationFeet: rational(caps[0]!.surface.origin[2]),
        maximumElevationFeet: rational(caps[1]!.surface.origin[2]),
      },
    ];
    for (const side of sides) {
      const joinedCaps = side.loops[0]!.edges.flatMap((edgeToken) =>
        index.edges
          .get(edgeToken)!
          .faceReferences.filter((faceToken) => capIds.has(faceToken)),
      );
      if (joinedCaps.length !== 2 || new Set(joinedCaps).size !== 2)
        fail("An original side does not span exactly both caps");
      const points = side.domainPoints.map(
        (p) => [p[0], p[1]] as NativeRationalPoint,
      );
      const boundaryPoints = [...side.domainPoints];
      for (const edgeToken of side.loops[0]!.edges) {
        const edge = index.edges.get(edgeToken)!;
        for (const [sideIndex, faceToken] of edge.faceReferences.entries()) {
          const cap = faces.get(faceToken)!;
          for (const point of edge.firstAndLastEdgePoints) {
            const xyz = affine(
              cap.surface,
              sideIndex === 0 ? point.firstFaceUv : point.secondFaceUv,
            );
            points.push([xyz[0], xyz[1]]);
            boundaryPoints.push(xyz);
          }
        }
      }
      const enclosed = hull(points);
      const boundaryZs = boundaryPoints.map((point) => point[2]);
      materialCellsFeet.push({
        role: "original-boundary-domain",
        originalFaceTokens: [side.token],
        partsFeet:
          enclosed.length >= 3 && area2(enclosed).n !== 0n ? [[enclosed]] : [],
        closedSegmentsFeet: enclosed.length < 3 ? [enclosed] : [],
        minimumElevationFeet: boundaryZs.reduce((a, b) =>
          cmp(a, b) < 0 ? a : b,
        ),
        maximumElevationFeet: boundaryZs.reduce((a, b) =>
          cmp(a, b) > 0 ? a : b,
        ),
      });
      if (enclosed.length >= 3 && area2(enclosed).n !== 0n)
        contributors.push([[enclosed]]);
      else if (enclosed.length >= 1) sourceBoundarySegmentsFeet.push(enclosed);
    }
    const enclosingPartsFeet = nativeRationalOverlay(
      "union",
      contributors[0]!,
      ...contributors.slice(1),
    );
    const sideUncertaintyPartsFeet =
      contributors.length > 1
        ? nativeRationalOverlay(
            "union",
            contributors[1]!,
            ...contributors.slice(2),
          )
        : [];
    const guaranteedInnerSupportPartsFeet = sideUncertaintyPartsFeet.length
      ? nativeRationalOverlay("difference", parts[1]!, sideUncertaintyPartsFeet)
      : nativeRationalOverlay("union", parts[1]!);
    const domainPoints = [...faces.values()].flatMap((f) => f.domainPoints),
      zs = domainPoints.map((p) => p[2]);
    const minimumElevationFeet = zs.reduce((a, b) => (cmp(a, b) < 0 ? a : b)),
      maximumElevationFeet = zs.reduce((a, b) => (cmp(a, b) > 0 ? a : b));
    return {
      ok: true,
      geometry: {
        nativeElementId: Number(replay.ownerElementId),
        originalFaces: index.faces.size,
        originalEdges: index.edges.size,
        originalLoops: index.loops.size,
        capFaceTokens: [caps[0]!.token, caps[1]!.token],
        originalHoleCount: caps[0]!.loops.length - 1,
        sideFaceTokens: sides.map((f) => f.token),
        minimumElevationFeet,
        maximumElevationFeet,
        originalTopElevationFeet: rational(caps[1]!.surface.origin[2]),
        originalCapPartsFeet: parts[1]!,
        enclosingPartsFeet,
        guaranteedInnerSupportPartsFeet,
        sideUncertaintyPartsFeet,
        sourceBoundarySegmentsFeet,
        materialCellsFeet,
        sideDomainPositiveResidualAreaSqFt: nativeRationalMeasuredArea(
          nativeRationalOverlay("difference", enclosingPartsFeet, parts[1]!),
        ),
        completeDeclaredSourceCensus: true,
        completeConservativeSlabEnvelope: true,
        exactPhysicalBodyApproved: false,
        routeApproved: false,
      },
    };
  } catch (error) {
    return {
      ok: false,
      blockers: [error instanceof Error ? error.message : String(error)],
    };
  }
}

const slabBrand: unique symbol = Symbol("OriginalNativePlanarSlabEnvelope");
export type OriginalNativePlanarSlabEnvelope = {
  readonly [slabBrand]: true;
  readonly sourceModelSha256: string;
  readonly sourceSchemaSha256: string;
  readonly nativeSlabElementId: number;
  readonly originalFrameSha256: string;
  readonly geometrySha256: string;
};
const slabs = new WeakMap<
  OriginalNativePlanarSlabEnvelope,
  OriginalPlanarSlabEnvelopeGeometry
>();

/** Actual RVT bytes, complete page inflation and a unique whole GElement are
 * required. A caller-supplied geometry/cache/receipt cannot issue this handle. */
export function certifyOriginalNativePlanarSlabEnvelope(
  originalRvtBytes: Uint8Array,
  expectedModelSha256: string,
  nativeSlabElementId: number,
) {
  if (
    !/^[a-f0-9]{64}$/.test(expectedModelSha256) ||
    !Number.isSafeInteger(nativeSlabElementId) ||
    nativeSlabElementId <= 0 ||
    nativeSlabElementId > 0x7fffffff
  )
    throw Error("Invalid original slab source identity");
  const bytes = Uint8Array.from(originalRvtBytes);
  if (hash(bytes) !== expectedModelSha256)
    throw Error("Original RVT checksum mismatch");
  const previousTranslation = activeClassTagTranslation(),
    previousWidth = activeElementIdBytes();
  try {
    const opened = openRevitContainer(bytes, {});
    if (
      opened.decoderPlan.revitVersion !== 2027 ||
      !opened.nativeSourceSchemaBytes ||
      activeElementIdBytes() !== 8 ||
      !opened.classTagTranslation.identity ||
      opened.classTagTranslation.movedClasses
    )
      throw Error("Unsupported original slab schema");
    let frame: Uint8Array | undefined,
      floorRoot: Uint8Array | undefined,
      pages = 0;
    for (const partition of opened.partitions) {
      const stream = createSplitFrameStream({
        markers: [2246, 2153],
        minObjectLength: 40,
        maxFrameBytes: 16 * 1024 * 1024,
        acceptHeader: (view, offset) =>
          view.getUint32(offset, true) === nativeSlabElementId,
      });
      const data = stripRevitPageChecksums(asBytes(partition.entry.content)),
        offsets = gzipOffsets(data, 10001);
      if (offsets.length > 10000)
        throw Error("Source slab partition exceeds bounded page census");
      let window: Uint8Array | null = null;
      for (let i = 0; i < offsets.length; i++) {
        const page = inflateRevitChunk(
          data,
          offsets[i]!,
          offsets[i + 1],
          window,
        );
        if (!page) throw Error("Original slab source page failed inflation");
        window = revitWindowTail(page);
        pages++;
        for (const found of stream.push(page)) {
          if (found.marker === 2153) {
            if (floorRoot)
              throw Error("Duplicate original Floor semantic root");
            floorRoot = Uint8Array.from(found.data);
          } else {
            if (frame) throw Error("Duplicate original slab GElement");
            frame = Uint8Array.from(found.data);
          }
        }
      }
    }
    if (!frame || !floorRoot)
      return {
        ok: false as const,
        blockers: [
          "Original slab GElement or Floor semantic root missing after complete source scan",
        ],
        pages,
      };
    const floorView = new DataView(
        floorRoot.buffer,
        floorRoot.byteOffset,
        floorRoot.byteLength,
      ),
      floorLength = floorView.getUint32(12, true);
    if (
      floorView.getUint32(0, true) !== nativeSlabElementId ||
      floorView.getUint32(4, true) !== 0 ||
      floorView.getUint16(16, true) !== 2153 ||
      floorLength + 20 !== floorRoot.length ||
      floorView.getUint32(floorRoot.length - 4, true) !== floorLength
    )
      throw Error("Original Floor semantic frame mismatch");
    let floorA = 1,
      floorB = 0;
    for (let i = 16; i < floorRoot.length - 4; i++) {
      floorA = (floorA + floorRoot[i]!) % 65521;
      floorB = (floorB + floorA) % 65521;
    }
    if ((floorB * 65536 + floorA) >>> 0 !== floorView.getUint32(8, true))
      throw Error("Original Floor semantic checksum mismatch");
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength),
      length = view.getUint32(12, true);
    if (
      view.getUint32(0, true) !== nativeSlabElementId ||
      view.getUint32(4, true) !== 0 ||
      length + 20 !== frame.length ||
      view.getUint16(16, true) !== 2246 ||
      view.getUint32(frame.length - 4, true) !== length
    )
      throw Error("Original slab frame identity/length mismatch");
    let a = 1,
      b = 0;
    for (let i = 16; i < frame.length - 4; i++) {
      a = (a + frame[i]!) % 65521;
      b = (b + a) % 65521;
    }
    if ((b * 65536 + a) >>> 0 !== view.getUint32(8, true))
      throw Error("Original slab frame checksum mismatch");
    const root = decodeRevit2027FramedGRepRoot(
      frame,
      {
        offset: 0,
        elementId: nativeSlabElementId,
        marker: 2246,
        objectLength: length,
        typeCode: view.getUint32(18, true),
      },
      2027,
    );
    if (!root.ok) throw Error(root.error);
    if (
      root.value.ownerElementId !== BigInt(nativeSlabElementId) ||
      root.value.flags !== 0 ||
      root.value.objectType !== 3 ||
      !root.value.localExtents.valid ||
      !root.value.worldExtents.valid ||
      JSON.stringify(root.value.localExtents) !==
        JSON.stringify(root.value.worldExtents)
    )
      throw Error("Unsupported original placed slab/extent semantics");
    const replay = replayRevit2027GRepFifo(frame, root.value, undefined, {
      maxReplayEntries: 100000,
      maxDescriptors: 400000,
    });
    if (!replay.ok) throw Error(replay.error);
    const checked = inspectOriginalPlanarSlabEnvelopeGeometry(replay.value);
    if (!checked.ok)
      return { ok: false as const, blockers: checked.blockers, pages };
    const g = checked.geometry;
    const summary = {
      sourceModelSha256: expectedModelSha256,
      sourceSchemaSha256: hash(opened.nativeSourceSchemaBytes),
      nativeSlabElementId,
      originalFrameSha256: hash(frame),
      originalFloorSemanticFrameSha256: hash(floorRoot),
      pages,
      faces: g.originalFaces,
      edges: g.originalEdges,
      loops: g.originalLoops,
      holes: g.originalHoleCount,
      minimumElevationFeet: pair(g.minimumElevationFeet),
      maximumElevationFeet: pair(g.maximumElevationFeet),
      sideDomainPositiveResidualAreaSqFt: g.sideDomainPositiveResidualAreaSqFt,
      guaranteedInnerSupportRemovedAreaSqFt: nativeRationalMeasuredArea(
        nativeRationalOverlay(
          "difference",
          g.originalCapPartsFeet,
          g.guaranteedInnerSupportPartsFeet,
        ),
      ),
      geometrySha256: objectHash({
        method: "complete-native-planar-slab-inner-outer-v1",
        parts: g.enclosingPartsFeet.map((p) =>
          p.map((r) => r.map((q) => q.map(pair))),
        ),
        innerSupport: g.guaranteedInnerSupportPartsFeet.map((p) =>
          p.map((r) => r.map((q) => q.map(pair))),
        ),
        sideUncertainty: g.sideUncertaintyPartsFeet.map((p) =>
          p.map((r) => r.map((q) => q.map(pair))),
        ),
        segments: g.sourceBoundarySegmentsFeet.map((r) =>
          r.map((q) => q.map(pair)),
        ),
        z: [
          pair(g.minimumElevationFeet),
          pair(g.maximumElevationFeet),
          pair(g.originalTopElevationFeet),
        ],
        materialCells: g.materialCellsFeet.map((cell) => ({
          role: cell.role,
          faces: cell.originalFaceTokens,
          parts: cell.partsFeet.map((p) =>
            p.map((r) => r.map((point) => point.map(pair))),
          ),
          segments: cell.closedSegmentsFeet.map((r) =>
            r.map((point) => point.map(pair)),
          ),
          z: [pair(cell.minimumElevationFeet), pair(cell.maximumElevationFeet)],
        })),
      }),
    };
    const certificate = Object.freeze({
      [slabBrand]: true as const,
      sourceModelSha256: summary.sourceModelSha256,
      sourceSchemaSha256: summary.sourceSchemaSha256,
      nativeSlabElementId,
      originalFrameSha256: summary.originalFrameSha256,
      geometrySha256: summary.geometrySha256,
    });
    slabs.set(certificate, g);
    return {
      ok: true as const,
      certificate,
      summary,
      completeConservativeSlabEnvelope: true as const,
      exactPhysicalBodyApproved: false as const,
      routeApproved: false as const,
    };
  } finally {
    setActiveClassTagTranslation(previousTranslation);
    setActiveElementIdBytes(previousWidth);
  }
}

/** Actual original tread stations only. Source ownership/history and exact
 * coedge continuity are checked again; this does not certify the intervening
 * rises, landings, foreign material or a complete route. */
export function auditOriginalSlabAboveNativeTreads(
  certificate: OriginalNativePlanarSlabEnvelope,
  stairContext: OriginalNativeStairPhysicalContext,
  nativeRunId: number,
  headroomFeet: number,
) {
  const slab = slabs.get(certificate);
  if (!slab) throw Error("Untrusted original slab envelope certificate");
  if (!Number.isFinite(headroomFeet) || headroomFeet <= 0 || headroomFeet > 30)
    throw Error("Invalid explicit headroom height");
  const source = readOriginalNativeStairPhysicalSource(
      stairContext,
      nativeRunId,
    ),
    inventory = inspectOriginalNativeStairPhysicalInventory(
      stairContext,
      nativeRunId,
    );
  if (
    source.sourceModelSha256 !== certificate.sourceModelSha256 ||
    source.sourceSchemaSha256 !== certificate.sourceSchemaSha256 ||
    !inventory.completeOriginalSourceFaceCensus ||
    !inventory.treadHistoryBindingComplete
  )
    throw Error("Native tread source identity/census/history incomplete");
  const treads = inventory.treads.map((tread) => {
    if (
      tread.originalPhysicalPlane.xVector[2] !== 0 ||
      tread.originalPhysicalPlane.yVector[2] !== 0
    )
      throw Error("Original tread is not an exact horizontal source plane");
    const height = new Rational(
      BigInt(tread.exactPhysicalPlaneHeightFeet[0]),
      BigInt(tread.exactPhysicalPlaneHeightFeet[1]),
    );
    let parts: NativeRationalParts;
    if (tread.exactUVCoedgeContinuity)
      parts = [
        [
          tread.coedges.map(
            (edge) =>
              edge.exactStartFeet
                .slice(0, 2)
                .map(
                  (q) => new Rational(BigInt(q[0]), BigInt(q[1])),
                ) as NativeRationalPoint,
          ),
        ],
      ];
    else {
      // A conservative DEMAND covers every original face-domain point even
      // when its source coedges disagree. This does not repair that tread or
      // certify its walking support; it can only make clearance harder.
      const s = tread.originalPhysicalPlane,
        uv = [
          s.surface.envelope.firstCorner,
          s.surface.envelope.secondCorner,
          ...tread.coedges.flatMap((e) => e.originalUV),
        ];
      const us = uv.map((p) => p[0]!),
        vs = uv.map((p) => p[1]!);
      parts = [
        [
          [
            [Math.min(...us), Math.min(...vs)],
            [Math.max(...us), Math.min(...vs)],
            [Math.max(...us), Math.max(...vs)],
            [Math.min(...us), Math.max(...vs)],
          ].map((p) => {
            const q = affine(s, p);
            return [q[0], q[1]] as NativeRationalPoint;
          }),
        ],
      ];
    }
    encodeNativeExactTopology(
      {
        sourceModelSha256: source.sourceModelSha256,
        sourceGeometryKey: `native-tread-headroom:${nativeRunId}:${tread.typedIndex}`,
        kernelVersion: NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION,
      },
      [{ id: "tread", parts }],
    );
    const high = add(height, rational(headroomFeet)),
      verticalBandReachesSlab =
        cmp(high, slab.minimumElevationFeet) >= 0 &&
        cmp(height, slab.maximumElevationFeet) < 0;
    const overlap = verticalBandReachesSlab
      ? nativeRationalOverlay("intersection", parts, slab.enclosingPartsFeet)
      : [];
    const closedSourceMaterialContact =
      verticalBandReachesSlab &&
      exactClosedSourcePlanarContact(
        parts,
        slab.enclosingPartsFeet,
        slab.sourceBoundarySegmentsFeet,
      );
    return {
      typedIndex: tread.typedIndex,
      physicalFaceToken: tread.physicalFaceToken,
      sourceTreadUVContinuityExact: tread.exactUVCoedgeContinuity,
      conservativeFaceDomainDemand: !tread.exactUVCoedgeContinuity,
      sourceHeightFeet: pair(height),
      verticalBandReachesSlab,
      positiveEnclosingMaterialOverlap: overlap.length > 0,
      closedSourceMaterialContact,
      projectedOverlapAreaSqFt: nativeRationalMeasuredArea(overlap),
    };
  });
  return {
    version: 1 as const,
    diagnosticOnly: true as const,
    sourceModelSha256: source.sourceModelSha256,
    nativeSlabElementId: certificate.nativeSlabElementId,
    nativeRunId,
    headroomFeet,
    originalSlabEnvelopeSha256: certificate.geometrySha256,
    actualSourceFrameSha256s: source.sourceFrameSha256s,
    treads,
    allOriginalTreadsChecked: treads.length === inventory.sourceTypedTreadCount,
    positiveTreadStationOverlapCount: treads.filter(
      (t) => t.positiveEnclosingMaterialOverlap,
    ).length,
    closedTreadStationContactCount: treads.filter(
      (t) => t.closedSourceMaterialContact,
    ).length,
    completeContinuousWalkingHeadroomApproved: false as const,
    exactPhysicalBodyApproved: false as const,
    routeApproved: false as const,
  };
}

/** Full-height volume diagnostic for a stated two-foot walking line. The
 * floor operand is independently original-source certified; the supplied line
 * still needs its separate original walking/terminal authority. No under-foot
 * stair/terminal-support exemption is applied in this mathematical check. */
export function auditOriginalSlabAgainstWalkingLine(
  certificate: OriginalNativePlanarSlabEnvelope,
  pointsFeet: readonly SourceWalkingPoint3[],
  headroomFeet: number,
) {
  const slab = slabs.get(certificate);
  if (!slab) throw Error("Untrusted original slab envelope certificate");
  if (
    !Number.isFinite(headroomFeet) ||
    headroomFeet <= 0 ||
    headroomFeet > 30 ||
    pointsFeet.length < 2 ||
    pointsFeet.some(
      (p) =>
        p.length !== 3 ||
        !p.every(
          (value) => value instanceof Rational || Number.isFinite(value),
        ),
    )
  )
    throw Error("Invalid stated walking demand");
  const rows = pointsFeet.slice(1).map((b, segmentIndex) => {
    const a = pointsFeet[segmentIndex]!;
    const projection = projectStatedTwoFootWalkingVolume(
      a,
      b,
      slab.minimumElevationFeet,
      slab.maximumElevationFeet,
      headroomFeet,
    );
    const possible = projection.possibleClosedProjectionFeet;
    const polygon = projection.positiveProjectionArea ? [[possible]] : [];
    const overlap = polygon.length
      ? nativeRationalOverlay("intersection", polygon, slab.enclosingPartsFeet)
      : [];
    const closedSourceMaterialContact = polygon.length
      ? exactClosedSourcePlanarContact(
          polygon,
          slab.enclosingPartsFeet,
          slab.sourceBoundarySegmentsFeet,
        )
      : possible.length > 0 &&
        exactClosedSourcePlanarContact(
          [],
          slab.enclosingPartsFeet,
          slab.sourceBoundarySegmentsFeet,
          [possible],
        );
    const lowestFoot =
      cmp(rational(a[2]), rational(b[2])) < 0 ? rational(a[2]) : rational(b[2]);
    const localizedContacts = slab.materialCellsFeet.flatMap((cell) => {
      if (cmp(cell.maximumElevationFeet, lowestFoot) <= 0) return [];
      const projected = projectStatedTwoFootWalkingVolume(
          a,
          b,
          cell.minimumElevationFeet,
          cell.maximumElevationFeet,
          headroomFeet,
        ),
        ring = projected.possibleClosedProjectionFeet;
      const contact = projected.positiveProjectionArea
        ? exactClosedSourcePlanarContact(
            [[ring]],
            cell.partsFeet,
            cell.closedSegmentsFeet,
          )
        : ring.length > 0 &&
          exactClosedSourcePlanarContact(
            [],
            cell.partsFeet,
            cell.closedSegmentsFeet,
            [ring],
          );
      return contact
        ? [
            {
              role: cell.role,
              originalFaceTokens: [...cell.originalFaceTokens],
            },
          ]
        : [];
    });
    return {
      segmentIndex,
      originalStartFeet: a,
      originalEndFeet: b,
      fullHeadroomFeet: headroomFeet,
      exactStatedWidthEnclosed: true as const,
      normalBoundRefinements: projection.normalLowerBoundRefinements,
      positiveEnclosingBodyOverlap: overlap.length > 0,
      projectedOverlapAreaSqFt: nativeRationalMeasuredArea(overlap),
      closedSourceMaterialContact,
      localizedContacts,
      slabMaximumAtOrBelowUpperWalkingFoot:
        cmp(
          slab.maximumElevationFeet,
          cmp(rational(a[2]), rational(b[2])) > 0
            ? rational(a[2])
            : rational(b[2]),
        ) <= 0,
    };
  });
  return {
    version: 1 as const,
    diagnosticOnly: true as const,
    sourceModelSha256: certificate.sourceModelSha256,
    nativeSlabElementId: certificate.nativeSlabElementId,
    originalSlabEnvelopeSha256: certificate.geometrySha256,
    widthFeet: 2 as const,
    headroomFeet,
    rows,
    positiveOverlapSegments: rows
      .filter((r) => r.positiveEnclosingBodyOverlap)
      .map((r) => r.segmentIndex),
    closedContactSegments: rows
      .filter((r) => r.closedSourceMaterialContact)
      .map((r) => r.segmentIndex),
    localizedContactSegments: rows
      .filter((row) => row.localizedContacts.length)
      .map((row) => row.segmentIndex),
    originalMaterialCellsChecked: slab.materialCellsFeet.length,
    sourceWalkingPathAuthorityGranted: false as const,
    terminalSupportBodyExceptionGranted: false as const,
    completeContinuousWalkingHeadroomApproved: false as const,
    routeApproved: false as const,
  };
}

/** Source-bound inner top support. Every positive original side/twin sweep is
 * excluded rather than snapped or forgiven. Returned values are fresh copies;
 * the opaque source handle remains the authority, never caller-edited parts. */
export function originalNativeSlabSupportEnvelope(
  certificate: OriginalNativePlanarSlabEnvelope,
) {
  const geometry = slabs.get(certificate);
  if (!geometry) throw Error("Untrusted original slab envelope certificate");
  const copy = (parts: NativeRationalParts): NativeRationalParts =>
    parts.map((part) =>
      part.map((ring) =>
        ring.map(([x, y]) => [new Rational(x.n, x.d), new Rational(y.n, y.d)]),
      ),
    );
  return {
    sourceModelSha256: certificate.sourceModelSha256,
    sourceSchemaSha256: certificate.sourceSchemaSha256,
    nativeSlabElementId: certificate.nativeSlabElementId,
    sourceFrameSha256: certificate.originalFrameSha256,
    sourceEnvelopeSha256: certificate.geometrySha256,
    originalTopElevationFeet: new Rational(
      geometry.originalTopElevationFeet.n,
      geometry.originalTopElevationFeet.d,
    ),
    minimumMaterialElevationFeet: new Rational(
      geometry.minimumElevationFeet.n,
      geometry.minimumElevationFeet.d,
    ),
    maximumMaterialElevationFeet: new Rational(
      geometry.maximumElevationFeet.n,
      geometry.maximumElevationFeet.d,
    ),
    guaranteedInnerSupportPartsFeet: copy(
      geometry.guaranteedInnerSupportPartsFeet,
    ),
    completeConservativeMaterialPartsFeet: copy(geometry.enclosingPartsFeet),
    retainedPositiveBoundaryUncertaintyPartsFeet: copy(
      geometry.sideUncertaintyPartsFeet,
    ),
    excludedZeroAreaBoundarySegmentsFeet:
      geometry.sourceBoundarySegmentsFeet.map((ring) =>
        ring.map(
          ([x, y]) =>
            [
              new Rational(x.n, x.d),
              new Rational(y.n, y.d),
            ] as NativeRationalPoint,
        ),
      ),
    completeOriginalMaterialCellsFeet: geometry.materialCellsFeet.map(
      (cell) => ({
        ...cell,
        originalFaceTokens: [...cell.originalFaceTokens],
        partsFeet: copy(cell.partsFeet),
        closedSegmentsFeet: cell.closedSegmentsFeet.map((segment) =>
          segment.map(
            ([x, y]) =>
              [
                new Rational(x.n, x.d),
                new Rational(y.n, y.d),
              ] as NativeRationalPoint,
          ),
        ),
        minimumElevationFeet: new Rational(
          cell.minimumElevationFeet.n,
          cell.minimumElevationFeet.d,
        ),
        maximumElevationFeet: new Rational(
          cell.maximumElevationFeet.n,
          cell.maximumElevationFeet.d,
        ),
      }),
    ),
    originalHoleCount: geometry.originalHoleCount,
    sourceCoordinatesModified: false as const,
    routeApproved: false as const,
  };
}
