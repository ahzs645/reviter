import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { originalStairPlanarFaceReversal } from "../lib/reviter/native-source-stair-face-orientation.ts";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "../lib/reviter/revit-2027-grep-replay.ts";
import { revit2027OwnerMeshIndex, revit2027OwnerSurface } from "../lib/reviter/revit-2027-owner-mesh-index.ts";
import { inspectOriginalStairSupportEnvelopes } from "../lib/reviter/native-source-stair-support-envelopes.ts";
import { inspectOriginalStairLocalMaterialCells } from "../lib/reviter/native-source-stair-local-material.ts";
import { inspectPlanarPrismReplayGeometry } from "../lib/reviter/native-source-stair-solid-proof.ts";
import type { Revit2027PlaneSurface } from "../lib/reviter/revit-2027-surfaces.ts";
const fixtures = [
  { id: 1693336, sha: "91a8f3804472085996880d1c8a7c6de7166d80dde0008809792c4f036c4d0d11", faces: 296, components: 49, side: 148 },
  { id: 2349455, sha: "9062468891d2f6c4cd00842fa78e734ae6c975c8503508c8c9a8fa00198e29aa", faces: 188, components: 31, side: 76 },
];
function replay(fixture: (typeof fixtures)[number]) {
  const bytes = readFileSync(new URL(`./fixtures/native-original-flags6-side-${fixture.id}.bin`, import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), fixture.sha);
  const root = decodeRevit2027FramedGRepRoot(bytes, {
    offset: 0, elementId: fixture.id, marker: 2246,
    objectLength: bytes.readUInt32LE(12), typeCode: bytes.readUInt32LE(18),
  }, 2027);
  assert.ok(root.ok);
  const result = replayRevit2027GRepFifo(bytes, root.value);
  assert.ok(result.ok);
  return result.value;
}
const encode = (v: unknown) => JSON.stringify(v, (_, x) => typeof x === "bigint" ? x.toString() : x);
test("only a nondegenerate exactly vertical original planar side admits the reversal bit", () => {
  const source = replay(fixtures[0]!), plane = revit2027OwnerSurface<Revit2027PlaneSurface>(revit2027OwnerMeshIndex(source), 634, 148)!;
  assert.equal(originalStairPlanarFaceReversal(6, plane), -1);
  assert.equal(originalStairPlanarFaceReversal(4, plane), 1);
  for (const flags of [0, 2, 5, 7, 18, 36]) assert.equal(originalStairPlanarFaceReversal(flags, plane), undefined);
  const horizontal = structuredClone(plane);
  horizontal.xVector = [1, 0, 0]; horizontal.yVector = [0, 1, 0];
  assert.equal(originalStairPlanarFaceReversal(6, horizontal), undefined);
  assert.equal(originalStairPlanarFaceReversal(4, horizontal), 1);
  const almostVertical = structuredClone(plane);
  almostVertical.xVector = [0, Number.MIN_VALUE, 1];
  assert.equal(originalStairPlanarFaceReversal(6, almostVertical), undefined);
  const singular = structuredClone(plane);
  singular.yVector = [...singular.xVector];
  assert.equal(originalStairPlanarFaceReversal(6, singular), undefined);
  const nonfinite = structuredClone(plane);
  nonfinite.origin = [Infinity, nonfinite.origin[1], nonfinite.origin[2]];
  assert.equal(originalStairPlanarFaceReversal(6, nonfinite), undefined);
});
for (const fixture of fixtures) {
  test(`exact original ${fixture.id} retains all caps and material while consuming its sole reversed vertical side`, () => {
    const source = replay(fixture), before = encode(source), index = revit2027OwnerMeshIndex(source);
    assert.equal(index.faces.size, fixture.faces);
    assert.deepEqual([...index.faces].filter(([, f]) => f.faceFlags !== 4).map(([token]) => token), [fixture.side]);
    const support = inspectOriginalStairSupportEnvelopes(source);
    assert.equal(support.completeOriginalStraightPlanarSourceCensus, true, encode(support.blockers));
    assert.equal(support.components.length, fixture.components);
    assert.equal(support.caps.length, fixture.components);
    assert.ok(support.sourceVerticesWithCompetingEmbeddings > 0);
    assert.ok(support.caps.every(c => index.faces.get(c.physicalFaceToken)!.faceFlags === 4));
    const material = inspectOriginalStairLocalMaterialCells(source);
    assert.equal(material.allOriginalFaceDomainsEnclosed, true, encode(material.blockers));
    assert.equal(new Set(material.cells.flatMap(c => c.originalFaceTokens)).size, fixture.faces);
    assert.deepEqual(material.blockers, []);
    assert.equal(inspectPlanarPrismReplayGeometry(source).completeExactPrismBody, false);
    assert.equal(support.exactClosedPhysicalBodyApproved, false);
    assert.equal(material.exactPhysicalBodyApproved, false);
    assert.equal(support.routeApproved, false);
    assert.equal(material.routeApproved, false);
    assert.equal(encode(source), before);
  });
  test(`exact original ${fixture.id} refuses unknown flags, reversed caps, extra queued material, foreign owners, missing faces and holes`, () => {
    for (const mutation of ["unknown", "horizontal", "queued", "foreign", "missing", "hole"] as const) {
      const source = replay(fixture), index = revit2027OwnerMeshIndex(source);
      if (mutation === "unknown") index.faces.get(fixture.side)!.faceFlags = 14;
      if (mutation === "horizontal") {
        const cap = [...index.faces].find(([token]) => {
          const p = revit2027OwnerSurface<Revit2027PlaneSurface>(index, 634, token)!;
          return p.xVector[2] === 0 && p.yVector[2] === 0;
        })!;
        cap[1].faceFlags = 6;
      }
      if (mutation === "queued") source.spans = [...source.spans, { ...structuredClone(source.spans[0]!), propertyToken: 999999, readerId: "Revit2027GFilling" }];
      if (mutation === "foreign") source.spans[0]!.ownerElementId = 1n;
      if (mutation === "missing") source.spans = source.spans.filter(s => !(s.readerId === "Revit2027Face" && s.propertyToken === fixture.side));
      if (mutation === "hole") index.loops.get(index.faces.get(fixture.side)!.firstLoop.token)!.loop.nextLoop.token = 999999;
      const refused = inspectOriginalStairSupportEnvelopes(source);
      assert.equal(refused.completeOriginalStraightPlanarSourceCensus, false, mutation);
      assert.ok(refused.blockers.length, mutation);
      assert.equal(refused.routeApproved, false);
    }
  });
}
