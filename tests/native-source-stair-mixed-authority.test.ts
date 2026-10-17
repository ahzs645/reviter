import assert from "node:assert/strict";
import test from "node:test";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import { prepareNativeSourceStairReceipts } from "../lib/reviter/native-source-stair-receipts.ts";

type P2 = [number, number];
type P3 = [number, number, number];
const ring = (left: number, right: number): P2[] => [
  [left, 0], [right, 0], [right, 3], [left, 3],
];

function mixedRunFixture() {
  const treads = [0, 1, 2, 3].map((i) => ({
    runElementId: i < 2 ? 201 : 202,
    elevationFeet: (i + 1) * 0.5,
    ringFeet: ring(i + 0.5, i + 1.5),
  }));
  const positions = treads.slice(0, 2).flatMap((t) =>
    t.ringFeet.flatMap(([x, y]) => [x, y, t.elevationFeet]),
  );
  const sourceRun = (id: number) => ({
    elementId: id,
    categoryId: -2000919,
    boundsFeet: {
      min: { x: id === 201 ? 0.5 : 2.5, y: 0, z: id === 201 ? 0 : 1 },
      max: { x: id === 201 ? 2.5 : 4.5, y: 3, z: id === 201 ? 1 : 2.5 },
    },
    stairTreads: treads.filter((t) => t.runElementId === id).map((t) =>
      t.ringFeet.map(([x, y]): P3 => [x, y, t.elevationFeet]),
    ),
  });
  const floor = (id: number, elevation: number, left: number, right: number) => ({
    elementId: id,
    categoryId: -2000032,
    boundsFeet: {
      min: { x: left, y: 0, z: elevation - 0.1 },
      max: { x: right, y: 3, z: elevation },
    },
    loops: [ring(left, right).map(([x, y]): P3 => [x, y, elevation])],
  });
  const model = {
    origin: { x: 0, y: 0, z: 0 },
    levels: [{ levelId: 1, elevation: 0 }, { levelId: 2, elevation: 2.5 }],
    nativeStairAssemblies: [{ stairElementId: 200, runAndLandingIds: [201, 202] }],
    elementBounds: [floor(300, 0, 0, 0.5), floor(301, 2.5, 4.5, 5.5), sourceRun(201), sourceRun(202)],
    meshes: [{
      source: "native-brep",
      positions,
      indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
      elementIds: [201, 201, 201, 201],
    }],
  } as unknown as ConvertResult;
  const data = {
    source: { modelSha256: "a".repeat(64) },
    stairDisplay: {
      sourceFlights: [{
        stairElementId: 200,
        levelIds: [1, 2],
        treads: structuredClone(treads),
        runs: [
          { runElementId: 201, bottomElevationFeet: 0, topElevationFeet: 1 },
          { runElementId: 202, bottomElevationFeet: 1, topElevationFeet: 2.5 },
        ],
        landings: [],
      }],
    },
  } as unknown as IndoorDataset;
  return { model, data };
}

test("source authority is selected separately for BRep and original-profile sibling runs", () => {
  const { model, data } = mixedRunFixture();
  const before = JSON.stringify([model, data]);
  const result = prepareNativeSourceStairReceipts(model, data);
  assert.equal(result.receipts.length, 1);
  assert.deepEqual(result.receipts[0]!.nativeRunIds, [201, 202]);
  assert.equal(result.receipts[0]!.treads.length, 4);
  assert.equal(result.foreignMaterialOrEnclosureApproved, false);
  assert.equal(result.walkingBodyApproved, false);
  assert.equal(JSON.stringify([model, data]), before);
});

for (const runId of [201, 202]) {
  test(`a prepared mismatch in original run ${runId} is rejected without falling back or dropping the sibling`, () => {
    const { model, data } = mixedRunFixture();
    data.stairDisplay!.sourceFlights![0]!.treads.find((t) => t.runElementId === runId)!.ringFeet[0]![0] += 0.001;
    const before = JSON.stringify(model);
    const result = prepareNativeSourceStairReceipts(model, data);
    assert.equal(result.receipts.length, 0);
    assert.match(result.diagnostics[0]!.reason, /exact independently replayed original/);
    assert.equal(JSON.stringify(model), before);
  });
}

test("a sibling run without any original owned profile cannot borrow another run's BRep authority", () => {
  const { model, data } = mixedRunFixture();
  delete model.elementBounds.find((r) => r.elementId === 202)!.stairTreads;
  const result = prepareNativeSourceStairReceipts(model, data);
  assert.equal(result.receipts.length, 0);
  assert.match(result.diagnostics[0]!.reason, /exact independently replayed original/);
});

test("a duplicate prepared tread cannot replace a missing original tread even when counts and individual membership match", () => {
  const { model, data } = mixedRunFixture();
  const flight = data.stairDisplay!.sourceFlights![0]!;
  // Wide overlapping native walking tops let the old membership-only check
  // produce a receipt after skipping a middle original tread. Neither a later
  // strip-containment test nor visiting every prepared tread detects the loss.
  const upperTreads = [2, 3, 4, 5].map((i) => ({
    runElementId: 202,
    elevationFeet: (i + 1) * 0.5,
    ringFeet: ring(i - 0.5, i + 2.5),
  }));
  const upperRun = model.elementBounds.find((r) => r.elementId === 202)!;
  upperRun.stairTreads = upperTreads.map((t) => t.ringFeet.map(([x, y]): P3 => [x, y, t.elevationFeet]) as [P3, P3, P3, P3]);
  upperRun.boundsFeet.max.x = 7.5;
  upperRun.boundsFeet.max.z = 3.5;
  const upperFloor = model.elementBounds.find((r) => r.elementId === 301)!;
  upperFloor.boundsFeet = { min: { x: 7.5, y: 0, z: 3.4 }, max: { x: 8.5, y: 3, z: 3.5 } };
  upperFloor.loops = [ring(7.5, 8.5).map(([x, y]): P3 => [x, y, 3.5])];
  model.levels[1]!.elevation = 3.5;
  flight.runs![1]!.topElevationFeet = 3.5;
  flight.treads = [...flight.treads.slice(0, 2), ...upperTreads];
  flight.treads[2] = structuredClone(flight.treads[3]!);
  const before = JSON.stringify([model, data]);
  const result = prepareNativeSourceStairReceipts(model, data);
  assert.equal(result.receipts.length, 0);
  assert.match(result.diagnostics[0]!.reason, /exact independently replayed original/);
  assert.equal(JSON.stringify([model, data]), before);
});

function sourceGapFixture() {
  const { model, data } = mixedRunFixture();
  const flight = data.stairDisplay!.sourceFlights![0]!;
  for (const tread of flight.treads.filter((t) => t.runElementId === 202)) for (const p of tread.ringFeet) p[0] += 1;
  const run = model.elementBounds.find((e) => e.elementId === 202)!;
  for (const tread of run.stairTreads!) for (const p of tread) p[0] += 1;
  for (const record of [run, model.elementBounds.find((e) => e.elementId === 301)!]) {
    record.boundsFeet.min.x += 1; record.boundsFeet.max.x += 1;
    for (const loop of record.loops ?? []) for (const p of loop) p[0] += 1;
  }
  const landing = { nativeElementId: 999, elevationFeet: 1.25, thicknessFeet: 0.1, ringsFeet: [ring(2.5, 3.5)] };
  return { model, data, flight, landing };
}

test("a fabricated prepared landing cannot supply positive support across an original gap", () => {
  const { model, data, flight, landing } = sourceGapFixture();
  flight.landings = [landing];
  const before = JSON.stringify([model, data]);
  const result = prepareNativeSourceStairReceipts(model, data);
  assert.equal(result.receipts.length, 0);
  assert.match(result.diagnostics[0]!.reason, /landing.*original native geometry.*ownership/);
  assert.equal(JSON.stringify([model, data]), before);
});

function nativeLandingGapFixture() {
  const f = sourceGapFixture();
  f.flight.landings = [f.landing];
  f.model.elementOwnership = { records: [{ elementId: 999, owningElementId: 200, byteOffset: 0 }] } as ConvertResult["elementOwnership"];
  f.model.elementBounds.push({
    elementId: 999, categoryId: -2000920,
    boundsFeet: { min: { x: 2.5, y: 0, z: 1.15 }, max: { x: 3.5, y: 3, z: 1.25 } },
  } as ConvertResult["elementBounds"][number]);
  f.model.meshes.push({
    name: "original-landing", colors: new Float32Array(), materialIndex: 0,
    source: "native-brep", positions: new Float32Array(f.landing.ringsFeet[0]!.flatMap(([x, y]) => [x, y, 1.25])),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]), elementIds: new Uint32Array([999, 999]),
  });
  // Use the independently measured original thickness, not a rounded literal.
  f.landing.thicknessFeet = 1.25 - 1.15;
  return f;
}

test("an original owner-backed native landing may support the same source gap without granting body approval", () => {
  const { model, data } = nativeLandingGapFixture();
  const result = prepareNativeSourceStairReceipts(model, data);
  assert.equal(result.receipts.length, 1);
  assert.equal(result.walkingBodyApproved, false);
});

test("changed prepared landing geometry or contradictory original ownership cannot borrow native landing authority", () => {
  for (const mutation of ["profile", "height", "thickness", "foreign-owner", "conflicting-owner"] as const) {
    const { model, data, landing } = nativeLandingGapFixture();
    if (mutation === "profile") landing.ringsFeet[0]![0]![0] -= 0.001;
    if (mutation === "height") landing.elevationFeet += 0.001;
    if (mutation === "thickness") landing.thicknessFeet += 0.001;
    if (mutation === "foreign-owner") model.elementOwnership!.records[0]!.owningElementId = 888;
    if (mutation === "conflicting-owner") model.elementOwnership!.records.push({ elementId: 999, owningElementId: 888, byteOffset: 0 });
    const result = prepareNativeSourceStairReceipts(model, data);
    assert.equal(result.receipts.length, 0, mutation);
    assert.match(result.diagnostics[0]!.reason, /landing.*original native geometry.*ownership/);
  }
});

test("a fabricated prepared support face cannot bridge a gap using an actual run identity", () => {
  const { model, data, flight, landing } = sourceGapFixture();
  flight.supportFaces = [{ runElementId: 201, elevationFeet: landing.elevationFeet, ringFeet: landing.ringsFeet[0]! }];
  const before = JSON.stringify([model, data]);
  const result = prepareNativeSourceStairReceipts(model, data);
  assert.equal(result.receipts.length, 0);
  assert.match(result.diagnostics[0]!.reason, /support face.*original owned native run geometry/);
  assert.equal(JSON.stringify([model, data]), before);
});

test("an original run support face must preserve its actual owner, height and full source trim", () => {
  for (const mutation of ["valid", "profile", "height", "foreign-owner"] as const) {
    const { model, data } = mixedRunFixture();
    const tread = data.stairDisplay!.sourceFlights![0]!.treads[0]!;
    const face = { runElementId: tread.runElementId, elevationFeet: tread.elevationFeet, ringFeet: structuredClone(tread.ringFeet) };
    data.stairDisplay!.sourceFlights![0]!.supportFaces = [face];
    if (mutation === "profile") face.ringFeet[0]![0] -= 0.001;
    if (mutation === "height") face.elevationFeet += 0.001;
    if (mutation === "foreign-owner") face.runElementId = 999;
    const result = prepareNativeSourceStairReceipts(model, data);
    assert.equal(result.receipts.length, mutation === "valid" ? 1 : 0, mutation);
    if (mutation !== "valid") assert.match(result.diagnostics[0]!.reason, /support face.*original owned native run geometry/);
  }
});
