import type {
  BrepProvenance,
  NeutralFaceMesh,
  NeutralMeshFaceGroup,
} from "./brep-tessellator.ts";
import type {
  Revit2027TopRailCurveLoop,
  Revit2027TopRailTypeCurves,
} from "./revit-2027-baluster-instances.ts";
import { triangulate, type Point2 } from "./polygon.ts";

const TOLERANCE_FEET = 1e-6;

/**
 * The supplied model's certified native population has one square top-rail
 * family: 165 independently drawn railings measure 0.164041994750612..
 * 0.164041994750733 ft across their persisted edge pair and
 * 0.164041994750654..0.164041994750770 ft through a horizontal native
 * section. The largest width/height deviation is 1.44e-13 ft.
 *
 * Width is never taken from this value. The persisted edge pair supplies it.
 * This family value is only a fail-closed membership gate for applying the
 * measured square-section relationship to the otherwise missing height.
 */
export const REVIT_2027_MEASURED_SQUARE_TOP_RAIL_SECTION_FEET =
  0.164041994750656;

const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const;

type Point3 = readonly [number, number, number];

export type Revit2027TopRailSectionMesh = {
  faceToken: 0;
  mesh: NeutralFaceMesh;
  triangles: number;
  sectionWidthFeet: number;
  sectionHeightFeet: number;
  boundarySegments: number;
  source: "TopRailType.m_curveLoopData.curves+measured-square-section";
};

function near(left: number, right: number): boolean {
  return Math.abs(left - right) <= TOLERANCE_FEET;
}

function samePoint(left: Point3, right: Point3): boolean {
  return (
    near(left[0], right[0]) &&
    near(left[1], right[1]) &&
    near(left[2], right[2])
  );
}

function loopPoints(loop: Revit2027TopRailCurveLoop): Point3[] | null {
  if (
    loop.segments.length === 0 ||
    loop.segments.some(({ kind }) => kind !== "GLine")
  ) {
    return null;
  }
  const points: Point3[] = [loop.segments[0]!.start];
  for (const segment of loop.segments) {
    if (!samePoint(points.at(-1)!, segment.start)) return null;
    if (samePoint(segment.start, segment.end)) return null;
    points.push(segment.end);
  }
  return points;
}

function parallelSeparation(
  left: Point3,
  leftEnd: Point3,
  right: Point3,
  rightEnd: Point3,
): number | null {
  const leftX = leftEnd[0] - left[0];
  const leftY = leftEnd[1] - left[1];
  const rightX = rightEnd[0] - right[0];
  const rightY = rightEnd[1] - right[1];
  const leftLength = Math.hypot(leftX, leftY);
  const rightLength = Math.hypot(rightX, rightY);
  if (leftLength <= TOLERANCE_FEET || rightLength <= TOLERANCE_FEET) {
    return null;
  }
  const unitX = leftX / leftLength;
  const unitY = leftY / leftLength;
  const alignment = Math.abs(
    unitX * (rightX / rightLength) + unitY * (rightY / rightLength),
  );
  if (alignment < 1 - 1e-8) return null;
  const leftMinimum = Math.min(
    left[0] * unitX + left[1] * unitY,
    leftEnd[0] * unitX + leftEnd[1] * unitY,
  );
  const leftMaximum = Math.max(
    left[0] * unitX + left[1] * unitY,
    leftEnd[0] * unitX + leftEnd[1] * unitY,
  );
  const rightMinimum = Math.min(
    right[0] * unitX + right[1] * unitY,
    rightEnd[0] * unitX + rightEnd[1] * unitY,
  );
  const rightMaximum = Math.max(
    right[0] * unitX + right[1] * unitY,
    rightEnd[0] * unitX + rightEnd[1] * unitY,
  );
  if (
    Math.min(leftMaximum, rightMaximum) -
        Math.max(leftMinimum, rightMinimum) <=
      TOLERANCE_FEET
  ) {
    return null;
  }
  return Math.abs(
    (right[0] - left[0]) * -unitY +
      (right[1] - left[1]) * unitX,
  );
}

function edgePairSeparation(
  loops: Revit2027TopRailTypeCurves["loops"],
): number | null {
  const distances: number[] = [];
  const collect = (
    left: Revit2027TopRailCurveLoop,
    right: Revit2027TopRailCurveLoop,
  ): void => {
    for (const leftSegment of left.segments) {
      let nearest = Infinity;
      for (const rightSegment of right.segments) {
        const distance = parallelSeparation(
          leftSegment.start,
          leftSegment.end,
          rightSegment.start,
          rightSegment.end,
        );
        if (distance != null && distance > TOLERANCE_FEET) {
          nearest = Math.min(nearest, distance);
        }
      }
      if (Number.isFinite(nearest)) distances.push(nearest);
    }
  };
  collect(loops[0], loops[1]);
  collect(loops[1], loops[0]);
  if (distances.length === 0) return null;
  const clusters = new Map<number, number[]>();
  for (const distance of distances) {
    const key = Math.round(distance * 1e9);
    const values = clusters.get(key) ?? [];
    values.push(distance);
    clusters.set(key, values);
  }
  const modal = [...clusters.values()].sort(
    (left, right) => right.length - left.length,
  )[0]!;
  modal.sort((left, right) => left - right);
  return modal[Math.floor(modal.length / 2)]!;
}

function perimeter(
  loops: Revit2027TopRailTypeCurves["loops"],
): Point3[] | null {
  const first = loopPoints(loops[0]);
  const second = loopPoints(loops[1]);
  if (!first || !second) return null;
  const firstStart = first[0]!;
  const firstEnd = first.at(-1)!;
  const secondStart = second[0]!;
  const secondEnd = second.at(-1)!;
  let joined: Point3[];
  if (samePoint(firstStart, secondStart) && samePoint(firstEnd, secondEnd)) {
    joined = [...first, ...[...second].reverse().slice(1)];
  } else if (
    samePoint(firstStart, secondEnd) &&
    samePoint(firstEnd, secondStart)
  ) {
    joined = [...first, ...second.slice(1)];
  } else {
    return null;
  }
  if (!samePoint(joined[0]!, joined.at(-1)!)) return null;
  joined.pop();
  if (
    joined.length < 3 ||
    joined.some((point, index) =>
      samePoint(point, joined[(index + 1) % joined.length]!)
    )
  ) {
    return null;
  }
  return joined;
}

/**
 * Close a flat, GLine-only TopRailType boundary with the square-section height
 * measured from this file's native railing population.
 *
 * The top perimeter and its width are wholly persisted. The only completed
 * dimension is height, set equal to the decoded edge-pair separation after the
 * separation passes the measured-family gate above. Unsupported curves,
 * slopes, open/mismatched edge paths, degenerate polygons and failed
 * triangulation all return null.
 */
export function meshRevit2027MeasuredSquareTopRail(
  curves: Revit2027TopRailTypeCurves,
): Revit2027TopRailSectionMesh | null {
  const ring = perimeter(curves.loops);
  if (!ring) return null;
  const top = ring[0]![2];
  if (
    ring.some(
      (point) =>
        !point.every(Number.isFinite) ||
        Math.abs(point[2] - top) > TOLERANCE_FEET,
    )
  ) {
    return null;
  }
  const sectionWidthFeet = edgePairSeparation(curves.loops);
  if (
    sectionWidthFeet == null ||
    Math.abs(
      sectionWidthFeet - REVIT_2027_MEASURED_SQUARE_TOP_RAIL_SECTION_FEET,
    ) > TOLERANCE_FEET
  ) {
    return null;
  }
  const plan = ring.map(([x, y]): Point2 => [x, y]);
  const cap = triangulate(plan);
  if (cap.length !== (ring.length - 2) * 3) return null;

  const sectionHeightFeet = sectionWidthFeet;
  const positions = new Float64Array(ring.length * 2 * 3);
  for (let layer = 0; layer < 2; layer += 1) {
    const z = top - sectionHeightFeet * layer;
    for (let index = 0; index < ring.length; index += 1) {
      const point = ring[index]!;
      const offset = (layer * ring.length + index) * 3;
      positions[offset] = point[0];
      positions[offset + 1] = point[1];
      positions[offset + 2] = z;
    }
  }
  const bottom = ring.length;
  const indices: number[] = [];
  for (let index = 0; index < cap.length; index += 3) {
    indices.push(cap[index]!, cap[index + 1]!, cap[index + 2]!);
    indices.push(
      bottom + cap[index]!,
      bottom + cap[index + 2]!,
      bottom + cap[index + 1]!,
    );
  }
  for (let index = 0; index < ring.length; index += 1) {
    const next = (index + 1) % ring.length;
    indices.push(
      index,
      bottom + index,
      bottom + next,
      index,
      bottom + next,
      next,
    );
  }

  const ownerElementId = curves.ownerElementId;
  const provenance: BrepProvenance = {
    decoderId: "revit-2027-measured-square-top-rail",
    elementId: ownerElementId,
  };
  const group: NeutralMeshFaceGroup = {
    faceId: `revit-2027-top-rail-${ownerElementId}`,
    indexOffset: 0,
    indexCount: indices.length,
    vertexOffset: 0,
    vertexCount: ring.length * 2,
    materialId: null,
    sourceTransform: IDENTITY,
    brepProvenance: provenance,
    faceProvenance: provenance,
  };
  const mesh: NeutralFaceMesh = {
    brepId: `revit-2027-top-rail-${ownerElementId}`,
    positions,
    normals: new Float32Array(positions.length),
    indices: Uint32Array.from(indices),
    groups: [group],
  };
  return {
    faceToken: 0,
    mesh,
    triangles: indices.length / 3,
    sectionWidthFeet,
    sectionHeightFeet,
    boundarySegments: ring.length,
    source: "TopRailType.m_curveLoopData.curves+measured-square-section",
  };
}
