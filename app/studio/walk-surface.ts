/** Compact spatial index for first-person floor and stair following. */
import * as THREE from "three";

export type WalkSurfaceQuery = {
  /** Furthest vertical distance below the eye that may be returned. */
  maxDrop?: number;
  /** Highest absolute surface coordinate that may be returned. */
  maximumHeight?: number;
};

export type WalkSurfaceStats = {
  triangles: number;
  cells: number;
  overflowTriangles: number;
};

type Axis = "x" | "y" | "z";

export type WalkGeometryRange = {
  /** Zero-based triangle offset within the indexed or non-indexed geometry. */
  startTriangle: number;
  /** Maximum number of triangles to add from that offset. */
  triangleCount: number;
};

export function geometryTriangleCount(geometry: THREE.BufferGeometry): number {
  const positions = geometry.getAttribute("position");
  if (!positions) return 0;
  return Math.floor((geometry.getIndex()?.count ?? positions.count) / 3);
}

function geometryOffsetRange(
  count: number,
  range?: WalkGeometryRange,
): readonly [number, number] {
  const availableTriangles = Math.floor(count / 3);
  const firstTriangle = THREE.MathUtils.clamp(
    Math.floor(range?.startTriangle ?? 0),
    0,
    availableTriangles,
  );
  const lastTriangle = THREE.MathUtils.clamp(
    firstTriangle + Math.max(0, Math.floor(range?.triangleCount ?? availableTriangles)),
    firstTriangle,
    availableTriangles,
  );
  return [firstTriangle * 3, lastTriangle * 3];
}

function projectedAxes(up: Axis): readonly [Axis, Axis] {
  return up === "y" ? ["x", "z"] : up === "z" ? ["x", "y"] : ["y", "z"];
}

/**
 * Stores only sufficiently horizontal triangles and bins them by their
 * projected footprint. Queries still use exact barycentric interpolation, so a
 * coarse cell size speeds lookup without flattening stair treads or ramps.
 */
export class WalkSurfaceIndex {
  readonly up: Axis;
  readonly cellSize: number;
  readonly minUpDot: number;

  private readonly axes: readonly [Axis, Axis];
  private readonly triangleData: number[] = [];
  private readonly cells = new Map<string, number[]>();
  private readonly overflowTriangles: number[] = [];
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly ab = new THREE.Vector3();
  private readonly ac = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();

  constructor({
    up = "y",
    cellSize = 1.25,
    minUpDot = 0.45,
  }: {
    up?: Axis;
    cellSize?: number;
    minUpDot?: number;
  } = {}) {
    this.up = up;
    this.cellSize = Math.max(0.05, cellSize);
    this.minUpDot = THREE.MathUtils.clamp(minUpDot, 0, 1);
    this.axes = projectedAxes(up);
  }

  addGeometry(
    geometry: THREE.BufferGeometry,
    matrix: THREE.Matrix4,
    range?: WalkGeometryRange,
  ): void {
    const positions = geometry.getAttribute("position");
    if (!positions) return;
    const index = geometry.getIndex();
    const count = index?.count ?? positions.count;
    const vertexIndex = (offset: number) => index ? index.getX(offset) : offset;
    const [firstOffset, lastOffset] = geometryOffsetRange(count, range);

    for (let offset = firstOffset; offset + 2 < lastOffset; offset += 3) {
      this.a.fromBufferAttribute(positions, vertexIndex(offset)).applyMatrix4(matrix);
      this.b.fromBufferAttribute(positions, vertexIndex(offset + 1)).applyMatrix4(matrix);
      this.c.fromBufferAttribute(positions, vertexIndex(offset + 2)).applyMatrix4(matrix);
      this.ab.subVectors(this.b, this.a);
      this.ac.subVectors(this.c, this.a);
      this.normal.crossVectors(this.ab, this.ac);
      const normalLength = this.normal.length();
      if (normalLength < 1e-8
        || Math.abs(this.normal[this.up]) / normalLength < this.minUpDot) continue;
      this.addTriangle(this.a, this.b, this.c);
    }
  }

  floorAt(point: THREE.Vector3, query: WalkSurfaceQuery = {}): number | null {
    const u = point[this.axes[0]];
    const v = point[this.axes[1]];
    const eyeHeight = point[this.up];
    const maximumHeight = query.maximumHeight ?? eyeHeight;
    const maxDrop = query.maxDrop ?? Number.POSITIVE_INFINITY;
    const candidates = this.cells.get(this.cellKey(u, v)) ?? [];
    let best = Number.NEGATIVE_INFINITY;

    const inspect = (triangleId: number) => {
      const base = triangleId * 9;
      const au = this.triangleData[base]!;
      const av = this.triangleData[base + 1]!;
      const ah = this.triangleData[base + 2]!;
      const bu = this.triangleData[base + 3]!;
      const bv = this.triangleData[base + 4]!;
      const bh = this.triangleData[base + 5]!;
      const cu = this.triangleData[base + 6]!;
      const cv = this.triangleData[base + 7]!;
      const ch = this.triangleData[base + 8]!;
      const denominator = (bv - cv) * (au - cu) + (cu - bu) * (av - cv);
      if (Math.abs(denominator) < 1e-10) return;
      const wa = ((bv - cv) * (u - cu) + (cu - bu) * (v - cv)) / denominator;
      const wb = ((cv - av) * (u - cu) + (au - cu) * (v - cv)) / denominator;
      const wc = 1 - wa - wb;
      const epsilon = -1e-5;
      if (wa < epsilon || wb < epsilon || wc < epsilon) return;
      const height = wa * ah + wb * bh + wc * ch;
      if (height > maximumHeight + 1e-5
        || eyeHeight - height > maxDrop
        || height <= best) return;
      best = height;
    };

    candidates.forEach(inspect);
    this.overflowTriangles.forEach(inspect);
    return Number.isFinite(best) ? best : null;
  }

  stats(): WalkSurfaceStats {
    return {
      triangles: this.triangleData.length / 9,
      cells: this.cells.size,
      overflowTriangles: this.overflowTriangles.length,
    };
  }

  private addTriangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
    const [uAxis, vAxis] = this.axes;
    const projectedArea = Math.abs(
      (b[uAxis] - a[uAxis]) * (c[vAxis] - a[vAxis])
      - (b[vAxis] - a[vAxis]) * (c[uAxis] - a[uAxis]),
    );
    if (projectedArea < 1e-8) return;
    const triangleId = this.triangleData.length / 9;
    this.triangleData.push(
      a[uAxis], a[vAxis], a[this.up],
      b[uAxis], b[vAxis], b[this.up],
      c[uAxis], c[vAxis], c[this.up],
    );

    const minU = Math.floor(Math.min(a[uAxis], b[uAxis], c[uAxis]) / this.cellSize);
    const maxU = Math.floor(Math.max(a[uAxis], b[uAxis], c[uAxis]) / this.cellSize);
    const minV = Math.floor(Math.min(a[vAxis], b[vAxis], c[vAxis]) / this.cellSize);
    const maxV = Math.floor(Math.max(a[vAxis], b[vAxis], c[vAxis]) / this.cellSize);
    const cellCount = (maxU - minU + 1) * (maxV - minV + 1);
    if (cellCount > 4_096) {
      this.overflowTriangles.push(triangleId);
      return;
    }
    for (let cellU = minU; cellU <= maxU; cellU += 1) {
      for (let cellV = minV; cellV <= maxV; cellV += 1) {
        const key = `${cellU},${cellV}`;
        const entries = this.cells.get(key) ?? [];
        entries.push(triangleId);
        this.cells.set(key, entries);
      }
    }
  }

  private cellKey(u: number, v: number): string {
    return `${Math.floor(u / this.cellSize)},${Math.floor(v / this.cellSize)}`;
  }
}

/**
 * Plan-binned index of the *steep* triangles, for first-person wall collision.
 *
 * The complement of `WalkSurfaceIndex`: that one keeps what you stand on, this
 * one keeps what you bump into. A walk step is under two feet, so the query
 * only ever opens the handful of cells the step sweeps — where the previous
 * implementation handed the whole scene to `Raycaster.intersectObjects` and
 * paid for every triangle of every batch on every frame.
 */
export class WalkCollisionIndex {
  readonly up: Axis;
  readonly cellSize: number;
  /** Triangles at least this far from horizontal are collidable. */
  readonly maxUpDot: number;

  private readonly axes: readonly [Axis, Axis];
  private readonly triangleData: number[] = [];
  private readonly cells = new Map<string, number[]>();
  private readonly overflowTriangles: number[] = [];
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly ab = new THREE.Vector3();
  private readonly ac = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly visited = new Set<number>();

  constructor({
    up = "y",
    cellSize = 4,
    maxUpDot = 0.85,
  }: {
    up?: Axis;
    cellSize?: number;
    maxUpDot?: number;
  } = {}) {
    this.up = up;
    this.cellSize = Math.max(0.25, cellSize);
    this.maxUpDot = THREE.MathUtils.clamp(maxUpDot, 0, 1);
    this.axes = projectedAxes(up);
  }

  addGeometry(
    geometry: THREE.BufferGeometry,
    matrix: THREE.Matrix4,
    range?: WalkGeometryRange,
  ): void {
    const positions = geometry.getAttribute("position");
    if (!positions) return;
    const index = geometry.getIndex();
    const count = index?.count ?? positions.count;
    const vertexIndex = (offset: number) => index ? index.getX(offset) : offset;
    const [firstOffset, lastOffset] = geometryOffsetRange(count, range);

    for (let offset = firstOffset; offset + 2 < lastOffset; offset += 3) {
      this.a.fromBufferAttribute(positions, vertexIndex(offset)).applyMatrix4(matrix);
      this.b.fromBufferAttribute(positions, vertexIndex(offset + 1)).applyMatrix4(matrix);
      this.c.fromBufferAttribute(positions, vertexIndex(offset + 2)).applyMatrix4(matrix);
      this.ab.subVectors(this.b, this.a);
      this.ac.subVectors(this.c, this.a);
      this.normal.crossVectors(this.ab, this.ac);
      const normalLength = this.normal.length();
      // A near-horizontal triangle is a floor or ceiling; the eye-height ray is
      // parallel to it anyway, so indexing it would only bloat the cells.
      if (normalLength < 1e-8
        || Math.abs(this.normal[this.up]) / normalLength > this.maxUpDot) continue;
      this.addTriangle(this.a, this.b, this.c);
    }
  }

  /**
   * Distance to the nearest triangle hit by the ray, or `null`. The direction
   * must be unit length; hits beyond `far` are ignored.
   */
  nearestHit(origin: THREE.Vector3, direction: THREE.Vector3, far: number): number | null {
    const [uAxis, vAxis] = this.axes;
    const minU = Math.min(origin[uAxis], origin[uAxis] + direction[uAxis] * far);
    const maxU = Math.max(origin[uAxis], origin[uAxis] + direction[uAxis] * far);
    const minV = Math.min(origin[vAxis], origin[vAxis] + direction[vAxis] * far);
    const maxV = Math.max(origin[vAxis], origin[vAxis] + direction[vAxis] * far);
    let best = Number.POSITIVE_INFINITY;

    const inspect = (triangleId: number) => {
      if (this.visited.has(triangleId)) return;
      this.visited.add(triangleId);
      const distance = this.rayTriangle(origin, direction, triangleId);
      if (distance != null && distance <= far && distance < best) best = distance;
    };

    this.visited.clear();
    const firstU = Math.floor(minU / this.cellSize);
    const lastU = Math.floor(maxU / this.cellSize);
    const firstV = Math.floor(minV / this.cellSize);
    const lastV = Math.floor(maxV / this.cellSize);
    for (let cellU = firstU; cellU <= lastU; cellU += 1) {
      for (let cellV = firstV; cellV <= lastV; cellV += 1) {
        const entries = this.cells.get(`${cellU},${cellV}`);
        if (entries) for (const triangleId of entries) inspect(triangleId);
      }
    }
    for (const triangleId of this.overflowTriangles) inspect(triangleId);
    return Number.isFinite(best) ? best : null;
  }

  stats(): WalkSurfaceStats {
    return {
      triangles: this.triangleData.length / 9,
      cells: this.cells.size,
      overflowTriangles: this.overflowTriangles.length,
    };
  }

  /** Möller–Trumbore against the stored world-space triangle. */
  private rayTriangle(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    triangleId: number,
  ): number | null {
    const base = triangleId * 9;
    const data = this.triangleData;
    const ax = data[base]!, ay = data[base + 1]!, az = data[base + 2]!;
    const e1x = data[base + 3]! - ax, e1y = data[base + 4]! - ay, e1z = data[base + 5]! - az;
    const e2x = data[base + 6]! - ax, e2y = data[base + 7]! - ay, e2z = data[base + 8]! - az;
    const px = direction.y * e2z - direction.z * e2y;
    const py = direction.z * e2x - direction.x * e2z;
    const pz = direction.x * e2y - direction.y * e2x;
    const determinant = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(determinant) < 1e-12) return null;
    const inverse = 1 / determinant;
    const tx = origin.x - ax, ty = origin.y - ay, tz = origin.z - az;
    const u = (tx * px + ty * py + tz * pz) * inverse;
    if (u < -1e-6 || u > 1 + 1e-6) return null;
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (direction.x * qx + direction.y * qy + direction.z * qz) * inverse;
    if (v < -1e-6 || u + v > 1 + 1e-6) return null;
    const distance = (e2x * qx + e2y * qy + e2z * qz) * inverse;
    return distance > 1e-6 ? distance : null;
  }

  private addTriangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
    const [uAxis, vAxis] = this.axes;
    const triangleId = this.triangleData.length / 9;
    this.triangleData.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);

    const minU = Math.floor(Math.min(a[uAxis], b[uAxis], c[uAxis]) / this.cellSize);
    const maxU = Math.floor(Math.max(a[uAxis], b[uAxis], c[uAxis]) / this.cellSize);
    const minV = Math.floor(Math.min(a[vAxis], b[vAxis], c[vAxis]) / this.cellSize);
    const maxV = Math.floor(Math.max(a[vAxis], b[vAxis], c[vAxis]) / this.cellSize);
    const cellCount = (maxU - minU + 1) * (maxV - minV + 1);
    if (cellCount > 4_096) {
      this.overflowTriangles.push(triangleId);
      return;
    }
    for (let cellU = minU; cellU <= maxU; cellU += 1) {
      for (let cellV = minV; cellV <= maxV; cellV += 1) {
        const key = `${cellU},${cellV}`;
        const entries = this.cells.get(key) ?? [];
        entries.push(triangleId);
        this.cells.set(key, entries);
      }
    }
  }
}
