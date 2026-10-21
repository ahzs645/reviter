import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
} from "../lib/reviter/revit-2027-grep-replay.ts";
import {
  inspectOriginalNamedFloorCapSupport,
  inspectLocalFloorTwoFootStation,
  originalCylinderTrigEnclosure,
  inspectOriginalNativeFloorLocalSupport,
  validateOriginalNamedCapReference,
} from "../lib/reviter/native-source-floor-local-support.ts";
import {
  createOriginalNativeForeignEnvelopeCensus,
  type OriginalNativeForeignEnvelopeCensus,
} from "../lib/reviter/native-source-foreign-envelope-census.ts";
import {
  Rational,
  rational,
  nativeRationalOverlay,
} from "../lib/reviter/native-rational-overlay.ts";
import { createOriginalNativeStairPhysicalContext } from "../lib/reviter/native-source-stair-physical-inventory.ts";
import { inspectOriginalNativeStairFloorAttachment } from "../lib/reviter/native-source-stair-floor-attachment.ts";

const fixture = readFileSync(
  new URL("./fixtures/native-trimmed-floor-402395.bin", import.meta.url),
);
const modelSha =
  "8c294549ee667ed7aba38f1f4f3a53514dae7544af97f0157ee8187dd8702178";
function replay(): Revit2027GRepReplay {
  const root = decodeRevit2027FramedGRepRoot(
    fixture,
    {
      offset: 0,
      elementId: 402395,
      marker: 2246,
      objectLength: fixture.length - 20,
      typeCode: fixture.readUInt32LE(18),
    },
    2027,
  );
  assert.ok(root.ok);
  const result = replayRevit2027GRepFifo(fixture, root.value);
  assert.ok(result.ok);
  return result.value;
}
const cmp = (a: Rational, b: Rational) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const stringify = (v: unknown) =>
  JSON.stringify(v, (_, x) => (typeof x === "bigint" ? String(x) : x));
test("named trimmed cap retains all six holes and complete cylinder uncertainty, while reference planes grant no support", () => {
  const source = replay(),
    before = stringify(source),
    cap = inspectOriginalNamedFloorCapSupport(source, 249);
  assert.equal(cap.completeDeclaredFaceCount, 107);
  assert.equal(cap.completeDeclaredEdgeCount, 515);
  assert.equal(cap.originalCapLoopTokens.length, 7);
  assert.equal(cap.originalReferenceWindingPartsFeet[0]!.length, 7);
  assert.equal(cap.originalCapEdgeTokens.length, 103);
  assert.deepEqual(
    [...cap.originalCurvedCapEdgeTokens].sort(),
    [426, 427, 428],
  );
  assert.ok(cap.completeAnalyticCylinderUncertaintyPartsFeet.length);
  assert.deepEqual(
    nativeRationalOverlay(
      "difference",
      cap.guaranteedInnerSupportPartsFeet,
      cap.originalReferenceWindingPartsFeet,
    ),
    [],
  );
  const demand = inspectLocalFloorTwoFootStation(
    cap,
    [0.5148043399884723, -323.3025630530456],
    "y",
    24.278215223097114,
  );
  assert.equal(demand.fullTwoFootStationWithinGuaranteedOriginalSupport, true);
  assert.equal(demand.retainedBoundaryUncertaintyContact, false);
  assert.equal(demand.exactOriginalTerminalHeightContact, false);
  const explicit = inspectLocalFloorTwoFootStation(
    cap, [0.5148043399884723, -323.3025630530456], [0, 8],
    24.278215223097114,
  );
  assert.equal(explicit.fullTwoFootStationWithinGuaranteedOriginalSupport, true);
  assert.deepEqual(explicit.originalTwoFootLateralEndpointsFeet, demand.originalTwoFootLateralEndpointsFeet);
  assert.equal(explicit.routeApproved, false);
  assert.equal(
    inspectLocalFloorTwoFootStation(
      cap, [0.5148043399884723, -323.3025630530456], [1, 1],
      24.278215223097114,
    ).fullTwoFootStationWithinGuaranteedOriginalSupport,
    false,
    "a wider diagonal demand cannot silently use the narrower supported axis station",
  );
  assert.equal(
    inspectLocalFloorTwoFootStation(cap, [-5, -320], [1, 1], 24.278215223097114)
      .fullTwoFootStationWithinGuaranteedOriginalSupport,
    false,
    "an oriented station cannot cover the original stair hole",
  );
  for (const invalid of [[0, 0], [Infinity, 1], []]) assert.throws(
    () => inspectLocalFloorTwoFootStation(
      cap, [0.5148043399884723, -323.3025630530456],
      invalid as [number, number], 24.278215223097114,
    ), /station direction/,
  );
  assert.ok(demand.physicalMinusNominalElevationFeet.n > 0n);
  assert.equal(
    inspectLocalFloorTwoFootStation(cap, [-5, -320], "y", 24.278215223097114)
      .fullTwoFootStationWithinGuaranteedOriginalSupport,
    false,
    "actual stair hole must remain unsupported",
  );
  assert.equal(
    inspectLocalFloorTwoFootStation(
      cap,
      [0.5148043399884723, -323.3025630530456],
      "y",
      24.27821522309713,
    ).exactOriginalTerminalHeightContact,
    true,
  );
  assert.equal(cap.wholeFloorSolidApproved, false);
  assert.equal(cap.originalSourceAuthorityGranted, false);
  assert.equal(demand.terminalContactApproved, false);
  assert.equal(demand.routeApproved, false);
  for (const token of [210, 211, 250])
    assert.throws(
      () => inspectOriginalNamedFloorCapSupport(source, token),
      /physical cap/,
    );
  assert.equal(stringify(source), before);
});
test("missing hole, duplicate source, unowned cap fill or unknown scoped branch cannot be repaired into support", () => {
  for (const defect of ["hole", "duplicate", "fill", "branch"]) {
    const source = replay();
    if (defect === "hole")
      (
        source.spans.find((s) => s.propertyToken === 942)!.value as {
          nextLoop: { token: number };
        }
      ).nextLoop.token = 0;
    if (defect === "duplicate")
      source.spans = [
        ...source.spans,
        structuredClone(source.spans.find((s) => s.propertyToken === 944)!),
      ];
    if (defect === "fill")
      (
        source.spans.find((s) => s.propertyToken === 943)!.value as {
          faceIdReference: number;
        }
      ).faceIdReference = 210;
    if (defect === "branch") {
      const span = structuredClone(
        source.spans.find((s) => s.propertyToken === 943)!,
      );
      span.propertyToken = 100000;
      span.readerId = "UnknownCapOperand";
      source.spans = [...source.spans, span];
    }
    assert.throws(
      () => inspectOriginalNamedFloorCapSupport(source, 249),
      /original|Original/,
    );
  }
});
test("a complete original curved boundary enclosure touching a station vetoes its local support", () => {
  const source = replay(),
    span = source.spans.find(
      (s) => s.readerId === "Revit2027AnalyticSurface:1144",
    )!,
    cylinder = span.value as { center: number[]; radius: number };
  // The retained angular domain contains the west-facing arc (including pi).
  // Put that arc on the station; the circle center itself is not its boundary.
  cylinder.center[0] = 0.5148043399884723 + 2;
  cylinder.center[1] = -323.3025630530456;
  cylinder.radius = 2;
  const cap = inspectOriginalNamedFloorCapSupport(source, 249),
    station = inspectLocalFloorTwoFootStation(
      cap,
      [0.5148043399884723, -323.3025630530456],
      "y",
      24.278215223097114,
    );
  assert.equal(station.retainedBoundaryUncertaintyContact, true);
  assert.equal(
    station.fullTwoFootStationWithinGuaranteedOriginalSupport,
    false,
  );
  assert.equal(cap.originalCurvedCapEdgeTokens.length, 3);
  assert.equal(station.routeApproved, false);
});
test("rational Taylor bounds enclose independent high precision sin(1)/cos(1) values without an epsilon", () => {
  const bounds = originalCylinderTrigEnclosure(1),
    scale = 10n ** 50n;
  const refs = {
    sine: 84147098480789650665250232163029899962256306079837n,
    cosine: 54030230586813971740093660744297660373231042061792n,
  };
  for (const k of ["sine", "cosine"] as const) {
    const low = new Rational(refs[k], scale),
      high = new Rational(refs[k] + 1n, scale);
    assert.ok(cmp(bounds[k][0], low) < 0);
    assert.ok(cmp(bounds[k][1], high) > 0);
  }
  const zero = originalCylinderTrigEnclosure(0);
  assert.equal(cmp(zero.sine[0], rational(0)), 0);
  assert.equal(cmp(zero.cosine[1], rational(1)), 0);
  // The separate exact degree64 reader now supports literal angles up to16.
  assert.equal(originalCylinderTrigEnclosure(9).degree, 64);
  for (const angle of [16.01, -16.01, Infinity, -Infinity])
    assert.throws(() => originalCylinderTrigEnclosure(angle), /angle/);
  assert.throws(() => originalCylinderTrigEnclosure(NaN), /angle/);
});
test("copied census data cannot create actual original floor support operands", () => {
  assert.throws(
    () =>
      inspectOriginalNativeFloorLocalSupport(
        { sourceModelSha256: modelSha } as OriginalNativeForeignEnvelopeCensus,
        402395,
        249,
      ),
    /Untrusted/,
  );
});
test("a hole chord leaving a concave shell through boundary-contact vertices is refused", () => {
  const ring = (points: number[][]) =>
    points.map(
      (p) => [rational(p[0]!), rational(p[1]!)] as [Rational, Rational],
    );
  const shell = ring([
      [0, 0],
      [6, 0],
      [6, 6],
      [4, 6],
      [4, 2],
      [2, 2],
      [2, 6],
      [0, 6],
    ]),
    hole = ring([
      [2, 4],
      [4, 4],
      [5, 3],
      [5, 1],
      [1, 1],
      [1, 3],
    ]);
  assert.throws(
    () => validateOriginalNamedCapReference([[shell, hole]]),
    /hole edge leaves/i,
  );
});
test(
  "fresh full original RVT binds the named trimmed cap to its actual Floor, category, model, schema and source frames",
  { skip: !process.env.UNBC_ORIGINAL_RVT },
  () => {
    const bytes = readFileSync(process.env.UNBC_ORIGINAL_RVT!),
      census = createOriginalNativeForeignEnvelopeCensus(bytes, modelSha, {
        min: { x: -15, y: -328, z: 23 },
        max: { x: 3, y: -300, z: 41 },
      }),
      cap = inspectOriginalNativeFloorLocalSupport(
        census.certificate,
        402395,
        249,
      );
    assert.equal(cap.sourceBoundOriginalOperands, true);
    assert.equal(cap.sourceModelSha256, modelSha);
    assert.equal(
      cap.sourceSchemaSha256,
      "d961c44726fe7fc32bce4425639481a5d5e91acecec7b7fd897610fc369f046f",
    );
    assert.equal(
      cap.originalGElementFrameSha256,
      "c01d52b70d26f37727f2de7bb7c524c3551878d73d6b708ebf0bbffcefd020e5",
    );
    const station = inspectLocalFloorTwoFootStation(
      cap,
      [0.5148043399884723, -323.3025630530456],
      "y",
      24.278215223097114,
    );
    assert.equal(
      station.fullTwoFootStationWithinGuaranteedOriginalSupport,
      true,
    );
    assert.equal(station.exactOriginalTerminalHeightContact, false);
    assert.equal(cap.routeApproved, false);
    const stairSource = createOriginalNativeStairPhysicalContext(
      bytes,
      modelSha,
      [
        {
          nativeStairId: 1696006,
          nativeRunId: 1696012,
          nativeDefinitionId: 1696013,
        },
      ],
    );
    const demand = {
      originalLogicalGraphNodeId: "untrusted-test-demand",
      originalLogicalPointFeet: [
        0.5148043399884723, -323.3025630530456, 24.278215223097114,
      ] as const,
      nativeFloorElementId: 402395,
      originalTrimmedFloorFaceToken: 249,
      lateralAxis: "y" as const,
      runTerminal: "lower" as const,
    };
    const attachment = inspectOriginalNativeStairFloorAttachment(
      census.certificate,
      stairSource,
      1696012,
      demand,
    );
    assert.equal(
      attachment.requestedStationHasOriginalNamedLevelAndSupport,
      true,
    );
    assert.equal(attachment.originalNativeServedLevelId, 400176);
    assert.deepEqual(attachment.originalParentRunAndLandingList, []);
    assert.equal(attachment.originalParentRunAndLandingListIncludesRun, false);
    assert.equal(attachment.logicalAndPhysicalPointsHaveExactlySameXY, true);
    assert.equal(attachment.originalGraphCoordinatesChanged, false);
    assert.equal(
      attachment.addedWalkingSegmentBetweenLogicalAndPhysicalPoints,
      false,
    );
    assert.equal(attachment.exactOriginal3DTerminalContactClaimed, false);
    assert.equal(attachment.routeApproved, false);
    assert.equal(
      attachment.completeNamedLogicalToPhysicalAttachmentSourceProof,
      false,
    );
    assert.equal(attachment.originalLogicalGraphNodeIdentityVerified, false);
    assert.equal(attachment.originalSourceRunTerminalXYVerified, false);
    assert.equal(attachment.support.physicalMinusNominalElevationFeet.n, 5n);
    assert.equal(
      attachment.support.physicalMinusNominalElevationFeet.d,
      281474976710656n,
    );
    const wrongHeight = inspectOriginalNativeStairFloorAttachment(
      census.certificate,
      stairSource,
      1696012,
      {
        ...demand,
        originalLogicalPointFeet: [
          ...demand.originalLogicalPointFeet.slice(0, 2),
          24.688320209973753,
        ] as [number, number, number],
      },
    );
    assert.equal(
      wrongHeight.requestedStationHasOriginalNamedLevelAndSupport,
      false,
    );
    assert.equal(
      wrongHeight.unchangedLogicalHeightMatchesOriginalNominalRunHeight,
      false,
    );
    const wrongSide = inspectOriginalNativeStairFloorAttachment(
      census.certificate,
      stairSource,
      1696012,
      { ...demand, runTerminal: "upper" },
    );
    assert.equal(
      wrongSide.requestedStationHasOriginalNamedLevelAndSupport,
      false,
    );
    assert.equal(wrongSide.floorAndStairNamedLevelAgree, false);
    assert.throws(
      () =>
        inspectOriginalNativeFloorLocalSupport(
          census.certificate,
          1696013,
          249,
        ),
      /Floor semantic/,
    );
  },
);

test("actual upper slab flag516 cap requires its complete physical loops and preserves all six holes", () => {
  const frame = JSON.parse(
      readFileSync(
        new URL("./fixtures/native-original-slab-405772.json", import.meta.url),
        "utf8",
      ),
    ),
    bytes = Buffer.from(frame.frameHex, "hex"),
    root = decodeRevit2027FramedGRepRoot(
      bytes,
      {
        offset: 0,
        elementId: 405772,
        marker: 2246,
        objectLength: bytes.length - 20,
        typeCode: bytes.readUInt32LE(18),
      },
      2027,
    );
  assert.ok(root.ok);
  const decoded = replayRevit2027GRepFifo(bytes, root.value);
  assert.ok(decoded.ok);
  const cap = inspectOriginalNamedFloorCapSupport(decoded.value, 5);
  assert.equal(cap.completeDeclaredFaceCount, 129);
  assert.equal(cap.completeDeclaredEdgeCount, 381);
  assert.equal(cap.originalCapLoopTokens.length, 7);
  assert.equal(cap.originalReferenceWindingPartsFeet[0]!.length, 7);
  assert.equal(
    cmp(cap.originalPhysicalTopElevationFeet, rational(34.120734908136484)),
    0,
  );
  assert.equal(cap.wholeFloorSolidApproved, false);
  const changed = structuredClone(decoded.value),
    face = changed.spans.find(
      (s) => s.readerId === "Revit2027Face" && s.propertyToken === 5,
    )!.value as { faceFlags: number; firstLoop: { token: number } };
  assert.equal(face.faceFlags, 516);
  face.firstLoop.token = 0;
  assert.throws(
    () => inspectOriginalNamedFloorCapSupport(changed, 5),
    /physical cap/,
  );
});
