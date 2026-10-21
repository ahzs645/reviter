import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "../lib/reviter/revit-2027-grep-replay.ts";
import {
  inspectOriginalNamedFloorCapBoundaryOperands,
  inspectOriginalNamedFloorCapSupport,
} from "../lib/reviter/native-source-floor-local-support.ts";
import {
  inspectOriginalFloorCapBoundaryDemand,
  inspectOriginalNativeFloorCapDemand,
} from "../lib/reviter/native-source-floor-cap-demand.ts";
import { inspectFilledThresholdStepGeometry } from "../lib/reviter/native-filled-threshold-step.ts";
import {
  rational,
  nativeRationalOverlay,
  nativeRationalScalarToIEEE,
  type NativeRationalParts,
} from "../lib/reviter/native-rational-overlay.ts";
import type { OriginalNativeForeignEnvelopeCensus } from "../lib/reviter/native-source-foreign-envelope-census.ts";
import type { Revit2027EdgeLoopWithChainEnvelopesStatic } from "../lib/reviter/revit-2027-edge-loop-static.ts";
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const bytes = readFileSync(
  new URL("./fixtures/native-trimmed-floor-1505065.bin", import.meta.url),
);
function replay() {
  const root = decodeRevit2027FramedGRepRoot(
    bytes,
    {
      offset: 0,
      elementId: 1505065,
      marker: 2246,
      objectLength: bytes.length - 20,
      typeCode: bytes.readUInt32LE(18),
    },
    2027,
  );
  assert.ok(root.ok);
  const r = replayRevit2027GRepFifo(bytes, root.value);
  assert.ok(r.ok);
  return r.value;
}
const frame = (id: number) => {
  const b = readFileSync(
    new URL(`./fixtures/native-filled-threshold-${id}.bin`, import.meta.url),
  );
  return { bytes: b, nativeElementId: id, sha256: hash(b) };
};
const floor = replay(),
  cap = inspectOriginalNamedFloorCapBoundaryOperands(floor, 5);
const step = inspectFilledThresholdStepGeometry({
  placed: frame(2315423),
  definition: frame(1223587),
  fromFeet: [35.53982462700122, 528.5495338272797, 24.278215223097114],
  toFeet: [28.8971, 528.5495338272798, 24.278215223097114],
});
assert.ok(step.ok);
const demand = nativeRationalOverlay(
  "union",
  step.fullWalkingStripFeet,
  ...step.standingSquaresFeet,
);
const around = (x: number, y: number): NativeRationalParts => [
  [
    [
      [x - 0.01, y - 0.01],
      [x + 0.01, y - 0.01],
      [x + 0.01, y + 0.01],
      [x - 0.01, y + 0.01],
    ].map((p) => [rational(p[0]!), rational(p[1]!)]),
  ],
];
test("the original1437 wrapper retains every chain and all five holes without granting global cap approval", () => {
  assert.equal(
    hash(bytes),
    "26a7335fbc65872d298584cd07117190b18b2e18cf3c2ac8996f4a728400ac74",
  );
  assert.equal(cap.originalCapLoopTokens.length, 6);
  assert.equal(cap.originalChainEnvelopeLoops.length, 1);
  assert.equal(cap.originalChainEnvelopeLoops[0]!.originalLoopToken, 669);
  assert.equal(
    cap.originalChainEnvelopeLoops[0]!.originalChainStartEdgeTokens.length,
    10,
  );
  assert.deepEqual(cap.guaranteedInnerSupportPartsFeet, []);
  assert.throws(
    () => inspectOriginalNamedFloorCapSupport(floor, 5),
    /Self-intersecting exact native rings/,
  );
});
test("the complete original threshold strip plus both standing interiors are supported by a bounded winding proof", () => {
  const before = hash(bytes),
    r = inspectOriginalFloorCapBoundaryDemand(cap, demand);
  assert.equal(r.completeConnectedDemandSupported, true);
  assert.equal(r.completeBoundaryUncertaintyContact, false);
  assert.deepEqual(r.sourceLoopWindings, [1, 0, 0, 0, 0, 0]);
  assert.equal(r.retainedOriginalHoleCount, 5);
  assert.equal(r.globalReferenceWindingApproved, false);
  assert.equal(r.wholeFloorSolidApproved, false);
  assert.equal(r.routeApproved, false);
  assert.equal(hash(bytes), before);
  assert.equal(
    cap.originalPhysicalTopElevationFeet.n * step.floorElevationFeet!.d,
    step.floorElevationFeet!.n * cap.originalPhysicalTopElevationFeet.d,
  );
});
test("original holes, original boundary uncertainty, disconnected demand and forged source handles remain refused", () => {
  const ring = cap.originalReferenceWindingPartsFeet[0]![1]!,
    xs = ring.map((p) => nativeRationalScalarToIEEE(p[0])),
    ys = ring.map((p) => nativeRationalScalarToIEEE(p[1]));
  const hole = inspectOriginalFloorCapBoundaryDemand(
    cap,
    around(
      (Math.min(...xs) + Math.max(...xs)) / 2,
      (Math.min(...ys) + Math.max(...ys)) / 2,
    ),
  );
  assert.equal(hole.completeConnectedDemandSupported, false);
  assert.notEqual(hole.sourceLoopWindings[1], 0);
  const edge = cap.originalReferenceWindingPartsFeet[0]![0]![0]!,
    contact = inspectOriginalFloorCapBoundaryDemand(
      cap,
      around(
        nativeRationalScalarToIEEE(edge[0]),
        nativeRationalScalarToIEEE(edge[1]),
      ),
    );
  assert.equal(contact.completeConnectedDemandSupported, false);
  assert.equal(contact.completeBoundaryUncertaintyContact, true);
  assert.throws(
    () =>
      inspectOriginalFloorCapBoundaryDemand(cap, [...demand, ...around(0, 0)]),
    /connected/,
  );
  assert.throws(
    () =>
      inspectOriginalNativeFloorCapDemand(
        {} as OriginalNativeForeignEnvelopeCensus,
        1505065,
        5,
        demand,
      ),
    /Untrusted/,
  );
});
test("foreign, duplicated and malformed chain operands do not bypass the original boundary census", () => {
  for (const defect of ["foreign", "duplicate", "inverted", "unknown-reader"]) {
    const r = replay(),
      s = r.spans.find(
        (s) =>
          s.readerId === "Revit2027EdgeLoopWithChainEnvelopes" &&
          s.propertyToken === 669,
      )!,
      v = s.value as Revit2027EdgeLoopWithChainEnvelopesStatic;
    const chains = v.chains as unknown as {
      startEdgeReference: number;
      envelope: { minimum: number[]; maximum: number[] };
    }[];
    if (defect === "foreign") chains[0]!.startEdgeReference = 999999;
    if (defect === "duplicate")
      chains[1]!.startEdgeReference = chains[0]!.startEdgeReference;
    if (defect === "inverted")
      chains[0]!.envelope.minimum[0] = chains[0]!.envelope.maximum[0]! + 1;
    if (defect === "unknown-reader") s.readerId = "UnknownCapLoop";
    assert.throws(
      () => inspectOriginalNamedFloorCapBoundaryOperands(r, 5),
      /cap branch|chain-envelope|loop source/,
    );
  }
});
