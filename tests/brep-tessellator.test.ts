import assert from "node:assert/strict";
import test from "node:test";

import {
  tessellateNeutralBrep,
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

function scaling(x: number, y: number, z: number): BrepMatrix4 {
  return [
    x, 0, 0, 0,
    0, y, 0, 0,
    0, 0, z, 0,
    0, 0, 0, 1,
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

function pcurveLoop(
  id: string,
  role: "outer" | "hole",
  points: [number, number][],
): BrepTrimLoop {
  return {
    id,
    role,
    curves: points.map((point, index) => ({
      kind: "pcurve-line" as const,
      start: point,
      end: points[(index + 1) % points.length]!,
    })),
  };
}

function cylinderFace(
  id: string,
  trims: BrepTrimLoop[],
  overrides: Partial<NeutralBrepFace> = {},
): NeutralBrepFace {
  return {
    id,
    surface: {
      kind: "cylinder",
      origin: [0, 0, 0],
      axis: [0, 0, 1],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      radius: 2,
    },
    trims,
    provenance: { decoderId: "test-cylinder", sourceId: id },
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
    surface: {
      kind: "cylinder",
      origin: [0, 0, 0],
      axis: [0, 0, 1],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      radius: 2,
    },
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

const CYLINDER_POLICY = {
  maximumEdgeLength: 100,
  maximumAngleDegrees: 30,
  surfaceDeviation: 0,
} as const;

test("tessellates a bounded cylindrical p-curve chart with native angular steps", () => {
  const face = cylinderFace("cyl-face", [
    pcurveLoop("cyl-outer", "outer", [
      [0, 0],
      [1, 0],
      [1, Math.PI / 2],
      [0, Math.PI / 2],
    ]),
  ], {
    orientation: -1,
    materialId: "cylinder-finish",
    objectMarker: 0x08c6,
    transform: translation(1, 2, 3),
    provenance: {
      decoderId: "native-cylinder-v1",
      stream: "Partitions/325",
      byteOffset: 137,
      elementId: 305688,
    },
  });
  const result = tessellateNeutralBrep(
    brep([face], translation(10, 20, 30)),
    { nativePolicy: CYLINDER_POLICY },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  // One axial interval and three 30-degree angular intervals.
  assert.equal(result.mesh.positions.length / 3, 8);
  assert.equal(result.mesh.indices.length / 3, 6);
  assert.deepEqual([...result.mesh.positions.slice(0, 3)], [13, 22, 33]);
  assert.deepEqual([...result.mesh.normals.slice(0, 3)], [-1, 0, 0]);
  assert.deepEqual(result.mesh.groups[0], {
    faceId: "cyl-face",
    indexOffset: 0,
    indexCount: 18,
    vertexOffset: 0,
    vertexCount: 8,
    materialId: "cylinder-finish",
    objectMarker: 0x08c6,
    sourceTransform: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      11, 22, 33, 1,
    ],
    brepProvenance: { decoderId: "test-brep", elementId: 42 },
    faceProvenance: {
      decoderId: "native-cylinder-v1",
      stream: "Partitions/325",
      byteOffset: 137,
      elementId: 305688,
    },
  });
});

test("tessellates a bounded orthogonal concave cylinder chart", () => {
  const face = cylinderFace("notched-cylinder", [
    pcurveLoop("notched-outer", "outer", [
      [0, 0],
      [2, 0],
      [2, Math.PI / 2],
      [1, Math.PI / 2],
      [1, Math.PI / 4],
      [0, Math.PI / 4],
    ]),
  ]);
  const result = tessellateNeutralBrep(
    brep([face]),
    { nativePolicy: CYLINDER_POLICY },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  // The 2×4 native-bounded chart grid contains six cells after the notch.
  assert.equal(result.mesh.indices.length / 3, 12);
  assert.equal(result.mesh.groups.length, 1);
  assert.equal(result.mesh.groups[0]!.faceId, "notched-cylinder");
  assert.equal(result.mesh.groups[0]!.vertexCount, 13);
  assert.ok([...result.mesh.positions].every(Number.isFinite));
  assert.ok([...result.mesh.normals].every(Number.isFinite));
});

test("tessellates a persisted sampled diagonal cylinder p-curve without inventing boundary points", () => {
  const face = cylinderFace("sampled-intersection-cylinder", [{
    id: "sampled-outer",
    role: "outer",
    curves: [
      {
        kind: "pcurve-polyline",
        points: [[0, 0], [0.5, 0.25], [1, 0.5]],
      },
      {
        kind: "pcurve-line",
        start: [1, 0.5],
        end: [1, 1],
      },
      {
        kind: "pcurve-polyline",
        points: [[1, 1], [0.5, 1], [0, 1]],
      },
      {
        kind: "pcurve-polyline",
        points: [[0, 1], [0, 0.5], [0, 0]],
      },
    ],
  }]);
  const result = tessellateNeutralBrep(
    brep([face]),
    { nativePolicy: CYLINDER_POLICY },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  // Eight persisted boundary samples remain exact; only overlong internal
  // triangulation edges may add vertices.
  assert.ok(result.mesh.positions.length / 3 >= 8);
  assert.ok(result.mesh.indices.length > 0);
  assert.ok([...result.mesh.positions].every(Number.isFinite));
  assert.ok([...result.mesh.normals].every(Number.isFinite));
});

test("tessellates an orthogonal cylinder chart with a strict hole", () => {
  const face = cylinderFace("perforated-cylinder", [
    pcurveLoop("outer", "outer", [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ]),
    pcurveLoop("hole", "hole", [
      [0.5, 0.5],
      [0.5, 1.5],
      [1.5, 1.5],
      [1.5, 0.5],
    ]),
  ]);
  const result = tessellateNeutralBrep(
    brep([face]),
    { nativePolicy: CYLINDER_POLICY },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  // Native 30-degree refinement creates four angular rows; the hole removes
  // the two cells in its bounded middle column.
  assert.equal(result.mesh.indices.length / 3, 20);
  assert.equal(result.mesh.groups[0]!.vertexCount, 20);
  assert.ok([...result.mesh.positions].every(Number.isFinite));
  assert.ok([...result.mesh.normals].every(Number.isFinite));
});

test("combines planar and cylindrical faces as contiguous source groups", () => {
  const plane = planarFace("plane", [loop("plane-outer", "outer", [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ])]);
  const cylinder = cylinderFace("cylinder", [
    pcurveLoop("cylinder-outer", "outer", [
      [0, 0],
      [1, 0],
      [1, Math.PI / 2],
      [0, Math.PI / 2],
    ]),
  ]);
  const result = tessellateNeutralBrep(
    brep([plane, cylinder]),
    { nativePolicy: CYLINDER_POLICY },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.mesh.groups.length, 2);
  assert.deepEqual(
    result.mesh.groups.map((group) => [
      group.faceId,
      group.indexOffset,
      group.vertexOffset,
      group.indexCount,
      group.vertexCount,
    ]),
    [
      ["plane", 0, 0, 3, 3],
      ["cylinder", 3, 3, 18, 8],
    ],
  );
});

test("derives cylindrical normals from composed non-uniform transforms", () => {
  const face = cylinderFace("scaled-cylinder", [
    pcurveLoop("outer", "outer", [
      [0, Math.PI / 4],
      [1, Math.PI / 4],
      [1, Math.PI / 3],
      [0, Math.PI / 3],
    ]),
  ]);
  const result = tessellateNeutralBrep(
    brep([face], scaling(2, 1, 3)),
    { nativePolicy: CYLINDER_POLICY },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const [x, y, z] = result.mesh.normals;
  assert.ok(Math.abs(x! - 1 / Math.sqrt(5)) < 1e-6);
  assert.ok(Math.abs(y! - 2 / Math.sqrt(5)) < 1e-6);
  assert.equal(z, 0);
  assert.deepEqual(
    result.mesh.groups[0]!.sourceTransform,
    scaling(2, 1, 3),
  );
});

test("requires an explicit native policy for a cylindrical face", () => {
  const face = cylinderFace("cylinder", [
    pcurveLoop("outer", "outer", [[0, 0], [1, 0], [1, 1], [0, 1]]),
  ]);
  const result = tessellateNeutralBrep(brep([face]));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(
      result.issues.map((issue) => [issue.faceId, issue.code]),
      [["cylinder", "missing-tessellation-policy"]],
    );
  }
});

test("rejects cylinder seams, ambiguous wraps, invalid holes, and 3D trims", () => {
  const fullPeriod = cylinderFace("full-period", [
    pcurveLoop("outer", "outer", [
      [0, 0], [1, 0], [1, Math.PI * 2], [0, Math.PI * 2],
    ]),
  ]);
  const ambiguous = cylinderFace("ambiguous", [
    pcurveLoop("outer", "outer", [[0, 0], [1, 0], [1, 4], [0, 4]]),
  ]);
  const skewed = cylinderFace("skewed", [
    pcurveLoop("outer", "outer", [[0, 0], [1, 0], [1.2, 1], [0, 1]]),
  ]);
  const withHole = cylinderFace("with-hole", [
    pcurveLoop("outer", "outer", [[0, 0], [2, 0], [2, 2], [0, 2]]),
    pcurveLoop("hole", "hole", [[1.5, 0.5], [2.5, 0.5], [2.5, 1.5], [1.5, 1.5]]),
  ]);
  const threeDimensional = cylinderFace("three-dimensional", [
    loop("outer", "outer", [
      [2, 0, 0],
      [2, 0, 2],
      [0, 2, 2],
      [0, 2, 0],
    ]),
  ]);

  const result = tessellateNeutralBrep(
    brep([fullPeriod, ambiguous, skewed, withHole, threeDimensional]),
    { nativePolicy: CYLINDER_POLICY },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(
      result.issues.map((issue) => [issue.faceId, issue.loopId, issue.code]),
      [
        ["full-period", "outer", "wrapping-cylinder-chart"],
        ["ambiguous", "outer", "wrapping-cylinder-chart"],
        ["skewed", "outer", "invalid-cylinder-chart"],
        ["with-hole", "hole", "invalid-hole"],
        ["three-dimensional", "outer", "unsupported-trim-curve"],
      ],
    );
  }
});

test("rejects invalid cylinder frames and cylindrical vertex overflow", () => {
  const outer = pcurveLoop("outer", "outer", [
    [0, 0],
    [1, 0],
    [1, Math.PI / 2],
    [0, Math.PI / 2],
  ]);
  const badFrame = cylinderFace("bad-frame", [outer], {
    surface: {
      kind: "cylinder",
      origin: [0, 0, 0],
      axis: [0, 0, 1],
      xAxis: [1, 0, 0],
      yAxis: [0, -1, 0],
      radius: 2,
    },
  });
  const invalid = tessellateNeutralBrep(
    brep([badFrame]),
    { nativePolicy: CYLINDER_POLICY },
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.issues[0]?.code, "invalid-cylinder");

  const bounded = tessellateNeutralBrep(
    brep([cylinderFace("bounded", [outer])]),
    { nativePolicy: CYLINDER_POLICY, maxVertices: 7 },
  );
  assert.equal(bounded.ok, false);
  if (!bounded.ok) {
    assert.equal(
      bounded.issues[0]?.message,
      "cylindrical mesh vertex count exceeds the safety bound",
    );
  }

  // A positive native axial step remains active even below the geometric
  // comparison tolerance; treating it as zero would silently coarsen U.
  const strictAxial = cylinderFace("strict-axial", [
    pcurveLoop("strict-outer", "outer", [
      [0, 0],
      [1, 0],
      [1, 1e-8],
      [0, 1e-8],
    ]),
  ]);
  const strict = tessellateNeutralBrep(
    brep([strictAxial]),
    {
      angularTolerance: 1e-12,
      maxVertices: 10,
      nativePolicy: {
        maximumEdgeLength: 1e-7,
        maximumAngleDegrees: 360,
        surfaceDeviation: 0,
      },
    },
  );
  assert.equal(strict.ok, false);
  if (!strict.ok) {
    assert.equal(
      strict.issues[0]?.message,
      "cylindrical mesh vertex count exceeds the safety bound",
    );
  }
});

test("keeps tessellatePlanarBrep as a curved-surface rejecting compatibility entry point", () => {
  const face = cylinderFace("cylinder", [
    pcurveLoop("outer", "outer", [[0, 0], [1, 0], [1, 1], [0, 1]]),
  ]);
  const result = tessellatePlanarBrep(
    brep([face]),
    { nativePolicy: CYLINDER_POLICY },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.issues[0]?.code, "unsupported-surface");
});
