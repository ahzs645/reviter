/**
 * Triangulate trimmed regions of one parametric surface in its own UV chart
 * and refine them until the flat triangles follow the surface.
 *
 * The trim is taken exactly as persisted: every boundary sample becomes a
 * mesh vertex and no boundary segment is ever subdivided, so the face meets
 * its neighbours on the same polyline Revit wrote for both of them. The one
 * exception is a segment that collapses to a single surface point (a
 * revolved profile touching its axis, a cone apex, a ruled apex), which may
 * be split freely because every point on it is the same model point.
 *
 * The pipeline is ear clipping for the initial cover; a seed grid whose
 * lines follow the trim's own samples and whose spacing comes from the
 * surface's curvature; Lawson flips to a constrained Delaunay triangulation
 * in a metric-scaled chart; then longest-edge bisection of any triangle whose
 * interior edges or centroid stray from the surface by more than the chord
 * tolerance. A vertex on a collapsed side stands for one model point whatever
 * its UV, so every check re-seats it along that side toward the rest of its
 * triangle. The result is certified before it is returned: a consistently
 * oriented, edge-manifold cover whose boundary is exactly the input rings,
 * whose area is exactly theirs, and whose every triangle faces the persisted
 * surface sense. Anything else fails closed.
 */
import { triangulate, type Point2 } from "./polygon.ts";
import type {
  Revit2027Point3,
  Revit2027SurfaceSample,
} from "./revit-2027-owner-mesh-grid.ts";

export type Revit2027TrimmedUvRing = {
  /** Closed ring without a repeated closing point. */
  points: readonly (readonly [number, number])[];
  /** `collapsed[i]` marks segment `points[i] -> points[i + 1]` as one point. */
  collapsed: readonly boolean[];
};

export type Revit2027TrimmedUvRegion = {
  outer: Revit2027TrimmedUvRing;
  holes: readonly Revit2027TrimmedUvRing[];
};

export type Revit2027TrimmedUvMeshRequest = {
  regions: readonly Revit2027TrimmedUvRegion[];
  evaluate: (u: number, v: number) => Revit2027SurfaceSample | null;
  /** Persisted `Surface.orientFlag`: the front side is `±(Su × Sv)`. */
  orientFlag: boolean;
  /** Model length per unit of u and v, so the chart is roughly isotropic. */
  metricScale: readonly [number, number];
  /** Largest admitted distance between a flat triangle and the surface. */
  chordTolerance: number;
  /** Two surface points closer than this are one point (a collapsed side). */
  collapseTolerance: number;
  maxVertices: number;
};

export type Revit2027TrimmedUvMesh = {
  positions: Float64Array;
  normals: Float32Array;
  indices: Uint32Array;
  uvs: Float64Array;
  /** Vertices that are persisted trim samples or on a collapsed side. */
  boundaryVertexCount: number;
  /** Triangles dropped because a collapsed side made them zero-area. */
  collapsedTriangleCount: number;
  refinementVertexCount: number;
};

export type Revit2027TrimmedUvMeshIssueCode =
  | "invalid-request"
  | "triangulation-failed"
  | "boundary-vertex-lost"
  | "boundary-mismatch"
  | "area-mismatch"
  | "surface-evaluation-failed"
  | "refinement-limit"
  | "orientation-mismatch";

export type Revit2027TrimmedUvMeshResult =
  | { ok: true; mesh: Revit2027TrimmedUvMesh }
  | { ok: false; code: Revit2027TrimmedUvMeshIssueCode; detail: string };

/** Relative area slack for the cover-equals-trim audit. */
const AREA_RELATIVE_TOLERANCE = 1e-9;
/**
 * The centroid of a flat triangle whose three edges each bulge by the chord
 * tolerance sits up to 4/3 of it from a convex surface, so the centroid test
 * carries that slack and only catches twist the edge midpoints cannot see.
 */
const CENTROID_TOLERANCE_FACTOR = 1.5;
const MAX_FLIPS_PER_VERTEX = 64;
/** Most pieces the seed grid puts along one axis of the trim box. */
const MAX_GRID_SEGMENTS = 128;
/**
 * A gap between kept grid lines is split only once it is this many steps
 * wide. Revit samples its own trims at about the chord tolerance, so a gap
 * between two of its samples is kept whole rather than halved for a hair.
 */
const GRID_GAP_SLACK = 1.25;

/** A collapsed trim side as persisted: its two UV ends. */
type CollapsedSegment = readonly [readonly [number, number], readonly [number, number]];

type Failure = { ok: false; code: Revit2027TrimmedUvMeshIssueCode; detail: string };

function fail(code: Revit2027TrimmedUvMeshIssueCode, detail: string): Failure {
  return { ok: false, code, detail };
}

function signedArea(ring: readonly (readonly [number, number])[]): number {
  let twice = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const p = ring[index]!;
    const q = ring[(index + 1) % ring.length]!;
    twice += p[0] * q[1] - q[0] * p[1];
  }
  return twice / 2;
}

/** A ring re-wound to the requested sign, collapsed flags following along. */
function wound(ring: Revit2027TrimmedUvRing, counterClockwise: boolean): Revit2027TrimmedUvRing {
  if ((signedArea(ring.points) > 0) === counterClockwise) return ring;
  const count = ring.points.length;
  const points = ring.points.map((_, index) => ring.points[(count - index) % count]!);
  // Reversed segment i joins reversed points i and i+1, which were original
  // points (count-i) and (count-i-1): original segment count-i-1.
  const collapsed = ring.points.map((_, index) => ring.collapsed[(2 * count - index - 1) % count]!);
  return { points, collapsed };
}

function distance(left: Revit2027Point3, right: Revit2027Point3): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function subtract(left: Revit2027Point3, right: Revit2027Point3): Revit2027Point3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function cross(left: Revit2027Point3, right: Revit2027Point3): Revit2027Point3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(left: Revit2027Point3, right: Revit2027Point3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

/**
 * A mutable triangle cover over every region of one face. Triangles are
 * stored counter-clockwise in UV; edges are keyed without direction.
 */
class Cover {
  readonly uv: [number, number][] = [];
  readonly point: Revit2027Point3[] = [];
  readonly triangles: ([number, number, number] | null)[] = [];
  readonly edges = new Map<number, number[]>();
  /** Boundary segments by undirected key: whether each is collapsed. */
  readonly constraints = new Map<number, boolean>();
  /** The persisted collapsed side each collapsed constraint lies on. */
  readonly collapsedSegments = new Map<number, CollapsedSegment>();
  /** Vertices whose model point is a collapsed side's single point. */
  readonly collapsedAt = new Map<number, CollapsedSegment[]>();
  splitVertices = 0;
  readonly evaluate: (u: number, v: number) => Revit2027SurfaceSample | null;
  readonly scale: readonly [number, number];
  readonly maxVertices: number;

  constructor(
    evaluate: (u: number, v: number) => Revit2027SurfaceSample | null,
    scale: readonly [number, number],
    maxVertices: number,
  ) {
    this.evaluate = evaluate;
    this.scale = scale;
    this.maxVertices = maxVertices;
  }

  key(a: number, b: number): number {
    return a < b ? a * 0x200000 + b : b * 0x200000 + a;
  }

  addVertex(uv: readonly [number, number]): number | null {
    if (this.uv.length >= this.maxVertices) return null;
    const sample = this.evaluate(uv[0], uv[1]);
    if (!sample) return null;
    this.uv.push([uv[0], uv[1]]);
    this.point.push(sample.point);
    return this.uv.length - 1;
  }

  twiceArea(a: number, b: number, c: number): number {
    const [au, av] = this.uv[a]!;
    const [bu, bv] = this.uv[b]!;
    const [cu, cv] = this.uv[c]!;
    return (bu - au) * (cv - av) - (bv - av) * (cu - au);
  }

  addTriangle(a: number, b: number, c: number): number {
    const id = this.triangles.length;
    this.triangles.push([a, b, c]);
    for (const [x, y] of [[a, b], [b, c], [c, a]] as const) {
      const key = this.key(x, y);
      const list = this.edges.get(key);
      if (list) list.push(id);
      else this.edges.set(key, [id]);
    }
    return id;
  }

  removeTriangle(id: number): void {
    const triangle = this.triangles[id]!;
    this.triangles[id] = null;
    const [a, b, c] = triangle;
    for (const [x, y] of [[a, b], [b, c], [c, a]] as const) {
      const key = this.key(x, y);
      const list = this.edges.get(key)!.filter((other) => other !== id);
      if (list.length) this.edges.set(key, list);
      else this.edges.delete(key);
    }
  }

  /** The triangle's vertices rotated so `a -> b` is its directed edge. */
  rotated(id: number, a: number, b: number): [number, number, number] | null {
    const t = this.triangles[id];
    if (!t) return null;
    for (let index = 0; index < 3; index += 1) {
      if (t[index] === a && t[(index + 1) % 3] === b) {
        return [a, b, t[(index + 2) % 3]!];
      }
    }
    return null;
  }

  splittable(a: number, b: number): boolean {
    const collapsed = this.constraints.get(this.key(a, b));
    return collapsed === undefined || collapsed;
  }

  /** Split edge a-b at vertex m in every triangle that uses it. */
  splitEdge(a: number, b: number, m: number): number[] {
    const key = this.key(a, b);
    const created: number[] = [];
    for (const id of [...(this.edges.get(key) ?? [])]) {
      const forward = this.rotated(id, a, b) ?? this.rotated(id, b, a);
      if (!forward) continue;
      const [x, y, z] = forward;
      this.removeTriangle(id);
      created.push(this.addTriangle(x, m, z), this.addTriangle(m, y, z));
    }
    const collapsed = this.constraints.get(key);
    if (collapsed !== undefined) {
      this.constraints.delete(key);
      this.constraints.set(this.key(a, m), collapsed);
      this.constraints.set(this.key(m, b), collapsed);
      const segment = this.collapsedSegments.get(key);
      if (segment) {
        this.collapsedSegments.delete(key);
        this.collapsedSegments.set(this.key(a, m), segment);
        this.collapsedSegments.set(this.key(m, b), segment);
        this.markCollapsed(m, segment);
      }
    }
    return created;
  }

  /** Record that a vertex is the single model point of a collapsed side. */
  markCollapsed(vertex: number, segment: CollapsedSegment): void {
    const list = this.collapsedAt.get(vertex);
    if (!list) this.collapsedAt.set(vertex, [segment]);
    else if (!list.includes(segment)) list.push(segment);
  }

  /**
   * The UV a collapsed-side vertex stands for when it is joined to `toward`.
   *
   * Every UV along a collapsed side is one model point, so its own UV is an
   * arbitrary pick. Checked edges and centroids re-seat it at the point of
   * its side nearest the rest of the triangle: the meridian through the
   * other vertex for a pole, the generator for a cone apex.
   */
  reseat(vertex: number, toward: readonly [number, number]): readonly [number, number] {
    const segments = this.collapsedAt.get(vertex);
    if (!segments) return this.uv[vertex]!;
    let best: readonly [number, number] = this.uv[vertex]!;
    let bestDistance = Infinity;
    for (const [start, end] of segments) {
      const du = end[0] - start[0];
      const dv = end[1] - start[1];
      const lengthSquared = du * du + dv * dv;
      const t = lengthSquared > 0
        ? Math.min(1, Math.max(0, ((toward[0] - start[0]) * du + (toward[1] - start[1]) * dv) / lengthSquared))
        : 0;
      const candidate = [start[0] + du * t, start[1] + dv * t] as const;
      const gap = Math.hypot(candidate[0] - toward[0], candidate[1] - toward[1]);
      if (gap < bestDistance) {
        best = candidate;
        bestDistance = gap;
      }
    }
    return best;
  }

  /** Split one triangle at an interior vertex. */
  splitTriangle(id: number, m: number): number[] {
    const [a, b, c] = this.triangles[id]!;
    this.removeTriangle(id);
    return [
      this.addTriangle(a, b, m),
      this.addTriangle(b, c, m),
      this.addTriangle(c, a, m),
    ];
  }

  metric(index: number): [number, number] {
    const [u, v] = this.uv[index]!;
    return [u * this.scale[0], v * this.scale[1]];
  }

  metricLength(a: number, b: number): number {
    const [au, av] = this.metric(a);
    const [bu, bv] = this.metric(b);
    return Math.hypot(au - bu, av - bv);
  }

  /** Whether d lies strictly inside the metric circumcircle of a, b, c. */
  inCircle(a: number, b: number, c: number, d: number): boolean {
    const [ax, ay] = this.metric(a);
    const [bx, by] = this.metric(b);
    const [cx, cy] = this.metric(c);
    const [dx, dy] = this.metric(d);
    const adx = ax - dx, ady = ay - dy;
    const bdx = bx - dx, bdy = by - dy;
    const cdx = cx - dx, cdy = cy - dy;
    const determinant =
      (adx * adx + ady * ady) * (bdx * cdy - cdx * bdy) -
      (bdx * bdx + bdy * bdy) * (adx * cdy - cdx * ady) +
      (cdx * cdx + cdy * cdy) * (adx * bdy - bdx * ady);
    const scale = Math.max(
      Math.abs(adx), Math.abs(ady), Math.abs(bdx), Math.abs(bdy), Math.abs(cdx), Math.abs(cdy),
    );
    return determinant > 1e-12 * scale ** 4;
  }

  /**
   * Lawson flips until every unconstrained edge on the stack is locally
   * Delaunay in the metric chart. Returns the triangles it created.
   */
  legalize(stack: [number, number][], budget: number): number[] | null {
    const created: number[] = [];
    let flips = 0;
    while (stack.length) {
      const [a, b] = stack.pop()!;
      const key = this.key(a, b);
      if (this.constraints.has(key)) continue;
      const list = this.edges.get(key);
      if (!list || list.length !== 2) continue;
      const first = this.rotated(list[0]!, a, b) ?? this.rotated(list[0]!, b, a);
      if (!first) continue;
      const [x, y, c] = first;
      const second = this.rotated(list[1]!, y, x);
      if (!second) return null;
      const d = second[2];
      if (!this.inCircle(x, y, c, d)) continue;
      // Flip only a strictly convex quad, so both new triangles stay CCW.
      if (this.twiceArea(x, d, c) <= 0 || this.twiceArea(d, y, c) <= 0) continue;
      if (++flips > budget) return null;
      this.removeTriangle(list[0]!);
      this.removeTriangle(list[1]!);
      created.push(this.addTriangle(x, d, c), this.addTriangle(d, y, c));
      stack.push([x, d], [d, y], [y, c], [c, x]);
    }
    return created;
  }
}

function linkRegion(
  cover: Cover,
  region: Revit2027TrimmedUvRegion,
): { ok: true; rings: number[][] } | Failure {
  const rings = [wound(region.outer, true), ...region.holes.map((hole) => wound(hole, false))];
  const indexRings: number[][] = [];
  for (const ring of rings) {
    const indices: number[] = [];
    for (const uv of ring.points) {
      const index = cover.addVertex(uv);
      if (index == null) {
        return fail("surface-evaluation-failed", "a trim sample does not evaluate on the surface");
      }
      indices.push(index);
    }
    for (let index = 0; index < indices.length; index += 1) {
      const a = indices[index]!;
      const b = indices[(index + 1) % indices.length]!;
      if (cover.constraints.has(cover.key(a, b))) {
        return fail("boundary-mismatch", "a trim segment is repeated");
      }
      cover.constraints.set(cover.key(a, b), ring.collapsed[index]!);
      if (ring.collapsed[index]) {
        const segment: CollapsedSegment = [cover.uv[a]!, cover.uv[b]!];
        cover.collapsedSegments.set(cover.key(a, b), segment);
        cover.markCollapsed(a, segment);
        cover.markCollapsed(b, segment);
      }
    }
    indexRings.push(indices);
  }
  return { ok: true, rings: indexRings };
}

/**
 * Put back a ring vertex the ear clipper dropped as collinear by splitting
 * the one boundary edge it lies on.
 */
function restoreVertex(cover: Cover, vertex: number, ringVertices: ReadonlySet<number>): boolean {
  const [pu, pv] = cover.uv[vertex]!;
  for (const [key, list] of cover.edges) {
    if (list.length !== 1) continue;
    const a = Math.floor(key / 0x200000);
    const b = key - a * 0x200000;
    if (!ringVertices.has(a) || !ringVertices.has(b)) continue;
    const [au, av] = cover.uv[a]!;
    const [bu, bv] = cover.uv[b]!;
    const du = bu - au, dv = bv - av;
    const lengthSquared = du * du + dv * dv;
    if (!(lengthSquared > 0)) continue;
    const t = ((pu - au) * du + (pv - av) * dv) / lengthSquared;
    if (!(t > 0 && t < 1)) continue;
    const offset = Math.abs((pu - au) * dv - (pv - av) * du) / Math.sqrt(lengthSquared);
    if (offset > 1e-12 * Math.sqrt(lengthSquared) + 1e-15) continue;
    const id = list[0]!;
    const forward = cover.rotated(id, a, b) ?? cover.rotated(id, b, a);
    if (!forward) return false;
    const [x, y, z] = forward;
    cover.removeTriangle(id);
    cover.addTriangle(x, vertex, z);
    cover.addTriangle(vertex, y, z);
    return true;
  }
  return false;
}

/**
 * Audit that the cover is exactly the region: every triangle is CCW, every
 * ring segment is used once in its own direction, every other edge twice in
 * opposite directions, and the areas agree.
 */
function auditCover(cover: Cover, expectedArea: number): Failure | null {
  let area = 0;
  for (const triangle of cover.triangles) {
    if (!triangle) continue;
    const twice = cover.twiceArea(...triangle);
    if (!(twice > 0)) return fail("triangulation-failed", "a triangle is degenerate or inverted in UV");
    area += twice / 2;
  }
  for (const [key, list] of cover.edges) {
    const isBoundary = cover.constraints.has(key);
    if (list.length !== (isBoundary ? 1 : 2)) {
      return fail("boundary-mismatch", `an edge is used by ${list.length} triangles`);
    }
  }
  for (const key of cover.constraints.keys()) {
    if (!cover.edges.has(key)) return fail("boundary-mismatch", "a trim segment is not a triangle edge");
  }
  if (Math.abs(area - expectedArea) > AREA_RELATIVE_TOLERANCE * Math.max(Math.abs(expectedArea), Number.MIN_VALUE)) {
    return fail("area-mismatch", `cover area ${area} differs from trim area ${expectedArea}`);
  }
  return null;
}

/** Directed ring segments must run along the triangles, not against them. */
function auditRingDirections(cover: Cover, rings: readonly number[][]): Failure | null {
  for (const ring of rings) {
    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index]!;
      const b = ring[(index + 1) % ring.length]!;
      const list = cover.edges.get(cover.key(a, b));
      if (!list || list.length !== 1 || !cover.rotated(list[0]!, a, b)) {
        return fail("boundary-mismatch", "a trim segment does not bound the cover on its inner side");
      }
    }
  }
  return null;
}

/**
 * The UVs a triangle's corners stand for: collapsed-side corners re-seated
 * toward the mean of the others. Null when two corners are one model point
 * on a collapsed side, which leaves a zero-area triangle that is dropped.
 */
function seatedCorners(
  cover: Cover,
  corners: readonly number[],
  collapseTolerance: number,
): (readonly [number, number])[] | null {
  const free = corners.filter((vertex) => !cover.collapsedAt.has(vertex));
  const pinned = corners.filter((vertex) => cover.collapsedAt.has(vertex));
  for (let i = 0; i < pinned.length; i += 1) {
    for (let j = i + 1; j < pinned.length; j += 1) {
      if (distance(cover.point[pinned[i]!]!, cover.point[pinned[j]!]!) <= collapseTolerance) return null;
    }
  }
  if (free.length === 0) {
    // Corners on different collapsed sides: seat each toward the other.
    const first = cover.uv[pinned[0]!]!;
    return corners.map((vertex, index) => index === 0 ? first : cover.reseat(vertex, first));
  }
  const toward: [number, number] = [0, 0];
  for (const vertex of free) {
    toward[0] += cover.uv[vertex]![0] / free.length;
    toward[1] += cover.uv[vertex]![1] / free.length;
  }
  return corners.map((vertex) => cover.reseat(vertex, toward));
}

function midpointDeviation(cover: Cover, a: number, b: number, collapseTolerance: number): number | null {
  const seated = seatedCorners(cover, [a, b], collapseTolerance);
  if (!seated) return 0;
  const [[au, av], [bu, bv]] = seated as [readonly [number, number], readonly [number, number]];
  const sample = cover.evaluate((au + bu) / 2, (av + bv) / 2);
  if (!sample) return null;
  const pa = cover.point[a]!;
  const pb = cover.point[b]!;
  return distance(sample.point, [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2]);
}

/**
 * How far the triangle's centroid strays from the surface. A triangle with a
 * collapsed side has no area and is dropped on output, so it strays nowhere.
 */
function centroidDeviation(
  cover: Cover,
  a: number,
  b: number,
  c: number,
  collapseTolerance: number,
): number | null {
  const seated = seatedCorners(cover, [a, b, c], collapseTolerance);
  if (!seated) return 0;
  const pa = cover.point[a]!;
  const pb = cover.point[b]!;
  const pc = cover.point[c]!;
  if (
    distance(pa, pb) <= collapseTolerance ||
    distance(pb, pc) <= collapseTolerance ||
    distance(pc, pa) <= collapseTolerance
  ) {
    return 0;
  }
  const sample = cover.evaluate(
    (seated[0]![0] + seated[1]![0] + seated[2]![0]) / 3,
    (seated[0]![1] + seated[1]![1] + seated[2]![1]) / 3,
  );
  if (!sample) return null;
  return distance(sample.point, [
    (pa[0] + pb[0] + pc[0]) / 3,
    (pa[1] + pb[1] + pc[1]) / 3,
    (pa[2] + pb[2] + pc[2]) / 3,
  ]);
}

/**
 * Longest-edge bisection of every triangle whose unconstrained edges or
 * centroid leave the surface by more than the tolerance, keeping the cover
 * Delaunay after each split.
 */
function refine(cover: Cover, tolerance: number, collapseTolerance: number): Failure | null {
  const queue: number[] = cover.triangles.map((_, index) => index);
  while (queue.length) {
    const id = queue.pop()!;
    const triangle = cover.triangles[id];
    if (!triangle) continue;
    const [a, b, c] = triangle;
    const pairs = [[a, b], [b, c], [c, a]] as const;
    let bad = false;
    for (const [x, y] of pairs) {
      if (cover.constraints.has(cover.key(x, y))) continue;
      const deviation = midpointDeviation(cover, x, y, collapseTolerance);
      if (deviation == null) return fail("surface-evaluation-failed", "an edge midpoint does not evaluate");
      if (deviation > tolerance) {
        bad = true;
        break;
      }
    }
    if (!bad) {
      const deviation = centroidDeviation(cover, a, b, c, collapseTolerance);
      if (deviation == null) return fail("surface-evaluation-failed", "a triangle centroid does not evaluate");
      bad = deviation > tolerance * CENTROID_TOLERANCE_FACTOR;
    }
    if (!bad) continue;
    let longest: readonly [number, number] | null = null;
    let longestLength = -1;
    for (const pair of pairs) {
      if (!cover.splittable(pair[0], pair[1])) continue;
      const length = cover.metricLength(pair[0], pair[1]);
      if (length > longestLength) {
        longest = pair;
        longestLength = length;
      }
    }
    let created: number[];
    let flipStack: [number, number][];
    if (longest) {
      const [x, y] = longest;
      const m = cover.addVertex([
        (cover.uv[x]![0] + cover.uv[y]![0]) / 2,
        (cover.uv[x]![1] + cover.uv[y]![1]) / 2,
      ]);
      if (m == null) return fail("refinement-limit", `more than ${cover.maxVertices} vertices`);
      cover.splitVertices += 1;
      created = cover.splitEdge(x, y, m);
      flipStack = created.flatMap((tid) => {
        const t = cover.triangles[tid]!;
        return [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]] as [number, number][];
      });
    } else {
      const m = cover.addVertex([(cover.uv[a]![0] + cover.uv[b]![0] + cover.uv[c]![0]) / 3, (cover.uv[a]![1] + cover.uv[b]![1] + cover.uv[c]![1]) / 3]);
      if (m == null) return fail("refinement-limit", `more than ${cover.maxVertices} vertices`);
      cover.splitVertices += 1;
      created = cover.splitTriangle(id, m);
      flipStack = [[a, b], [b, c], [c, a]];
    }
    const flipped = cover.legalize(flipStack, MAX_FLIPS_PER_VERTEX * cover.uv.length);
    if (!flipped) return fail("triangulation-failed", "Delaunay legalization did not converge");
    queue.push(...created, ...flipped);
  }
  return null;
}

/**
 * Cover one region with the ear clipper's triangles and prove the cover is
 * exactly the region. Regions share no vertices, so the audit runs over
 * everything covered so far against the running trim area.
 */
function coverRegion(
  cover: Cover,
  region: Revit2027TrimmedUvRegion,
  priorArea: number,
): { ok: true; area: number } | Failure {
  const linked = linkRegion(cover, region);
  if (linked.ok === false) return linked;
  const rings = linked.rings;
  const flat: number[] = rings.flat();
  const ringPoints = rings.map((ring) => ring.map((index) => [...cover.uv[index]!] as Point2));
  const local = triangulate(ringPoints[0]!, ringPoints.slice(1));
  if (local.length === 0 || local.length % 3 !== 0) {
    return fail("triangulation-failed", "ear clipping produced no triangles");
  }
  const used = new Set<number>();
  for (let index = 0; index < local.length; index += 3) {
    const a = flat[local[index]!]!;
    let b = flat[local[index + 1]!]!;
    let c = flat[local[index + 2]!]!;
    const twice = cover.twiceArea(a, b, c);
    if (twice === 0) return fail("triangulation-failed", "ear clipping produced a zero-area triangle");
    if (twice < 0) [b, c] = [c, b];
    cover.addTriangle(a, b, c);
    used.add(a).add(b).add(c);
  }
  const ringVertices = new Set(flat);
  for (const vertex of flat) {
    if (used.has(vertex)) continue;
    if (!restoreVertex(cover, vertex, ringVertices)) {
      return fail("boundary-vertex-lost", "a trim sample is not on the triangulated boundary");
    }
  }
  const area = priorArea + ringPoints.reduce((sum, ring) => sum + signedArea(ring), 0);
  const audited = auditCover(cover, area) ?? auditRingDirections(cover, rings);
  return audited ?? { ok: true, area };
}

type UvBox = { minimum: [number, number]; maximum: [number, number] };

/**
 * The fewest equal pieces an axis of the trim box needs before every piece's
 * chord, on five lines across the other axis, is within the tolerance.
 * Chord error falls as pieces are added, so a doubling search brackets the
 * count and a bisection finds it.
 */
function axisSegments(
  evaluate: Cover["evaluate"],
  box: UvBox,
  axis: 0 | 1,
  tolerance: number,
): number | null {
  const other = axis === 0 ? 1 : 0;
  const low = box.minimum[axis];
  const span = box.maximum[axis] - low;
  if (!(span > 0)) return 1;
  const at = (along: number, across: number): Revit2027Point3 | null => {
    const sample = axis === 0 ? evaluate(along, across) : evaluate(across, along);
    return sample ? sample.point : null;
  };
  const within = (segments: number): boolean | null => {
    for (let line = 0; line <= 4; line += 1) {
      const across = box.minimum[other] + ((box.maximum[other] - box.minimum[other]) * line) / 4;
      for (let piece = 0; piece < segments; piece += 1) {
        const a = low + (span * piece) / segments;
        const b = low + (span * (piece + 1)) / segments;
        const pa = at(a, across);
        const pb = at(b, across);
        const pm = at((a + b) / 2, across);
        if (!pa || !pb || !pm) return null;
        if (distance(pm, [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2]) > tolerance) {
          return false;
        }
      }
    }
    return true;
  };
  let passing = 1;
  let failing = 0;
  for (;;) {
    const ok = within(passing);
    if (ok == null) return null;
    if (ok) break;
    failing = passing;
    passing *= 2;
    if (passing > MAX_GRID_SEGMENTS) return MAX_GRID_SEGMENTS;
  }
  while (passing - failing > 1) {
    const middle = Math.floor((passing + failing) / 2);
    const ok = within(middle);
    if (ok == null) return null;
    if (ok) passing = middle;
    else failing = middle;
  }
  return passing;
}

/**
 * Grid lines along one axis: the trim's own sample values where they are at
 * least half a step apart, with any gap wider than a step split evenly. The
 * lines therefore pass through Revit's boundary samples wherever it wrote
 * them densely enough, which keeps the seeded triangles off slivers.
 */
function axisLines(
  values: readonly number[],
  low: number,
  high: number,
  segments: number,
): number[] {
  const step = (high - low) / segments;
  const kept = [low];
  for (const value of [...values].sort((left, right) => left - right)) {
    if (value - kept.at(-1)! >= step / 2 && high - value >= step / 2) kept.push(value);
  }
  kept.push(high);
  const lines = [low];
  for (let index = 1; index < kept.length; index += 1) {
    const gap = kept[index]! - kept[index - 1]!;
    const pieces = gap > step * GRID_GAP_SLACK ? Math.ceil(gap / step) : 1;
    for (let piece = 1; piece < pieces; piece += 1) {
      lines.push(kept[index - 1]! + (gap * piece) / pieces);
    }
    lines.push(kept[index]!);
  }
  return lines;
}

/** Orientation of p against the directed UV line a -> b, as a distance. */
function sideOf(
  cover: Cover,
  a: number,
  b: number,
  p: readonly [number, number],
): number {
  const [au, av] = cover.uv[a]!;
  const [bu, bv] = cover.uv[b]!;
  const length = Math.hypot(bu - au, bv - av);
  return length > 0 ? ((bu - au) * (p[1] - av) - (bv - av) * (p[0] - au)) / length : 0;
}

type Location =
  | { kind: "inside"; id: number }
  | { kind: "edge"; a: number; b: number }
  | { kind: "vertex" }
  | null;

function classifyIn(
  cover: Cover,
  id: number,
  p: readonly [number, number],
  epsilon: number,
): Location | "outside" {
  const [a, b, c] = cover.triangles[id]!;
  const sides = [sideOf(cover, a, b, p), sideOf(cover, b, c, p), sideOf(cover, c, a, p)];
  if (sides.some((side) => side < -epsilon)) return "outside";
  const onEdges = sides.map((side) => side <= epsilon);
  const count = onEdges.filter(Boolean).length;
  if (count >= 2) return { kind: "vertex" };
  if (count === 1) {
    const edge = onEdges.indexOf(true);
    const pair = [[a, b], [b, c], [c, a]][edge]!;
    return { kind: "edge", a: pair[0]!, b: pair[1]! };
  }
  return { kind: "inside", id };
}

/** Find the triangle, edge or vertex holding one UV point, or null outside. */
function locate(
  cover: Cover,
  p: readonly [number, number],
  hint: number,
  epsilon: number,
): Location {
  let id = cover.triangles[hint] ? hint : cover.triangles.findIndex(Boolean);
  // Walk toward the point; a boundary or a long walk falls back to a scan.
  for (let steps = 0; id >= 0 && steps < 4096; steps += 1) {
    const found = classifyIn(cover, id, p, epsilon);
    if (found !== "outside") return found;
    const [a, b, c] = cover.triangles[id]!;
    let next = -1;
    for (const [x, y] of [[a, b], [b, c], [c, a]] as const) {
      if (sideOf(cover, x, y, p) >= -epsilon) continue;
      const list = cover.edges.get(cover.key(x, y)) ?? [];
      next = list.find((other) => other !== id) ?? -1;
      break;
    }
    if (next < 0) break;
    id = next;
  }
  for (let scan = 0; scan < cover.triangles.length; scan += 1) {
    if (!cover.triangles[scan]) continue;
    const found = classifyIn(cover, scan, p, epsilon);
    if (found !== "outside") return found;
  }
  return null;
}

/** Chart distance from a UV point to the nearest trim segment. */
function boundaryDistance(
  cover: Cover,
  p: readonly [number, number],
): number {
  const [pu, pv] = [p[0] * cover.scale[0], p[1] * cover.scale[1]];
  let nearest = Infinity;
  for (const key of cover.constraints.keys()) {
    const a = Math.floor(key / 0x200000);
    const [au, av] = cover.metric(a);
    const [bu, bv] = cover.metric(key - a * 0x200000);
    const du = bu - au;
    const dv = bv - av;
    const lengthSquared = du * du + dv * dv;
    const t = lengthSquared > 0
      ? Math.min(1, Math.max(0, ((pu - au) * du + (pv - av) * dv) / lengthSquared))
      : 0;
    nearest = Math.min(nearest, Math.hypot(pu - (au + du * t), pv - (av + dv * t)));
  }
  return nearest;
}

/**
 * Seed the cover with grid vertices before refinement.
 *
 * Collapsed sides are split where the grid lines cross them, so a revolved
 * pole or a cone apex gets one copy of its single model point per column and
 * each column fans to its own copy. Interior grid points are added where
 * they are clear of the trim by a third of a cell. Every trim sample stays a
 * vertex and no persisted trim segment is touched.
 */
function seedGrid(
  cover: Cover,
  tolerance: number,
): Failure | null {
  const box: UvBox = {
    minimum: [Infinity, Infinity],
    maximum: [-Infinity, -Infinity],
  };
  const ringVertexCount = cover.uv.length;
  for (let vertex = 0; vertex < ringVertexCount; vertex += 1) {
    const [u, v] = cover.uv[vertex]!;
    box.minimum = [Math.min(box.minimum[0], u), Math.min(box.minimum[1], v)];
    box.maximum = [Math.max(box.maximum[0], u), Math.max(box.maximum[1], v)];
  }
  // A cell's diagonal bows about twice as far as its sides, so the grid is
  // sized for half the tolerance and the diagonals pass too. The 2025 RAC
  // sample's hemisphere faces seed 26 by 26 on their own trim samples and
  // need no refinement; sized for the full tolerance, refinement tripled
  // their vertices.
  const uSegments = axisSegments(cover.evaluate, box, 0, tolerance / 2);
  const vSegments = axisSegments(cover.evaluate, box, 1, tolerance / 2);
  if (uSegments == null || vSegments == null) {
    return fail("surface-evaluation-failed", "the trim box does not evaluate");
  }
  const us = axisLines(cover.uv.map((uv) => uv[0]), box.minimum[0], box.maximum[0], uSegments);
  const vs = axisLines(cover.uv.map((uv) => uv[1]), box.minimum[1], box.maximum[1], vSegments);
  if (us.length * vs.length > cover.maxVertices) {
    return fail("refinement-limit", `a ${us.length} by ${vs.length} seed grid`);
  }
  const epsilon = 1e-10 * Math.max(
    box.maximum[0] - box.minimum[0],
    box.maximum[1] - box.minimum[1],
    Number.MIN_VALUE,
  );

  for (const [key, collapsed] of [...cover.constraints]) {
    if (!collapsed) continue;
    const a = Math.floor(key / 0x200000);
    const b = key - a * 0x200000;
    const [au, av] = cover.uv[a]!;
    const [bu, bv] = cover.uv[b]!;
    const cuts: number[] = [];
    for (const [lines, from, to] of [[us, au, bu], [vs, av, bv]] as const) {
      if (Math.abs(to - from) <= epsilon) continue;
      for (const line of lines) {
        const t = (line - from) / (to - from);
        if (t > 1e-9 && t < 1 - 1e-9) cuts.push(t);
      }
    }
    cuts.sort((left, right) => left - right);
    let start = a;
    let last = 0;
    for (const t of cuts) {
      if (t - last <= 1e-9) continue;
      const m = cover.addVertex([au + (bu - au) * t, av + (bv - av) * t]);
      if (m == null) return fail("refinement-limit", `more than ${cover.maxVertices} vertices`);
      cover.splitEdge(start, b, m);
      start = m;
      last = t;
    }
  }

  const clearance = Math.min(
    ((box.maximum[0] - box.minimum[0]) / uSegments) * cover.scale[0],
    ((box.maximum[1] - box.minimum[1]) / vSegments) * cover.scale[1],
  ) / 3;
  let hint = 0;
  for (let row = 1; row + 1 < vs.length; row += 1) {
    for (let column = 1; column + 1 < us.length; column += 1) {
      const p = [us[column]!, vs[row]!] as const;
      if (boundaryDistance(cover, p) < clearance) continue;
      const location = locate(cover, p, hint, epsilon);
      if (!location || location.kind === "vertex") continue;
      if (location.kind === "edge" && cover.constraints.has(cover.key(location.a, location.b))) continue;
      const m = cover.addVertex(p);
      if (m == null) return fail("refinement-limit", `more than ${cover.maxVertices} vertices`);
      const created = location.kind === "edge"
        ? cover.splitEdge(location.a, location.b, m)
        : cover.splitTriangle(location.id, m);
      const stack = created.flatMap((id) => {
        const t = cover.triangles[id]!;
        return [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]] as [number, number][];
      });
      const flipped = cover.legalize(stack, MAX_FLIPS_PER_VERTEX * cover.uv.length);
      if (!flipped) return fail("triangulation-failed", "Delaunay legalization did not converge");
      hint = flipped.at(-1) ?? created.at(-1) ?? hint;
    }
  }
  return null;
}

/**
 * Triangulate every region of one trimmed surface face, refine it to the
 * chord tolerance, orient it by the persisted surface sense and certify it.
 */
export function meshRevit2027TrimmedUvRegions(
  request: Revit2027TrimmedUvMeshRequest,
): Revit2027TrimmedUvMeshResult {
  const { chordTolerance, collapseTolerance, metricScale, maxVertices } = request;
  if (
    request.regions.length === 0 ||
    !(chordTolerance > 0) ||
    !(collapseTolerance > 0) ||
    !metricScale.every((scale) => Number.isFinite(scale) && scale > 0) ||
    !Number.isSafeInteger(maxVertices) ||
    maxVertices < 3 ||
    maxVertices >= 0x200000
  ) {
    return fail("invalid-request", "trimmed UV mesh request is out of range");
  }
  for (const region of request.regions) {
    for (const ring of [region.outer, ...region.holes]) {
      if (
        ring.points.length < 3 ||
        ring.collapsed.length !== ring.points.length ||
        !ring.points.every((point) => point.every(Number.isFinite))
      ) {
        return fail("invalid-request", "a trim ring has fewer than three finite points");
      }
      // A persisted trim segment is never split, so a triangle standing on
      // it can come no closer to the surface than the segment itself does.
      for (let index = 0; index < ring.points.length; index += 1) {
        if (ring.collapsed[index]) continue;
        const a = ring.points[index]!;
        const b = ring.points[(index + 1) % ring.points.length]!;
        const pa = request.evaluate(a[0], a[1]);
        const pb = request.evaluate(b[0], b[1]);
        const pm = request.evaluate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        if (!pa || !pb || !pm) {
          return fail("surface-evaluation-failed", "a trim segment does not evaluate");
        }
        const bulge = distance(pm.point, [
          (pa.point[0] + pb.point[0]) / 2,
          (pa.point[1] + pb.point[1]) / 2,
          (pa.point[2] + pb.point[2]) / 2,
        ]);
        if (bulge > chordTolerance) {
          return fail("invalid-request", "a trim segment bows further than the chord tolerance");
        }
      }
    }
  }
  const cover = new Cover(request.evaluate, metricScale, maxVertices);
  const ringVertexCount = request.regions.reduce(
    (sum, region) => sum + [region.outer, ...region.holes].reduce((count, ring) => count + ring.points.length, 0),
    0,
  );
  let coveredArea = 0;
  for (const region of request.regions) {
    const covered = coverRegion(cover, region, coveredArea);
    if (covered.ok === false) return covered;
    coveredArea = covered.area;
  }
  const seeded = seedGrid(cover, chordTolerance);
  if (seeded) return seeded;
  const unconstrained: [number, number][] = [];
  for (const key of cover.edges.keys()) {
    if (cover.constraints.has(key)) continue;
    const a = Math.floor(key / 0x200000);
    unconstrained.push([a, key - a * 0x200000]);
  }
  if (!cover.legalize(unconstrained, MAX_FLIPS_PER_VERTEX * cover.uv.length)) {
    return fail("triangulation-failed", "Delaunay legalization did not converge");
  }
  const refined = refine(cover, chordTolerance, collapseTolerance);
  if (refined) return refined;
  // Seeding and refinement only split triangles and flip interior edges;
  // the cover must still be exactly the trimmed regions.
  const audited = auditCover(cover, coveredArea);
  if (audited) return audited;

  // Orient by the surface sense and drop the zero-area triangles a collapsed
  // side leaves behind; every other triangle must face the surface normal.
  const sign = request.orientFlag ? 1 : -1;
  const normalAt = (u: number, v: number): Revit2027Point3 | null => {
    const sample = request.evaluate(u, v);
    if (!sample) return null;
    const n = cross(sample.tangentU, sample.tangentV);
    const length = Math.hypot(...n);
    return length > Number.EPSILON ? [sign * n[0] / length, sign * n[1] / length, sign * n[2] / length] : null;
  };
  const indices: number[] = [];
  const accumulated = cover.point.map((): [number, number, number] => [0, 0, 0]);
  let collapsedTriangleCount = 0;
  for (const triangle of cover.triangles) {
    if (!triangle) continue;
    const [a, b, c] = request.orientFlag ? triangle : [triangle[0], triangle[2], triangle[1]] as const;
    const pa = cover.point[a]!;
    const pb = cover.point[b]!;
    const pc = cover.point[c]!;
    if (
      distance(pa, pb) <= collapseTolerance ||
      distance(pb, pc) <= collapseTolerance ||
      distance(pc, pa) <= collapseTolerance
    ) {
      collapsedTriangleCount += 1;
      continue;
    }
    const geometric = cross(subtract(pb, pa), subtract(pc, pa));
    const seated = seatedCorners(cover, [a, b, c], collapseTolerance);
    if (!seated) {
      collapsedTriangleCount += 1;
      continue;
    }
    const expected = normalAt(
      (seated[0]![0] + seated[1]![0] + seated[2]![0]) / 3,
      (seated[0]![1] + seated[1]![1] + seated[2]![1]) / 3,
    );
    if (expected && dot(geometric, expected) <= 0) {
      return fail("orientation-mismatch", "a triangle faces away from the oriented surface normal");
    }
    for (const vertex of [a, b, c]) {
      const sum = accumulated[vertex]!;
      sum[0] += geometric[0];
      sum[1] += geometric[1];
      sum[2] += geometric[2];
    }
    indices.push(a, b, c);
  }
  if (indices.length === 0) return fail("triangulation-failed", "every triangle collapsed");

  // Compact to the vertices the kept triangles use.
  const remap = new Int32Array(cover.uv.length).fill(-1);
  const order: number[] = [];
  for (const vertex of indices) {
    if (remap[vertex] === -1) {
      remap[vertex] = order.length;
      order.push(vertex);
    }
  }
  const positions = new Float64Array(order.length * 3);
  const normals = new Float32Array(order.length * 3);
  const uvs = new Float64Array(order.length * 2);
  for (let index = 0; index < order.length; index += 1) {
    const vertex = order[index]!;
    const [u, v] = cover.uv[vertex]!;
    positions.set(cover.point[vertex]!, index * 3);
    uvs.set([u, v], index * 2);
    let normal = normalAt(u, v);
    if (!normal) {
      // A collapsed side has no surface normal; use its fan's facet normals.
      const sum = accumulated[vertex]!;
      const length = Math.hypot(...sum);
      if (!(length > 0)) return fail("orientation-mismatch", "a collapsed-side vertex has no facet normal");
      normal = [sum[0] / length, sum[1] / length, sum[2] / length];
    }
    normals.set(normal, index * 3);
  }
  return {
    ok: true,
    mesh: {
      positions,
      normals,
      indices: Uint32Array.from(indices, (vertex) => remap[vertex]!),
      uvs,
      boundaryVertexCount: ringVertexCount,
      collapsedTriangleCount,
      refinementVertexCount: cover.splitVertices,
    },
  };
}
