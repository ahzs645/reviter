import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareIndoorStairDisplay } from "../lib/reviter/indoor-stair-display.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
const native = (): ConvertResult =>
  JSON.parse(
    readFileSync(
      new URL("./fixtures/native-turning-stair.json", import.meta.url),
      "utf8",
    ),
  );
test("native turning staircase export includes its omitted owned platform and closes both run endpoints", () => {
  const model = native(),
    data = {
      source: { modelSha256: "native" },
      records: [],
    } as unknown as IndoorDataset;
  const before = JSON.stringify(data);
  const flight = prepareIndoorStairDisplay(model, data).sourceFlights![0]!;
  assert.equal(flight.stairElementId, 2474568);
  assert.equal(flight.landings!.length, 1);
  assert.equal(flight.landings![0]!.nativeElementId, 2474574);
  assert.equal(flight.landings![0]!.ringsFeet[0]!.length, 7);
  assert.equal(flight.landings![0]!.elevationFeet, 10.717410323709537);
  const returning = flight.treads.filter((t) => t.runElementId === 2474572);
  assert.equal(returning.length, 5);
  assert.ok(Math.abs(returning[0]!.elevationFeet - 11.3371) < 0.0001);
  assert.equal(flight.runs!.length, 2);
  assert.equal(flight.runs![1]!.topElevationFeet, 14.435695538057743);
  assert.equal(flight.sourceGeometry, "native-brep");
  assert.equal(JSON.stringify(data), before);
});
test("a platform needs a certified top surface and a persisted stair relationship", () => {
  const model = native(),
    data = {
      source: { modelSha256: "native" },
      records: [],
    } as unknown as IndoorDataset;
  model.meshes[0]!.source = "display-proxy";
  assert.deepEqual(
    prepareIndoorStairDisplay(model, data).sourceFlights![0]!.landings,
    [],
  );
  model.meshes[0]!.source = "native-brep";
  delete model.elementOwnership;
  assert.deepEqual(
    prepareIndoorStairDisplay(model, data).sourceFlights![0]!.landings,
    [],
  );
});
