import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  inspectOriginalPlanarSlabEnvelopeGeometry,
  originalSourceReferenceHolesContained,
  certifyOriginalNativePlanarSlabEnvelope,
  auditOriginalSlabAboveNativeTreads,
  auditOriginalSlabAgainstWalkingLine,
  originalNativeSlabSupportEnvelope,
  exactClosedSourcePlanarContact,
  type OriginalNativePlanarSlabEnvelope,
} from "../lib/reviter/native-source-planar-slab-envelope.ts";
import { createOriginalNativeStairPhysicalContext } from "../lib/reviter/native-source-stair-physical-inventory.ts";
import {
  certifyOriginalNativePlacedStairEnvelope,
  auditOriginalPlacedStairAboveFoot,
  auditOriginalPlacedStairAgainstWalkingLine,
  auditOriginalStairAndSlabVerticalStation,
} from "../lib/reviter/native-source-stair-placed-envelope.ts";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "../lib/reviter/revit-2027-grep-replay.ts";
import {
  rational,
  nativeRationalOverlay,
  type NativeRationalParts,
} from "../lib/reviter/native-rational-overlay.ts";
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/native-original-slab-405772.json", import.meta.url),
    "utf8",
  ),
);
function replay() {
  const bytes = Uint8Array.from(Buffer.from(fixture.frameHex, "hex"));
  const root = decodeRevit2027FramedGRepRoot(
    bytes,
    {
      offset: 0,
      elementId: 405772,
      marker: 2246,
      objectLength: bytes.length - 20,
      typeCode: 0,
    },
    2027,
  );
  assert.ok(root.ok);
  const result = replayRevit2027GRepFifo(bytes, root.value, undefined, {
    maxReplayEntries: 100000,
    maxDescriptors: 400000,
  });
  assert.ok(result.ok);
  return result.value;
}
const rect = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): NativeRationalParts => [
  [
    [
      [x1, y1],
      [x2, y1],
      [x2, y2],
      [x1, y2],
    ].map(([x, y]) => [rational(x!), rational(y!)]),
  ],
];
const snapshot = (value: unknown) =>
  JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));

test("complete original holed slab preserves all 129 faces, 381 edges, 141 loops and positive side uncertainty", () => {
  const source = replay(),
    before = snapshot(source),
    result = inspectOriginalPlanarSlabEnvelopeGeometry(source);
  assert.ok(result.ok);
  assert.equal(result.geometry.originalFaces, 129);
  assert.equal(result.geometry.originalEdges, 381);
  assert.equal(result.geometry.originalLoops, 141);
  assert.equal(result.geometry.originalHoleCount, 6);
  assert.ok(result.geometry.sideDomainPositiveResidualAreaSqFt > 0);
  assert.equal(result.geometry.sideFaceTokens.length, 127);
  assert.equal(
    nativeRationalOverlay(
      "difference",
      result.geometry.originalCapPartsFeet,
      result.geometry.enclosingPartsFeet,
    ).length,
    0,
  );
  assert.equal(
    nativeRationalOverlay(
      "difference",
      result.geometry.guaranteedInnerSupportPartsFeet,
      result.geometry.originalCapPartsFeet,
    ).length,
    0,
  );
  assert.equal(result.geometry.exactPhysicalBodyApproved, false);
  assert.equal(result.geometry.routeApproved, false);
  assert.equal(snapshot(source), before);
});

test("unknown branches, omitted declared operands, unsupported filling ownership and hidden original filling children refuse", () => {
  for (const mutation of [
    "branch",
    "operand",
    "filling-owner",
    "filling-child",
    "missing-filling",
  ] as const) {
    const copy = replay();
    if (mutation === "branch") copy.spans[0]!.readerId = "Revit2027GArc";
    if (mutation === "operand") {
      const declared = copy.spans[0]!.value as {
        faces: { count: number; entries: unknown[] };
      };
      declared.faces.entries.pop();
      declared.faces.count--;
    }
    if (mutation === "filling-owner")
      (
        copy.spans.find((s) => s.readerId === "Revit2027GFilling")!.value as {
          faceIdReference: number;
        }
      ).faceIdReference = 123;
    if (mutation === "filling-child")
      (
        copy.spans.find((s) => s.readerId === "Revit2027GFilling")!.value as {
          data: { token: number };
        }
      ).data.token = 999;
    if (mutation === "missing-filling")
      (copy.spans as Array<(typeof copy.spans)[number]>).splice(
        copy.spans.findIndex((s) => s.readerId === "Revit2027GFilling"),
        1,
      );
    assert.equal(
      inspectOriginalPlanarSlabEnvelopeGeometry(copy).ok,
      false,
      mutation,
    );
  }
});

test("open or omitted holes, original coedge gaps, Boolean cuts and conflicting twin ownership cannot be waived", () => {
  for (const mutation of [
    "hole",
    "loop-open",
    "uv-gap",
    "cut",
    "twin",
  ] as const) {
    const copy = replay();
    if (mutation === "hole")
      (
        copy.spans.find((s) => s.readerId === "Revit2027EdgeLoop")!.value as {
          nextLoop: { token: number };
        }
      ).nextLoop.token = 0;
    if (mutation === "loop-open")
      (
        copy.spans.find((s) => s.readerId === "Revit2027EdgeLoop")!.value as {
          open: boolean;
        }
      ).open = true;
    if (mutation === "uv-gap")
      (
        copy.spans.find((s) => s.readerId === "Revit2027GEdge")!.value as {
          firstAndLastEdgePoints: { firstFaceUv: number[] }[];
        }
      ).firstAndLastEdgePoints[0]!.firstFaceUv[0]! += 2 ** -20;
    if (mutation === "cut")
      (
        copy.spans.find((s) => s.readerId === "Revit2027Face")!.value as {
          cutType: number;
        }
      ).cutType = 1;
    if (mutation === "twin") {
      const edge = copy.spans.find((s) => s.readerId === "Revit2027GEdge")!
        .value as { faceReferences: number[] };
      edge.faceReferences[1] = edge.faceReferences[0]!;
    }
    assert.equal(
      inspectOriginalPlanarSlabEnvelopeGeometry(copy).ok,
      false,
      mutation,
    );
  }
});

test("tangent source material, zero-thickness lines and exact hole boundaries survive area-only negatives", () => {
  const subject = rect(0, 0, 1, 1),
    tangent = rect(1, 0, 2, 1);
  assert.equal(
    nativeRationalOverlay("intersection", subject, tangent).length,
    0,
  );
  assert.equal(exactClosedSourcePlanarContact(subject, tangent), true);
  assert.equal(
    exactClosedSourcePlanarContact(subject, rect(1 + 2 ** -50, 0, 2, 1)),
    false,
  );
  assert.equal(
    exactClosedSourcePlanarContact(
      subject,
      [],
      [
        [
          [rational(0.5), rational(-1)],
          [rational(0.5), rational(2)],
        ],
      ],
    ),
    true,
  );
  const hollow = rect(-2, -2, 2, 2);
  hollow[0]!.push(rect(-1, -1, 1, 1)[0]![0]!.toReversed());
  assert.equal(
    exactClosedSourcePlanarContact(rect(-0.5, -0.5, 0.5, 0.5), hollow),
    false,
  );
  assert.equal(exactClosedSourcePlanarContact(subject, hollow), true);
  const horizontal = [
    [rational(-1), rational(0)],
    [rational(1), rational(0)],
  ] as [ReturnType<typeof rational>, ReturnType<typeof rational>][];
  const vertical = [
    [rational(0), rational(-1)],
    [rational(0), rational(1)],
  ] as [ReturnType<typeof rational>, ReturnType<typeof rational>][];
  assert.equal(
    exactClosedSourcePlanarContact([], [], [horizontal], [vertical]),
    true,
  );
  assert.equal(
    exactClosedSourcePlanarContact(
      [],
      [],
      [horizontal],
      [[[rational(0), rational(0)]]],
    ),
    true,
  );
  assert.equal(
    exactClosedSourcePlanarContact(
      [],
      [],
      [horizontal],
      [[[rational(0), rational(2 ** -50)]]],
    ),
    false,
  );
});

test("degenerate vertical source bases and cap-to-cap twins cannot issue slab support", () => {
  const degenerate = replay();
  const side = degenerate.spans.find(
    (span) =>
      span.readerId === "Revit2027AnalyticSurface:634" &&
      ((span.value as { xVector: number[]; yVector: number[] }).xVector[2] !==
        0 ||
        (span.value as { xVector: number[]; yVector: number[] }).yVector[2] !==
          0),
  )!.value as { xVector: number[]; yVector: number[] };
  if (side.xVector[2] === 0) side.xVector = [0, 0, 0];
  else side.yVector = [0, 0, 0];
  assert.equal(inspectOriginalPlanarSlabEnvelopeGeometry(degenerate).ok, false);
  const capTwin = replay(),
    capTokens = capTwin.spans
      .filter(
        (span) =>
          span.readerId === "Revit2027Face" &&
          (span.value as { faceFlags: number }).faceFlags === 516,
      )
      .map((span) => span.propertyToken);
  const edge = capTwin.spans.find(
    (span) =>
      span.readerId === "Revit2027GEdge" &&
      (span.value as { faceReferences: number[] }).faceReferences.some((face) =>
        capTokens.includes(face),
      ),
  )!.value as { faceReferences: number[] };
  edge.faceReferences = [capTokens[0]!, capTokens[1]!];
  assert.equal(inspectOriginalPlanarSlabEnvelopeGeometry(capTwin).ok, false);
});

test("a self-authored object or unrelated bytes cannot issue source support or a clearance authority", () => {
  const forged = {
    sourceModelSha256: fixture.sourceModelSha256,
    nativeSlabElementId: 405772,
  } as OriginalNativePlanarSlabEnvelope;
  assert.throws(() => originalNativeSlabSupportEnvelope(forged), /Untrusted/);
  assert.throws(
    () =>
      auditOriginalSlabAgainstWalkingLine(
        forged,
        [
          [0, 0, 0],
          [1, 0, 0],
        ],
        6,
      ),
    /Untrusted/,
  );
  assert.throws(
    () =>
      certifyOriginalNativePlanarSlabEnvelope(
        new Uint8Array(100),
        fixture.sourceModelSha256,
        405772,
      ),
    /checksum/,
  );
});

const sourcePath = process.env.NATIVE_SLAB_SOURCE_RVT;
test(
  "actual original RVT certifies the entire holed slab envelope while final stair support remains separate",
  { skip: !sourcePath },
  () => {
    const bytes = readFileSync(sourcePath!),
      sha = (data: Uint8Array) =>
        createHash("sha256").update(data).digest("hex");
    assert.equal(sha(bytes), fixture.sourceModelSha256);
    const result = certifyOriginalNativePlanarSlabEnvelope(
      bytes,
      fixture.sourceModelSha256,
      405772,
    );
    assert.ok(result.ok);
    assert.equal(result.summary.holes, 6);
    assert.equal(result.summary.pages, 3666);
    assert.equal(result.summary.originalFrameSha256, fixture.frameSha256);
    assert.equal(
      originalNativeSlabSupportEnvelope(result.certificate)
        .completeOriginalMaterialCellsFeet.length,
      128,
    );
    const original = originalNativeSlabSupportEnvelope(result.certificate),
      sourceX = original.guaranteedInnerSupportPartsFeet[0]![0]![0]![0];
    original.guaranteedInnerSupportPartsFeet[0]![0]![0]![0] = rational(1234);
    const checked = originalNativeSlabSupportEnvelope(result.certificate)
      .guaranteedInnerSupportPartsFeet[0]![0]![0]![0];
    assert.equal(checked.n, sourceX.n);
    assert.equal(checked.d, sourceX.d);
    assert.throws(
      () => originalNativeSlabSupportEnvelope({ ...result.certificate }),
      /Untrusted/,
    );
    const context = createOriginalNativeStairPhysicalContext(
      bytes,
      fixture.sourceModelSha256,
      [
        {
          nativeStairId: 1696006,
          nativeRunId: 1696012,
          nativeDefinitionId: 1696013,
        },
      ],
    );
    const stations = auditOriginalSlabAboveNativeTreads(
      result.certificate,
      context,
      1696012,
      6,
    );
    assert.equal(stations.treads.length, 23);
    assert.equal(stations.allOriginalTreadsChecked, true);
    const placed = certifyOriginalNativePlacedStairEnvelope(context, 1696012);
    assert.ok(placed.ok);
    assert.equal(placed.summary.physicalComponentCount, 47);
    assert.equal(placed.summary.physicalFaceCount, 286);
    assert.equal(placed.summary.physicalEdgeCount, 576);
    assert.deepEqual(placed.summary.sourceMaterialLocalizationBlockers, []);
    assert.equal(placed.summary.originalLocalizedMaterialCellCount, 239);
    assert.equal(placed.summary.originalLineCount, 14);
    assert.equal(placed.summary.originalPointCount, 2);
    assert.equal(placed.summary.allBranchesAndPhysicalComponentsRetained, true);
    assert.throws(
      () =>
        auditOriginalPlacedStairAboveFoot(
          { ...placed.certificate },
          rect(0, 0, 1, 1),
          rational(0),
          rational(6),
        ),
      /Untrusted/,
    );
    const highLine = auditOriginalPlacedStairAgainstWalkingLine(
      placed.certificate,
      [
        [0, 0, 100],
        [3, 4, 100],
      ],
      6,
    );
    assert.deepEqual(highLine.contactSegments, []);
    assert.equal(highLine.physicalComponentsChecked, 47);
    assert.equal(highLine.routeApproved, false);
    const verticalStation = auditOriginalStairAndSlabVerticalStation(
      placed.certificate,
      result.certificate,
      {
        partsFeet: rect(-1000, -1000, 1000, 1000),
        closedSegmentsFeet: [],
        lowerFootFeet: rational(24),
        upperFootFeet: rational(30),
      },
      6,
    );
    assert.ok(verticalStation.componentContacts.length > 0);
    assert.equal(verticalStation.slabContact, true);
    assert.equal(verticalStation.fullVerticalBodySweepRetained, true);
    assert.equal(verticalStation.routeApproved, false);
    const sourceLineStation = auditOriginalStairAndSlabVerticalStation(
      placed.certificate,
      result.certificate,
      {
        partsFeet: [],
        closedSegmentsFeet: [
          [
            [rational(-1000), rational(-300)],
            [rational(1000), rational(-300)],
          ],
        ],
        lowerFootFeet: rational(24),
        upperFootFeet: rational(30),
      },
      6,
    );
    assert.equal(sourceLineStation.slabContact, true);
    assert.equal(sourceLineStation.completeHumanHeadroomApproved, false);
    assert.throws(
      () =>
        auditOriginalPlacedStairAgainstWalkingLine(
          { ...placed.certificate },
          [
            [0, 0, 100],
            [3, 4, 100],
          ],
          6,
        ),
      /Untrusted/,
    );
    const highDemand = auditOriginalPlacedStairAboveFoot(
      placed.certificate,
      rect(-1000, -1000, 1000, 1000),
      rational(100),
      rational(6),
    );
    assert.deepEqual(highDemand.componentContacts, []);
    assert.deepEqual(highDemand.nonSurfaceGraphicalContacts, []);
    assert.equal(highDemand.routeApproved, false);
    const intersectsDemand = auditOriginalPlacedStairAboveFoot(
      placed.certificate,
      rect(-1000, -1000, 1000, 1000),
      rational(24),
      rational(6),
    );
    assert.ok(intersectsDemand.componentContacts.length > 0);
    assert.ok(intersectsDemand.nonSurfaceGraphicalContacts.length > 0);
    assert.equal(intersectsDemand.completeHumanHeadroomApproved, false);
    assert.equal(stations.completeContinuousWalkingHeadroomApproved, false);
    assert.equal(stations.routeApproved, false);
    assert.ok(stations.treads.some((t) => t.conservativeFaceDomainDemand));
    assert.ok(stations.positiveTreadStationOverlapCount > 0);
    assert.equal(sha(bytes), fixture.sourceModelSha256);
  },
);

test("a hole edge leaving a concave original shell between boundary-contact vertices refuses", () => {
  const q = (p: number[]) =>
    p.map(rational) as [
      ReturnType<typeof rational>,
      ReturnType<typeof rational>,
    ];
  const shell = [
      [0, 0],
      [6, 0],
      [6, 6],
      [4, 6],
      [4, 2],
      [2, 2],
      [2, 6],
      [0, 6],
    ].map(q),
    badHole = [
      [1, 4],
      [2, 5],
      [4, 5],
      [5, 4],
      [4, 3],
      [2, 3],
    ].map(q);
  assert.equal(
    originalSourceReferenceHolesContained([[shell, badHole]]),
    false,
  );
  assert.equal(
    originalSourceReferenceHolesContained([
      [
        shell,
        [
          [0.25, 0.25],
          [1, 0.25],
          [1, 1],
          [0.25, 1],
        ].map(q),
      ],
    ]),
    true,
  );
});
