import type { Revit2027GArc } from "./revit-2027-garc.ts";
import type {
  Revit2027SurfaceOfRevolution,
  RevitPoint3d,
} from "./revit-2027-surfaces.ts";

export type Revit2027ArcSurfRevUv = readonly [number, number];

export type Revit2027ArcSurfRevMesh = {
  positions: Float64Array;
  normals: Float64Array;
  uvs: Float64Array;
  indices: Uint32Array;
};

export type Revit2027ArcSurfRevTessellationResult =
  | { ok: true; mesh: Revit2027ArcSurfRevMesh }
  | { ok: false; error: string };

export type Revit2027ArcSurfRevTessellationInput = {
  surface: Revit2027SurfaceOfRevolution;
  profile: Revit2027GArc;
  /**
   * Certified rectangular trim in persisted SurfRev coordinates:
   * revolution angle first, profile parameter second.
   */
  minimumUv: Revit2027ArcSurfRevUv;
  maximumUv: Revit2027ArcSurfRevUv;
  revolutionSegments: number;
  profileSegments: number;
  tolerance?: number;
};

type Vector3 = readonly [number, number, number];

function add(
  left: Vector3,
  right: Vector3,
): [number, number, number] {
  return [
    left[0] + right[0],
    left[1] + right[1],
    left[2] + right[2],
  ];
}

function scale(vector: Vector3, scalar: number): [number, number, number] {
  return [
    vector[0] * scalar,
    vector[1] * scalar,
    vector[2] * scalar,
  ];
}

function dot(left: Vector3, right: Vector3): number {
  return (
    left[0] * right[0] +
    left[1] * right[1] +
    left[2] * right[2]
  );
}

function cross(
  left: Vector3,
  right: Vector3,
): [number, number, number] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function length(vector: Vector3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalized(vector: Vector3): [number, number, number] | null {
  const magnitude = length(vector);
  return magnitude > Number.EPSILON
    ? [
        vector[0] / magnitude,
        vector[1] / magnitude,
        vector[2] / magnitude,
      ]
    : null;
}

function finiteVector(vector: Vector3): boolean {
  return vector.every(Number.isFinite);
}

function near(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
}

function validateUnitBasis(
  x: Vector3,
  y: Vector3,
  z: Vector3,
  tolerance: number,
  label: string,
): string | null {
  if (!finiteVector(x) || !finiteVector(y) || !finiteVector(z)) {
    return `${label} contains a non-finite vector`;
  }
  if (
    !near(length(x), 1, tolerance) ||
    !near(length(y), 1, tolerance) ||
    !near(length(z), 1, tolerance)
  ) {
    return `${label} is not unit length within tolerance`;
  }
  if (
    !near(dot(x, y), 0, tolerance) ||
    !near(dot(x, z), 0, tolerance) ||
    !near(dot(y, z), 0, tolerance)
  ) {
    return `${label} is not orthogonal within tolerance`;
  }
  return null;
}

function validateSubset(
  input: Revit2027ArcSurfRevTessellationInput,
): string | null {
  const tolerance = input.tolerance ?? 1e-9;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    return "tolerance must be finite and positive";
  }
  if (
    !Number.isSafeInteger(input.revolutionSegments) ||
    input.revolutionSegments < 1 ||
    !Number.isSafeInteger(input.profileSegments) ||
    input.profileSegments < 1
  ) {
    return "SurfRev segment counts must be positive safe integers";
  }
  if (
    !finiteVector(input.surface.center) ||
    !finiteVector(input.profile.center) ||
    !Number.isFinite(input.profile.radius) ||
    input.profile.radius <= 0
  ) {
    return "SurfRev center or GArc radius is invalid";
  }
  const surfaceBasisError = validateUnitBasis(
    input.surface.xVector,
    input.surface.yVector,
    input.surface.zVector,
    tolerance,
    "SurfRev basis",
  );
  if (surfaceBasisError) return surfaceBasisError;
  const surfaceHandedness = dot(
    input.surface.xVector,
    cross(input.surface.yVector, input.surface.zVector),
  );
  if (!near(surfaceHandedness, 1, tolerance)) {
    return "browser subset requires a right-handed persisted SurfRev basis";
  }
  const profileNormal = cross(
    input.profile.xDirection,
    input.profile.yDirection,
  );
  const profileBasisError = validateUnitBasis(
    input.profile.xDirection,
    input.profile.yDirection,
    profileNormal,
    tolerance,
    "GArc basis",
  );
  if (profileBasisError) return profileBasisError;
  if (
    !near(input.profile.center[1], 0, tolerance) ||
    !near(input.profile.xDirection[1], 0, tolerance) ||
    !near(input.profile.yDirection[1], 0, tolerance)
  ) {
    return "browser subset requires the persisted GArc to lie in local XZ";
  }
  const [u0, v0] = input.minimumUv;
  const [u1, v1] = input.maximumUv;
  if (
    ![u0, v0, u1, v1].every(Number.isFinite) ||
    !(u1 > u0) ||
    !(v1 > v0)
  ) {
    return "SurfRev rectangular UV bounds are invalid";
  }
  const envelope = input.surface.surface.envelope;
  if (
    !near(u0, envelope.firstCorner[0], tolerance) ||
    !near(v0, envelope.firstCorner[1], tolerance) ||
    !near(u1, envelope.secondCorner[0], tolerance) ||
    !near(v1, envelope.secondCorner[1], tolerance)
  ) {
    return "certified trim does not match the persisted SurfRev envelope";
  }
  if (
    !near(v0, input.profile.endParameters[0], tolerance) ||
    !near(v1, input.profile.endParameters[1], tolerance)
  ) {
    return "SurfRev profile bounds do not match the persisted GArc interval";
  }
  return null;
}

/**
 * Evaluate the persisted GArc using the native `OdGeCircArc3d` construction
 * convention: center + radius * (cos(t) * xDirection + sin(t) * yDirection).
 */
export function evaluateRevit2027GArc(
  profile: Revit2027GArc,
  parameter: number,
): RevitPoint3d {
  const cosine = Math.cos(parameter);
  const sine = Math.sin(parameter);
  return add(
    profile.center,
    scale(
      add(
        scale(profile.xDirection, cosine),
        scale(profile.yDirection, sine),
      ),
      profile.radius,
    ),
  );
}

/**
 * Evaluate the persisted Revit SurfRev convention.
 *
 * UV is not OdGe's public revolved-surface order. Revit's persisted evaluator
 * uses `uv.x` as the revolution angle and `uv.y` as the profile parameter:
 *
 * `center + profile.z*zVec +
 *  profile.x*(cos(uv.x)*xVec + sin(uv.x)*yVec)`.
 */
export function evaluateRevit2027ArcSurfRev(
  surface: Revit2027SurfaceOfRevolution,
  profile: Revit2027GArc,
  uv: Revit2027ArcSurfRevUv,
): RevitPoint3d {
  const local = evaluateRevit2027GArc(profile, uv[1]);
  const radialDirection = add(
    scale(surface.xVector, Math.cos(uv[0])),
    scale(surface.yVector, Math.sin(uv[0])),
  );
  return add(
    surface.center,
    add(
      scale(radialDirection, local[0]),
      scale(surface.zVector, local[2]),
    ),
  );
}

/**
 * Tessellate only the proven rectangular, right-handed, circular-profile
 * SurfRev subset. Unsupported bases or mismatched persisted intervals fail
 * closed instead of being normalized or repaired.
 */
export function tessellateRevit2027ArcSurfRev(
  input: Revit2027ArcSurfRevTessellationInput,
): Revit2027ArcSurfRevTessellationResult {
  const validationError = validateSubset(input);
  if (validationError) return { ok: false, error: validationError };

  const uCount = input.revolutionSegments + 1;
  const vCount = input.profileSegments + 1;
  const vertexCount = uCount * vCount;
  const positions = new Float64Array(vertexCount * 3);
  const normals = new Float64Array(vertexCount * 3);
  const uvs = new Float64Array(vertexCount * 2);
  const [u0, v0] = input.minimumUv;
  const [u1, v1] = input.maximumUv;

  for (let uIndex = 0; uIndex < uCount; uIndex += 1) {
    const uFraction = uIndex / input.revolutionSegments;
    const u = u0 + (u1 - u0) * uFraction;
    const cosineU = Math.cos(u);
    const sineU = Math.sin(u);
    const radialDirection = add(
      scale(input.surface.xVector, cosineU),
      scale(input.surface.yVector, sineU),
    );
    const angularDirection = add(
      scale(input.surface.xVector, -sineU),
      scale(input.surface.yVector, cosineU),
    );
    for (let vIndex = 0; vIndex < vCount; vIndex += 1) {
      const vFraction = vIndex / input.profileSegments;
      const v = v0 + (v1 - v0) * vFraction;
      const local = evaluateRevit2027GArc(input.profile, v);
      const position = add(
        input.surface.center,
        add(
          scale(radialDirection, local[0]),
          scale(input.surface.zVector, local[2]),
        ),
      );
      const localDerivative = scale(
        add(
          scale(input.profile.xDirection, -Math.sin(v)),
          scale(input.profile.yDirection, Math.cos(v)),
        ),
        input.profile.radius,
      );
      const du = scale(angularDirection, local[0]);
      const dv = add(
        scale(radialDirection, localDerivative[0]),
        scale(input.surface.zVector, localDerivative[2]),
      );
      let normal = normalized(cross(du, dv));
      if (!normal) {
        return {
          ok: false,
          error: "SurfRev derivative normal is degenerate",
        };
      }
      if (!input.surface.surface.orientFlag) {
        normal = scale(normal, -1);
      }
      const vertexIndex = uIndex * vCount + vIndex;
      positions.set(position, vertexIndex * 3);
      normals.set(normal, vertexIndex * 3);
      uvs.set([u, v], vertexIndex * 2);
    }
  }

  const indices = new Uint32Array(
    input.revolutionSegments * input.profileSegments * 6,
  );
  let indexCursor = 0;
  for (
    let uIndex = 0;
    uIndex < input.revolutionSegments;
    uIndex += 1
  ) {
    for (
      let vIndex = 0;
      vIndex < input.profileSegments;
      vIndex += 1
    ) {
      const first = uIndex * vCount + vIndex;
      const second = (uIndex + 1) * vCount + vIndex;
      const third = second + 1;
      const fourth = first + 1;
      const triangle =
        input.surface.surface.orientFlag
          ? [first, second, fourth, second, third, fourth]
          : [first, fourth, second, second, fourth, third];
      indices.set(triangle, indexCursor);
      indexCursor += 6;
    }
  }
  return {
    ok: true,
    mesh: { positions, normals, uvs, indices },
  };
}
