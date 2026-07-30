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

  addGeometry(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): void {
    const positions = geometry.getAttribute("position");
    if (!positions) return;
    const index = geometry.getIndex();
    const count = index?.count ?? positions.count;
    const vertexIndex = (offset: number) => index ? index.getX(offset) : offset;

    for (let offset = 0; offset + 2 < count; offset += 3) {
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
