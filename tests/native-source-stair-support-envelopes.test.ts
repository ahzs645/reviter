import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
} from "../lib/reviter/revit-2027-grep-replay.ts";
import { inspectOriginalStairSupportEnvelopes } from "../lib/reviter/native-source-stair-support-envelopes.ts";
import {
  Rational,
  nativeRationalOverlay,
  type NativeRationalParts,
} from "../lib/reviter/native-rational-overlay.ts";
const fixture = readFileSync(
  new URL("./fixtures/native-planar-landing-1514133.bin", import.meta.url),
);
function replay(): Revit2027GRepReplay {
  const view = new DataView(
      fixture.buffer,
      fixture.byteOffset,
      fixture.byteLength,
    ),
    root = decodeRevit2027FramedGRepRoot(
      fixture,
      {
        offset: 0,
        elementId: 1514133,
        marker: 2246,
        objectLength: view.getUint32(12, true),
        typeCode: view.getUint32(18, true),
      },
      2027,
    );
  assert.ok(root.ok);
  const decoded = replayRevit2027GRepFifo(fixture, root.value);
  assert.ok(decoded.ok);
  return decoded.value;
}
const sum = (a: Rational, b: Rational) =>
  new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
function area(parts: NativeRationalParts) {
  let a = new Rational(0n);
  for (const part of parts)
    for (const ring of part)
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i]!,
          q = ring[(i + 1) % ring.length]!;
        a = sum(
          a,
          new Rational(
            p[0].n * q[1].n * p[1].d * q[0].d -
              p[1].n * q[0].n * p[0].d * q[1].d,
            p[0].d * q[1].d * p[1].d * q[0].d * 2n,
          ),
        );
      }
  return a;
}
test("exact original concave cap preserves every notch and obtains support without a body certificate", () => {
  const source = replay(),
    before = JSON.stringify(source, (_, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
    report = inspectOriginalStairSupportEnvelopes(source);
  assert.equal(
    report.completeOriginalStraightPlanarSourceCensus,
    true,
    JSON.stringify(report.blockers),
  );
  assert.equal(report.components.length, 1);
  assert.equal(report.caps.length, 1);
  assert.equal(report.sourceVerticesWithCompetingEmbeddings, 0);
  const cap = report.caps[0]!;
  assert.deepEqual(cap.boundaryUncertainty, []);
  assert.deepEqual(cap.guaranteedInnerPlanSupport, cap.referenceEmbedding);
  assert.ok(cap.referenceEmbedding[0]![0]!.length >= 6);
  // Convex obstruction hull may bridge a notch, while support never does.
  const obstacleOnly = nativeRationalOverlay(
    "difference",
    report.components[0]!.conservativeOuterPlanEnvelope,
    cap.guaranteedInnerPlanSupport,
  );
  assert.ok(area(obstacleOnly).n > 0n);
  assert.equal(report.originalSourceAuthorityGranted, false);
  assert.equal(report.exactClosedPhysicalBodyApproved, false);
  assert.equal(report.routeApproved, false);
  assert.equal(
    JSON.stringify(source, (_, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
    before,
  );
});
test("competing UV endpoint embeddings retain positive uncertainty with no snap or epsilon", () => {
  const source = replay(),
    original = inspectOriginalStairSupportEnvelopes(source),
    cap = original.caps[0]!;
  const span = source.spans.find(
    (s) =>
      s.readerId === "Revit2027GEdge" &&
      (s.value as { faceReferences: number[] }).faceReferences.includes(
        cap.physicalFaceToken,
      ),
  )!;
  const edge = span.value as {
    faceReferences: number[];
    firstAndLastEdgePoints: { firstFaceUv: number[]; secondFaceUv: number[] }[];
  };
  const side = edge.faceReferences.indexOf(cap.physicalFaceToken),
    uv =
      side === 0
        ? edge.firstAndLastEdgePoints[0]!.firstFaceUv
        : edge.firstAndLastEdgePoints[0]!.secondFaceUv;
  uv[0]! += 0.125;
  const before = JSON.stringify(source, (_, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
    report = inspectOriginalStairSupportEnvelopes(source);
  assert.equal(
    report.completeOriginalStraightPlanarSourceCensus,
    true,
    JSON.stringify(report.blockers),
  );
  assert.ok(report.sourceVerticesWithCompetingEmbeddings > 0);
  assert.ok(area(report.caps[0]!.boundaryUncertainty).n > 0n);
  const outside = nativeRationalOverlay(
    "difference",
    report.caps[0]!.guaranteedInnerPlanSupport,
    report.caps[0]!.referenceEmbedding,
  );
  assert.deepEqual(outside, []);
  assert.equal(
    JSON.stringify(source, (_, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
    before,
  );
  assert.equal(report.routeApproved, false);
});
test("every undeclared, duplicate, curved, foreign or holed source branch blocks a complete support census", () => {
  for (const kind of [
    "undeclared",
    "duplicate",
    "curve",
    "foreign",
    "hole",
    "unknown",
  ] as const) {
    const source = replay();
    if (kind === "undeclared")
      (
        source.spans.find((s) => s.readerId === "Revit2027Geometry")!.value as {
          faces: { entries: { token: number }[] };
        }
      ).faces.entries[0]!.token = 99999;
    if (kind === "duplicate")
      source.spans = [
        ...source.spans,
        structuredClone(
          source.spans.find((s) => s.readerId === "Revit2027Face")!,
        ),
      ];
    if (kind === "curve")
      (
        source.spans.find((s) => s.readerId === "Revit2027GEdge")!.value as {
          interiorEdgePoints: unknown[];
        }
      ).interiorEdgePoints.push({});
    if (kind === "foreign") source.spans[0]!.ownerElementId = 1n;
    if (kind === "hole")
      (
        source.spans.find((s) => s.readerId === "Revit2027EdgeLoop")!.value as {
          nextLoop: { token: number };
        }
      ).nextLoop.token = 123;
    if (kind === "unknown")
      source.spans = [
        ...source.spans,
        {
          ...structuredClone(source.spans[0]!),
          propertyToken: 12345,
          readerId: "UnsupportedSourceBranch",
        },
      ];
    const report = inspectOriginalStairSupportEnvelopes(source);
    assert.equal(
      report.completeOriginalStraightPlanarSourceCensus,
      false,
      kind,
    );
    assert.ok(report.blockers.length, kind);
    assert.equal(report.routeApproved, false);
  }
});
