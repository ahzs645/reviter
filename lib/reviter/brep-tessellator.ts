/**
 * Neutral, browser-safe BRep-to-mesh boundary.
 *
 * The native TB_Geometry / TD_Ge / TD_Br stack presents geometry as oriented
 * faces, trimming loops, surfaces, transforms and per-face display attributes.
 * This IR keeps that boundary without depending on the native ABI. The
 * compatibility entry point supports planar faces bounded by closed 3D
 * line/polyline trims. The general entry point additionally supports the
 * independently bounded cylindrical-chart subset documented below.
 */
import {
  nativeCircularArcSegmentCount,
  nativeCylinderMaximumParamSteps,
  type NativeTessellationPolicy,
  type NativeTessellationResult,
} from "./native-tessellation-policy.ts";
import { triangulate, type Point2 } from "./polygon.ts";

export type BrepPoint3 = readonly [number, number, number];
export type BrepParamPoint2 = readonly [number, number];
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

/**
 * Analytic cylinder frame.
 *
 * Its native-style parameter convention is:
 * `P(u,v) = origin + radius*u*axis + radius*(cos(v)*xAxis + sin(v)*yAxis)`.
 * U is normalized axial distance; V is angle in radians.
 */
export type BrepCylinderSurface = {
  kind: "cylinder";
  origin: BrepPoint3;
  axis: BrepPoint3;
  xAxis: BrepPoint3;
  yAxis: BrepPoint3;
  radius: number;
};

export type BrepSurface =
  | BrepPlaneSurface
  | BrepCylinderSurface
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
  /** A straight p-curve in the owning surface's declared parameter space. */
  | { kind: "pcurve-line"; start: BrepParamPoint2; end: BrepParamPoint2 }
  /** A polyline p-curve in the owning surface's declared parameter space. */
  | { kind: "pcurve-polyline"; points: readonly BrepParamPoint2[] }
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
  | "invalid-options"
  | "invalid-transform"
  | "invalid-plane"
  | "invalid-cylinder"
  | "invalid-cylinder-chart"
  | "wrapping-cylinder-chart"
  | "missing-tessellation-policy"
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
  /**
   * Permit one four-edge outer trim with one proper crossing and tessellate
   * its two exact even-odd lobes. Disabled unless a format-specific caller has
   * independently certified the persisted line-edge topology.
   */
  allowSingleCrossingTrim?: boolean;
  /**
   * Native analytic limits required by curved faces. Planar tessellation does
   * not consult this policy.
   */
  nativePolicy?: Pick<
    NativeTessellationPolicy,
    "maximumEdgeLength" | "maximumAngleDegrees" | "surfaceDeviation"
  >;
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

function transformVector(matrix: BrepMatrix4, vector: BrepPoint3): Vec3 {
  return [
    matrix[0] * vector[0] + matrix[4] * vector[1] + matrix[8] * vector[2],
    matrix[1] * vector[0] + matrix[5] * vector[1] + matrix[9] * vector[2],
    matrix[2] * vector[0] + matrix[6] * vector[1] + matrix[10] * vector[2],
  ];
}

function finiteParamPoint(point: BrepParamPoint2): boolean {
  return point.length === 2 && point.every(Number.isFinite);
}

function sameParamPoint(
  a: BrepParamPoint2,
  b: BrepParamPoint2,
  uTolerance: number,
  vTolerance: number,
): boolean {
  return (
    Math.abs(a[0] - b[0]) <= uTolerance &&
    Math.abs(a[1] - b[1]) <= vTolerance
  );
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

function loopParamPoints(
  faceId: string,
  loop: BrepTrimLoop,
  uTolerance: number,
  vTolerance: number,
): { ok: true; points: BrepParamPoint2[] } | { ok: false; issue: BrepTessellationIssue } {
  const points: BrepParamPoint2[] = [];
  for (const curve of loop.curves) {
    if (curve.kind !== "pcurve-line" && curve.kind !== "pcurve-polyline") {
      return {
        ok: false,
        issue: {
          code: "unsupported-trim-curve",
          faceId,
          loopId: loop.id,
          message: `${curve.kind} is not an explicit cylinder p-curve`,
        },
      };
    }
    const curvePoints =
      curve.kind === "pcurve-line" ? [curve.start, curve.end] : [...curve.points];
    if (curvePoints.length < 2 || curvePoints.some((point) => !finiteParamPoint(point))) {
      return {
        ok: false,
        issue: {
          code: "invalid-cylinder-chart",
          faceId,
          loopId: loop.id,
          message: "cylinder p-curve has fewer than two finite parameter points",
        },
      };
    }
    if (
      points.length &&
      !sameParamPoint(points.at(-1)!, curvePoints[0]!, uTolerance, vTolerance)
    ) {
      return {
        ok: false,
        issue: {
          code: "open-loop",
          faceId,
          loopId: loop.id,
          message: "consecutive cylinder p-curves do not share an endpoint",
        },
      };
    }
    points.push(...(points.length ? curvePoints.slice(1) : curvePoints));
  }
  if (
    points.length < 4 ||
    !sameParamPoint(points[0]!, points.at(-1)!, uTolerance, vTolerance)
  ) {
    return {
      ok: false,
      issue: {
        code: "open-loop",
        faceId,
        loopId: loop.id,
        message: "cylinder p-curve loop is not closed",
      },
    };
  }
  points.pop();
  for (let index = 0; index < points.length; index += 1) {
    if (
      sameParamPoint(
        points[index]!,
        points[(index + 1) % points.length]!,
        uTolerance,
        vTolerance,
      )
    ) {
      return {
        ok: false,
        issue: {
          code: "invalid-cylinder-chart",
          faceId,
          loopId: loop.id,
          message: "cylinder p-curve loop contains a zero-length edge",
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

type SingleCrossingSplit = {
  points2d: Point2[];
  points3d: BrepPoint3[];
  indices: number[];
  area: number;
};

function properSegmentIntersection(
  a: Point2,
  b: Point2,
  c: Point2,
  d: Point2,
  tolerance: number,
): { point: Point2; firstParameter: number } | null {
  const ab = [b[0] - a[0], b[1] - a[1]] as const;
  const cd = [d[0] - c[0], d[1] - c[1]] as const;
  const denominator = ab[0] * cd[1] - ab[1] * cd[0];
  const scale = Math.hypot(...ab) * Math.hypot(...cd);
  if (
    !Number.isFinite(scale) ||
    scale === 0 ||
    Math.abs(denominator) <= tolerance * scale
  ) {
    return null;
  }
  const delta = [c[0] - a[0], c[1] - a[1]] as const;
  const firstParameter =
    (delta[0] * cd[1] - delta[1] * cd[0]) / denominator;
  const secondParameter =
    (delta[0] * ab[1] - delta[1] * ab[0]) / denominator;
  if (
    firstParameter <= tolerance ||
    firstParameter >= 1 - tolerance ||
    secondParameter <= tolerance ||
    secondParameter >= 1 - tolerance
  ) {
    return null;
  }
  return {
    point: [
      a[0] + firstParameter * ab[0],
      a[1] + firstParameter * ab[1],
    ],
    firstParameter,
  };
}

function splitSingleCrossingQuad(
  ring2d: readonly Point2[],
  ring3d: readonly BrepPoint3[],
  tolerance: number,
): SingleCrossingSplit | null {
  if (ring2d.length !== 4 || ring3d.length !== 4) return null;
  const candidates = [
    { first: 0, second: 2 },
    { first: 1, second: 3 },
  ].flatMap(({ first, second }) => {
    const intersection = properSegmentIntersection(
      ring2d[first]!,
      ring2d[(first + 1) % 4]!,
      ring2d[second]!,
      ring2d[(second + 1) % 4]!,
      tolerance,
    );
    return intersection ? [{ first, second, intersection }] : [];
  });
  if (candidates.length !== 1) return null;
  const { first, second, intersection } = candidates[0]!;
  const firstNext = (first + 1) % 4;
  const secondNext = (second + 1) % 4;
  const intersection3d: BrepPoint3 = [
    ring3d[first]![0] +
      (ring3d[firstNext]![0] - ring3d[first]![0]) *
        intersection.firstParameter,
    ring3d[first]![1] +
      (ring3d[firstNext]![1] - ring3d[first]![1]) *
        intersection.firstParameter,
    ring3d[first]![2] +
      (ring3d[firstNext]![2] - ring3d[first]![2]) *
        intersection.firstParameter,
  ];
  const points2d = [
    intersection.point,
    ring2d[firstNext]!,
    ring2d[second]!,
    ring2d[secondNext]!,
    ring2d[first]!,
  ];
  const points3d = [
    intersection3d,
    ring3d[firstNext]!,
    ring3d[second]!,
    ring3d[secondNext]!,
    ring3d[first]!,
  ];
  const firstTurn = turn(points2d[0]!, points2d[1]!, points2d[2]!);
  const secondTurn = turn(points2d[0]!, points2d[3]!, points2d[4]!);
  if (
    Math.abs(firstTurn) <= tolerance ||
    Math.abs(secondTurn) <= tolerance
  ) {
    return null;
  }
  const indices = [
    ...(firstTurn > 0 ? [0, 1, 2] : [0, 2, 1]),
    ...(secondTurn > 0 ? [0, 3, 4] : [0, 4, 3]),
  ];
  return {
    points2d,
    points3d,
    indices,
    area: (Math.abs(firstTurn) + Math.abs(secondTurn)) / 2,
  };
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

function clusteredCoordinates(
  values: readonly number[],
  tolerance: number,
): number[] {
  const sorted = [...values].sort((left, right) => left - right);
  const clustered: number[] = [];
  for (const value of sorted) {
    if (
      clustered.length === 0 ||
      value - clustered.at(-1)! > tolerance
    ) {
      clustered.push(value);
    }
  }
  return clustered;
}

function nearestCoordinate(
  coordinates: readonly number[],
  value: number,
  tolerance: number,
): number | null {
  let nearest: number | null = null;
  let distance = Infinity;
  for (const coordinate of coordinates) {
    const candidate = Math.abs(coordinate - value);
    if (candidate < distance) {
      distance = candidate;
      nearest = coordinate;
    }
  }
  return distance <= tolerance ? nearest : null;
}

function refinedLinearCoordinates(
  coordinates: readonly number[],
  maximumStep: number,
  maximumCoordinates: number,
): number[] | null {
  const refined: number[] = [];
  for (let index = 0; index + 1 < coordinates.length; index += 1) {
    const first = coordinates[index]!;
    const second = coordinates[index + 1]!;
    const segments = maximumStep > 0
      ? Math.max(1, Math.ceil((second - first) / maximumStep))
      : 1;
    if (
      !Number.isSafeInteger(segments) ||
      refined.length + segments + 1 > maximumCoordinates
    ) {
      return null;
    }
    if (index === 0) refined.push(first);
    for (let segment = 1; segment <= segments; segment += 1) {
      refined.push(first + ((second - first) * segment) / segments);
    }
  }
  return refined;
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
  const allowSingleCrossingTrim = options.allowSingleCrossingTrim ?? false;
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
    maxVertices < 0 ||
    typeof allowSingleCrossingTrim !== "boolean"
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
    let singleCrossingSplit: SingleCrossingSplit | null = null;
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
      const simple = simpleRing(ring, distanceTolerance);
      const split =
        !simple &&
          allowSingleCrossingTrim &&
          loopIndex === 0 &&
          loop3d.length === 1 &&
          holeLoops.length === 0
          ? splitSingleCrossingQuad(
              ring,
              points,
              distanceTolerance,
            )
          : null;
      if (
        (!split && !simple) ||
        (!split && Math.abs(signedArea(ring)) <= areaTolerance)
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
      if (split) singleCrossingSplit = split;
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

    const localIndices = singleCrossingSplit
      ? singleCrossingSplit.indices
      : triangulate(outer, holes);
    const flat2d = singleCrossingSplit
      ? singleCrossingSplit.points2d
      : projected.flat();
    const expectedArea = singleCrossingSplit
      ? singleCrossingSplit.area
      : Math.abs(signedArea(outer)) -
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

    const flat3d = singleCrossingSplit
      ? singleCrossingSplit.points3d
      : loop3d.flat();
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

function tessellateOrthogonalCylinderChart(
  brep: NeutralBrep,
  face: NeutralBrepFace & { surface: BrepCylinderSurface },
  charts: {
    outer: readonly BrepParamPoint2[];
    holes: readonly (readonly BrepParamPoint2[])[];
  },
  frame: {
    axis: Vec3;
    xAxis: Vec3;
    yAxis: Vec3;
  },
  composedTransform: BrepMatrix4,
  policy: Pick<
    NativeTessellationPolicy,
    "maximumEdgeLength" | "maximumAngleDegrees" | "surfaceDeviation"
  >,
  options: {
    uTolerance: number;
    angularTolerance: number;
    areaTolerance: number;
    maxVertices: number;
    maximumUStep: number;
  },
): BrepTessellationResult {
  const { surface: cylinder } = face;
  const {
    uTolerance,
    angularTolerance,
    areaTolerance,
    maxVertices,
    maximumUStep,
  } = options;
  const outerLoop = face.trims.find((loop) => loop.role === "outer");
  const holeLoops = face.trims.filter((loop) => loop.role === "hole");
  const loopId = outerLoop?.id;
  const issue = (
    code: BrepTessellationIssueCode,
    message: string,
  ): BrepTessellationResult => ({
    ok: false,
    issues: [{ code, faceId: face.id, loopId, message }],
  });

  const uCoordinates = clusteredCoordinates(
    [charts.outer, ...charts.holes]
      .flat()
      .map((point) => point[0]),
    uTolerance,
  );
  const vCoordinates = clusteredCoordinates(
    [charts.outer, ...charts.holes]
      .flat()
      .map((point) => point[1]),
    angularTolerance,
  );
  if (uCoordinates.length < 2 || vCoordinates.length < 2) {
    return issue(
      "invalid-cylinder-chart",
      "orthogonal cylinder chart has fewer than two coordinates per axis",
    );
  }

  const snappedCharts: Point2[][] = [];
  for (const chart of [charts.outer, ...charts.holes]) {
    const snapped: Point2[] = [];
    for (const point of chart) {
      const u = nearestCoordinate(uCoordinates, point[0], uTolerance);
      const v = nearestCoordinate(vCoordinates, point[1], angularTolerance);
      if (u == null || v == null) {
        return issue(
          "invalid-cylinder-chart",
          "cylinder p-curve cannot be snapped within its declared tolerances",
        );
      }
      snapped.push([u, v]);
    }
    snappedCharts.push(snapped);
  }
  const chartTolerance = Math.max(uTolerance, angularTolerance);
  const minimumArea = Math.max(
    areaTolerance,
    uTolerance * angularTolerance,
  );
  for (let index = 0; index < snappedCharts.length; index += 1) {
    const ring = snappedCharts[index]!;
    if (
      Math.abs(signedArea(ring)) <= minimumArea ||
      !simpleRing(ring, chartTolerance)
    ) {
      return {
        ok: false,
        issues: [{
          code: "invalid-cylinder-chart",
          faceId: face.id,
          loopId: index === 0 ? loopId : holeLoops[index - 1]?.id,
          message:
            "orthogonal cylinder p-curve is degenerate or self-intersecting",
        }],
      };
    }
  }
  const snappedOuter = snappedCharts[0]!;
  const snappedHoles = snappedCharts.slice(1);
  for (let index = 0; index < snappedHoles.length; index += 1) {
    const hole = snappedHoles[index]!;
    if (
      !pointInRingStrict(hole[0]!, snappedOuter, chartTolerance) ||
      ringsIntersect(hole, snappedOuter, chartTolerance)
    ) {
      return {
        ok: false,
        issues: [{
          code: "invalid-hole",
          faceId: face.id,
          loopId: holeLoops[index]?.id,
          message:
            "cylinder hole is not strictly contained by the outer p-curve",
        }],
      };
    }
    for (let other = 0; other < index; other += 1) {
      if (
        ringsIntersect(hole, snappedHoles[other]!, chartTolerance) ||
        pointInRingStrict(hole[0]!, snappedHoles[other]!, chartTolerance) ||
        pointInRingStrict(
          snappedHoles[other]![0]!,
          hole,
          chartTolerance,
        )
      ) {
        return {
          ok: false,
          issues: [{
            code: "invalid-hole",
            faceId: face.id,
            loopId: holeLoops[index]?.id,
            message: "cylinder holes intersect or contain one another",
          }],
        };
      }
    }
  }
  const expectedArea =
    Math.abs(signedArea(snappedOuter)) -
    snappedHoles.reduce(
      (sum, hole) => sum + Math.abs(signedArea(hole)),
      0,
    );
  if (expectedArea <= minimumArea) {
    return issue(
      "invalid-hole",
      "cylinder holes consume or exceed the outer p-curve area",
    );
  }

  const refinedU = refinedLinearCoordinates(
    uCoordinates,
    maximumUStep,
    maxVertices,
  );
  if (!refinedU) {
    return issue(
      "invalid-cylinder-chart",
      "cylindrical axial grid exceeds the safety bound",
    );
  }
  const refinedV: number[] = [];
  for (let index = 0; index + 1 < vCoordinates.length; index += 1) {
    const first = vCoordinates[index]!;
    const second = vCoordinates[index + 1]!;
    const segmented = nativeCircularArcSegmentCount(
      cylinder.radius,
      second - first,
      policy,
      { minimumSegments: 1, maximumSegments: Math.max(1, maxVertices) },
    );
    if (!segmented.ok) {
      return issue("invalid-options", segmented.error);
    }
    if (
      refinedV.length + segmented.value + 1 > maxVertices
    ) {
      return issue(
        "invalid-cylinder-chart",
        "cylindrical angular grid exceeds the safety bound",
      );
    }
    if (index === 0) refinedV.push(first);
    for (let segment = 1; segment <= segmented.value; segment += 1) {
      refinedV.push(
        first + ((second - first) * segment) / segmented.value,
      );
    }
  }
  if (
    refinedU.length * refinedV.length > maxVertices ||
    refinedU.length < 2 ||
    refinedV.length < 2
  ) {
    return issue(
      "invalid-cylinder-chart",
      "cylindrical mesh vertex grid exceeds the safety bound",
    );
  }

  const activeCells: { uIndex: number; vIndex: number }[] = [];
  let coveredArea = 0;
  for (let uIndex = 0; uIndex + 1 < refinedU.length; uIndex += 1) {
    const u0 = refinedU[uIndex]!;
    const u1 = refinedU[uIndex + 1]!;
    for (let vIndex = 0; vIndex + 1 < refinedV.length; vIndex += 1) {
      const v0 = refinedV[vIndex]!;
      const v1 = refinedV[vIndex + 1]!;
      if (
        !pointInRingStrict(
          [(u0 + u1) / 2, (v0 + v1) / 2],
          snappedOuter,
          chartTolerance,
        ) ||
        snappedHoles.some((hole) =>
          pointInRingStrict(
            [(u0 + u1) / 2, (v0 + v1) / 2],
            hole,
            chartTolerance,
          )
        )
      ) {
        continue;
      }
      activeCells.push({ uIndex, vIndex });
      coveredArea += (u1 - u0) * (v1 - v0);
    }
  }
  const allowedAreaError = Math.max(
    areaTolerance,
    expectedArea * Math.max(chartTolerance, Number.EPSILON),
  );
  if (
    activeCells.length === 0 ||
    Math.abs(coveredArea - expectedArea) > allowedAreaError
  ) {
    return issue(
      "triangulation-failed",
      "orthogonal cylinder grid does not cover the persisted p-curve area",
    );
  }

  const oriented = face.orientation ?? 1;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const vertexByGridPoint = new Map<string, number>();
  const vertex = (
    uIndex: number,
    vIndex: number,
  ): NativeTessellationResult<number> => {
    const key = `${uIndex},${vIndex}`;
    const existing = vertexByGridPoint.get(key);
    if (existing != null) return { ok: true, value: existing };
    if (vertexByGridPoint.size >= maxVertices) {
      return {
        ok: false,
        error: "cylindrical mesh vertex count exceeds the safety bound",
      };
    }
    const u = refinedU[uIndex]!;
    const v = refinedV[vIndex]!;
    const cosine = Math.cos(v);
    const sine = Math.sin(v);
    const radial: Vec3 = [
      cosine * frame.xAxis[0] + sine * frame.yAxis[0],
      cosine * frame.xAxis[1] + sine * frame.yAxis[1],
      cosine * frame.xAxis[2] + sine * frame.yAxis[2],
    ];
    const point: Vec3 = [
      cylinder.origin[0] +
        cylinder.radius * (u * frame.axis[0] + radial[0]),
      cylinder.origin[1] +
        cylinder.radius * (u * frame.axis[1] + radial[1]),
      cylinder.origin[2] +
        cylinder.radius * (u * frame.axis[2] + radial[2]),
    ];
    const dV: Vec3 = [
      cylinder.radius *
        (-sine * frame.xAxis[0] + cosine * frame.yAxis[0]),
      cylinder.radius *
        (-sine * frame.xAxis[1] + cosine * frame.yAxis[1]),
      cylinder.radius *
        (-sine * frame.xAxis[2] + cosine * frame.yAxis[2]),
    ];
    const dU: Vec3 = [
      cylinder.radius * frame.axis[0],
      cylinder.radius * frame.axis[1],
      cylinder.radius * frame.axis[2],
    ];
    const worldNormal = normalized(
      cross(
        transformVector(composedTransform, dV),
        transformVector(composedTransform, dU),
      ),
    );
    if (!worldNormal) {
      return {
        ok: false,
        error: "transformed cylindrical face collapses to zero area",
      };
    }
    const index = positions.length / 3;
    positions.push(...transformPoint(composedTransform, point));
    normals.push(
      ...worldNormal.map((component) => {
        const value = component * oriented;
        return Object.is(value, -0) ? 0 : value;
      }),
    );
    vertexByGridPoint.set(key, index);
    return { ok: true, value: index };
  };

  for (const { uIndex, vIndex } of activeCells) {
    const a = vertex(uIndex, vIndex);
    const b = vertex(uIndex + 1, vIndex);
    const c = vertex(uIndex + 1, vIndex + 1);
    const d = vertex(uIndex, vIndex + 1);
    const failed = [a, b, c, d].find((candidate) => !candidate.ok);
    if (failed && !failed.ok) {
      return issue("invalid-cylinder-chart", failed.error);
    }
    if (!a.ok || !b.ok || !c.ok || !d.ok) {
      return issue(
        "invalid-cylinder-chart",
        "cylindrical vertex construction failed",
      );
    }
    if (oriented === 1) {
      indices.push(a.value, c.value, b.value, a.value, d.value, c.value);
    } else {
      indices.push(a.value, b.value, c.value, a.value, c.value, d.value);
    }
  }

  return {
    ok: true,
    mesh: {
      brepId: brep.id,
      positions: Float64Array.from(positions),
      normals: Float32Array.from(normals),
      indices: Uint32Array.from(indices),
      groups: [{
        faceId: face.id,
        indexOffset: 0,
        indexCount: indices.length,
        vertexOffset: 0,
        vertexCount: positions.length / 3,
        materialId: face.materialId ?? null,
        objectMarker: face.objectMarker,
        sourceTransform: composedTransform,
        brepProvenance: { ...brep.provenance },
        faceProvenance: { ...face.provenance },
      }],
    },
  };
}

/**
 * Tessellate the narrow sampled-pcurve cylinder subset proved by persisted
 * GEdge samples. Unlike the orthogonal chart path, this admits one simple
 * outer polyline with a sampled diagonal segment (for example a
 * plane-cylinder intersection). Boundary segments are never invented: every
 * persisted segment must already satisfy the active native policy. Only
 * interior triangulation edges may be bisected to meet that policy.
 */
function tessellateSampledCylinderChart(
  brep: NeutralBrep,
  face: NeutralBrepFace & { surface: BrepCylinderSurface },
  chart: readonly BrepParamPoint2[],
  frame: {
    axis: Vec3;
    xAxis: Vec3;
    yAxis: Vec3;
  },
  composedTransform: BrepMatrix4,
  policy: Pick<
    NativeTessellationPolicy,
    "maximumEdgeLength" | "maximumAngleDegrees" | "surfaceDeviation"
  >,
  options: {
    uTolerance: number;
    angularTolerance: number;
    areaTolerance: number;
    maxVertices: number;
    maximumUStep: number;
  },
): BrepTessellationResult {
  const { surface: cylinder } = face;
  const {
    uTolerance,
    angularTolerance,
    areaTolerance,
    maxVertices,
    maximumUStep,
  } = options;
  const loopId = face.trims.find((loop) => loop.role === "outer")?.id;
  const issue = (
    code: BrepTessellationIssueCode,
    message: string,
  ): BrepTessellationResult => ({
    ok: false,
    issues: [{ code, faceId: face.id, loopId, message }],
  });
  const chartTolerance = Math.max(uTolerance, angularTolerance);
  const expectedArea = Math.abs(
    signedArea(chart as readonly Point2[]),
  );
  const minimumArea = Math.max(
    areaTolerance,
    uTolerance * angularTolerance,
  );
  if (
    expectedArea <= minimumArea ||
    !simpleRing(chart as readonly Point2[], chartTolerance)
  ) {
    return issue(
      "invalid-cylinder-chart",
      "sampled cylinder p-curve is degenerate or self-intersecting",
    );
  }

  const localIndices = triangulate(chart as readonly Point2[]);
  const tessellatedArea = triangleArea(
    chart as readonly Point2[],
    localIndices,
  );
  const allowedAreaError = Math.max(
    areaTolerance,
    expectedArea * Math.max(chartTolerance, Number.EPSILON),
  );
  if (
    localIndices.length < 3 ||
    localIndices.length % 3 !== 0 ||
    Math.abs(tessellatedArea - expectedArea) > allowedAreaError
  ) {
    return issue(
      "triangulation-failed",
      "triangles do not cover the sampled cylinder p-curve",
    );
  }

  const vertices = chart.map(
    (point): Point2 => [point[0], point[1]],
  );
  let triangles: [number, number, number][] = [];
  for (let index = 0; index < localIndices.length; index += 3) {
    triangles.push([
      localIndices[index]!,
      localIndices[index + 1]!,
      localIndices[index + 2]!,
    ]);
  }
  const boundaryEdges = new Set<string>();
  const edgeKey = (a: number, b: number): string =>
    a < b ? `${a}:${b}` : `${b}:${a}`;
  for (let index = 0; index < chart.length; index += 1) {
    boundaryEdges.add(edgeKey(index, (index + 1) % chart.length));
  }
  const edgeRequiresSplit = (
    a: number,
    b: number,
  ): NativeTessellationResult<boolean> => {
    const first = vertices[a]!;
    const second = vertices[b]!;
    if (
      maximumUStep > 0 &&
      Math.abs(second[0] - first[0]) >
        maximumUStep * (1 + Number.EPSILON * 8)
    ) {
      return { ok: true, value: true };
    }
    const angularSpan = Math.abs(second[1] - first[1]);
    if (angularSpan <= angularTolerance) {
      return { ok: true, value: false };
    }
    const angular = nativeCircularArcSegmentCount(
      cylinder.radius,
      angularSpan,
      policy,
      {
        minimumSegments: 1,
        maximumSegments: Math.max(1, maxVertices),
      },
    );
    if (!angular.ok) return angular;
    return { ok: true, value: angular.value > 1 };
  };

  while (true) {
    let split: readonly [number, number] | null = null;
    const seen = new Set<string>();
    for (const triangle of triangles) {
      for (let side = 0; side < 3; side += 1) {
        const a = triangle[side]!;
        const b = triangle[(side + 1) % 3]!;
        const key = edgeKey(a, b);
        if (seen.has(key)) continue;
        seen.add(key);
        const required = edgeRequiresSplit(a, b);
        if (!required.ok) return issue("invalid-options", required.error);
        if (required.value) {
          if (boundaryEdges.has(key)) {
            const first = vertices[a]!;
            const second = vertices[b]!;
            return issue(
              "invalid-cylinder-chart",
              "persisted sampled cylinder boundary exceeds the native policy " +
                `(du=${Math.abs(second[0] - first[0])}, ` +
                `dv=${Math.abs(second[1] - first[1])})`,
            );
          }
          split = [a, b];
          break;
        }
      }
      if (split) break;
    }
    if (!split) break;
    if (vertices.length >= maxVertices) {
      return issue(
        "invalid-cylinder-chart",
        "sampled cylindrical mesh vertex count exceeds the safety bound",
      );
    }
    const [splitA, splitB] = split;
    const first = vertices[splitA]!;
    const second = vertices[splitB]!;
    const midpoint = vertices.length;
    vertices.push([
      (first[0] + second[0]) / 2,
      (first[1] + second[1]) / 2,
    ]);
    const nextTriangles: [number, number, number][] = [];
    for (const triangle of triangles) {
      let matched = false;
      for (let side = 0; side < 3; side += 1) {
        const a = triangle[side]!;
        const b = triangle[(side + 1) % 3]!;
        if (
          !(
            (a === splitA && b === splitB) ||
            (a === splitB && b === splitA)
          )
        ) {
          continue;
        }
        const third = triangle[(side + 2) % 3]!;
        nextTriangles.push(
          [a, midpoint, third],
          [midpoint, b, third],
        );
        matched = true;
        break;
      }
      if (!matched) nextTriangles.push(triangle);
    }
    triangles = nextTriangles;
  }

  if (vertices.length > maxVertices) {
    return issue(
      "invalid-cylinder-chart",
      "sampled cylindrical mesh vertex count exceeds the safety bound",
    );
  }
  const oriented = face.orientation ?? 1;
  const positions: number[] = [];
  const normals: number[] = [];
  for (const [u, v] of vertices) {
    const cosine = Math.cos(v);
    const sine = Math.sin(v);
    const radial: Vec3 = [
      cosine * frame.xAxis[0] + sine * frame.yAxis[0],
      cosine * frame.xAxis[1] + sine * frame.yAxis[1],
      cosine * frame.xAxis[2] + sine * frame.yAxis[2],
    ];
    const point: Vec3 = [
      cylinder.origin[0] +
        cylinder.radius * (u * frame.axis[0] + radial[0]),
      cylinder.origin[1] +
        cylinder.radius * (u * frame.axis[1] + radial[1]),
      cylinder.origin[2] +
        cylinder.radius * (u * frame.axis[2] + radial[2]),
    ];
    positions.push(...transformPoint(composedTransform, point));
    const dV: Vec3 = [
      cylinder.radius *
        (-sine * frame.xAxis[0] + cosine * frame.yAxis[0]),
      cylinder.radius *
        (-sine * frame.xAxis[1] + cosine * frame.yAxis[1]),
      cylinder.radius *
        (-sine * frame.xAxis[2] + cosine * frame.yAxis[2]),
    ];
    const dU: Vec3 = [
      cylinder.radius * frame.axis[0],
      cylinder.radius * frame.axis[1],
      cylinder.radius * frame.axis[2],
    ];
    const worldNormal = normalized(
      cross(
        transformVector(composedTransform, dV),
        transformVector(composedTransform, dU),
      ),
    );
    if (!worldNormal) {
      return issue(
        "triangulation-failed",
        "transformed sampled cylinder face collapses to zero area",
      );
    }
    normals.push(
      ...worldNormal.map((component) => {
        const value = component * oriented;
        return Object.is(value, -0) ? 0 : value;
      }),
    );
  }
  const indices: number[] = [];
  for (const [a, b, c] of triangles) {
    if (oriented === 1) indices.push(a, c, b);
    else indices.push(a, b, c);
  }
  return {
    ok: true,
    mesh: {
      brepId: brep.id,
      positions: Float64Array.from(positions),
      normals: Float32Array.from(normals),
      indices: Uint32Array.from(indices),
      groups: [{
        faceId: face.id,
        indexOffset: 0,
        indexCount: indices.length,
        vertexOffset: 0,
        vertexCount: vertices.length,
        materialId: face.materialId ?? null,
        objectMarker: face.objectMarker,
        sourceTransform: composedTransform,
        brepProvenance: { ...brep.provenance },
        faceProvenance: { ...face.provenance },
      }],
    },
  };
}

function tessellateCylinderFace(
  brep: NeutralBrep,
  face: NeutralBrepFace,
  options: BrepTessellationOptions,
): BrepTessellationResult {
  if (face.surface.kind !== "cylinder") {
    return {
      ok: false,
      issues: [{
        code: "unsupported-surface",
        faceId: face.id,
        message: `${face.surface.kind} is not a cylinder`,
      }],
    };
  }
  const distanceTolerance = options.distanceTolerance ?? DEFAULT_DISTANCE_TOLERANCE;
  const angularTolerance = options.angularTolerance ?? DEFAULT_ANGULAR_TOLERANCE;
  const areaTolerance = options.areaTolerance ?? DEFAULT_AREA_TOLERANCE;
  const maxVertices = options.maxVertices ?? DEFAULT_MAX_VERTICES;
  const cylinder = face.surface;

  if (
    !finitePoint(cylinder.origin) ||
    !finitePoint(cylinder.axis) ||
    !finitePoint(cylinder.xAxis) ||
    !finitePoint(cylinder.yAxis) ||
    !Number.isFinite(cylinder.radius) ||
    cylinder.radius <= Math.max(distanceTolerance, 1e-10)
  ) {
    return {
      ok: false,
      issues: [{
        code: "invalid-cylinder",
        faceId: face.id,
        message: "cylinder frame or radius is not finite and positive",
      }],
    };
  }

  const axis = normalized(cylinder.axis);
  const xAxis = normalized(cylinder.xAxis);
  const yAxis = normalized(cylinder.yAxis);
  const computedYAxis = axis && xAxis ? normalized(cross(axis, xAxis)) : null;
  if (
    !axis ||
    !xAxis ||
    !yAxis ||
    !computedYAxis ||
    Math.abs(dot(axis, xAxis)) > angularTolerance ||
    Math.abs(dot(axis, yAxis)) > angularTolerance ||
    Math.abs(dot(xAxis, yAxis)) > angularTolerance ||
    1 - dot(computedYAxis, yAxis) > angularTolerance
  ) {
    return {
      ok: false,
      issues: [{
        code: "invalid-cylinder",
        faceId: face.id,
        message: "cylinder axes are degenerate, non-orthogonal, or not right-handed",
      }],
    };
  }

  const modelTransform = brep.transform ?? IDENTITY;
  const faceTransform = face.transform ?? IDENTITY;
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
  if (!validTransform(faceTransform, distanceTolerance)) {
    return {
      ok: false,
      issues: [{
        code: "invalid-transform",
        faceId: face.id,
        message: "face transform is not a finite affine column-major matrix",
      }],
    };
  }

  const outerLoops = face.trims.filter((loop) => loop.role === "outer");
  const holeLoops = face.trims.filter((loop) => loop.role === "hole");
  if (outerLoops.length !== 1) {
    return {
      ok: false,
      issues: [{
        code: "invalid-cylinder-chart",
        faceId: face.id,
        message: "a cylindrical face must contain exactly one outer p-curve loop",
      }],
    };
  }
  const uTolerance = distanceTolerance / cylinder.radius;
  const charts: BrepParamPoint2[][] = [];
  for (const loop of [outerLoops[0]!, ...holeLoops]) {
    const decoded = loopParamPoints(
      face.id,
      loop,
      uTolerance,
      angularTolerance,
    );
    if (!decoded.ok) return { ok: false, issues: [decoded.issue] };
    charts.push(decoded.points);
  }
  const chart = charts[0]!;

  const uMin = Math.min(...chart.map((point) => point[0]));
  const uMax = Math.max(...chart.map((point) => point[0]));
  const vMin = Math.min(...chart.map((point) => point[1]));
  const vMax = Math.max(...chart.map((point) => point[1]));
  const uSpan = uMax - uMin;
  const vSpan = vMax - vMin;
  if (uSpan <= uTolerance || vSpan <= angularTolerance) {
    return {
      ok: false,
      issues: [{
        code: "invalid-cylinder-chart",
        faceId: face.id,
        loopId: outerLoops[0]!.id,
        message: "cylinder chart has zero axial or angular extent",
      }],
    };
  }
  if (vSpan >= Math.PI * 2 - angularTolerance) {
    return {
      ok: false,
      issues: [{
        code: "wrapping-cylinder-chart",
        faceId: face.id,
        loopId: outerLoops[0]!.id,
        message: "cylinder chart reaches or crosses a full-period seam",
      }],
    };
  }

  let parameterAligned = true;
  const hasSampledDiagonalCurve = outerLoops[0]!.curves.some(
    (curve) =>
      curve.kind === "pcurve-polyline" &&
      curve.points.length >= 3 &&
      curve.points.some((point, index) => {
        if (index === 0) return false;
        const previous = curve.points[index - 1]!;
        return (
          Math.abs(point[0] - previous[0]) > uTolerance &&
          Math.abs(point[1] - previous[1]) > angularTolerance
        );
      }),
  );
  const cornerKeys = new Set<string>();
  for (let chartIndex = 0; chartIndex < charts.length; chartIndex += 1) {
    const oneChart = charts[chartIndex]!;
    const oneLoop = chartIndex === 0
      ? outerLoops[0]!
      : holeLoops[chartIndex - 1]!;
    for (let index = 0; index < oneChart.length; index += 1) {
      const point = oneChart[index]!;
      const next = oneChart[(index + 1) % oneChart.length]!;
      const constantU = Math.abs(point[0] - next[0]) <= uTolerance;
      const constantV = Math.abs(point[1] - next[1]) <= angularTolerance;
      if (constantU === constantV) {
        parameterAligned = false;
      }
      if (Math.abs(point[1] - next[1]) > Math.PI + angularTolerance) {
        return {
          ok: false,
          issues: [{
            code: "wrapping-cylinder-chart",
            faceId: face.id,
            loopId: oneLoop.id,
            message: "cylinder p-curve edge has an ambiguous angular wrap",
          }],
        };
      }

      if (
        holeLoops.length === 0 &&
        chart.length === 4 &&
        parameterAligned
      ) {
        const uSide = Math.abs(point[0] - uMin) <= uTolerance
          ? "min"
          : Math.abs(point[0] - uMax) <= uTolerance
            ? "max"
            : null;
        const vSide = Math.abs(point[1] - vMin) <= angularTolerance
          ? "min"
          : Math.abs(point[1] - vMax) <= angularTolerance
            ? "max"
            : null;
        if (!uSide || !vSide) {
          return {
            ok: false,
            issues: [{
              code: "invalid-cylinder-chart",
              faceId: face.id,
              loopId: outerLoops[0]!.id,
              message: "cylinder p-curve vertex is not a rectangle corner",
            }],
          };
        }
        cornerKeys.add(`${uSide}-${vSide}`);
      }
    }
  }
  const rectangular =
    holeLoops.length === 0 &&
    chart.length === 4 &&
    parameterAligned;
  if (
    !parameterAligned &&
    (
      holeLoops.length !== 0 ||
      !hasSampledDiagonalCurve
    )
  ) {
    return {
      ok: false,
      issues: [{
        code: "invalid-cylinder-chart",
        faceId: face.id,
        loopId: outerLoops[0]!.id,
        message:
          "non-orthogonal cylinder charts require one sampled outer p-curve without holes",
      }],
    };
  }
  if (rectangular && cornerKeys.size !== 4) {
    return {
      ok: false,
      issues: [{
        code: "invalid-cylinder-chart",
        faceId: face.id,
        loopId: outerLoops[0]!.id,
        message: "cylinder chart does not contain four distinct rectangle corners",
      }],
    };
  }

  const policy = options.nativePolicy;
  if (!policy) {
    return {
      ok: false,
      issues: [{
        code: "missing-tessellation-policy",
        faceId: face.id,
        message: "cylindrical faces require an explicit native tessellation policy",
      }],
    };
  }
  const nativeSteps = nativeCylinderMaximumParamSteps(
    cylinder.radius,
    policy.maximumEdgeLength,
    policy.maximumAngleDegrees,
  );
  if (!nativeSteps.ok) {
    return {
      ok: false,
      issues: [{
        code: "invalid-options",
        faceId: face.id,
        message: nativeSteps.error,
      }],
    };
  }
  const composedTransform = multiplyMatrix(modelTransform, faceTransform);
  if (!rectangular) {
    if (!parameterAligned) {
      return tessellateSampledCylinderChart(
        brep,
        face as NeutralBrepFace & { surface: BrepCylinderSurface },
        chart,
        { axis, xAxis, yAxis },
        composedTransform,
        policy,
        {
          uTolerance,
          angularTolerance,
          areaTolerance,
          maxVertices,
          maximumUStep: nativeSteps.value.maximumUStep,
        },
      );
    }
    return tessellateOrthogonalCylinderChart(
      brep,
      face as NeutralBrepFace & { surface: BrepCylinderSurface },
      { outer: chart, holes: charts.slice(1) },
      { axis, xAxis, yAxis },
      composedTransform,
      policy,
      {
        uTolerance,
        angularTolerance,
        areaTolerance,
        maxVertices,
        maximumUStep: nativeSteps.value.maximumUStep,
      },
    );
  }
  const vSegmentsResult = nativeCircularArcSegmentCount(
    cylinder.radius,
    vSpan,
    policy,
    { minimumSegments: 1, maximumSegments: Math.max(1, maxVertices) },
  );
  if (!vSegmentsResult.ok) {
    return {
      ok: false,
      issues: [{
        code: "invalid-options",
        faceId: face.id,
        message: vSegmentsResult.error,
      }],
    };
  }

  const uSegments = nativeSteps.value.maximumUStep > 0
    ? Math.max(1, Math.ceil(uSpan / nativeSteps.value.maximumUStep))
    : 1;
  const vSegments = vSegmentsResult.value;
  const vertexCount = (uSegments + 1) * (vSegments + 1);
  if (!Number.isSafeInteger(vertexCount) || vertexCount > maxVertices) {
    return {
      ok: false,
      issues: [{
        code: "invalid-cylinder-chart",
        faceId: face.id,
        message: "cylindrical mesh vertex count exceeds the safety bound",
      }],
    };
  }

  const oriented = face.orientation ?? 1;
  const positions: number[] = [];
  const normals: number[] = [];
  for (let uIndex = 0; uIndex <= uSegments; uIndex += 1) {
    const u = uMin + (uSpan * uIndex) / uSegments;
    for (let vIndex = 0; vIndex <= vSegments; vIndex += 1) {
      const v = vMin + (vSpan * vIndex) / vSegments;
      const cosine = Math.cos(v);
      const sine = Math.sin(v);
      const radial: Vec3 = [
        cosine * xAxis[0] + sine * yAxis[0],
        cosine * xAxis[1] + sine * yAxis[1],
        cosine * xAxis[2] + sine * yAxis[2],
      ];
      const point: Vec3 = [
        cylinder.origin[0] + cylinder.radius * (u * axis[0] + radial[0]),
        cylinder.origin[1] + cylinder.radius * (u * axis[1] + radial[1]),
        cylinder.origin[2] + cylinder.radius * (u * axis[2] + radial[2]),
      ];
      positions.push(...transformPoint(composedTransform, point));

      const dV: Vec3 = [
        cylinder.radius * (-sine * xAxis[0] + cosine * yAxis[0]),
        cylinder.radius * (-sine * xAxis[1] + cosine * yAxis[1]),
        cylinder.radius * (-sine * xAxis[2] + cosine * yAxis[2]),
      ];
      const dU: Vec3 = [
        cylinder.radius * axis[0],
        cylinder.radius * axis[1],
        cylinder.radius * axis[2],
      ];
      const worldNormal = normalized(
        cross(
          transformVector(composedTransform, dV),
          transformVector(composedTransform, dU),
        ),
      );
      if (!worldNormal) {
        return {
          ok: false,
          issues: [{
            code: "triangulation-failed",
            faceId: face.id,
            message: "transformed cylindrical face collapses to zero area",
          }],
        };
      }
      const orientedNormal = worldNormal.map((component) => {
        const value = component * oriented;
        return Object.is(value, -0) ? 0 : value;
      });
      normals.push(...orientedNormal);
    }
  }

  const indices: number[] = [];
  const rowLength = vSegments + 1;
  for (let uIndex = 0; uIndex < uSegments; uIndex += 1) {
    for (let vIndex = 0; vIndex < vSegments; vIndex += 1) {
      const a = uIndex * rowLength + vIndex;
      const b = (uIndex + 1) * rowLength + vIndex;
      const c = b + 1;
      const d = a + 1;
      if (oriented === 1) indices.push(a, c, b, a, d, c);
      else indices.push(a, b, c, a, c, d);
    }
  }

  return {
    ok: true,
    mesh: {
      brepId: brep.id,
      positions: Float64Array.from(positions),
      normals: Float32Array.from(normals),
      indices: Uint32Array.from(indices),
      groups: [{
        faceId: face.id,
        indexOffset: 0,
        indexCount: indices.length,
        vertexOffset: 0,
        vertexCount,
        materialId: face.materialId ?? null,
        objectMarker: face.objectMarker,
        sourceTransform: composedTransform,
        brepProvenance: { ...brep.provenance },
        faceProvenance: { ...face.provenance },
      }],
    },
  };
}

/**
 * Tessellate a complete neutral BRep using only verified surface subsets.
 *
 * Planes use the compatibility path. Cylinders require an explicit native
 * policy and a single non-wrapping rectangular p-curve chart. Any unsupported
 * or invalid face rejects the complete BRep; no partial mesh is returned.
 */
export function tessellateNeutralBrep(
  brep: NeutralBrep,
  options: BrepTessellationOptions = {},
): BrepTessellationResult {
  if (brep.faces.every((face) => face.surface.kind === "plane")) {
    return tessellatePlanarBrep(brep, options);
  }

  const distanceTolerance = options.distanceTolerance ?? DEFAULT_DISTANCE_TOLERANCE;
  const angularTolerance = options.angularTolerance ?? DEFAULT_ANGULAR_TOLERANCE;
  const areaTolerance = options.areaTolerance ?? DEFAULT_AREA_TOLERANCE;
  const maxFaces = options.maxFaces ?? DEFAULT_MAX_FACES;
  const maxVertices = options.maxVertices ?? DEFAULT_MAX_VERTICES;
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
        code: "invalid-options",
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
  const issues: BrepTessellationIssue[] = [];

  for (const face of brep.faces) {
    const remainingVertices = maxVertices - positions.length / 3;
    const oneFace = { ...brep, faces: [face] };
    const result = face.surface.kind === "plane"
      ? tessellatePlanarBrep(oneFace, {
          ...options,
          maxFaces: 1,
          maxVertices: remainingVertices,
        })
      : face.surface.kind === "cylinder"
        ? tessellateCylinderFace(oneFace, face, {
            ...options,
            maxFaces: 1,
            maxVertices: remainingVertices,
          })
        : {
            ok: false as const,
            issues: [{
              code: "unsupported-surface" as const,
              faceId: face.id,
              message: `${face.surface.kind} surfaces do not have a verified browser tessellator`,
            }],
          };
    if (!result.ok) {
      issues.push(...result.issues);
      continue;
    }

    const vertexOffset = positions.length / 3;
    const indexOffset = indices.length;
    for (const coordinate of result.mesh.positions) positions.push(coordinate);
    for (const component of result.mesh.normals) normals.push(component);
    for (const index of result.mesh.indices) indices.push(index + vertexOffset);
    for (const group of result.mesh.groups) {
      groups.push({
        ...group,
        indexOffset: group.indexOffset + indexOffset,
        vertexOffset: group.vertexOffset + vertexOffset,
      });
    }
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
