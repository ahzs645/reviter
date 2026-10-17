/** Unwired source-face-domain decomposition. Core cap height and boundary
 * parametrization uncertainty remain separate; no residual is discarded. */
import {
  Rational,
  rational,
  nativeRationalOverlay,
  type NativeRationalPoint,
} from "./native-rational-overlay.ts";
import { inspectOriginalStairSupportEnvelopes } from "./native-source-stair-support-envelopes.ts";
import {
  revit2027OwnerMeshIndex,
  revit2027OwnerSurface,
} from "./revit-2027-owner-mesh-index.ts";
import {
  walkRevit2027DirectedLoopEdges,
  revit2027DirectedEdgeUvs,
} from "./revit-2027-owner-mesh-trim.ts";
import type { Revit2027GRepReplay } from "./revit-2027-grep-replay.ts";
import type { Revit2027PlaneSurface } from "./revit-2027-surfaces.ts";
import type { OriginalPlanarMaterialCell } from "./native-source-planar-slab-envelope.ts";
type Q = Rational;
type P3 = [Q, Q, Q];
const add = (a: Q, b: Q) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d),
  sub = (a: Q, b: Q) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d),
  mul = (a: Q, b: Q) => new Rational(a.n * b.n, a.d * b.d),
  cmp = (a: Q, b: Q) =>
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
const key = (p: NativeRationalPoint) => p.map((q) => `${q.n}/${q.d}`).join(":");
function hull(input: NativeRationalPoint[]) {
  const sorted = [...new Map(input.map((p) => [key(p), p])).values()].sort(
    (a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1]),
  );
  if (sorted.length < 3) return sorted;
  const cross = (
    a: NativeRationalPoint,
    b: NativeRationalPoint,
    c: NativeRationalPoint,
  ) =>
    sub(
      mul(sub(b[0], a[0]), sub(c[1], a[1])),
      mul(sub(b[1], a[1]), sub(c[0], a[0])),
    );
  const half = (values: NativeRationalPoint[]) => {
    const out: NativeRationalPoint[] = [];
    for (const p of values) {
      while (out.length > 1 && cross(out.at(-2)!, out.at(-1)!, p).n <= 0n)
        out.pop();
      out.push(p);
    }
    return out;
  };
  return [
    ...half(sorted).slice(0, -1),
    ...half(sorted.toReversed()).slice(0, -1),
  ];
}
export type OriginalStairLocalMaterialCell = OriginalPlanarMaterialCell & {
  sourceComponentIndex: number;
};

/** Mathematical only. Source membership is provided by the placed-envelope
 * opaque context consumer. All original closed planar source topology must
 * pass first; every component must have exactly two horizontal caps and
 * vertical quadrilateral sides joining both caps. A core hull conservatively
 * fills the cap-bounded volume. Every source side's complete finite domain and
 * BOTH adjacent-face endpoint embeddings retain their own full height band.
 * Thus a high boundary residual does not become a fictitious full-width lid.
 * This proves enclosure of all original source face domains, not an exact
 * sewn physical solid or the runtime's continuous stair movement semantics. */
export function inspectOriginalStairLocalMaterialCells(
  replay: Revit2027GRepReplay,
) {
  const cells: OriginalStairLocalMaterialCell[] = [],
    blockers: string[] = [];
  try {
    const global = inspectOriginalStairSupportEnvelopes(replay);
    if (
      !global.completeOriginalStraightPlanarSourceCensus ||
      global.blockers.length
    )
      throw Error("Complete original straight planar topology unavailable");
    const index = revit2027OwnerMeshIndex(replay),
      planes = new Map<number, Revit2027PlaneSurface>(),
      walks = new Map<
        number,
        ReturnType<typeof walkRevit2027DirectedLoopEdges> & { ok: true }
      >();
    for (const [token, face] of index.faces) {
      const plane = revit2027OwnerSurface<Revit2027PlaneSurface>(
          index,
          634,
          token,
        ),
        loop = index.loops.get(face.firstLoop.token);
      if (!plane || !loop) throw Error("Missing original plane or loop");
      const uv = plane.surface.envelope;
      if (
        [...uv.firstCorner, ...uv.secondCorner].some((n) => !Number.isFinite(n))
      )
        throw Error("Unbounded original source plane domain");
      const walked = walkRevit2027DirectedLoopEdges({
        faceToken: token,
        loop,
        edges: index.edges,
        loopArity: "open",
      });
      if (!walked.ok) throw Error("Original source loop does not close");
      planes.set(token, plane);
      walks.set(token, walked);
    }
    for (const component of global.components) {
      const caps = component.physicalFaceTokens
        .filter((t) => {
          const s = planes.get(t)!;
          return s.xVector[2] === 0 && s.yVector[2] === 0;
        })
        .sort((a, b) =>
          cmp(
            rational(planes.get(a)!.origin[2]),
            rational(planes.get(b)!.origin[2]),
          ),
        );
      if (
        caps.length !== 2 ||
        cmp(
          rational(planes.get(caps[0]!)!.origin[2]),
          rational(planes.get(caps[1]!)!.origin[2]),
        ) >= 0
      )
        throw Error("Original component is not cap bounded");
      const corePoints: NativeRationalPoint[] = [];
      for (const faceToken of component.physicalFaceTokens) {
        const s = planes.get(faceToken)!,
          walked = walks.get(faceToken)!,
          e = s.surface.envelope;
        const domain = [
          [e.firstCorner[0], e.firstCorner[1]],
          [e.firstCorner[0], e.secondCorner[1]],
          [e.secondCorner[0], e.firstCorner[1]],
          [e.secondCorner[0], e.secondCorner[1]],
          ...walked.edges.flatMap(revit2027DirectedEdgeUvs),
        ].map((uv) => point(s, uv));
        for (const edge of walked.edges)
          for (const [side, other] of edge.edge.faceReferences.entries())
            for (const endpoint of edge.edge.firstAndLastEdgePoints)
              domain.push(
                point(
                  planes.get(other)!,
                  side === 0 ? endpoint.firstFaceUv : endpoint.secondFaceUv,
                ),
              );
        corePoints.push(
          ...domain.map((p) => [p[0], p[1]] as NativeRationalPoint),
        );
        if (caps.includes(faceToken)) {
          for (const edge of walked.edges)
            if (
              edge.edge.faceReferences.filter((t) => caps.includes(t))
                .length !== 1
            )
              throw Error("Original cap edge has no unique side twin");
          const normal =
            sub(
              mul(rational(s.xVector[0]), rational(s.yVector[1])),
              mul(rational(s.xVector[1]), rational(s.yVector[0])),
            ).n * (s.surface.orientFlag ? 1n : -1n);
          if (!normal || (faceToken === caps[0] ? normal >= 0n : normal <= 0n))
            throw Error("Original cap orientation/basis inconsistent");
          continue;
        }
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
        const joined = walked.edges.flatMap((edge) =>
          edge.edge.faceReferences.filter((t) => caps.includes(t)),
        );
        if (
          !vertical ||
          walked.edges.length !== 4 ||
          joined.length !== 2 ||
          new Set(joined).size !== 2
        )
          throw Error(
            "Original side is not a complete vertical cap-to-cap quadrilateral",
          );
        const plan = hull(
            domain.map((p) => [p[0], p[1]] as NativeRationalPoint),
          ),
          zs = domain.map((p) => p[2]);
        cells.push({
          sourceComponentIndex: component.sourceComponentIndex,
          role: "original-boundary-domain",
          originalFaceTokens: [faceToken],
          partsFeet:
            plan.length >= 3 ? nativeRationalOverlay("union", [[plan]]) : [],
          closedSegmentsFeet: plan.length < 3 ? [plan] : [],
          minimumElevationFeet: zs.reduce((a, b) => (cmp(a, b) < 0 ? a : b)),
          maximumElevationFeet: zs.reduce((a, b) => (cmp(a, b) > 0 ? a : b)),
        });
      }
      const core = hull(corePoints);
      if (core.length < 3) throw Error("Original cap-bounded core has no area");
      cells.push({
        sourceComponentIndex: component.sourceComponentIndex,
        role: "cap-bounded-core",
        originalFaceTokens: caps,
        partsFeet: nativeRationalOverlay("union", [[core]]),
        closedSegmentsFeet: [],
        minimumElevationFeet: rational(planes.get(caps[0]!)!.origin[2]),
        maximumElevationFeet: rational(planes.get(caps[1]!)!.origin[2]),
      });
    }
    if (
      cells.flatMap((cell) => cell.originalFaceTokens).length !==
        index.faces.size ||
      new Set(cells.flatMap((cell) => cell.originalFaceTokens)).size !==
        index.faces.size
    )
      throw Error("Original material localization omitted a face");
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  return {
    cells,
    blockers,
    allOriginalFaceDomainsEnclosed: blockers.length === 0,
    sourceBoundaryUncertaintyLocalized: blockers.length === 0,
    exactPhysicalBodyApproved: false as const,
    sourceWalkingAuthorityGranted: false as const,
    routeApproved: false as const,
  };
}
