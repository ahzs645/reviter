import type {
  BrepMatrix4,
  BrepPoint3,
  BrepProvenance,
  NeutralBrep,
  NeutralFaceMesh,
  NeutralMeshFaceGroup,
} from "./brep-tessellator.ts";
import { tessellatePlanarBrep } from "./brep-tessellator.ts";
import type {
  Revit2027ConeSurface,
  RevitPoint2d,
} from "./revit-2027-surfaces.ts";

const DEFAULT_TOLERANCE = 1e-9;
const DEFAULT_MAX_FACES = 1_000_000;
const DEFAULT_MAX_VERTICES = 20_000_000;
const TWO_PI = Math.PI * 2;
const IDENTITY: BrepMatrix4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

export type Revit2027ConeApexSectorSurface = Pick<
  Revit2027ConeSurface,
  | "kind"
  | "center"
  | "xVector"
  | "yVector"
  | "zVector"
  | "halfAngle"
  | "surface"
>;

export type Revit2027ConeApexSectorEdge = {
  edgeToken: number;
  /**
   * Complete face-local UV sequence in directed loop order.
   *
   * Native Revit cone parameters are `(angle, generatorDistance)`.
   */
  samples: readonly RevitPoint2d[];
};

export type Revit2027ConeApexSectorLoop = {
  loopToken: number;
  role: "outer" | "hole";
  edges: readonly Revit2027ConeApexSectorEdge[];
};

export type Revit2027ConeApexSectorFace = {
  faceToken: number;
  surface: Revit2027ConeApexSectorSurface;
  loops: readonly Revit2027ConeApexSectorLoop[];
  orientation?: 1 | -1;
  materialId?: string | number | null;
  objectMarker?: number;
  provenance: BrepProvenance;
};

export type Revit2027ConeApexSectorInput = {
  id: string;
  faces: readonly Revit2027ConeApexSectorFace[];
  provenance: BrepProvenance;
  tolerance?: number;
  maxFaces?: number;
  maxVertices?: number;
};

export type Revit2027ConeApexSectorIssueCode =
  | "invalid-options"
  | "invalid-face"
  | "invalid-cone"
  | "invalid-loop"
  | "invalid-edge"
  | "open-loop"
  | "unsupported-trim"
  | "missing-apex"
  | "ambiguous-boundary"
  | "surface-deviation"
  | "subdivision-limit"
  | "vertex-limit";

export type Revit2027ConeApexSectorIssue = {
  code: Revit2027ConeApexSectorIssueCode;
  faceToken?: number;
  loopToken?: number;
  edgeToken?: number;
  message: string;
};

export type Revit2027ConeApexSectorResult =
  | { ok: true; mesh: NeutralFaceMesh }
  | { ok: false; issues: readonly Revit2027ConeApexSectorIssue[] };

type Frame = {
  xAxis: BrepPoint3;
  yAxis: BrepPoint3;
  axis: BrepPoint3;
  handedness: 1 | -1;
};

type ClassifiedSector = {
  arc: Revit2027ConeApexSectorEdge;
  canonicalAngles: number[];
  outerDistance: number;
};

function finitePoint3(point: BrepPoint3): boolean {
  return point.length === 3 && point.every(Number.isFinite);
}

function finitePoint2(point: RevitPoint2d): boolean {
  return point.length === 2 && point.every(Number.isFinite);
}

function dot(left: BrepPoint3, right: BrepPoint3): number {
  return (
    left[0] * right[0] +
    left[1] * right[1] +
    left[2] * right[2]
  );
}

function cross(
  left: BrepPoint3,
  right: BrepPoint3,
): [number, number, number] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalized(vector: BrepPoint3): BrepPoint3 | null {
  const magnitude = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(magnitude) || magnitude === 0) return null;
  return [
    vector[0] / magnitude,
    vector[1] / magnitude,
    vector[2] / magnitude,
  ];
}

function frameForSurface(
  surface: Revit2027ConeApexSectorSurface,
  tolerance: number,
): { ok: true; frame: Frame } | { ok: false; error: string } {
  if (
    surface.kind !== "cone" ||
    !finitePoint3(surface.center) ||
    !finitePoint3(surface.xVector) ||
    !finitePoint3(surface.yVector) ||
    !finitePoint3(surface.zVector) ||
    !Number.isFinite(surface.halfAngle) ||
    surface.halfAngle <= tolerance ||
    surface.halfAngle >= Math.PI / 2 - tolerance
  ) {
    return {
      ok: false,
      error: "cone frame or half angle is outside the proven finite acute cone subset",
    };
  }
  const xAxis = normalized(surface.xVector);
  const persistedYAxis = normalized(surface.yVector);
  const axis = normalized(surface.zVector);
  const yAxis = xAxis && axis ? normalized(cross(axis, xAxis)) : null;
  if (!xAxis || !persistedYAxis || !axis || !yAxis) {
    return { ok: false, error: "cone basis contains a degenerate vector" };
  }
  if (
    Math.abs(dot(xAxis, axis)) > tolerance ||
    Math.abs(dot(persistedYAxis, axis)) > tolerance ||
    Math.abs(dot(xAxis, persistedYAxis)) > tolerance
  ) {
    return { ok: false, error: "cone basis is not orthogonal" };
  }
  const handednessDot = dot(yAxis, persistedYAxis);
  if (Math.abs(Math.abs(handednessDot) - 1) > tolerance) {
    return {
      ok: false,
      error: "cone persisted Y does not agree with either signed Z×X",
    };
  }
  return {
    ok: true,
    frame: {
      xAxis,
      yAxis,
      axis,
      handedness: handednessDot >= 0 ? 1 : -1,
    },
  };
}

function sameParameterPoint(
  left: RevitPoint2d,
  right: RevitPoint2d,
  tolerance: number,
): boolean {
  return (
    Math.abs(left[0] - right[0]) <= tolerance &&
    Math.abs(left[1] - right[1]) <= tolerance
  );
}

function sameConePoint(
  left: RevitPoint2d,
  right: RevitPoint2d,
  tolerance: number,
): boolean {
  return (
    sameParameterPoint(left, right, tolerance) ||
    (
      Math.abs(left[1]) <= tolerance &&
      Math.abs(right[1]) <= tolerance
    )
  );
}

function strictlyMonotonic(
  values: readonly number[],
  tolerance: number,
): boolean {
  if (values.length < 2) return false;
  let direction = 0;
  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index]! - values[index - 1]!;
    if (Math.abs(delta) <= tolerance) return false;
    const sign = delta > 0 ? 1 : -1;
    if (direction === 0) direction = sign;
    else if (direction !== sign) return false;
  }
  return true;
}

function constantCoordinate(
  samples: readonly RevitPoint2d[],
  axis: 0 | 1,
  tolerance: number,
): boolean {
  return samples.every(
    (sample) => Math.abs(sample[axis] - samples[0]![axis]) <= tolerance,
  );
}

function endpointAtApex(
  edge: Revit2027ConeApexSectorEdge,
  tolerance: number,
): 0 | 1 | null {
  const first = Math.abs(edge.samples[0]![1]) <= tolerance;
  const last = Math.abs(edge.samples.at(-1)![1]) <= tolerance;
  return first === last ? null : first ? 0 : 1;
}

function classifySector(
  face: Revit2027ConeApexSectorFace,
  frame: Frame,
  tolerance: number,
): { ok: true; sector: ClassifiedSector } | {
  ok: false;
  issue: Revit2027ConeApexSectorIssue;
} {
  if (face.loops.length !== 1 || face.loops[0]?.role !== "outer") {
    return {
      ok: false,
      issue: {
        code: "unsupported-trim",
        faceToken: face.faceToken,
        message: "apex-sector tessellation requires exactly one outer loop and no holes",
      },
    };
  }
  const loop = face.loops[0];
  if (
    !Number.isSafeInteger(loop.loopToken) ||
    loop.loopToken <= 0 ||
    loop.edges.length !== 3
  ) {
    return {
      ok: false,
      issue: {
        code: "unsupported-trim",
        faceToken: face.faceToken,
        loopToken: loop.loopToken,
        message: "apex-sector tessellation requires one three-edge loop",
      },
    };
  }
  const seenTokens = new Set<number>();
  for (const edge of loop.edges) {
    if (
      !Number.isSafeInteger(edge.edgeToken) ||
      edge.edgeToken <= 0 ||
      seenTokens.has(edge.edgeToken) ||
      edge.samples.length < 2 ||
      edge.samples.some((sample) => !finitePoint2(sample))
    ) {
      return {
        ok: false,
        issue: {
          code: "invalid-edge",
          faceToken: face.faceToken,
          loopToken: loop.loopToken,
          edgeToken: edge.edgeToken,
          message: "edge tokens must be unique and contain at least two finite UV samples",
        },
      };
    }
    seenTokens.add(edge.edgeToken);
    for (let index = 1; index < edge.samples.length; index += 1) {
      if (sameConePoint(edge.samples[index - 1]!, edge.samples[index]!, tolerance)) {
        return {
          ok: false,
          issue: {
            code: "invalid-edge",
            faceToken: face.faceToken,
            loopToken: loop.loopToken,
            edgeToken: edge.edgeToken,
            message: "edge contains consecutive samples at the same cone point",
          },
        };
      }
    }
  }
  for (let index = 0; index < loop.edges.length; index += 1) {
    const here = loop.edges[index]!.samples.at(-1)!;
    const next = loop.edges[(index + 1) % loop.edges.length]!.samples[0]!;
    if (!sameConePoint(here, next, tolerance)) {
      return {
        ok: false,
        issue: {
          code: "open-loop",
          faceToken: face.faceToken,
          loopToken: loop.loopToken,
          message: "directed cone edges do not form a closed surface-topology loop",
        },
      };
    }
  }

  const arcs = loop.edges.filter(
    (edge) =>
      constantCoordinate(edge.samples, 1, tolerance) &&
      Math.abs(edge.samples[0]![1]) > tolerance &&
      strictlyMonotonic(
        edge.samples.map((sample) => sample[0]),
        tolerance,
      ),
  );
  if (arcs.length !== 1) {
    return {
      ok: false,
      issue: {
        code: "ambiguous-boundary",
        faceToken: face.faceToken,
        loopToken: loop.loopToken,
        message: "three-edge cone sector must contain exactly one sampled constant-V arc",
      },
    };
  }
  const arc = arcs[0]!;
  const outerDistance = arc.samples[0]![1];
  if (outerDistance <= tolerance) {
    return {
      ok: false,
      issue: {
        code: "missing-apex",
        faceToken: face.faceToken,
        loopToken: loop.loopToken,
        message: "the proven apex-sector subset requires positive generator distance",
      },
    };
  }

  const generators = loop.edges.filter((edge) => edge !== arc);
  const outerGeneratorAngles: number[] = [];
  for (const edge of generators) {
    const apexEndpoint = endpointAtApex(edge, tolerance);
    if (
      apexEndpoint == null ||
      !constantCoordinate(edge.samples, 0, tolerance) ||
      !strictlyMonotonic(
        edge.samples.map((sample) => sample[1]),
        tolerance,
      )
    ) {
      return {
        ok: false,
        issue: {
          code: "missing-apex",
          faceToken: face.faceToken,
          loopToken: loop.loopToken,
          edgeToken: edge.edgeToken,
          message: "each non-arc edge must be one constant-U generator from the apex",
        },
      };
    }
    const outerEndpoint = edge.samples[apexEndpoint === 0 ? edge.samples.length - 1 : 0]!;
    if (Math.abs(outerEndpoint[1] - outerDistance) > tolerance) {
      return {
        ok: false,
        issue: {
          code: "ambiguous-boundary",
          faceToken: face.faceToken,
          loopToken: loop.loopToken,
          edgeToken: edge.edgeToken,
          message: "generator does not terminate on the sampled outer arc",
        },
      };
    }
    outerGeneratorAngles.push(outerEndpoint[0]);
  }
  const arcEndpointAngles = [arc.samples[0]![0], arc.samples.at(-1)![0]];
  const endpointsMatch =
    outerGeneratorAngles.every((angle) =>
      arcEndpointAngles.some(
        (arcAngle) => Math.abs(angle - arcAngle) <= tolerance,
      )
    ) &&
    arcEndpointAngles.every((angle) =>
      outerGeneratorAngles.some(
        (generatorAngle) => Math.abs(angle - generatorAngle) <= tolerance,
      )
    );
  if (!endpointsMatch) {
    return {
      ok: false,
      issue: {
        code: "ambiguous-boundary",
        faceToken: face.faceToken,
        loopToken: loop.loopToken,
        message: "generator angles do not match both outer-arc endpoints",
      },
    };
  }

  const canonicalAngles = arc.samples.map(
    (sample) => frame.handedness * sample[0],
  );
  if (
    !strictlyMonotonic(canonicalAngles, tolerance) ||
    Math.abs(canonicalAngles.at(-1)! - canonicalAngles[0]!) >=
      TWO_PI - tolerance
  ) {
    return {
      ok: false,
      issue: {
        code: "unsupported-trim",
        faceToken: face.faceToken,
        loopToken: loop.loopToken,
        edgeToken: arc.edgeToken,
        message: "outer arc must be one explicit non-wrapping angular chart",
      },
    };
  }
  return {
    ok: true,
    sector: { arc, canonicalAngles, outerDistance },
  };
}

function conePoint(
  center: BrepPoint3,
  frame: Frame,
  halfAngle: number,
  angle: number,
  distance: number,
): [number, number, number] {
  const radial = [
    Math.cos(angle) * frame.xAxis[0] + Math.sin(angle) * frame.yAxis[0],
    Math.cos(angle) * frame.xAxis[1] + Math.sin(angle) * frame.yAxis[1],
    Math.cos(angle) * frame.xAxis[2] + Math.sin(angle) * frame.yAxis[2],
  ] as const;
  const radialScale = distance * Math.sin(halfAngle);
  const axialScale = distance * Math.cos(halfAngle);
  return [
    center[0] + radialScale * radial[0] + axialScale * frame.axis[0],
    center[1] + radialScale * radial[1] + axialScale * frame.axis[1],
    center[2] + radialScale * radial[2] + axialScale * frame.axis[2],
  ];
}

function coneNormal(
  frame: Frame,
  halfAngle: number,
  angle: number,
  orientation: 1 | -1,
): [number, number, number] {
  const radial = [
    Math.cos(angle) * frame.xAxis[0] + Math.sin(angle) * frame.yAxis[0],
    Math.cos(angle) * frame.xAxis[1] + Math.sin(angle) * frame.yAxis[1],
    Math.cos(angle) * frame.xAxis[2] + Math.sin(angle) * frame.yAxis[2],
  ] as const;
  const radialScale = orientation * Math.cos(halfAngle);
  const axialScale = -orientation * Math.sin(halfAngle);
  return [
    radialScale * radial[0] + axialScale * frame.axis[0],
    radialScale * radial[1] + axialScale * frame.axis[1],
    radialScale * radial[2] + axialScale * frame.axis[2],
  ];
}

type SampledConeProfile = {
  canonicalRing: readonly RevitPoint2d[];
  maximumBoundaryDeviation: number;
};

const NATIVE_ADAPTIVE_PROBE_FRACTIONS = [
  0.3102637180713,
  0.5,
  0.6897362819287,
] as const;
const NATIVE_MAX_SUBDIVISION_DEPTH = 12;

function lerp2(
  first: RevitPoint2d,
  second: RevitPoint2d,
  fraction: number,
): RevitPoint2d {
  return [
    first[0] + (second[0] - first[0]) * fraction,
    first[1] + (second[1] - first[1]) * fraction,
  ];
}

function lerp3(
  first: BrepPoint3,
  second: BrepPoint3,
  fraction: number,
): BrepPoint3 {
  return [
    first[0] + (second[0] - first[0]) * fraction,
    first[1] + (second[1] - first[1]) * fraction,
    first[2] + (second[2] - first[2]) * fraction,
  ];
}

function pointDistance(first: BrepPoint3, second: BrepPoint3): number {
  return Math.hypot(
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2],
  );
}

function sampledConeProfile(
  face: Revit2027ConeApexSectorFace,
  frame: Frame,
  tolerance: number,
): { ok: true; profile: SampledConeProfile } | {
  ok: false;
  issue: Revit2027ConeApexSectorIssue;
} {
  if (face.loops.length !== 1 || face.loops[0]?.role !== "outer") {
    return {
      ok: false,
      issue: {
        code: "unsupported-trim",
        faceToken: face.faceToken,
        message: "sampled cone tessellation requires one outer loop and no holes",
      },
    };
  }
  const loop = face.loops[0];
  if (
    !Number.isSafeInteger(loop.loopToken) ||
    loop.loopToken <= 0 ||
    loop.edges.length < 3
  ) {
    return {
      ok: false,
      issue: {
        code: "invalid-loop",
        faceToken: face.faceToken,
        loopToken: loop.loopToken,
        message: "sampled cone loop must have at least three directed edges",
      },
    };
  }

  const persistedRing: RevitPoint2d[] = [];
  const seenEdgeTokens = new Set<number>();
  for (const edge of loop.edges) {
    if (
      !Number.isSafeInteger(edge.edgeToken) ||
      edge.edgeToken <= 0 ||
      seenEdgeTokens.has(edge.edgeToken) ||
      edge.samples.length < 2 ||
      edge.samples.some((sample) => !finitePoint2(sample))
    ) {
      return {
        ok: false,
        issue: {
          code: "invalid-edge",
          faceToken: face.faceToken,
          loopToken: loop.loopToken,
          edgeToken: edge.edgeToken,
          message: "sampled cone edge is invalid or repeated",
        },
      };
    }
    seenEdgeTokens.add(edge.edgeToken);
    if (
      persistedRing.length > 0 &&
      !sameParameterPoint(persistedRing.at(-1)!, edge.samples[0]!, tolerance)
    ) {
      return {
        ok: false,
        issue: {
          code: "open-loop",
          faceToken: face.faceToken,
          loopToken: loop.loopToken,
          edgeToken: edge.edgeToken,
          message: "sampled cone edges do not share exact parameter endpoints",
        },
      };
    }
    persistedRing.push(
      ...(persistedRing.length === 0 ? edge.samples : edge.samples.slice(1)),
    );
  }
  if (
    persistedRing.length < 4 ||
    !sameParameterPoint(
      persistedRing[0]!,
      persistedRing.at(-1)!,
      tolerance,
    )
  ) {
    return {
      ok: false,
      issue: {
        code: "open-loop",
        faceToken: face.faceToken,
        loopToken: loop.loopToken,
        message: "sampled cone parameter loop is not closed",
      },
    };
  }
  persistedRing.pop();
  if (
    persistedRing.length < 3 ||
    persistedRing.some((point, index) =>
      point[1] <= tolerance ||
      sameParameterPoint(
        point,
        persistedRing[(index + 1) % persistedRing.length]!,
        tolerance,
      )
    )
  ) {
    return {
      ok: false,
      issue: {
        code: "unsupported-trim",
        faceToken: face.faceToken,
        loopToken: loop.loopToken,
        message: "sampled cone profile crosses the apex or is degenerate",
      },
    };
  }

  const canonicalRing = persistedRing.map(
    ([angle, distance]) =>
      [frame.handedness * angle, distance] as RevitPoint2d,
  );
  const angles = canonicalRing.map((point) => point[0]);
  if (Math.max(...angles) - Math.min(...angles) >= TWO_PI - tolerance) {
    return {
      ok: false,
      issue: {
        code: "unsupported-trim",
        faceToken: face.faceToken,
        loopToken: loop.loopToken,
        message: "sampled cone profile crosses or fills the angular seam",
      },
    };
  }

  let maximumBoundaryDeviation = 0;
  for (let index = 0; index < canonicalRing.length; index += 1) {
    const firstUv = canonicalRing[index]!;
    const secondUv = canonicalRing[(index + 1) % canonicalRing.length]!;
    const first = conePoint(
      face.surface.center,
      frame,
      face.surface.halfAngle,
      firstUv[0],
      firstUv[1],
    );
    const second = conePoint(
      face.surface.center,
      frame,
      face.surface.halfAngle,
      secondUv[0],
      secondUv[1],
    );
    for (const fraction of NATIVE_ADAPTIVE_PROBE_FRACTIONS) {
      const uv = lerp2(firstUv, secondUv, fraction);
      const surfacePoint = conePoint(
        face.surface.center,
        frame,
        face.surface.halfAngle,
        uv[0],
        uv[1],
      );
      maximumBoundaryDeviation = Math.max(
        maximumBoundaryDeviation,
        pointDistance(surfacePoint, lerp3(first, second, fraction)),
      );
    }
  }
  if (!Number.isFinite(maximumBoundaryDeviation)) {
    return {
      ok: false,
      issue: {
        code: "surface-deviation",
        faceToken: face.faceToken,
        loopToken: loop.loopToken,
        message: "sampled cone boundary deviation is not finite",
      },
    };
  }
  return {
    ok: true,
    profile: { canonicalRing, maximumBoundaryDeviation },
  };
}

/**
 * Tessellate a non-apex, single-chart sampled cone profile.
 *
 * The persisted trim samples set the geometric deviation budget. Interior
 * triangles are recursively split using the native renderer's three probe
 * fractions and depth-12 safety boundary. This intentionally does not select
 * an undocumented global Revit LOD.
 */
export function tessellateRevit2027SampledConeFaces(
  input: Revit2027ConeApexSectorInput,
): Revit2027ConeApexSectorResult {
  const tolerance = input.tolerance ?? DEFAULT_TOLERANCE;
  const maxFaces = input.maxFaces ?? DEFAULT_MAX_FACES;
  const maxVertices = input.maxVertices ?? DEFAULT_MAX_VERTICES;
  if (
    typeof input.id !== "string" ||
    input.id.length === 0 ||
    !Number.isFinite(tolerance) ||
    tolerance <= 0 ||
    !Number.isSafeInteger(maxFaces) ||
    maxFaces < 0 ||
    !Number.isSafeInteger(maxVertices) ||
    maxVertices < 0 ||
    input.faces.length > maxFaces
  ) {
    return {
      ok: false,
      issues: [{
        code: "invalid-options",
        message: "id, tolerances, face limit, or vertex limit is invalid",
      }],
    };
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const groups: NeutralMeshFaceGroup[] = [];
  const issues: Revit2027ConeApexSectorIssue[] = [];
  for (const face of input.faces) {
    const frameResult = frameForSurface(face.surface, tolerance);
    if (!Number.isSafeInteger(face.faceToken) || face.faceToken <= 0) {
      issues.push({
        code: "invalid-face",
        faceToken: face.faceToken,
        message: "face token must be a positive safe integer",
      });
      continue;
    }
    if (!frameResult.ok) {
      issues.push({
        code: "invalid-cone",
        faceToken: face.faceToken,
        message: frameResult.error,
      });
      continue;
    }
    const sampled = sampledConeProfile(face, frameResult.frame, tolerance);
    if (!sampled.ok) {
      issues.push(sampled.issue);
      continue;
    }
    const ring = sampled.profile.canonicalRing;
    const closed = [...ring, ring[0]!].map(
      ([u, v]) => [u, v, 0] as BrepPoint3,
    );
    const parameterBrep: NeutralBrep = {
      id: `${input.id}-parameter-profile`,
      provenance: input.provenance,
      faces: [{
        id: `revit-2027-face-${face.faceToken}-parameter-profile`,
        surface: {
          kind: "plane",
          origin: [0, 0, 0],
          uAxis: [1, 0, 0],
          vAxis: [0, 1, 0],
          normal: [0, 0, 1],
        },
        trims: [{
          id: `revit-2027-loop-${face.loops[0]!.loopToken}`,
          role: "outer",
          curves: [{ kind: "polyline", points: closed }],
        }],
        provenance: face.provenance,
      }],
    };
    const parameterMesh = tessellatePlanarBrep(parameterBrep, {
      distanceTolerance: tolerance,
      areaTolerance: Math.max(tolerance * tolerance, Number.EPSILON),
      maxVertices,
    });
    if (!parameterMesh.ok) {
      issues.push({
        code: "ambiguous-boundary",
        faceToken: face.faceToken,
        loopToken: face.loops[0]!.loopToken,
        message: parameterMesh.issues
          .map((issue) => `${issue.code}: ${issue.message}`)
          .join("; "),
      });
      continue;
    }

    const frame = frameResult.frame;
    const geometricOrientation: 1 | -1 =
      face.surface.surface.orientFlag === (frame.handedness === 1)
        ? 1
        : -1;
    const orientation = face.orientation ?? geometricOrientation;
    const allowedDeviation = Math.max(
      tolerance,
      sampled.profile.maximumBoundaryDeviation * (1 + 1e-9),
    );
    const facePositions: number[] = [];
    const faceNormals: number[] = [];
    const faceIndices: number[] = [];
    let subdivisionFailed = false;

    const uvAt = (index: number): RevitPoint2d => [
      parameterMesh.mesh.positions[index * 3]!,
      parameterMesh.mesh.positions[index * 3 + 1]!,
    ];
    const evaluate = (uv: RevitPoint2d): BrepPoint3 =>
      conePoint(
        face.surface.center,
        frame,
        face.surface.halfAngle,
        uv[0],
        uv[1],
      );
    const withinDeviation = (
      aUv: RevitPoint2d,
      bUv: RevitPoint2d,
      cUv: RevitPoint2d,
    ): boolean => {
      const a = evaluate(aUv);
      const b = evaluate(bUv);
      const c = evaluate(cUv);
      for (const [firstUv, secondUv, first, second] of [
        [aUv, bUv, a, b],
        [bUv, cUv, b, c],
        [cUv, aUv, c, a],
      ] as const) {
        for (const fraction of NATIVE_ADAPTIVE_PROBE_FRACTIONS) {
          if (
            pointDistance(
              evaluate(lerp2(firstUv, secondUv, fraction)),
              lerp3(first, second, fraction),
            ) > allowedDeviation
          ) {
            return false;
          }
        }
      }
      const centroidUv: RevitPoint2d = [
        (aUv[0] + bUv[0] + cUv[0]) / 3,
        (aUv[1] + bUv[1] + cUv[1]) / 3,
      ];
      const centroid: BrepPoint3 = [
        (a[0] + b[0] + c[0]) / 3,
        (a[1] + b[1] + c[1]) / 3,
        (a[2] + b[2] + c[2]) / 3,
      ];
      return pointDistance(evaluate(centroidUv), centroid) <= allowedDeviation;
    };
    const emitTriangle = (
      aUv: RevitPoint2d,
      bUv: RevitPoint2d,
      cUv: RevitPoint2d,
    ): void => {
      if (
        positions.length / 3 +
          facePositions.length / 3 +
          3 >
        maxVertices
      ) {
        subdivisionFailed = true;
        return;
      }
      const ordered = orientation === 1
        ? [aUv, bUv, cUv]
        : [aUv, cUv, bUv];
      const vertexOffset = facePositions.length / 3;
      for (const uv of ordered) {
        facePositions.push(...evaluate(uv));
        faceNormals.push(
          ...coneNormal(
            frame,
            face.surface.halfAngle,
            uv[0],
            orientation,
          ),
        );
      }
      faceIndices.push(vertexOffset, vertexOffset + 1, vertexOffset + 2);
    };
    const refine = (
      aUv: RevitPoint2d,
      bUv: RevitPoint2d,
      cUv: RevitPoint2d,
      depth: number,
    ): void => {
      if (subdivisionFailed) return;
      if (withinDeviation(aUv, bUv, cUv)) {
        emitTriangle(aUv, bUv, cUv);
        return;
      }
      if (depth >= NATIVE_MAX_SUBDIVISION_DEPTH) {
        subdivisionFailed = true;
        return;
      }
      const ab = lerp2(aUv, bUv, 0.5);
      const bc = lerp2(bUv, cUv, 0.5);
      const ca = lerp2(cUv, aUv, 0.5);
      refine(aUv, ab, ca, depth + 1);
      refine(ab, bUv, bc, depth + 1);
      refine(ca, bc, cUv, depth + 1);
      refine(ab, bc, ca, depth + 1);
    };
    for (let index = 0; index < parameterMesh.mesh.indices.length; index += 3) {
      refine(
        uvAt(parameterMesh.mesh.indices[index]!),
        uvAt(parameterMesh.mesh.indices[index + 1]!),
        uvAt(parameterMesh.mesh.indices[index + 2]!),
        0,
      );
      if (subdivisionFailed) break;
    }
    if (subdivisionFailed) {
      issues.push({
        code: positions.length / 3 + facePositions.length / 3 + 3 > maxVertices
          ? "vertex-limit"
          : "subdivision-limit",
        faceToken: face.faceToken,
        loopToken: face.loops[0]!.loopToken,
        message:
          "sampled cone profile exceeded the adaptive depth or vertex bound",
      });
      continue;
    }

    const vertexOffset = positions.length / 3;
    const indexOffset = indices.length;
    for (const value of facePositions) positions.push(value);
    for (const value of faceNormals) normals.push(value);
    for (const index of faceIndices) indices.push(index + vertexOffset);
    groups.push({
      faceId: `revit-2027-face-${face.faceToken}`,
      indexOffset,
      indexCount: faceIndices.length,
      vertexOffset,
      vertexCount: facePositions.length / 3,
      materialId: face.materialId ?? null,
      objectMarker: face.objectMarker,
      sourceTransform: IDENTITY,
      brepProvenance: { ...input.provenance },
      faceProvenance: { ...face.provenance },
    });
  }
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    mesh: {
      brepId: input.id,
      positions: new Float64Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint32Array(indices),
      groups,
    },
  };
}

/**
 * Tessellate only the native-proven three-edge Revit cone apex sector.
 *
 * The two constant-angle generator edges are straight in 3D. The third edge
 * supplies the persisted angular samples at one constant positive generator
 * distance. Each adjacent sample pair and the single exact apex form one
 * triangle; no IFC geometry or invented trim samples participate.
 */
export function tessellateRevit2027ConeApexSectors(
  input: Revit2027ConeApexSectorInput,
): Revit2027ConeApexSectorResult {
  const tolerance = input.tolerance ?? DEFAULT_TOLERANCE;
  const maxFaces = input.maxFaces ?? DEFAULT_MAX_FACES;
  const maxVertices = input.maxVertices ?? DEFAULT_MAX_VERTICES;
  if (
    typeof input.id !== "string" ||
    input.id.length === 0 ||
    !Number.isFinite(tolerance) ||
    tolerance <= 0 ||
    !Number.isSafeInteger(maxFaces) ||
    maxFaces < 0 ||
    !Number.isSafeInteger(maxVertices) ||
    maxVertices < 0 ||
    input.faces.length > maxFaces
  ) {
    return {
      ok: false,
      issues: [{
        code: "invalid-options",
        message: "id, tolerances, face limit, or vertex limit is invalid",
      }],
    };
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const groups: NeutralMeshFaceGroup[] = [];
  const issues: Revit2027ConeApexSectorIssue[] = [];
  for (const face of input.faces) {
    if (!Number.isSafeInteger(face.faceToken) || face.faceToken <= 0) {
      issues.push({
        code: "invalid-face",
        faceToken: face.faceToken,
        message: "face token must be a positive safe integer",
      });
      continue;
    }
    const frameResult = frameForSurface(face.surface, tolerance);
    if (!frameResult.ok) {
      issues.push({
        code: "invalid-cone",
        faceToken: face.faceToken,
        message: frameResult.error,
      });
      continue;
    }
    const classified = classifySector(
      face,
      frameResult.frame,
      tolerance,
    );
    if (!classified.ok) {
      issues.push(classified.issue);
      continue;
    }
    const { canonicalAngles, outerDistance } = classified.sector;
    const requiredVertices = (canonicalAngles.length - 1) * 3;
    if (positions.length / 3 + requiredVertices > maxVertices) {
      issues.push({
        code: "vertex-limit",
        faceToken: face.faceToken,
        message: "cone apex-sector mesh exceeds the vertex safety bound",
      });
      continue;
    }

    const frame = frameResult.frame;
    const geometricOrientation: 1 | -1 =
      face.surface.surface.orientFlag === (frame.handedness === 1)
        ? 1
        : -1;
    const orientation = face.orientation ?? geometricOrientation;
    const vertexOffset = positions.length / 3;
    const indexOffset = indices.length;
    for (let index = 0; index < canonicalAngles.length - 1; index += 1) {
      const firstAngle = canonicalAngles[index]!;
      const secondAngle = canonicalAngles[index + 1]!;
      const increasing = secondAngle > firstAngle;
      let triangleAngles: [number | null, number, number] = increasing
        ? [null, secondAngle, firstAngle]
        : [null, firstAngle, secondAngle];
      if (orientation === -1) {
        triangleAngles = [
          triangleAngles[0],
          triangleAngles[2],
          triangleAngles[1],
        ];
      }
      const apexNormalAngle = (firstAngle + secondAngle) / 2;
      for (const angle of triangleAngles) {
        if (angle == null) {
          positions.push(...face.surface.center);
          normals.push(
            ...coneNormal(
              frame,
              face.surface.halfAngle,
              apexNormalAngle,
              orientation,
            ),
          );
        } else {
          positions.push(
            ...conePoint(
              face.surface.center,
              frame,
              face.surface.halfAngle,
              angle,
              outerDistance,
            ),
          );
          normals.push(
            ...coneNormal(
              frame,
              face.surface.halfAngle,
              angle,
              orientation,
            ),
          );
        }
      }
      const triangleOffset = vertexOffset + index * 3;
      indices.push(
        triangleOffset,
        triangleOffset + 1,
        triangleOffset + 2,
      );
    }
    groups.push({
      faceId: `revit-2027-face-${face.faceToken}`,
      indexOffset,
      indexCount: indices.length - indexOffset,
      vertexOffset,
      vertexCount: requiredVertices,
      materialId: face.materialId ?? null,
      objectMarker: face.objectMarker,
      sourceTransform: IDENTITY,
      brepProvenance: { ...input.provenance },
      faceProvenance: { ...face.provenance },
    });
  }
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    mesh: {
      brepId: input.id,
      positions: new Float64Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint32Array(indices),
      groups,
    },
  };
}
