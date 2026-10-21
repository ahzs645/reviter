import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  captureOriginalDoorStandingIdentityDemand,
  certifyOriginalDoorDerivedStanding,
  inspectOriginalDoorDerivedStanding,
  deriveOriginalDoorStandingRequest,
  type OriginalDoorDerivedStanding,
  type OriginalDoorStandingIdentityDemand,
} from "../lib/reviter/native-source-door-derived-standing.ts";
import { readOriginalOrdinaryDoorTypedFifo } from "../lib/reviter/native-source-ordinary-door-typed.ts";
import { readSchema } from "../lib/reviter/schema-reader.ts";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "../lib/reviter/revit-2027-grep-replay.ts";
import type { OriginalNativeForeignEnvelopeCensus } from "../lib/reviter/native-source-foreign-envelope-census.ts";
import type { OriginalNativeStairPhysicalContext } from "../lib/reviter/native-source-stair-physical-inventory.ts";
import {
  reconstructOriginalDoorDerivedStanding,
  type OriginalDoorDerivedStandingReplayRecipe,
} from "../lib/reviter/native-source-door-derived-standing-replay.ts";
const directory = new URL("./fixtures/", import.meta.url),
  model = "8c294549ee667ed7aba38f1f4f3a53514dae7544af97f0157ee8187dd8702178",
  hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex"),
  portal: [number, number, number] = [
    114.74448177496802, -122.88462533961184, 14.435695538057743,
  ],
  roomKey = "rm-694-504b25e5319a";
const fixture = (name: string) => readFileSync(new URL(name, directory));
function schema() {
  const b = fixture("native-drawing-reference-source-schema.bin");
  assert.equal(
    hash(b),
    "d961c44726fe7fc32bce4425639481a5d5e91acecec7b7fd897610fc369f046f",
  );
  const s = readSchema(b);
  assert(s.ok);
  return s.schema;
}
function graphics(id: number) {
  const b = fixture(
      id === 908922
        ? "native-original-door-908922.grep.bin"
        : "native-original-door-symbol-788064.grep.bin",
    ),
    v = new DataView(b.buffer, b.byteOffset, b.length),
    root = decodeRevit2027FramedGRepRoot(
      b,
      {
        offset: 0,
        elementId: id,
        marker: 2246,
        objectLength: v.getUint32(12, true),
        typeCode: v.getUint32(18, true),
      },
      2027,
    );
  assert(root.ok);
  const r = replayRevit2027GRepFifo(b, root.value);
  assert(r.ok);
  return r.value;
}
function baseline() {
  const own = {
      key: roomKey,
      levelId: 694,
      elevationFeet: portal[2],
      surfaceId: "03:694:14.436",
      building: "03",
      access: "unknown",
      walkable: true,
      stair: true,
      circulation: false,
      ringsFeet: [
        [
          [114.615, -125],
          [123, -125],
          [123, -107],
          [114.615, -107],
        ],
      ],
      properties: {},
    },
    door = {
      id: "door:694:908922",
      nativeElementId: 908922,
      hostWallNativeElementId: 735744,
      levelId: 694,
      roomKeys: [roomKey, "other"],
      state: "connected",
      pointFeet: [114.1655917415637, -122.64609347250845],
    },
    node = (id: string, kind: string, p: [number, number, number]) => ({
      id,
      kind,
      pointFeet: p,
      levelId: 694,
      roomKey,
      surfaceId: own.surfaceId,
      building: "03",
      geographic: [0, 0],
    });
  return {
    source: { modelSha256: model },
    records: [
      own,
      {
        ...own,
        key: "other",
        ringsFeet: [
          [
            [100, -125],
            [114, -125],
            [114, -107],
            [100, -107],
          ],
        ],
      },
    ],
    nativeLevels: [{ id: 694, elevationFeet: portal[2], name: "Floor 2" }],
    nodes: [
      node(`arrival:${roomKey}`, "arrival", [116, -111, portal[2]]),
      node("door:694:908922:0", "portal", portal),
      node("original-stair", "stair", [116, -111, portal[2]]),
    ],
    doors: [door],
    edges: [
      {
        id: door.id,
        kind: "door",
        nativeElementId: 908922,
        from: "door:694:908922:0",
        to: "other-portal",
        roomKeys: door.roomKeys,
      },
      {
        id: "original-stair-edge",
        kind: "stairs",
        nativeElementId: 2354630,
        roomKeys: [roomKey, "upper"],
      },
    ],
  };
}
function capture(data = baseline()) {
  const b = new TextEncoder().encode(JSON.stringify(data));
  return captureOriginalDoorStandingIdentityDemand(
    b,
    hash(b),
    model,
    roomKey,
    908922,
    "door:694:908922:0",
  );
}
test("complete original ordinary native instance and symbol retain every queued operand", () => {
  for (const [name, root, sha] of [
    [
      "native-original-door-908922.native.bin",
      "FamilyInstance",
      "b2607fb88371f2bd88493b8c8eab2b3b9ba46d15a567b37b0573e28087633c05",
    ],
    [
      "native-original-door-symbol-788064.native.bin",
      "FamilySymbol",
      "a242cb09e65603b8024fc685c41d5e71c4dabc086ef832416a89936171c88a53",
    ],
  ] as const) {
    const b = fixture(name);
    assert.equal(hash(b), sha);
    const r = readOriginalOrdinaryDoorTypedFifo(b, schema(), root);
    assert(r.ok);
    assert.equal(r.value.endOffset, b.length - 4);
    assert.equal(r.value.entries.length, root === "FamilyInstance" ? 7 : 51);
    if (root === "FamilyInstance") {
      assert.deepEqual(r.value.root.m_extraHostIds, [
        { m_id: { m_id64: 655196 } },
      ]);
      assert.equal(
        r.value.entries.find((e) => e.sourceClassName === "FamInstDoor")?.value
          .m_doorNumber,
        "344",
      );
    }
  }
});
test("unknown ordinary native ancestry, dynamic class, transient flags and truncated suffix refuse", () => {
  const b = fixture("native-original-door-908922.native.bin");
  assert.equal(
    readOriginalOrdinaryDoorTypedFifo(b.subarray(0, b.length - 1), schema()).ok,
    false,
  );
  for (const change of [
    (s: ReturnType<typeof schema>) => {
      s.classes.find((c) => c.name === "FamInstDoor")!.name =
        "UnknownDoorOperation";
    },
    (s: ReturnType<typeof schema>) => {
      s.classes
        .find((c) => c.name === "FamilyInstance")!
        .properties.find((p) => p.name === "m_rehostInstance")!.unknownWord = 3;
    },
    (s: ReturnType<typeof schema>) => {
      s.classes.find((c) => c.name === "FamilyInstance")!.name =
        "ForeignFamilyInstance";
    },
  ]) {
    const s = schema();
    change(s);
    assert.equal(readOriginalOrdinaryDoorTypedFifo(b, s).ok, false);
  }
});
test("actual original finite material derives the bounded request without changing the own portal or omitting a body", () => {
  const a = graphics(908922),
    b = graphics(788064),
    before = [...portal],
    r = deriveOriginalDoorStandingRequest(a, b, portal, 51);
  assert.deepEqual(
    r.requestedPointFeet,
    [115.52976496991015, -122.88462533961184, 14.435695538057743],
  );
  assert.deepEqual(portal, before);
  assert.equal(r.sourceAuthorityGranted, false);
  assert.equal(r.sourceSide, "positive-Y");
  assert.throws(
    () => deriveOriginalDoorStandingRequest(a, b, portal, 999999),
    /absent/,
  );
  assert.throws(
    () =>
      deriveOriginalDoorStandingRequest(
        a,
        b,
        [114.2655917415637, -122.64609347250845, portal[2]],
        51,
      ),
    /does not establish/,
  );
});
test("checked identity demand preserves unknown access and refuses checksum, duplicate place/portal/door and served-level ambiguity", () => {
  assert.equal(capture().scope, "original-door-owner-identity-demand-only");
  const d = baseline(),
    b = new TextEncoder().encode(JSON.stringify(d));
  assert.throws(
    () =>
      captureOriginalDoorStandingIdentityDemand(
        b,
        "0".repeat(64),
        model,
        roomKey,
        908922,
        "door:694:908922:0",
      ),
    /bytes differ/,
  );
  for (const mutate of [
    (x: ReturnType<typeof baseline>) => {
      x.records.push(structuredClone(x.records[0]!));
    },
    (x: ReturnType<typeof baseline>) => {
      x.nodes.push(structuredClone(x.nodes[1]!));
    },
    (x: ReturnType<typeof baseline>) => {
      x.doors.push({
        ...x.doors[0]!,
        id: "another-native-door",
        nativeElementId: 908923,
      });
    },
    (x: ReturnType<typeof baseline>) => {
      x.nativeLevels[0]!.elevationFeet += 1;
    },
  ]) {
    const x = baseline();
    mutate(x);
    assert.throws(() => capture(x));
  }
});
test("detached graph or physical receipts cannot mint an original standing capability", () => {
  const demand = capture(),
    fakeCensus = {
      sourceModelSha256: model,
    } as OriginalNativeForeignEnvelopeCensus,
    fakeStair = {} as OriginalNativeStairPhysicalContext,
    request = {
      nativeRunId: 2354663,
      originalMaterialReferenceGeometryToken: 51,
      nativeFloorElementId: 400479,
      originalCapFaceToken: 5,
    };
  assert.throws(
    () =>
      certifyOriginalDoorDerivedStanding(
        fakeCensus,
        fakeStair,
        demand,
        request,
      ),
    /Untrusted original foreign/,
  );
  assert.throws(
    () =>
      certifyOriginalDoorDerivedStanding(
        fakeCensus,
        fakeStair,
        structuredClone(demand) as OriginalDoorStandingIdentityDemand,
        request,
      ),
    /Checked original door identity/,
  );
  assert.throws(
    () =>
      inspectOriginalDoorDerivedStanding({
        sourceModelSha256: model,
        completeStandingAndShortApproachPhysicalPredicatesPassed: true,
      } as unknown as OriginalDoorDerivedStanding),
    /source-issued/,
  );
});
test("original-byte reconstruction rejects malformed locators and substituted RVT bytes before issuing any authority", () => {
  const recipe: OriginalDoorDerivedStandingReplayRecipe = {
    version: 1,
    roomKey,
    nativeDoorElementId: 908922,
    originalPortalNodeId: "door:694:908922:0",
    nativeDoorDefinitionElementId: 788064,
    nativeOwnStairElementId: 2354630,
    nativeStairDefinitionElementId: 2354664,
    standing: {
      nativeRunId: 2354663,
      originalMaterialReferenceGeometryToken: 51,
      nativeFloorElementId: 400479,
      originalCapFaceToken: 5,
    },
    foreignScopeBoundsFeet: {
      min: { x: 110, y: -129, z: 12 },
      max: { x: 126, y: -106, z: 23 },
    },
    requestedAdditionalOriginalFrameIds: [735744, 655196],
  };
  const fake = new Uint8Array([1, 2, 3]);
  assert.throws(
    () =>
      reconstructOriginalDoorDerivedStanding(
        fake,
        model,
        fake,
        "0".repeat(64),
        recipe,
      ),
    /model bytes differ/,
  );
  assert.throws(
    () =>
      reconstructOriginalDoorDerivedStanding(
        fake,
        model,
        fake,
        "0".repeat(64),
        { ...recipe, nativeDoorDefinitionElementId: -1 },
      ),
    /Malformed/,
  );
});
