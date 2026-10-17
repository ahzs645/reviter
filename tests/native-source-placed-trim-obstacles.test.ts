import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
} from "../lib/reviter/revit-2027-grep-replay.ts";
import {
  inspectPlacedTrimObstacleBranches,
  createOriginalPlacedTrimObstacleContext,
  proveOriginalPlacedTrimObstacleEnvelope,
  originalPlacedTrimObstacleFacts,
  originalOccurrenceBoundsAreFiniteOrdered,
} from "../lib/reviter/native-source-placed-trim-obstacles.ts";
import { rational } from "../lib/reviter/native-rational-overlay.ts";
import { exactClosedSourcePlanarContact } from "../lib/reviter/native-source-planar-slab-envelope.ts";
import { projectStatedTwoFootWalkingVolume } from "../lib/reviter/native-source-walking-volume.ts";
import { originalTwoFootStandingSquare } from "../lib/reviter/native-source-standing-footprint.ts";
function replay(id: number): Revit2027GRepReplay {
  const bytes = readFileSync(
      new URL(`./fixtures/native-trim-door-${id}.bin`, import.meta.url),
    ),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
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
  assert.ok(root.ok);
  const result = replayRevit2027GRepFifo(bytes, root.value);
  assert.ok(result.ok);
  return result.value;
}
const snapshot = (v: unknown) =>
  JSON.stringify(v, (_, x) => (typeof x === "bigint" ? String(x) : x));
test("all reversed source door faces remain unchanged in three closed obstruction envelopes", () => {
  const a = replay(1074348),
    b = replay(775553),
    before = snapshot([a, b]),
    r = inspectPlacedTrimObstacleBranches(a, b);
  assert.ok(r.ok, r.ok ? undefined : JSON.stringify(r));
  assert.equal(r.components.length, 3);
  assert.equal(
    r.components.reduce((n, c) => n + c.physicalFaceTokens.length, 0),
    26,
  );
  assert.equal(r.originalFreeGraphicsTokens.length, 32);
  assert.equal(r.originalHatchTokens.length, 26);
  assert.equal(r.sourceFalseFilters, 6);
  assert.equal(snapshot([a, b]), before);
  assert.ok(
    b.spans
      .filter((s) => s.readerId === "Revit2027Face")
      .every((s) => (s.value as { faceFlags: number }).faceFlags === 6),
  );
  assert.equal(r.originalSourceAuthorityGranted, false);
  assert.equal(r.walkingSupportApproved, false);
  assert.equal(r.routeApproved, false);
  const path = [
      [-0.9831061180773955, -318.12343176841307],
      [0.5, -318.12343176841307],
      [0.5, -320.9697773842104],
      [1.578773765958708, -320.9697773842104],
    ],
    foot = rational(34.120734908136484);
  for (const [i, p] of path.entries()) {
    const square = originalTwoFootStandingSquare(p.map(rational) as never);
    for (const c of r.components)
      assert.equal(
        exactClosedSourcePlanarContact(square, c.outerPlanEnvelope),
        false,
      );
    if (!i) continue;
    const start = [...path[i - 1]!.map(rational), foot] as never,
      end = [...p.map(rational), foot] as never;
    for (const c of r.components) {
      const v = projectStatedTwoFootWalkingVolume(
        start,
        end,
        c.minimumElevationFeet,
        c.maximumElevationFeet,
        6,
      );
      assert.equal(
        exactClosedSourcePlanarContact(
          [[v.possibleClosedProjectionFeet]],
          c.outerPlanEnvelope,
        ),
        false,
      );
    }
  }
  // The actual saved leaf is still a physical obstacle, not omitted with swing graphics.
  assert.ok(
    r.components.some((c) =>
      exactClosedSourcePlanarContact(
        originalTwoFootStandingSquare([
          rational(2.6896693979403636),
          rational(-316.1),
        ]),
        c.outerPlanEnvelope,
      ),
    ),
  );
});
test("reversed orientation does not admit unclosed boundaries or unsupported face semantics", () => {
  for (const mutation of [
    "flags",
    "loop",
    "twin",
    "plane",
    "hatch",
    "count",
  ] as const) {
    const a = replay(1074348),
      b = replay(775553);
    const face = b.spans.find((s) => s.readerId === "Revit2027Face")!.value as {
      faceFlags: number;
      firstLoop: { token: number };
    };
    if (mutation === "flags") face.faceFlags = 516;
    if (mutation === "loop") face.firstLoop.token = 0;
    if (mutation === "hatch")
      (
        b.spans.find((s) => s.readerId === "Revit2027GFilling")!.value as {
          faceIdReference: number;
        }
      ).faceIdReference++;
    if (mutation === "twin")
      (
        b.spans.find((s) => s.readerId === "Revit2027GEdge")!.value as {
          faceReferences: number[];
        }
      ).faceReferences[0] = 0;
    if (mutation === "plane")
      (
        b.spans.find((s) => s.readerId === "Revit2027AnalyticSurface:634")!
          .value as { xVector: number[] }
      ).xVector = [0, 0, 0];
    if (mutation === "count")
      (
        b.spans.find(
          (s) =>
            s.readerId === "Revit2027Geometry" &&
            (s.value as { faces: { count: number } }).faces.count > 0,
        )!.value as { faces: { count: number } }
      ).faces.count--;
    assert.equal(inspectPlacedTrimObstacleBranches(a, b).ok, false, mutation);
  }
});
test("free plan graphics reused by a physical face cannot disappear from the complete census", () => {
  const a = replay(1074348),
    b = replay(775553),
    line = b.spans.find(
      (s) => s.readerId === "Revit2027GLine" && s.propertyToken === 33,
    )!,
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
  assert.equal(inspectPlacedTrimObstacleBranches(a, b).ok, false);
});
test("extra branch, wrong owner, changed placement or embedded symbol retain an obstruction veto", () => {
  for (const mutation of [
    "extra",
    "owner",
    "scale",
    "symbol",
    "affine",
  ] as const) {
    const a = replay(1074348),
      b = replay(775553);
    if (mutation === "extra")
      b.spans.find(
        (s) => s.readerId === "Revit2027GLine" && s.propertyToken === 33,
      )!.readerId = "Revit2027GArc";
    if (mutation === "owner")
      b.spans.find((s) => s.readerId === "Revit2027Face")!.ownerElementId = 1n;
    if (mutation === "scale")
      (a.spans[0]!.value as { hasScale: boolean }).hasScale = true;
    if (mutation === "symbol")
      (a.spans[1]!.value as { symbolElementId: bigint }).symbolElementId = 1n;
    if (mutation === "affine")
      (
        a.spans[1]!.value as { transform: { zAxis: number[] } }
      ).transform.zAxis[0] = 1;
    assert.equal(inspectPlacedTrimObstacleBranches(a, b).ok, false, mutation);
  }
});
test("raw replay and cloned handles cannot mint actual-RVT obstruction authority", () => {
  assert.throws(
    () =>
      proveOriginalPlacedTrimObstacleEnvelope(
        { sourceModelSha256: "0".repeat(64) } as never,
        1074348,
      ),
    /fabricated/,
  );
  assert.throws(
    () =>
      originalPlacedTrimObstacleFacts({ nativeElementId: 1074348 } as never),
    /Unregistered/,
  );
  assert.throws(
    () =>
      createOriginalPlacedTrimObstacleContext(
        new Uint8Array(40),
        "0".repeat(64),
        [{ nativeElementId: 1074348, nativeDefinitionId: 775553 }],
      ),
    /checksum mismatch/,
  );
});

test("mirrored and anisotropically scaled affine remains a conservative normalized obstruction", () => {
  const a = replay(1074348),
    b = replay(775553);
  const info = a.spans.find((s) => s.readerId === "Revit2027InstanceInfo")!
    .value as {
    transform: {
      xAxis: number[];
      yAxis: number[];
      zAxis: number[];
      origin: number[];
    };
  };
  info.transform.xAxis = [-2, 0, 0];
  info.transform.yAxis = [0, 3, 0];
  info.transform.zAxis = [0, 0, 4];
  info.transform.origin = [0, 0, 10];
  const r = inspectPlacedTrimObstacleBranches(a, b);
  assert.ok(r.ok, r.ok ? undefined : JSON.stringify(r));
  assert.equal(r.components.length, 3);
  for (const c of r.components) {
    assert.equal(c.minimumElevationFeet.n, 10n);
    assert.ok(c.maximumElevationFeet.n * c.maximumElevationFeet.d > 0n);
    // Exact union reorients a reflected outer shell; mathematical reflection
    // cannot turn a retained material body into a hole or an empty obstacle.
    assert.ok(c.outerPlanEnvelope.length);
  }
  assert.ok(
    r.components.some((c) =>
      exactClosedSourcePlanarContact(
        originalTwoFootStandingSquare([rational(0), rational(-0.7)]),
        c.outerPlanEnvelope,
      ),
    ),
  );
  assert.equal(r.originalSourceAuthorityGranted, false);
});
test("inverted and nonfinite declared world boxes cannot enter a source proof", () => {
  assert.equal(
    originalOccurrenceBoundsAreFiniteOrdered({
      valid: true,
      minimum: [0, 1, 2],
      maximum: [3, 4, 5],
    }),
    true,
  );
  for (const bounds of [
    { valid: true, minimum: Array(3), maximum: [3, 4, 5] },
    { valid: true, minimum: [0, 1, 2], maximum: Array(3) },
    { valid: true, minimum: [0, , 2], maximum: [3, 4, 5] },
    { valid: true, minimum: [0, 1, 2], maximum: [3, , 5] },
    { valid: true, minimum: [4, 1, 2], maximum: [3, 4, 5] },
    { valid: true, minimum: [0, 6, 2], maximum: [3, 4, 5] },
    { valid: true, minimum: [0, 1, 9], maximum: [3, 4, 5] },
    { valid: true, minimum: [0, 1, 2], maximum: [3, Infinity, 5] },
    { valid: false, minimum: [0, 1, 2], maximum: [3, 4, 5] },
    { valid: true, minimum: [0, 1], maximum: [3, 4, 5] },
  ])
    assert.equal(originalOccurrenceBoundsAreFiniteOrdered(bounds), false);
});
test("reused or duplicate source physical descendant refuses before isolated branch indexing", () => {
  for (const duplicate of [false, true]) {
    const a = replay(1074348),
      b = replay(775553),
      face = b.spans.find((s) => s.readerId === "Revit2027Face")!;
    if (duplicate)
      b.spans.find(
        (s) => s.readerId === "Revit2027Face" && s !== face,
      )!.propertyToken = face.propertyToken;
    else
      b.descriptors = [
        ...b.descriptors,
        {
          ...b.descriptors.find((d) => d.token === face.propertyToken)!,
          descriptorIndex: b.descriptors.length,
          state: "reused",
        },
      ];
    assert.equal(inspectPlacedTrimObstacleBranches(a, b).ok, false);
  }
});
