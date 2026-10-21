import test from "node:test";
import assert from "node:assert/strict";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
import { attachOriginalDoorDerivedStanding, applyOriginalDoorDerivedStandingArrival } from "../lib/reviter/native-door-derived-standing-integration.ts";
import type { OriginalDoorDerivedStanding } from "../lib/reviter/native-source-door-derived-standing.ts";

test("saved source flags or detached receipts cannot insert a standing node or adopt an arrival", () => {
  const data = { nodes: [], edges: [], records: [] } as unknown as IndoorDataset;
  const before = JSON.stringify(data);
  for (const source of [{}, { sourceModelSha256: "a".repeat(64), completeStandingAndShortApproachPhysicalPredicatesPassed: true }]) {
    assert.throws(() => attachOriginalDoorDerivedStanding(data, source as unknown as OriginalDoorDerivedStanding, () => { throw Error("Projection must never be reached"); }), /source-issued/);
  }
  assert.throws(() => applyOriginalDoorDerivedStandingArrival(data, {} as never, "room", { checked: 1, rerouted: [], disabled: [] }), /same-compiler/);
  assert.equal(JSON.stringify(data), before);
});
