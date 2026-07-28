/**
 * Browser-safe subset of the native ODA/Revit tessellation policy.
 *
 * The formulas in this file are recovered from the supplied native geometry
 * stack. They do not load or call the native binaries, which keeps the parser
 * client-side and web-safe.
 *
 * Evidence:
 * - TB_Database.tx:
 *   OdBmModelerGeometryImpl::setLevelOfDetail(double), RVA 0x221a9fc
 * - libTD_BrepRenderer.so:
 *   wrTriangulationParams::wrTriangulationParams(bool), RVA 0x117434
 *   wrCylinder::calculateMaxStepUV(...), RVA 0x1645c6
 *   wrPlane::calculateMaxStepUV(...), RVA 0x126b40
 *   SrfTess::findBreakDirection(...), RVA 0x1a3c9e
 */

export type NativeTessellationPolicy = {
  /** Native level-of-detail input in the closed interval [0, 1]. */
  levelOfDetail: number;
  /** Native triangulation-parameter double at byte offset +8. */
  maximumEdgeLength: number;
  /** Native triangulation-parameter double at byte offset +16, in degrees. */
  maximumAngleDegrees: number;
  /** Native triangulation-parameter double at byte offset +24. */
  surfaceDeviation: number;
  /**
   * Native uint16 at byte offset +40.
   *
   * Its exact downstream meaning is not yet proved, so it is deliberately not
   * given a semantic name or used to invent browser tessellation behavior.
   */
  nativeWord40: number;
};

export type NativeSurfaceParamSteps = {
  /** Maximum normalized axial-cylinder parameter step. */
  maximumUStep: number;
  /** Maximum angular-cylinder parameter step, in radians. Zero means inactive. */
  maximumVStep: number;
};

export type NativeTessellationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const SQRT_TWO = Math.SQRT2;
const FULL_TURN_RADIANS = Math.PI * 2;
const NATIVE_ZERO_TOLERANCE = 1e-10;

/**
 * Reconstruct the values written by native `setLevelOfDetail`.
 *
 * The native renderer keeps its default 360-degree angular limit while this
 * method replaces maximum edge length, surface deviation, and the uint16 at
 * offset +40. A negative LOD throws natively; this browser boundary rejects all
 * out-of-domain and non-finite inputs instead of silently guessing.
 */
export function nativeTessellationPolicyForLevelOfDetail(
  levelOfDetail: number,
  boundingBoxDiagonal: number,
): NativeTessellationResult<NativeTessellationPolicy> {
  if (!Number.isFinite(levelOfDetail) || levelOfDetail < 0 || levelOfDetail > 1) {
    return { ok: false, error: "levelOfDetail must be finite and within [0, 1]" };
  }
  if (!Number.isFinite(boundingBoxDiagonal) || boundingBoxDiagonal <= 0) {
    return { ok: false, error: "boundingBoxDiagonal must be finite and positive" };
  }

  // The branch boundary is intentionally exact: native code takes the second
  // branch at 0.5, leaving a small, observable discontinuity.
  const surfaceDeviation = levelOfDetail < 0.5
    ? -0.1998 * levelOfDetail + 0.09998
    : -0.000198 * levelOfDetail + 0.0001988;
  const maximumEdgeLength = (10 * boundingBoxDiagonal) / (50 * levelOfDetail + 1);
  const nativeWord40 = Math.trunc(
    44 * levelOfDetail * levelOfDetail + 4 * levelOfDetail + 2,
  );

  if (
    !Number.isFinite(surfaceDeviation) ||
    surfaceDeviation <= 0 ||
    !Number.isFinite(maximumEdgeLength) ||
    maximumEdgeLength <= 0
  ) {
    return { ok: false, error: "native LOD formula produced an invalid policy" };
  }

  return {
    ok: true,
    value: {
      levelOfDetail,
      maximumEdgeLength,
      maximumAngleDegrees: 360,
      surfaceDeviation,
      nativeWord40,
    },
  };
}

/**
 * Native plane UV step. Both directions use maximumEdgeLength / sqrt(2).
 */
export function nativePlaneMaximumParamSteps(
  maximumEdgeLength: number,
): NativeTessellationResult<readonly [number, number]> {
  if (!Number.isFinite(maximumEdgeLength) || maximumEdgeLength <= 0) {
    return { ok: false, error: "maximumEdgeLength must be finite and positive" };
  }
  const step = maximumEdgeLength / SQRT_TWO;
  return { ok: true, value: [step, step] };
}

/**
 * Exact analytic cylinder step limits from `wrCylinder::calculateMaxStepUV`.
 *
 * Cylinder U is the axial distance normalized by radius; V is the angle in
 * radians. A returned V step of zero matches the native inactive/no-limit
 * sentinel. Browser callers must not interpret it as permission to emit an
 * unbounded mesh.
 */
export function nativeCylinderMaximumParamSteps(
  radius: number,
  maximumEdgeLength: number,
  maximumAngleDegrees: number,
): NativeTessellationResult<NativeSurfaceParamSteps> {
  if (!Number.isFinite(radius) || radius <= NATIVE_ZERO_TOLERANCE) {
    return { ok: false, error: "radius must be finite and greater than 1e-10" };
  }
  if (!Number.isFinite(maximumEdgeLength) || maximumEdgeLength < 0) {
    return { ok: false, error: "maximumEdgeLength must be finite and non-negative" };
  }
  if (
    !Number.isFinite(maximumAngleDegrees) ||
    maximumAngleDegrees < 0
  ) {
    return { ok: false, error: "maximumAngleDegrees must be finite and non-negative" };
  }

  const maximumUStep = maximumEdgeLength > NATIVE_ZERO_TOLERANCE
    ? Math.abs(maximumEdgeLength / radius) / SQRT_TWO
    : 0;

  const angularCandidates: number[] = [];
  if (maximumEdgeLength > NATIVE_ZERO_TOLERANCE) {
    const chordRatio = Math.abs(maximumEdgeLength / (2 * radius));
    if (chordRatio <= 1) {
      angularCandidates.push((2 * Math.asin(chordRatio)) / SQRT_TWO);
    }
  }
  if (maximumAngleDegrees > NATIVE_ZERO_TOLERANCE) {
    angularCandidates.push(
      Math.min(
        FULL_TURN_RADIANS,
        Math.max(0, FULL_TURN_RADIANS * (maximumAngleDegrees / 360)),
      ),
    );
  }

  const activeCandidates = angularCandidates.filter(
    (candidate) => Number.isFinite(candidate) && candidate > NATIVE_ZERO_TOLERANCE,
  );
  const maximumVStep = activeCandidates.length
    ? Math.min(...activeCandidates)
    : 0;

  return {
    ok: true,
    value: { maximumUStep, maximumVStep },
  };
}

/**
 * Circular chord angle whose midpoint deviation is the supplied tolerance.
 *
 * The native adaptive surface tessellator compares a cell's deviation with the
 * +24 policy value. This is the conservative closed-form realization of that
 * same geometric bound for a circle; it does not claim native triangle ordering.
 */
export function circularArcStepForSurfaceDeviation(
  radius: number,
  surfaceDeviation: number,
): NativeTessellationResult<number> {
  if (!Number.isFinite(radius) || radius <= NATIVE_ZERO_TOLERANCE) {
    return { ok: false, error: "radius must be finite and greater than 1e-10" };
  }
  if (!Number.isFinite(surfaceDeviation) || surfaceDeviation < 0) {
    return { ok: false, error: "surfaceDeviation must be finite and non-negative" };
  }
  if (surfaceDeviation <= NATIVE_ZERO_TOLERANCE || surfaceDeviation >= 2 * radius) {
    return { ok: true, value: 0 };
  }
  return {
    ok: true,
    value: 2 * Math.acos(1 - surfaceDeviation / radius),
  };
}

export type NativeCircularArcSegmentOptions = {
  minimumSegments?: number;
  maximumSegments?: number;
};

/**
 * Bounded circular-arc subdivision using the proven cylinder limits.
 *
 * This combines the native analytic cylinder step with the circular form of its
 * adaptive deviation test. If neither supplies an active bound, it fails closed
 * instead of reinstating an arbitrary viewer angle.
 */
export function nativeCircularArcSegmentCount(
  radius: number,
  sweepRadians: number,
  policy: Pick<
    NativeTessellationPolicy,
    "maximumEdgeLength" | "maximumAngleDegrees" | "surfaceDeviation"
  >,
  options: NativeCircularArcSegmentOptions = {},
): NativeTessellationResult<number> {
  if (!Number.isFinite(sweepRadians) || Math.abs(sweepRadians) <= NATIVE_ZERO_TOLERANCE) {
    return { ok: false, error: "sweepRadians must be finite and non-zero" };
  }
  const minimumSegments = options.minimumSegments ?? 2;
  const maximumSegments = options.maximumSegments ?? 1_000_000;
  if (
    !Number.isSafeInteger(minimumSegments) ||
    minimumSegments < 1 ||
    !Number.isSafeInteger(maximumSegments) ||
    maximumSegments < minimumSegments
  ) {
    return { ok: false, error: "segment bounds must be safe integers with 1 <= min <= max" };
  }

  const cylinder = nativeCylinderMaximumParamSteps(
    radius,
    policy.maximumEdgeLength,
    policy.maximumAngleDegrees,
  );
  if (!cylinder.ok) return cylinder;
  const deviation = circularArcStepForSurfaceDeviation(radius, policy.surfaceDeviation);
  if (!deviation.ok) return deviation;

  const activeSteps = [cylinder.value.maximumVStep, deviation.value].filter(
    (step) => Number.isFinite(step) && step > NATIVE_ZERO_TOLERANCE,
  );
  if (!activeSteps.length) {
    return { ok: false, error: "policy provides no active angular subdivision limit" };
  }

  const maximumStep = Math.min(...activeSteps);
  const required = Math.max(
    minimumSegments,
    Math.ceil(Math.abs(sweepRadians) / maximumStep),
  );
  if (!Number.isSafeInteger(required) || required > maximumSegments) {
    return {
      ok: false,
      error: `arc requires ${required} segments, exceeding the ${maximumSegments} safety bound`,
    };
  }
  return { ok: true, value: required };
}
