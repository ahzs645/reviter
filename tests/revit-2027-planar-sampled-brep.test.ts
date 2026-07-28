import assert from "node:assert/strict";
import test from "node:test";

import { tessellatePlanarBrep } from "../lib/reviter/brep-tessellator.ts";
import type {
  Revit2027EdgePoint,
  Revit2027GEdgeStatic,
} from "../lib/reviter/revit-2027-edge-1423.ts";
import {
  adaptRevit2027PlanarSampledBrep,
  type Revit2027PlanarSampledEdgeUse,
} from "../lib/reviter/revit-2027-planar-sampled-brep.ts";
import {
  REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
  type Revit2027PlaneSurface,
} from "../lib/reviter/revit-2027-surfaces.ts";

const FACE_TOKEN = 4;

function edgePoint(
  firstFaceUv: readonly [number, number],
  secondFaceUv: readonly [number, number] = [99, 99],
): Revit2027EdgePoint {
  return { firstFaceUv, secondFaceUv };
}

function edge(
  token: number,
  start: readonly [number, number],
  end: readonly [number, number],
  faceReferences: readonly [number, number] = [FACE_TOKEN, 0],
  interior: readonly (readonly [number, number])[] = [],
): Revit2027GEdgeStatic {
  return {
    byteOffset: token * 100,
    endOffset: token * 100 + 113 + interior.length * 32,
    gInfo: {
      gStyleElementId: -1n,
      tag: token,
      controlCommand: 0,
      flags: 0x0008_0004,
    },
    faceReferences,
    nextReferences: [0, 0],
    previousReferences: [0, 0],
    interiorEdgePoints: interior.map((point) => edgePoint(point)),
    firstAndLastEdgePoints: [edgePoint(start), edgePoint(end)],
    flags: 6,
    queuedPropertyCount: 0,
  };
}

function plane(orientFlag = true): Revit2027PlaneSurface {
  return {
    kind: "plane",
    sourceClassSlot: REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
    byteOffset: 10,
    endOffset: 115,
    surface: {
      envelope: {
        firstCorner: [0, 0],
        secondCorner: [1, 1],
      },
      orientFlag,
    },
    origin: [10, 20, 30],
    xVector: [1, 0, 0],
    yVector: [0, 1, 0],
    queuedProperties: [],
  };
}

function squareEdgeUses(): Revit2027PlanarSampledEdgeUse[] {
  return [
    { edgeToken: 10, edge: edge(10, [0, 0], [1, 0]), faceSide: 0, direction: 1 },
    { edgeToken: 11, edge: edge(11, [1, 0], [1, 1]), faceSide: 0, direction: 1 },
    { edgeToken: 12, edge: edge(12, [1, 1], [0, 1]), faceSide: 0, direction: 1 },
    { edgeToken: 13, edge: edge(13, [0, 1], [0, 0]), faceSide: 0, direction: 1 },
  ];
}

type MutableTestInput = {
  id: string;
  provenance: { decoderId: string };
  faces: {
    faceToken: number;
    surface: Revit2027PlaneSurface;
    loops: {
      loopToken: number;
      role: "outer" | "hole";
      edgeUses: Revit2027PlanarSampledEdgeUse[];
    }[];
    materialId?: string | number | null;
    provenance: { decoderId: string };
  }[];
};

function input(edgeUses = squareEdgeUses()): MutableTestInput {
  return {
    id: "body-1",
    provenance: { decoderId: "synthetic-revit-2027" },
    faces: [{
      faceToken: FACE_TOKEN,
      surface: plane(),
      loops: [{ loopToken: 20, role: "outer" as const, edgeUses }],
      provenance: { decoderId: "synthetic-face" },
    }],
  };
}

test("adapts persisted planar GEdge samples and tessellates the neutral BRep", () => {
  const adapted = adaptRevit2027PlanarSampledBrep(input());
  assert.equal(adapted.ok, true);
  if (!adapted.ok) return;

  const face = adapted.brep.faces[0]!;
  assert.equal(face.surface.kind, "plane");
  assert.equal(face.orientation, 1);
  assert.equal(face.materialId, null);
  assert.deepEqual(
    face.trims[0]!.curves.map((curve) => curve.kind),
    ["line", "line", "line", "line"],
  );

  const tessellated = tessellatePlanarBrep(adapted.brep);
  assert.equal(tessellated.ok, true);
  if (!tessellated.ok) return;
  assert.equal(tessellated.mesh.positions.length, 12);
  assert.equal(tessellated.mesh.indices.length, 6);
  assert.equal(tessellated.mesh.groups.length, 1);
  assert.equal(tessellated.mesh.groups[0]!.materialId, null);
});

test("uses ordered interior UV samples and explicit reversed edge uses", () => {
  const forward = squareEdgeUses();
  forward[0] = {
    edgeToken: 10,
    edge: edge(10, [0, 0], [1, 0], [FACE_TOKEN, 0], [[0.5, 0]]),
    faceSide: 0,
    direction: 1,
  };
  const reversed = [...forward]
    .reverse()
    .map((edgeUse) => ({ ...edgeUse, direction: -1 as const }));
  const adapted = adaptRevit2027PlanarSampledBrep(input(reversed));
  assert.equal(adapted.ok, true);
  if (!adapted.ok) return;
  const curves = adapted.brep.faces[0]!.trims[0]!.curves;
  assert.equal(curves.at(-1)!.kind, "polyline");
  assert.deepEqual(curves.at(-1), {
    kind: "polyline",
    points: [
      [11, 20, 30],
      [10.5, 20, 30],
      [10, 20, 30],
    ],
  });
  assert.equal(tessellatePlanarBrep(adapted.brep).ok, true);
});

test("preserves an independently supplied exact material assignment", () => {
  const value = input();
  value.faces[0]!.materialId = 1234;
  const adapted = adaptRevit2027PlanarSampledBrep(value);
  assert.equal(adapted.ok, true);
  if (!adapted.ok) return;
  assert.equal(adapted.brep.faces[0]!.materialId, 1234);
});

test("rejects ambiguous loop roles, face-side mismatches, and open samples", () => {
  const noOuter = input();
  noOuter.faces[0]!.loops[0]!.role = "hole";
  const noOuterResult = adaptRevit2027PlanarSampledBrep(noOuter);
  assert.equal(noOuterResult.ok, false);
  if (!noOuterResult.ok) {
    assert.equal(noOuterResult.issues[0]!.code, "invalid-loop");
  }

  const wrongFace = squareEdgeUses();
  wrongFace[0] = {
    ...wrongFace[0]!,
    edge: edge(10, [0, 0], [1, 0], [99, 0]),
  };
  const wrongFaceResult = adaptRevit2027PlanarSampledBrep(input(wrongFace));
  assert.equal(wrongFaceResult.ok, false);
  if (!wrongFaceResult.ok) {
    assert.ok(
      wrongFaceResult.issues.some((issue) => issue.code === "edge-face-mismatch"),
    );
  }

  const open = squareEdgeUses();
  open[1] = {
    ...open[1]!,
    edge: edge(11, [2, 0], [1, 1]),
  };
  const openResult = adaptRevit2027PlanarSampledBrep(input(open));
  assert.equal(openResult.ok, false);
  if (!openResult.ok) {
    assert.ok(openResult.issues.some((issue) => issue.code === "open-loop"));
  }
});
