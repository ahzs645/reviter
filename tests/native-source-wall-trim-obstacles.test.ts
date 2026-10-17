import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
} from "../lib/reviter/revit-2027-grep-replay.ts";
import { inspectOriginalWallTrimObstacleBranches } from "../lib/reviter/native-source-wall-trim-obstacles.ts";
import {
  originalDirectWallTrimObstacleFacts,
  proveOriginalDirectWallTrimObstacleEnvelope,
} from "../lib/reviter/native-source-placed-planar-obstacles.ts";
import { nativeRationalOverlay } from "../lib/reviter/native-rational-overlay.ts";
import { exactClosedSourcePlanarContact } from "../lib/reviter/native-source-planar-slab-envelope.ts";
function replay(): Revit2027GRepReplay {
  const b = readFileSync(
      new URL(
        "./fixtures/native-planar-wall-trim-1629345.bin",
        import.meta.url,
      ),
    ),
    v = new DataView(b.buffer, b.byteOffset, b.byteLength),
    root = decodeRevit2027FramedGRepRoot(
      b,
      {
        offset: 0,
        elementId: 1629345,
        marker: 2246,
        objectLength: v.getUint32(12, true),
        typeCode: v.getUint32(18, true),
      },
      2027,
    );
  assert.ok(root.ok);
  const r = replayRevit2027GRepFifo(b, root.value);
  assert.ok(r.ok);
  return r.value;
}
test("original wall Face trims account for closed body, reference planes, auxiliary surface and every unlinked edge", () => {
  const source = replay(),
    r = inspectOriginalWallTrimObstacleBranches(source);
  assert.ok(r.ok, r.ok ? undefined : JSON.stringify(r));
  assert.equal(r.sourceFaceTokens.length, 14);
  assert.equal(r.trimLoopTokens.length, 14);
  assert.equal(r.closedBodyEdgeTokens.length, 28);
  assert.equal(r.finiteOpenReferenceEdgeTokens.length, 16);
  assert.equal(r.unlinkedGraphicEdgeTokens.length, 36);
  assert.deepEqual(r.auxiliaryNullLoopFaceTokens, [21]);
  assert.equal(r.hatchTokens.length, 9);
  assert.equal(r.originalSourceAuthorityGranted, false);
  assert.equal(r.exactClosedPhysicalBodyApproved, false);
  assert.equal(r.walkingSupportApproved, false);
  assert.equal(r.routeApproved, false);
  const point = [61.959331369358424, 462.50317960788925];
  const cap = nativeRationalOverlay("union", [
    [
      [
        [point[0]! - 1, point[1]! - 1],
        [point[0]! + 1, point[1]! - 1],
        [point[0]! + 1, point[1]! + 1],
        [point[0]! - 1, point[1]! + 1],
      ],
    ],
  ]);
  assert.equal(exactClosedSourcePlanarContact(cap, r.outerPlanEnvelope), false);
});
test("an underlying plane domain can enlarge without inventing material beyond its unchanged Face trim", () => {
  const a = replay(),
    b = replay(),
    before = inspectOriginalWallTrimObstacleBranches(a);
  assert.ok(before.ok);
  for (const s of b.spans.filter(
    (s) => s.readerId === "Revit2027AnalyticSurface:634",
  )) {
    const v = s.value as {
      surface: { envelope: { firstCorner: number[]; secondCorner: number[] } };
    };
    v.surface.envelope.firstCorner = [-10000, -10000];
    v.surface.envelope.secondCorner = [10000, 10000];
  }
  const after = inspectOriginalWallTrimObstacleBranches(b);
  assert.ok(after.ok);
  assert.deepEqual(after.outerPlanEnvelope, before.outerPlanEnvelope);
});
test("unlinked source edges cannot hide latent profile consumption or unknown curves", () => {
  const base = inspectOriginalWallTrimObstacleBranches(replay());
  assert.ok(base.ok);
  for (const mutate of [
    (r: Revit2027GRepReplay) => {
      const e = r.spans.find(
        (s) => s.propertyToken === base.unlinkedGraphicEdgeTokens[0],
      )!.value as { nextReferences: number[] };
      e.nextReferences[0] = 106;
    },
    (r: Revit2027GRepReplay) => {
      const e = r.spans.find(
        (s) => s.propertyToken === base.closedBodyEdgeTokens[0],
      )!.value as {
        interiorEdgePoints: unknown[];
        firstAndLastEdgePoints: unknown[];
      };
      e.interiorEdgePoints.push(e.firstAndLastEdgePoints[0]);
    },
  ]) {
    const r = replay();
    mutate(r);
    assert.equal(inspectOriginalWallTrimObstacleBranches(r).ok, false);
  }
});
test("missing Face trims, declared operands, foreign ownership and missing twins cannot narrow material", () => {
  for (const mutate of [
    (r: Revit2027GRepReplay) => {
      (
        r.spans.find(
          (s) => s.readerId === "Revit2027Face" && s.propertyToken === 12,
        )!.value as { firstLoop: { token: number } }
      ).firstLoop.token = 0;
    },
    (r: Revit2027GRepReplay) => {
      (
        r.spans.find((s) => s.readerId === "Revit2027Geometry")!.value as {
          faces: { count: number };
        }
      ).faces.count--;
    },
    (r: Revit2027GRepReplay) => {
      r.spans[0]!.ownerElementId = 1n;
    },
    (r: Revit2027GRepReplay) => {
      const e = r.spans.find((s) => s.propertyToken === 87)!.value as {
        faceReferences: number[];
      };
      e.faceReferences[1] = 12;
    },
  ]) {
    const r = replay();
    mutate(r);
    assert.equal(inspectOriginalWallTrimObstacleBranches(r).ok, false);
  }
});
test("a caller cannot manufacture original wall authority from a receipt or rendered body", () => {
  assert.throws(
    () =>
      proveOriginalDirectWallTrimObstacleEnvelope(
        { sourceModelSha256: "0".repeat(64) } as never,
        1629345,
      ),
    /Fabricated/,
  );
  assert.throws(
    () =>
      originalDirectWallTrimObstacleFacts({
        sourceModelSha256: "0".repeat(64),
      } as never),
    /Unregistered/,
  );
});
