/**
 * Convex polyhedra reconstructed from persisted Revit plane patches.
 *
 * A set of face planes is not automatically a solid. This decoder accepts a
 * set only when all of its planes participate in one bounded half-space
 * intersection and every reconstructed face remains inside the trim rectangle
 * stored on its source plane. Open, non-convex, fragmented, or ambiguously
 * coplanar sets are declined instead of being filled with invented geometry.
 */
import type { PlanePatch, Vector3 } from "./surfaces.ts";

const DISTANCE_TOLERANCE = 1e-6;
const PARAMETER_TOLERANCE = 1e-5;
const DETERMINANT_TOLERANCE = 1e-10;
const MIN_VOLUME = 1e-9;

export type ConvexFacetMesh = {
  elementId: number;
  /** World-space coordinates in Revit's native feet. */
  positions: number[];
  indices: number[];
  /** Source plane offset for each triangle, indexed by triangle number. */
  sourcePlaneOffsets: number[];
};

export type ConvexFacetFailure =
  | "too-few-planes"
  | "ambiguous-coplanar-trims"
  | "unbounded-or-empty"
  | "incomplete-face"
  | "outside-source-trim"
  | "degenerate-volume";

export type ConvexFacetResult =
  | { mesh: ConvexFacetMesh; reason?: never }
  | { mesh?: never; reason: ConvexFacetFailure };

type OrientedPlane = {
  source: PlanePatch;
  normal: Vector3;
  distance: number;
};

function add(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(a: Vector3, factor: number): Vector3 {
  return { x: a.x * factor, y: a.y * factor, z: a.z * factor };
}

function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function length(a: Vector3): number {
  return Math.hypot(a.x, a.y, a.z);
}

function samePoint(a: Vector3, b: Vector3): boolean {
  return length(subtract(a, b)) <= DISTANCE_TOLERANCE;
}

function canonicalPlaneKey(plane: PlanePatch): string {
  let normal = cross(plane.uDir, plane.vDir);
  let distance = dot(normal, plane.origin);
  const firstNonZero = [normal.x, normal.y, normal.z].find((value) => Math.abs(value) > 1e-12) ?? 0;
  if (firstNonZero < 0) {
    normal = scale(normal, -1);
    distance *= -1;
  }
  const rounded = [normal.x, normal.y, normal.z, distance].map(
    (value) => Math.round(value / DISTANCE_TOLERANCE),
  );
  return rounded.join(",");
}

function sameTrim(left: PlanePatch, right: PlanePatch): boolean {
  const corners = (plane: PlanePatch) => {
    const at = (u: number, v: number) =>
      add(plane.origin, add(scale(plane.uDir, u), scale(plane.vDir, v)));
    return [
      at(plane.uMin, plane.vMin),
      at(plane.uMax, plane.vMin),
      at(plane.uMax, plane.vMax),
      at(plane.uMin, plane.vMax),
    ];
  };
  const leftCorners = corners(left);
  const rightCorners = corners(right);
  return leftCorners.every((point) => rightCorners.some((candidate) => samePoint(point, candidate)));
}

function deduplicatePlanes(planes: PlanePatch[]): PlanePatch[] | null {
  const unique = new Map<string, PlanePatch>();
  for (const plane of planes) {
    const key = canonicalPlaneKey(plane);
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, plane);
      continue;
    }
    // Identical repeated faces are common. Distinct coplanar trim regions need
    // loop unioning and are outside this deliberately narrow decoder.
    if (!sameTrim(existing, plane)) return null;
  }
  return [...unique.values()];
}

function intersection(a: OrientedPlane, b: OrientedPlane, c: OrientedPlane): Vector3 | null {
  const bCrossC = cross(b.normal, c.normal);
  const determinant = dot(a.normal, bCrossC);
  if (Math.abs(determinant) <= DETERMINANT_TOLERANCE) return null;
  return scale(
    add(
      add(scale(bCrossC, a.distance), scale(cross(c.normal, a.normal), b.distance)),
      scale(cross(a.normal, b.normal), c.distance),
    ),
    1 / determinant,
  );
}

function inside(point: Vector3, planes: OrientedPlane[]): boolean {
  return planes.every(
    (plane) => dot(plane.normal, point) - plane.distance <= DISTANCE_TOLERANCE,
  );
}

function withinTrim(point: Vector3, plane: PlanePatch): boolean {
  const relative = subtract(point, plane.origin);
  const u = dot(relative, plane.uDir);
  const v = dot(relative, plane.vDir);
  return (
    u >= plane.uMin - PARAMETER_TOLERANCE &&
    u <= plane.uMax + PARAMETER_TOLERANCE &&
    v >= plane.vMin - PARAMETER_TOLERANCE &&
    v <= plane.vMax + PARAMETER_TOLERANCE
  );
}

function signedVolume(positions: number[], indices: number[]): number {
  let volume = 0;
  for (let index = 0; index < indices.length; index += 3) {
    const ia = indices[index]! * 3;
    const ib = indices[index + 1]! * 3;
    const ic = indices[index + 2]! * 3;
    const a = { x: positions[ia]!, y: positions[ia + 1]!, z: positions[ia + 2]! };
    const b = { x: positions[ib]!, y: positions[ib + 1]!, z: positions[ib + 2]! };
    const c = { x: positions[ic]!, y: positions[ic + 1]!, z: positions[ic + 2]! };
    volume += dot(a, cross(b, c)) / 6;
  }
  return volume;
}

/**
 * Rebuild one bounded convex polyhedron, or return `null` when the source
 * planes do not fully and unambiguously define one.
 */
export function analyseConvexFacetMesh(
  elementId: number,
  sourcePlanes: PlanePatch[],
): ConvexFacetResult {
  const planes = deduplicatePlanes(sourcePlanes);
  if (!planes) return { reason: "ambiguous-coplanar-trims" };
  if (planes.length < 4) return { reason: "too-few-planes" };

  const centre = scale(
    planes.reduce((sum, plane) => add(sum, plane.origin), { x: 0, y: 0, z: 0 }),
    1 / planes.length,
  );
  const oriented: OrientedPlane[] = planes.map((source) => {
    let normal = cross(source.uDir, source.vDir);
    let distance = dot(normal, source.origin);
    if (dot(normal, centre) > distance) {
      normal = scale(normal, -1);
      distance *= -1;
    }
    return { source, normal, distance };
  });

  const vertices: Vector3[] = [];
  for (let a = 0; a + 2 < oriented.length; a += 1) {
    for (let b = a + 1; b + 1 < oriented.length; b += 1) {
      for (let c = b + 1; c < oriented.length; c += 1) {
        const point = intersection(oriented[a]!, oriented[b]!, oriented[c]!);
        if (!point || !inside(point, oriented)) continue;
        if (!vertices.some((candidate) => samePoint(point, candidate))) vertices.push(point);
      }
    }
  }
  if (vertices.length < 4) return { reason: "unbounded-or-empty" };

  const positions = vertices.flatMap((point) => [point.x, point.y, point.z]);
  const indices: number[] = [];
  const sourcePlaneOffsets: number[] = [];
  for (const plane of oriented) {
    const face = vertices
      .map((point, index) => ({ point, index }))
      .filter(({ point }) =>
        Math.abs(dot(plane.normal, point) - plane.distance) <= DISTANCE_TOLERANCE * 2
      );
    if (face.length < 3) return { reason: "incomplete-face" };
    if (face.some(({ point }) => !withinTrim(point, plane.source))) {
      return { reason: "outside-source-trim" };
    }

    const faceCentre = scale(
      face.reduce((sum, item) => add(sum, item.point), { x: 0, y: 0, z: 0 }),
      1 / face.length,
    );
    face.sort((left, right) => {
      const leftRelative = subtract(left.point, faceCentre);
      const rightRelative = subtract(right.point, faceCentre);
      const leftAngle = Math.atan2(
        dot(leftRelative, plane.source.vDir),
        dot(leftRelative, plane.source.uDir),
      );
      const rightAngle = Math.atan2(
        dot(rightRelative, plane.source.vDir),
        dot(rightRelative, plane.source.uDir),
      );
      return leftAngle - rightAngle;
    });
    if (
      dot(
        cross(subtract(face[1]!.point, face[0]!.point), subtract(face[2]!.point, face[0]!.point)),
        plane.normal,
      ) < 0
    ) {
      face.reverse();
    }
    for (let index = 1; index + 1 < face.length; index += 1) {
      indices.push(face[0]!.index, face[index]!.index, face[index + 1]!.index);
      sourcePlaneOffsets.push(plane.source.offset);
    }
  }

  const volume = signedVolume(positions, indices);
  if (!Number.isFinite(volume) || Math.abs(volume) < MIN_VOLUME) {
    return { reason: "degenerate-volume" };
  }
  if (volume < 0) {
    for (let index = 0; index < indices.length; index += 3) {
      [indices[index + 1], indices[index + 2]] = [indices[index + 2]!, indices[index + 1]!];
    }
  }
  return { mesh: { elementId, positions, indices, sourcePlaneOffsets } };
}

export function convexFacetMesh(
  elementId: number,
  sourcePlanes: PlanePatch[],
): ConvexFacetMesh | null {
  return analyseConvexFacetMesh(elementId, sourcePlanes).mesh ?? null;
}
