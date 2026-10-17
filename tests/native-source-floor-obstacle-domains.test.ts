import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  inspectOriginalFloorObstacleDomains,
  certifyOriginalNativeFloorObstacleDomains,
} from "../lib/reviter/native-source-floor-obstacle-domains.ts";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "../lib/reviter/revit-2027-grep-replay.ts";
import type { OriginalNativeForeignEnvelopeCensus } from "../lib/reviter/native-source-foreign-envelope-census.ts";
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/native-original-floor-402395.json", import.meta.url),
    "utf8",
  ),
);
function replay() {
  const raw = Uint8Array.from(Buffer.from(fixture.frameHex, "hex")),
    v = new DataView(raw.buffer),
    root = decodeRevit2027FramedGRepRoot(
      raw,
      {
        offset: 0,
        elementId: 402395,
        marker: 2246,
        objectLength: raw.length - 20,
        typeCode: v.getUint32(18, true),
      },
      2027,
    );
  assert.ok(root.ok);
  const result = replayRevit2027GRepFifo(raw, root.value);
  assert.ok(result.ok);
  return result.value;
}
test("all original lower-floor planes, complete cylinders and source-only controls remain conservative obstruction operands", () => {
  const result = inspectOriginalFloorObstacleDomains(replay());
  assert.deepEqual(result.blockers, []);
  assert.equal(result.originalFaces, 107);
  assert.equal(result.cells.length, 108);
  assert.equal(result.curvedFaces, 3);
  assert.equal(result.referencePlanes, 2);
  assert.equal(result.pointControls, 103);
  assert.equal(result.positiveFloorSupportApproved, false);
  assert.equal(result.exactClosedPhysicalBodyApproved, false);
  assert.equal(result.routeApproved, false);
});
test("unknown branches, missing declared faces, control material, unowned hatch and degenerate cylinder refuse", () => {
  for (const mutation of [
    "unknown",
    "missing",
    "control",
    "hatch",
    "cylinder",
  ] as const) {
    const source = replay();
    if (mutation === "unknown")
      source.spans[0]!.readerId = "Revit2027GNurbSurface";
    if (mutation === "missing")
      (source.spans as Array<(typeof source.spans)[number]>).splice(
        source.spans.findIndex((s) => s.readerId === "Revit2027Face"),
        1,
      );
    if (mutation === "control")
      source.spans.find((s) => s.readerId === "Revit2027GPoint")!.readerId =
        "Revit2027Geometry";
    if (mutation === "hatch")
      (
        source.spans.find((s) => s.readerId === "Revit2027GFilling")!.value as {
          faceIdReference: number;
        }
      ).faceIdReference = -1;
    if (mutation === "cylinder")
      (
        source.spans.find(
          (s) => s.readerId === "Revit2027AnalyticSurface:1144",
        )!.value as { radius: number }
      ).radius = 0;
    const result = inspectOriginalFloorObstacleDomains(source);
    assert.equal(result.completeOriginalSourceDomainEnclosure, false, mutation);
    assert.equal(result.routeApproved, false);
  }
});
test("caller-authored census facts do not mint an original floor body", () => {
  assert.throws(
    () =>
      certifyOriginalNativeFloorObstacleDomains(
        {} as OriginalNativeForeignEnvelopeCensus,
        402395,
      ),
    /Untrusted/,
  );
});
