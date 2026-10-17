import test from "node:test";
import assert from "node:assert/strict";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import { nativeIndoorEnvelopeHash } from "../lib/reviter/native-indoor-envelopes.ts";
import {
  proveReviewedFlatLanding,
  preserveSourceReviewedFlatLanding,
} from "../lib/reviter/indoor-reviewed-flat-landing.ts";

async function setup() {
  const ring = [
    [0, 0],
    [12, 0],
    [12, 10],
    [0, 10],
  ] as [number, number][];
  const floor = {
    elementId: 101,
    categoryId: -2000032,
    boundsFeet: { min: { x: 0, y: 0, z: -0.5 }, max: { x: 12, y: 10, z: 0 } },
    loops: [ring.map((p) => [...p, 0])],
  };
  const model = {
    elementBounds: [
      floor,
      {
        elementId: 99,
        categoryId: -2000120,
        boundsFeet: { min: { x: 7, y: 3, z: -1 }, max: { x: 9, y: 5, z: 0 } },
      },
      {
        elementId: 50,
        categoryId: -2000180,
        boundsFeet: { min: { x: 1, y: 1, z: -1 }, max: { x: 3, y: 5, z: 0 } },
      },
    ],
    nativeStairAssemblies: [{ stairElementId: 99, runAndLandingIds: [] }],
  } as unknown as ConvertResult;
  const envelope = {
    version: 1 as const,
    sourceModelSha256: "a".repeat(64),
    levels: [
      {
        levelId: 2,
        elevationFeet: 0,
        partsFeet: [[ring]],
        sourceElementIds: [101],
        cutElevationsFeet: [4, 8],
        evidenceSha256: "b".repeat(64),
      },
    ],
  };
  const data = {
    source: { modelSha256: envelope.sourceModelSha256 },
    nativeLevels: [
      { id: 1, elevationFeet: -1 },
      { id: 2, elevationFeet: 0 },
    ],
    walls: [],
    doors: [],
    records: [],
    nodes: [],
    edges: [],
    nativeIndoorEnvelopes: {
      ...envelope,
      geometrySha256: await nativeIndoorEnvelopeHash(envelope),
    },
    walkingSupport: {
      version: 1,
      sourceModelSha256: envelope.sourceModelSha256,
      floors: [{ nativeElementId: 101, elevationFeet: 0, ringsFeet: [ring] }],
    },
  } as unknown as IndoorDataset;
  const transition = {
    id: "local:test",
    kind: "local-steps" as const,
    evidence: "user-reported" as const,
    nativeStairId: 99,
    floorElementIds: [100, 101] as [number, number],
    endpoints: [
      { building: "B", levelId: 1, point: [2, 1] as [number, number] },
      { building: "B", levelId: 2, point: [8, 5] as [number, number] },
    ] as [
      { building: string; levelId: number; point: [number, number] },
      { building: string; levelId: number; point: [number, number] },
    ],
  };
  const ramp = {
    id: "ramp:test",
    nativeRampId: 50,
    floorElementIds: [100, 101] as [number, number],
    pointsFeet: [
      [2, 1, -1],
      [3, 5, 0],
    ] as [number, number, number][],
  };
  const review = {
    accessible: "yes",
    notes: "Original explicit owner review.",
    geometryKey: JSON.stringify([
      data.source.modelSha256,
      "ramp:test:upper",
      "local:local:test:1",
      ["landing:local:test:1"],
      [
        [3, 5, 0],
        [5, 5, 0],
        [8, 5, 0],
      ],
    ]),
  };
  return { model, data, input: { transition, ramp, review } };
}

test("original source recipe plus current physical evidence yields a nonmutating flatlanding proposal", async () => {
  const s = await setup(),
    before = JSON.stringify(s);
  const result = proveReviewedFlatLanding(s.model, s.data, s.input);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.nodeId, "local:local:test:1");
    assert.deepEqual(result.pointFeet, [8, 5, 0]);
    assert.equal(result.originalGeometryKey, s.input.review.geometryKey);
  }
  assert.equal(
    JSON.stringify(s),
    before,
    "no graph nodes, stair edges or positive metadata are created",
  );
});

test("stale review, missing source assembly, wrong floor and displaced source endpoint refuse recovery", async () => {
  for (const mutate of [
    (s: Awaited<ReturnType<typeof setup>>) => {
      s.input.review.geometryKey = s.input.review.geometryKey.replace(
        "a".repeat(64),
        "b".repeat(64),
      );
    },
    (s: Awaited<ReturnType<typeof setup>>) => {
      s.model.nativeStairAssemblies = [];
    },
    (s: Awaited<ReturnType<typeof setup>>) => {
      s.input.transition.floorElementIds[1] = 999;
    },
    (s: Awaited<ReturnType<typeof setup>>) => {
      s.input.transition.endpoints[1].point = [10, 5];
    },
    (s: Awaited<ReturnType<typeof setup>>) => {
      s.input.review.accessible = "unknown";
    },
  ]) {
    const s = await setup();
    mutate(s);
    assert.equal(proveReviewedFlatLanding(s.model, s.data, s.input).ok, false);
  }
});

test("a real hole in the original named slab cannot be filled by an old reviewed path", async () => {
  const s = await setup();
  s.model.elementBounds[0]!.loops!.push([
    [7.5, 4.5, 0],
    [8.5, 4.5, 0],
    [8.5, 5.5, 0],
    [7.5, 5.5, 0],
  ]);
  const result = proveReviewedFlatLanding(s.model, s.data, s.input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /slab\/holes/);
});

test("original overhead foreign material vetoes the full body even when the flat prepared floor is clear", async () => {
  const s = await setup();
  s.model.elementBounds.push({
    elementId: 200,
    categoryId: -2000011,
    boundsFeet: { min: { x: 6, y: 4.5, z: 2 }, max: { x: 7, y: 5.5, z: 3 } },
  } as never);
  const result = proveReviewedFlatLanding(s.model, s.data, s.input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.blockers, [200]);
  s.model.elementBounds.at(-1)!.boundsFeet.min.z = 7;
  s.model.elementBounds.at(-1)!.boundsFeet.max.z = 8;
  assert.equal(
    proveReviewedFlatLanding(s.model, s.data, s.input).ok,
    true,
    "a different floor's body above the complete existing headroom band remains separate",
  );
});

test("protected off-limits material remains a physical veto without altering any source restriction", async () => {
  const s = await setup();
  s.data.indoorExclusions = {
    version: 1,
    sourceModelSha256: s.data.source.modelSha256,
    areas: [
      {
        id: "restricted",
        reason: "off-limits",
        levelId: 2,
        elevationFeet: 0,
        label: "Protected lip",
        nativeFloorIds: [101],
        partsFeet: [
          [
            [
              [7, 4],
              [9, 4],
              [9, 6],
              [7, 6],
            ],
          ],
        ],
      },
    ],
  };
  const before = JSON.stringify(s.data.indoorExclusions);
  assert.equal(proveReviewedFlatLanding(s.model, s.data, s.input).ok, false);
  assert.equal(JSON.stringify(s.data.indoorExclusions), before);
});

test("a degenerate foreign physical panel is unresolved material rather than an empty obstacle", async () => {
  const s = await setup();
  s.model.elementBounds.push({
    elementId: 201,
    categoryId: -2000170,
    boundsFeet: { min: { x: 6, y: 4.5, z: 2 }, max: { x: 6, y: 5.5, z: 3 } },
  } as never);
  const result = proveReviewedFlatLanding(s.model, s.data, s.input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.blockers, [201]);
});

test("a reused original node ID or foreign room ownership cannot be replaced by the saved landing", async () => {
  const s = await setup();
  s.data.nodes.push({
    id: "local:local:test:1",
    roomKey: "another",
    levelId: 2,
    pointFeet: [8, 5, 0],
  } as never);
  assert.equal(proveReviewedFlatLanding(s.model, s.data, s.input).ok, false);
  s.data.nodes = [];
  s.data.records.push({
    key: "occupied-office",
    elevationFeet: 0,
    walkable: true,
    access: "unknown",
    circulation: false,
    ringsFeet: [
      [
        [7, 4],
        [9, 4],
        [9, 6],
        [7, 6],
      ],
    ],
  } as never);
  const result = proveReviewedFlatLanding(s.model, s.data, s.input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /independently owned/);
});

test("a fabricated material certificate cannot waive a real foreign body", async () => {
  const s = await setup();
  s.model.elementBounds.push({
    elementId: 200,
    categoryId: -2000023,
    boundsFeet: { min: { x: 6, y: 4, z: 1 }, max: { x: 7, y: 6, z: 5 } },
  } as never);
  const result = proveReviewedFlatLanding(s.model, s.data, s.input, [
    {
      nativeElementId: 200,
      sourceModelSha256: s.data.source.modelSha256,
      use: "foreign-material-envelope-only",
      components: [],
    } as never,
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /Unregistered/);
});

async function restorationSetup() {
  const s = await setup();
  const ring = [
    [2, 4],
    [4, 4],
    [4, 6],
    [2, 6],
  ] as [number, number][];
  s.data.records.push({
    key: "current-ramp-owner",
    number: "",
    name: "Current ramp upper landing",
    elevationEvidence: "Original named slab",
    building: "B",
    levelId: 2,
    elevationFeet: 0,
    surfaceId: "ramp-upper",
    circulation: true,
    stair: false,
    access: "unknown",
    walkable: true,
    confidence: 1,
    ringsFeet: [ring],
    properties: { nativeFloorId: 101 },
  });
  s.data.nodes.push({
    id: "ramp:test:upper",
    roomKey: "current-ramp-owner",
    levelId: 2,
    building: "B",
    surfaceId: "ramp-upper",
    kind: "connector",
    pointFeet: [3, 5, 0],
    geographic: [3, 5],
  });
  s.data.edges.push({
    id: "vertical-held",
    evidence: "Original held local stair",
    from: "a",
    to: "b",
    kind: "local-steps",
    pointsFeet: [
      [8, 5, -1],
      [8, 5, 0],
    ],
    roomKeys: [],
    lengthMetres: 0.3048,
    enabled: false,
    accessible: "no",
  });
  return s;
}

test("late flat-only preservation restores original source terminal while changed owners remain accessibility unknown", async () => {
  const s = await restorationSetup(),
    oldNodes = JSON.stringify(s.data.nodes),
    vertical = JSON.stringify(s.data.edges[0]);
  const result = preserveSourceReviewedFlatLanding(
    s.model,
    s.data,
    s.input,
    [],
    (p) => p,
  );
  assert.equal(result.applied, true);
  if (result.applied) {
    assert.equal(result.node.id, "local:local:test:1");
    assert.deepEqual(result.node.pointFeet, [8, 5, 0]);
    assert.equal(result.edge.accessible, "unknown");
    assert.equal(result.restoredAccessibilityReview, false);
    assert.deepEqual(result.edge.roomKeys, [
      "current-ramp-owner",
      "landing:local:test:1",
    ]);
    assert.deepEqual(
      result.edge.pointsFeet,
      JSON.parse(s.input.review.geometryKey)[4],
    );
    assert.equal(
      result.record.properties.originalReviewGeometryKey,
      s.input.review.geometryKey,
    );
  }
  assert.equal(JSON.stringify(s.data.nodes.slice(0, -1)), oldNodes);
  assert.equal(
    JSON.stringify(s.data.edges[0]),
    vertical,
    "the vertical held stair is unchanged",
  );
  assert.equal(
    preserveSourceReviewedFlatLanding(s.model, s.data, s.input, [], (p) => p)
      .applied,
    false,
    "duplicate identity is never inserted",
  );
});

test("flat preservation retains an explicit disabled review without approving its current approach", async () => {
  const s = await restorationSetup();
  const result = preserveSourceReviewedFlatLanding(
    s.model,
    s.data,
    { ...s.input, review: { ...s.input.review, enabled: false } },
    [],
    (p) => p,
  );
  assert.equal(result.applied, true);
  if (result.applied) {
    assert.equal(result.edge.enabled, false);
    assert.equal(result.edge.accessible, "unknown");
  }
});

test("late preservation refuses conflicting identities, changed actual ramp terminals and restricted owners without mutation", async () => {
  for (const change of [
    (s: Awaited<ReturnType<typeof restorationSetup>>) => {
      s.data.nodes[0]!.pointFeet[0] += 0.01;
    },
    (s: Awaited<ReturnType<typeof restorationSetup>>) => {
      s.data.records[0]!.access = "staff";
    },
    (s: Awaited<ReturnType<typeof restorationSetup>>) => {
      s.data.nodes.push({ ...s.data.nodes[0]!, id: "local:local:test:1" });
    },
    (s: Awaited<ReturnType<typeof restorationSetup>>) => {
      s.data.records.push({
        ...s.data.records[0]!,
        key: "landing:local:test:1",
      });
    },
    (s: Awaited<ReturnType<typeof restorationSetup>>) => {
      s.data.edges.push({ ...s.data.edges[0]!, id: "walk:ramp:test:upper" });
    },
  ]) {
    const s = await restorationSetup();
    change(s);
    const before = JSON.stringify(s.data);
    assert.equal(
      preserveSourceReviewedFlatLanding(s.model, s.data, s.input, [], (p) => p)
        .applied,
      false,
    );
    assert.equal(JSON.stringify(s.data), before);
  }
});

test("an unbounded inverted original source box cannot be mistaken for an absent body", async () => {
  const s = await setup();
  s.model.elementBounds.push({
    elementId: 202,
    categoryId: -2000170,
    boundsFeet: {
      min: { x: 1e30, y: 1e30, z: 1e30 },
      max: { x: -1e30, y: -1e30, z: -1e30 },
    },
  } as never);
  const r = proveReviewedFlatLanding(s.model, s.data, s.input);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.deepEqual(r.blockers, [202]);
    assert.match(r.reason, /Unclassified/);
  }
});

test("every positive material above the actual footplane blocks even below0.01ft", async () => {
  const s = await setup();
  s.model.elementBounds.push({
    elementId: 203,
    categoryId: -2000011,
    boundsFeet: {
      min: { x: 6, y: 4.5, z: 0 },
      max: { x: 7, y: 5.5, z: 0.005 },
    },
  } as never);
  const r = proveReviewedFlatLanding(s.model, s.data, s.input);
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.blockers, [203]);
});

test("foreign material beginning at the exact6ftheadroom boundary remains a closed contact", async () => {
  const s = await setup();
  s.model.elementBounds.push({
    elementId: 204,
    categoryId: -2000011,
    boundsFeet: { min: { x: 6, y: 4.5, z: 6 }, max: { x: 7, y: 5.5, z: 7 } },
  } as never);
  const r = proveReviewedFlatLanding(s.model, s.data, s.input);
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.blockers, [204]);
});

test("positive finite foreign box touching only the2ft strip side remains a closed contact", async () => {
  const s = await setup();
  s.model.elementBounds.push({
    elementId: 205,
    categoryId: -2000011,
    boundsFeet: { min: { x: 6, y: 6, z: 1 }, max: { x: 7, y: 7, z: 3 } },
  } as never);
  const r = proveReviewedFlatLanding(s.model, s.data, s.input);
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.blockers, [205]);
});
