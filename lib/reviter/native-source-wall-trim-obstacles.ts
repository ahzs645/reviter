/** Unwired obstruction-only bounds of complete original straight planar Face
 * trims. A Plane domain is a parametrization, not extra material outside its
 * Face loops. Pinned rvt-rs1c3d337 native_saved_mesh.rs:548-620 uses the source
 * m_pFirstLoop/m_nextLoop and treats null-loop Faces as auxiliary surfaces;
 * faceFlags bit2 reverses orientation. Every trim/twin embedding is retained.
 * No coordinate is welded, no display mesh is read, and no floor is proved. */
import type { Revit2027GRepReplay } from "./revit-2027-grep-replay.ts";
import type { Revit2027PlaneSurface } from "./revit-2027-surfaces.ts";
import {
  revit2027OwnerMeshIndex,
  revit2027OwnerSurface,
} from "./revit-2027-owner-mesh-index.ts";
import {
  walkRevit2027DirectedLoopEdges,
  revit2027DirectedEdgeUvs,
} from "./revit-2027-owner-mesh-trim.ts";
import {
  Rational,
  rational,
  nativeRationalOverlay,
  type NativeRationalPoint,
  type NativeRationalParts,
} from "./native-rational-overlay.ts";
import { freezeNativeRationalParts } from "./native-exact-planar-topology.ts";
type P3 = [Rational, Rational, Rational];
const add = (a: Rational, b: Rational) =>
    new Rational(a.n * b.d + b.n * a.d, a.d * b.d),
  sub = (a: Rational, b: Rational) =>
    new Rational(a.n * b.d - b.n * a.d, a.d * b.d),
  mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d),
  cmp = (a: Rational, b: Rational) =>
    a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const point = (s: Revit2027PlaneSurface, uv: readonly number[]): P3 =>
  [0, 1, 2].map((i) =>
    add(
      add(
        rational(s.origin[i]!),
        mul(rational(s.xVector[i]!), rational(uv[0]!)),
      ),
      mul(rational(s.yVector[i]!), rational(uv[1]!)),
    ),
  ) as P3;
function hull(points: NativeRationalPoint[]) {
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
  const chain = (list: NativeRationalPoint[]) => {
    const out: NativeRationalPoint[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out.at(-2)!, out.at(-1)!, p).n <= 0n)
        out.pop();
      out.push(p);
    }
    return out;
  };
  return [
    ...chain(sorted).slice(0, -1),
    ...chain(sorted.toReversed()).slice(0, -1),
  ];
}
export type OriginalWallTrimObstacleInspection =
  | {
      ok: true;
      nativeElementId: number;
      outerPlanEnvelope: NativeRationalParts;
      minimumElevationFeet: Rational;
      maximumElevationFeet: Rational;
      sourceFaceTokens: number[];
      auxiliaryNullLoopFaceTokens: number[];
      trimLoopTokens: number[];
      closedBodyEdgeTokens: number[];
      finiteOpenReferenceEdgeTokens: number[];
      unlinkedGraphicEdgeTokens: number[];
      hatchTokens: number[];
      originalSourceAuthorityGranted: false;
      exactClosedPhysicalBodyApproved: false;
      walkingSupportApproved: false;
      routeApproved: false;
    }
  | {
      ok: false;
      blockers: string[];
      originalSourceAuthorityGranted: false;
      routeApproved: false;
    };
export function inspectOriginalWallTrimObstacleBranches(
  replay: Revit2027GRepReplay,
): OriginalWallTrimObstacleInspection {
  try {
    const spans = replay.spans,
      allowed = new Map([
        ["Revit2027GGroup", 2248],
        ["Revit2027Geometry", 2343],
        ["Revit2027Face", 1825],
        ["Revit2027GEdge", 1423],
        ["Revit2027EdgeLoop", 1434],
        ["Revit2027GFilling", 2253],
        ["Revit2027AnalyticSurface:634", 634],
      ]);
    if (
      !spans.length ||
      spans.length > 100000 ||
      spans.some(
        (s, i) =>
          allowed.get(s.readerId) !== s.propertySourceClassSlot ||
          s.replayIndex !== i ||
          s.ownerElementId !== replay.ownerElementId ||
          (s.parentReplayIndex !== null &&
            (!Number.isSafeInteger(s.parentReplayIndex) ||
              s.parentReplayIndex < 0 ||
              s.parentReplayIndex >= i)),
      )
    )
      throw Error("Unknown original wall source branch, owner or parent");
    if (new Set(spans.map((s) => s.propertyToken)).size !== spans.length)
      throw Error("Duplicate original wall property token");
    const index = revit2027OwnerMeshIndex(replay),
      byToken = new Map(spans.map((s) => [s.propertyToken, s])),
      geometryOwner = new Map<number, number>();
    const allFaces = new Set<number>(),
      allEdges = new Set<number>();
    for (const g of spans.filter((s) => s.readerId === "Revit2027Geometry")) {
      const indices = new Set([g.replayIndex]);
      for (const s of spans)
        if (s.parentReplayIndex !== null && indices.has(s.parentReplayIndex))
          indices.add(s.replayIndex);
      const branch = spans.filter((s) => indices.has(s.replayIndex)),
        value = g.value as {
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
      const census = (
        field: typeof value.faces,
        reader: string,
        slot: number,
      ) => {
        const actual = branch.filter((s) => s.readerId === reader);
        return (
          field.count === field.entries.length &&
          field.count === actual.length &&
          new Set(field.entries.map((d) => d.token)).size === field.count &&
          field.entries.every(
            (d) =>
              d.sourceClassSlot === slot &&
              actual.some((s) => s.propertyToken === d.token),
          )
        );
      };
      if (
        !census(value.faces, "Revit2027Face", 1825) ||
        !census(value.edges, "Revit2027GEdge", 1423) ||
        value.sharedSurfaceInfo.count
      )
        throw Error("Incomplete original declared wall Geometry operands");
      for (const entry of value.faces.entries) {
        if (allFaces.has(entry.token)) throw Error("Shared original wall Face");
        allFaces.add(entry.token);
        geometryOwner.set(entry.token, g.propertyToken);
      }
      for (const entry of value.edges.entries) {
        if (allEdges.has(entry.token)) throw Error("Shared original wall Edge");
        allEdges.add(entry.token);
        geometryOwner.set(entry.token, g.propertyToken);
      }
    }
    if (
      allFaces.size !== index.faces.size ||
      allEdges.size !== index.edges.size ||
      !allFaces.size
    )
      throw Error("Original Geometry does not own every Face/Edge");
    const loops = new Set<number>(),
      hatches = new Set<number>(),
      aux: number[] = [],
      points: P3[] = [],
      uses = new Map<number, { face: number; direction: number }[]>();
    const surface = (token: number) => {
      const s = revit2027OwnerSurface<Revit2027PlaneSurface>(index, 634, token);
      if (
        !s ||
        s.kind !== "plane" ||
        [...s.origin, ...s.xVector, ...s.yVector].some(
          (n) => !Number.isFinite(n),
        )
      )
        throw Error("Unknown original wall plane");
      const x = s.xVector.map(rational),
        y = s.yVector.map(rational);
      if (
        [0, 1, 2].every(
          (i) =>
            sub(
              mul(x[(i + 1) % 3]!, y[(i + 2) % 3]!),
              mul(x[(i + 2) % 3]!, y[(i + 1) % 3]!),
            ).n === 0n,
        )
      )
        throw Error("Degenerate original wall plane");
      return s;
    };
    for (const [token, face] of index.faces) {
      if (
        ![4, 6, 36, 38].includes(face.faceFlags) ||
        face.cutType !== 0 ||
        face.faceRegions.count ||
        face.surface.sourceClassSlot !== 634
      )
        throw Error("Unsupported original wall Face semantics");
      const s = surface(token),
        faceSpan = byToken.get(token)!;
      for (const pointer of [face.foregroundFilling, face.backgroundFilling]) {
        if (!pointer.token) continue;
        const fill = byToken.get(pointer.token),
          v = fill?.value as
            | {
                faceIdReference: number;
                data: { token: number };
                queuedProperties: unknown[];
              }
            | undefined;
        if (
          !fill ||
          fill.readerId !== "Revit2027GFilling" ||
          fill.parentReplayIndex !== faceSpan.replayIndex ||
          v?.faceIdReference !== token ||
          v.data.token !== 0 ||
          v.queuedProperties.length ||
          spans.some((x) => x.parentReplayIndex === fill.replayIndex) ||
          hatches.has(pointer.token)
        )
          throw Error("Unaccounted original wall hatch subtree");
        hatches.add(pointer.token);
      }
      if (face.firstLoop.token === 0) {
        aux.push(token);
        continue;
      }
      if (face.firstLoop.token < 0)
        throw Error("Unsupported original wall loop alias");
      let current = face.firstLoop.token;
      const chain = new Set<number>();
      while (current) {
        const loop = index.loops.get(current);
        if (
          !loop ||
          loop.loop.faceReference !== token ||
          loop.loop.open ||
          loops.has(current) ||
          chain.has(current)
        )
          throw Error("Missing, repeated, foreign or open source Face trim");
        loops.add(current);
        chain.add(current);
        const walked = walkRevit2027DirectedLoopEdges({
          faceToken: token,
          loop,
          edges: index.edges,
          loopArity: "open",
        });
        if (!walked.ok || walked.edges.length < 3)
          throw Error("Original Face trim does not close");
        for (const e of walked.edges) {
          const uv = revit2027DirectedEdgeUvs(e);
          if (
            uv.length !== 2 ||
            uv.some((p) => p.length !== 2 || p.some((n) => !Number.isFinite(n)))
          )
            throw Error(
              "Original wall trim contains an unknown curved/nonfinite edge",
            );
          if (geometryOwner.get(e.token) !== geometryOwner.get(token))
            throw Error("Wall trim consumes another original Geometry edge");
          points.push(...uv.map((p) => point(s, p)));
          const twin = e.edge.faceReferences[1 - e.side]!;
          if (twin) {
            const ts = surface(twin);
            points.push(
              ...e.edge.firstAndLastEdgePoints.map((p) =>
                point(ts, e.side === 0 ? p.secondFaceUv : p.firstFaceUv),
              ),
            );
          }
          const previous = uses.get(e.token) ?? [];
          previous.push({ face: token, direction: e.direction });
          uses.set(e.token, previous);
        }
        current = loop.loop.nextLoop.token;
      }
    }
    if (
      loops.size !== index.loops.size ||
      hatches.size !==
        spans.filter((s) => s.readerId === "Revit2027GFilling").length ||
      index.surfaces.get(634)?.size !== index.faces.size ||
      spans.filter((s) => s.readerId === "Revit2027AnalyticSurface:634")
        .length !== index.faces.size
    )
      throw Error("Unconsumed original wall Face/Loop/hatch/surface");
    const closed: number[] = [],
      open: number[] = [],
      unlinked: number[] = [];
    for (const [token, e] of index.edges) {
      const use = uses.get(token) ?? [];
      if (use.length === 2) {
        if (
          e.faceReferences[0] === e.faceReferences[1] ||
          !use.some((u) => u.face === e.faceReferences[0]) ||
          !use.some((u) => u.face === e.faceReferences[1]) ||
          use[0]!.direction === use[1]!.direction
        )
          throw Error("Original physical wall edge is not reciprocally closed");
        closed.push(token);
      } else if (use.length === 1) {
        const side = e.faceReferences.indexOf(use[0]!.face);
        if (
          side < 0 ||
          e.faceReferences[1 - side] !== 0 ||
          e.nextReferences[1 - side] !== 0 ||
          e.previousReferences[1 - side] !== 0
        )
          throw Error(
            "An original wall face boundary is missing its physical twin",
          );
        open.push(token);
      } else if (use.length === 0) {
        if (
          [...e.nextReferences, ...e.previousReferences].some((n) => n !== 0) ||
          e.interiorEdgePoints.length ||
          e.faceReferences.some((id) => id !== 0 && !index.faces.has(id)) ||
          e.firstAndLastEdgePoints.some((p) =>
            [...p.firstFaceUv, ...p.secondFaceUv].some(
              (n) => !Number.isFinite(n),
            ),
          )
        )
          throw Error(
            "Unlinked original source Edge has unknown material/profile consumption",
          );
        unlinked.push(token);
      } else throw Error("Multiply consumed original wall edge");
    }
    if (!closed.length || !points.length)
      throw Error("No completely accounted original physical wall boundary");
    const ring = hull(points.map((p) => [p[0], p[1]]));
    if (ring.length < 3)
      throw Error("Original wall obstruction has degenerate planar enclosure");
    const z = points.map((p) => p[2]),
      min = z.reduce((a, b) => (cmp(a, b) < 0 ? a : b)),
      max = z.reduce((a, b) => (cmp(a, b) > 0 ? a : b));
    if (cmp(min, max) >= 0)
      throw Error("Original wall has no positive physical height");
    return {
      ok: true,
      nativeElementId: Number(replay.ownerElementId),
      outerPlanEnvelope: freezeNativeRationalParts(
        nativeRationalOverlay("union", [[ring]]),
      ),
      minimumElevationFeet: Object.freeze(min),
      maximumElevationFeet: Object.freeze(max),
      sourceFaceTokens: [...index.faces.keys()],
      auxiliaryNullLoopFaceTokens: aux,
      trimLoopTokens: [...loops],
      closedBodyEdgeTokens: closed,
      finiteOpenReferenceEdgeTokens: open,
      unlinkedGraphicEdgeTokens: unlinked,
      hatchTokens: [...hatches],
      originalSourceAuthorityGranted: false,
      exactClosedPhysicalBodyApproved: false,
      walkingSupportApproved: false,
      routeApproved: false,
    };
  } catch (e) {
    return {
      ok: false,
      blockers: [e instanceof Error ? e.message : String(e)],
      originalSourceAuthorityGranted: false,
      routeApproved: false,
    };
  }
}
