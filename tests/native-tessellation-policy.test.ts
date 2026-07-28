import assert from "node:assert/strict";
import test from "node:test";

import {
  circularArcStepForSurfaceDeviation,
  nativeCircularArcSegmentCount,
  nativeCylinderMaximumParamSteps,
  nativePlaneMaximumParamSteps,
  nativeTessellationPolicyForLevelOfDetail,
} from "../lib/reviter/native-tessellation-policy.ts";

function close(actual: number, expected: number, tolerance = 1e-12): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("replays the native LOD endpoints and exact 0.5 branch boundary", () => {
  const low = nativeTessellationPolicyForLevelOfDetail(0, 20);
  const middle = nativeTessellationPolicyForLevelOfDetail(0.5, 20);
  const high = nativeTessellationPolicyForLevelOfDetail(1, 20);
  assert.equal(low.ok, true);
  assert.equal(middle.ok, true);
  assert.equal(high.ok, true);
  if (!low.ok || !middle.ok || !high.ok) return;

  close(low.value.surfaceDeviation, 0.09998);
  close(low.value.maximumEdgeLength, 200);
  assert.equal(low.value.nativeWord40, 2);
  assert.equal(low.value.maximumAngleDegrees, 360);

  close(middle.value.surfaceDeviation, 0.0000998);
  close(middle.value.maximumEdgeLength, 200 / 26);
  assert.equal(middle.value.nativeWord40, 15);

  close(high.value.surfaceDeviation, 0.0000008);
  close(high.value.maximumEdgeLength, 200 / 51);
  assert.equal(high.value.nativeWord40, 50);

  const immediatelyBelow = nativeTessellationPolicyForLevelOfDetail(
    0.5 - Number.EPSILON,
    20,
  );
  assert.equal(immediatelyBelow.ok, true);
  if (!immediatelyBelow.ok) return;
  assert.ok(immediatelyBelow.value.surfaceDeviation < middle.value.surfaceDeviation);
});

test("rejects an invalid LOD or model diagonal", () => {
  for (const level of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(nativeTessellationPolicyForLevelOfDetail(level, 1).ok, false);
  }
  for (const diagonal of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(nativeTessellationPolicyForLevelOfDetail(0.5, diagonal).ok, false);
  }
});

test("replays the native plane edge-length step", () => {
  const result = nativePlaneMaximumParamSteps(10);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  close(result.value[0], 10 / Math.SQRT2);
  close(result.value[1], 10 / Math.SQRT2);
  assert.equal(nativePlaneMaximumParamSteps(0).ok, false);
});

test("replays cylinder axial, chord, and angular maximum steps", () => {
  const edgeLimited = nativeCylinderMaximumParamSteps(10, 2, 15);
  assert.equal(edgeLimited.ok, true);
  if (!edgeLimited.ok) return;
  close(edgeLimited.value.maximumUStep, 0.2 / Math.SQRT2);
  close(
    edgeLimited.value.maximumVStep,
    (2 * Math.asin(0.1)) / Math.SQRT2,
  );

  const angleLimited = nativeCylinderMaximumParamSteps(10, 21, 15);
  assert.equal(angleLimited.ok, true);
  if (!angleLimited.ok) return;
  close(angleLimited.value.maximumUStep, 2.1 / Math.SQRT2);
  close(angleLimited.value.maximumVStep, Math.PI / 12);

  const inactive = nativeCylinderMaximumParamSteps(10, 0, 0);
  assert.deepEqual(inactive, {
    ok: true,
    value: { maximumUStep: 0, maximumVStep: 0 },
  });
});

test("rejects invalid cylinder policy inputs", () => {
  assert.equal(nativeCylinderMaximumParamSteps(0, 1, 1).ok, false);
  assert.equal(nativeCylinderMaximumParamSteps(1, -1, 1).ok, false);
  assert.equal(nativeCylinderMaximumParamSteps(1, 1, -1).ok, false);
  assert.equal(nativeCylinderMaximumParamSteps(Number.NaN, 1, 1).ok, false);
});

test("turns native surface deviation into a circular sagitta bound", () => {
  const result = circularArcStepForSurfaceDeviation(10, 0.1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  close(result.value, 2 * Math.acos(0.99));

  assert.deepEqual(circularArcStepForSurfaceDeviation(10, 0), {
    ok: true,
    value: 0,
  });
  assert.deepEqual(circularArcStepForSurfaceDeviation(10, 20), {
    ok: true,
    value: 0,
  });
});

test("subdivides a circular arc by the strictest active native limit", () => {
  const policy = {
    maximumEdgeLength: 100,
    maximumAngleDegrees: 360,
    surfaceDeviation: 0.1,
  };
  const result = nativeCircularArcSegmentCount(
    10,
    Math.PI / 2,
    policy,
  );
  assert.deepEqual(result, { ok: true, value: 6 });

  const angleLimited = nativeCircularArcSegmentCount(
    10,
    Math.PI / 2,
    { ...policy, maximumAngleDegrees: 15, surfaceDeviation: 0 },
  );
  assert.deepEqual(angleLimited, { ok: true, value: 6 });
});

test("arc subdivision fails closed without a limit and at its safety bound", () => {
  const inactive = {
    maximumEdgeLength: 0,
    maximumAngleDegrees: 0,
    surfaceDeviation: 0,
  };
  assert.equal(nativeCircularArcSegmentCount(10, 1, inactive).ok, false);
  assert.equal(
    nativeCircularArcSegmentCount(
      10,
      Math.PI,
      {
        maximumEdgeLength: 0,
        maximumAngleDegrees: 0.001,
        surfaceDeviation: 0,
      },
      { maximumSegments: 100 },
    ).ok,
    false,
  );
  assert.equal(nativeCircularArcSegmentCount(10, 0, inactive).ok, false);
});
