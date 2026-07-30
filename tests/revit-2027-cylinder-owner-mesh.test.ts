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
  meshRevit2027CylinderSampledReplay,
} from "../lib/reviter/revit-2027-cylinder-owner-mesh.ts";
import {
  REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
  type Revit2027CylinderSurface,
} from "../lib/reviter/revit-2027-surfaces.ts";
import type { NativeMaterialDefinition } from "../lib/reviter/material-records.ts";

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
    REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
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
    previousEdgeReference: 33,
    staticReferences: [FACE, 30, 33],
    envelope: {
      minimum: [0, 0],
      maximum: [Math.PI / 2, 2],
    },
    open: false,
    queuedProperties: [],
  };
}

function cylinder(): Revit2027CylinderSurface {
  return {
    kind: "cylinder",
    sourceClassSlot: REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
    byteOffset: 0,
    endOffset: 137,
    surface: {
      envelope: {
        firstCorner: [0, 0],
        secondCorner: [Math.PI / 2, 2],
      },
      orientFlag: true,
    },
    center: [1, 2, 3],
    xVector: [1, 0, 0],
    yVector: [0, 1, 0],
    zVector: [0, 0, 1],
    radius: 2,
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

function replay(axialInterior = false): Revit2027GRepReplay {
  const edges = [
    edge(30, [0, 0], [Math.PI / 2, 0], [[Math.PI / 4, 0]], LOOP, 31),
    edge(
      31,
      [Math.PI / 2, 0],
      [Math.PI / 2, 2],
      axialInterior ? [[Math.PI / 2, 1]] : [],
      30,
      32,
    ),
    edge(
      32,
      [Math.PI / 2, 2],
      [0, 2],
      [[Math.PI / 4, 2]],
      31,
      33,
    ),
    edge(
      33,
      [0, 2],
      [0, 0],
      axialInterior ? [[0, 1]] : [],
      32,
      LOOP,
    ),
  ];
  return {
    ownerElementId: 245109n,
    startOffset: 0,
    endOffset: 7,
    initialTokenCount: 3,
    finalTokenCount: 34,
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
        6,
        SURFACE,
        REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
        0,
        cylinder(),
      ),
    ],
  };
}

function gappedReplay(
  angularGap: number,
  axialGap = 0,
): Revit2027GRepReplay {
  const maximumAngle = Math.PI / 2 + angularGap;
  const edges = [
    edge(30, [0, 0], [Math.PI / 2, 0], [[Math.PI / 4, 0]], LOOP, 31),
    edge(31, [maximumAngle, axialGap], [maximumAngle, 2], [], 30, 32),
    edge(
      32,
      [maximumAngle, 2],
      [0, 2],
      [[maximumAngle / 2, 2]],
      31,
      33,
    ),
    edge(33, [0, 2], [0, 0], [], 32, LOOP),
  ];
  const gappedLoop: Revit2027EdgeLoopStatic = {
    ...loop(),
    envelope: {
      minimum: [0, 0],
      maximum: [maximumAngle, 2],
    },
  };
  const gappedCylinder: Revit2027CylinderSurface = {
    ...cylinder(),
    surface: {
      ...cylinder().surface,
      envelope: {
        firstCorner: [0, 0],
        secondCorner: [maximumAngle, 2],
      },
    },
  };
  return {
    ownerElementId: 245109n,
    startOffset: 0,
    endOffset: 7,
    initialTokenCount: 3,
    finalTokenCount: 34,
    descriptors: [],
    spans: [
      span(0, FACE, REVIT_2027_FACE_SOURCE_CLASS_SLOT, null, face()),
      span(
        1,
        LOOP,
        REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
        0,
        gappedLoop,
      ),
      ...edges.map((value, index) =>
        span(
          index + 2,
          index + 30,
          REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
          null,
          value,
        )),
      span(
        6,
        SURFACE,
        REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
        0,
        gappedCylinder,
      ),
    ],
  };
}

function notchedReplay(): Revit2027GRepReplay {
  const notchedLoop: Revit2027EdgeLoopStatic = {
    ...loop(),
    previousEdgeReference: 35,
    staticReferences: [FACE, 30, 35],
  };
  const edges = [
    edge(30, [0, 0], [Math.PI / 2, 0], [[Math.PI / 4, 0]], LOOP, 31),
    edge(31, [Math.PI / 2, 0], [Math.PI / 2, 2], [], 30, 32),
    edge(32, [Math.PI / 2, 2], [Math.PI / 4, 2], [], 31, 33),
    edge(33, [Math.PI / 4, 2], [Math.PI / 4, 1], [], 32, 34),
    edge(34, [Math.PI / 4, 1], [0, 1], [], 33, 35),
    edge(35, [0, 1], [0, 0], [], 34, LOOP),
  ];
  return {
    ownerElementId: 245109n,
    startOffset: 0,
    endOffset: 9,
    initialTokenCount: 3,
    finalTokenCount: 36,
    descriptors: [],
    spans: [
      span(0, FACE, REVIT_2027_FACE_SOURCE_CLASS_SLOT, null, face()),
      span(
        1,
        LOOP,
        REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
        0,
        notchedLoop,
      ),
      ...edges.map((value, index) =>
        span(
          index + 2,
          index + 30,
          REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
          null,
          value,
        )),
      span(
        8,
        SURFACE,
        REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
        0,
        cylinder(),
      ),
    ],
  };
}

function sampledDiagonalReplay(): Revit2027GRepReplay {
  const sampledEdges = [
    edge(
      30,
      [0, 0.2],
      [Math.PI / 2, 0],
      [[Math.PI / 4, 0.09]],
      LOOP,
      31,
    ),
    edge(31, [Math.PI / 2, 0], [Math.PI / 2, 2], [], 30, 32),
    edge(
      32,
      [Math.PI / 2, 2],
      [0, 2],
      [[Math.PI / 4, 2]],
      31,
      33,
    ),
    edge(33, [0, 2], [0, 0.2], [], 32, LOOP),
  ];
  return {
    ownerElementId: 245109n,
    startOffset: 0,
    endOffset: 7,
    initialTokenCount: 3,
    finalTokenCount: 34,
    descriptors: [],
    spans: [
      span(0, FACE, REVIT_2027_FACE_SOURCE_CLASS_SLOT, null, face()),
      span(1, LOOP, REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT, 0, loop()),
      ...sampledEdges.map((value, index) =>
        span(
          index + 2,
          index + 30,
          REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
          null,
          value,
        )),
      span(
        6,
        SURFACE,
        REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
        0,
        cylinder(),
      ),
    ],
  };
}

function perforatedReplay(reverseHoleWinding = false): Revit2027GRepReplay {
  const holeLoopToken = 21;
  const outerLoop: Revit2027EdgeLoopStatic = {
    ...loop(),
    nextLoop: descriptor(
      holeLoopToken,
      REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
    ),
    queuedProperties: [
      descriptor(holeLoopToken, REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT),
    ],
  };
  const holeLoop: Revit2027EdgeLoopStatic = {
    ...loop(),
    gInfo: { ...loop().gInfo, tag: holeLoopToken },
    nextEdgeReference: 40,
    previousEdgeReference: 43,
    staticReferences: [FACE, 40, 43],
    envelope: {
      minimum: [Math.PI / 4, 0.5],
      maximum: [Math.PI * 3 / 8, 1.5],
    },
  };
  const outerEdges = [
    edge(30, [0, 0], [Math.PI / 2, 0], [[Math.PI / 4, 0]], LOOP, 31),
    edge(31, [Math.PI / 2, 0], [Math.PI / 2, 2], [], 30, 32),
    edge(
      32,
      [Math.PI / 2, 2],
      [0, 2],
      [[Math.PI / 4, 2]],
      31,
      33,
    ),
    edge(33, [0, 2], [0, 0], [], 32, LOOP),
  ];
  const clockwiseHole = [
    [Math.PI / 4, 0.5],
    [Math.PI / 4, 1.5],
    [Math.PI * 3 / 8, 1.5],
    [Math.PI * 3 / 8, 0.5],
  ] as const;
  const holePoints = reverseHoleWinding
    ? [clockwiseHole[0], clockwiseHole[3], clockwiseHole[2], clockwiseHole[1]]
    : [...clockwiseHole];
  const holeEdges = holePoints.map((start, index) =>
    edge(
      40 + index,
      start,
      holePoints[(index + 1) % holePoints.length]!,
      [],
      index === 0 ? holeLoopToken : 39 + index,
      index === holePoints.length - 1 ? holeLoopToken : 41 + index,
    )
  );
  const allEdges = [...outerEdges, ...holeEdges];
  return {
    ownerElementId: 245109n,
    startOffset: 0,
    endOffset: 12,
    initialTokenCount: 3,
    finalTokenCount: 44,
    descriptors: [],
    spans: [
      span(0, FACE, REVIT_2027_FACE_SOURCE_CLASS_SLOT, null, face()),
      span(
        1,
        LOOP,
        REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
        0,
        outerLoop,
      ),
      span(
        2,
        holeLoopToken,
        REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
        0,
        holeLoop,
      ),
      ...allEdges.map((value, index) =>
        span(
          index + 3,
          value.gInfo.tag,
          REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
          null,
          value,
        )),
      span(
        11,
        SURFACE,
        REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
        0,
        cylinder(),
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

test("meshes a certified replay cylinder with its persisted angular grid", () => {
  const result = meshRevit2027CylinderSampledReplay(replay(), {
    materialDefinitions: [glass()],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.issues, []);
  assert.equal(result.value.faceMeshes.length, 1);
  const faceMesh = result.value.faceMeshes[0]!;
  assert.equal(faceMesh.angularSegments, 2);
  assert.equal(faceMesh.axialSegments, 1);
  assert.equal(faceMesh.bridgedJoinCount, 0);
  assert.equal(faceMesh.mesh.positions.length / 3, 6);
  assert.equal(faceMesh.mesh.indices.length / 3, 4);
  assert.equal(faceMesh.mesh.groups[0]!.materialId, 26);
});

test("bridges an orthogonal join admitted by native evaluated endpoint distance", () => {
  const result = meshRevit2027CylinderSampledReplay(
    gappedReplay(0.001),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.issues, []);
  assert.equal(result.value.faceMeshes.length, 1);
  assert.equal(result.value.faceMeshes[0]!.bridgedJoinCount, 1);
  assert.ok(result.value.faceMeshes[0]!.mesh.indices.length > 0);
});

test("rejects over-distance, diagonal, and periodic cylinder join gaps", () => {
  for (const candidate of [
    gappedReplay(0.006),
    gappedReplay(0.001, 0.001),
    gappedReplay(Math.PI * 2 - 0.001),
  ]) {
    const result = meshRevit2027CylinderSampledReplay(candidate);
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.equal(result.value.faceMeshes.length, 0);
    assert.equal(result.value.issues[0]?.code, "uv-link-unresolved");
  }
});

test("adds the cylinder to the combined browser mesh without a duplicate issue", () => {
  const result = meshRevit2027CertifiedOwnerReplay(replay(), {
    materialDefinitions: [glass()],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.issues, []);
  assert.equal(result.value.faceMeshes.length, 1);
  assert.equal(result.value.faceMeshes[0]!.kind, "cylinder-sampled");
  assert.equal(result.value.faceMeshes[0]!.mesh.groups[0]!.materialId, 26);
});

test("meshes a persisted six-edge concave cylinder chart", () => {
  const result = meshRevit2027CylinderSampledReplay(notchedReplay());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.issues, []);
  assert.equal(result.value.faceMeshes.length, 1);
  const faceMesh = result.value.faceMeshes[0]!;
  assert.equal(faceMesh.angularSegments, 2);
  assert.equal(faceMesh.axialSegments, 1);
  assert.equal(faceMesh.mesh.indices.length / 3, 6);
});

test("meshes a four-edge cylinder chart with one persisted sampled diagonal", () => {
  const result = meshRevit2027CylinderSampledReplay(
    sampledDiagonalReplay(),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.issues, []);
  assert.equal(result.value.faceMeshes.length, 1);
  const faceMesh = result.value.faceMeshes[0]!;
  assert.equal(faceMesh.angularSegments, 2);
  assert.equal(faceMesh.axialSegments, 1);
  assert.equal(faceMesh.bridgedJoinCount, 0);
  assert.ok(faceMesh.mesh.indices.length > 0);
});

test("meshes native-oriented linked cylinder loops with a strict hole", () => {
  const result = meshRevit2027CylinderSampledReplay(perforatedReplay());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.issues, []);
  assert.equal(result.value.faceMeshes.length, 1);
  const faceMesh = result.value.faceMeshes[0]!;
  assert.equal(faceMesh.angularSegments, 4);
  assert.equal(faceMesh.axialSegments, 1);
  assert.equal(faceMesh.mesh.indices.length / 3, 22);
  assert.ok([...faceMesh.mesh.positions].every(Number.isFinite));
  assert.ok([...faceMesh.mesh.normals].every(Number.isFinite));
});

test("rejects a linked cylinder hole whose native-corrected winding is outer", () => {
  const result = meshRevit2027CylinderSampledReplay(
    perforatedReplay(true),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.faceMeshes.length, 0);
  assert.equal(result.value.issues[0]?.code, "multi-loop");
});

test("fails closed when axial samples require an unbound native policy", () => {
  const result = meshRevit2027CylinderSampledReplay(replay(true));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.faceMeshes.length, 0);
  assert.equal(
    result.value.issues[0]?.code,
    "multi-segment-axial-policy-not-bound",
  );
});
