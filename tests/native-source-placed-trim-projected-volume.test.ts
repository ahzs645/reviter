import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
} from "../lib/reviter/revit-2027-grep-replay.ts";
import { inspectOriginalPlacedTrimProjectedVolume } from "../lib/reviter/native-source-placed-trim-projected-volume.ts";
import { inspectPlacedTrimObstacleBranches } from "../lib/reviter/native-source-placed-trim-obstacles.ts";
import { originalTwoFootStandingSquare } from "../lib/reviter/native-source-standing-footprint.ts";
import { exactClosedSourcePlanarContact } from "../lib/reviter/native-source-planar-slab-envelope.ts";
import { projectStatedTwoFootWalkingVolume } from "../lib/reviter/native-source-walking-volume.ts";
import {
  Rational,
  rational,
  type NativeRationalParts,
} from "../lib/reviter/native-rational-overlay.ts";
import type { Revit2027GeometryStatic } from "../lib/reviter/revit-2027-geometry.ts";
import type { Revit2027FaceStatic } from "../lib/reviter/revit-2027-face-static.ts";
const directory = new URL("./fixtures/", import.meta.url);
const provenance = JSON.parse(
  readFileSync(
    new URL("native-original-door-projected-volume-provenance.json", directory),
    "utf8",
  ),
) as { rows: { name: string; sha256: string }[] };
function replay(id: number) {
  const name =
      id === 908922
        ? "native-original-door-908922.grep.bin"
        : "native-original-door-symbol-788064.grep.bin",
    bytes = readFileSync(new URL(name, directory));
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    provenance.rows.find((r) => r.name === name)!.sha256,
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length),
    root = decodeRevit2027FramedGRepRoot(
      bytes,
      {
        offset: 0,
        elementId: id,
        marker: 2246,
        objectLength: view.getUint32(12, true),
        typeCode: view.getUint32(18, true),
      },
      2027,
    );
  assert(root.ok);
  const r = replayRevit2027GRepFifo(bytes, root.value);
  assert(r.ok);
  return r.value;
}
const foot = rational(14.435695538057743),
  head = new Rational(foot.n + 6n * foot.d, foot.d),
  point: [number, number, number] = [
    114.74448177496802, -122.88462533961184, 14.435695538057743,
  ],
  opposite: [number, number, number] = [
    113.61801617525913, -122.35842723840072, 14.435695538057743,
  ],
  square = (x = point[0], y = point[1]) =>
    originalTwoFootStandingSquare([rational(x), rational(y)]),
  demand = (footprintFeet = square(), maximumElevationFeet = head) => ({
    footprintFeet,
    minimumElevationFeet: foot,
    maximumElevationFeet,
  }),
  snapshot = (v: unknown) =>
    JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));
function value<T>(r: Revit2027GRepReplay, reader: string, token: number): T {
  return r.spans.find(
    (s) => s.readerId === reader && s.propertyToken === token,
  )!.value as T;
}
test("actual full-height original standing demand clears both complete U frames while retaining the closed panel", () => {
  const a = replay(908922),
    b = replay(788064),
    before = snapshot([a, b]),
    old = inspectPlacedTrimObstacleBranches(a, b);
  assert(old.ok);
  assert(
    old.components.every((c) =>
      exactClosedSourcePlanarContact(square(), c.outerPlanEnvelope),
    ),
  );
  const r = inspectOriginalPlacedTrimProjectedVolume(a, b, demand());
  assert(r.ok);
  assert.deepEqual(
    r.components.map((c) => [
      c.originalGeometryToken,
      c.allOriginalProjectedBoundaryFacesDisjoint,
    ]),
    [
      [49, true],
      [50, true],
      [51, false],
    ],
  );
  assert.equal(r.completeStatedFullVolumeDisjoint, false);
  assert.equal(r.allOriginalPhysicalComponentsRetained, true);
  assert.equal(
    r.components.reduce((n, c) => n + c.completeOriginalFaceCount, 0),
    26,
  );
  assert.equal(
    r.components.reduce((n, c) => n + c.completeOriginalClosedEdgeCount, 0),
    60,
  );
  assert.equal(r.allFull3DWorldCornersFeet.length, 8);
  assert.equal(r.originalHatchTokens.length, 26);
  assert.equal(r.originalFreeGraphicsTokens.length, 32);
  assert.equal(r.retainedOriginalFalseFilterCount, 6);
  assert.equal(r.originalMaterialOmitted, false);
  assert.equal(r.originalSourceAuthorityGranted, false);
  assert.equal(r.physicalBodyRepresentationAdmitted, false);
  assert.equal(r.operationalDoorRoleApproved, false);
  assert.equal(r.arrivalApproved, false);
  assert.equal(r.routeApproved, false);
  assert.equal(snapshot([a, b]), before);
});
test("the original full-width crossing retains all six feet of height and the separate panel veto", () => {
  const strip = projectStatedTwoFootWalkingVolume(
      point,
      opposite,
      foot,
      head,
      6,
    ).unclippedStatedStripFeet,
    r = inspectOriginalPlacedTrimProjectedVolume(
      replay(908922),
      replay(788064),
      demand([[strip]]),
    );
  assert(r.ok);
  assert.deepEqual(
    r.components.map((c) => c.allOriginalProjectedBoundaryFacesDisjoint),
    [true, true, false],
  );
  assert.equal(r.completeStatedFullVolumeDisjoint, false);
  assert.equal(r.allFull3DWorldCornersFeet.length, strip.length * 2);
  assert.equal(r.originalClosedWorldElevationBandFeet[0], foot);
  assert.equal(r.originalClosedWorldElevationBandFeet[1], head);
});
test("jamb and lintel contacts refuse, and omitting the full Z band cannot clear the frame", () => {
  const a = replay(908922),
    b = replay(788064),
    tall = inspectOriginalPlacedTrimProjectedVolume(
      a,
      b,
      demand(square(), new Rational(foot.n + 8n * foot.d, foot.d)),
    );
  assert(tall.ok);
  assert(
    tall.components
      .slice(0, 2)
      .every((c) => !c.allOriginalProjectedBoundaryFacesDisjoint),
  );
  const jamb = inspectOriginalPlacedTrimProjectedVolume(
    a,
    b,
    demand(square(point[0], -124.3)),
  );
  assert(jamb.ok);
  assert(
    jamb.components
      .slice(0, 2)
      .every((c) => !c.allOriginalProjectedBoundaryFacesDisjoint),
  );
  const emptyBand = inspectOriginalPlacedTrimProjectedVolume(
    a,
    b,
    demand(square(), foot),
  );
  assert.equal(emptyBand.ok, false);
});
test("another exact projection can prove an outside full volume clear without dropping any source body", () => {
  const r = inspectOriginalPlacedTrimProjectedVolume(
    replay(908922),
    replay(788064),
    demand(square(120, point[1])),
    [1, 2],
  );
  assert(r.ok);
  assert.equal(r.completeStatedFullVolumeDisjoint, true);
  assert.equal(r.components.length, 3);
  assert.equal(r.allOriginalPhysicalComponentsRetained, true);
  assert.equal(r.routeApproved, false);
});
test("unknown native Geometry, Face, edge branches and missing physical faces refuse", () => {
  const a = replay(908922);
  for (const mutate of [
    (b: Revit2027GRepReplay) => {
      value<Revit2027GeometryStatic>(b, "Revit2027Geometry", 51).flags = 999;
    },
    (b: Revit2027GRepReplay) => {
      value<Revit2027FaceStatic>(b, "Revit2027Face", 56).faceFlags = 512;
    },
    (b: Revit2027GRepReplay) => {
      value<{ queuedPropertyCount: number }>(
        b,
        "Revit2027GEdge",
        66,
      ).queuedPropertyCount = 1;
    },
    (b: Revit2027GRepReplay) => {
      b.spans = b.spans.filter(
        (s) => !(s.readerId === "Revit2027Face" && s.propertyToken === 56),
      );
    },
  ]) {
    const b = replay(788064);
    mutate(b);
    const r = inspectOriginalPlacedTrimProjectedVolume(a, b, demand());
    assert.equal(r.ok, false);
    assert.equal(r.routeApproved, false);
  }
});
test("foreign twins, nonclosed or hole-loop branches and hole-bearing requests never become empty clearance", () => {
  const a = replay(908922);
  for (const mutate of [
    (b: Revit2027GRepReplay) => {
      value<{ faceReferences: number[] }>(
        b,
        "Revit2027GEdge",
        66,
      ).faceReferences[0] = 999999;
    },
    (b: Revit2027GRepReplay) => {
      value<{ open: boolean }>(b, "Revit2027EdgeLoop", 158).open = true;
    },
    (b: Revit2027GRepReplay) => {
      value<{ nextLoop: { token: number } }>(
        b,
        "Revit2027EdgeLoop",
        158,
      ).nextLoop.token = 161;
    },
  ]) {
    const b = replay(788064);
    mutate(b);
    assert.equal(
      inspectOriginalPlacedTrimProjectedVolume(a, b, demand()).ok,
      false,
    );
  }
  const withHole: NativeRationalParts = [[square()[0]![0]!, square()[0]![0]!]];
  assert.equal(
    inspectOriginalPlacedTrimProjectedVolume(
      a,
      replay(788064),
      demand(withHole),
    ).ok,
    false,
  );
});
