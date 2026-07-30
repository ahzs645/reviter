import assert from "node:assert/strict";
import test from "node:test";

import { tessellateNeutralBrep } from "../lib/reviter/brep-tessellator.ts";
import {
  adaptRevit2027CylinderSampledBrep,
  type Revit2027CylinderSampledBrepInput,
  type Revit2027CylinderSampledEdgeUse,
} from "../lib/reviter/revit-2027-cylinder-sampled-brep.ts";
import type {
  Revit2027EdgePoint,
  Revit2027GEdgeStatic,
} from "../lib/reviter/revit-2027-edge-1423.ts";
import type { Revit2027CylinderSurface } from "../lib/reviter/revit-2027-surfaces.ts";

const surface: Revit2027CylinderSurface = {
  kind: "cylinder",
  sourceClassSlot: 1144,
  byteOffset: 100,
  endOffset: 237,
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

function edgePoint(uv: readonly [number, number]): Revit2027EdgePoint {
  return { firstFaceUv: uv, secondFaceUv: [0, 0] };
}

function edge(
  token: number,
  first: readonly [number, number],
  interior: readonly (readonly [number, number])[],
  last: readonly [number, number],
): Revit2027CylinderSampledEdgeUse {
  const value: Revit2027GEdgeStatic = {
    byteOffset: 0,
    endOffset: 0,
    gInfo: {
      gStyleElementId: 0n,
      tag: 0,
      controlCommand: 0,
      flags: 0,
    },
    faceReferences: [10, 0],
    nextReferences: [0, 0],
    previousReferences: [0, 0],
    interiorEdgePoints: interior.map(edgePoint),
    firstAndLastEdgePoints: [
      edgePoint(first),
      edgePoint(last),
    ],
    flags: 0,
    queuedPropertyCount: 0,
  };
  return {
    edgeToken: token,
    edge: value,
    faceSide: 0,
    direction: 1,
  };
}

function input(
  cylinder = surface,
  edgeUses = [
    edge(1, [0, 0], [[Math.PI / 4, 0]], [Math.PI / 2, 0]),
    edge(2, [Math.PI / 2, 0], [], [Math.PI / 2, 2]),
    edge(3, [Math.PI / 2, 2], [[Math.PI / 4, 2]], [0, 2]),
    edge(4, [0, 2], [], [0, 0]),
  ],
): Revit2027CylinderSampledBrepInput {
  return {
    id: "cylinder-owner",
    provenance: { decoderId: "test-cylinder-owner" },
    faces: [{
      faceToken: 10,
      surface: cylinder,
      loops: [{ loopToken: 20, role: "outer" as const, edgeUses }],
      provenance: { decoderId: "test-cylinder-face" },
    }],
  };
}

test("maps Revit angle/height UV into the neutral cylinder chart", () => {
  const adapted = adaptRevit2027CylinderSampledBrep(input());
  assert.equal(adapted.ok, true);
  if (!adapted.ok) return;
  const face = adapted.brep.faces[0]!;
  assert.deepEqual(face.surface, {
    kind: "cylinder",
    origin: [1, 2, 3],
    axis: [0, 0, 1],
    xAxis: [1, 0, 0],
    yAxis: [0, 1, 0],
    radius: 2,
  });
  assert.equal(face.orientation, 1);
  assert.deepEqual(face.trims[0]!.curves, [
    {
      kind: "pcurve-polyline",
      points: [[0, 0], [0, Math.PI / 4], [0, Math.PI / 2]],
    },
    { kind: "pcurve-line", start: [0, Math.PI / 2], end: [1, Math.PI / 2] },
    {
      kind: "pcurve-polyline",
      points: [[1, Math.PI / 2], [1, Math.PI / 4], [1, 0]],
    },
    { kind: "pcurve-line", start: [1, 0], end: [0, 0] },
  ]);

  const mesh = tessellateNeutralBrep(adapted.brep, {
    nativePolicy: {
      maximumEdgeLength: 100,
      maximumAngleDegrees: 30,
      surfaceDeviation: 0,
    },
  });
  assert.equal(mesh.ok, true);
  if (!mesh.ok) return;
  assert.equal(mesh.mesh.positions.length / 3, 10);
  assert.equal(mesh.mesh.indices.length / 3, 8);
});

test("canonicalizes a left-handed persisted cylinder without moving points", () => {
  const leftHanded: Revit2027CylinderSurface = {
    ...surface,
    yVector: [0, -1, 0],
  };
  const adapted = adaptRevit2027CylinderSampledBrep(input(leftHanded));
  assert.equal(adapted.ok, true);
  if (!adapted.ok) return;
  const face = adapted.brep.faces[0]!;
  assert.equal(face.surface.kind, "cylinder");
  if (face.surface.kind !== "cylinder") return;
  assert.deepEqual(face.surface.yAxis, [0, 1, 0]);
  assert.equal(face.orientation, -1);
  assert.deepEqual(face.trims[0]!.curves[0], {
    kind: "pcurve-polyline",
    points: [[0, 0], [0, -Math.PI / 4], [0, -Math.PI / 2]],
  });
});

test("preserves a non-axis-aligned sampled p-curve for fail-closed rejection", () => {
  const skewed = [
    edge(1, [0, 0], [[0.4, 0.7]], [Math.PI / 2, 0]),
    edge(2, [Math.PI / 2, 0], [], [Math.PI / 2, 2]),
    edge(3, [Math.PI / 2, 2], [], [0, 2]),
    edge(4, [0, 2], [], [0, 0]),
  ];
  const adapted = adaptRevit2027CylinderSampledBrep(
    input(surface, skewed),
  );
  assert.equal(adapted.ok, true);
  if (!adapted.ok) return;
  assert.equal(
    adapted.brep.faces[0]!.trims[0]!.curves[0]!.kind,
    "pcurve-polyline",
  );
  const mesh = tessellateNeutralBrep(adapted.brep, {
    nativePolicy: {
      maximumEdgeLength: 100,
      maximumAngleDegrees: 30,
      surfaceDeviation: 0,
    },
  });
  assert.equal(mesh.ok, false);
  if (!mesh.ok) {
    assert.equal(mesh.issues[0]?.code, "invalid-cylinder-chart");
  }
});

test("preserves an explicitly certified orthogonal coedge join bridge", () => {
  const angularGap = 0.001;
  const bridged = input(surface, [
    edge(1, [0, 0], [], [Math.PI / 2, 0]),
    edge(
      2,
      [Math.PI / 2 + angularGap, 0],
      [],
      [Math.PI / 2 + angularGap, 2],
    ),
    edge(
      3,
      [Math.PI / 2 + angularGap, 2],
      [],
      [0, 2],
    ),
    edge(4, [0, 2], [], [0, 0]),
  ]);
  bridged.faces[0]!.loops[0]!.joinBridges = [{
    afterEdgeToken: 1,
    start: [Math.PI / 2, 0],
    end: [Math.PI / 2 + angularGap, 0],
  }];
  const adapted = adaptRevit2027CylinderSampledBrep(bridged);
  assert.equal(adapted.ok, true);
  if (!adapted.ok) return;
  assert.deepEqual(adapted.brep.faces[0]!.trims[0]!.curves[1], {
    kind: "pcurve-line",
    start: [0, Math.PI / 2],
    end: [0, Math.PI / 2 + angularGap],
  });
  assert.equal(adapted.brep.faces[0]!.trims[0]!.curves.length, 5);
});

test("fails closed on invalid bases and discontinuous topology", () => {
  const badBasis: Revit2027CylinderSurface = {
    ...surface,
    yVector: [1, 0, 0],
  };
  const invalid = adaptRevit2027CylinderSampledBrep(input(badBasis));
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.issues[0]?.code, "invalid-cylinder");
  }

  const discontinuous = input(surface, [
    edge(1, [0, 0], [], [Math.PI / 2, 0]),
    edge(2, [Math.PI / 2, 0.1], [], [Math.PI / 2, 2]),
    edge(3, [Math.PI / 2, 2], [], [0, 2]),
    edge(4, [0, 2], [], [0, 0]),
  ]);
  const open = adaptRevit2027CylinderSampledBrep(discontinuous);
  assert.equal(open.ok, false);
  if (!open.ok) assert.equal(open.issues[0]?.code, "open-loop");

  discontinuous.faces[0]!.loops[0]!.joinBridges = [{
    afterEdgeToken: 1,
    start: [Math.PI / 2 - 0.01, 0],
    end: [Math.PI / 2, 0.1],
  }];
  const wrongAxis = adaptRevit2027CylinderSampledBrep(discontinuous);
  assert.equal(wrongAxis.ok, false);
  if (!wrongAxis.ok) {
    assert.equal(wrongAxis.issues[0]?.code, "invalid-loop");
  }
});
