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
  REVIT_2027_GARC_SOURCE_CLASS_SLOT,
  type Revit2027GArc,
} from "../lib/reviter/revit-2027-garc.ts";
import type {
  Revit2027GRepReplay,
  Revit2027GRepReplaySpan,
} from "../lib/reviter/revit-2027-grep-replay.ts";
import {
  meshRevit2027ArcSurfRevReplay,
} from "../lib/reviter/revit-2027-arc-surfrev-owner-mesh.ts";
import {
  meshRevit2027CertifiedOwnerReplay,
} from "../lib/reviter/revit-2027-certified-owner-mesh.ts";
import {
  REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
  type Revit2027SurfaceOfRevolution,
} from "../lib/reviter/revit-2027-surfaces.ts";
import type { NativeMaterialDefinition } from "../lib/reviter/material-records.ts";

const FACE = 10;
const LOOP = 30;
const SURFACE = -1;
const PROFILE = 40;

function descriptor(
  token: number,
  sourceClassSlot: number | null,
): CondInt16QueueEntry {
  return {
    byteOffset: 0,
    endOffset: token === 0 ? 4 : 6,
    token,
    sourceClassSlot,
  };
}

function point(uv: readonly [number, number]): Revit2027EdgePoint {
  return { firstFaceUv: uv, secondFaceUv: [99, 99] };
}

function samples(
  start: readonly [number, number],
  end: readonly [number, number],
  segments: number,
): Revit2027EdgePoint[] {
  return Array.from({ length: segments - 1 }, (_, index) => {
    const fraction = (index + 1) / segments;
    return point([
      start[0] + (end[0] - start[0]) * fraction,
      start[1] + (end[1] - start[1]) * fraction,
    ]);
  });
}

function edge(
  token: number,
  start: readonly [number, number],
  end: readonly [number, number],
  segments: number,
  previous: number,
  next: number,
): Revit2027GEdgeStatic {
  return {
    byteOffset: 0,
    endOffset: 1,
    gInfo: {
      gStyleElementId: -1n,
      tag: token,
      controlCommand: 0,
      flags: 0,
    },
    faceReferences: [FACE, 0],
    nextReferences: [next, 0],
    previousReferences: [previous, 0],
    interiorEdgePoints: samples(start, end, segments),
    firstAndLastEdgePoints: [point(start), point(end)],
    flags: 14,
    queuedPropertyCount: 0,
  };
}

function face(): Revit2027FaceStatic {
  const firstLoop = descriptor(LOOP, REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT);
  const surface = descriptor(
    SURFACE,
    REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
  );
  return {
    byteOffset: 0,
    endOffset: 1,
    gInfo: {
      gStyleElementId: -1n,
      tag: FACE,
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
    renderStyleElementId: 26n,
    cutType: 0,
    faceFlags: 4,
    surface,
    queuedProperties: [firstLoop, surface],
  };
}

function loop(): Revit2027EdgeLoopStatic {
  return {
    byteOffset: 0,
    endOffset: 1,
    gInfo: {
      gStyleElementId: -1n,
      tag: LOOP,
      controlCommand: 0,
      flags: 0,
    },
    nextLoop: descriptor(0, null),
    faceReference: FACE,
    nextEdgeReference: 20,
    previousEdgeReference: 23,
    staticReferences: [FACE, 20, 23],
    envelope: {
      minimum: [0, 0],
      maximum: [Math.PI / 2, Math.PI],
    },
    open: false,
    queuedProperties: [],
  };
}

function surface(): Revit2027SurfaceOfRevolution {
  return {
    kind: "surface-of-revolution",
    sourceClassSlot: REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
    byteOffset: 0,
    endOffset: 135,
    surface: {
      envelope: {
        firstCorner: [0, 0],
        secondCorner: [Math.PI / 2, Math.PI],
      },
      orientFlag: true,
    },
    center: [0, 0.03937007874015251, -0.20669291338583545],
    xVector: [0, -1, 0],
    yVector: [0, 0, -1],
    zVector: [1, 0, 0],
    profileCurve: descriptor(PROFILE, REVIT_2027_GARC_SOURCE_CLASS_SLOT),
    queuedProperties: [],
  };
}

function profile(): Revit2027GArc {
  return {
    byteOffset: 0,
    endOffset: 117,
    gInfo: {
      gStyleElementId: -1n,
      tag: PROFILE,
      controlCommand: 0,
      flags: 0,
    },
    endParameters: [0, Math.PI],
    xDirection: [0, 0, 1],
    yDirection: [-1, 0, 0],
    radius: 0.01968503937007874,
    center: [0.03937007874017287, 0, 0],
    isFilled: false,
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
    ownerElementId: 245109n,
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

function replay(profileSegments = 12): Revit2027GRepReplay {
  const edges = [
    edge(20, [0, 0], [Math.PI / 2, 0], 2, LOOP, 21),
    edge(21, [Math.PI / 2, 0], [Math.PI / 2, Math.PI], profileSegments, 20, 22),
    edge(22, [Math.PI / 2, Math.PI], [0, Math.PI], 2, 21, 23),
    edge(23, [0, Math.PI], [0, 0], 12, 22, LOOP),
  ];
  return {
    ownerElementId: 245109n,
    startOffset: 0,
    endOffset: 8,
    initialTokenCount: 3,
    finalTokenCount: 41,
    descriptors: [],
    spans: [
      span(0, FACE, REVIT_2027_FACE_SOURCE_CLASS_SLOT, null, face()),
      span(1, LOOP, REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT, 0, loop()),
      ...edges.map((value, index) =>
        span(
          index + 2,
          index + 20,
          REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
          null,
          value,
        )),
      span(
        6,
        SURFACE,
        REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
        0,
        surface(),
      ),
      span(7, PROFILE, REVIT_2027_GARC_SOURCE_CLASS_SLOT, 6, profile()),
    ],
  };
}

function glass(): NativeMaterialDefinition {
  return {
    elementId: 26,
    name: "Стекло",
    recordOffset: 100,
    objectLength: 200,
    objectMarker: 0x0ad3,
    evidence: "framed-material-element-name",
  };
}

test("meshes a replay-certified rectangular Arc/SurfRev face", () => {
  const result = meshRevit2027ArcSurfRevReplay(replay(), {
    materialDefinitions: [glass()],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.issues, []);
  assert.equal(result.value.faceMeshes.length, 1);
  const faceMesh = result.value.faceMeshes[0]!;
  assert.equal(faceMesh.revolutionSegments, 2);
  assert.equal(faceMesh.profileSegments, 12);
  assert.equal(faceMesh.mesh.positions.length / 3, 39);
  assert.equal(faceMesh.mesh.indices.length / 3, 48);
  assert.equal(faceMesh.mesh.groups[0]!.materialId, 26);
});

test("rejects rectangular sides whose opposite sampling disagrees", () => {
  const result = meshRevit2027ArcSurfRevReplay(replay(11));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.faceMeshes.length, 0);
  assert.equal(
    result.value.issues[0]?.code,
    "opposite-sampling-mismatch",
  );
});

test("the combined owner entry point promotes the certified curved face", () => {
  const result = meshRevit2027CertifiedOwnerReplay(replay(), {
    materialDefinitions: [glass()],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.issues, []);
  assert.equal(result.value.faceMeshes.length, 1);
  assert.equal(result.value.faceMeshes[0]!.kind, "arc-surfrev");
  assert.equal(result.value.faceMeshes[0]!.mesh.groups[0]!.materialId, 26);
});
