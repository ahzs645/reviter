import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readSchema } from "../lib/reviter/schema-reader.ts";
import { readNativeStairTypedFifo } from "../lib/reviter/native-stair-typed-fifo.ts";
import {
  captureOriginalStairBaseIdentityDemand,
  deriveOriginalStairBaseStandingRequest,
  certifyOriginalSourceStairBaseStanding,
  originalSourceStairBaseStandingFacts,
} from "../lib/reviter/native-source-stair-base-standing.ts";
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex"),
  model = "a".repeat(64);
function baseline() {
  return {
    source: { modelSha256: model },
    records: [
      {
        key: "own",
        stair: true,
        walkable: true,
        access: "unknown",
        levelId: 1,
        surfaceId: "floor1",
        elevationFeet: 0,
      },
    ],
    nodes: [
      {
        id: "arrival:own",
        kind: "arrival",
        roomKey: "own",
        levelId: 1,
        surfaceId: "floor1",
        pointFeet: [0, 0, 0],
      },
      {
        id: "stair:own",
        kind: "stair",
        roomKey: "own",
        levelId: 1,
        surfaceId: "floor1",
        pointFeet: [0, 0, 0],
      },
    ],
    edges: [
      {
        id: "held",
        kind: "stairs",
        nativeElementId: 10,
        from: "stair:own",
        to: "other",
        roomKeys: ["own", "other"],
        enabled: false,
      },
    ],
  };
}
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
function originalRun() {
  const schema = readSchema(
    readFileSync(
      new URL(
        "./fixtures/native-drawing-reference-source-schema.bin",
        import.meta.url,
      ),
    ),
  );
  assert(schema.ok);
  const r = readNativeStairTypedFifo(
    readFileSync(
      new URL(
        "./fixtures/native-original-stair-run-2474572.4102.bin",
        import.meta.url,
      ),
    ),
    schema.schema,
  );
  assert(r.ok);
  return r.value;
}
test("a checked original held native edge binds identity without inventing cell ownership or source authority", () => {
  const b = bytes(baseline()),
    identity = captureOriginalStairBaseIdentityDemand(
      b,
      hash(b),
      model,
      "own",
      10,
    );
  assert.equal(identity.originalDatasetSha256, hash(b));
  assert.throws(
    () =>
      certifyOriginalSourceStairBaseStanding(
        structuredClone(identity),
        {} as never,
        { nativeRunId: 20, nativeFloorElementId: 100, originalCapFaceToken: 5 },
      ),
    /Untrusted/,
  );
  assert.throws(() =>
    certifyOriginalSourceStairBaseStanding(identity, {} as never, {
      nativeRunId: 20,
      nativeFloorElementId: 100,
      originalCapFaceToken: 5,
    }),
  );
  assert.throws(
    () => originalSourceStairBaseStandingFacts({} as never),
    /Untrusted/,
  );
});
test("changed checksum, source, own native edge, terminal and public policy identities cannot be substituted", () => {
  const b = bytes(baseline());
  assert.throws(() =>
    captureOriginalStairBaseIdentityDemand(b, "b".repeat(64), model, "own", 10),
  );
  for (const mutate of [
    (d: ReturnType<typeof baseline>) => {
      d.source.modelSha256 = "b".repeat(64);
    },
    (d: ReturnType<typeof baseline>) => {
      d.edges[0]!.nativeElementId = 11;
    },
    (d: ReturnType<typeof baseline>) => {
      d.nodes[1]!.pointFeet = [1, 0, 0];
    },
    (d: ReturnType<typeof baseline>) => {
      d.edges[0]!.enabled = true;
    },
    (d: ReturnType<typeof baseline>) => {
      d.edges.push({ ...d.edges[0]! });
    },
  ]) {
    const d = baseline();
    mutate(d);
    const raw = bytes(d);
    assert.throws(() =>
      captureOriginalStairBaseIdentityDemand(raw, hash(raw), model, "own", 10),
    );
  }
});
test("the original finite run anchors a deterministic request and preserves every literal source operand", () => {
  const run = originalRun(),
    before = JSON.stringify(run),
    r = deriveOriginalStairBaseStandingRequest(run);
  assert(r.pointFeet.every(Number.isFinite));
  assert.equal(r.pointFeet[2], run.root.m_bottomElevation);
  assert.equal(r.originalAuthoredPoint, false);
  assert.equal(r.requestedOutsetFeet, 1 + r.originalFirstTreadDepthFeet);
  assert.equal(JSON.stringify(run), before);
});
test("zero directions, missing source starts and unsupported initial rise cannot produce a standing request", () => {
  for (const mutate of [
    (r: ReturnType<typeof originalRun>) => {
      r.root.m_beginWithRiser = 0;
    },
    (r: ReturnType<typeof originalRun>) => {
      r.root.m_oStartRiser = { token: 0 };
    },
    (r: ReturnType<typeof originalRun>) => {
      r.entries.find(
        (e) => e.sourceClassName === "StairsTreadInfo",
      )!.value.m_runDirProj = [0, 0, 0];
    },
    (r: ReturnType<typeof originalRun>) => {
      r.entries.find(
        (e) => e.sourceClassName === "StairsTreadInfo",
      )!.value.m_actDepth = -1;
    },
  ]) {
    const run = originalRun();
    mutate(run);
    assert.throws(() => deriveOriginalStairBaseStandingRequest(run));
  }
});
test("an explicit integer tread setback stays anchored to the original base and cannot range beyond its finite source span", () => {
  const run = originalRun(),
    before = JSON.stringify(run),
    first = deriveOriginalStairBaseStandingRequest(run),
    second = deriveOriginalStairBaseStandingRequest(run, 2);
  assert.equal(second.outsetTreadDepthMultiple, 2);
  assert.equal(second.pointFeet[2], first.pointFeet[2]);
  assert.equal(
    second.requestedOutsetFeet,
    1 + 2 * second.originalFirstTreadDepthFeet,
  );
  assert(second.requestedOutsetFeet <= second.sourceBaseSpanMaxComponentFeet);
  assert.notDeepEqual(second.pointFeet, first.pointFeet);
  assert.equal(JSON.stringify(run), before);
  for (const multiple of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER])
    assert.throws(() => deriveOriginalStairBaseStandingRequest(run, multiple));
});
test("an original corridor approach binds its own graph identity and cannot use staff, wrong-plane or unconnected alternatives", () => {
  const source = baseline();
  source.records.push({ ...source.records[0]!, key: "hall", stair: false, circulation: true } as typeof source.records[number]);
  source.nodes.push({ ...source.nodes[0]!, id: "hall-arrival", roomKey: "hall", pointFeet: [2, 0, 0] });
  source.edges.push({ ...source.edges[0]!, id: "hall-walk", kind: "walk", nativeElementId: 11, from: "hall-arrival", to: "other", roomKeys: ["hall"], enabled: true });
  const raw = bytes(source), handle = captureOriginalStairBaseIdentityDemand(raw, hash(raw), model, "own", 10, { approachNodeId: "hall-arrival" });
  assert.throws(() => certifyOriginalSourceStairBaseStanding(handle, {} as never, { nativeRunId: 20, nativeFloorElementId: 100, originalCapFaceToken: 5 }), /approach lacks checked recorded intent/);
  for (const mutate of [
    (d: typeof source) => { d.records[1]!.access = "staff"; },
    (d: typeof source) => { d.nodes[2]!.pointFeet[2] = 0.001; },
    (d: typeof source) => { d.edges[1]!.enabled = false; },
    (d: typeof source) => { d.nodes[2]!.surfaceId = "other-floor"; },
  ]) {
    const changed = structuredClone(source); mutate(changed);
    const input = bytes(changed);
    assert.throws(() => captureOriginalStairBaseIdentityDemand(input, hash(input), model, "own", 10, { approachNodeId: "hall-arrival" }), /approach node\/room\/policy/);
  }
});
