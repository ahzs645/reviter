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
import type { NativeMaterialDefinition } from "../lib/reviter/material-records.ts";
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

function face(faceFlags = 0): Revit2027FaceStatic {
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
    faceFlags,
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

function replay(
  nextLoopToken = 0,
  outerClockwise = false,
  faceFlags = 0,
): Revit2027GRepReplay {
  const outerCorners = outerClockwise
    ? [[0, 0], [0, 1], [1, 1], [1, 0]] as const
    : [[0, 0], [1, 0], [1, 1], [0, 1]] as const;
  const edges = outerCorners.map((point, index) =>
    edge(
      index + 5,
      point,
      outerCorners[(index + 1) % outerCorners.length]!,
      index === 0 ? LOOP_TOKEN : index + 4,
      index === outerCorners.length - 1 ? LOOP_TOKEN : index + 6,
    )
  );
  return {
    ownerElementId: 1234n,
    startOffset: 0,
    endOffset: 8,
    initialTokenCount: 3,
    finalTokenCount: 11,
    descriptors: [],
    spans: [
      span(
        0,
        FACE_TOKEN,
        REVIT_2027_FACE_SOURCE_CLASS_SLOT,
        null,
        face(faceFlags),
      ),
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

function replayWithSecondLoop(
  minimum: readonly [number, number] = [0.25, 0.25],
  maximum: readonly [number, number] = [0.75, 0.75],
  nativeHoleOrientation = true,
  outerClockwise = false,
  faceFlags = 0,
): Revit2027GRepReplay {
  const result = replay(11, outerClockwise, faceFlags);
  const innerLoop: Revit2027EdgeLoopStatic = {
    ...loop(0),
    gInfo: { ...loop(0).gInfo, tag: 11 },
    faceReference: FACE_TOKEN,
    nextEdgeReference: 12,
    previousEdgeReference: 15,
    staticReferences: [FACE_TOKEN, 12, 15],
    envelope: { minimum, maximum },
  };
  const innerCorners = nativeHoleOrientation
    ? [
        minimum,
        [minimum[0], maximum[1]],
        maximum,
        [maximum[0], minimum[1]],
      ] as const
    : [
        minimum,
        [maximum[0], minimum[1]],
        maximum,
        [minimum[0], maximum[1]],
      ] as const;
  const innerEdges = innerCorners.map((point, index) =>
    edge(
      index + 12,
      point,
      innerCorners[(index + 1) % innerCorners.length]!,
      index === 0 ? 11 : index + 11,
      index === innerCorners.length - 1 ? 11 : index + 13,
    )
  );
  result.spans = [
    ...result.spans,
    span(
      7,
      11,
      REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
      5,
      innerLoop,
    ),
    ...innerEdges.map((value, index) =>
      span(
        index + 8,
        index + 12,
        REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
        null,
        value,
      )),
  ];
  result.endOffset = 12;
  result.finalTokenCount = 16;
  return result;
}

function replayWithTwoEdgeLoop(): Revit2027GRepReplay {
  const result = replay();
  const first = edge(5, [0, 0], [1, 0], LOOP_TOKEN, 6);
  first.interiorEdgePoints = [
    edgePoint([0.25, 0.5]),
    edgePoint([0.75, 0.5]),
  ];
  const second = edge(6, [1, 0], [0, 0], 5, LOOP_TOKEN);
  second.interiorEdgePoints = [
    edgePoint([0.75, -0.5]),
    edgePoint([0.25, -0.5]),
  ];
  const loopSpan = result.spans.find(
    (candidate) => candidate.propertyToken === LOOP_TOKEN,
  )!;
  loopSpan.value = {
    ...(loopSpan.value as Revit2027EdgeLoopStatic),
    nextEdgeReference: 5,
    previousEdgeReference: 6,
    staticReferences: [FACE_TOKEN, 5, 6],
  };
  result.spans = [
    ...result.spans.filter(
      (candidate) =>
        candidate.propertySourceClassSlot !==
          REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
    ),
    span(7, 5, REVIT_2027_GEDGE_SOURCE_CLASS_SLOT, null, first),
    span(8, 6, REVIT_2027_GEDGE_SOURCE_CLASS_SLOT, null, second),
  ];
  return result;
}

function replayUsingSecondFaceSide(flipped: boolean): Revit2027GRepReplay {
  const result = replay();
  for (const candidate of result.spans) {
    if (
      candidate.propertySourceClassSlot !==
      REVIT_2027_GEDGE_SOURCE_CLASS_SLOT
    ) {
      continue;
    }
    const value = candidate.value as Revit2027GEdgeStatic;
    value.faceReferences = [0, value.faceReferences[0]];
    value.nextReferences = [0, value.nextReferences[0]];
    value.previousReferences = [0, value.previousReferences[0]];
    value.flags = flipped ? value.flags | 0x1 : value.flags & ~0x1;
    value.firstAndLastEdgePoints = value.firstAndLastEdgePoints.map(
      (point) => ({ ...point, secondFaceUv: point.firstFaceUv }),
    ) as [
      Revit2027EdgePoint,
      Revit2027EdgePoint,
    ];
    value.interiorEdgePoints = value.interiorEdgePoints.map(
      (point) => ({ ...point, secondFaceUv: point.firstFaceUv }),
    );
    if (!flipped) {
      value.firstAndLastEdgePoints = [
        value.firstAndLastEdgePoints[1],
        value.firstAndLastEdgePoints[0],
      ];
      value.interiorEdgePoints = [...value.interiorEdgePoints].reverse();
    }
  }
  return result;
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

test("uses native edge orientation to resolve a two-edge closed contour", () => {
  const result = meshRevit2027PlanarSampledReplay(replayWithTwoEdgeLoop());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.issues, []);
  assert.equal(result.value.faceMeshes.length, 1);
  assert.equal(result.value.faceMeshes[0]!.mesh.positions.length / 3, 6);
  assert.equal(result.value.faceMeshes[0]!.mesh.indices.length / 3, 4);
});

test("combines persisted face side and GEdge flip bit for loop direction", () => {
  for (const flipped of [false, true]) {
    const result = meshRevit2027PlanarSampledReplay(
      replayUsingSecondFaceSide(flipped),
    );
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.deepEqual(result.value.issues, []);
    assert.equal(result.value.faceMeshes.length, 1);
    assert.equal(result.value.faceMeshes[0]!.mesh.indices.length / 3, 2);
  }
});

test("binds an exact persisted face MaterialElem through owner mesh options", () => {
  const input = replay();
  const inputFace = input.spans[0]!.value as Revit2027FaceStatic;
  inputFace.renderStyleElementId = 26n;
  const definition: NativeMaterialDefinition = {
    elementId: 26,
    name: "Стекло",
    recordOffset: 100,
    objectLength: 200,
    objectMarker: 0x0ad3,
    evidence: "framed-material-element-name",
  };
  const result = meshRevit2027PlanarSampledReplay(input, {
    materialDefinitions: [definition],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.faceMeshes[0]!.mesh.groups[0]!.materialId, 26);
  assert.deepEqual(result.value.issues, []);
});

test("meshes one geometrically contained planar hole", () => {
  const result = meshRevit2027PlanarSampledReplay(replayWithSecondLoop());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.issues, []);
  assert.equal(result.value.faceMeshes.length, 1);
  assert.deepEqual(result.value.faceMeshes[0]!.loopTokens, [9, 11]);
  assert.equal(result.value.faceMeshes[0]!.regionCount, 1);
  assert.equal(result.value.faceMeshes[0]!.holeLoopCount, 1);
  assert.equal(result.value.faceMeshes[0]!.mesh.positions.length / 3, 8);
  assert.equal(result.value.faceMeshes[0]!.mesh.indices.length / 3, 8);
});

test("keeps disjoint planar loops explicit instead of guessing a hole role", () => {
  const result = meshRevit2027PlanarSampledReplay(
    replayWithSecondLoop([2, 2], [3, 3]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.faceMeshes.length, 0);
  assert.deepEqual(
    result.value.issues.map((issue) => issue.code),
    ["multi-loop"],
  );
});

test("meshes two native-oriented disjoint filled regions from one Face", () => {
  const result = meshRevit2027PlanarSampledReplay(
    replayWithSecondLoop([2, 2], [3, 3], false),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.issues, []);
  assert.equal(result.value.faceMeshes.length, 1);
  assert.deepEqual(result.value.faceMeshes[0]!.loopTokens, [9, 11]);
  assert.equal(result.value.faceMeshes[0]!.regionCount, 2);
  assert.equal(result.value.faceMeshes[0]!.holeLoopCount, 0);
  assert.equal(result.value.faceMeshes[0]!.mesh.groups.length, 2);
  assert.deepEqual(
    result.value.faceMeshes[0]!.mesh.groups.map((group) => group.faceId),
    [
      "revit-2027-face-4-region-0",
      "revit-2027-face-4-region-1",
    ],
  );
  assert.equal(result.value.faceMeshes[0]!.mesh.indices.length / 3, 4);
});

test("applies persisted Face normal-flip bit before classifying regions", () => {
  const result = meshRevit2027PlanarSampledReplay(
    replayWithSecondLoop([2, 2], [3, 3], true, true, 0x2),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.issues, []);
  assert.equal(result.value.faceMeshes.length, 1);
  assert.equal(result.value.faceMeshes[0]!.regionCount, 2);
  assert.equal(result.value.faceMeshes[0]!.holeLoopCount, 0);
  assert.equal(result.value.faceMeshes[0]!.mesh.indices.length / 3, 4);
});

test("rejects containment that contradicts native oriented UV loop type", () => {
  const result = meshRevit2027PlanarSampledReplay(
    replayWithSecondLoop([0.25, 0.25], [0.75, 0.75], false),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.faceMeshes.length, 0);
  assert.deepEqual(
    result.value.issues.map((issue) => issue.code),
    ["multi-loop"],
  );
});

test("keeps unresolved loop chains explicit", () => {
  const result = meshRevit2027PlanarSampledReplay(replay(11));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.faceMeshes.length, 0);
  assert.deepEqual(
    result.value.issues.map((issue) => issue.code),
    ["loop-unresolved"],
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
