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
  meshRevit2027CertifiedOwnerReplay,
} from "../lib/reviter/revit-2027-certified-owner-mesh.ts";
import {
  meshRevit2027ConeApexSectorReplay,
} from "../lib/reviter/revit-2027-cone-owner-mesh.ts";
import type { NativeMaterialDefinition } from "../lib/reviter/material-records.ts";
import {
  REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
  type Revit2027ConeSurface,
} from "../lib/reviter/revit-2027-surfaces.ts";

const FACE = 10;
const LOOP = 20;
const SURFACE = -1;

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

function edge(
  token: number,
  start: readonly [number, number],
  end: readonly [number, number],
  interior: readonly (readonly [number, number])[],
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
    interiorEdgePoints: interior.map(point),
    firstAndLastEdgePoints: [point(start), point(end)],
    flags: 14,
    queuedPropertyCount: 0,
  };
}

function face(): Revit2027FaceStatic {
  const firstLoop = descriptor(LOOP, REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT);
  const surface = descriptor(
    SURFACE,
    REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
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
    nextEdgeReference: 30,
    previousEdgeReference: 32,
    staticReferences: [FACE, 30, 32],
    envelope: {
      minimum: [0, 0],
      maximum: [Math.PI / 2, 4],
    },
    open: false,
    queuedProperties: [],
  };
}

function cone(): Revit2027ConeSurface {
  return {
    kind: "cone",
    sourceClassSlot: REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
    byteOffset: 0,
    endOffset: 137,
    surface: {
      envelope: {
        firstCorner: [0, 0],
        secondCorner: [Math.PI / 2, 4],
      },
      orientFlag: true,
    },
    center: [10, 20, 30],
    xVector: [1, 0, 0],
    yVector: [0, 1, 0],
    zVector: [0, 0, 1],
    halfAngle: Math.PI / 4,
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
    ownerElementId: 1960533n,
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

function replay(curvedGenerator = false): Revit2027GRepReplay {
  const edges = [
    edge(
      30,
      [0, 0],
      [0, 4],
      [curvedGenerator ? [0.1, 2] : [0, 2]],
      LOOP,
      31,
    ),
    edge(
      31,
      [0, 4],
      [Math.PI / 2, 4],
      [[Math.PI / 4, 4]],
      30,
      32,
    ),
    edge(
      32,
      [Math.PI / 2, 4],
      [Math.PI / 2, 0],
      [[Math.PI / 2, 2]],
      31,
      LOOP,
    ),
  ];
  return {
    ownerElementId: 1960533n,
    startOffset: 0,
    endOffset: 6,
    initialTokenCount: 3,
    finalTokenCount: 33,
    descriptors: [],
    spans: [
      span(0, FACE, REVIT_2027_FACE_SOURCE_CLASS_SLOT, null, face()),
      span(1, LOOP, REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT, 0, loop()),
      ...edges.map((value, index) =>
        span(
          index + 2,
          index + 30,
          REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
          null,
          value,
        )),
      span(
        5,
        SURFACE,
        REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
        0,
        cone(),
      ),
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

test("meshes an exact cone apex sector from one completed replay", () => {
  const result = meshRevit2027ConeApexSectorReplay(replay(), {
    materialDefinitions: [glass()],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.issues, []);
  assert.equal(result.value.faceMeshes.length, 1);
  const mesh = result.value.faceMeshes[0]!.mesh;
  assert.equal(mesh.positions.length / 3, 6);
  assert.equal(mesh.indices.length / 3, 2);
  assert.equal(mesh.groups[0]!.materialId, 26);
});

test("promotes the cone sector through the combined browser owner API", () => {
  const result = meshRevit2027CertifiedOwnerReplay(replay(), {
    materialDefinitions: [glass()],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.issues, []);
  assert.equal(result.value.faceMeshes.length, 1);
  assert.equal(result.value.faceMeshes[0]!.kind, "cone-apex-sector");
  assert.equal(result.value.faceMeshes[0]!.mesh.groups[0]!.materialId, 26);
});

test("keeps a sampled non-generator cone trim fail-closed", () => {
  const result = meshRevit2027ConeApexSectorReplay(replay(true));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.faceMeshes.length, 0);
  assert.match(
    result.value.issues[0]?.detail ?? "",
    /^missing-apex:/u,
  );
});
