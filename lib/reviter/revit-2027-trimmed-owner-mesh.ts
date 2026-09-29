import type { NeutralFaceMesh } from "./brep-tessellator.ts";
import type { Revit2027FaceStatic } from "./revit-2027-face-static.ts";
import type { Revit2027MaterialDefinitions } from "./revit-2027-face-material.ts";
import type { Revit2027GRepReplay } from "./revit-2027-grep-replay.ts";
import {
  revit2027OwnerMeshIndex,
  type Revit2027OwnerLoopRecord,
  type Revit2027OwnerMeshIndex,
} from "./revit-2027-owner-mesh-index.ts";
import {
  revit2027OwnerFaceMesh,
  type Revit2027Point3,
} from "./revit-2027-owner-mesh-grid.ts";
import {
  correctedUvRingRoles,
  createUvRingMatcher,
  revit2027DirectedEdgeUvs,
  revit2027FaceUv,
  revit2027OwnerFaceMaterialId,
  revit2027OwnerUvTolerance,
  uvDistance,
  walkRevit2027DirectedLoopEdges,
  type Revit2027DirectedEdge,
  type Revit2027FaceUv,
} from "./revit-2027-owner-mesh-trim.ts";
import {
  revit2027FaceSurfaceEvaluator,
  type Revit2027SurfaceEvaluator,
  type Revit2027SurfaceEvaluatorResult,
} from "./revit-2027-surface-evaluator.ts";
import {
  meshRevit2027TrimmedUvRegions,
  type Revit2027TrimmedUvRegion,
  type Revit2027TrimmedUvRing,
} from "./revit-2027-trimmed-uv-mesh.ts";
import { groupRings, type Point2 } from "./polygon.ts";

/**
 * Every trim sample must land within this distance of the same sample
 * evaluated on the neighbouring face. Across the three sample files the
 * largest disagreement on a face this path meshes is 9.2e-5 ft, and most
 * agree to 1e-13 ft, so a wrong surface convention cannot hide under it.
 */
export const REVIT_2027_TRIM_NEIGHBOUR_TOLERANCE_FEET = 1e-3;

/**
 * A loop join whose two UV endpoints differ but whose model points and the
 * whole UV segment between them stay this close is closed rather than
 * rejected. It is the native BRep filler's own coedge endpoint distance
 * (`checkCoedgeLoop`). Across the three sample files 161 such joins are
 * retimed onto their edges' intersection and 4 bridged, the widest 5.2e-4 ft.
 */
const NATIVE_COEDGE_ENDPOINT_DISTANCE_FEET = 0.01;

/**
 * Two surface points this close are one model point. A UV segment whose
 * every sample is one point is a collapsed side: a revolved profile's end on
 * the axis (a lamp's spherical cap), a cone apex, a ruled surface's apex.
 */
const COLLAPSE_DISTANCE_FEET = 1e-7;

/**
 * The interior chord tolerance follows Revit's own trim sampling: twice the
 * largest bulge of any persisted boundary segment of the face, which is how
 * far the diagonal of a cell whose sides Revit sampled bows from the
 * surface. The curved trims of the 2025 RAC and technical school samples
 * bulge 2.9e-3 to 5.1e-3 ft, so interior edges stay within about 0.01 ft.
 * A face whose trims are all straight is held to that same 0.01 ft rather
 * than to anything finer: at 2e-3 ft the ruled faces of the largest sample
 * took 61,000 triangles, against 18,000 at 0.01 ft.
 */
const CHORD_TOLERANCE_FLOOR_FEET = 1e-2;
const CHORD_TOLERANCE_PER_TRIM_BULGE = 2;

/**
 * Two loop ends this close in UV that are also one model point are one
 * sample written twice, not a collapsed side: a real pole or apex spans a
 * visible UV interval. Some CylSurf and SurfRev joins in the 2025 RAC sample
 * differ by 1.5e-7 in angle, which left near-coincident vertices the ear
 * clipper could not order.
 */
const SAME_POINT_UV = 1e-6;

const MAX_FACE_VERTICES = 20_000;

/** Provenance decoder identity of every face this path meshes. */
export const REVIT_2027_TRIMMED_OWNER_MESH_DECODER_ID = "revit-2027-trimmed-owner-mesh";

/** Points probed along a UV segment to decide it is one model point. */
const COLLAPSE_PROBES = 8;

export type Revit2027TrimmedOwnerMeshIssueCode =
  | "surface-unresolved"
  | "unsupported-surface"
  | "profile-unresolved"
  | "invalid-surface"
  | "loop-unresolved"
  | "loop-cycle"
  | "loop-face-mismatch"
  | "edge-unresolved"
  | "edge-face-mismatch"
  | "edge-cycle"
  | "edge-link-mismatch"
  | "uv-link-unresolved"
  | "wrapping-loop"
  | "multi-loop"
  | "neighbour-unresolved"
  | "neighbour-mismatch"
  | "unverified-trim"
  | "material-unresolved"
  | "tessellator-rejected";

export type Revit2027TrimmedOwnerMeshIssue = {
  code: Revit2027TrimmedOwnerMeshIssueCode;
  faceToken?: number;
  loopToken?: number;
  edgeToken?: number;
  detail?: string;
};

export type Revit2027TrimmedOwnerFaceMesh = {
  faceToken: number;
  loopToken: number;
  loopTokens: readonly number[];
  surfaceKind: Revit2027SurfaceEvaluator["kind"];
  regionCount: number;
  holeLoopCount: number;
  /** Loop joins closed across a collapsed side. */
  collapsedJoinCount: number;
  /** Short native gaps closed at the two edges' intersection. */
  retimedJoinCount: number;
  /** Short native gaps with no intersection, closed by one segment. */
  bridgedJoinCount: number;
  /** The widest of those native gaps in the model, in feet. */
  maximumJoinGap: number;
  /** Trim samples compared against the neighbouring face, and the worst. */
  neighbourSampleCount: number;
  maximumNeighbourDistance: number;
  chordTolerance: number;
  mesh: NeutralFaceMesh;
};

export type Revit2027TrimmedOwnerMeshResult =
  | {
      ok: true;
      value: {
        ownerElementId: bigint;
        replay: Revit2027GRepReplay;
        faceMeshes: readonly Revit2027TrimmedOwnerFaceMesh[];
        issues: readonly Revit2027TrimmedOwnerMeshIssue[];
      };
    }
  | { ok: false; error: string };

export type Revit2027TrimmedOwnerMeshOptions = {
  uvTolerance?: number;
  materialDefinitions?: Revit2027MaterialDefinitions;
  materialForFace?: (
    faceToken: number,
    face: Revit2027FaceStatic,
  ) => string | number | null | undefined;
  /** Faces another certified path already meshed; they are not revisited. */
  skipFaceTokens?: ReadonlySet<number>;
};

type Issue = Revit2027TrimmedOwnerMeshIssue;

function isNonNullToken(token: number | undefined): boolean {
  return token === -1 || (token != null && token > 0);
}

function distance(left: Revit2027Point3, right: Revit2027Point3): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

/** Largest model distance from `a`'s point along the UV segment a -> b. */
function segmentSpread(
  evaluator: Revit2027SurfaceEvaluator,
  a: Revit2027FaceUv,
  b: Revit2027FaceUv,
): number | null {
  const start = evaluator.evaluate(a[0], a[1]);
  if (!start) return null;
  let spread = 0;
  for (let step = 1; step <= COLLAPSE_PROBES; step += 1) {
    const t = step / COLLAPSE_PROBES;
    const sample = evaluator.evaluate(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    if (!sample) return null;
    spread = Math.max(spread, distance(start.point, sample.point));
  }
  return spread;
}

type BuiltRing = {
  ring: Revit2027TrimmedUvRing;
  collapsedJoins: number;
  retimedJoins: number;
  bridgedJoins: number;
  /** The widest native gap, in the model, that was retimed or bridged. */
  maximumJoinGap: number;
};

type RingFailure = {
  ok: false;
  code: Revit2027TrimmedOwnerMeshIssueCode;
  edgeToken?: number;
  detail: string;
};

type Uv = [number, number];

/**
 * Where two directed edges that do not meet in UV are joined: at their
 * lines' intersection, retimed as the native BRep filler's `checkCoedgeLoop`
 * does, when both ends move no further in the model than its coedge
 * distance and neither edge turns back on itself. Collinear ends that
 * overlap keep the inner one. Null leaves the gap to a bridge segment.
 */
function retimedJoin(
  evaluator: Revit2027SurfaceEvaluator,
  a0: Uv,
  a1: Uv,
  b0: Uv,
  b1: Uv,
): Uv | null {
  const da: Uv = [a1[0] - a0[0], a1[1] - a0[1]];
  const db: Uv = [b1[0] - b0[0], b1[1] - b0[1]];
  const denominator = da[0] * db[1] - da[1] * db[0];
  const scale = Math.hypot(...da) * Math.hypot(...db);
  let joined: Uv | null = null;
  if (scale > 0 && Math.abs(denominator) > 1e-12 * scale) {
    const delta: Uv = [b0[0] - a0[0], b0[1] - a0[1]];
    const s = (delta[0] * db[1] - delta[1] * db[0]) / denominator;
    const t = (delta[0] * da[1] - delta[1] * da[0]) / denominator;
    if (s > 0 && t < 1) joined = [a0[0] + da[0] * s, a0[1] + da[1] * s];
  } else if (scale > 0) {
    // Collinear: keep whichever end lies inside the other edge's segment.
    const along = (point: Uv, start: Uv, direction: Uv): number =>
      ((point[0] - start[0]) * direction[0] + (point[1] - start[1]) * direction[1]) /
      (direction[0] * direction[0] + direction[1] * direction[1]);
    const sB = along(b0, a0, da);
    const tA = along(a1, b0, db);
    if (sB > 0 && sB < 1) joined = [b0[0], b0[1]];
    else if (tA > 0 && tA < 1) joined = [a1[0], a1[1]];
  }
  if (!joined || !joined.every(Number.isFinite)) return null;
  const at = evaluator.evaluate(joined[0], joined[1]);
  const fromA = evaluator.evaluate(a1[0], a1[1]);
  const fromB = evaluator.evaluate(b0[0], b0[1]);
  if (!at || !fromA || !fromB) return null;
  return distance(at.point, fromA.point) <= NATIVE_COEDGE_ENDPOINT_DISTANCE_FEET &&
      distance(at.point, fromB.point) <= NATIVE_COEDGE_ENDPOINT_DISTANCE_FEET
    ? joined
    : null;
}

/**
 * Join one loop's directed edge samples into a closed UV ring.
 *
 * Consecutive edges must meet in UV, across the surface's angular period
 * (a seam: later edges are shifted by whole turns), at a collapsed side, or
 * across a gap no wider than the native coedge distance, which is retimed
 * onto the edges' intersection or else bridged by one short segment. A loop
 * whose seam shifts do not cancel winds around the surface and has no
 * planar chart.
 */
function buildRing(
  edges: readonly Revit2027DirectedEdge[],
  evaluator: Revit2027SurfaceEvaluator,
  tolerance: number,
): { ok: true; value: BuiltRing } | RingFailure {
  // Each edge's samples in one continuous chart, without repeats.
  const polylines: Uv[][] = [];
  let shift = 0;
  for (const edge of edges) {
    const samples = revit2027DirectedEdgeUvs(edge);
    const previous = polylines.at(-1)?.at(-1);
    if (previous && evaluator.uPeriod != null) {
      const first = samples[0]!;
      const turns = Math.round((first[0] + shift - previous[0]) / evaluator.uPeriod);
      if (
        turns !== 0 &&
        Math.abs(first[0] + shift - turns * evaluator.uPeriod - previous[0]) <= tolerance &&
        Math.abs(first[1] - previous[1]) <= tolerance
      ) {
        shift -= turns * evaluator.uPeriod;
      }
    }
    const polyline: Uv[] = [];
    for (const uv of samples) {
      const point: Uv = [uv[0] + shift, uv[1]];
      if (polyline.length && uvDistance(polyline.at(-1)!, point) <= tolerance) continue;
      polyline.push(point);
    }
    if (polyline.length < 2) {
      return { ok: false, code: "tessellator-rejected", edgeToken: edge.token, detail: "edge has no UV extent" };
    }
    polylines.push(polyline);
  }
  if (shift !== 0) {
    return { ok: false, code: "wrapping-loop", detail: "seam shifts do not cancel around the loop" };
  }

  // Resolve every join, the closing one included; `incoming[j]` is the flag
  // of the segment that arrives at polyline j's first point, or "merged".
  let collapsedJoins = 0;
  let retimedJoins = 0;
  let bridgedJoins = 0;
  let maximumJoinGap = 0;
  const incoming: ("merged" | boolean)[] = [];
  for (let j = 0; j < polylines.length; j += 1) {
    const a = polylines[j]!;
    const next = (j + 1) % polylines.length;
    const b = polylines[next]!;
    const a1 = a.at(-1)!;
    const b0 = b[0]!;
    if (uvDistance(a1, b0) <= tolerance) {
      b[0] = a1;
      incoming[next] = "merged";
      continue;
    }
    const spread = segmentSpread(evaluator, a1, b0);
    if (spread == null) {
      return { ok: false, code: "tessellator-rejected", edgeToken: edges[next]!.token, detail: "a trim sample does not evaluate" };
    }
    if (spread <= COLLAPSE_DISTANCE_FEET && uvDistance(a1, b0) <= SAME_POINT_UV) {
      b[0] = a1;
      incoming[next] = "merged";
      continue;
    }
    if (spread <= COLLAPSE_DISTANCE_FEET) {
      incoming[next] = true;
      collapsedJoins += 1;
      continue;
    }
    if (spread > NATIVE_COEDGE_ENDPOINT_DISTANCE_FEET) {
      return {
        ok: false,
        code: "uv-link-unresolved",
        edgeToken: edges[next]!.token,
        detail: `edge ${edges[next]!.token} starts ${uvDistance(a1, b0).toPrecision(6)} from the previous edge in UV`,
      };
    }
    maximumJoinGap = Math.max(maximumJoinGap, spread);
    const joined = retimedJoin(evaluator, a.at(-2)!, a1, b0, b[1]!);
    if (joined) {
      a[a.length - 1] = joined;
      b[0] = joined;
      incoming[next] = "merged";
      retimedJoins += 1;
      continue;
    }
    incoming[next] = false;
    bridgedJoins += 1;
  }

  const points: Uv[] = [];
  const arriving: boolean[] = [];
  const collapsedSegment = (from: Uv, to: Uv): boolean | null => {
    const spread = segmentSpread(evaluator, from, to);
    return spread == null ? null : spread <= COLLAPSE_DISTANCE_FEET;
  };
  for (let j = 0; j < polylines.length; j += 1) {
    const polyline = polylines[j]!;
    const outgoingMerged = incoming[(j + 1) % polylines.length] === "merged";
    const lastIndex = outgoingMerged ? polyline.length - 2 : polyline.length - 1;
    for (let k = 0; k <= lastIndex; k += 1) {
      let flag: boolean | null;
      if (k > 0) {
        flag = collapsedSegment(polyline[k - 1]!, polyline[k]!);
      } else if (incoming[j] === "merged") {
        const previous = polylines[(j + polylines.length - 1) % polylines.length]!;
        flag = collapsedSegment(previous.at(-2)!, previous.at(-1)!);
      } else {
        flag = incoming[j] as boolean;
      }
      if (flag == null) {
        return { ok: false, code: "tessellator-rejected", edgeToken: edges[j]!.token, detail: "a trim sample does not evaluate" };
      }
      points.push(polyline[k]!);
      arriving.push(flag);
    }
  }
  if (points.length < 3) {
    return { ok: false, code: "tessellator-rejected", detail: `loop has ${points.length} distinct UV points` };
  }
  const collapsed = points.map((_, index) => arriving[(index + 1) % points.length]!);
  return {
    ok: true,
    value: {
      ring: { points, collapsed },
      collapsedJoins,
      retimedJoins,
      bridgedJoins,
      maximumJoinGap,
    },
  };
}

/**
 * Compare every trim sample with the same sample on the face across its
 * edge. A neighbour that exists but cannot be evaluated fails closed; a face
 * with no evaluated neighbour at all is unverified and fails closed too.
 */
function checkNeighbours(
  faceToken: number,
  evaluator: Revit2027SurfaceEvaluator,
  directedByLoop: readonly (readonly Revit2027DirectedEdge[])[],
  neighbour: (token: number) => Revit2027SurfaceEvaluatorResult | null,
): { ok: true; samples: number; maximum: number } | { ok: false; issue: Omit<Issue, "faceToken"> } {
  let samples = 0;
  let maximum = 0;
  for (const edges of directedByLoop) {
    for (const edge of edges) {
      const otherToken = edge.edge.faceReferences[edge.side === 0 ? 1 : 0];
      if (otherToken <= 0 || otherToken === faceToken) continue;
      const other = neighbour(otherToken);
      if (!other || other.ok === false) {
        return {
          ok: false,
          issue: {
            code: "neighbour-unresolved",
            edgeToken: edge.token,
            detail: `face ${otherToken}: ${other ? `${other.code}: ${other.detail}` : "not in this replay"}`,
          },
        };
      }
      const otherSide: 0 | 1 = edge.side === 0 ? 1 : 0;
      for (const point of [
        edge.edge.firstAndLastEdgePoints[0],
        ...edge.edge.interiorEdgePoints,
        edge.edge.firstAndLastEdgePoints[1],
      ]) {
        const here = revit2027FaceUv(point, edge.side);
        const there = revit2027FaceUv(point, otherSide);
        const a = evaluator.evaluate(here[0], here[1]);
        const b = other.evaluator.evaluate(there[0], there[1]);
        if (!a || !b) {
          return {
            ok: false,
            issue: { code: "neighbour-mismatch", edgeToken: edge.token, detail: "a shared trim sample does not evaluate" },
          };
        }
        const gap = distance(a.point, b.point);
        if (!(gap <= REVIT_2027_TRIM_NEIGHBOUR_TOLERANCE_FEET)) {
          return {
            ok: false,
            issue: {
              code: "neighbour-mismatch",
              edgeToken: edge.token,
              detail: `trim sample is ${gap.toPrecision(6)} ft from face ${otherToken}`,
            },
          };
        }
        samples += 1;
        maximum = Math.max(maximum, gap);
      }
    }
  }
  if (samples === 0) {
    return { ok: false, issue: { code: "unverified-trim", detail: "no trim edge is shared with an evaluated face" } };
  }
  return { ok: true, samples, maximum };
}

/**
 * Give each ring its outer or hole role and group them into regions.
 *
 * TB_Geometry's OdBmEdgeLoopImpl::isCCW corrects the directed UV winding
 * when the persisted Face normal-flip bit equals Surface.orientFlag, and a
 * corrected-positive loop is filled. Containment must agree independently,
 * so a lone loop is also held to its corrected winding.
 */
function classifyRegions(
  rings: readonly Revit2027TrimmedUvRing[],
  normalFlipped: boolean,
  orientFlag: boolean,
  tolerance: number,
): { regions: Revit2027TrimmedUvRegion[]; holes: number } | null {
  const points = rings.map((ring) => ring.points.map((point) => [point[0], point[1]] as Point2));
  const roles = correctedUvRingRoles(points, normalFlipped, orientFlag, tolerance);
  if (!roles) return null;
  if (rings.length === 1) {
    return roles[0] === "outer" ? { regions: [{ outer: rings[0]!, holes: [] }], holes: 0 } : null;
  }
  const groups = groupRings(points);
  if (groups.length !== roles.filter((role) => role === "outer").length) return null;
  const matcher = createUvRingMatcher(points);
  const regions: Revit2027TrimmedUvRegion[] = [];
  for (const group of groups) {
    const outerIndex = matcher.match(group.outer);
    if (outerIndex == null || roles[outerIndex] !== "outer") return null;
    const holes: Revit2027TrimmedUvRing[] = [];
    for (const hole of group.holes) {
      const holeIndex = matcher.match(hole);
      if (holeIndex == null || roles[holeIndex] !== "hole") return null;
      holes.push(rings[holeIndex]!);
    }
    regions.push({ outer: rings[outerIndex]!, holes });
  }
  if (matcher.used.size !== rings.length) return null;
  return { regions, holes: roles.filter((role) => role === "hole").length };
}

/**
 * Model length per unit u and v over the trim's UV box, so the triangulation
 * chart is close to isotropic. Collapsed sides contribute no length.
 */
function metricScale(
  evaluator: Revit2027SurfaceEvaluator,
  rings: readonly Revit2027TrimmedUvRing[],
): [number, number] | null {
  let minimumU = Infinity, minimumV = Infinity, maximumU = -Infinity, maximumV = -Infinity;
  for (const ring of rings) {
    for (const [u, v] of ring.points) {
      minimumU = Math.min(minimumU, u);
      maximumU = Math.max(maximumU, u);
      minimumV = Math.min(minimumV, v);
      maximumV = Math.max(maximumV, v);
    }
  }
  const sums = [0, 0];
  const counts = [0, 0];
  for (let i = 0; i <= 4; i += 1) {
    for (let j = 0; j <= 4; j += 1) {
      const sample = evaluator.evaluate(
        minimumU + ((maximumU - minimumU) * i) / 4,
        minimumV + ((maximumV - minimumV) * j) / 4,
      );
      if (!sample) return null;
      const lengths = [Math.hypot(...sample.tangentU), Math.hypot(...sample.tangentV)];
      for (const axis of [0, 1]) {
        if (lengths[axis]! > 0) {
          sums[axis] += lengths[axis]!;
          counts[axis] += 1;
        }
      }
    }
  }
  const spans = [maximumU - minimumU, maximumV - minimumV];
  const scale = [0, 1].map((axis) =>
    counts[axis]! > 0 ? sums[axis]! / counts[axis]! : spans[axis]! > 0 ? 1 / spans[axis]! : 1
  );
  return scale.every((value) => Number.isFinite(value) && value > 0)
    ? [scale[0]!, scale[1]!]
    : null;
}

/** The largest bulge of any persisted, non-collapsed trim segment. */
function boundaryChordDeviation(
  evaluator: Revit2027SurfaceEvaluator,
  rings: readonly Revit2027TrimmedUvRing[],
): number | null {
  let maximum = 0;
  for (const ring of rings) {
    for (let index = 0; index < ring.points.length; index += 1) {
      if (ring.collapsed[index]) continue;
      const a = ring.points[index]!;
      const b = ring.points[(index + 1) % ring.points.length]!;
      const pa = evaluator.evaluate(a[0], a[1]);
      const pb = evaluator.evaluate(b[0], b[1]);
      const pm = evaluator.evaluate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      if (!pa || !pb || !pm) return null;
      maximum = Math.max(
        maximum,
        distance(pm.point, [
          (pa.point[0] + pb.point[0]) / 2,
          (pa.point[1] + pb.point[1]) / 2,
          (pa.point[2] + pb.point[2]) / 2,
        ]),
      );
    }
  }
  return maximum;
}

function loopChain(
  index: Revit2027OwnerMeshIndex,
  faceToken: number,
  face: Revit2027FaceStatic,
): { ok: true; loops: Revit2027OwnerLoopRecord[] } | { ok: false; issue: Issue } {
  const loops: Revit2027OwnerLoopRecord[] = [];
  const seen = new Set<number>();
  let loopToken = face.firstLoop.token;
  if (loopToken <= 0) return { ok: false, issue: { code: "loop-unresolved", faceToken } };
  while (loopToken !== 0) {
    if (loopToken < 0 || seen.has(loopToken) || loops.length > index.loops.size) {
      return { ok: false, issue: { code: "loop-cycle", faceToken, loopToken } };
    }
    const loop = index.loops.get(loopToken);
    if (!loop) return { ok: false, issue: { code: "loop-unresolved", faceToken, loopToken } };
    if (loop.loop.faceReference !== faceToken) {
      return { ok: false, issue: { code: "loop-face-mismatch", faceToken, loopToken } };
    }
    seen.add(loopToken);
    loops.push(loop);
    loopToken = loop.loop.nextLoop.token;
  }
  return { ok: true, loops };
}

/**
 * Mesh the drawable Faces no other certified path claimed, on any surface
 * this browser can evaluate, whatever the shape of their trim.
 *
 * The rectangular paths only admit a single loop of four edges on the
 * surface envelope with matching opposite sampling. This path takes any
 * set of loops, links them in the surface's own UV chart across seams,
 * collapsed sides and native endpoint gaps, triangulates and refines them to
 * the surface, and admits the face only when every trim sample meets the
 * neighbouring face, the loops' winding and containment agree, and the mesh
 * covers exactly the trim with the persisted orientation.
 */
export function meshRevit2027TrimmedSurfaceReplay(
  replay: Revit2027GRepReplay,
  options: Revit2027TrimmedOwnerMeshOptions = {},
): Revit2027TrimmedOwnerMeshResult {
  const resolved = revit2027OwnerUvTolerance(options.uvTolerance);
  if (!resolved.ok) return resolved;
  const tolerance = resolved.tolerance;
  const index = revit2027OwnerMeshIndex(replay);
  const issues: Issue[] = [];
  const faceMeshes: Revit2027TrimmedOwnerFaceMesh[] = [];
  const evaluators = new Map<number, Revit2027SurfaceEvaluatorResult>();
  const evaluatorFor = (token: number): Revit2027SurfaceEvaluatorResult | null => {
    const cached = evaluators.get(token);
    if (cached) return cached;
    const face = index.faces.get(token);
    if (!face) return null;
    const built = revit2027FaceSurfaceEvaluator(index, token, face);
    evaluators.set(token, built);
    return built;
  };

  for (const [faceToken, face] of index.faces) {
    if (options.skipFaceTokens?.has(faceToken)) continue;
    if (!isNonNullToken(face.surface.token)) continue;
    const hasRegions = face.faceRegions.entries.some((entry) => isNonNullToken(entry.token));
    if (!isNonNullToken(face.firstLoop.token) && !hasRegions) continue;

    const built = evaluatorFor(faceToken)!;
    if (built.ok === false) {
      issues.push({ code: built.code, faceToken, detail: built.detail });
      continue;
    }
    const evaluator = built.evaluator;
    const chain = loopChain(index, faceToken, face);
    if (chain.ok === false) {
      issues.push(chain.issue);
      continue;
    }

    const directedByLoop: Revit2027DirectedEdge[][] = [];
    const rings: Revit2027TrimmedUvRing[] = [];
    let collapsedJoinCount = 0;
    let retimedJoinCount = 0;
    let bridgedJoinCount = 0;
    let maximumJoinGap = 0;
    let failed = false;
    for (const loop of chain.loops) {
      const walked = walkRevit2027DirectedLoopEdges({
        faceToken,
        loop,
        edges: index.edges,
        loopArity: "open",
      });
      if (walked.ok === false) {
        issues.push(walked.issue);
        failed = true;
        break;
      }
      const ring = buildRing(walked.edges, evaluator, tolerance);
      if (ring.ok === false) {
        issues.push({
          code: ring.code,
          faceToken,
          loopToken: loop.token,
          edgeToken: ring.edgeToken,
          detail: ring.detail,
        });
        failed = true;
        break;
      }
      directedByLoop.push(walked.edges);
      rings.push(ring.value.ring);
      collapsedJoinCount += ring.value.collapsedJoins;
      retimedJoinCount += ring.value.retimedJoins;
      bridgedJoinCount += ring.value.bridgedJoins;
      maximumJoinGap = Math.max(maximumJoinGap, ring.value.maximumJoinGap);
    }
    if (failed) continue;

    const loopToken = chain.loops[0]!.token;
    const classified = classifyRegions(
      rings,
      (face.faceFlags & 0x2) !== 0,
      evaluator.orientFlag,
      tolerance,
    );
    if (!classified) {
      issues.push({
        code: "multi-loop",
        faceToken,
        loopToken,
        detail: `${rings.length} contour(s) do not prove native-oriented filled regions with direct holes`,
      });
      continue;
    }
    const neighbours = checkNeighbours(faceToken, evaluator, directedByLoop, evaluatorFor);
    if (neighbours.ok === false) {
      issues.push({ ...neighbours.issue, faceToken, loopToken });
      continue;
    }
    const scale = metricScale(evaluator, rings);
    const bulge = boundaryChordDeviation(evaluator, rings);
    if (!scale || bulge == null) {
      issues.push({ code: "tessellator-rejected", faceToken, loopToken, detail: "the trim box does not evaluate" });
      continue;
    }
    const chordTolerance = Math.max(
      CHORD_TOLERANCE_FLOOR_FEET,
      CHORD_TOLERANCE_PER_TRIM_BULGE * bulge,
    );
    const meshed = meshRevit2027TrimmedUvRegions({
      regions: classified.regions,
      evaluate: evaluator.evaluate,
      orientFlag: evaluator.orientFlag,
      metricScale: scale,
      chordTolerance,
      collapseTolerance: COLLAPSE_DISTANCE_FEET,
      maxVertices: MAX_FACE_VERTICES,
    });
    if (meshed.ok === false) {
      issues.push({
        code: "tessellator-rejected",
        faceToken,
        loopToken,
        detail: `${meshed.code}: ${meshed.detail}`,
      });
      continue;
    }
    const materialId = revit2027OwnerFaceMaterialId(
      faceToken,
      face,
      options,
      (detail) => issues.push({ code: "material-unresolved", faceToken, detail }),
    );
    faceMeshes.push({
      faceToken,
      loopToken,
      loopTokens: chain.loops.map((loop) => loop.token),
      surfaceKind: evaluator.kind,
      regionCount: classified.regions.length,
      holeLoopCount: classified.holes,
      collapsedJoinCount,
      retimedJoinCount,
      bridgedJoinCount,
      maximumJoinGap,
      neighbourSampleCount: neighbours.samples,
      maximumNeighbourDistance: neighbours.maximum,
      chordTolerance,
      mesh: revit2027OwnerFaceMesh({
        ownerElementId: replay.ownerElementId,
        faceToken,
        decoderId: REVIT_2027_TRIMMED_OWNER_MESH_DECODER_ID,
        brepSuffix: "trimmed",
        materialId,
        positions: meshed.mesh.positions,
        normals: meshed.mesh.normals,
        indices: meshed.mesh.indices,
      }),
    });
  }
  return {
    ok: true,
    value: { ownerElementId: replay.ownerElementId, replay, faceMeshes, issues },
  };
}
