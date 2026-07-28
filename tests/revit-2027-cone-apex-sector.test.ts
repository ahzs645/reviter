import assert from "node:assert/strict";
import test from "node:test";

import {
  tessellateRevit2027ConeApexSectors,
  tessellateRevit2027SampledConeFaces,
  type Revit2027ConeApexSectorEdge,
  type Revit2027ConeApexSectorFace,
  type Revit2027ConeApexSectorSurface,
} from "../lib/reviter/revit-2027-cone-apex-sector.ts";

const provenance = {
  decoderId: "revit-2027-cone-apex-sector-test",
  elementId: 1960533,
};

function surface(
  overrides: Partial<Revit2027ConeApexSectorSurface> = {},
): Revit2027ConeApexSectorSurface {
  return {
    kind: "cone",
    center: [10, 20, 30],
    xVector: [1, 0, 0],
    yVector: [0, 1, 0],
    zVector: [0, 0, 1],
    halfAngle: Math.PI / 4,
    surface: {
      envelope: {
        firstCorner: [0, 0],
        secondCorner: [Math.PI / 2, 4],
      },
      orientFlag: true,
    },
    ...overrides,
  };
}

function edges(
  firstAngle = 0,
  secondAngle = Math.PI / 2,
): Revit2027ConeApexSectorEdge[] {
  return [
    {
      edgeToken: 11,
      samples: [
        [firstAngle, 0],
        [firstAngle, 2],
        [firstAngle, 4],
      ],
    },
    {
      edgeToken: 12,
      samples: [
        [firstAngle, 4],
        [(firstAngle + secondAngle) / 2, 4],
        [secondAngle, 4],
      ],
    },
    {
      edgeToken: 13,
      samples: [
        [secondAngle, 4],
        [secondAngle, 2],
        [secondAngle, 0],
      ],
    },
  ];
}

function face(
  overrides: Partial<Revit2027ConeApexSectorFace> = {},
): Revit2027ConeApexSectorFace {
  return {
    faceToken: 4,
    surface: surface(),
    loops: [{
      loopToken: 7,
      role: "outer",
      edges: edges(),
    }],
    materialId: 42,
    objectMarker: 6,
    provenance,
    ...overrides,
  };
}

function triangleNormal(
  positions: Float64Array,
  triangle = 0,
): [number, number, number] {
  const offset = triangle * 9;
  const a = positions.slice(offset, offset + 3);
  const b = positions.slice(offset + 3, offset + 6);
  const c = positions.slice(offset + 6, offset + 9);
  const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
  const ac = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
  return [
    ab[1]! * ac[2]! - ab[2]! * ac[1]!,
    ab[2]! * ac[0]! - ab[0]! * ac[2]!,
    ab[0]! * ac[1]! - ab[1]! * ac[0]!,
  ];
}

test("fans one exact apex over persisted constant-distance arc samples", () => {
  const result = tessellateRevit2027ConeApexSectors({
    id: "sector",
    faces: [face()],
    provenance,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.mesh.indices.length / 3, 2);
  assert.equal(result.mesh.positions.length / 3, 6);
  assert.equal(result.mesh.groups.length, 1);
  assert.deepEqual(
    [...result.mesh.positions.slice(0, 3)],
    [10, 20, 30],
  );
  assert.deepEqual(
    [...result.mesh.positions.slice(3, 6)].map((value) =>
      Math.round(value * 1e12) / 1e12
    ),
    [12, 22, 32.828427124746],
  );
  assert.equal(result.mesh.groups[0]?.materialId, 42);
  assert.equal(result.mesh.groups[0]?.objectMarker, 6);

  const geometric = triangleNormal(result.mesh.positions);
  const smooth = result.mesh.normals.slice(0, 3);
  assert.ok(
    geometric[0] * smooth[0]! +
      geometric[1] * smooth[1]! +
      geometric[2] * smooth[2]! >
      0,
  );
});

test("canonicalizes a left-handed persisted cone without moving points", () => {
  const leftSurface = surface({
    yVector: [0, -1, 0],
    surface: {
      envelope: {
        firstCorner: [0, 0],
        secondCorner: [Math.PI / 2, 4],
      },
      orientFlag: false,
    },
  });
  const result = tessellateRevit2027ConeApexSectors({
    id: "left-handed",
    faces: [face({ surface: leftSurface })],
    provenance,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const points = [...result.mesh.positions];
  const outerPoints = [
    points.slice(3, 6),
    points.slice(6, 9),
    points.slice(12, 15),
    points.slice(15, 18),
  ];
  assert.ok(
    outerPoints.some(
      (point) =>
        Math.abs(point[0]! - 10) < 1e-12 &&
        Math.abs(point[1]! - (20 - 2 * Math.SQRT2)) < 1e-12,
    ),
  );
  assert.ok(
    outerPoints.every((point) => Math.abs(point[2]! - (30 + 2 * Math.SQRT2)) < 1e-12),
  );
});

test("accepts distinct angular UV values at the single physical apex", () => {
  const sectorFace = face();
  const loop = sectorFace.loops[0]!;
  assert.notDeepEqual(
    loop.edges[0]?.samples[0],
    loop.edges.at(-1)?.samples.at(-1),
  );
  const result = tessellateRevit2027ConeApexSectors({
    id: "apex-equivalence",
    faces: [sectorFace],
    provenance,
  });
  assert.equal(result.ok, true);
});

test("fails closed outside the exact three-edge apex-sector subset", () => {
  const noApex = face({
    loops: [{
      loopToken: 7,
      role: "outer",
      edges: edges().map((edge) => ({
        ...edge,
        samples: edge.samples.map(
          ([angle, distance]) => [angle, distance + 1] as const,
        ),
      })),
    }],
  });
  const noApexResult = tessellateRevit2027ConeApexSectors({
    id: "no-apex",
    faces: [noApex],
    provenance,
  });
  assert.equal(noApexResult.ok, false);
  if (!noApexResult.ok) {
    assert.equal(noApexResult.issues[0]?.code, "open-loop");
  }

  const fourEdges = face({
    loops: [{
      loopToken: 7,
      role: "outer",
      edges: [
        ...edges(),
        { edgeToken: 14, samples: [[0, 0], [0, 1]] },
      ],
    }],
  });
  const fourEdgeResult = tessellateRevit2027ConeApexSectors({
    id: "four-edges",
    faces: [fourEdges],
    provenance,
  });
  assert.equal(fourEdgeResult.ok, false);
  if (!fourEdgeResult.ok) {
    assert.equal(fourEdgeResult.issues[0]?.code, "unsupported-trim");
  }

  const curvedGenerator = face();
  const curvedEdges = curvedGenerator.loops[0]!.edges.map((edge, index) =>
    index === 0
      ? {
          ...edge,
          samples: [[0, 0], [0.1, 2], [0, 4]] as const,
        }
      : edge
  );
  const curvedResult = tessellateRevit2027ConeApexSectors({
    id: "curved-generator",
    faces: [face({
      loops: [{
        loopToken: 7,
        role: "outer",
        edges: curvedEdges,
      }],
    })],
    provenance,
  });
  assert.equal(curvedResult.ok, false);
  if (!curvedResult.ok) {
    assert.equal(curvedResult.issues[0]?.code, "missing-apex");
  }
});

test("rejects wrapping arcs, invalid bases, and unsafe vertex limits", () => {
  const wrapping = face({
    loops: [{
      loopToken: 7,
      role: "outer",
      edges: edges(0, Math.PI * 2),
    }],
  });
  const wrappingResult = tessellateRevit2027ConeApexSectors({
    id: "wrapping",
    faces: [wrapping],
    provenance,
  });
  assert.equal(wrappingResult.ok, false);
  if (!wrappingResult.ok) {
    assert.equal(wrappingResult.issues[0]?.code, "unsupported-trim");
  }

  const invalidFrameResult = tessellateRevit2027ConeApexSectors({
    id: "invalid-frame",
    faces: [face({
      surface: surface({ yVector: [1, 0, 0] }),
    })],
    provenance,
  });
  assert.equal(invalidFrameResult.ok, false);
  if (!invalidFrameResult.ok) {
    assert.equal(invalidFrameResult.issues[0]?.code, "invalid-cone");
  }

  const limitedResult = tessellateRevit2027ConeApexSectors({
    id: "limited",
    faces: [face()],
    provenance,
    maxVertices: 5,
  });
  assert.equal(limitedResult.ok, false);
  if (!limitedResult.ok) {
    assert.equal(limitedResult.issues[0]?.code, "vertex-limit");
  }
});

test("adaptively tessellates a non-apex sampled cone profile", () => {
  const sampledFace = face({
    loops: [{
      loopToken: 7,
      role: "outer",
      edges: [
        {
          edgeToken: 11,
          samples: [[0, 1], [0, 2.5], [0, 4]],
        },
        {
          edgeToken: 12,
          samples: [
            [0, 4],
            [Math.PI / 4, 4],
            [Math.PI / 2, 4],
          ],
        },
        {
          edgeToken: 13,
          samples: [
            [Math.PI / 2, 4],
            [Math.PI / 2, 2.5],
            [Math.PI / 2, 1],
          ],
        },
        {
          edgeToken: 14,
          samples: [
            [Math.PI / 2, 1],
            [Math.PI / 4, 1],
            [0, 1],
          ],
        },
      ],
    }],
  });
  const result = tessellateRevit2027SampledConeFaces({
    id: "sampled-profile",
    faces: [sampledFace],
    provenance,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.mesh.groups.length, 1);
  assert.ok(result.mesh.indices.length / 3 >= 6);
  assert.equal(result.mesh.positions.length, result.mesh.normals.length);
  assert.ok([...result.mesh.positions].every(Number.isFinite));
  assert.ok([...result.mesh.normals].every(Number.isFinite));
});
