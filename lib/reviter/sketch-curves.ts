/**
 * Sketch boundary curves — the loops that define floors, slabs, roofs and ramps.
 *
 * A slab is not a box and it is not a set of planes. Revit models it as a
 * *sketch*: a closed loop of lines and arcs, extruded by the slab's thickness.
 * That loop is written out one edge at a time, each edge as its own record:
 *
 * ```text
 * 04 00 08 01                              record signature
 * +4    f64 tMin, tMax                     parameter range
 * line
 * +20   f64 origin (3)                     p(t) = origin + t · dir
 * +44   f64 dir (3)                        unit
 * arc
 * +20   f64 xDir (3)                       unit
 * +44   f64 yDir (3)                       unit, perpendicular to xDir
 * +68   f64 radius
 * +76   f64 centre (3)                     p(t) = centre + r·(cos t · xDir + sin t · yDir)
 * ```
 *
 * The two shapes share a signature and are told apart by their contents: an arc
 * has *two* unit vectors at right angles followed by a positive radius, where a
 * line has a model-coordinate origin followed by one unit vector. Testing for
 * the arc first matters — a line's `origin` almost never reads as a unit vector,
 * so the check is safe in the direction it is applied.
 *
 * **Ownership** uses the same `ff ff ff ff 10 03 01 00 00 00 [u64 id]` anchor as
 * surfaces and parameters, with one addition: a slab's edges are usually filed
 * under the *Sketch* element that Revit creates alongside it, whose id is the
 * slab's id minus one. Taking the union of both recovers loops that either rule
 * alone misses.
 *
 * **Ring order is not storage order.** Chaining the edges in the order they
 * appear closes a ring only 43.9% of the time; the records are a face/edge set,
 * not a sequence. Edges are therefore joined *geometrically*, endpoint to
 * endpoint within 1e-4 ft. Each edge is also stored twice — once per adjoining
 * face, in opposite directions — so an unordered endpoint-pair key deduplicates
 * before chaining, otherwise every ring collapses to a two-edge stub. The key
 * is taken over *welded* endpoints, at the same 1e-4 ft the chaining joins at,
 * so the two cannot disagree about which edges are the same edge.
 *
 * **Nor is the edge set always a clean cycle.** A sketch carries spurs,
 * T-junctions and edges shared with a neighbour, and at those vertices the walk
 * has a choice to make with no local way to make it correctly. It therefore
 * tries the candidates in turn and gives back what a dead end consumed, so one
 * wrong turn costs a few steps rather than the element's whole boundary.
 *
 * **Verification against the paired IFC export.** Over the 97 slab, covering and
 * ramp elements whose IFC profile is a horizontal loop, a recovered ring
 * reproduces the IFC vertex sequence exactly — same vertices, same cyclic order,
 * to 1e-4 ft — for **84**, with 2 more equal in area and vertex set: 88.7%
 * against 0.0–2.1% when the pairing between element and truth is shuffled. Over
 * the whole model, 155 of the 172 slab, covering, roof and ramp elements yield
 * at least one closed ring — 266 rings, 4,262 corners.
 *
 * The comparison is made on ring *corners*, because the IFC profile stores an
 * arc as its endpoints too. Tessellated arc points are added for display only,
 * and `assembleRings` can be asked for the bare corners instead.
 */

import { noteLimit } from "./limit-census.ts";

/** `04 00 08 01` — the edge-record signature. */
const CURVE_SIGNATURE = [0x04, 0x00, 0x08, 0x01] as const;

/** `ff ff ff ff 10 03 01 00 00 00` — the single-element owner anchor. */
const OWNER_ANCHOR = [0xff, 0xff, 0xff, 0xff, 0x10, 0x03, 0x01, 0x00, 0x00, 0x00] as const;

/**
 * A line needs eight f64 fields after the signature, an arc twelve. Records sit
 * at an 84-byte stride, so a decoded record cannot be stepped over wholesale;
 * the scan advances past the signature only.
 */
const LINE_BYTES = 4 + 8 * 8;
const ARC_BYTES = 4 + 12 * 8;

/** Model coordinates in feet stay well inside this bound. */
const MAX_COORDINATE = 1e5;

/** Unit-vector and perpendicularity tolerances, as the file writes them. */
const UNIT_TOLERANCE = 1e-12;
const PERPENDICULAR_TOLERANCE = 1e-9;

/** Endpoints are joined at this distance, in feet. */
const JOIN_TOLERANCE = 1e-4;

/** Arcs are tessellated no finer than this, in radians. */
const ARC_STEP = Math.PI / 16;

/** A ring needs at least this many distinct vertices to bound an area. */
const MIN_RING_VERTICES = 3;

/** Guard against a pathological blob turning ring assembly quadratic. */
const MAX_CURVES_PER_ELEMENT = 4_000;

export type Point3 = [number, number, number];

export type SketchCurve = {
  offset: number;
  /** Element whose blob the edge was found in. */
  owner: number;
  kind: "line" | "arc";
  start: Point3;
  end: Point3;
  /** Points between `start` and `end` for an arc; empty for a line. */
  interior: Point3[];
};

function coordinateLike(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  // Only a finite value that overshoots is worth reporting. A NaN or an
  // infinity here is a byte pattern that is not a coordinate at all, which is
  // this predicate working, not a limit binding — counting those would bury the
  // signal under the scan's ordinary rejections.
  if (Math.abs(value) > MAX_COORDINATE) {
    noteLimit("max-coordinate");
    return false;
  }
  return true;
}

function isUnit(x: number, y: number, z: number): boolean {
  return Math.abs(x * x + y * y + z * z - 1) <= UNIT_TOLERANCE;
}

function matchesAt(data: Uint8Array, offset: number, pattern: readonly number[]): boolean {
  for (let index = 0; index < pattern.length; index += 1) {
    if (data[offset + index] !== pattern[index]) return false;
  }
  return true;
}

/** Decode one edge record, or `null` when the signature was a coincidence. */
function readCurve(view: DataView, offset: number, byteLength: number): SketchCurve | null {
  if (offset + LINE_BYTES > byteLength) return null;
  const field = (index: number) => view.getFloat64(offset + 4 + index * 8, true);

  const tMin = field(0);
  const tMax = field(1);
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMax <= tMin) return null;
  if (Math.abs(tMin) > MAX_COORDINATE || Math.abs(tMax) > MAX_COORDINATE) return null;

  const ax = field(2);
  const ay = field(3);
  const az = field(4);
  const bx = field(5);
  const by = field(6);
  const bz = field(7);
  if (![ax, ay, az, bx, by, bz].every(Number.isFinite)) return null;
  if (!isUnit(bx, by, bz)) return null;

  // An arc: two orthonormal in-plane axes, a positive radius, a real centre.
  if (
    offset + ARC_BYTES <= byteLength &&
    isUnit(ax, ay, az) &&
    Math.abs(ax * bx + ay * by + az * bz) <= PERPENDICULAR_TOLERANCE
  ) {
    const radius = field(8);
    const cx = field(9);
    const cy = field(10);
    const cz = field(11);
    if (
      Number.isFinite(radius) &&
      radius > 1e-9 &&
      radius <= MAX_COORDINATE &&
      [cx, cy, cz].every(coordinateLike)
    ) {
      const at = (t: number): Point3 => [
        cx + radius * (Math.cos(t) * ax + Math.sin(t) * bx),
        cy + radius * (Math.cos(t) * ay + Math.sin(t) * by),
        cz + radius * (Math.cos(t) * az + Math.sin(t) * bz),
      ];
      const steps = Math.max(1, Math.ceil((tMax - tMin) / ARC_STEP));
      const interior: Point3[] = [];
      for (let step = 1; step < steps; step += 1) {
        interior.push(at(tMin + ((tMax - tMin) * step) / steps));
      }
      return { offset, owner: 0, kind: "arc", start: at(tMin), end: at(tMax), interior };
    }
  }

  // A line: a model-coordinate origin and one unit direction.
  if (![ax, ay, az].every(coordinateLike)) return null;
  return {
    offset,
    owner: 0,
    kind: "line",
    start: [ax + tMin * bx, ay + tMin * by, az + tMin * bz],
    end: [ax + tMax * bx, ay + tMax * by, az + tMax * bz],
    interior: [],
  };
}

/**
 * Decode every sketch edge in one inflated page and attribute each to the
 * element whose blob it sits in, in a single pass.
 */
export function collectSketchCurves(data: Uint8Array): SketchCurve[] {
  const curves: SketchCurve[] = [];
  if (data.byteLength < LINE_BYTES) return curves;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Records sit at an 84-byte stride while an arc spans 100, so signatures
  // overlap and the scan cannot step over a decoded record. Both passes are
  // driven by `indexOf`, which is a native byte search — a hand-written loop
  // over every byte of a 384 MB inflation costs more than the decode does.
  const anchorOffsets: number[] = [];
  const anchorOwners: number[] = [];
  for (
    let offset = data.indexOf(OWNER_ANCHOR[0]);
    offset >= 0 && offset + OWNER_ANCHOR.length + 8 <= data.byteLength;
    offset = data.indexOf(OWNER_ANCHOR[0], offset + 1)
  ) {
    if (!matchesAt(data, offset, OWNER_ANCHOR)) continue;
    if (view.getUint32(offset + 14, true) !== 0) continue;
    const owner = view.getUint32(offset + 10, true);
    if (!owner) continue;
    anchorOffsets.push(offset);
    anchorOwners.push(owner);
    offset += OWNER_ANCHOR.length - 1;
  }

  let anchor = 0;
  for (
    let offset = data.indexOf(CURVE_SIGNATURE[0]);
    offset >= 0 && offset + LINE_BYTES <= data.byteLength;
    offset = data.indexOf(CURVE_SIGNATURE[0], offset + 1)
  ) {
    if (!matchesAt(data, offset, CURVE_SIGNATURE)) continue;
    const curve = readCurve(view, offset, data.byteLength);
    if (!curve) continue;
    while (anchor < anchorOffsets.length && anchorOffsets[anchor]! < offset) anchor += 1;
    // The owning blob is the one introduced most recently before this edge.
    if (anchor === 0) continue;
    curves.push({ ...curve, owner: anchorOwners[anchor - 1]! });
  }
  return curves;
}

function distance(a: Point3, b: Point3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** A point's own grid cell first, then the 26 that can hold a nearer vertex. */
const CELL_NEIGHBOURHOOD = [0, -1, 1].flatMap((dx) =>
  [0, -1, 1].flatMap((dy) => [0, -1, 1].map((dz) => [dx, dy, dz] as const)),
);

/**
 * Weld endpoints the join tolerance calls the same point onto one vertex.
 *
 * The duplicate key and the chaining have to agree about what "the same point"
 * means, or an edge the walk would treat as a repeat of another survives dedup
 * and gets walked as if it were a second way round. Rounding to a grid does not
 * give that agreement: `Math.round` puts 0.99995 and 1.00005 in different
 * buckets though they are 1e-4 ft apart, so *any* bucket key, at any scale,
 * still splits some pair the walk joins — the split just moves. The grid is
 * therefore used only to *find* candidates, and the tolerance itself decides:
 * a point is compared against the canonical vertices in its own cell and the 26
 * around it, and takes the first one within `JOIN_TOLERANCE`.
 *
 * With the cell side set to the tolerance no candidate can be more than one
 * cell away, and canonical vertices are pairwise at least a tolerance apart, so
 * a cell holds a bounded few. Each weld is O(1) and the whole set is O(n).
 *
 * Welding decides identity only. Rings are still emitted from the curves' own
 * coordinates, so no vertex moves.
 */
function vertexWelder(): (point: Point3) => number {
  const cells = new Map<string, number[]>();
  const canonical: Point3[] = [];
  return (point) => {
    const cx = Math.floor(point[0] / JOIN_TOLERANCE);
    const cy = Math.floor(point[1] / JOIN_TOLERANCE);
    const cz = Math.floor(point[2] / JOIN_TOLERANCE);
    for (const [dx, dy, dz] of CELL_NEIGHBOURHOOD) {
      const bucket = cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
      if (!bucket) continue;
      for (const index of bucket) {
        if (distance(canonical[index]!, point) < JOIN_TOLERANCE) return index;
      }
    }
    const index = canonical.length;
    canonical.push(point);
    const key = `${cx},${cy},${cz}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(index);
    else cells.set(key, [index]);
    return index;
  };
}

/** Order-independent key for an edge, over the vertices its ends welded to. */
function edgeKey(start: number, end: number): string {
  return start <= end ? `${start}|${end}` : `${end}|${start}`;
}

/** Signed area of a ring's horizontal projection, used to rank outer vs inner. */
function ringArea(vertices: Point3[]): number {
  let twice = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const p = vertices[index]!;
    const q = vertices[(index + 1) % vertices.length]!;
    twice += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(twice) / 2;
}

function dropRepeats(vertices: Point3[]): Point3[] {
  const out: Point3[] = [];
  for (const vertex of vertices) {
    if (out.length && distance(out[out.length - 1]!, vertex) < JOIN_TOLERANCE) continue;
    out.push(vertex);
  }
  while (out.length > 1 && distance(out[0]!, out[out.length - 1]!) < JOIN_TOLERANCE) out.pop();
  return out;
}

/**
 * Dead-end recovery is bounded rather than exhaustive.
 *
 * Giving edges back at a dead end and trying the next candidate is a
 * depth-first search over the edge set, and depth-first search over a
 * non-manifold blob can be exponential. The bound is on the *total* number of
 * edges stepped onto a path across one call: a step is either kept in a ring,
 * and kept edges are never given back, or it is eventually undone, so capping
 * steps caps the whole assembly at O(n·k) — k being how many edges meet at a
 * vertex, since candidates come from an adjacency list rather than a rescan.
 *
 * Sixteen steps per edge is far more than the shapes this exists for need: a
 * clean sketch spends one per edge, a spur or a T-junction a handful more. An
 * edge set that exhausts it is the pathological blob `MAX_CURVES_PER_ELEMENT`
 * is already there to give up on.
 */
const MAX_WALK_STEPS_PER_CURVE = 16;

/**
 * Join a set of edges into closed rings, endpoint to endpoint. Duplicated edges
 * are removed first; rings are returned largest-area first, so the outer
 * boundary leads and openings follow.
 *
 * **A wrong turn is taken back.** Where edges meet three or more at a vertex —
 * a spur left in the sketch, a T-junction, an edge shared with a neighbouring
 * region — walking on is a guess, and the first guess is only sometimes right.
 * A walk that could not undo one lost the whole boundary to it, and lost the
 * edges too, so a later seed could not recover either: the element then fell
 * back to its bounding box with nothing said. Candidates are therefore tried in
 * turn, a dead end releases the edges it consumed, and a walk that runs out of
 * candidates leaves the set exactly as it found it.
 *
 * The first candidate at each vertex is still the lowest-numbered one, so an
 * edge set that assembled before assembles the same way, by the same path;
 * search only begins where the walk used to stop.
 */
export function assembleRings(
  curves: SketchCurve[],
  { tessellateArcs = true }: { tessellateArcs?: boolean } = {},
): Point3[][] {
  const unique: SketchCurve[] = [];
  /** Welded endpoint vertices per accepted edge, parallel to `unique`. */
  const endpoints: [number, number][] = [];
  /** Vertex to the edges meeting there, in ascending edge order. */
  const incident: number[][] = [];
  const weld = vertexWelder();
  const seen = new Set<string>();

  for (const curve of curves) {
    if (unique.length >= MAX_CURVES_PER_ELEMENT) {
      noteLimit("max-curves-per-element");
      break;
    }
    if (distance(curve.start, curve.end) < JOIN_TOLERANCE) continue;
    const start = weld(curve.start);
    const end = weld(curve.end);
    // Welded shut: both ends are the same vertex, so there is nothing to chain.
    if (start === end) continue;
    const key = edgeKey(start, end);
    if (seen.has(key)) continue;
    seen.add(key);
    const edge = unique.length;
    unique.push(curve);
    endpoints.push([start, end]);
    for (const vertex of [start, end]) (incident[vertex] ??= []).push(edge);
  }

  /** One edge on the path, and how far its far end's candidates were tried. */
  type Step = {
    edge: number;
    reversed: boolean;
    /** The vertex this step arrives at. */
    vertex: number;
    candidates: number[];
    next: number;
  };

  const stepFor = (edge: number, reversed: boolean, vertex: number): Step => ({
    edge,
    reversed,
    vertex,
    candidates: incident[vertex] ?? [],
    next: 0,
  });

  // The seed is always walked forwards, which loses nothing: a cycle can be
  // traversed in the direction any of its edges points.
  const ringVertices = (path: Step[]): Point3[] => {
    const vertices: Point3[] = [];
    let cursor: Point3 | null = null;
    for (const { edge, reversed } of path) {
      const curve = unique[edge]!;
      vertices.push(cursor ?? (reversed ? curve.end : curve.start));
      if (tessellateArcs) {
        for (const point of reversed ? [...curve.interior].reverse() : curve.interior) {
          vertices.push(point);
        }
      }
      cursor = reversed ? curve.start : curve.end;
    }
    return vertices;
  };

  const used = new Array<boolean>(unique.length).fill(false);
  const rings: Point3[][] = [];
  let stepsLeft = unique.length * MAX_WALK_STEPS_PER_CURVE + 64;

  for (let seed = 0; seed < unique.length; seed += 1) {
    if (used[seed]) continue;
    if (stepsLeft <= 0) break;
    const [origin, ahead] = endpoints[seed]!;
    used[seed] = true;
    stepsLeft -= 1;
    const path: Step[] = [stepFor(seed, false, ahead)];
    let ring: Point3[] | null = null;

    while (path.length) {
      const step = path[path.length - 1]!;
      // Closure is judged on the vertices the path would yield, not on how many
      // edges it took: two arcs can bound a circle, and a pair of edges between
      // the same two points bounds nothing however it arrived.
      if (step.next === 0 && step.vertex === origin) {
        const closed = dropRepeats(ringVertices(path));
        if (closed.length >= MIN_RING_VERTICES) {
          ring = closed;
          break;
        }
      }
      let advanced = false;
      while (step.next < step.candidates.length && stepsLeft > 0) {
        const edge = step.candidates[step.next]!;
        step.next += 1;
        if (used[edge]) continue;
        const [from, to] = endpoints[edge]!;
        const reversed = from !== step.vertex;
        used[edge] = true;
        stepsLeft -= 1;
        path.push(stepFor(edge, reversed, reversed ? from : to));
        advanced = true;
        break;
      }
      if (advanced) continue;
      // Nothing left to try here. Give the edge back and reconsider the vertex
      // before it; emptying the path releases the seed too.
      used[step.edge] = false;
      path.pop();
    }

    if (ring) rings.push(ring);
  }

  rings.sort((a, b) => ringArea(b) - ringArea(a));
  return rings;
}

/**
 * Boundary loops for one element. Edges filed under the element itself and
 * under its companion Sketch element — `elementId - 1` — are taken together.
 */
export function boundaryLoopsFor(
  elementId: number,
  curvesByOwner: Map<number, SketchCurve[]>,
  options: { tessellateArcs?: boolean } = {},
): Point3[][] {
  const curves = [
    ...(curvesByOwner.get(elementId) ?? []),
    ...(curvesByOwner.get(elementId - 1) ?? []),
  ];
  if (!curves.length) return [];
  return assembleRings(curves, options);
}

/** An axis-aligned box in model feet. Structurally `Bounds3`, declared here so
 * this module keeps no import from `types.ts`, which imports `Point3` from it. */
export type CurveBounds = {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
};

/**
 * The box over the curves filed under an element's own id.
 *
 * `prismGeometry` extrudes a ring's plan between the record's own elevations, so
 * a ring alone is not a shape — and a **stair run's ring is flat**: all 12 of the
 * runs measured close into one four-corner ring with a z span of 0.000 ft, the
 * run's plan boundary at its own base. The rise is in the same curve set, in the
 * tread and riser edges the ring did not consume, and that set's z band reproduces
 * the export's to a median 0.164 ft.
 *
 * This is only ever asked for an element whose alternative is a hull over its
 * attributed facets, which is not a second reading of the element but one plane's
 * trim rectangle. Over every drawn record that owns curves the same box is 2.9%
 * accurate against the drawn geometry's 98%, so it is not a general route and is
 * not offered as one.
 *
 * **Own id only, unlike `boundaryLoopsFor`.** Adding the `id - 1` Sketch
 * companion's curves the way ring assembly does widens the band across a
 * neighbouring run — 1500325 reads 14.4–19.8 ft from its own curves, which is the
 * export's 14.4–19.7 to a tenth of a foot, and 0.0–24.3 ft with the union. Ring
 * assembly is unharmed by the extra edges because it joins them geometrically; a
 * hull is not, because it takes their extremes.
 */
export function sketchCurveBounds(
  elementId: number,
  curvesByOwner: Map<number, SketchCurve[]>,
): CurveBounds | null {
  const curves = curvesByOwner.get(elementId);
  if (!curves?.length) return null;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const curve of curves) {
    for (const [x, y, z] of [curve.start, curve.end, ...curve.interior]) {
      min.x = Math.min(min.x, x);
      min.y = Math.min(min.y, y);
      min.z = Math.min(min.z, z);
      max.x = Math.max(max.x, x);
      max.y = Math.max(max.y, y);
      max.z = Math.max(max.z, z);
    }
  }
  return { min, max };
}

/**
 * Do two elevation bands describe the same element, or two floors of a building?
 *
 * A sketch's curves are attributed by the same anchor everything else is, and the
 * failure mode is the one the railing sweep hit: **identical elements stack floor
 * on floor**, so a neighbour's curve set matches in plan and is a storey out in z.
 * Eleven ceilings and a floor in this model own a curve set 3.3–15.4 ft below
 * their own record — all of them already drawn correctly from that record — and
 * taking the curves' box moved them by exactly that much.
 *
 * A facet the element genuinely owns lies *in* the element, so its band and the
 * curves' band cannot be disjoint. That separates the two populations outright:
 * the 12 stair runs overlap by 0.00–8.95 ft and the 12 stacked twins by
 * **−3.28, −5.91 and −15.42 ft**. Any permitted gap from 0 to 3.2 ft selects the
 * same 12 and rejects the same 12, so the boundary is a plateau rather than a fit,
 * and it is set at zero — two readings of one element touch at worst.
 */
export function bandsMeet(a: CurveBounds, b: CurveBounds): boolean {
  return Math.min(a.max.z, b.max.z) >= Math.max(a.min.z, b.min.z);
}
