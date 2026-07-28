/**
 * Neutral, browser-safe BRep-to-mesh boundary.
 *
 * The native TB_Geometry / TD_Ge / TD_Br stack presents geometry as oriented
 * faces, trimming loops, surfaces, transforms and per-face display attributes.
 * This IR keeps that boundary without depending on the native ABI. The
 * tessellator below deliberately supports only planar faces bounded by closed
 * line/polyline trims; curved surfaces and trims remain representable but are
 * rejected until their approximation tolerances are independently established.
 */
import { triangulate, type Point2 } from "./polygon.ts";

export type BrepPoint3 = readonly [number, number, number];
export type BrepMatrix4 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export type BrepProvenance = {
  decoderId: string;
  stream?: string;
  chunkIndex?: number;
  byteOffset?: number;
  classId?: number;
  elementId?: number;
  sourceId?: string;
};

export type BrepPlaneSurface = {
  kind: "plane";
  origin: BrepPoint3;
  uAxis: BrepPoint3;
  vAxis: BrepPoint3;
  normal: BrepPoint3;
};

export type BrepSurface =
  | BrepPlaneSurface
  | { kind: "cylinder"; origin: BrepPoint3; axis: BrepPoint3; radius: number }
  | { kind: "cone"; origin: BrepPoint3; axis: BrepPoint3; halfAngle: number }
  | {
      kind: "nurbs";
      degreeU: number;
      degreeV: number;
      controlPoints: readonly BrepPoint3[][];
      knotsU: readonly number[];
      knotsV: readonly number[];
    }
  | { kind: "unknown"; nativeType: string };

export type BrepTrimCurve =
  | { kind: "line"; start: BrepPoint3; end: BrepPoint3 }
  | { kind: "polyline"; points: readonly BrepPoint3[] }
  | {
      kind: "arc";
      center: BrepPoint3;
      normal: BrepPoint3;
      radius: number;
      startAngle: number;
      endAngle: number;
    }
  | {
      kind: "nurbs";
      degree: number;
      controlPoints: readonly BrepPoint3[];
      knots: readonly number[];
    };

export type BrepTrimLoop = {
  id: string;
  role: "outer" | "hole";
  curves: readonly BrepTrimCurve[];
};

export type NeutralBrepFace = {
  id: string;
  surface: BrepSurface;
  trims: readonly BrepTrimLoop[];
  /** Reverse the geometric surface normal for this oriented BRep face. */
  orientation?: 1 | -1;
  materialId?: string | number | null;
  objectMarker?: number;
  transform?: BrepMatrix4;
  provenance: BrepProvenance;
};

export type NeutralBrep = {
  id: string;
  faces: readonly NeutralBrepFace[];
  transform?: BrepMatrix4;
  provenance: BrepProvenance;
};

export type NeutralMeshFaceGroup = {
  faceId: string;
  indexOffset: number;
  indexCount: number;
  vertexOffset: number;
  vertexCount: number;
  materialId: string | number | null;
  objectMarker?: number;
  /** Composed column-major transform applied to this face's local positions. */
  sourceTransform: BrepMatrix4;
  brepProvenance: BrepProvenance;
  faceProvenance: BrepProvenance;
};

export type NeutralFaceMesh = {
  brepId: string;
  positions: Float64Array;
  normals: Float32Array;
  indices: Uint32Array;
  groups: NeutralMeshFaceGroup[];
};

export type BrepTessellationIssueCode =
  | "invalid-transform"
  | "invalid-plane"
  | "unsupported-surface"
  | "unsupported-trim-curve"
  | "open-loop"
  | "invalid-loop"
  | "non-planar-loop"
  | "invalid-hole"
  | "triangulation-failed";

export type BrepTessellationIssue = {
  code: BrepTessellationIssueCode;
  faceId: string;
  loopId?: string;
  message: string;
};

export type BrepTessellationResult =
  | { ok: true; mesh: NeutralFaceMesh }
  | { ok: false; issues: BrepTessellationIssue[] };

export type BrepTessellationOptions = {
  distanceTolerance?: number;
  angularTolerance?: number;
  areaTolerance?: number;
  maxFaces?: number;
  maxVertices?: number;
};

const IDENTITY: BrepMatrix4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

const DEFAULT_DISTANCE_TOLERANCE = 1e-7;
const DEFAULT_ANGULAR_TOLERANCE = 1e-7;
const DEFAULT_AREA_TOLERANCE = 1e-10;
const DEFAULT_MAX_FACES = 1_000_000;
const DEFAULT_MAX_VERTICES = 20_000_000;

type Vec3 = [number, number, number];

function finitePoint(point: BrepPoint3): boolean {
  return point.length === 3 && point.every(Number.isFinite);
}

function subtract(a: BrepPoint3, b: BrepPoint3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: BrepPoint3, b: BrepPoint3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: BrepPoint3, b: BrepPoint3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(vector: BrepPoint3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalized(vector: BrepPoint3): Vec3 | null {
  const magnitude = length(vector);
  if (!Number.isFinite(magnitude) || magnitude === 0) return null;
  const clean = (value: number): number => {
    const normalizedValue = value / magnitude;
    return Object.is(normalizedValue, -0) ? 0 : normalizedValue;
  };
  return [clean(vector[0]), clean(vector[1]), clean(vector[2])];
}

function samePoint(a: BrepPoint3, b: BrepPoint3, tolerance: number): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= tolerance;
}

function validTransform(matrix: BrepMatrix4, tolerance: number): boolean {
  return (
    matrix.length === 16 &&
    matrix.every(Number.isFinite) &&
    Math.abs(matrix[3]) <= tolerance &&
    Math.abs(matrix[7]) <= tolerance &&
    Math.abs(matrix[11]) <= tolerance &&
    Math.abs(matrix[15] - 1) <= tolerance
  );
}

/** Compose column-major affine transforms as `outer * inner`. */
function multiplyMatrix(outer: BrepMatrix4, inner: BrepMatrix4): BrepMatrix4 {
  const result = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let k = 0; k < 4; k += 1) {
        result[column * 4 + row] += outer[k * 4 + row]! * inner[column * 4 + k]!;
      }
    }
  }
  return result as unknown as BrepMatrix4;
}

function transformPoint(matrix: BrepMatrix4, point: BrepPoint3): Vec3 {
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ];
}

function loopPoints(
  faceId: string,
  loop: BrepTrimLoop,
  tolerance: number,
): { ok: true; points: BrepPoint3[] } | { ok: false; issue: BrepTessellationIssue } {
  const points: BrepPoint3[] = [];
  for (const curve of loop.curves) {
    if (curve.kind !== "line" && curve.kind !== "polyline") {
      return {
        ok: false,
        issue: {
          code: "unsupported-trim-curve",
          faceId,
          loopId: loop.id,
          message: `${curve.kind} trim curves require a verified approximation tolerance`,
        },
      };
    }
    const curvePoints =
      curve.kind === "line" ? [curve.start, curve.end] : [...curve.points];
    if (curvePoints.length < 2 || curvePoints.some((point) => !finitePoint(point))) {
      return {
        ok: false,
        issue: {
          code: "invalid-loop",
          faceId,
          loopId: loop.id,
          message: "trim curve has fewer than two finite points",
        },
      };
    }
    if (points.length && !samePoint(points.at(-1)!, curvePoints[0]!, tolerance)) {
      return {
        ok: false,
        issue: {
          code: "open-loop",
          faceId,
          loopId: loop.id,
          message: "consecutive trim curves do not share an endpoint",
        },
      };
    }
    points.push(...(points.length ? curvePoints.slice(1) : curvePoints));
  }
  if (points.length < 4 || !samePoint(points[0]!, points.at(-1)!, tolerance)) {
    return {
      ok: false,
      issue: {
        code: "open-loop",
        faceId,
        loopId: loop.id,
        message: "trim loop is not closed",
      },
    };
  }
  points.pop();
  if (points.length < 3) {
    return {
      ok: false,
      issue: {
        code: "invalid-loop",
        faceId,
        loopId: loop.id,
        message: "trim loop has fewer than three vertices",
      },
    };
  }
  for (let index = 0; index < points.length; index += 1) {
    if (samePoint(points[index]!, points[(index + 1) % points.length]!, tolerance)) {
      return {
        ok: false,
        issue: {
          code: "invalid-loop",
          faceId,
          loopId: loop.id,
          message: "trim loop contains a zero-length edge",
        },
      };
    }
  }
  return { ok: true, points };
}

function turn(a: Point2, b: Point2, c: Point2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: Point2, b: Point2, p: Point2, tolerance: number): boolean {
  return (
    Math.abs(turn(a, b, p)) <= tolerance &&
    p[0] >= Math.min(a[0], b[0]) - tolerance &&
    p[0] <= Math.max(a[0], b[0]) + tolerance &&
    p[1] >= Math.min(a[1], b[1]) - tolerance &&
    p[1] <= Math.max(a[1], b[1]) + tolerance
  );
}

function segmentsIntersect(
  a: Point2,
  b: Point2,
  c: Point2,
  d: Point2,
  tolerance: number,
): boolean {
  const abC = turn(a, b, c);
  const abD = turn(a, b, d);
  const cdA = turn(c, d, a);
  const cdB = turn(c, d, b);
  if (
    ((abC > tolerance && abD < -tolerance) || (abC < -tolerance && abD > tolerance)) &&
    ((cdA > tolerance && cdB < -tolerance) || (cdA < -tolerance && cdB > tolerance))
  ) {
    return true;
  }
  return (
    onSegment(a, b, c, tolerance) ||
    onSegment(a, b, d, tolerance) ||
    onSegment(c, d, a, tolerance) ||
    onSegment(c, d, b, tolerance)
  );
}

function simpleRing(ring: readonly Point2[], tolerance: number): boolean {
  for (let first = 0; first < ring.length; first += 1) {
    const firstNext = (first + 1) % ring.length;
    for (let second = first + 1; second < ring.length; second += 1) {
      const secondNext = (second + 1) % ring.length;
      if (
        first === second ||
        firstNext === second ||
        secondNext === first
      ) {
        continue;
      }
      if (
        segmentsIntersect(
          ring[first]!,
          ring[firstNext]!,
          ring[second]!,
          ring[secondNext]!,
          tolerance,
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

function signedArea(ring: readonly Point2[]): number {
  let twice = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const here = ring[index]!;
    const next = ring[(index + 1) % ring.length]!;
    twice += here[0] * next[1] - next[0] * here[1];
  }
  return twice / 2;
}

function pointInRingStrict(point: Point2, ring: readonly Point2[], tolerance: number): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[previous]!;
    const b = ring[index]!;
    if (onSegment(a, b, point, tolerance)) return false;
    if (a[1] > point[1] !== b[1] > point[1]) {
      const x = a[0] + ((point[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      if (point[0] < x) inside = !inside;
    }
  }
  return inside;
}

function ringsIntersect(a: readonly Point2[], b: readonly Point2[], tolerance: number): boolean {
  for (let ai = 0; ai < a.length; ai += 1) {
    for (let bi = 0; bi < b.length; bi += 1) {
      if (
        segmentsIntersect(
          a[ai]!,
          a[(ai + 1) % a.length]!,
          b[bi]!,
          b[(bi + 1) % b.length]!,
          tolerance,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function triangleArea(vertices: readonly Point2[], indices: readonly number[]): number {
  let area = 0;
  for (let index = 0; index < indices.length; index += 3) {
    area += Math.abs(
      turn(
        vertices[indices[index]!]!,
        vertices[indices[index + 1]!]!,
        vertices[indices[index + 2]!]!,
      ),
    ) / 2;
  }
  return area;
}

/**
 * Tessellate a complete BRep only when every face is a validated planar,
 * linearly-trimmed face. No partial mesh is returned on an unsupported face.
 */
export function tessellatePlanarBrep(
  brep: NeutralBrep,
  options: BrepTessellationOptions = {},
): BrepTessellationResult {
  const distanceTolerance = options.distanceTolerance ?? DEFAULT_DISTANCE_TOLERANCE;
  const angularTolerance = options.angularTolerance ?? DEFAULT_ANGULAR_TOLERANCE;
  const areaTolerance = options.areaTolerance ?? DEFAULT_AREA_TOLERANCE;
  const maxFaces = options.maxFaces ?? DEFAULT_MAX_FACES;
  const maxVertices = options.maxVertices ?? DEFAULT_MAX_VERTICES;
  const issues: BrepTessellationIssue[] = [];

  if (
    !Number.isFinite(distanceTolerance) ||
    distanceTolerance <= 0 ||
    !Number.isFinite(angularTolerance) ||
    angularTolerance <= 0 ||
    !Number.isFinite(areaTolerance) ||
    areaTolerance <= 0 ||
    !Number.isSafeInteger(maxFaces) ||
    maxFaces < 0 ||
    !Number.isSafeInteger(maxVertices) ||
    maxVertices < 0
  ) {
    return {
      ok: false,
      issues: [{
        code: "invalid-plane",
        faceId: "",
        message: "tessellation tolerances or safety bounds are invalid",
      }],
    };
  }
  if (brep.faces.length > maxFaces) {
    return {
      ok: false,
      issues: [{
        code: "invalid-loop",
        faceId: "",
        message: "face count exceeds the safety bound",
      }],
    };
  }

  const modelTransform = brep.transform ?? IDENTITY;
  if (!validTransform(modelTransform, distanceTolerance)) {
    return {
      ok: false,
      issues: [{
        code: "invalid-transform",
        faceId: "",
        message: "BRep transform is not a finite affine column-major matrix",
      }],
    };
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const groups: NeutralMeshFaceGroup[] = [];

  for (const face of brep.faces) {
    if (face.surface.kind !== "plane") {
      issues.push({
        code: "unsupported-surface",
        faceId: face.id,
        message: `${face.surface.kind} surfaces require a verified adaptive tessellator`,
      });
      continue;
    }
    const plane = face.surface;
    if (
      !finitePoint(plane.origin) ||
      !finitePoint(plane.uAxis) ||
      !finitePoint(plane.vAxis) ||
      !finitePoint(plane.normal)
    ) {
      issues.push({ code: "invalid-plane", faceId: face.id, message: "plane frame is not finite" });
      continue;
    }
    const u = normalized(plane.uAxis);
    const v = normalized(plane.vAxis);
    const normal = normalized(plane.normal);
    const computedNormal = u && v ? normalized(cross(u, v)) : null;
    if (
      !u ||
      !v ||
      !normal ||
      !computedNormal ||
      Math.abs(dot(u, v)) > angularTolerance ||
      1 - dot(computedNormal, normal) > angularTolerance
    ) {
      issues.push({
        code: "invalid-plane",
        faceId: face.id,
        message: "plane axes are degenerate, non-orthogonal, or disagree with the normal",
      });
      continue;
    }

    const faceTransform = face.transform ?? IDENTITY;
    if (!validTransform(faceTransform, distanceTolerance)) {
      issues.push({
        code: "invalid-transform",
        faceId: face.id,
        message: "face transform is not a finite affine column-major matrix",
      });
      continue;
    }
    const composedTransform = multiplyMatrix(modelTransform, faceTransform);
    const outerLoops = face.trims.filter((loop) => loop.role === "outer");
    const holeLoops = face.trims.filter((loop) => loop.role === "hole");
    if (outerLoops.length !== 1) {
      issues.push({
        code: "invalid-loop",
        faceId: face.id,
        message: "a planar face must contain exactly one outer trim loop",
      });
      continue;
    }

    const loop3d: BrepPoint3[][] = [];
    let loopFailed = false;
    for (const loop of [outerLoops[0]!, ...holeLoops]) {
      const decoded = loopPoints(face.id, loop, distanceTolerance);
      if (!decoded.ok) {
        issues.push(decoded.issue);
        loopFailed = true;
        break;
      }
      loop3d.push(decoded.points);
    }
    if (loopFailed) continue;

    const projected: Point2[][] = [];
    for (let loopIndex = 0; loopIndex < loop3d.length; loopIndex += 1) {
      const points = loop3d[loopIndex]!;
      const loop = loopIndex === 0 ? outerLoops[0]! : holeLoops[loopIndex - 1]!;
      const ring: Point2[] = [];
      for (const point of points) {
        const relative = subtract(point, plane.origin);
        if (Math.abs(dot(relative, normal)) > distanceTolerance) {
          issues.push({
            code: "non-planar-loop",
            faceId: face.id,
            loopId: loop.id,
            message: "trim vertex lies outside the face plane tolerance",
          });
          loopFailed = true;
          break;
        }
        ring.push([dot(relative, u), dot(relative, v)]);
      }
      if (loopFailed) break;
      if (
        Math.abs(signedArea(ring)) <= areaTolerance ||
        !simpleRing(ring, distanceTolerance)
      ) {
        issues.push({
          code: "invalid-loop",
          faceId: face.id,
          loopId: loop.id,
          message: "trim loop is degenerate or self-intersecting",
        });
        loopFailed = true;
        break;
      }
      projected.push(ring);
    }
    if (loopFailed) continue;

    const outer = projected[0]!;
    const holes = projected.slice(1);
    for (let index = 0; index < holes.length; index += 1) {
      const hole = holes[index]!;
      if (
        !pointInRingStrict(hole[0]!, outer, distanceTolerance) ||
        ringsIntersect(hole, outer, distanceTolerance)
      ) {
        issues.push({
          code: "invalid-hole",
          faceId: face.id,
          loopId: holeLoops[index]!.id,
          message: "hole is not strictly contained by the outer loop",
        });
        loopFailed = true;
        break;
      }
      for (let other = 0; other < index; other += 1) {
        if (
          ringsIntersect(hole, holes[other]!, distanceTolerance) ||
          pointInRingStrict(hole[0]!, holes[other]!, distanceTolerance) ||
          pointInRingStrict(holes[other]![0]!, hole, distanceTolerance)
        ) {
          issues.push({
            code: "invalid-hole",
            faceId: face.id,
            loopId: holeLoops[index]!.id,
            message: "hole intersects or contains another hole",
          });
          loopFailed = true;
          break;
        }
      }
      if (loopFailed) break;
    }
    if (loopFailed) continue;

    const localIndices = triangulate(outer, holes);
    const flat2d = projected.flat();
    const expectedArea =
      Math.abs(signedArea(outer)) -
      holes.reduce((sum, hole) => sum + Math.abs(signedArea(hole)), 0);
    const tessellatedArea = triangleArea(flat2d, localIndices);
    const allowedAreaError = Math.max(
      areaTolerance,
      expectedArea * Math.max(angularTolerance, Number.EPSILON),
    );
    if (
      localIndices.length < 3 ||
      localIndices.length % 3 !== 0 ||
      Math.abs(tessellatedArea - expectedArea) > allowedAreaError
    ) {
      issues.push({
        code: "triangulation-failed",
        faceId: face.id,
        message: "triangles do not cover the outer loop minus its holes",
      });
      continue;
    }

    const flat3d = loop3d.flat();
    if (positions.length / 3 + flat3d.length > maxVertices) {
      issues.push({
        code: "invalid-loop",
        faceId: face.id,
        message: "mesh vertex count exceeds the safety bound",
      });
      continue;
    }
    const vertexOffset = positions.length / 3;
    const indexOffset = indices.length;
    for (const point of flat3d) {
      positions.push(...transformPoint(composedTransform, point));
    }
    const oriented = face.orientation ?? 1;
    for (let index = 0; index < localIndices.length; index += 3) {
      const a = localIndices[index]!;
      const b = localIndices[index + 1]!;
      const c = localIndices[index + 2]!;
      if (oriented === 1) indices.push(vertexOffset + a, vertexOffset + b, vertexOffset + c);
      else indices.push(vertexOffset + a, vertexOffset + c, vertexOffset + b);
    }

    const first = indices[indexOffset]!;
    const second = indices[indexOffset + 1]!;
    const third = indices[indexOffset + 2]!;
    const pointAt = (index: number): Vec3 => [
      positions[index * 3]!,
      positions[index * 3 + 1]!,
      positions[index * 3 + 2]!,
    ];
    const worldNormal = normalized(
      cross(subtract(pointAt(second), pointAt(first)), subtract(pointAt(third), pointAt(first))),
    );
    if (!worldNormal) {
      issues.push({
        code: "triangulation-failed",
        faceId: face.id,
        message: "transformed face collapses to zero area",
      });
      positions.length -= flat3d.length * 3;
      indices.length = indexOffset;
      continue;
    }
    for (let index = 0; index < flat3d.length; index += 1) normals.push(...worldNormal);

    groups.push({
      faceId: face.id,
      indexOffset,
      indexCount: localIndices.length,
      vertexOffset,
      vertexCount: flat3d.length,
      materialId: face.materialId ?? null,
      objectMarker: face.objectMarker,
      sourceTransform: composedTransform,
      brepProvenance: { ...brep.provenance },
      faceProvenance: { ...face.provenance },
    });
  }

  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    mesh: {
      brepId: brep.id,
      positions: Float64Array.from(positions),
      normals: Float32Array.from(normals),
      indices: Uint32Array.from(indices),
      groups,
    },
  };
}
