/**
 * Triangulate a plane region bounded by directed segments, by constrained
 * Delaunay insertion rather than ear clipping.
 *
 * Ear clipping walks one linked ring, so it has to guess where a boundary
 * touches itself, and it guesses badly when samples line up exactly: two hole
 * bottoms on one parameter line, a face split in two by an opening but kept
 * as one loop joined by a zero-width strip along its top. Insertion does not
 * walk the boundary at all. Every point goes into a Delaunay triangulation of
 * a box around them, every boundary segment is then forced to be an edge by
 * flipping the edges that cross it, and the triangles inside are the ones an
 * odd number of boundary segments away from the box.
 *
 * Before that the boundary is put in normal form. A segment another boundary
 * point lies on is split there, and a segment walked once each way (the
 * zero-width strip) bounds nothing and is dropped. A segment walked twice the
 * same way, a point where segments cross, a point on another point, or a
 * boundary that does not close fails, since the region is then not a region.
 *
 * Coordinates are taken as given; a point is on a segment or another point
 * only within 1e-12 of the points' extent.
 */

export type RegionPoint = readonly [number, number];

/** Directed boundary segment `[from, to]`, the region on its left. */
export type RegionSegment = readonly [number, number];

export type ConstrainedRegionTriangulation =
  | {
      ok: true;
      /** Counter-clockwise triangles over the caller's point indices. */
      triangles: [number, number, number][];
      /** The boundary in normal form, every one an edge of `triangles`. */
      segments: [number, number][];
    }
  | { ok: false; error: string };

/** Beyond this many points the O(n·m) boundary checks are not attempted. */
const MAX_POINTS = 5_000;

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

class Mesh {
  readonly x: number[];
  readonly y: number[];
  readonly triangles: ([number, number, number] | null)[] = [];
  readonly edges = new Map<number, number[]>();
  readonly stride: number;

  constructor(x: number[], y: number[]) {
    this.x = x;
    this.y = y;
    this.stride = x.length;
  }

  key(a: number, b: number): number {
    return a < b ? a * this.stride + b : b * this.stride + a;
  }

  orient(a: number, b: number, c: number): number {
    return (this.x[b]! - this.x[a]!) * (this.y[c]! - this.y[a]!) -
      (this.y[b]! - this.y[a]!) * (this.x[c]! - this.x[a]!);
  }

  add(a: number, b: number, c: number): number {
    const id = this.triangles.length;
    this.triangles.push([a, b, c]);
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const key = this.key(p, q);
      const list = this.edges.get(key);
      if (list) list.push(id);
      else this.edges.set(key, [id]);
    }
    return id;
  }

  remove(id: number): void {
    const [a, b, c] = this.triangles[id]!;
    this.triangles[id] = null;
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const key = this.key(p, q);
      const list = this.edges.get(key)!.filter((other) => other !== id);
      if (list.length) this.edges.set(key, list);
      else this.edges.delete(key);
    }
  }

  /** The triangle's corners rotated so `a -> b` is its directed edge. */
  rotated(id: number, a: number, b: number): [number, number, number] | null {
    const t = this.triangles[id];
    if (!t) return null;
    for (let index = 0; index < 3; index += 1) {
      if (t[index] === a && t[(index + 1) % 3] === b) return [a, b, t[(index + 2) % 3]!];
    }
    return null;
  }

  /** The two triangles on edge a-b as `[a, b, c]` and `[b, a, d]`. */
  quad(a: number, b: number): [number, number, number, number, number, number] | null {
    const list = this.edges.get(this.key(a, b));
    if (!list || list.length !== 2) return null;
    const first = this.rotated(list[0]!, a, b) ?? this.rotated(list[1]!, a, b);
    const second = this.rotated(list[0]!, b, a) ?? this.rotated(list[1]!, b, a);
    if (!first || !second) return null;
    const [t1, t2] = this.rotated(list[0]!, a, b) ? [list[0]!, list[1]!] : [list[1]!, list[0]!];
    return [first[2], second[2], t1, t2, a, b];
  }

  /** Replace edge a-b by c-d in its convex quad; false if it is not convex. */
  flip(a: number, b: number): boolean {
    const quad = this.quad(a, b);
    if (!quad) return false;
    const [c, d, t1, t2] = quad;
    if (!(this.orient(a, d, c) > 0) || !(this.orient(d, b, c) > 0)) return false;
    this.remove(t1);
    this.remove(t2);
    this.add(a, d, c);
    this.add(d, b, c);
    return true;
  }

  inCircle(a: number, b: number, c: number, d: number): boolean {
    const adx = this.x[a]! - this.x[d]!, ady = this.y[a]! - this.y[d]!;
    const bdx = this.x[b]! - this.x[d]!, bdy = this.y[b]! - this.y[d]!;
    const cdx = this.x[c]! - this.x[d]!, cdy = this.y[c]! - this.y[d]!;
    const determinant =
      (adx * adx + ady * ady) * (bdx * cdy - cdx * bdy) -
      (bdx * bdx + bdy * bdy) * (adx * cdy - cdx * ady) +
      (cdx * cdx + cdy * cdy) * (adx * bdy - bdx * ady);
    const scale = Math.max(Math.abs(adx), Math.abs(ady), Math.abs(bdx), Math.abs(bdy), Math.abs(cdx), Math.abs(cdy));
    return determinant > 1e-12 * scale ** 4;
  }

  /** Lawson flips from the given edges until each is locally Delaunay. */
  legalize(stack: [number, number][], budget: number): boolean {
    let flips = 0;
    while (stack.length) {
      const [a, b] = stack.pop()!;
      const quad = this.quad(a, b);
      if (!quad) continue;
      const [c, d] = quad;
      if (!this.inCircle(a, b, c, d)) continue;
      if (!this.flip(a, b)) continue;
      if (++flips > budget) return false;
      stack.push([a, d], [d, b], [b, c], [c, a]);
    }
    return true;
  }
}

/**
 * Split each segment at the boundary points lying on it, then drop the
 * segments walked once each way. Null when the boundary is not a region.
 */
function normalForm(
  points: readonly RegionPoint[],
  segments: readonly RegionSegment[],
  epsilon: number,
): [number, number][] | string {
  const vertices = [...new Set(segments.flat())];
  const split: [number, number][] = [];
  for (const [a, b] of segments) {
    if (a === b) return "a boundary segment has one point at both ends";
    const [ax, ay] = points[a]!;
    const [bx, by] = points[b]!;
    const dx = bx - ax, dy = by - ay;
    const length = Math.hypot(dx, dy);
    if (!(length > epsilon)) return "a boundary segment is shorter than the tolerance";
    const on: [number, number][] = [];
    for (const p of vertices) {
      if (p === a || p === b) continue;
      const [px, py] = points[p]!;
      const t = ((px - ax) * dx + (py - ay) * dy) / (length * length);
      if (!(t > 0 && t < 1)) continue;
      if (Math.abs((px - ax) * dy - (py - ay) * dx) / length > epsilon) continue;
      on.push([t, p]);
    }
    on.sort((left, right) => left[0] - right[0]);
    let from = a;
    for (const [, p] of on) {
      split.push([from, p]);
      from = p;
    }
    split.push([from, b]);
  }
  const byKey = new Map<string, [number, number][]>();
  for (const segment of split) {
    const key = segment[0] < segment[1] ? `${segment[0]}:${segment[1]}` : `${segment[1]}:${segment[0]}`;
    const list = byKey.get(key);
    if (list) list.push(segment);
    else byKey.set(key, [segment]);
  }
  const kept: [number, number][] = [];
  for (const list of byKey.values()) {
    if (list.length === 1) {
      kept.push(list[0]!);
      continue;
    }
    if (list.length === 2 && list[0]![0] === list[1]![1]) continue;
    return "a boundary segment is walked twice the same way";
  }
  const balance = new Map<number, number>();
  for (const [a, b] of kept) {
    balance.set(a, (balance.get(a) ?? 0) + 1);
    balance.set(b, (balance.get(b) ?? 0) - 1);
  }
  if ([...balance.values()].some((value) => value !== 0)) return "the boundary does not close";
  if (kept.length < 3) return "the boundary encloses nothing";
  return kept;
}

/** Do the open segments a-b and c-d cross at one interior point? */
function properlyCross(mesh: Mesh, a: number, b: number, c: number, d: number): boolean {
  const o1 = mesh.orient(a, b, c);
  const o2 = mesh.orient(a, b, d);
  const o3 = mesh.orient(c, d, a);
  const o4 = mesh.orient(c, d, b);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}

/** Flip the edges crossing a-b until a-b is an edge; recovered segments stay. */
function recover(
  mesh: Mesh,
  a: number,
  b: number,
  recovered: ReadonlySet<number>,
  budget: number,
): string | null {
  for (let round = 0; round < budget; round += 1) {
    if (mesh.edges.has(mesh.key(a, b))) return null;
    const crossing: [number, number][] = [];
    for (const [key] of mesh.edges) {
      const p = Math.floor(key / mesh.stride);
      const q = key - p * mesh.stride;
      if (p === a || p === b || q === a || q === b) continue;
      if (properlyCross(mesh, a, b, p, q)) crossing.push([p, q]);
    }
    if (crossing.length === 0) return "a boundary segment is blocked by a point on it";
    if (crossing.some(([p, q]) => recovered.has(mesh.key(p, q)))) return "two boundary segments cross";
    let flipped = false;
    for (const [p, q] of crossing) {
      if (mesh.edges.has(mesh.key(p, q)) && mesh.flip(p, q)) flipped = true;
    }
    if (!flipped) return "no crossing edge of a boundary segment can be flipped";
  }
  return "boundary recovery did not converge";
}

/**
 * Triangulate the region the directed segments bound (on their left), over
 * the caller's point indices. The points the segments name must be distinct.
 */
export function triangulateConstrainedRegion(
  points: readonly RegionPoint[],
  segments: readonly RegionSegment[],
): ConstrainedRegionTriangulation {
  const used = [...new Set(segments.flat())].sort((left, right) => left - right);
  if (used.length < 3) return fail("the boundary names fewer than three points");
  if (used.length > MAX_POINTS) return fail(`more than ${MAX_POINTS} boundary points`);
  if (used.some((index) => !points[index] || !points[index]!.every(Number.isFinite))) {
    return fail("a boundary point is missing or not finite");
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const index of used) {
    const [x, y] = points[index]!;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const extent = Math.max(maxX - minX, maxY - minY);
  if (!(extent > 0)) return fail("the boundary has no extent");
  const epsilon = 1e-12 * extent;
  const boundary = normalForm(points, segments, epsilon);
  if (typeof boundary === "string") return fail(boundary);

  // Local indices: the used points, then four box corners.
  const local = new Map(used.map((index, at) => [index, at]));
  const x = used.map((index) => points[index]![0]);
  const y = used.map((index) => points[index]![1]);
  const n = used.length;
  const margin = extent;
  x.push(minX - margin, maxX + margin, maxX + margin, minX - margin);
  y.push(minY - margin, minY - margin, maxY + margin, maxY + margin);
  const mesh = new Mesh(x, y);
  mesh.add(n, n + 1, n + 2);
  mesh.add(n, n + 2, n + 3);

  const budget = 64 * (n + 4);
  // Signed distances of p from a triangle's three edges.
  const distances = (id: number, p: number): number[] => {
    const [a, b, c] = mesh.triangles[id]!;
    return ([[a, b], [b, c], [c, a]] as const).map(([s, e]) =>
      mesh.orient(s, e, p) / Math.hypot(x[e]! - x[s]!, y[e]! - y[s]!));
  };
  // Walk from the last triangle made toward p; a long walk falls back to a scan.
  const locate = (p: number, hint: number): number => {
    let id = hint;
    for (let steps = 0; steps < 4 * (n + 4) && mesh.triangles[id]; steps += 1) {
      const d = distances(id, p);
      const worst = d.indexOf(Math.min(...d));
      if (d[worst]! >= -epsilon) return id;
      const t = mesh.triangles[id]!;
      const [s, e] = [t[worst]!, t[(worst + 1) % 3]!];
      const next = (mesh.edges.get(mesh.key(s, e)) ?? []).find((other) => other !== id);
      if (next == null) break;
      id = next;
    }
    return mesh.triangles.findIndex((t, other) => t != null && Math.min(...distances(other, p)) >= -epsilon);
  };
  let hint = 0;
  for (let p = 0; p < n; p += 1) {
    const id = locate(p, hint);
    if (id < 0) return fail("a boundary point is outside the box");
    const [a, b, c] = mesh.triangles[id]!;
    const onEdges = distances(id, p).map((d) => d <= epsilon);
    const count = onEdges.filter(Boolean).length;
    if (count >= 2) return fail("two boundary points coincide");
    const stack: [number, number][] = [];
    if (count === 1) {
      const edge = onEdges.indexOf(true);
      const [s, e] = ([[a, b], [b, c], [c, a]] as const)[edge]!;
      for (const other of [...(mesh.edges.get(mesh.key(s, e)) ?? [])]) {
        const forward = mesh.rotated(other, s, e) ?? mesh.rotated(other, e, s);
        if (!forward) continue;
        const [u, v, w] = forward;
        mesh.remove(other);
        mesh.add(u, p, w);
        mesh.add(p, v, w);
        stack.push([w, u], [v, w]);
      }
    } else {
      mesh.remove(id);
      mesh.add(a, b, p);
      mesh.add(b, c, p);
      mesh.add(c, a, p);
      stack.push([a, b], [b, c], [c, a]);
    }
    if (!mesh.legalize(stack, budget)) return fail("Delaunay insertion did not converge");
    hint = mesh.triangles.length - 1;
  }

  const localSegments = boundary.map(([a, b]) => [local.get(a)!, local.get(b)!] as [number, number]);
  const constrained = new Set<number>();
  for (const [a, b] of localSegments) {
    const error = recover(mesh, a, b, constrained, budget);
    if (error) return fail(error);
    constrained.add(mesh.key(a, b));
  }

  // Inside is an odd number of boundary crossings from the box.
  const parity = new Map<number, number>();
  const queue: number[] = [];
  for (let id = 0; id < mesh.triangles.length; id += 1) {
    const t = mesh.triangles[id];
    if (t && t.some((corner) => corner >= n)) {
      parity.set(id, 0);
      queue.push(id);
    }
  }
  while (queue.length) {
    const id = queue.pop()!;
    const [a, b, c] = mesh.triangles[id]!;
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const key = mesh.key(p, q);
      const next = (mesh.edges.get(key) ?? []).find((other) => other !== id);
      if (next == null) continue;
      const expected = parity.get(id)! ^ (constrained.has(key) ? 1 : 0);
      const known = parity.get(next);
      if (known === undefined) {
        parity.set(next, expected);
        queue.push(next);
      } else if (known !== expected) {
        return fail("the boundary does not separate inside from outside");
      }
    }
  }
  const triangles: [number, number, number][] = [];
  for (let id = 0; id < mesh.triangles.length; id += 1) {
    const t = mesh.triangles[id];
    if (!t) continue;
    const side = parity.get(id);
    if (side === undefined) return fail("a triangle is not reached from the box");
    if (side === 0) continue;
    if (t.some((corner) => corner >= n)) return fail("the region reaches the box");
    triangles.push([used[t[0]]!, used[t[1]]!, used[t[2]]!]);
  }
  // Every segment must bound an inside triangle on its left.
  for (const [a, b] of localSegments) {
    const list = mesh.edges.get(mesh.key(a, b)) ?? [];
    const left = list.find((id) => mesh.rotated(id, a, b));
    if (left == null || parity.get(left) !== 1) {
      return fail("a boundary segment does not have the region on its left");
    }
  }
  return { ok: true, triangles, segments: boundary };
}
