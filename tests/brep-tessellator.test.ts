import assert from "node:assert/strict";
import test from "node:test";

import {
  tessellatePlanarBrep,
  type BrepMatrix4,
  type BrepPoint3,
  type BrepTrimLoop,
  type NeutralBrep,
  type NeutralBrepFace,
} from "../lib/reviter/brep-tessellator.ts";

const IDENTITY: BrepMatrix4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function translation(x: number, y: number, z: number): BrepMatrix4 {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ];
}

function loop(id: string, role: "outer" | "hole", points: BrepPoint3[]): BrepTrimLoop {
  return {
    id,
    role,
    curves: points.map((point, index) => ({
      kind: "line" as const,
      start: point,
      end: points[(index + 1) % points.length]!,
    })),
  };
}

function planarFace(
  id: string,
  trims: BrepTrimLoop[],
  overrides: Partial<NeutralBrepFace> = {},
): NeutralBrepFace {
  return {
    id,
    surface: {
      kind: "plane",
      origin: [0, 0, 0],
      uAxis: [1, 0, 0],
      vAxis: [0, 1, 0],
      normal: [0, 0, 1],
    },
    trims,
    provenance: { decoderId: "test-face", sourceId: id },
    ...overrides,
  };
}

function brep(faces: NeutralBrepFace[], transform?: BrepMatrix4): NeutralBrep {
  return {
    id: "brep-1",
    faces,
    transform,
    provenance: { decoderId: "test-brep", elementId: 42 },
  };
}

function meshAreaXY(positions: Float64Array, indices: Uint32Array): number {
  let area = 0;
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index]! * 3;
    const b = indices[index + 1]! * 3;
    const c = indices[index + 2]! * 3;
    area += Math.abs(
      (positions[b]! - positions[a]!) * (positions[c + 1]! - positions[a + 1]!) -
        (positions[b + 1]! - positions[a + 1]!) *
          (positions[c]! - positions[a]!),
    ) / 2;
  }
  return area;
}

test("tessellates a transformed planar face with a hole and preserves its group contract", () => {
  const outer = loop("outer", "outer", [
    [0, 0, 0],
    [4, 0, 0],
    [4, 4, 0],
    [0, 4, 0],
  ]);
  const hole = loop("opening", "hole", [
    [1, 1, 0],
    [1, 3, 0],
    [3, 3, 0],
    [3, 1, 0],
  ]);
  const face = planarFace("face-a", [outer, hole], {
    materialId: "paint-blue",
    objectMarker: 0x08c6,
    transform: translation(1, 2, 3),
    provenance: {
      decoderId: "faceted-topology-v1",
      stream: "Partitions/325",
      chunkIndex: 7,
      byteOffset: 120,
      classId: 1869,
    },
  });

  const result = tessellatePlanarBrep(brep([face], translation(10, 20, 30)));
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(meshAreaXY(result.mesh.positions, result.mesh.indices), 12);
  assert.equal(result.mesh.groups.length, 1);
  assert.deepEqual(result.mesh.groups[0], {
    faceId: "face-a",
    indexOffset: 0,
    indexCount: result.mesh.indices.length,
    vertexOffset: 0,
    vertexCount: 8,
    materialId: "paint-blue",
    objectMarker: 0x08c6,
    sourceTransform: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      11, 22, 33, 1,
    ],
    brepProvenance: { decoderId: "test-brep", elementId: 42 },
    faceProvenance: {
      decoderId: "faceted-topology-v1",
      stream: "Partitions/325",
      chunkIndex: 7,
      byteOffset: 120,
      classId: 1869,
    },
  });
  assert.deepEqual([...result.mesh.positions.slice(0, 3)], [11, 22, 33]);
  assert.deepEqual([...result.mesh.normals.slice(0, 3)], [0, 0, 1]);
});

test("keeps faces as contiguous mesh groups and respects reversed face orientation", () => {
  const square = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
  ] as BrepPoint3[];
  const result = tessellatePlanarBrep(
    brep([
      planarFace("front", [loop("front-loop", "outer", square)], {
        materialId: 3,
        objectMarker: 100,
      }),
      planarFace("back", [loop("back-loop", "outer", square)], {
        orientation: -1,
        materialId: 4,
        objectMarker: 101,
        transform: translation(0, 0, 2),
      }),
    ]),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.mesh.groups.length, 2);
  assert.equal(result.mesh.groups[0]!.indexOffset, 0);
  assert.equal(result.mesh.groups[0]!.indexCount, 6);
  assert.equal(result.mesh.groups[1]!.indexOffset, 6);
  assert.equal(result.mesh.groups[1]!.vertexOffset, 4);
  assert.deepEqual([...result.mesh.normals.slice(0, 3)], [0, 0, 1]);
  assert.deepEqual([...result.mesh.normals.slice(12, 15)], [0, 0, -1]);
});

test("rejects curved surfaces and curved trims without returning a partial mesh", () => {
  const valid = planarFace("valid", [
    loop("valid-loop", "outer", [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]),
  ]);
  const cylinder: NeutralBrepFace = {
    id: "cylinder",
    surface: { kind: "cylinder", origin: [0, 0, 0], axis: [0, 0, 1], radius: 2 },
    trims: [],
    provenance: { decoderId: "test" },
  };
  const nurbs: NeutralBrepFace = {
    id: "nurbs",
    surface: {
      kind: "nurbs",
      degreeU: 1,
      degreeV: 1,
      controlPoints: [
        [[0, 0, 0], [0, 1, 0]],
        [[1, 0, 0], [1, 1, 0]],
      ],
      knotsU: [0, 0, 1, 1],
      knotsV: [0, 0, 1, 1],
    },
    trims: [],
    provenance: { decoderId: "test" },
  };
  const curvedTrim = planarFace("curved-trim", [{
    id: "arc-loop",
    role: "outer",
    curves: [{
      kind: "arc",
      center: [0, 0, 0],
      normal: [0, 0, 1],
      radius: 1,
      startAngle: 0,
      endAngle: Math.PI * 2,
    }],
  }]);

  const result = tessellatePlanarBrep(brep([valid, cylinder, nurbs, curvedTrim]));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(
    result.issues.map((issue) => [issue.faceId, issue.code]),
    [
      ["cylinder", "unsupported-surface"],
      ["nurbs", "unsupported-surface"],
      ["curved-trim", "unsupported-trim-curve"],
    ],
  );
});

test("rejects open, self-intersecting, non-planar, and exterior-hole loops", () => {
  const open = planarFace("open", [{
    id: "open-loop",
    role: "outer",
    curves: [{ kind: "polyline", points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] }],
  }]);
  const bowTie = planarFace("bow-tie", [loop("bow-loop", "outer", [
    [0, 0, 0],
    [2, 2, 0],
    [0, 2, 0],
    [2, 0, 0],
  ])]);
  const nonPlanar = planarFace("non-planar", [loop("np-loop", "outer", [
    [0, 0, 0],
    [2, 0, 0],
    [2, 2, 0.01],
    [0, 2, 0],
  ])]);
  const outsideHole = planarFace("bad-hole", [
    loop("shell", "outer", [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]]),
    loop("outside", "hole", [[3, 3, 0], [4, 3, 0], [4, 4, 0], [3, 4, 0]]),
  ]);

  const result = tessellatePlanarBrep(brep([open, bowTie, nonPlanar, outsideHole]));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(
    result.issues.map((issue) => [issue.faceId, issue.loopId, issue.code]),
    [
      ["open", "open-loop", "open-loop"],
      ["bow-tie", "bow-loop", "invalid-loop"],
      ["non-planar", "np-loop", "non-planar-loop"],
      ["bad-hole", "outside", "invalid-hole"],
    ],
  );
});

test("rejects invalid plane frames, projective transforms, and safety-bound overflow", () => {
  const trim = loop("loop", "outer", [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ]);
  const badPlane = planarFace("bad-plane", [trim], {
    surface: {
      kind: "plane",
      origin: [0, 0, 0],
      uAxis: [1, 0, 0],
      vAxis: [1, 0, 0],
      normal: [0, 0, 1],
    },
  });
  const projective = [...IDENTITY] as number[];
  projective[3] = 1;
  const badTransform = planarFace("bad-transform", [trim], {
    transform: projective as unknown as BrepMatrix4,
  });

  const invalid = tessellatePlanarBrep(brep([badPlane, badTransform]));
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.deepEqual(
      invalid.issues.map((issue) => [issue.faceId, issue.code]),
      [
        ["bad-plane", "invalid-plane"],
        ["bad-transform", "invalid-transform"],
      ],
    );
  }

  const bounded = tessellatePlanarBrep(
    brep([planarFace("bounded", [trim])]),
    { maxVertices: 2 },
  );
  assert.equal(bounded.ok, false);
  if (!bounded.ok) assert.equal(bounded.issues[0]?.message, "mesh vertex count exceeds the safety bound");
});
