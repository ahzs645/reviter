/** Independent tessellation diagnostics. No results participate in RVT decoding. */
export type Point3 = readonly [number, number, number];
export type Triangle3 = readonly [Point3, Point3, Point3];

function distanceSquared(a: Point3, b: Point3): number {
  return a.reduce((sum, value, axis) => sum + (value - b[axis]!) ** 2, 0);
}

/** Closest point on a finite triangle, including its boundary and degenerate edges. */
export function pointTriangleDistance(point: Point3, triangle: Triangle3): number {
  const [a, b, c] = triangle;
  const u = b.map((value, axis) => value - a[axis]!), v = c.map((value, axis) => value - a[axis]!);
  const w = point.map((value, axis) => value - a[axis]!);
  const dot = (x: readonly number[], y: readonly number[]) => x.reduce((sum, value, axis) => sum + value * y[axis]!, 0);
  const uu = dot(u, u), uv = dot(u, v), vv = dot(v, v), wu = dot(w, u), wv = dot(w, v);
  const determinant = uu * vv - uv * uv;
  if (determinant > 0) {
    const s = (wu * vv - wv * uv) / determinant, t = (wv * uu - wu * uv) / determinant;
    if (s >= 0 && t >= 0 && s + t <= 1) {
      const closest = a.map((value, axis) => value + s * u[axis]! + t * v[axis]!) as unknown as Point3;
      return Math.sqrt(distanceSquared(point, closest));
    }
  }
  return Math.sqrt(Math.min(...[[a, b], [b, c], [c, a]].map(([start, end]) => {
    const direction = end!.map((value, axis) => value - start![axis]!);
    const lengthSquared = dot(direction, direction);
    const at = lengthSquared ? Math.max(0, Math.min(1, dot(point.map((value, axis) => value - start![axis]!), direction) / lengthSquared)) : 0;
    return distanceSquared(point, start!.map((value, axis) => value + at * direction[axis]!) as unknown as Point3);
  })));
}

/** Vertices, edge midpoints and centroid of every triangle; not a Hausdorff bound. */
export function sampledSurfaceDistance(from: Triangle3[], to: Triangle3[]) {
  if (!from.length || !to.length) return null;
  let maximumFeet = 0, samples = 0;
  for (const triangle of from) {
    const points: Point3[] = [...triangle,
      ...[0, 1, 2].map(i => triangle[i]!.map((value, axis) => (value + triangle[(i + 1) % 3]![axis]!) / 2) as unknown as Point3),
      triangle[0].map((value, axis) => (value + triangle[1][axis]! + triangle[2][axis]!) / 3) as unknown as Point3];
    for (const point of points) {
      maximumFeet = Math.max(maximumFeet, Math.min(...to.map(target => pointTriangleDistance(point, target))));
      samples++;
    }
  }
  return { maximumFeet, samples };
}
export type ShapeMetrics = {
  boundsFeet: number[];
  triangles: number;
  surfaceAreaSquareFeet: number;
  closedShellVolumeCubicFeet: number | null;
  boundaryEdges: number;
  nonManifoldEdges: number;
  inconsistentWindingEdges: number;
  degenerateTriangles: number;
};

/** Exact coordinate welding: a small physical gap is never silently closed. */
export function measureShape(points: readonly Point3[], indices: ArrayLike<number>): ShapeMetrics {
  if (indices.length % 3) throw new Error("triangle index count is not divisible by three");
  if (points.some(point => point.some(value => !Number.isFinite(value)))) throw new Error("non-finite vertex");
  const boundsFeet = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const ids = new Map<string, number>();
  const vertexIds = points.map(point => {
    const key = point.join(",");
    let id = ids.get(key);
    if (id == null) { id = ids.size; ids.set(key, id); }
    return id;
  });
  const edges = new Map<string, { count: number; direction: number }>();
  let surfaceAreaSquareFeet = 0, signedVolume = 0, degenerateTriangles = 0;
  const anchor = points[indices[0]!] ?? [0, 0, 0];
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const corners = [indices[triangle]!, indices[triangle + 1]!, indices[triangle + 2]!];
    if (corners.some(index => !Number.isSafeInteger(index) || index < 0 || index >= points.length)) throw new Error("out-of-range triangle index");
    const [a, b, c] = corners.map(index => points[index]!);
    for (const point of [a!, b!, c!]) for (let axis = 0; axis < 3; axis++) {
      boundsFeet[axis] = Math.min(boundsFeet[axis]!, point[axis]!);
      boundsFeet[axis + 3] = Math.max(boundsFeet[axis + 3]!, point[axis]!);
    }
    const ab = b!.map((value, axis) => value - a![axis]!), ac = c!.map((value, axis) => value - a![axis]!);
    const cross = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!, ab[0]! * ac[1]! - ab[1]! * ac[0]!];
    const area = Math.hypot(...cross) / 2;
    surfaceAreaSquareFeet += area;
    if (area === 0) degenerateTriangles++;
    // Subtract a nearby anchor before the triple product to avoid cancellation
    // from survey-coordinate translations. Translation cannot change volume.
    const p = a!.map((value, axis) => value - anchor[axis]!);
    const q = b!.map((value, axis) => value - anchor[axis]!);
    const r = c!.map((value, axis) => value - anchor[axis]!);
    signedVolume += (p[0]! * (q[1]! * r[2]! - q[2]! * r[1]!) + p[1]! * (q[2]! * r[0]! - q[0]! * r[2]!) + p[2]! * (q[0]! * r[1]! - q[1]! * r[0]!)) / 6;
    for (let edge = 0; edge < 3; edge++) {
      const from = vertexIds[corners[edge]!]!, to = vertexIds[corners[(edge + 1) % 3]!]!;
      const key = `${Math.min(from, to)}:${Math.max(from, to)}`;
      const entry = edges.get(key) ?? { count: 0, direction: 0 };
      entry.count++; entry.direction += from < to ? 1 : -1;
      edges.set(key, entry);
    }
  }
  let boundaryEdges = 0, nonManifoldEdges = 0, inconsistentWindingEdges = 0;
  for (const edge of edges.values()) {
    if (edge.count === 1) boundaryEdges++;
    if (edge.count > 2) nonManifoldEdges++;
    if (edge.count === 2 && edge.direction !== 0) inconsistentWindingEdges++;
  }
  const closed = indices.length > 0 && !boundaryEdges && !nonManifoldEdges && !inconsistentWindingEdges && !degenerateTriangles;
  return { boundsFeet, triangles: indices.length / 3, surfaceAreaSquareFeet,
    closedShellVolumeCubicFeet: closed ? Math.abs(signedVolume) : null,
    boundaryEdges, nonManifoldEdges, inconsistentWindingEdges, degenerateTriangles };
}

export type OwnerShape = { tag: string; globalId: string; ifcType: string; expressId: number; parts: ShapeMetrics[] };

export function summarizeParts(parts: ShapeMetrics[]) {
  const boundsFeet = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const part of parts) for (let axis = 0; axis < 3; axis++) {
    boundsFeet[axis] = Math.min(boundsFeet[axis]!, part.boundsFeet[axis]!);
    boundsFeet[axis + 3] = Math.max(boundsFeet[axis + 3]!, part.boundsFeet[axis + 3]!);
  }
  return { boundsFeet, triangles: parts.reduce((sum, part) => sum + part.triangles, 0),
    surfaceAreaSquareFeet: parts.reduce((sum, part) => sum + part.surfaceAreaSquareFeet, 0),
    // Parts can overlap or contain other solids. This is an independently
    // measured sum of shell volumes, never a claim about a material union.
    sumClosedPartVolumesCubicFeet: parts.length && parts.every(part => part.closedShellVolumeCubicFeet != null)
      ? parts.reduce((sum, part) => sum + part.closedShellVolumeCubicFeet!, 0) : null,
    parts: parts.length, closedParts: parts.filter(part => part.closedShellVolumeCubicFeet != null).length,
    boundaryEdges: parts.reduce((sum, part) => sum + part.boundaryEdges, 0),
    nonManifoldEdges: parts.reduce((sum, part) => sum + part.nonManifoldEdges, 0),
    inconsistentWindingEdges: parts.reduce((sum, part) => sum + part.inconsistentWindingEdges, 0),
  };
}

export function compareOwnerShapes(output: OwnerShape[], reference: OwnerShape[]) {
  const grouped = (owners: OwnerShape[]) => {
    const map = new Map<string, OwnerShape[]>();
    for (const owner of owners) map.set(owner.tag, [...(map.get(owner.tag) ?? []), owner]);
    return map;
  };
  const own = grouped(output), truth = grouped(reference);
  const comparisons = [];
  let ambiguous = 0, identityDisagreements = 0, outputOnly = 0, referenceOnly = 0;
  for (const [tag, ours] of own) {
    const theirs = truth.get(tag);
    if (!theirs) { outputOnly++; continue; }
    if (ours.length !== 1 || theirs.length !== 1) { ambiguous++; continue; }
    const a = ours[0]!, b = theirs[0]!;
    if (a.globalId !== b.globalId) { identityDisagreements++; continue; }
    const out = summarizeParts(a.parts), ref = summarizeParts(b.parts);
    if (!out.parts || !ref.parts) continue;
    const boundsCornerErrorFeet = Math.max(...out.boundsFeet.map((value, axis) => Math.abs(value - ref.boundsFeet[axis]!)));
    const delta = (x: number, y: number) => ({ absolute: Math.abs(x - y), relative: y > 0 ? Math.abs(x - y) / y : null });
    comparisons.push({ tag, outputIfcType: a.ifcType, referenceIfcType: b.ifcType, globalId: a.globalId,
      boundsCornerErrorFeet, areaDelta: delta(out.surfaceAreaSquareFeet, ref.surfaceAreaSquareFeet),
      closedPartVolumeDelta: out.sumClosedPartVolumesCubicFeet != null && ref.sumClosedPartVolumesCubicFeet != null
        ? delta(out.sumClosedPartVolumesCubicFeet, ref.sumClosedPartVolumesCubicFeet) : null,
      output: out, reference: ref });
  }
  for (const tag of truth.keys()) if (!own.has(tag)) referenceOnly++;
  return { compared: comparisons.length, ambiguous, identityDisagreements, outputOnly, referenceOnly, comparisons };
}
