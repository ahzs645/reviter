/**
 * Triangulating a horizontal boundary loop, holes and all.
 *
 * A recovered slab is a closed outer ring, sometimes with inner rings where a
 * stair, shaft or duct passes through, and sometimes describing several
 * disjoint regions at once. Drawing only the largest ring would fill the
 * openings back in; treating everything after the largest as an opening would
 * subtract one wing of a building from another. So rings are first sorted by
 * nesting depth into shells and their openings, and each shell is then
 * triangulated with its own holes.
 *
 * The triangulator is ear clipping over a doubly-linked vertex ring, with holes
 * eliminated by bridging each one into the shell at a mutually visible vertex —
 * the construction Mapbox's `earcut` uses, including its recovery passes: if no
 * ear is left, degenerate vertices are dropped and the pass retried; if that
 * fails, self-intersections are cut out locally; if that fails, the ring is
 * split on a valid diagonal and each half triangulated on its own. Those
 * fallbacks are not incidental. Recovered Revit sketches include rings that
 * touch themselves at a vertex and rings with several nested openings, and a
 * plain ear clipper silently gives up on them — on this project it dropped part
 * of the floor area on 12 of 101 slabs.
 *
 * Correctness is checked by area rather than by eye: the triangles a slab is
 * drawn from must cover exactly its outer ring minus its openings.
 *
 * Rings arrive as `[x, y]` pairs with no duplicated closing vertex, and may wind
 * either way — Revit's sketches do both.
 */

export type Point2 = [number, number];

type Vertex = {
  /** Index into the caller's flattened vertex list. */
  index: number;
  x: number;
  y: number;
  previous: Vertex;
  next: Vertex;
  /** A lone hole vertex bridged in, which must not be filtered away. */
  steiner: boolean;
};

/** Twice the signed area of a ring; positive when it winds counter-clockwise. */
function signedArea(ring: readonly Point2[]): number {
  let twice = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const p = ring[index]!;
    const q = ring[(index + 1) % ring.length]!;
    twice += p[0] * q[1] - q[0] * p[1];
  }
  return twice / 2;
}

export function ringArea(ring: readonly Point2[]): number {
  return Math.abs(signedArea(ring));
}

/** Ray-cast containment for a single point. */
function pointInRing(ring: readonly Point2[], point: Point2): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index]!;
    const b = ring[previous]!;
    if (a[1] > point[1] !== b[1] > point[1]) {
      const x = a[0] + ((point[1] - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
      if (point[0] < x) inside = !inside;
    }
  }
  return inside;
}

/**
 * Is one ring inside another? Decided by majority vote over the inner ring's
 * vertices rather than by a single probe: nested sketch rings often share a
 * vertex or run alongside each other, and one unlucky probe on the shared
 * boundary would flip the answer for the whole ring.
 */
function ringInside(inner: readonly Point2[], outer: readonly Point2[]): boolean {
  let votes = 0;
  for (const vertex of inner) if (pointInRing(outer, vertex)) votes += 1;
  return votes * 2 > inner.length;
}

/**
 * Sort a sketch's rings into shells and their openings by nesting depth: a ring
 * inside an even number of others is a shell, a ring inside an odd number is an
 * opening in the smallest shell that contains it.
 */
export function groupRings(
  rings: readonly Point2[][],
): { outer: Point2[]; holes: Point2[][] }[] {
  const usable = rings.filter((ring) => ring.length >= 3);
  const depth = usable.map((ring, index) =>
    usable.reduce(
      (count, other, otherIndex) =>
        otherIndex !== index && ringInside(ring, other) ? count + 1 : count,
      0,
    ),
  );
  const groups = usable
    .map((ring, index) => ({ ring, index }))
    .filter(({ index }) => depth[index]! % 2 === 0)
    .map(({ ring }) => ({ outer: [...ring], holes: [] as Point2[][] }));

  for (let index = 0; index < usable.length; index += 1) {
    if (depth[index]! % 2 === 0) continue;
    let best: (typeof groups)[number] | undefined;
    for (const group of groups) {
      if (!ringInside(usable[index]!, group.outer)) continue;
      if (!best || ringArea(group.outer) < ringArea(best.outer)) best = group;
    }
    if (best) best.holes.push([...usable[index]!]);
  }
  return groups.map(({ outer, holes }) => ({ outer, holes }));
}

/**
 * Twice the signed area of a triangle, negative when counter-clockwise. This is
 * the sign convention the clipper below is written against; `signedArea` above
 * uses the opposite one for whole rings, which is why the two are separate.
 */
function turn(p: Vertex, q: Vertex, r: Vertex): number {
  return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
}

function samePoint(a: Vertex, b: Vertex): boolean {
  return a.x === b.x && a.y === b.y;
}

function sign(value: number): number {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

function pointInTriangle(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
  px: number, py: number,
): boolean {
  return (
    (cx - px) * (ay - py) >= (ax - px) * (cy - py) &&
    (ax - px) * (by - py) >= (bx - px) * (ay - py) &&
    (bx - px) * (cy - py) >= (cx - px) * (by - py)
  );
}

function makeVertex(index: number, x: number, y: number): Vertex {
  const vertex = { index, x, y, steiner: false } as Vertex;
  vertex.previous = vertex;
  vertex.next = vertex;
  return vertex;
}

function insertVertex(index: number, x: number, y: number, last: Vertex | null): Vertex {
  const vertex = makeVertex(index, x, y);
  if (!last) return vertex;
  vertex.next = last.next;
  vertex.previous = last;
  last.next.previous = vertex;
  last.next = vertex;
  return vertex;
}

function removeVertex(vertex: Vertex): void {
  vertex.next.previous = vertex.previous;
  vertex.previous.next = vertex.next;
}

/** Build a circular list, forced counter-clockwise for a shell, clockwise for a hole. */
function linkRing(ring: readonly Point2[], offset: number, shell: boolean): Vertex | null {
  let last: Vertex | null = null;
  const forwards = signedArea(ring) > 0 === shell;
  if (forwards) {
    for (let index = 0; index < ring.length; index += 1) {
      last = insertVertex(offset + index, ring[index]![0], ring[index]![1], last);
    }
  } else {
    for (let index = ring.length - 1; index >= 0; index -= 1) {
      last = insertVertex(offset + index, ring[index]![0], ring[index]![1], last);
    }
  }
  if (last && samePoint(last, last.next)) {
    removeVertex(last);
    last = last.next;
  }
  return last;
}

/** Drop repeated and collinear vertices, which can never be part of an ear. */
function filterVertices(start: Vertex | null, end?: Vertex): Vertex | null {
  if (!start) return start;
  let last = end ?? start;
  let vertex = start;
  let again = false;
  do {
    again = false;
    if (!vertex.steiner && (samePoint(vertex, vertex.next) || turn(vertex.previous, vertex, vertex.next) === 0)) {
      removeVertex(vertex);
      vertex = last = vertex.previous;
      if (vertex === vertex.next) break;
      again = true;
    } else {
      vertex = vertex.next;
    }
  } while (again || vertex !== last);
  return last;
}

function isEar(ear: Vertex): boolean {
  const a = ear.previous;
  const b = ear;
  const c = ear.next;
  if (turn(a, b, c) >= 0) return false; // a reflex corner is never an ear

  const minX = Math.min(a.x, b.x, c.x);
  const minY = Math.min(a.y, b.y, c.y);
  const maxX = Math.max(a.x, b.x, c.x);
  const maxY = Math.max(a.y, b.y, c.y);
  for (let vertex = c.next; vertex !== a; vertex = vertex.next) {
    if (vertex.x < minX || vertex.x > maxX || vertex.y < minY || vertex.y > maxY) continue;
    if (!pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, vertex.x, vertex.y)) continue;
    if (turn(vertex.previous, vertex, vertex.next) >= 0) return false;
  }
  return true;
}

function onSegment(p: Vertex, q: Vertex, r: Vertex): boolean {
  return (
    q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) &&
    q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y)
  );
}

function intersects(p1: Vertex, q1: Vertex, p2: Vertex, q2: Vertex): boolean {
  const o1 = sign(turn(p1, q1, p2));
  const o2 = sign(turn(p1, q1, q2));
  const o3 = sign(turn(p2, q2, p1));
  const o4 = sign(turn(p2, q2, q1));
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  return o4 === 0 && onSegment(p2, q1, q2);
}

function intersectsRing(a: Vertex, b: Vertex): boolean {
  let vertex = a;
  do {
    if (
      vertex.index !== a.index && vertex.next.index !== a.index &&
      vertex.index !== b.index && vertex.next.index !== b.index &&
      intersects(vertex, vertex.next, a, b)
    ) {
      return true;
    }
    vertex = vertex.next;
  } while (vertex !== a);
  return false;
}

/** Does the segment `a→b` leave `a` on the inside of the ring? */
function locallyInside(a: Vertex, b: Vertex): boolean {
  return turn(a.previous, a, a.next) < 0
    ? turn(a, b, a.next) >= 0 && turn(a, a.previous, b) >= 0
    : turn(a, b, a.previous) < 0 || turn(a, a.next, b) < 0;
}

function middleInside(a: Vertex, b: Vertex): boolean {
  let vertex = a;
  let inside = false;
  const px = (a.x + b.x) / 2;
  const py = (a.y + b.y) / 2;
  do {
    if (
      vertex.y > py !== vertex.next.y > py && vertex.next.y !== vertex.y &&
      px < ((vertex.next.x - vertex.x) * (py - vertex.y)) / (vertex.next.y - vertex.y) + vertex.x
    ) {
      inside = !inside;
    }
    vertex = vertex.next;
  } while (vertex !== a);
  return inside;
}

function isValidDiagonal(a: Vertex, b: Vertex): boolean {
  if (a.next.index === b.index || a.previous.index === b.index) return false;
  if (intersectsRing(a, b)) return false;
  if (
    locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) &&
    (turn(a.previous, a, b.previous) !== 0 || turn(a, b.previous, b) !== 0)
  ) {
    return true;
  }
  // Two coincident vertices are a valid diagonal when both corners are convex.
  return (
    samePoint(a, b) &&
    turn(a.previous, a, a.next) > 0 &&
    turn(b.previous, b, b.next) > 0
  );
}

/** Split the ring in two along `a→b`, returning the head of the second ring. */
function splitRing(a: Vertex, b: Vertex): Vertex {
  const a2 = makeVertex(a.index, a.x, a.y);
  const b2 = makeVertex(b.index, b.x, b.y);
  const afterA = a.next;
  const beforeB = b.previous;

  a.next = b;
  b.previous = a;
  a2.next = afterA;
  afterA.previous = a2;
  b2.next = a2;
  a2.previous = b2;
  beforeB.next = b2;
  b2.previous = beforeB;
  return b2;
}

/** Cut out a pair of edges that cross each other, emitting the triangle between. */
function cureLocalIntersections(start: Vertex, triangles: number[]): Vertex | null {
  let vertex = start;
  let head = start;
  do {
    const a = vertex.previous;
    const b = vertex.next.next;
    if (
      !samePoint(a, b) && intersects(a, vertex, vertex.next, b) &&
      locallyInside(a, b) && locallyInside(b, a)
    ) {
      triangles.push(a.index, vertex.index, b.index);
      removeVertex(vertex);
      removeVertex(vertex.next);
      vertex = head = b;
    }
    vertex = vertex.next;
  } while (vertex !== head);
  return filterVertices(vertex);
}

function clip(ear: Vertex | null, triangles: number[], pass: 0 | 1 | 2): void {
  if (!ear) return;
  let current = ear;
  let stop = ear;

  while (current.previous !== current.next) {
    const previous = current.previous;
    const next = current.next;
    if (isEar(current)) {
      triangles.push(previous.index, current.index, next.index);
      removeVertex(current);
      current = next.next;
      stop = next.next;
      continue;
    }
    current = next;
    if (current !== stop) continue;

    // No ear anywhere in the ring. Escalate through the recovery passes rather
    // than give up, which is what silently loses slab area.
    if (pass === 0) {
      clip(filterVertices(current), triangles, 1);
    } else if (pass === 1) {
      const cured = cureLocalIntersections(filterVertices(current)!, triangles);
      clip(cured, triangles, 2);
    } else {
      splitAndClip(current, triangles);
    }
    return;
  }
}

/** Last resort: split the ring on any valid diagonal and clip each half. */
function splitAndClip(start: Vertex, triangles: number[]): void {
  let a = start;
  do {
    let b = a.next.next;
    while (b !== a.previous) {
      if (a.index !== b.index && isValidDiagonal(a, b)) {
        const other = splitRing(a, b);
        clip(filterVertices(a, a.next), triangles, 0);
        clip(filterVertices(other, other.next), triangles, 0);
        return;
      }
      b = b.next;
    }
    a = a.next;
  } while (a !== start);
}

function leftmost(start: Vertex): Vertex {
  let best = start;
  let vertex = start;
  do {
    if (vertex.x < best.x || (vertex.x === best.x && vertex.y < best.y)) best = vertex;
    vertex = vertex.next;
  } while (vertex !== start);
  return best;
}

/**
 * Find the shell vertex a hole can be bridged to: cast a ray left from the
 * hole's leftmost point, take the nearer endpoint of the first shell edge it
 * meets, and if any reflex vertex blocks the line of sight, move to the one at
 * the shallowest angle from the ray that the hole can actually see.
 */
function findBridge(hole: Vertex, outer: Vertex): Vertex | null {
  let vertex = outer;
  let bestX = -Infinity;
  let bridge: Vertex | null = null;
  do {
    if (hole.y <= vertex.y && hole.y >= vertex.next.y && vertex.next.y !== vertex.y) {
      const x = vertex.x + ((hole.y - vertex.y) * (vertex.next.x - vertex.x)) / (vertex.next.y - vertex.y);
      if (x <= hole.x && x > bestX) {
        bestX = x;
        bridge = vertex.x < vertex.next.x ? vertex : vertex.next;
        // The hole touches the edge: its leftmost endpoint is the connection.
        if (x === hole.x) return bridge;
      }
    }
    vertex = vertex.next;
  } while (vertex !== outer);
  if (!bridge) return null;

  const stop = bridge;
  const bridgeX = bridge.x;
  const bridgeY = bridge.y;
  let bestTangent = Infinity;
  vertex = bridge;
  do {
    const inSector = hole.x >= vertex.x && vertex.x >= bridgeX && hole.x !== vertex.x;
    if (
      inSector &&
      pointInTriangle(
        hole.y < bridgeY ? hole.x : bestX, hole.y,
        bridgeX, bridgeY,
        hole.y < bridgeY ? bestX : hole.x, hole.y,
        vertex.x, vertex.y,
      )
    ) {
      const tangent = Math.abs(hole.y - vertex.y) / (hole.x - vertex.x);
      if (locallyInside(vertex, hole) && (tangent < bestTangent || (tangent === bestTangent && vertex.x > bridge!.x))) {
        bridge = vertex;
        bestTangent = tangent;
      }
    }
    vertex = vertex.next;
  } while (vertex !== stop);
  return bridge;
}

/**
 * Triangulate a ring with optional holes. Returns triangle indices into the
 * concatenation `[...outer, ...holes.flat()]`, so a caller can build its vertex
 * buffer from the rings it passed in.
 */
export function triangulate(outer: readonly Point2[], holes: readonly Point2[][] = []): number[] {
  if (outer.length < 3) return [];
  const triangles: number[] = [];

  let shell = filterVertices(linkRing(outer, 0, true));
  if (!shell || shell.next === shell.previous) return triangles;

  let offset = outer.length;
  const queue: Vertex[] = [];
  for (const hole of holes) {
    const list = linkRing(hole, offset, false);
    offset += hole.length;
    if (!list) continue;
    if (list === list.next) list.steiner = true;
    queue.push(leftmost(list));
  }
  queue.sort((a, b) => a.x - b.x || a.y - b.y);

  for (const hole of queue) {
    const bridge = findBridge(hole, shell);
    if (!bridge) continue;
    const reverse = splitRing(bridge, hole);
    filterVertices(reverse, reverse.next);
    shell = filterVertices(bridge, bridge.next)!;
  }

  clip(shell, triangles, 0);
  return triangles;
}
