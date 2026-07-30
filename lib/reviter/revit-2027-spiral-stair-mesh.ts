import type {
  BrepProvenance,
  NeutralFaceMesh,
  NeutralMeshFaceGroup,
} from "./brep-tessellator.ts";
import {
  REVIT_2027_GCYLINDRICAL_HELIX_SOURCE_CLASS_SLOT,
  type Revit2027GCylindricalHelix,
} from "./revit-2027-gcylindrical-helix.ts";
import type { Revit2027GRepReplay } from "./revit-2027-grep-replay.ts";
import type { Revit2027StairsRunAndLandingAggregate } from "./revit-2027-stairs-aggregate.ts";

const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const;
const TOLERANCE = 1e-6;
const MAX_ANGULAR_STEP = Math.PI / 36;

type Point3 = readonly [number, number, number];

export type Revit2027SpiralStairMesh = {
  faceToken: 0;
  mesh: NeutralFaceMesh;
  treadCount: number;
  triangles: number;
};

function near(left: number, right: number): boolean {
  return Math.abs(left - right) <= TOLERANCE;
}

function same3(left: Point3, right: Point3): boolean {
  return near(left[0], right[0]) &&
    near(left[1], right[1]) &&
    near(left[2], right[2]);
}

function pointAt(
  helix: Revit2027GCylindricalHelix,
  parameter: number,
  z: number,
): Point3 {
  const cosine = Math.cos(parameter);
  const sine = Math.sin(parameter);
  return [
    helix.basePoint[0] +
      helix.radius *
        (cosine * helix.xVector[0] + sine * helix.yVector[0]),
    helix.basePoint[1] +
      helix.radius *
        (cosine * helix.xVector[1] + sine * helix.yVector[1]),
    z,
  ];
}

function compatible(
  inner: Revit2027GCylindricalHelix,
  outer: Revit2027GCylindricalHelix,
  run: Revit2027StairsRunAndLandingAggregate,
): boolean {
  const properties = run.runProperties;
  return properties != null &&
    inner.radius > 0 &&
    outer.radius > inner.radius &&
    near(outer.radius - inner.radius, properties.actualRunWidthFeet) &&
    near(inner.endParameters[0], outer.endParameters[0]) &&
    near(inner.endParameters[1], outer.endParameters[1]) &&
    near(inner.pitchOver2Pi, outer.pitchOver2Pi) &&
    same3(inner.basePoint, outer.basePoint) &&
    same3(inner.xVector, outer.xVector) &&
    same3(inner.yVector, outer.yVector) &&
    same3(inner.zVector, outer.zVector);
}

/**
 * Recover an exact-count spiral flight from its persisted StairsRun scalars and
 * matching inner/outer GCylindricalHelix guides.
 *
 * The run supplies the riser indexes and elevations; the guides supply the
 * center, radii, basis and angular interval. Each tread is a closed annular
 * wedge spanning one exact riser interval. Tessellation affects only display
 * smoothness, never the recovered stair dimensions or tread count.
 */
export function meshRevit2027SpiralStairReplay(
  replay: Revit2027GRepReplay,
  run: Revit2027StairsRunAndLandingAggregate,
): Revit2027SpiralStairMesh | null {
  const properties = run.runProperties;
  if (!properties || run.elementId !== Number(replay.ownerElementId)) return null;
  const helices = replay.spans
    .filter(
      (span) =>
        span.parentReplayIndex == null &&
        span.propertySourceClassSlot ===
          REVIT_2027_GCYLINDRICAL_HELIX_SOURCE_CLASS_SLOT,
    )
    .map((span) => span.value as Revit2027GCylindricalHelix)
    .sort((left, right) => left.radius - right.radius);
  if (helices.length !== 2 || !compatible(helices[0]!, helices[1]!, run)) {
    return null;
  }
  const inner = helices[0]!;
  const outer = helices[1]!;
  const treadCount = properties.topRiserIndex - run.baseRiserIndex;
  const totalRise =
    properties.topElevationFeet - properties.bottomElevationFeet;
  const parameterSpan =
    inner.endParameters[1] - inner.endParameters[0];
  if (
    treadCount < 1 ||
    treadCount > 1000 ||
    !Number.isFinite(totalRise) ||
    totalRise <= 0 ||
    !Number.isFinite(parameterSpan) ||
    Math.abs(parameterSpan) <= TOLERANCE
  ) {
    return null;
  }
  const rise = totalRise / treadCount;
  const parameterStep = parameterSpan / treadCount;
  const angularSegmentsPerTread = Math.max(
    1,
    Math.ceil(Math.abs(parameterStep) / MAX_ANGULAR_STEP),
  );
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const appendQuad = (
    first: Point3,
    second: Point3,
    third: Point3,
    fourth: Point3,
  ): void => {
    const base = positions.length / 3;
    const ab = [
      second[0] - first[0],
      second[1] - first[1],
      second[2] - first[2],
    ] as const;
    const ad = [
      fourth[0] - first[0],
      fourth[1] - first[1],
      fourth[2] - first[2],
    ] as const;
    const raw = [
      ab[1] * ad[2] - ab[2] * ad[1],
      ab[2] * ad[0] - ab[0] * ad[2],
      ab[0] * ad[1] - ab[1] * ad[0],
    ] as const;
    const length = Math.hypot(...raw);
    if (!Number.isFinite(length) || length <= Number.EPSILON) return;
    const normal = raw.map((value) => value / length);
    positions.push(...first, ...second, ...third, ...fourth);
    for (let index = 0; index < 4; index += 1) normals.push(...normal);
    indices.push(base, base + 1, base + 3, base + 1, base + 2, base + 3);
  };

  for (let tread = 0; tread < treadCount; tread += 1) {
    const bottomZ = properties.bottomElevationFeet + rise * tread;
    const topZ = bottomZ + rise;
    const start = inner.endParameters[0] + parameterStep * tread;
    for (
      let segment = 0;
      segment < angularSegmentsPerTread;
      segment += 1
    ) {
      const first =
        start + parameterStep * (segment / angularSegmentsPerTread);
      const second =
        start + parameterStep * ((segment + 1) / angularSegmentsPerTread);
      const topInnerFirst = pointAt(inner, first, topZ);
      const topOuterFirst = pointAt(outer, first, topZ);
      const topInnerSecond = pointAt(inner, second, topZ);
      const topOuterSecond = pointAt(outer, second, topZ);
      const bottomInnerFirst = pointAt(inner, first, bottomZ);
      const bottomOuterFirst = pointAt(outer, first, bottomZ);
      const bottomInnerSecond = pointAt(inner, second, bottomZ);
      const bottomOuterSecond = pointAt(outer, second, bottomZ);
      appendQuad(
        topInnerFirst,
        topOuterFirst,
        topOuterSecond,
        topInnerSecond,
      );
      appendQuad(
        bottomInnerSecond,
        bottomOuterSecond,
        bottomOuterFirst,
        bottomInnerFirst,
      );
      appendQuad(
        bottomInnerFirst,
        topInnerFirst,
        topInnerSecond,
        bottomInnerSecond,
      );
      appendQuad(
        bottomOuterSecond,
        topOuterSecond,
        topOuterFirst,
        bottomOuterFirst,
      );
      if (segment === 0) {
        appendQuad(
          bottomOuterFirst,
          topOuterFirst,
          topInnerFirst,
          bottomInnerFirst,
        );
      }
      if (segment === angularSegmentsPerTread - 1) {
        appendQuad(
          bottomInnerSecond,
          topInnerSecond,
          topOuterSecond,
          bottomOuterSecond,
        );
      }
    }
  }
  if (indices.length === 0) return null;
  const elementId = Number(replay.ownerElementId);
  const provenance: BrepProvenance = {
    decoderId: "revit-2027-spiral-stair-mesh",
    elementId,
  };
  const group: NeutralMeshFaceGroup = {
    faceId: `revit-2027-owner-${replay.ownerElementId}-spiral-treads`,
    indexOffset: 0,
    indexCount: indices.length,
    vertexOffset: 0,
    vertexCount: positions.length / 3,
    materialId: null,
    sourceTransform: IDENTITY,
    brepProvenance: provenance,
    faceProvenance: provenance,
  };
  const mesh: NeutralFaceMesh = {
    brepId: `revit-2027-owner-${replay.ownerElementId}-spiral-treads`,
    positions: Float64Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
    groups: [group],
  };
  return {
    faceToken: 0,
    mesh,
    treadCount,
    triangles: indices.length / 3,
  };
}
