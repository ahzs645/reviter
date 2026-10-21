import test from "node:test";
import assert from "node:assert/strict";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
import {
  attachOriginalStairBaseDerivedStanding,
  applyOriginalStairBaseDerivedStandingArrival,
} from "../lib/reviter/native-stair-base-derived-standing-integration.ts";
import type { OriginalSourceStairBaseStanding } from "../lib/reviter/native-source-stair-base-standing.ts";

test("detached source-base facts and saved flags cannot insert or apply an arrival", () => {
  const data = {
    nodes: [],
    edges: [],
    records: [],
  } as unknown as IndoorDataset;
  const before = JSON.stringify(data);
  for (const source of [
    {},
    {
      fullSourceFiniteApproachQualified: true,
      originalRecordedIntentAndNativeBaseCorrespondenceQualified: true,
      completeTwoFootSixFootStandingSourcePredicatesPassed: true,
      proposedNode: { id: "forged-arrival" },
    },
  ]) {
    assert.throws(
      () =>
        attachOriginalStairBaseDerivedStanding(
          data,
          source as unknown as OriginalSourceStairBaseStanding,
          () => {
            throw Error("Projection must never be reached");
          },
        ),
      /Live original source/,
    );
  }
  assert.throws(
    () =>
      applyOriginalStairBaseDerivedStandingArrival(data, {} as never, "room", {
        checked: 1,
        rerouted: [],
        disabled: [],
      }),
    /same-compiler/,
  );
  assert.equal(JSON.stringify(data), before);
});
