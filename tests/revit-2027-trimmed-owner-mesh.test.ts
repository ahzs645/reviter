import assert from "node:assert/strict";
import test from "node:test";

import type { CondInt16QueueEntry } from "../lib/reviter/dynamic-geometry-queue.ts";
import {
  REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
  type Revit2027EdgeLoopStatic,
} from "../lib/reviter/revit-2027-edge-loop-static.ts";
import {
  REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
  type Revit2027EdgePoint,
  type Revit2027GEdgeStatic,
} from "../lib/reviter/revit-2027-edge-1423.ts";
import {
  REVIT_2027_FACE_SOURCE_CLASS_SLOT,
  type Revit2027FaceStatic,
} from "../lib/reviter/revit-2027-face-static.ts";
import {
  REVIT_2027_GLINE_SOURCE_CLASS_SLOT,
  type Revit2027GLine,
} from "../lib/reviter/revit-2027-gline.ts";
import type {
  Revit2027GRepReplay,
  Revit2027GRepReplaySpan,
} from "../lib/reviter/revit-2027-grep-replay.ts";
import { meshRevit2027CertifiedOwnerReplay } from "../lib/reviter/revit-2027-certified-owner-mesh.ts";
import { meshRevit2027TrimmedSurfaceReplay } from "../lib/reviter/revit-2027-trimmed-owner-mesh.ts";
import {
  meshRevit2027TrimmedUvRegions,
  type Revit2027TrimmedUvRing,
} from "../lib/reviter/revit-2027-trimmed-uv-mesh.ts";
import type { Revit2027SurfaceSample } from "../lib/reviter/revit-2027-owner-mesh-grid.ts";
import {
  REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
  type Revit2027PlaneSurface,
  type Revit2027SurfaceOfRevolution,
} from "../lib/reviter/revit-2027-surfaces.ts";

type Uv = readonly [number, number];
type Point = readonly [number, number, number];

// ---------------------------------------------------------------------------
// UV-level tessellation of synthetic trimmed faces.
// ---------------------------------------------------------------------------

function ring(points: readonly Uv[], collapsed: readonly boolean[] = []): Revit2027TrimmedUvRing {
  return { points, collapsed: points.map((_, index) => collapsed[index] ?? false) };
}

function circle(radius: number, segments: number, clockwise = false): Uv[] {
  return Array.from({ length: segments }, (_, index) => {
    const angle = ((clockwise ? -1 : 1) * 2 * Math.PI * index) / segments;
    return [radius * Math.cos(angle), radius * Math.sin(angle)] as const;
  });
}

const plane = (u: number, v: number): Revit2027SurfaceSample => ({
  point: [u, v, 0],
  tangentU: [1, 0, 0],
  tangentV: [0, 1, 0],
});

/** Unit-radius cylinder about Z: u is the angle, v the height. */
const cylinder = (u: number, v: number): Revit2027SurfaceSample => ({
  point: [Math.cos(u), Math.sin(u), v],
  tangentU: [-Math.sin(u), Math.cos(u), 0],
  tangentV: [0, 0, 1],
});

function vertex(positions: Float64Array, index: number): Point {
  return [positions[index * 3]!, positions[index * 3 + 1]!, positions[index * 3 + 2]!];
}

function triangleArea(a: Point, b: Point, c: Point): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return Math.hypot(
    ab[1]! * ac[2]! - ab[2]! * ac[1]!,
    ab[2]! * ac[0]! - ab[0]! * ac[2]!,
    ab[0]! * ac[1]! - ab[1]! * ac[0]!,
  ) / 2;
}

function signedNormalZ(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

test("meshes a disc with a hole on a plane, keeping every trim sample", () => {
  const outer = circle(2, 32);
  const hole = circle(0.5, 12, true);
  const result = meshRevit2027TrimmedUvRegions({
    regions: [{ outer: ring(outer), holes: [ring(hole)] }],
    evaluate: plane,
    orientFlag: true,
    metricScale: [1, 1],
    chordTolerance: 0.01,
    collapseTolerance: 1e-7,
    maxVertices: 5000,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const { positions, indices, normals } = result.mesh;
  // Every persisted sample is a vertex; nothing is added on a plane.
  assert.equal(positions.length / 3, outer.length + hole.length);
  for (const [u, v] of [...outer, ...hole]) {
    let found = false;
    for (let index = 0; index < positions.length / 3 && !found; index += 1) {
      found = Math.hypot(positions[index * 3]! - u, positions[index * 3 + 1]! - v) < 1e-12;
    }
    assert.ok(found, `sample ${u},${v} is a mesh vertex`);
  }
  // The cover is exactly the polygon with its hole, and faces +Z.
  let area = 0;
  for (let index = 0; index < indices.length; index += 3) {
    const a = vertex(positions, indices[index]!);
    const b = vertex(positions, indices[index + 1]!);
    const c = vertex(positions, indices[index + 2]!);
    area += triangleArea(a, b, c);
    assert.ok(signedNormalZ(a, b, c) > 0);
    const centroid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
    assert.ok(Math.hypot(centroid[0]!, centroid[1]!) > 0.45, "no triangle fills the hole");
  }
  const polygonArea = (ring: readonly Uv[]): number =>
    Math.abs(ring.reduce((sum, p, index) => {
      const q = ring[(index + 1) % ring.length]!;
      return sum + p[0] * q[1] - q[0] * p[1];
    }, 0)) / 2;
  assert.ok(Math.abs(area - (polygonArea(outer) - polygonArea(hole))) < 1e-9);
  for (let index = 0; index < normals.length; index += 3) {
    assert.deepEqual([...normals.subarray(index, index + 3)], [0, 0, 1]);
  }
});

test("refines a trimmed cylinder patch until it follows the surface", () => {
  // A quarter turn of a unit cylinder, cut along a sloped top edge.
  const bottom: Uv[] = Array.from({ length: 9 }, (_, index) => [(Math.PI / 2) * index / 8, 0]);
  const top: Uv[] = Array.from({ length: 9 }, (_, index) => {
    const u = (Math.PI / 2) * (8 - index) / 8;
    return [u, 1 + 0.5 * Math.sin(u)];
  });
  // Twice the bulge of the persisted pi/16 arc chords, as the owner path sets.
  const tolerance = 2 * (1 - Math.cos(Math.PI / 32));
  const result = meshRevit2027TrimmedUvRegions({
    regions: [{ outer: ring([...bottom, ...top]), holes: [] }],
    evaluate: cylinder,
    orientFlag: true,
    metricScale: [1, 1],
    chordTolerance: tolerance,
    collapseTolerance: 1e-7,
    maxVertices: 5000,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const { positions, indices, uvs } = result.mesh;
  assert.ok(positions.length / 3 > bottom.length + top.length, "the interior is filled in");
  // Every vertex lies on the cylinder at its own UV.
  for (let index = 0; index < positions.length / 3; index += 1) {
    const expected = cylinder(uvs[index * 2]!, uvs[index * 2 + 1]!).point;
    assert.ok(Math.hypot(...vertex(positions, index).map((value, axis) => value - expected[axis]!)) < 1e-12);
    const [x, y] = vertex(positions, index);
    assert.ok(Math.abs(Math.hypot(x, y) - 1) < 1e-12);
  }
  // Interior edges and centroids stay within the chord tolerance, and every
  // triangle faces outward, away from the axis.
  for (let index = 0; index < indices.length; index += 3) {
    const corners = [0, 1, 2].map((k) => indices[index + k]!);
    const centroid = [0, 1, 2].map((axis) =>
      corners.reduce((sum, corner) => sum + positions[corner * 3 + axis]!, 0) / 3
    );
    assert.ok(1 - Math.hypot(centroid[0]!, centroid[1]!) <= tolerance * 1.5 + 1e-12);
    const [a, b, c] = corners.map((corner) => vertex(positions, corner)) as [Point, Point, Point];
    const normal = [
      (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
    ];
    assert.ok(normal[0]! * centroid[0]! + normal[1]! * centroid[1]! > 0);
  }
});

test("fans a cone to its apex across a collapsed trim side", () => {
  // Cone about Z with its apex at v = 1: every u there is the one apex point.
  const cone = (u: number, v: number): Revit2027SurfaceSample => ({
    point: [(1 - v) * Math.cos(u), (1 - v) * Math.sin(u), v],
    tangentU: [-(1 - v) * Math.sin(u), (1 - v) * Math.cos(u), 0],
    tangentV: [-Math.cos(u), -Math.sin(u), 1],
  });
  const base: Uv[] = Array.from({ length: 13 }, (_, index) => [Math.PI * index / 12, 0]);
  const points: Uv[] = [...base, [Math.PI, 1], [0, 1]];
  const collapsed = points.map((_, index) => index === base.length);
  const result = meshRevit2027TrimmedUvRegions({
    regions: [{ outer: ring(points, collapsed), holes: [] }],
    evaluate: cone,
    orientFlag: true,
    metricScale: [0.5, Math.SQRT2],
    chordTolerance: 0.01,
    collapseTolerance: 1e-7,
    maxVertices: 5000,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.mesh.collapsedTriangleCount > 0);
  const { positions, indices, normals } = result.mesh;
  for (let index = 0; index < indices.length; index += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => vertex(positions, indices[index + k]!)) as [Point, Point, Point];
    assert.ok(triangleArea(a, b, c) > 0, "no zero-area triangle survives");
  }
  assert.ok([...normals].every(Number.isFinite));
});

test("refuses a chord tolerance finer than the persisted trim itself", () => {
  const quarter: Uv[] = Array.from({ length: 3 }, (_, index) => [(Math.PI / 2) * index / 2, 0]);
  const result = meshRevit2027TrimmedUvRegions({
    regions: [{ outer: ring([...quarter, [Math.PI / 2, 1], [0, 1]]), holes: [] }],
    evaluate: cylinder,
    orientFlag: true,
    metricScale: [1, 1],
    chordTolerance: 0.01,
    collapseTolerance: 1e-7,
    maxVertices: 5000,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "invalid-request");
});

test("fails closed on a self-crossing trim and on an unevaluable surface", () => {
  const bowTie = meshRevit2027TrimmedUvRegions({
    regions: [{ outer: ring([[0, 0], [1, 1], [1, 0], [0, 1]]), holes: [] }],
    evaluate: plane,
    orientFlag: true,
    metricScale: [1, 1],
    chordTolerance: 0.01,
    collapseTolerance: 1e-7,
    maxVertices: 5000,
  });
  assert.equal(bowTie.ok, false);
  const unevaluable = meshRevit2027TrimmedUvRegions({
    regions: [{ outer: ring([[0, 0], [1, 0], [1, 1], [0, 1]]), holes: [] }],
    evaluate: (u, v) => (u > 0.9 && v > 0.9 ? null : plane(u, v)),
    orientFlag: true,
    metricScale: [1, 1],
    chordTolerance: 0.01,
    collapseTolerance: 1e-7,
    maxVertices: 5000,
  });
  assert.equal(unevaluable.ok, false);
  if (!unevaluable.ok) assert.equal(unevaluable.code, "surface-evaluation-failed");
});

// ---------------------------------------------------------------------------
// Owner level: a quarter annulus on a GLine SurfRev beside a planar face.
// ---------------------------------------------------------------------------

const SURFREV_FACE = 10;
const PLANE_FACE = 11;
const SURFREV_LOOP = 30;
const PLANE_LOOP = 31;
const PROFILE = 40;
const PLANE_SURFACE = 50;
const ARC_SEGMENTS = 8;

function descriptor(token: number, sourceClassSlot: number | null): CondInt16QueueEntry {
  return { byteOffset: 0, endOffset: token === 0 ? 4 : 6, token, sourceClassSlot };
}

function gInfo(tag: number) {
  return { gStyleElementId: -1n, tag, controlCommand: 0, flags: 0 };
}

function face(token: number, loop: number, surface: CondInt16QueueEntry): Revit2027FaceStatic {
  const firstLoop = descriptor(loop, REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT);
  return {
    byteOffset: 0,
    endOffset: 1,
    gInfo: gInfo(token),
    firstLoop,
    faceRegions: { countOffset: 0, entriesOffset: 0, endOffset: 0, count: 0, entries: [] },
    foregroundFilling: descriptor(0, null),
    backgroundFilling: descriptor(0, null),
    renderStyleElementId: -1n,
    cutType: 0,
    faceFlags: 0,
    surface,
    queuedProperties: [firstLoop, surface],
  };
}

function loop(token: number, faceToken: number, first: number, last: number): Revit2027EdgeLoopStatic {
  return {
    byteOffset: 0,
    endOffset: 1,
    gInfo: gInfo(token),
    nextLoop: descriptor(0, null),
    faceReference: faceToken,
    nextEdgeReference: first,
    previousEdgeReference: last,
    staticReferences: [faceToken, first, last],
    envelope: { minimum: [0, 0], maximum: [1, 1] },
    open: false,
    queuedProperties: [],
  };
}

type SharedEdge = {
  token: number;
  /** Samples in the SurfRev's (angle, profile) chart, in edge order. */
  revolved: Uv[];
  /** The same samples in the plane's (x, y) chart. */
  planar: Uv[];
  next: [number, number];
  previous: [number, number];
};

function gEdge(edge: SharedEdge): Revit2027GEdgeStatic {
  const points: Revit2027EdgePoint[] = edge.revolved.map((uv, index) => ({
    firstFaceUv: uv,
    secondFaceUv: edge.planar[index]!,
  }));
  return {
    byteOffset: 0,
    endOffset: 1,
    gInfo: gInfo(edge.token),
    // The SurfRev face uses side 0 forwards; the plane uses side 1 backwards.
    faceReferences: [SURFREV_FACE, PLANE_FACE],
    nextReferences: edge.next,
    previousReferences: edge.previous,
    interiorEdgePoints: points.slice(1, -1),
    firstAndLastEdgePoints: [points[0]!, points.at(-1)!],
    flags: points.length > 2 ? 14 : 6,
    queuedPropertyCount: 0,
  };
}

function arc(radius: number, from: number, to: number): { revolved: Uv[]; planar: Uv[] } {
  const angles = Array.from({ length: ARC_SEGMENTS + 1 }, (_, index) =>
    from + ((to - from) * index) / ARC_SEGMENTS);
  return {
    revolved: angles.map((angle) => [angle, radius - 1] as const),
    planar: angles.map((angle) => [radius * Math.cos(angle), radius * Math.sin(angle)] as const),
  };
}

function span(
  replayIndex: number,
  token: number,
  sourceClassSlot: number,
  parentReplayIndex: number | null,
  value: unknown,
): Revit2027GRepReplaySpan {
  return {
    replayIndex,
    queueSequence: replayIndex,
    ownerElementId: 7n,
    path: [replayIndex],
    parentPath: parentReplayIndex == null ? null : [parentReplayIndex],
    parentReplayIndex,
    propertyToken: token,
    propertySourceClassSlot: sourceClassSlot,
    descriptorOffset: replayIndex,
    descriptorEndOffset: replayIndex + 1,
    startOffset: replayIndex,
    endOffset: replayIndex + 1,
    readerId: `reader-${sourceClassSlot}`,
    value,
  };
}

/**
 * A flat quarter annulus between radii 1 and 2, persisted twice: as a
 * surface of revolution whose GLine profile runs radially (a shape the
 * rectangular arc path cannot read), and as the plane on its other side.
 */
function annulusReplay(planeLift = 0): Revit2027GRepReplay {
  const inner = arc(1, 0, Math.PI / 2);
  const outer = arc(2, Math.PI / 2, 0);
  const edges: SharedEdge[] = [
    { token: 20, ...inner, next: [21, 23], previous: [SURFREV_LOOP, PLANE_LOOP] },
    {
      token: 21,
      revolved: [[Math.PI / 2, 0], [Math.PI / 2, 1]],
      planar: [[0, 1], [0, 2]],
      next: [22, PLANE_LOOP],
      previous: [20, 22],
    },
    { token: 22, ...outer, next: [23, 21], previous: [21, 23] },
    {
      token: 23,
      revolved: [[0, 1], [0, 0]],
      planar: [[2, 0], [1, 0]],
      next: [SURFREV_LOOP, 22],
      previous: [22, 20],
    },
  ];
  const revolvedSurface: Revit2027SurfaceOfRevolution = {
    kind: "surface-of-revolution",
    sourceClassSlot: REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
    byteOffset: 0,
    endOffset: 1,
    surface: { envelope: { firstCorner: [0, 0], secondCorner: [Math.PI / 2, 1] }, orientFlag: true },
    center: [0, 0, 0],
    xVector: [1, 0, 0],
    yVector: [0, 1, 0],
    zVector: [0, 0, 1],
    profileCurve: descriptor(PROFILE, REVIT_2027_GLINE_SOURCE_CLASS_SLOT),
    queuedProperties: [],
  };
  const profile: Revit2027GLine = {
    byteOffset: 0,
    endOffset: 1,
    gInfo: gInfo(PROFILE),
    endParameters: [0, 1],
    origin: [1, 0, 0],
    direction: [1, 0, 0],
  };
  const planeSurface: Revit2027PlaneSurface = {
    kind: "plane",
    sourceClassSlot: REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
    byteOffset: 0,
    endOffset: 1,
    surface: { envelope: { firstCorner: [0, 0], secondCorner: [2, 2] }, orientFlag: true },
    origin: [0, 0, planeLift],
    xVector: [1, 0, 0],
    yVector: [0, 1, 0],
    queuedProperties: [],
  };
  return {
    ownerElementId: 7n,
    startOffset: 0,
    endOffset: 1,
    initialTokenCount: 0,
    finalTokenCount: 0,
    descriptors: [],
    spans: [
      span(0, SURFREV_FACE, REVIT_2027_FACE_SOURCE_CLASS_SLOT, null,
        face(SURFREV_FACE, SURFREV_LOOP, descriptor(-1, REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT))),
      span(1, SURFREV_LOOP, REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT, 0, loop(SURFREV_LOOP, SURFREV_FACE, 20, 23)),
      span(2, -1, REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT, 0, revolvedSurface),
      span(3, PROFILE, REVIT_2027_GLINE_SOURCE_CLASS_SLOT, 2, profile),
      span(4, PLANE_FACE, REVIT_2027_FACE_SOURCE_CLASS_SLOT, null,
        face(PLANE_FACE, PLANE_LOOP, descriptor(PLANE_SURFACE, REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT))),
      span(5, PLANE_LOOP, REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT, 4, loop(PLANE_LOOP, PLANE_FACE, 20, 21)),
      span(6, PLANE_SURFACE, REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT, 4, planeSurface),
      ...edges.map((edge, index) =>
        span(7 + index, edge.token, REVIT_2027_GEDGE_SOURCE_CLASS_SLOT, null, gEdge(edge))),
    ],
  };
}

test("meshes a quarter annulus on a line-profile SurfRev once its trim meets its neighbour", () => {
  const result = meshRevit2027CertifiedOwnerReplay(annulusReplay());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const revolved = result.value.faceMeshes.find((mesh) => mesh.faceToken === SURFREV_FACE);
  assert.ok(revolved, "the SurfRev face is meshed");
  assert.equal(revolved.kind, "trimmed-surface");
  if (revolved.kind !== "trimmed-surface") return;
  assert.equal(revolved.surfaceKind, "surface-of-revolution");
  assert.equal(revolved.neighbourSampleCount, 2 * (ARC_SEGMENTS + 1) + 4);
  assert.ok(revolved.maximumNeighbourDistance < 1e-12);
  // No other path's refusal of this face survives its certified mesh.
  assert.deepEqual(
    result.value.issues.filter(({ issue }) => issue.faceToken === SURFREV_FACE),
    [],
  );
  const { positions, indices, normals } = revolved.mesh;
  let area = 0;
  for (let index = 0; index < positions.length / 3; index += 1) {
    const [x, y, z] = vertex(positions, index);
    assert.ok(Math.abs(z) < 1e-12);
    const radius = Math.hypot(x, y);
    assert.ok(radius > 1 - 1e-12 && radius < 2 + 1e-12);
  }
  for (let index = 0; index < indices.length; index += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => vertex(positions, indices[index + k]!)) as [Point, Point, Point];
    area += triangleArea(a, b, c);
    // Su x Sv of this parameterisation points down, and orientFlag keeps it.
    assert.ok(signedNormalZ(a, b, c) < 0);
  }
  for (let index = 2; index < normals.length; index += 3) assert.equal(normals[index], -1);
  // The chords of the persisted arcs, not the true annulus, bound the face.
  const chordArea = (radius: number): number =>
    (ARC_SEGMENTS * radius * radius * Math.sin(Math.PI / 2 / ARC_SEGMENTS)) / 2;
  assert.ok(Math.abs(area - (chordArea(2) - chordArea(1))) < 1e-9);
});

test("keeps the SurfRev face unmeshed when its trim misses its neighbour", () => {
  const replay = annulusReplay(0.01);
  const trimmed = meshRevit2027TrimmedSurfaceReplay(replay);
  assert.equal(trimmed.ok, true);
  if (!trimmed.ok) return;
  assert.equal(trimmed.value.faceMeshes.some((mesh) => mesh.faceToken === SURFREV_FACE), false);
  const issue = trimmed.value.issues.find((entry) => entry.faceToken === SURFREV_FACE);
  assert.equal(issue?.code, "neighbour-mismatch");
  const certified = meshRevit2027CertifiedOwnerReplay(replay);
  assert.equal(certified.ok, true);
  if (!certified.ok) return;
  assert.equal(
    certified.value.faceMeshes.some((mesh) => mesh.faceToken === SURFREV_FACE),
    false,
  );
  assert.ok(
    certified.value.issues.some(({ path, issue }) =>
      path === "trimmed-surface" && issue.faceToken === SURFREV_FACE
    ),
  );
});
