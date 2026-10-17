import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
} from "../lib/reviter/revit-2027-grep-replay.ts";
import {
  inspectOriginalStairCarrierEnvelope,
  certifyOriginalNativePlacedStairEnvelope,
  auditOriginalPlacedStairAboveFoot,
  type OriginalNativePlacedStairEnvelope,
} from "../lib/reviter/native-source-stair-placed-envelope.ts";
import { rational } from "../lib/reviter/native-rational-overlay.ts";
import type { OriginalNativeStairPhysicalContext } from "../lib/reviter/native-source-stair-physical-inventory.ts";
const fixture = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/native-original-stair-carrier-1696012.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
function replay(): Revit2027GRepReplay {
  const bytes = Uint8Array.from(Buffer.from(fixture.frameHex, "hex")),
    root = decodeRevit2027FramedGRepRoot(
      bytes,
      {
        offset: 0,
        elementId: 1696012,
        marker: 2246,
        objectLength: bytes.length - 20,
        typeCode: 0,
      },
      2027,
    );
  assert.ok(root.ok);
  const result = replayRevit2027GRepFifo(bytes, root.value);
  assert.ok(result.ok);
  return result.value;
}
const snapshot = (value: unknown) =>
  JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
test("every original placed carrier branch, line and point remains in its non-surface source ledger", () => {
  const source = replay(),
    before = snapshot(source),
    result = inspectOriginalStairCarrierEnvelope(source, 1696013);
  assert.ok(result.ok);
  assert.equal(result.geometry.originalSpanCount, 23);
  assert.equal(result.geometry.originalLineCount, 14);
  assert.equal(result.geometry.originalPointCount, 2);
  assert.equal(result.geometry.originalConditionCount, 2);
  assert.equal(result.geometry.originalNonSurfacePrimitives.length, 16);
  assert.equal(result.geometry.allSourceVisibilityBranchesRetained, true);
  assert.equal(result.geometry.physicalLineThicknessInvented, false);
  assert.equal(result.geometry.exactPhysicalBodyApproved, false);
  assert.equal(result.geometry.routeApproved, false);
  assert.equal(snapshot(source), before);
});
test("unknown material branches, omitted source operands, hidden placed bodies and unsupported affine changes refuse", () => {
  for (const mutation of [
    "unknown",
    "missing",
    "owner",
    "extra-body",
    "scale",
    "translate",
    "other-symbol",
    "embedded",
  ] as const) {
    const source = replay();
    if (mutation === "unknown") source.spans[1]!.readerId = "Revit2027GArc";
    if (mutation === "missing")
      (source.spans as Array<(typeof source.spans)[number]>).splice(1, 1);
    if (mutation === "owner") source.spans[1]!.ownerElementId = 42n;
    if (mutation === "extra-body")
      (
        source.spans.find((s) => s.readerId === "Revit2027Geometry")!.value as {
          faces: { count: number };
        }
      ).faces.count = 1;
    if (mutation === "scale")
      (
        source.spans.find((s) => s.readerId === "Revit2027GInstance")!
          .value as { hasScale: boolean }
      ).hasScale = true;
    if (mutation === "translate")
      (
        source.spans.find((s) => s.readerId === "Revit2027InstanceInfo")!
          .value as { transform: { matrix: number[] } }
      ).transform.matrix[12] = 1;
    if (mutation === "other-symbol")
      (
        source.spans.find((s) => s.readerId === "Revit2027InstanceInfo")!
          .value as { symbolElementId: bigint }
      ).symbolElementId = 9n;
    if (mutation === "embedded")
      (
        source.spans.find((s) => s.readerId === "Revit2027GInstance")!
          .value as { embeddedSymbolGRep: { token: number } }
      ).embeddedSymbolGRep.token = 999;
    assert.equal(
      inspectOriginalStairCarrierEnvelope(source, 1696013).ok,
      false,
      mutation,
    );
  }
});
test("nonfinite curves and unsupported point fields cannot become empty material", () => {
  for (const mutation of ["curve", "point"] as const) {
    const source = replay();
    if (mutation === "curve")
      (
        source.spans.find((s) => s.readerId === "Revit2027GLine")!.value as {
          origin: number[];
        }
      ).origin[0] = Infinity;
    else
      (
        source.spans.find((s) => s.readerId === "Revit2027GPoint")!.value as {
          size: number;
        }
      ).size = -1;
    assert.equal(
      inspectOriginalStairCarrierEnvelope(source, 1696013).ok,
      false,
    );
  }
});
test("caller geometry or cloned receipts cannot issue placed source material authority", () => {
  assert.throws(
    () =>
      certifyOriginalNativePlacedStairEnvelope(
        {
          sourceModelSha256: fixture.sourceModelSha256,
        } as OriginalNativeStairPhysicalContext,
        1696012,
      ),
    /Untrusted/,
  );
  assert.throws(
    () =>
      auditOriginalPlacedStairAboveFoot(
        { nativeRunId: 1696012 } as OriginalNativePlacedStairEnvelope,
        [],
        rational(0),
        rational(6),
      ),
    /Untrusted/,
  );
});
