import type {
  BrepProvenance,
  NeutralFaceMesh,
  NeutralMeshFaceGroup,
} from "./brep-tessellator.ts";
import {
  REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
  REVIT_2027_EDGE_LOOP_WITH_CHAIN_ENVELOPES_SOURCE_CLASS_SLOT,
  type Revit2027EdgeLoopStatic,
  type Revit2027EdgeLoopWithChainEnvelopesStatic,
} from "./revit-2027-edge-loop-static.ts";
import {
  REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
  revit2027GEdgeLoopDirection,
  revit2027GEdgeLoopNextReference,
  revit2027GEdgeLoopPreviousReference,
  type Revit2027EdgePoint,
  type Revit2027GEdgeStatic,
} from "./revit-2027-edge-1423.ts";
import {
  REVIT_2027_FACE_SOURCE_CLASS_SLOT,
  type Revit2027FaceStatic,
} from "./revit-2027-face-static.ts";
import {
  bindRevit2027FaceMaterial,
  type Revit2027MaterialDefinitions,
} from "./revit-2027-face-material.ts";
import {
  REVIT_2027_GCYLINDRICAL_HELIX_SOURCE_CLASS_SLOT,
  type Revit2027GCylindricalHelix,
} from "./revit-2027-gcylindrical-helix.ts";
import {
  REVIT_2027_GLINE_SOURCE_CLASS_SLOT,
  type Revit2027GLine,
} from "./revit-2027-gline.ts";
import {
  type Revit2027GRepReplay,
  type Revit2027GRepReplayOptions,
  type Revit2027GRepReplayRegistry,
  type Revit2027GRepReplaySpan,
} from "./revit-2027-grep-replay.ts";
import {
  REVIT_2027_RULED_SURFACE_SOURCE_CLASS_SLOT,
  type Revit2027RuledSurface,
} from "./revit-2027-surfaces.ts";

const DEFAULT_UV_TOLERANCE = 1e-9;
const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const;

type Point2 = readonly [number, number];
type Point3 = readonly [number, number, number];
type RuledProfile = Revit2027GCylindricalHelix | Revit2027GLine;
type Boundary = "u-min" | "u-max" | "v-min" | "v-max";
type LoopRecord = { token: number; loop: Revit2027EdgeLoopStatic };
type DirectedEdge = {
  token: number;
  edge: Revit2027GEdgeStatic;
  side: 0 | 1;
  direction: 1 | -1;
};

export type Revit2027RuledHelixOwnerMeshIssueCode =
  | "surface-unresolved"
  | "profile-unresolved"
  | "profile-mismatch"
  | "loop-unresolved"
  | "multi-loop"
  | "loop-face-mismatch"
  | "loop-envelope-mismatch"
  | "edge-unresolved"
  | "edge-face-mismatch"
  | "edge-cycle"
  | "edge-link-mismatch"
  | "uv-link-unresolved"
  | "non-rectangular-trim"
  | "opposite-sampling-mismatch"
  | "material-unresolved"
  | "tessellator-rejected";

export type Revit2027RuledHelixOwnerMeshIssue = {
  code: Revit2027RuledHelixOwnerMeshIssueCode;
  faceToken?: number;
  loopToken?: number;
  edgeToken?: number;
  detail?: string;
};

export type Revit2027RuledHelixOwnerFaceMesh = {
  faceToken: number;
  loopToken: number;
  profileTokens: readonly [number, number];
  profileKinds: readonly ["helix" | "line", "helix" | "line"];
  uSegments: number;
  vSegments: number;
  mesh: NeutralFaceMesh;
};

export type Revit2027RuledHelixOwnerMeshResult =
  | {
      ok: true;
      value: {
        ownerElementId: bigint;
        replay: Revit2027GRepReplay;
        faceMeshes: readonly Revit2027RuledHelixOwnerFaceMesh[];
        issues: readonly Revit2027RuledHelixOwnerMeshIssue[];
      };
    }
  | { ok: false; error: string };

export type Revit2027RuledHelixOwnerMeshOptions = {
  uvTolerance?: number;
  replayRegistry?: Revit2027GRepReplayRegistry;
  replayOptions?: Revit2027GRepReplayOptions;
  materialDefinitions?: Revit2027MaterialDefinitions;
  materialForFace?: (
    faceToken: number,
    face: Revit2027FaceStatic,
  ) => string | number | null | undefined;
};

function spanValue<T>(span: Revit2027GRepReplaySpan): T {
  return span.value as T;
}

function near(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
}

function same2(left: Point2, right: Point2, tolerance: number): boolean {
  return near(left[0], right[0], tolerance) &&
    near(left[1], right[1], tolerance);
}

function same3(left: Point3, right: Point3, tolerance: number): boolean {
  return near(left[0], right[0], tolerance) &&
    near(left[1], right[1], tolerance) &&
    near(left[2], right[2], tolerance);
}

function add(left: Point3, right: Point3): Point3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function subtract(left: Point3, right: Point3): Point3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function scale(point: Point3, scalar: number): Point3 {
  return [point[0] * scalar, point[1] * scalar, point[2] * scalar];
}

function mix(left: Point3, right: Point3, fraction: number): Point3 {
  return add(scale(left, 1 - fraction), scale(right, fraction));
}

function cross(left: Point3, right: Point3): Point3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalized(point: Point3): Point3 | null {
  const length = Math.hypot(...point);
  return Number.isFinite(length) && length > Number.EPSILON
    ? scale(point, 1 / length)
    : null;
}

function faceUv(point: Revit2027EdgePoint, side: 0 | 1): Point2 {
  return side === 0 ? point.firstFaceUv : point.secondFaceUv;
}

function edgeSide(
  edge: Revit2027GEdgeStatic,
  faceToken: number,
): 0 | 1 | null {
  const first = edge.faceReferences[0] === faceToken;
  const second = edge.faceReferences[1] === faceToken;
  return first === second ? null : first ? 0 : 1;
}

function directedUvs(edge: DirectedEdge): readonly Point2[] {
  const points = [
    faceUv(edge.edge.firstAndLastEdgePoints[0], edge.side),
    ...edge.edge.interiorEdgePoints.map((point) => faceUv(point, edge.side)),
    faceUv(edge.edge.firstAndLastEdgePoints[1], edge.side),
  ];
  return edge.direction === 1 ? points : points.reverse();
}

function directedLoopEdges(
  faceToken: number,
  loop: LoopRecord,
  edges: ReadonlyMap<number, Revit2027GEdgeStatic>,
  tolerance: number,
):
  | { ok: true; edges: DirectedEdge[] }
  | { ok: false; issue: Revit2027RuledHelixOwnerMeshIssue } {
  const ordered: DirectedEdge[] = [];
  const visited = new Set<number>();
  let edgeToken = loop.loop.nextEdgeReference;
  while (edgeToken !== loop.token) {
    if (edgeToken <= 0 || visited.has(edgeToken)) {
      return {
        ok: false,
        issue: { code: "edge-cycle", faceToken, loopToken: loop.token, edgeToken },
      };
    }
    const edge = edges.get(edgeToken);
    if (!edge) {
      return {
        ok: false,
        issue: {
          code: "edge-unresolved",
          faceToken,
          loopToken: loop.token,
          edgeToken,
        },
      };
    }
    const side = edgeSide(edge, faceToken);
    if (side == null) {
      return {
        ok: false,
        issue: {
          code: "edge-face-mismatch",
          faceToken,
          loopToken: loop.token,
          edgeToken,
        },
      };
    }
    visited.add(edgeToken);
    ordered.push({
      token: edgeToken,
      edge,
      side,
      direction: revit2027GEdgeLoopDirection(edge, side),
    });
    edgeToken = revit2027GEdgeLoopNextReference(edge, side);
    if (ordered.length > edges.size) {
      return {
        ok: false,
        issue: { code: "edge-cycle", faceToken, loopToken: loop.token },
      };
    }
  }
  if (
    ordered.length !== 4 ||
    ordered.at(-1)?.token !== loop.loop.previousEdgeReference ||
    (ordered[0] &&
      revit2027GEdgeLoopPreviousReference(ordered[0].edge, ordered[0].side) !==
        loop.token)
  ) {
    return {
      ok: false,
      issue: {
        code: ordered.length === 4
          ? "edge-link-mismatch"
          : "non-rectangular-trim",
        faceToken,
        loopToken: loop.token,
        detail: `edge count: ${ordered.length}`,
      },
    };
  }
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index]!;
    const next = ordered[(index + 1) % ordered.length]!;
    const currentEnd: 0 | 1 = current.direction === 1 ? 1 : 0;
    const nextStart: 0 | 1 = next.direction === 1 ? 0 : 1;
    if (
      !same2(
        faceUv(current.edge.firstAndLastEdgePoints[currentEnd], current.side),
        faceUv(next.edge.firstAndLastEdgePoints[nextStart], next.side),
        tolerance,
      )
    ) {
      return {
        ok: false,
        issue: {
          code: "uv-link-unresolved",
          faceToken,
          loopToken: loop.token,
          edgeToken: current.token,
        },
      };
    }
  }
  return { ok: true, edges: ordered };
}

function boundaryFor(
  points: readonly Point2[],
  minimum: Point2,
  maximum: Point2,
  tolerance: number,
): Boundary | null {
  const candidates: Array<{
    boundary: Boundary;
    fixedAxis: 0 | 1;
    fixedValue: number;
    varyingAxis: 0 | 1;
  }> = [
    { boundary: "u-min", fixedAxis: 0, fixedValue: minimum[0], varyingAxis: 1 },
    { boundary: "u-max", fixedAxis: 0, fixedValue: maximum[0], varyingAxis: 1 },
    { boundary: "v-min", fixedAxis: 1, fixedValue: minimum[1], varyingAxis: 0 },
    { boundary: "v-max", fixedAxis: 1, fixedValue: maximum[1], varyingAxis: 0 },
  ];
  const matches = candidates.filter((candidate) => {
    if (
      points.length < 2 ||
      points.some(
        (point) =>
          !near(point[candidate.fixedAxis], candidate.fixedValue, tolerance) ||
          point[candidate.varyingAxis] <
            minimum[candidate.varyingAxis] - tolerance ||
          point[candidate.varyingAxis] >
            maximum[candidate.varyingAxis] + tolerance,
      )
    ) {
      return false;
    }
    const values = points.map((point) => point[candidate.varyingAxis]);
    const forward = values.at(-1)! >= values[0]!;
    for (let index = 1; index < values.length; index += 1) {
      if (
        forward
          ? values[index]! < values[index - 1]! - tolerance
          : values[index]! > values[index - 1]! + tolerance
      ) {
        return false;
      }
    }
    return near(Math.min(...values), minimum[candidate.varyingAxis], tolerance) &&
      near(Math.max(...values), maximum[candidate.varyingAxis], tolerance);
  });
  return matches.length === 1 ? matches[0]!.boundary : null;
}

/**
 * Merge two independently persisted samplings of opposite trim edges.
 *
 * Revit may write only the endpoints on a straight/coarse side and a dense
 * parameter sequence on the opposite curved side. The rectangular surface is
 * still exact: the ordered union preserves every persisted sample on both
 * boundaries and supplies a shared tensor-product grid without inventing a
 * sampling density.
 */
export function mergeRevit2027OppositeBoundarySamples(
  first: readonly number[],
  second: readonly number[],
  minimum: number,
  maximum: number,
  tolerance = DEFAULT_UV_TOLERANCE,
): number[] | null {
  if (
    first.length < 2 ||
    second.length < 2 ||
    ![...first, ...second, minimum, maximum, tolerance].every(Number.isFinite) ||
    !(maximum > minimum) ||
    tolerance < 0
  ) {
    return null;
  }
  const values = [...first, ...second].sort((left, right) => left - right);
  if (
    values[0]! < minimum - tolerance ||
    values.at(-1)! > maximum + tolerance ||
    !near(values[0]!, minimum, tolerance) ||
    !near(values.at(-1)!, maximum, tolerance)
  ) {
    return null;
  }
  const merged: number[] = [];
  for (const value of values) {
    const clamped = near(value, minimum, tolerance)
      ? minimum
      : near(value, maximum, tolerance)
      ? maximum
      : value;
    if (
      merged.length === 0 ||
      !near(clamped, merged.at(-1)!, tolerance)
    ) {
      merged.push(clamped);
    }
  }
  return merged.length >= 2 && merged.length <= 513 ? merged : null;
}

function compatibleProfiles(
  first: RuledProfile,
  second: RuledProfile,
  tolerance: number,
): boolean {
  if ("pitchOver2Pi" in first && "pitchOver2Pi" in second) {
    return same2(first.endParameters, second.endParameters, tolerance) &&
      near(first.pitchOver2Pi, second.pitchOver2Pi, tolerance) &&
      same3(first.xVector, second.xVector, tolerance) &&
      same3(first.yVector, second.yVector, tolerance) &&
      same3(first.zVector, second.zVector, tolerance);
  }
  if ("direction" in first && "direction" in second) {
    const firstSpan = first.endParameters[1] - first.endParameters[0];
    const secondSpan = second.endParameters[1] - second.endParameters[0];
    return Math.abs(firstSpan) > tolerance &&
      Math.abs(secondSpan) > tolerance;
  }
  return false;
}

function evaluateHelix(
  helix: Revit2027GCylindricalHelix,
  parameter: number,
): Point3 {
  return add(
    helix.basePoint,
    add(
      scale(
        add(
          scale(helix.xVector, Math.cos(parameter)),
          scale(helix.yVector, Math.sin(parameter)),
        ),
        helix.radius,
      ),
      scale(helix.zVector, helix.pitchOver2Pi * parameter),
    ),
  );
}

function helixDerivative(
  helix: Revit2027GCylindricalHelix,
  parameter: number,
): Point3 {
  return add(
    scale(
      add(
        scale(helix.xVector, -Math.sin(parameter)),
        scale(helix.yVector, Math.cos(parameter)),
      ),
      helix.radius,
    ),
    scale(helix.zVector, helix.pitchOver2Pi),
  );
}

function evaluateProfile(profile: RuledProfile, fraction: number): Point3 {
  const [minimum, maximum] = profile.endParameters;
  const parameter = minimum + (maximum - minimum) * fraction;
  return "pitchOver2Pi" in profile
    ? evaluateHelix(profile, parameter)
    : add(profile.origin, scale(profile.direction, parameter));
}

function profileFractionDerivative(
  profile: RuledProfile,
  fraction: number,
): Point3 {
  const [minimum, maximum] = profile.endParameters;
  const parameter = minimum + (maximum - minimum) * fraction;
  const derivative = "pitchOver2Pi" in profile
    ? helixDerivative(profile, parameter)
    : profile.direction;
  return scale(derivative, maximum - minimum);
}

function profileKind(profile: RuledProfile): "helix" | "line" {
  return "pitchOver2Pi" in profile ? "helix" : "line";
}

function faceMaterialId(
  faceToken: number,
  face: Revit2027FaceStatic,
  options: Revit2027RuledHelixOwnerMeshOptions,
  issues: Revit2027RuledHelixOwnerMeshIssue[],
): string | number | null {
  const supplied = options.materialForFace?.(faceToken, face);
  if (supplied !== undefined) return supplied;
  if (!options.materialDefinitions) return null;
  const binding = bindRevit2027FaceMaterial(
    face.renderStyleElementId,
    options.materialDefinitions,
  );
  if (binding.status === "exact-material") return binding.materialElementId;
  if (binding.status === "unresolved-positive-id") {
    issues.push({
      code: "material-unresolved",
      faceToken,
      detail: `${binding.renderStyleElementId}: ${binding.reason}`,
    });
  }
  return null;
}

function tessellate(
  ownerElementId: bigint,
  faceToken: number,
  surface: Revit2027RuledSurface,
  first: RuledProfile,
  second: RuledProfile,
  uParameters: readonly number[],
  vParameters: readonly number[],
  materialId: string | number | null,
): NeutralFaceMesh | null {
  const uSegments = uParameters.length - 1;
  const vSegments = vParameters.length - 1;
  if (uSegments < 1 || vSegments < 1) return null;
  const uCount = uSegments + 1;
  const vCount = vSegments + 1;
  const positions = new Float64Array(uCount * vCount * 3);
  const normals = new Float32Array(uCount * vCount * 3);
  for (let ui = 0; ui < uCount; ui += 1) {
    const u = uParameters[ui]!;
    const firstPoint = evaluateProfile(first, u);
    const secondPoint = evaluateProfile(second, u);
    const firstDerivative = profileFractionDerivative(first, u);
    const secondDerivative = profileFractionDerivative(second, u);
    for (let vi = 0; vi < vCount; vi += 1) {
      const v = vParameters[vi]!;
      const position = mix(firstPoint, secondPoint, v);
      const du = mix(firstDerivative, secondDerivative, v);
      const dv = subtract(secondPoint, firstPoint);
      let normal = normalized(cross(du, dv));
      if (!normal) return null;
      if (!surface.surface.orientFlag) normal = scale(normal, -1);
      const vertex = ui * vCount + vi;
      positions.set(position, vertex * 3);
      normals.set(normal, vertex * 3);
    }
  }
  const indices = new Uint32Array(uSegments * vSegments * 6);
  let cursor = 0;
  for (let ui = 0; ui < uSegments; ui += 1) {
    for (let vi = 0; vi < vSegments; vi += 1) {
      const a = ui * vCount + vi;
      const b = (ui + 1) * vCount + vi;
      const c = b + 1;
      const d = a + 1;
      indices.set(
        surface.surface.orientFlag
          ? [a, b, d, b, c, d]
          : [a, d, b, b, d, c],
        cursor,
      );
      cursor += 6;
    }
  }
  const elementId = Number(ownerElementId);
  const provenance: BrepProvenance = {
    decoderId: "revit-2027-ruled-profile-owner-mesh",
    elementId: Number.isSafeInteger(elementId) ? elementId : undefined,
  };
  const faceId = `revit-2027-owner-${ownerElementId}-face-${faceToken}`;
  const group: NeutralMeshFaceGroup = {
    faceId,
    indexOffset: 0,
    indexCount: indices.length,
    vertexOffset: 0,
    vertexCount: positions.length / 3,
    materialId,
    sourceTransform: IDENTITY,
    brepProvenance: provenance,
    faceProvenance: provenance,
  };
  return {
    brepId: `revit-2027-owner-${ownerElementId}-ruled-profile`,
    positions,
    normals,
    indices,
    groups: [group],
  };
}

/**
 * Mesh the exact rectangular RuledSurf subset whose two persisted profiles
 * are a compatible pair of GCylindricalHelix or GLine curves. Persisted edge
 * samples select the grid, so this path does not invent a display LOD.
 */
export function meshRevit2027RuledHelixReplay(
  replay: Revit2027GRepReplay,
  options: Revit2027RuledHelixOwnerMeshOptions = {},
): Revit2027RuledHelixOwnerMeshResult {
  const tolerance = options.uvTolerance ?? DEFAULT_UV_TOLERANCE;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    return { ok: false, error: "uvTolerance must be positive and finite" };
  }
  const faces = new Map<number, Revit2027FaceStatic>();
  const faceTokenByReplayIndex = new Map<number, number>();
  const edges = new Map<number, Revit2027GEdgeStatic>();
  const loops = new Map<number, LoopRecord>();
  for (const span of replay.spans) {
    if (
      span.propertySourceClassSlot === REVIT_2027_FACE_SOURCE_CLASS_SLOT &&
      span.propertyToken > 0
    ) {
      faces.set(span.propertyToken, spanValue<Revit2027FaceStatic>(span));
      faceTokenByReplayIndex.set(span.replayIndex, span.propertyToken);
    } else if (
      span.propertySourceClassSlot === REVIT_2027_GEDGE_SOURCE_CLASS_SLOT &&
      span.propertyToken > 0
    ) {
      edges.set(span.propertyToken, spanValue<Revit2027GEdgeStatic>(span));
    } else if (
      span.propertySourceClassSlot === REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT &&
      span.propertyToken > 0
    ) {
      loops.set(span.propertyToken, {
        token: span.propertyToken,
        loop: spanValue<Revit2027EdgeLoopStatic>(span),
      });
    } else if (
      span.propertySourceClassSlot ===
        REVIT_2027_EDGE_LOOP_WITH_CHAIN_ENVELOPES_SOURCE_CLASS_SLOT &&
      span.propertyToken > 0
    ) {
      loops.set(span.propertyToken, {
        token: span.propertyToken,
        loop: spanValue<Revit2027EdgeLoopWithChainEnvelopesStatic>(span).loop,
      });
    }
  }
  const surfaces = new Map<number, {
    replayIndex: number;
    value: Revit2027RuledSurface;
  }>();
  const faceTokenBySurfaceReplayIndex = new Map<number, number>();
  for (const span of replay.spans) {
    if (
      span.propertySourceClassSlot !== REVIT_2027_RULED_SURFACE_SOURCE_CLASS_SLOT ||
      span.parentReplayIndex == null
    ) {
      continue;
    }
    const faceToken = faceTokenByReplayIndex.get(span.parentReplayIndex);
    if (faceToken == null) continue;
    surfaces.set(faceToken, {
      replayIndex: span.replayIndex,
      value: spanValue<Revit2027RuledSurface>(span),
    });
    faceTokenBySurfaceReplayIndex.set(span.replayIndex, faceToken);
  }
  const profiles = new Map<number, Map<number, RuledProfile>>();
  for (const span of replay.spans) {
    if (
      (
        span.propertySourceClassSlot !==
          REVIT_2027_GCYLINDRICAL_HELIX_SOURCE_CLASS_SLOT &&
        span.propertySourceClassSlot !== REVIT_2027_GLINE_SOURCE_CLASS_SLOT
      ) ||
      span.parentReplayIndex == null ||
      span.propertyToken <= 0
    ) {
      continue;
    }
    const faceToken = faceTokenBySurfaceReplayIndex.get(span.parentReplayIndex);
    if (faceToken == null) continue;
    const byToken = profiles.get(faceToken) ?? new Map();
    byToken.set(span.propertyToken, spanValue<RuledProfile>(span));
    profiles.set(faceToken, byToken);
  }

  const issues: Revit2027RuledHelixOwnerMeshIssue[] = [];
  const faceMeshes: Revit2027RuledHelixOwnerFaceMesh[] = [];
  for (const [faceToken, face] of faces) {
    if (face.surface.sourceClassSlot !== REVIT_2027_RULED_SURFACE_SOURCE_CLASS_SLOT) {
      continue;
    }
    const surface = surfaces.get(faceToken)?.value;
    if (!surface) {
      issues.push({ code: "surface-unresolved", faceToken });
      continue;
    }
    const first = profiles.get(faceToken)?.get(surface.profileCurve1.token);
    const second = profiles.get(faceToken)?.get(surface.profileCurve2.token);
    if (!first || !second) {
      issues.push({ code: "profile-unresolved", faceToken });
      continue;
    }
    if (!compatibleProfiles(first, second, tolerance)) {
      issues.push({ code: "profile-mismatch", faceToken });
      continue;
    }
    const loopToken = face.firstLoop.token;
    const loop = loops.get(loopToken);
    if (loopToken <= 0 || !loop) {
      issues.push({ code: "loop-unresolved", faceToken, loopToken });
      continue;
    }
    if (loop.loop.nextLoop.token !== 0) {
      issues.push({ code: "multi-loop", faceToken, loopToken });
      continue;
    }
    if (loop.loop.faceReference !== faceToken) {
      issues.push({ code: "loop-face-mismatch", faceToken, loopToken });
      continue;
    }
    if (
      !same2(loop.loop.envelope.minimum, surface.surface.envelope.firstCorner, tolerance) ||
      !same2(loop.loop.envelope.maximum, surface.surface.envelope.secondCorner, tolerance)
    ) {
      issues.push({ code: "loop-envelope-mismatch", faceToken, loopToken });
      continue;
    }
    const directed = directedLoopEdges(faceToken, loop, edges, tolerance);
    if (!directed.ok) {
      issues.push(directed.issue);
      continue;
    }
    const samples = new Map<Boundary, readonly Point2[]>();
    let invalidEdge: DirectedEdge | undefined;
    for (const edge of directed.edges) {
      const uvs = directedUvs(edge);
      const boundary = boundaryFor(
        uvs,
        surface.surface.envelope.firstCorner,
        surface.surface.envelope.secondCorner,
        tolerance,
      );
      if (!boundary || samples.has(boundary)) {
        invalidEdge = edge;
        break;
      }
      samples.set(boundary, uvs);
    }
    if (invalidEdge || samples.size !== 4) {
      issues.push({
        code: "non-rectangular-trim",
        faceToken,
        loopToken,
        edgeToken: invalidEdge?.token,
      });
      continue;
    }
    const [minimum, maximum] = [
      surface.surface.envelope.firstCorner,
      surface.surface.envelope.secondCorner,
    ];
    const uParameters = mergeRevit2027OppositeBoundarySamples(
      samples.get("v-min")!.map((point) => point[0]),
      samples.get("v-max")!.map((point) => point[0]),
      minimum[0],
      maximum[0],
      tolerance,
    );
    const vParameters = mergeRevit2027OppositeBoundarySamples(
      samples.get("u-min")!.map((point) => point[1]),
      samples.get("u-max")!.map((point) => point[1]),
      minimum[1],
      maximum[1],
      tolerance,
    );
    if (!uParameters || !vParameters) {
      issues.push({ code: "opposite-sampling-mismatch", faceToken, loopToken });
      continue;
    }
    const mesh = tessellate(
      replay.ownerElementId,
      faceToken,
      surface,
      first,
      second,
      uParameters,
      vParameters,
      faceMaterialId(faceToken, face, options, issues),
    );
    if (!mesh) {
      issues.push({
        code: "tessellator-rejected",
        faceToken,
        loopToken,
        detail: "Ruled helix derivative normal is degenerate",
      });
      continue;
    }
    faceMeshes.push({
      faceToken,
      loopToken,
      profileTokens: [surface.profileCurve1.token, surface.profileCurve2.token],
      profileKinds: [profileKind(first), profileKind(second)],
      uSegments: uParameters.length - 1,
      vSegments: vParameters.length - 1,
      mesh,
    });
  }
  return {
    ok: true,
    value: { ownerElementId: replay.ownerElementId, replay, faceMeshes, issues },
  };
}
