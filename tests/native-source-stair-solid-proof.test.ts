import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
} from "../lib/reviter/revit-2027-grep-replay.ts";
import {
  createOriginalNativeStairPhysicalContext,
  readOriginalNativeStairPhysicalSource,
  type OriginalNativeStairPhysicalContext,
} from "../lib/reviter/native-source-stair-physical-inventory.ts";
import {
  inspectPlanarPrismReplayGeometry,
  inspectOriginalStairSourceTopology,
  proveOriginalNativeStairSolid,
  originalNativeStairSolidPrisms,
  type OriginalNativeStairSolidCertificate,
} from "../lib/reviter/native-source-stair-solid-proof.ts";

import { inspectOriginalNativeStairSupportEnvelopes } from "../lib/reviter/native-source-stair-support-envelopes.ts";
import {
  inspectOriginalNativeStairSteppedStations,
  inspectOriginalStairTypedRiserSequence,
} from "../lib/reviter/native-source-stair-stepped-stations.ts";
import { nativeRationalScalarToIEEE } from "../lib/reviter/native-rational-overlay.ts";
const fixture = readFileSync(
  new URL("./fixtures/native-planar-landing-1514133.bin", import.meta.url),
);
function replay(): Revit2027GRepReplay {
  const view = new DataView(
    fixture.buffer,
    fixture.byteOffset,
    fixture.byteLength,
  );
  const root = decodeRevit2027FramedGRepRoot(
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
function nextUp(n: number) {
  const bytes = new ArrayBuffer(8),
    view = new DataView(bytes);
  view.setFloat64(0, n);
  view.setBigUint64(0, view.getBigUint64(0) + 1n);
  return view.getFloat64(0);
}
const field = <T>(r: Revit2027GRepReplay, reader: string) =>
  r.spans.find((s) => s.readerId === reader)!.value as T;

test("one original concave landing has complete closed source topology and a positive exact prism without mesh authority", () => {
  const source = replay(),
    before = JSON.stringify(source, (_, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
  const topology = inspectOriginalStairSourceTopology(source),
    geometry = inspectPlanarPrismReplayGeometry(source);
  assert.equal(
    topology.completeClosedSourceTopology,
    true,
    JSON.stringify(topology),
  );
  assert.equal(topology.components.length, 1);
  assert.deepEqual(
    topology.components.map((c) => [
      c.faceTokens.length,
      c.edgeCount,
      c.abstractVertexCount,
      c.eulerCharacteristic,
    ]),
    [[9, 21, 14, 2]],
  );
  assert.equal(topology.originalSourceAuthorityGranted, false);
  assert.equal(topology.geometricVertexCoordinatesChanged, false);
  assert.equal(geometry.completeExactPrismBody, true, JSON.stringify(geometry));
  assert.equal(geometry.prisms.length, 1);
  assert.equal(geometry.prisms[0]!.footprint.length, 7);
  assert.equal(
    JSON.stringify(source, (_, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
    before,
  );
});

test("shared source topology never repairs a one-ULP original endpoint discrepancy", () => {
  const source = replay(),
    edge = field<{ firstAndLastEdgePoints: { firstFaceUv: number[] }[] }>(
      source,
      "Revit2027GEdge",
    );
  edge.firstAndLastEdgePoints[0]!.firstFaceUv[0] = nextUp(
    edge.firstAndLastEdgePoints[0]!.firstFaceUv[0]! || 1,
  );
  assert.equal(
    inspectOriginalStairSourceTopology(source).completeClosedSourceTopology,
    true,
  );
  const geometry = inspectPlanarPrismReplayGeometry(source);
  assert.equal(geometry.completeExactPrismBody, false);
  assert.ok(
    geometry.blockers.some(
      (b) => b.includes("coedges") || b.includes("parametrizations"),
    ),
  );
  assert.ok(geometry.witnesses.length);
});

test("a changed twin plane keeps its shared edge identity but cannot become one exact closed solid", () => {
  const source = replay(),
    plane = field<{ origin: number[] }>(source, "Revit2027AnalyticSurface:634");
  plane.origin[2] = nextUp(plane.origin[2]!);
  assert.equal(
    inspectOriginalStairSourceTopology(source).completeClosedSourceTopology,
    true,
  );
  assert.equal(
    inspectPlanarPrismReplayGeometry(source).completeExactPrismBody,
    false,
  );
});

test("missing faces, duplicated primitives, open loops and changed edge neighbors refuse independently of display", () => {
  for (const mutation of [
    "omit-face",
    "duplicate",
    "open-loop",
    "edge-neighbor",
    "foreign",
  ] as const) {
    const source = replay();
    if (mutation === "omit-face")
      source.spans = source.spans.filter(
        (s) => s !== source.spans.find((r) => r.readerId === "Revit2027Face"),
      );
    if (mutation === "duplicate")
      source.spans = [
        ...source.spans,
        structuredClone(
          source.spans.find((r) => r.readerId === "Revit2027Face")!,
        ),
      ];
    if (mutation === "open-loop")
      field<{ open: boolean }>(source, "Revit2027EdgeLoop").open = true;
    if (mutation === "edge-neighbor")
      field<{ previousReferences: number[] }>(
        source,
        "Revit2027GEdge",
      ).previousReferences[0] = 999;
    if (mutation === "foreign") source.spans[0]!.ownerElementId = 999n;
    assert.equal(
      inspectOriginalStairSourceTopology(source).completeClosedSourceTopology,
      false,
      mutation,
    );
    assert.equal(
      inspectPlanarPrismReplayGeometry(source).completeExactPrismBody,
      false,
      mutation,
    );
  }
});

test("an actual gap, curved source samples or unknown surface cannot borrow a positive body flag", () => {
  for (const mutation of ["gap", "curve", "surface"] as const) {
    const source = replay();
    if (mutation === "gap")
      field<{ firstAndLastEdgePoints: { firstFaceUv: number[] }[] }>(
        source,
        "Revit2027GEdge",
      ).firstAndLastEdgePoints[0]!.firstFaceUv[0]! += 0.0001;
    if (mutation === "curve") {
      const edge = field<{
        interiorEdgePoints: unknown[];
        firstAndLastEdgePoints: unknown[];
      }>(source, "Revit2027GEdge");
      edge.interiorEdgePoints = [
        structuredClone(edge.firstAndLastEdgePoints[0]),
      ];
    }
    if (mutation === "surface")
      source.spans.find(
        (s) => s.readerId === "Revit2027AnalyticSurface:634",
      )!.readerId = "Revit2027AnalyticSurface:1144";
    assert.equal(
      inspectPlanarPrismReplayGeometry(source).completeExactPrismBody,
      false,
      mutation,
    );
  }
});

test("copied context and certificate labels cannot manufacture original physical source authority", () => {
  assert.throws(
    () =>
      proveOriginalNativeStairSolid(
        {} as OriginalNativeStairPhysicalContext,
        1696012,
      ),
    /Untrusted/,
  );
  assert.throws(
    () =>
      originalNativeStairSolidPrisms({} as OriginalNativeStairSolidCertificate),
    /Untrusted/,
  );
});

const originalPath = process.env.UNBC_ORIGINAL_RVT;
test(
  "actual Library body checks every original source shell and retains numerical discrepancies as a separate failed gate",
  { skip: !originalPath },
  () => {
    const context = createOriginalNativeStairPhysicalContext(
      readFileSync(originalPath!),
      "8c294549ee667ed7aba38f1f4f3a53514dae7544af97f0157ee8187dd8702178",
      [
        {
          nativeStairId: 1696006,
          nativeRunId: 1696012,
          nativeDefinitionId: 1696013,
        },
        {
          nativeStairId: 1293690,
          nativeRunId: 1293981,
          nativeDefinitionId: 1293982,
        },
      ],
    );
    const facts = readOriginalNativeStairPhysicalSource(context, 1696012);
    assert.equal(facts.physicalDefinition.ownerElementId, 1696013n);
    // Returned decoded facts are not private authority; editing them cannot
    // alter the original frame re-read by the body certificate constructor.
    facts.physicalDefinition.spans = [];
    const result = proveOriginalNativeStairSolid(context, 1696012),
      report = result.report;
    assert.equal(result.ok, false);
    assert.equal(report.physicalTreadHistoryBindingComplete, true);
    assert.equal(report.originalExactGeometry.originalFaceCount, 286);
    assert.equal(report.originalExactGeometry.originalEdgeCount, 576);
    assert.equal(
      report.originalSourceTopology.completeClosedSourceTopology,
      true,
      JSON.stringify(report.originalSourceTopology),
    );
    assert.equal(report.originalSourceTopology.components.length, 47);
    assert.ok(report.exactUvCoedgeDiscrepancyCount > 0);
    assert.ok(report.exactTwinFaceEndpointDiscrepancyCount > 0);
    assert.equal(report.originalPhysicalRunBodyApproved, false);
    assert.equal(report.preparedFlightCorrespondenceApproved, false);
    assert.equal(report.terminalContactsApproved, false);
    assert.equal(report.ownBodyAndHeadroomClearanceApproved, false);
    assert.equal(report.routeApproved, false);
    const positive = proveOriginalNativeStairSolid(context, 1293981);
    assert.equal(positive.ok, true, JSON.stringify(positive.report));
    if (!positive.ok) throw Error("Positive source run refused");
    const { prisms } = originalNativeStairSolidPrisms(positive.certificate);
    assert.equal(prisms.length, 11);
    prisms.length = 0;
    assert.equal(
      originalNativeStairSolidPrisms(positive.certificate).prisms.length,
      11,
    );
    assert.throws(
      () => originalNativeStairSolidPrisms({ ...positive.certificate }),
      /Untrusted/,
    );
    assert.equal(positive.report.routeApproved, false);
    const envelopes = inspectOriginalNativeStairSupportEnvelopes(
      context,
      1696012,
    );
    assert.equal(envelopes.completeOriginalStraightPlanarSourceCensus, true);
    assert.equal(envelopes.components.length, 47);
    assert.equal(envelopes.caps.length, 47);
    assert.equal(envelopes.sourceVerticesWithCompetingEmbeddings, 337);
    const stations = envelopes.originalWalkingFaceTokens.map((role) => {
      const cap = envelopes.caps.find(
        (c) => c.physicalFaceToken === role.physicalFaceToken,
      )!;
      const xy = cap.guaranteedInnerPlanSupport
        .flat(2)
        .map((p) => p.map(nativeRationalScalarToIEEE));
      return {
        typedIndex: role.typedIndex,
        pointFeet: [
          (Math.min(...xy.map((p) => p[0]!)) +
            Math.max(...xy.map((p) => p[0]!))) /
            2,
          (Math.min(...xy.map((p) => p[1]!)) +
            Math.max(...xy.map((p) => p[1]!))) /
            2,
        ] as [number, number],
        lateralAxis: "y" as const,
      };
    });
    const stepped = inspectOriginalNativeStairSteppedStations(
      context,
      1696012,
      stations,
    );
    assert.equal(
      stepped.allOriginalPhysicalTreadStationsSupported,
      true,
      JSON.stringify(stepped.blockers),
    );
    assert.equal(stepped.stations.length, 23);
    assert.equal(stepped.verticalTransfers.length, 22);
    assert.equal(
      stepped.originalNamedRiserSequence.completeNamedSourceRiserSequence,
      true,
    );
    assert.equal(stepped.originalNamedRiserSequence.orderedRisers.length, 24);
    assert.deepEqual(
      stepped.originalNamedRiserSequence.treadRelations.map((t) => [
        t.startRiserIndex,
        t.endRiserIndex,
      ]),
      Array.from({ length: 23 }, (_, i) => [i, i + 1]),
    );
    const mutatedRun = readOriginalNativeStairPhysicalSource(
      context,
      1696012,
    ).run;
    const firstInfo = mutatedRun.entries.find(
      (e) => e.sourceClassName === "StairsTreadInfo",
    )!;
    (firstInfo.value.m_endRiser as Record<string, unknown>).m_specifiedIdx = 2;
    assert.equal(
      inspectOriginalStairTypedRiserSequence(mutatedRun, 23)
        .completeNamedSourceRiserSequence,
      false,
    );

    assert.equal(stepped.routeApproved, false);
    assert.equal(stepped.physicalRiserCorrespondenceApproved, false);
    const actualDemand = JSON.parse(
      readFileSync(
        new URL(
          "./fixtures/unbc-1696012-stepped-stations.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ).stations;
    const proposed = inspectOriginalNativeStairSteppedStations(
      context,
      1696012,
      actualDemand,
    );
    assert.equal(
      proposed.completeOriginalSteppedSupportProposal,
      true,
      JSON.stringify(proposed.blockers),
    );
    assert.equal(proposed.stations.length, 24);
    assert.equal(proposed.steppedPlanTransfers.length, 22);
    assert.ok(
      proposed.steppedPlanTransfers.every(
        (t) => t.withinOriginalSourceSteppedPlanCorridor,
      ),
    );
    assert.equal(proposed.sameTreadTransfers.length, 1);
    assert.equal(
      proposed.sameTreadTransfers[0]!.fullTwoFootInnerPlanSupport,
      true,
    );
    assert.ok(
      proposed.steppedPlanTransfers.some(
        (t) => t.retainedUncertaintyCrossingPartsFeet.length > 0,
      ),
    );
    const shifted = structuredClone(actualDemand);
    shifted[0].pointFeet[0] += 20;
    const refused = inspectOriginalNativeStairSteppedStations(
      context,
      1696012,
      shifted,
    );
    assert.equal(refused.allOriginalPhysicalTreadStationsSupported, false);
    assert.equal(refused.completeOriginalSteppedSupportProposal, false);
    assert.equal(proposed.routeApproved, false);

    assert.throws(
      () =>
        inspectOriginalNativeStairSteppedStations(
          context,
          1696012,
          stations.filter((s) => s.typedIndex !== 1),
        ),
      /visit every/,
    );
  },
);
