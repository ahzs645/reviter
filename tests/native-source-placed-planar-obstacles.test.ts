import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
} from "../lib/reviter/revit-2027-grep-replay.ts";
import {
  inspectPlacedPlanarObstacleBranches,
  createOriginalPlacedPlanarObstacleContext,
  proveOriginalPlacedPlanarObstacleEnvelope,
  originalPlacedPlanarObstacleFacts,
  consistentOriginalObstacleCategories,
} from "../lib/reviter/native-source-placed-planar-obstacles.ts";
import { activeClassTagTranslation } from "../lib/reviter/revit-class-tags.ts";
import { activeElementIdBytes } from "../lib/reviter/element-id-width.ts";
import { nativeRationalOverlay } from "../lib/reviter/native-rational-overlay.ts";
import { exactClosedSourcePlanarContact } from "../lib/reviter/native-source-planar-slab-envelope.ts";
function replay(id: number): Revit2027GRepReplay {
  const bytes = readFileSync(
      new URL(`./fixtures/native-planar-door-${id}.bin`, import.meta.url),
    ),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const root = decodeRevit2027FramedGRepRoot(
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
  assert.ok(root.ok);
  const r = replayRevit2027GRepFifo(bytes, root.value);
  assert.ok(r.ok);
  return r.value;
}
const value = (v: unknown) =>
  JSON.stringify(v, (_, n) => (typeof n === "bigint" ? n.toString() : n));
test("complete original placed-door branch census retains four closed physical components and every graphical role", () => {
  const a = replay(1630256),
    b = replay(2466586),
    before = value([a, b]),
    r = inspectPlacedPlanarObstacleBranches(a, b);
  assert.ok(r.ok, r.ok ? undefined : JSON.stringify(r));
  assert.equal(r.components.length, 4);
  assert.deepEqual(
    r.components.map((c) => c.originalGeometryToken),
    [31, 32, 33, 34],
  );
  assert.equal(r.originalFreeGraphicsTokens.length, 54);
  assert.equal(r.originalHatchTokens.length, 32);
  assert.equal(r.sourceFalseFilters, 14);
  assert.equal(r.originalSourceAuthorityGranted, false);
  assert.equal(r.walkingSupportApproved, false);
  assert.equal(r.routeApproved, false);
  assert.equal(value([a, b]), before);
  // Actual reviewed two-foot approach and two-foot terminal cap, with original
  // source coordinates. This is obstruction exclusion, never walking support.
  const path = [
      [55.5, 466.5],
      [56, 465],
      [61.959331369358424, 462.50317960788925],
    ],
    last = path.at(-1)!;
  const parts = path.slice(1).map((p, i) => {
    const q = path[i]!,
      dx = p[0]! - q[0]!,
      dy = p[1]! - q[1]!,
      length = Math.hypot(dx, dy),
      x = -dy / length,
      y = dx / length;
    return [
      [
        [
          [q[0]! + x, q[1]! + y],
          [p[0]! + x, p[1]! + y],
          [p[0]! - x, p[1]! - y],
          [q[0]! - x, q[1]! - y],
        ],
      ],
    ] as [number, number][][][];
  });
  const scope = nativeRationalOverlay(
    "union",
    [
      [
        [
          [last[0]! - 1, last[1]! - 1],
          [last[0]! + 1, last[1]! - 1],
          [last[0]! + 1, last[1]! + 1],
          [last[0]! - 1, last[1]! + 1],
        ],
      ],
    ],
    ...parts,
  );
  for (const c of r.components)
    assert.equal(
      exactClosedSourcePlanarContact(scope, c.outerPlanEnvelope),
      false,
    );
});
test("unknown view conditions retain their additional source planes and cannot produce a partial body certificate", () => {
  const a = replay(1630256),
    b = replay(2466586),
    condition = b.spans.find(
      (s) =>
        s.readerId === "Revit2027GConditionDir" &&
        (s.value as { compareMode: number }).compareMode === 6 &&
        s.parentReplayIndex !== null &&
        b.spans.some(
          (child) =>
            child.parentReplayIndex === s.parentReplayIndex &&
            child.readerId === "Revit2027Geometry",
        ),
    )!;
  (condition.value as { compareMode: number }).compareMode = 10;
  assert.equal(inspectPlacedPlanarObstacleBranches(a, b).ok, false);
});
test("a graphic reused by a surface/profile is never classified as a free graphical branch", () => {
  const a = replay(1630256),
    b = replay(2466586),
    line = b.spans.find((s) => s.readerId === "Revit2027GLine")!,
    face = b.spans.find((s) => s.readerId === "Revit2027Face")!;
  b.descriptors = [
    ...b.descriptors,
    {
      descriptorIndex: b.descriptors.length,
      ownerElementId: b.ownerElementId,
      path: [],
      parentPath: [],
      parentReplayIndex: face.replayIndex,
      token: line.propertyToken,
      sourceClassSlot: 1973,
      descriptorOffset: 0,
      descriptorEndOffset: 6,
      state: "reused",
      queueSequence: null,
    },
  ];
  assert.equal(inspectPlacedPlanarObstacleBranches(a, b).ok, false);
});
test("unowned hatch data, incomplete declared faces and foreign owners retain a veto", () => {
  for (const mutate of [
    (b: Revit2027GRepReplay) => {
      (
        b.spans.find((s) => s.readerId === "Revit2027GFilling")!.value as {
          faceIdReference: number;
        }
      ).faceIdReference++;
    },
    (b: Revit2027GRepReplay) => {
      (
        b.spans.find(
          (s) =>
            s.readerId === "Revit2027Geometry" &&
            (s.value as { faces: { count: number } }).faces.count > 0,
        )!.value as { faces: { count: number } }
      ).faces.count--;
    },
    (b: Revit2027GRepReplay) => {
      b.spans.find((s) => s.readerId === "Revit2027Face")!.ownerElementId = 1n;
    },
  ]) {
    const a = replay(1630256),
      b = replay(2466586);
    mutate(b);
    assert.equal(inspectPlacedPlanarObstacleBranches(a, b).ok, false);
  }
});
test("changed original occurrence selectors, definition identity or unsupported affine cannot inherit the body", () => {
  for (const mutate of [
    (a: Revit2027GRepReplay) => {
      (
        a.spans.find((s) => s.readerId === "Revit2027InstanceInfo")!.value as {
          symbolElementId: bigint;
        }
      ).symbolElementId = 1n;
    },
    (a: Revit2027GRepReplay) => {
      (
        a.spans.find((s) => s.readerId === "Revit2027GInstance")!.value as {
          hasScale: boolean;
        }
      ).hasScale = true;
    },
    (a: Revit2027GRepReplay) => {
      (
        a.spans.find((s) => s.readerId === "Revit2027InstanceInfo")!.value as {
          transform: { zAxis: number[] };
        }
      ).transform.zAxis[0] = 1;
    },
  ]) {
    const a = replay(1630256),
      b = replay(2466586);
    mutate(a);
    assert.equal(inspectPlacedPlanarObstacleBranches(a, b).ok, false);
  }
});
test("caller-created context, certificate or raw graphics cannot establish original RVT authority", () => {
  assert.throws(
    () =>
      proveOriginalPlacedPlanarObstacleEnvelope(
        { sourceModelSha256: "0".repeat(64) } as never,
        1630256,
      ),
    /fabricated source context/,
  );
  assert.throws(
    () =>
      originalPlacedPlanarObstacleFacts({
        sourceModelSha256: "0".repeat(64),
      } as never),
    /Unregistered/,
  );
  const bytes = readFileSync(
      new URL("./fixtures/native-planar-door-1630256.bin", import.meta.url),
    ),
    sha = createHash("sha256").update(bytes).digest("hex"),
    translation = activeClassTagTranslation(),
    width = activeElementIdBytes();
  assert.throws(
    () =>
      createOriginalPlacedPlanarObstacleContext(bytes, "0".repeat(64), [
        { nativeElementId: 1630256, nativeDefinitionId: 2466586 },
      ]),
    /checksum mismatch/,
  );
  assert.throws(() =>
    createOriginalPlacedPlanarObstacleContext(bytes, sha, [
      { nativeElementId: 1630256, nativeDefinitionId: 2466586 },
    ]),
  );
  assert.equal(activeClassTagTranslation(), translation);
  assert.equal(activeElementIdBytes(), width);
});
test("null or conflicting original headers cannot be erased by a later door declaration", () => {
  assert.equal(
    consistentOriginalObstacleCategories([-2000023, -2000023], -2000023),
    true,
  );
  for (const declarations of [
    [],
    [null],
    [-2000023, null],
    [null, -2000023],
    [-2000023, -2000011],
  ])
    assert.equal(
      consistentOriginalObstacleCategories(declarations, -2000023),
      false,
    );
});
