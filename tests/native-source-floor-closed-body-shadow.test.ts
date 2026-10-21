import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
} from "../lib/reviter/revit-2027-grep-replay.ts";
import {
  inspectOriginalFloorClosedBodyShadow,
  originalFloorClosedBodyShadowReplayFingerprint,
  inspectOriginalFloorCapTrimRoles,
} from "../lib/reviter/native-source-floor-closed-body-shadow.ts";
import { Rational } from "../lib/reviter/native-rational-overlay.ts";
import { originalTwoFootStandingSquare } from "../lib/reviter/native-source-standing-footprint.ts";

const originalBytes = readFileSync(
  new URL("./fixtures/native-original-floor-400238.2246.bin", import.meta.url),
);
assert.equal(
  createHash("sha256").update(originalBytes).digest("hex"),
  "77a78d22386ca530c07527909c33861299769ea1f523ff14bd141007bdf2354a",
);
function originalReplay(): Revit2027GRepReplay {
  const v = new DataView(
    originalBytes.buffer,
    originalBytes.byteOffset,
    originalBytes.length,
  );
  const root = decodeRevit2027FramedGRepRoot(
    originalBytes,
    {
      offset: 0,
      elementId: 400238,
      marker: 2246,
      objectLength: v.getUint32(12, true),
      typeCode: v.getUint32(18, true),
    },
    2027,
  );
  assert(root.ok);
  const replay = replayRevit2027GRepFifo(originalBytes, root.value);
  assert(replay.ok);
  return replay.value;
}
function request(replay: Revit2027GRepReplay) {
  // Original1293690 lower-standing:0, unchanged native feet and full2ft square.
  return {
    expectedNativeFloorElementId: 400238,
    expectedReplaySha256:
      originalFloorClosedBodyShadowReplayFingerprint(replay),
    footprintFeet: originalTwoFootStandingSquare([
      new Rational(-1420080726557715n, 17592186044416n),
      new Rational(3202904411879829n, 17592186044416n),
    ]),
    minimumElevationFeet: new Rational(0n),
    maximumElevationFeet: new Rational(6n),
  };
}

test("complete original400238 boundary family misses the unchanged standing volume without source admission", () => {
  const replay = originalReplay(),
    r = inspectOriginalFloorClosedBodyShadow(replay, request(replay));
  assert(r.ok, JSON.stringify(r.ok ? [] : r.blockers));
  assert.equal(r.completeBoundaryShadowDisjoint, true);
  assert.equal(r.originalFaceCount, 128);
  assert.equal(r.originalEdgeCount, 378);
  assert.equal(r.originalLoopCount, 130);
  assert.equal(r.sourceCaps.length, 2);
  assert(r.sourceCaps.every((c) => c.retainedOriginalHoleCount === 1));
  assert(
    r.sourceCaps.every(
      (c) =>
        c.originalNativeLoopRoles.filter((r) => r === "outer").length === 1 &&
        c.originalNativeLoopRoles.filter((r) => r === "hole").length === 1,
    ),
  );
  assert.equal(r.originalGInfoCommandsAndSelectionSemanticsQualified, false);
  assert(
    r.sourceCaps.every((c) =>
      c.uncertaintyCells.some(
        (v) =>
          v.kind === "complete-original-cap-reference-coedge-connector-ribbon",
      ),
    ),
  );
  assert.equal(
    r.sourceBoundaryShadowCells.filter(
      (c) => c.kind === "complete-original-cylinder-angular-subinterval",
    ).length,
    192,
  );
  assert(
    r.sourceBoundaryShadowCells.some(
      (c) => c.kind === "complete-original-abstract-vertex-embedding-cluster",
    ),
  );
  assert(
    r.sourceBoundaryShadowCells.some(
      (c) => c.kind === "complete-original-paired-straight-edge-ribbon",
    ),
  );
  assert.equal(
    (r.originalRootGeometryGInfo as { controlCommand: number }).controlCommand,
    67125251,
  );
  assert.equal(r.originalRootGeometryFlags, 7);
  assert.equal(r.sourceBodyQualificationRequired, true);
  assert.equal(r.coarseBodyMustRemainUntilSourceQualification, true);
  assert.equal(r.sourceAuthorityGranted, false);
  assert.equal(r.exactSewnSolidApproved, false);
  assert.equal(r.positiveFloorSupportApproved, false);
  assert.equal(r.routeApproved, false);
});

test("refuses a foreign original floor identity", () => {
  const replay = originalReplay(),
    q = request(replay);
  q.expectedNativeFloorElementId = 490040;
  const r = inspectOriginalFloorClosedBodyShadow(replay, q);
  assert.equal(r.ok, false);
  assert.equal(r.completeBoundaryShadowDisjoint, false);
});

test("retains original hole loops and refuses their omission", () => {
  const replay = originalReplay(),
    cap = replay.spans.find(
      (s) => s.readerId === "Revit2027Face" && s.propertyToken === 5,
    )!,
    first = (cap.value as { firstLoop: { token: number } }).firstLoop.token,
    loop = replay.spans.find((s) => s.propertyToken === first)!;
  (loop.value as { nextLoop: { token: number } }).nextLoop.token = 0;
  const r = inspectOriginalFloorClosedBodyShadow(replay, request(replay));
  assert.equal(r.ok, false);
  assert.equal(r.completeBoundaryShadowDisjoint, false);
});

test("refuses an omitted original material face rather than reuse a cap-only proof", () => {
  const replay = originalReplay(),
    g = replay.spans.find((s) => s.readerId === "Revit2027Geometry")!.value as {
      faces: { count: number; entries: unknown[] };
    };
  g.faces.count--;
  g.faces.entries.pop();
  const r = inspectOriginalFloorClosedBodyShadow(replay, request(replay));
  assert.equal(r.ok, false);
  assert.equal(r.completeBoundaryShadowDisjoint, false);
});

test("refuses stale topology even when owner and node coordinates are unchanged", () => {
  const replay = originalReplay(),
    q = request(replay),
    edge = replay.spans.find((s) => s.readerId === "Revit2027GEdge")!.value as {
      previousReferences: number[];
    };
  edge.previousReferences[0] = 0;
  const r = inspectOriginalFloorClosedBodyShadow(replay, q);
  assert.equal(r.ok, false);
  assert(!r.ok && r.blockers.some((b) => b.includes("Stale")));
});

test("unknown chain, surface, and edge branches keep the original coarse body", () => {
  for (const target of ["loop", "surface", "edge"]) {
    const replay = originalReplay();
    if (target === "loop") {
      const loop = replay.spans.find(
        (s) => s.readerId === "Revit2027EdgeLoop",
      )!;
      loop.readerId = "Revit2027EdgeLoopWithChainEnvelopes";
      loop.propertySourceClassSlot = 1437;
    } else if (target === "surface")
      replay.spans.find(
        (s) => s.readerId === "Revit2027AnalyticSurface:1144",
      )!.readerId = "Revit2027AnalyticSurface:unknown";
    else
      (
        replay.spans.find((s) => s.readerId === "Revit2027GEdge")!.value as {
          flags: number;
        }
      ).flags = 0x40;
    const r = inspectOriginalFloorClosedBodyShadow(replay, request(replay));
    assert.equal(r.ok, false);
    assert.equal(r.completeBoundaryShadowDisjoint, false);
    assert.equal(r.coarseBodyMustRemainUntilSourceQualification, true);
  }
});

test("a closed body interior cannot disappear between its horizontal boundary planes", () => {
  const replay = originalReplay();
  const q = request(replay);
  q.footprintFeet = originalTwoFootStandingSquare([
    new Rational(0n),
    new Rational(100n),
  ]);
  q.minimumElevationFeet = new Rational(-1n, 2n);
  q.maximumElevationFeet = new Rational(-1n, 4n);
  const r = inspectOriginalFloorClosedBodyShadow(replay, q);
  assert(r.ok);
  assert.equal(r.completeBoundaryShadowDisjoint, false);
  assert(
    r.sourceCaps.some(
      (c) =>
        Math.abs(c.windings[0]!) === 1 &&
        c.windings.slice(1).every((w) => w === 0),
    ),
  );
  assert.equal(r.allBoundaryShadowsExtrudedThroughFullComponentZBand, true);
  assert.equal(r.sourceBodyQualificationRequired, true);
});

function squareRing(minimum: number, maximum: number) {
  return [
    [minimum, minimum],
    [maximum, minimum],
    [maximum, maximum],
    [minimum, maximum],
  ].map(
    (p) =>
      [new Rational(BigInt(p[0]!)), new Rational(BigInt(p[1]!))] as [
        Rational,
        Rational,
      ],
  );
}
test("native UV roles never turn nested co-oriented filled loops into a void", () => {
  const outer = squareRing(0, 10),
    inner = squareRing(2, 8);
  assert.throws(
    () => inspectOriginalFloorCapTrimRoles([outer, inner], false, true),
    /filled contour/,
  );
  assert.throws(
    () => inspectOriginalFloorCapTrimRoles([outer, inner], true, true),
    /filled contour/,
  );
  const correct = inspectOriginalFloorCapTrimRoles(
    [outer, inner.toReversed()],
    false,
    true,
  );
  assert.deepEqual(correct.roles, ["outer", "hole"]);
  // Loop order supplies no material role.
  assert.deepEqual(
    inspectOriginalFloorCapTrimRoles([inner.toReversed(), outer], false, true)
      .roles,
    ["hole", "outer"],
  );
  assert.deepEqual(
    inspectOriginalFloorCapTrimRoles([outer.toReversed(), inner], true, true)
      .roles,
    ["outer", "hole"],
  );
});
test("native trim roles refuse non-simple, degenerate, touching, outside and nested holes", () => {
  const outer = squareRing(0, 10),
    hole = squareRing(2, 8).toReversed();
  for (const rings of [
    [outer, squareRing(12, 14).toReversed()],
    [outer, squareRing(0, 2).toReversed()],
    [outer, hole, squareRing(3, 4).toReversed()],
    [outer, [hole[0]!, hole[2]!, hole[1]!, hole[3]!]],
    [outer, [hole[0]!, hole[0]!, hole[0]!]],
  ])
    assert.throws(() => inspectOriginalFloorCapTrimRoles(rings, false, true));
});
test("refuses unordered original cylinder domains without sorting source bounds", () => {
  const replay = originalReplay();
  const surface = replay.spans.find(
    (s) => s.readerId === "Revit2027AnalyticSurface:1144",
  )!.value as {
    surface: {
      envelope: {
        firstCorner: [number, number];
        secondCorner: [number, number];
      };
    };
  };
  surface.surface.envelope.firstCorner[0] =
    surface.surface.envelope.secondCorner[0] + 1;
  const r = inspectOriginalFloorClosedBodyShadow(replay, request(replay));
  assert.equal(r.ok, false);
  assert(!r.ok && r.blockers.some((b) => b.includes("Unordered")));
});
