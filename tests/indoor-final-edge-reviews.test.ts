import test from "node:test";
import assert from "node:assert/strict";
import {
  finalNativeEdgeReviewKey,
  replayFinalNativeEdgeReviews,
} from "../lib/reviter/indoor-final-edge-reviews.ts";
import type {
  IndoorDataset,
  IndoorEdge,
} from "../lib/reviter/indoor-contract.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import {
  prepareNativeCirculationGeometry,
  attachNativeCirculationCellRoutes,
} from "../lib/reviter/native-circulation-geometry.ts";

function setup() {
  const edge: IndoorEdge = {
    id: "cell:walk:a|b",
    from: "a",
    to: "b",
    kind: "walk",
    nativeCellId: "cell",
    pointsFeet: [
      [1, 2, 0],
      [4, 2, 0],
    ],
    roomKeys: ["hall"],
    lengthMetres: 0.9144,
    evidence: "exact native cell branch",
    enabled: true,
    accessible: "unknown",
  };
  const data = {
    source: { modelSha256: "a".repeat(64) },
    nodes: [
      { id: "a", roomKey: "hall", levelId: 1, pointFeet: edge.pointsFeet[0] },
      { id: "b", roomKey: "hall", levelId: 1, pointFeet: edge.pointsFeet[1] },
    ],
    records: [{ key: "hall", walkable: true, access: "unknown" }],
    edges: [edge],
    circulationGeometry: {
      sourceModelSha256: "a".repeat(64),
      cells: [{ id: "cell" }],
    },
  } as IndoorDataset;
  const review = {
    accessible: "yes" as const,
    geometryKey: finalNativeEdgeReviewKey(data, edge),
    notes: "Original checked step-free passage.",
  };
  return { data, edge, review, saved: { edges: { [edge.id]: review } } };
}

test("replays an existing exact review after a final native branch was rebuilt", () => {
  const { data, edge, saved } = setup();
  const original = JSON.stringify({
    nodes: data.nodes,
    records: data.records,
    geometry: data.circulationGeometry,
    path: edge.pointsFeet,
  });
  assert.deepEqual(replayFinalNativeEdgeReviews(data, saved).applied, [
    edge.id,
  ]);
  assert.equal(edge.accessible, "yes");
  assert.equal(
    JSON.stringify({
      nodes: data.nodes,
      records: data.records,
      geometry: data.circulationGeometry,
      path: edge.pointsFeet,
    }),
    original,
  );
  assert.equal(edge.notes, "Original checked step-free passage.");
});

test("does not infer confirmation from a native cell or coincident node names", () => {
  const { data, edge, saved } = setup();
  assert.equal(replayFinalNativeEdgeReviews(data, {}).applied.length, 0);
  assert.equal(edge.accessible, "unknown");
  data.nodes.push({ ...data.nodes[1]!, id: "alias:b" });
  edge.to = "alias:b";
  assert.equal(replayFinalNativeEdgeReviews(data, saved).refused.length, 1);
  assert.equal(edge.accessible, "unknown");
});

test("changed model, owners, path, native endpoint, direction and access do not inherit yes", () => {
  const mutations = [
    ({ data }: ReturnType<typeof setup>) => {
      data.source.modelSha256 = "b".repeat(64);
    },
    ({ edge }: ReturnType<typeof setup>) => {
      edge.roomKeys = ["another"];
    },
    ({ edge }: ReturnType<typeof setup>) => {
      edge.pointsFeet = [
        [1, 2, 0],
        [4.1, 2, 0],
      ];
    },
    ({ data }: ReturnType<typeof setup>) => {
      data.nodes[1]!.pointFeet = [4.1, 2, 0];
    },
    ({ edge }: ReturnType<typeof setup>) => {
      edge.direction = "from-to";
    },
    ({ data }: ReturnType<typeof setup>) => {
      data.records[0]!.access = "staff";
    },
    ({ data }: ReturnType<typeof setup>) => {
      data.records[0]!.walkable = false;
    },
    ({ data }: ReturnType<typeof setup>) => {
      data.circulationGeometry!.cells = [];
    },
  ];
  for (const mutate of mutations) {
    const s = setup();
    mutate(s);
    assert.equal(
      replayFinalNativeEdgeReviews(s.data, s.saved).refused.length,
      1,
    );
    assert.equal(s.edge.accessible, "unknown");
  }
});

test("retains a saved closure on the final branch even when old positive evidence is stale", () => {
  const { data, edge, review, saved } = setup();
  Object.assign(review, { enabled: false, geometryKey: "stale" });
  const r = replayFinalNativeEdgeReviews(data, saved);
  assert.deepEqual(r.disabled, [edge.id]);
  assert.equal(edge.enabled, false);
  assert.equal(edge.accessible, "unknown");
  assert.equal(r.refused.length, 1);
});

test("a matching legacy key cannot approve a stepped or nonfinite intermediate walk", () => {
  for (const point of [
    [2, 2, 0.25],
    [NaN, 2, 0],
    [2, Infinity, 0],
    [2, 2],
  ] as number[][]) {
    const { data, edge, review, saved } = setup();
    edge.pointsFeet.splice(1, 0, point as [number, number, number]);
    review.geometryKey = finalNativeEdgeReviewKey(data, edge);
    assert.equal(replayFinalNativeEdgeReviews(data, saved).refused.length, 1);
    assert.equal(edge.accessible, "unknown");
  }
});

test("cannot enable a physically disabled branch and leaves stairs and doors untouched", () => {
  const { data, edge, review, saved } = setup();
  edge.enabled = false;
  Object.assign(review, { enabled: true });
  replayFinalNativeEdgeReviews(data, saved);
  assert.equal(edge.enabled, false);
  for (const kind of ["stairs", "local-steps", "escalator", "door"] as const) {
    edge.kind = kind;
    edge.accessible = kind === "door" ? "unknown" : "no";
    assert.equal(replayFinalNativeEdgeReviews(data, saved).applied.length, 0);
    assert.equal(edge.accessible, kind === "door" ? "unknown" : "no");
  }
});

test("replays explicit no and unknown only against the original final geometry", () => {
  for (const accessible of ["no", "unknown"] as const) {
    const { data, edge, review, saved } = setup();
    Object.assign(review, { accessible });
    edge.accessible = "yes";
    assert.deepEqual(replayFinalNativeEdgeReviews(data, saved).applied, [
      edge.id,
    ]);
    assert.equal(edge.accessible, accessible);
  }
});

test("actual native cell reconstruction preserves exact review and closure without changing geometry", () => {
  const rect = [
    [0, 0],
    [20, 0],
    [20, 10],
    [0, 10],
  ];
  const model = {
    elementBounds: [
      {
        elementId: 100,
        categoryId: -2000032,
        boundsFeet: { min: { x: 0, y: 0, z: -1 }, max: { x: 20, y: 10, z: 0 } },
        loops: [rect.map((p) => [...p, 0])],
      },
    ],
    levels: [{ levelId: 1, elevation: 0 }],
    nativeAssociatedLevelRelations: [],
  } as unknown as ConvertResult;
  const data = {
    source: { modelSha256: "a".repeat(64) },
    records: [
      {
        key: "hall",
        number: "Hall",
        name: "Hallway",
        building: "B",
        levelId: 1,
        elevationFeet: 0,
        elevationEvidence: "native",
        surfaceId: "hall",
        circulation: true,
        stair: false,
        walkable: true,
        access: "unknown",
        confidence: 1,
        ringsFeet: [rect],
        properties: {},
      },
    ],
    nativeLevels: [{ id: 1, name: "Ground", elevationFeet: 0 }],
    walls: [],
    doors: [],
    nodes: [
      {
        id: "a",
        roomKey: "hall",
        kind: "arrival",
        levelId: 1,
        pointFeet: [2, 5, 0],
      },
      {
        id: "b",
        roomKey: "hall",
        kind: "connector",
        levelId: 1,
        pointFeet: [18, 5, 0],
      },
    ],
    edges: [],
    alignment: { horizontalMetresPerFoot: 0.3048 },
    report: { components: 0, largestComponentArrivals: 0 },
  } as unknown as IndoorDataset;
  data.circulationGeometry = prepareNativeCirculationGeometry(
    model,
    data,
  ).geometry;
  assert.ok(attachNativeCirculationCellRoutes(data) > 0);
  const original = data.edges[0]!;
  const saved = {
    edges: {
      [original.id]: {
        enabled: false,
        accessible: "yes" as const,
        geometryKey: finalNativeEdgeReviewKey(data, original),
        notes: "Original review plus temporary closure.",
      },
    },
  };
  original.enabled = false;
  original.accessible = "yes";
  const physical = JSON.stringify([
    data.nodes,
    data.records,
    data.circulationGeometry,
    original.pointsFeet,
  ]);
  assert.ok(attachNativeCirculationCellRoutes(data) > 0);
  const rebuilt = data.edges.find((edge) => edge.id === original.id)!;
  assert.notEqual(rebuilt, original);
  assert.equal(
    rebuilt.enabled,
    true,
    "source review must be replayed after the physical branch was reconstructed",
  );
  assert.equal(rebuilt.accessible, "unknown");
  assert.deepEqual(replayFinalNativeEdgeReviews(data, saved).applied, [
    original.id,
  ]);
  assert.equal(rebuilt.enabled, false);
  assert.equal(rebuilt.accessible, "yes");
  assert.equal(
    JSON.stringify([
      data.nodes,
      data.records,
      data.circulationGeometry,
      rebuilt.pointsFeet,
    ]),
    physical,
  );
});
