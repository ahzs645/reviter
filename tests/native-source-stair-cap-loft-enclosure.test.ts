import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { inspectOriginalStairCapLoftEnclosure } from "../lib/reviter/native-source-stair-cap-loft-enclosure.ts";
import { inspectOriginalStairLocalMaterialCells } from "../lib/reviter/native-source-stair-local-material.ts";
import { Rational, rational } from "../lib/reviter/native-rational-overlay.ts";
import { nativeConservativeTwoFootStation } from "../lib/reviter/native-source-stair-stepped-stations.ts";
import { projectStatedTwoFootWalkingVolume } from "../lib/reviter/native-source-walking-volume.ts";
import { exactClosedSourcePlanarContact } from "../lib/reviter/native-source-planar-slab-envelope.ts";
import type { OriginalPlanarMaterialCell } from "../lib/reviter/native-source-planar-slab-envelope.ts";
import type { Revit2027GRepReplay } from "../lib/reviter/revit-2027-grep-replay.ts";
import type { Revit2027PlaneSurface } from "../lib/reviter/revit-2027-surfaces.ts";
import { revit2027OwnerMeshIndex } from "../lib/reviter/revit-2027-owner-mesh-index.ts";

type Fixture = {
  originalReplay: Revit2027GRepReplay;
  sourceFrameSha256s: Record<string, string>;
  retainedOriginalReceiptSha256: string;
  sourceAuthorityRestored: false;
};
const bytes = readFileSync(
  new URL(
    "./fixtures/native-original-stair-cap-loft-1294069.json.gz",
    import.meta.url,
  ),
);
assert.equal(
  createHash("sha256").update(bytes).digest("hex"),
  "8cc9a2d00a5a8fd2d39eff165ea98b3711e432ad2fe4c3bbaa3871811b6f9d4a",
);
function fixture(): Fixture {
  const value = JSON.parse(
    gunzipSync(bytes).toString(),
    (key: string, value: unknown) =>
      ["ownerElementId", "gStyleElementId"].includes(key) &&
      typeof value === "string" &&
      /^-?\d+$/.test(value)
        ? BigInt(value)
        : value,
  ) as Fixture;
  assert.equal(
    value.sourceFrameSha256s["1294069:2246"],
    "8d5b1ccdde435b270aaea60d6870a1742eb23667bc73af5eef73ad7ee69f08cd",
  );
  assert.equal(
    value.retainedOriginalReceiptSha256,
    "a69db7c71f05b4316f9297decf7d08256740d00e1ad8f82aacb6f7126ef2a52a",
  );
  assert.equal(value.sourceAuthorityRestored, false);
  assert.equal(value.originalReplay.spans.length, 1555);
  return value;
}
const cmp = (a: Rational, b: Rational) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const a = [-89.03565010481346, 179.1429875424028, 9.02230971128609].map(
  rational,
) as [Rational, Rational, Rational];
const b = [-89.86771463994253, 179.38085905569034, 9.02230971128609].map(
  rational,
) as [Rational, Rational, Rational];
const top = rational(9.473425196850393);
const lateral = nativeConservativeTwoFootStation(
  [b[0], b[1]],
  [0.27486939661585746, 0.961481572784437],
);
function goContact(cell: OriginalPlanarMaterialCell) {
  const p = projectStatedTwoFootWalkingVolume(
    a,
    b,
    cell.minimumElevationFeet,
    cell.maximumElevationFeet,
    6,
  );
  return (
    p.possibleClosedProjectionFeet.length > 0 &&
    exactClosedSourcePlanarContact(
      p.positiveProjectionArea ? [[p.possibleClosedProjectionFeet]] : [],
      cell.partsFeet,
      cell.closedSegmentsFeet,
      p.positiveProjectionArea ? [] : [p.possibleClosedProjectionFeet],
    )
  );
}
function riseContact(cell: OriginalPlanarMaterialCell) {
  return (
    cmp(cell.maximumElevationFeet, b[2]) >= 0 &&
    cmp(cell.minimumElevationFeet, new Rational(top.n + 6n * top.d, top.d)) <=
      0 &&
    exactClosedSourcePlanarContact(
      [],
      cell.partsFeet,
      cell.closedSegmentsFeet,
      [lateral],
    )
  );
}

test("complete actual original 51-component replay yields only a conditional boundary-family enclosure", () => {
  const source = fixture().originalReplay,
    report = inspectOriginalStairCapLoftEnclosure(source);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.completeStatedBoundaryFamilyEnclosure, true);
  assert.equal(report.components.length, 51);
  assert.equal(
    new Set(report.components.flatMap((c) => c.originalFaceTokens)).size,
    revit2027OwnerMeshIndex(source).faces.size,
  );
  assert.equal(
    (report.originalGeometryGInfo as { controlCommand: number }).controlCommand,
    151720025,
  );
  assert.equal(report.sourceBodyQualificationRequired, true);
  assert.equal(report.originalSourceAuthorityGranted, false);
  assert.equal(report.exactClosedPhysicalBodyApproved, false);
  assert.equal(report.supportApproved, false);
  assert.equal(report.routeApproved, false);
});

test("actual concave tread14 retains every side/embedding while avoiding the old core's two excess contacts", () => {
  const source = fixture().originalReplay,
    local = inspectOriginalStairLocalMaterialCells(source),
    report = inspectOriginalStairCapLoftEnclosure(source),
    component = report.components.find((c) => c.topCapFaceToken === 178)!;
  assert.ok(component);
  assert.deepEqual(
    [...component.originalFaceTokens].sort((a, b) => a - b),
    [178, 179, 180, 181, 182, 183, 184, 185, 186, 187],
  );
  assert.equal(component.topToBottomVertexEdges.length, 8);
  assert.equal(component.sides.length, 8);
  assert.equal(component.edgeEmbeddingHulls.length, 16);
  const old = local.cells.find(
    (c) =>
      c.sourceComponentIndex === component.sourceComponentIndex &&
      c.role === "cap-bounded-core",
  )!;
  assert.equal(goContact(old), true);
  assert.equal(riseContact(old), true);
  const replacements = report.cells.filter(
    (c) => c.sourceComponentIndex === component.sourceComponentIndex,
  );
  assert.equal(replacements.some(goContact), false);
  assert.equal(replacements.some(riseContact), false);
  const oldBoundaries = local.cells.filter(
    (c) => c.role === "original-boundary-domain",
  );
  const keptBoundaries = report.cells
    .filter((c) => c.enclosureRole === "unchanged-source-boundary")
    .map(({ enclosureRole, ...cell }) => {
      assert.equal(enclosureRole, "unchanged-source-boundary");
      return cell;
    });
  assert.deepEqual(keptBoundaries, oldBoundaries);
});

test("positive source side-height residual remains an explicit shadow without raising the cap-band lid", () => {
  const source = fixture().originalReplay,
    base = inspectOriginalStairCapLoftEnclosure(source),
    component = base.components.find((c) => c.topCapFaceToken === 178)!,
    mesh = revit2027OwnerMeshIndex(source),
    edge = mesh.edges.get(component.sides[0]!.topEdgeToken)!,
    side = edge.faceReferences[0] === 178 ? 1 : 0,
    face = edge.faceReferences[side]!,
    span = source.spans.find(
      (s) =>
        s.readerId === "Revit2027AnalyticSurface:634" &&
        s.parentReplayIndex !== null &&
        source.spans[s.parentReplayIndex]?.propertyToken === face,
    )!,
    plane = span.value as Revit2027PlaneSurface,
    axis = plane.xVector[2] !== 0 ? 0 : 1,
    uv = side
      ? edge.firstAndLastEdgePoints[0].secondFaceUv
      : edge.firstAndLastEdgePoints[0].firstFaceUv;
  (uv as [number, number])[axis]! +=
    (plane.xVector[2] || plane.yVector[2]) > 0 ? 2 ** -20 : -(2 ** -20);
  const report = inspectOriginalStairCapLoftEnclosure(source);
  assert.deepEqual(report.blockers, []);
  const core = report.cells.find(
    (c) =>
      c.sourceComponentIndex === component.sourceComponentIndex &&
      c.enclosureRole === "cap-band-boundary-shadow",
  )!;
  assert.deepEqual(
    core.maximumElevationFeet,
    component.originalCapHeightBand[1],
  );
  const residuals = report.cells.filter(
    (c) =>
      c.sourceComponentIndex === component.sourceComponentIndex &&
      c.enclosureRole === "residual-boundary-shadow",
  );
  assert.ok(
    residuals.some(
      (c) => cmp(c.maximumElevationFeet, core.maximumElevationFeet) > 0,
    ),
  );
  const interior = [
    [
      [
        [-94, 180],
        [-92, 180],
        [-92, 182],
        [-94, 182],
      ].map((p) => p.map(rational) as [Rational, Rational]),
    ],
  ];
  assert.equal(
    residuals.some((c) =>
      exactClosedSourcePlanarContact(
        interior,
        c.partsFeet,
        c.closedSegmentsFeet,
      ),
    ),
    false,
  );
});

test("holes, curves, foreign ownership, stale incidence, unknown branches and queued operands refuse", () => {
  for (const mutation of [
    "hole",
    "curve",
    "foreign",
    "stale",
    "cross-component",
    "unknown",
    "queued",
    "omitted",
    "shared",
  ] as const) {
    const source = fixture().originalReplay,
      index = revit2027OwnerMeshIndex(source);
    if (mutation === "hole")
      index.loops.values().next().value!.loop.nextLoop.token = 99;
    if (mutation === "curve") {
      const edge = index.edges.values().next().value!;
      (
        edge.interiorEdgePoints as Array<
          (typeof edge.interiorEdgePoints)[number]
        >
      ).push(structuredClone(edge.firstAndLastEdgePoints[0]));
    }
    if (mutation === "foreign") source.spans[1]!.ownerElementId = 999n;
    if (mutation === "stale")
      index.loops.values().next().value!.loop.faceReference = 999;
    if (mutation === "cross-component")
      (
        index.edges.values().next().value!.faceReferences as [number, number]
      )[0] = 178;
    if (mutation === "unknown") source.spans[0]!.readerId = "UnknownGeometry";
    if (mutation === "queued")
      (
        source.spans[0]!.value as { queuedProperties: unknown[] }
      ).queuedProperties = [{}];
    if (mutation === "omitted")
      (source.spans as Array<(typeof source.spans)[number]>).splice(1, 1);
    if (mutation === "shared")
      (
        source.spans[0]!.value as { sharedSurfaceInfo: { count: number } }
      ).sharedSurfaceInfo.count = 1;
    const report = inspectOriginalStairCapLoftEnclosure(source);
    assert.equal(report.completeStatedBoundaryFamilyEnclosure, false, mutation);
    assert.ok(report.blockers.length, mutation);
    assert.deepEqual(report.cells, [], mutation);
    assert.equal(report.originalSourceAuthorityGranted, false);
  }
});
