/** Reusable registration records for non-destructive floor-plan reference overlays. */

export type FloorReferencePoint = {
  /** Normalized horizontal coordinate in the displayed plan frame. */
  x: number;
  /** Normalized vertical coordinate in the displayed plan frame. */
  y: number;
};

export type FloorReferenceTransform = {
  /** SVG affine matrix values: matrix(a b c d e f). */
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

export type FloorReferenceControlPair = {
  reference: FloorReferencePoint;
  rvt: FloorReferencePoint;
};

export type FloorReferenceAlignment = {
  kind: "reviter-floor-reference-alignment";
  version: 1;
  coordinateSpace: "normalized-plan-image";
  source: {
    fileName: string;
    mediaType: string;
    sha256: string | null;
    section?: {
      id: string;
      label: string;
      bounds: { x: number; y: number; width: number; height: number };
    };
  };
  target: {
    rvtFileName: string;
    levelIds: number[];
  };
  transform: FloorReferenceTransform;
  controlPairs: FloorReferenceControlPair[];
  residual: {
    rms: number;
    maximum: number;
    units: "normalized-plan-width";
  };
  opacity: number;
  createdAt: string;
};

export const IDENTITY_FLOOR_REFERENCE_TRANSFORM: FloorReferenceTransform = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
};

function finitePoint(point: FloorReferencePoint) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function applyFloorReferenceTransform(
  transform: FloorReferenceTransform,
  point: FloorReferencePoint,
): FloorReferencePoint {
  return {
    x: transform.a * point.x + transform.c * point.y + transform.e,
    y: transform.b * point.x + transform.d * point.y + transform.f,
  };
}

/**
 * Least-squares 2D similarity fit. Uniform scale and rotation are intentional:
 * CAD evidence may be moved and rotated, but it must never be stretched until
 * it appears to agree with the RVT.
 */
export function fitFloorReferenceTransform(
  pairs: readonly FloorReferenceControlPair[],
): {
  transform: FloorReferenceTransform;
  rms: number;
  maximum: number;
} {
  if (pairs.length < 2 || pairs.some(({ reference, rvt }) => !finitePoint(reference) || !finitePoint(rvt))) {
    throw new Error("At least two finite reference/RVT control pairs are required.");
  }
  const count = pairs.length;
  const referenceCenter = pairs.reduce(
    (center, pair) => ({ x: center.x + pair.reference.x / count, y: center.y + pair.reference.y / count }),
    { x: 0, y: 0 },
  );
  const rvtCenter = pairs.reduce(
    (center, pair) => ({ x: center.x + pair.rvt.x / count, y: center.y + pair.rvt.y / count }),
    { x: 0, y: 0 },
  );
  let dot = 0;
  let cross = 0;
  let referenceEnergy = 0;
  for (const pair of pairs) {
    const sourceX = pair.reference.x - referenceCenter.x;
    const sourceY = pair.reference.y - referenceCenter.y;
    const targetX = pair.rvt.x - rvtCenter.x;
    const targetY = pair.rvt.y - rvtCenter.y;
    dot += sourceX * targetX + sourceY * targetY;
    cross += sourceX * targetY - sourceY * targetX;
    referenceEnergy += sourceX * sourceX + sourceY * sourceY;
  }
  if (referenceEnergy <= 1e-12) throw new Error("Reference control points must not coincide.");
  const a = dot / referenceEnergy;
  const b = cross / referenceEnergy;
  const transform: FloorReferenceTransform = {
    a,
    b,
    c: -b,
    d: a,
    e: rvtCenter.x - a * referenceCenter.x + b * referenceCenter.y,
    f: rvtCenter.y - b * referenceCenter.x - a * referenceCenter.y,
  };
  const errors = pairs.map((pair) => {
    const fitted = applyFloorReferenceTransform(transform, pair.reference);
    return Math.hypot(fitted.x - pair.rvt.x, fitted.y - pair.rvt.y);
  });
  return {
    transform,
    rms: Math.sqrt(errors.reduce((total, error) => total + error * error, 0) / errors.length),
    maximum: Math.max(...errors),
  };
}

export function decomposeFloorReferenceTransform(transform: FloorReferenceTransform) {
  return {
    scale: Math.hypot(transform.a, transform.b),
    rotationDegrees: Math.atan2(transform.b, transform.a) * 180 / Math.PI,
    offsetX: transform.e,
    offsetY: transform.f,
  };
}

export function composeFloorReferenceTransform({
  scale,
  rotationDegrees,
  offsetX,
  offsetY,
}: {
  scale: number;
  rotationDegrees: number;
  offsetX: number;
  offsetY: number;
}): FloorReferenceTransform {
  const angle = rotationDegrees * Math.PI / 180;
  const a = Math.cos(angle) * scale;
  const b = Math.sin(angle) * scale;
  return { a, b, c: -b, d: a, e: offsetX, f: offsetY };
}

export function floorReferenceTransformAttribute(transform: FloorReferenceTransform) {
  return `matrix(${transform.a} ${transform.b} ${transform.c} ${transform.d} ${transform.e} ${transform.f})`;
}

function isFiniteTransform(value: unknown): value is FloorReferenceTransform {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return ["a", "b", "c", "d", "e", "f"].every((key) => Number.isFinite(record[key]));
}

export function parseFloorReferenceAlignment(text: string): FloorReferenceAlignment {
  const value = JSON.parse(text) as Partial<FloorReferenceAlignment>;
  if (
    value.kind !== "reviter-floor-reference-alignment" ||
    value.version !== 1 ||
    value.coordinateSpace !== "normalized-plan-image" ||
    !isFiniteTransform(value.transform) ||
    !value.source || typeof value.source.fileName !== "string" ||
    !value.target || typeof value.target.rvtFileName !== "string" ||
    !Array.isArray(value.target.levelIds) || !value.target.levelIds.every(Number.isFinite) ||
    !Array.isArray(value.controlPairs) ||
    !value.residual || !Number.isFinite(value.residual.rms) || !Number.isFinite(value.residual.maximum) ||
    !Number.isFinite(value.opacity)
  ) throw new Error("This is not a valid Reviter floor-reference alignment file.");
  return value as FloorReferenceAlignment;
}

export function makeFloorReferenceAlignment({
  source,
  rvtFileName,
  levelIds,
  controlPairs,
  transform,
  rms,
  maximum,
  opacity,
  createdAt = new Date().toISOString(),
}: {
  source: FloorReferenceAlignment["source"];
  rvtFileName: string;
  levelIds: number[];
  controlPairs: FloorReferenceControlPair[];
  transform: FloorReferenceTransform;
  rms: number;
  maximum: number;
  opacity: number;
  createdAt?: string;
}): FloorReferenceAlignment {
  return {
    kind: "reviter-floor-reference-alignment",
    version: 1,
    coordinateSpace: "normalized-plan-image",
    source,
    target: { rvtFileName, levelIds },
    transform,
    controlPairs,
    residual: { rms, maximum, units: "normalized-plan-width" },
    opacity: Math.max(0, Math.min(1, opacity)),
    createdAt,
  };
}
