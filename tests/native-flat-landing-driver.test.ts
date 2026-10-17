import test from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  createSourceReviewedFlatLandingDriver,
  discoverSourceReviewedFlatLandings,
} from "../lib/reviter/native-flat-landing-driver.ts";
import type { RoomDirectoryData } from "../lib/reviter/room-directory.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";

function source() {
  const bytes = Uint8Array.of(1, 4, 9),
    sha = bytesToHex(sha256(bytes));
  const ramp = {
    id: "ramp:source-X",
    nativeRampId: 502,
    floorElementIds: [101, 102],
    pointsFeet: [
      [1, 2, -1],
      [4, 5, 0],
    ],
  };
  const transition = {
    id: "local:source-Y",
    nativeStairId: 904,
    kind: "local-steps",
    evidence: "user-reported",
    floorElementIds: [101, 102],
    endpoints: [
      {
        building: "First",
        levelId: 11,
        point: [1, 2],
        roomKey: "real-lower-room",
      },
      { building: "Second", levelId: 12, point: [8, 5] },
    ],
  };
  const key = JSON.stringify([
    sha,
    "ramp:source-X:upper",
    "local:local:source-Y:1",
    ["landing:local:source-Y:1"],
    [
      [4, 5, 0],
      [6, 5, 0],
      [8, 5, 0],
    ],
  ]);
  const rooms = {
    format: "reviter-room-annotations",
    version: 1,
    coordinateSystem: "revit-model-feet",
    model: { fileName: "Original.rvt" },
    annotations: [],
    georeference: {
      format: "reviter-georeference",
      version: 1,
      modelFileName: "Original.rvt",
      coordinateSystem: "WGS84",
      method: "fixed-scale",
      points: [
        {
          id: "a",
          name: "A",
          levelId: 11,
          modelFeet: [0, 0],
          geographic: { longitude: -123, latitude: 54 },
        },
        {
          id: "b",
          name: "B",
          levelId: 11,
          modelFeet: [100, 0],
          geographic: { longitude: -122.9995, latitude: 54 },
        },
      ],
    },
    indoorRamps: { version: 1, sourceModelSha256: sha, ramps: [ramp] },
    buildingTransitions: [transition],
    indoorReviews: {
      edges: {
        "walk:ramp:source-X:upper": {
          accessible: "yes",
          notes: "Explicit original owner review",
          geometryKey: key,
        },
      },
    },
  } as unknown as RoomDirectoryData;
  return { bytes, sha, rooms, key };
}

test("driver discovers only exact source-owned review/ramp/unnamed-landing identities with no campus IDs", () => {
  const s = source(),
    before = JSON.stringify(s.rooms),
    found = discoverSourceReviewedFlatLandings(s.rooms, s.sha);
  assert.equal(found.candidates.length, 1);
  assert.deepEqual(found.refused, []);
  assert.equal(found.candidates[0]!.input.transition.nativeStairId, 904);
  assert.equal(found.candidates[0]!.input.ramp.nativeRampId, 502);
  assert.equal(found.candidates[0]!.input.review.geometryKey, s.key);
  found.candidates[0]!.input.ramp.pointsFeet[0]![0] = 999;
  assert.equal(
    JSON.stringify(s.rooms),
    before,
    "discovered recipes cannot mutate original annotations",
  );
});

test("changed model, named unrelated endpoint and duplicate recipes cannot be restored by proximity", () => {
  for (const edit of [
    (r: RoomDirectoryData) => {
      (r.indoorRamps as { sourceModelSha256: string }).sourceModelSha256 =
        "b".repeat(64);
    },
    (r: RoomDirectoryData) => {
      r.buildingTransitions![0]!.endpoints[1].roomKey = "unrelated-room";
    },
    (r: RoomDirectoryData) => {
      r.buildingTransitions!.push(structuredClone(r.buildingTransitions![0]!));
    },
    (r: RoomDirectoryData) => {
      const reviews = r.indoorReviews as {
        edges: Record<string, { geometryKey: string }>;
      };
      reviews.edges["walk:ramp:source-X:upper"]!.geometryKey = "[]";
    },
  ]) {
    const s = source();
    edit(s.rooms);
    const found = discoverSourceReviewedFlatLandings(s.rooms, s.sha);
    assert.equal(found.candidates.length, 0);
    assert.ok(found.refused.length);
  }
});

test("matching a fabricated byte hash does not establish an actual original RVT/schema context", () => {
  const s = source(),
    model = { elementBounds: [] } as unknown as ConvertResult;
  const driver = createSourceReviewedFlatLandingDriver({
    originalModelBytes: s.bytes,
    expectedSourceModelSha256: s.sha,
    nativeModel: model,
    rooms: s.rooms,
  });
  assert.equal(driver.initializationReceipt.sourceContextReceipt, undefined);
  assert.ok(
    driver.initializationReceipt.refused.some(
      (r) => r.edgeId === "source-context",
    ),
  );
  const data = {
    source: { modelSha256: s.sha },
    records: [],
    nodes: [],
    edges: [],
  } as unknown as IndoorDataset;
  const before = JSON.stringify(data),
    result = driver.beforeNativeCirculation(model, data);
  assert.equal(result[0]!.applied, false);
  assert.equal(JSON.stringify(data), before);
  result[0]!.reason = "caller changed its receipt";
  assert.notEqual(
    (driver.receipts()[0] as { reason: string }).reason,
    result[0]!.reason,
  );
});

test("source identity and georeference are prerequisites, and another current model is refused", () => {
  const s = source(),
    model = { elementBounds: [] } as unknown as ConvertResult;
  assert.throws(
    () =>
      createSourceReviewedFlatLandingDriver({
        originalModelBytes: s.bytes,
        expectedSourceModelSha256: "c".repeat(64),
        nativeModel: model,
        rooms: s.rooms,
      }),
    /identity/,
  );
  const noGeo = structuredClone(s.rooms);
  delete noGeo.georeference;
  assert.throws(
    () =>
      createSourceReviewedFlatLandingDriver({
        originalModelBytes: s.bytes,
        expectedSourceModelSha256: s.sha,
        nativeModel: model,
        rooms: noGeo,
      }),
    /georeference/,
  );
  const driver = createSourceReviewedFlatLandingDriver({
    originalModelBytes: s.bytes,
    expectedSourceModelSha256: s.sha,
    nativeModel: model,
    rooms: s.rooms,
  });
  const result = driver.beforeNativeCirculation(model, {
    source: { modelSha256: "d".repeat(64) },
  } as IndoorDataset);
  assert.equal(result[0]!.applied, false);
  assert.match(result[0]!.reason ?? "", /different original model/);
});
