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
import type {
  Revit2027GRepReplay,
  Revit2027GRepReplaySpan,
} from "../lib/reviter/revit-2027-grep-replay.ts";
import {
  meshRevit2027PlanarSampledReplay,
} from "../lib/reviter/revit-2027-planar-owner-mesh.ts";
import {
  REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
  type Revit2027PlaneSurface,
} from "../lib/reviter/revit-2027-surfaces.ts";

const FACE_TOKEN = 4;
const LOOP_TOKEN = 9;
const SURFACE_TOKEN = 10;

function descriptor(
  token: number,
  sourceClassSlot: number | null,
): CondInt16QueueEntry {
  return {
    byteOffset: token * 6,
    endOffset: token * 6 + (token === 0 ? 4 : 6),
    token,
    sourceClassSlot,
  };
}

function edgePoint(
  firstFaceUv: readonly [number, number],
): Revit2027EdgePoint {
  return { firstFaceUv, secondFaceUv: [99, 99] };
}

function edge(
  token: number,
  start: readonly [number, number],
  end: readonly [number, number],
  previous: number,
  next: number,
): Revit2027GEdgeStatic {
  return {
    byteOffset: token * 100,
    endOffset: token * 100 + 113,
    gInfo: {
      gStyleElementId: -1n,
      tag: token,
      controlCommand: 0,
      flags: 0x0008_0004,
    },
    faceReferences: [FACE_TOKEN, 0],
    nextReferences: [next, 0],
    previousReferences: [previous, 0],
    interiorEdgePoints: [],
    firstAndLastEdgePoints: [edgePoint(start), edgePoint(end)],
    flags: 6,
    queuedPropertyCount: 0,
  };
}

function face(): Revit2027FaceStatic {
  const firstLoop = descriptor(
    LOOP_TOKEN,
    REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
  );
  const surface = descriptor(
    SURFACE_TOKEN,
    REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
  );
  return {
    byteOffset: 0,
    endOffset: 1,
    gInfo: {
      gStyleElementId: -1n,
      tag: FACE_TOKEN,
      controlCommand: 0,
      flags: 0,
    },
    firstLoop,
    faceRegions: {
      countOffset: 0,
      entriesOffset: 0,
      endOffset: 0,
      count: 0,
      entries: [],
    },
    foregroundFilling: descriptor(0, null),
    backgroundFilling: descriptor(0, null),
    renderStyleElementId: -1n,
    cutType: 0,
    faceFlags: 0,
    surface,
    queuedProperties: [firstLoop, surface],
  };
}

function loop(nextLoopToken = 0): Revit2027EdgeLoopStatic {
  const nextLoop = descriptor(
    nextLoopToken,
    nextLoopToken === 0 ? null : REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
  );
  return {
    byteOffset: 0,
    endOffset: 1,
    gInfo: {
      gStyleElementId: -1n,
      tag: LOOP_TOKEN,
      controlCommand: 0,
      flags: 0,
    },
    nextLoop,
    faceReference: FACE_TOKEN,
    nextEdgeReference: 5,
    previousEdgeReference: 8,
    staticReferences: [FACE_TOKEN, 5, 8],
    envelope: { minimum: [0, 0], maximum: [1, 1] },
    open: false,
    queuedProperties: nextLoopToken === 0 ? [] : [nextLoop],
  };
}

function plane(): Revit2027PlaneSurface {
  return {
    kind: "plane",
    sourceClassSlot: REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
    byteOffset: 0,
    endOffset: 105,
    surface: {
      envelope: {
        firstCorner: [0, 0],
        secondCorner: [1, 1],
      },
      orientFlag: true,
    },
    origin: [10, 20, 30],
    xVector: [1, 0, 0],
    yVector: [0, 1, 0],
    queuedProperties: [],
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
    ownerElementId: 1234n,
    path: [replayIndex],
    parentPath: parentReplayIndex == null ? null : [parentReplayIndex],
    parentReplayIndex,
    propertyToken: token,
    propertySourceClassSlot: sourceClassSlot,
    descriptorOffset: replayIndex * 6,
    descriptorEndOffset: replayIndex * 6 + 6,
    startOffset: replayIndex,
    endOffset: replayIndex + 1,
    readerId: `reader-${sourceClassSlot}`,
    value,
  };
}

function replay(nextLoopToken = 0): Revit2027GRepReplay {
  const edges = [
    edge(5, [0, 0], [1, 0], LOOP_TOKEN, 6),
    edge(6, [1, 0], [1, 1], 5, 7),
    edge(7, [1, 1], [0, 1], 6, 8),
    edge(8, [0, 1], [0, 0], 7, LOOP_TOKEN),
  ];
  return {
    ownerElementId: 1234n,
    startOffset: 0,
    endOffset: 8,
    initialTokenCount: 3,
    finalTokenCount: 11,
    descriptors: [],
    spans: [
      span(0, FACE_TOKEN, REVIT_2027_FACE_SOURCE_CLASS_SLOT, null, face()),
      ...edges.map((value, index) =>
        span(
          index + 1,
          index + 5,
          REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
          null,
          value,
        )),
      span(
        5,
        LOOP_TOKEN,
        REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
        0,
        loop(nextLoopToken),
      ),
      span(
        6,
        SURFACE_TOKEN,
        REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
        0,
        plane(),
      ),
    ],
  };
}

test("meshes a completed replay's single-loop planar Face", () => {
  const result = meshRevit2027PlanarSampledReplay(replay(), {
    materialForFace: () => 77,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.faceMeshes.length, 1);
  assert.equal(result.value.issues.length, 0);
  const mesh = result.value.faceMeshes[0]!.mesh;
  assert.equal(mesh.indices.length / 3, 2);
  assert.equal(mesh.positions.length / 3, 4);
  assert.equal(mesh.groups[0]!.materialId, 77);
  assert.deepEqual([...mesh.positions.slice(0, 3)], [10, 20, 30]);
});

test("keeps multi-loop topology explicit instead of guessing a hole role", () => {
  const result = meshRevit2027PlanarSampledReplay(replay(11));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.faceMeshes.length, 0);
  assert.deepEqual(
    result.value.issues.map((issue) => issue.code),
    ["multi-loop"],
  );
});

test("fails options and reports unresolved edge topology without partial mesh", () => {
  assert.equal(
    meshRevit2027PlanarSampledReplay(replay(), { uvTolerance: 0 }).ok,
    false,
  );
  const broken = replay();
  const brokenEdge = broken.spans.find(
    (candidate) => candidate.propertyToken === 6,
  )!.value as Revit2027GEdgeStatic;
  brokenEdge.nextReferences = [99, 0];
  const result = meshRevit2027PlanarSampledReplay(broken);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.faceMeshes.length, 0);
  assert.equal(result.value.issues[0]?.code, "edge-unresolved");
});
