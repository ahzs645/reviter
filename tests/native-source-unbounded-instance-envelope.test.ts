import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { inspectOriginalUnboundedInstanceEnvelope } from "../lib/reviter/native-source-unbounded-instance-envelope.ts";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "../lib/reviter/revit-2027-grep-replay.ts";
const fixture = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/native-original-unbounded-panels.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
function frame(id: number, marker: number) {
  return Uint8Array.from(
    Buffer.from(
      fixture.frames.find(
        (f: { elementId: number; marker: number }) =>
          f.elementId === id && f.marker === marker,
      ).frameHex,
      "hex",
    ),
  );
}
function replay(id: number) {
  const raw = frame(id, 2246),
    v = new DataView(raw.buffer),
    root = decodeRevit2027FramedGRepRoot(
      raw,
      {
        offset: 0,
        elementId: id,
        marker: 2246,
        objectLength: raw.length - 20,
        typeCode: v.getUint32(18, true),
      },
      2027,
    );
  assert.ok(root.ok);
  assert.equal(root.value.worldExtents.valid, false);
  const result = replayRevit2027GRepFifo(raw, root.value);
  assert.ok(result.ok);
  return result.value;
}
test("three original unbounded saved boxes retain their complete placed planar material", () => {
  for (const [id, def] of [
    [1642433, 2438372],
    [1920413, 2438374],
    [1070536, 2413169],
  ]) {
    const result = inspectOriginalUnboundedInstanceEnvelope(
      replay(id!),
      replay(def!),
      frame(id!, 2031),
    );
    assert.ok(result.ok);
    assert.equal(result.componentCount, 1);
    assert.equal(result.physicalFaceTokens.length, 6);
    assert.ok(result.boundsFeet.min.z < result.boundsFeet.max.z);
    assert.ok(result.boundsFeet.min.x > 50);
    assert.equal(result.routeApproved, false);
    assert.equal(result.walkingSupportApproved, false);
  }
});
test("original native placement, owner, complete body and extra branches cannot be forged by a bounded proxy", () => {
  for (const mutation of [
    "placement",
    "owner",
    "unknown",
    "missing",
  ] as const) {
    const occurrence = replay(1642433),
      definition = replay(2438372),
      native = frame(1642433, 2031);
    if (mutation === "placement") native[40] ^= 1;
    if (mutation === "owner") occurrence.ownerElementId = 1920413n;
    if (mutation === "unknown")
      definition.spans[1]!.readerId = "Revit2027GNurbSurface";
    if (mutation === "missing") (definition.spans as Array<(typeof definition.spans)[number]>).splice(3, 1);
    const result = inspectOriginalUnboundedInstanceEnvelope(
      occurrence,
      definition,
      native,
    );
    assert.equal(result.ok, false, mutation);
  }
});
