import assert from "node:assert/strict";
import test from "node:test";

import {
  nativeConeMaximumParamSteps,
} from "../lib/reviter/native-tessellation-policy.ts";

function close(actual: number, expected: number, tolerance = 1e-12): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("replays cone axial, chord, and angular maximum steps", () => {
  const edgeLimited = nativeConeMaximumParamSteps(
    10,
    Math.PI / 3,
    2,
    15,
  );
  assert.equal(edgeLimited.ok, true);
  if (!edgeLimited.ok) return;
  close(
    edgeLimited.value.maximumUStep,
    Math.abs(2 / 10 / Math.cos(Math.PI / 3)) / Math.SQRT2,
  );
  close(
    edgeLimited.value.maximumVStep,
    (2 * Math.asin(0.1)) / Math.SQRT2,
  );

  const angleLimited = nativeConeMaximumParamSteps(
    10,
    Math.PI / 3,
    21,
    15,
  );
  assert.equal(angleLimited.ok, true);
  if (!angleLimited.ok) return;
  close(
    angleLimited.value.maximumUStep,
    Math.abs(21 / 10 / Math.cos(Math.PI / 3)) / Math.SQRT2,
  );
  close(angleLimited.value.maximumVStep, Math.PI / 12);

  assert.deepEqual(
    nativeConeMaximumParamSteps(10, Math.PI / 3, 0, 0),
    {
      ok: true,
      value: { maximumUStep: 0, maximumVStep: 0 },
    },
  );
});

test("matches all ten decoded UNBC cone base charts", () => {
  const cases = [
    [42.62725033269616, 1.4748032179352069, 0.3461424050305678, 0.033179323042017025],
    [42.25788031527915, 1.4748032179352069, 0.3491679857085621, 0.033469392627190765],
    [42.57846810106294, 1.4748032179352069, 0.34653898104030595, 0.033217343643527006],
    [42.20912821637363, 1.4748032179352069, 0.34957127932994764, 0.03350805744791164],
    [6.043725411690685, 1.3962634015954623, 1.3475349664466745, 0.2350780643536566],
    [6.043725411690685, 1.3962634015954623, 1.3475349664466745, 0.2350780643536566],
    [3.444881889763792, 1.0471975511965967, 0.8210519882120324, 0.2617993877991494],
    [3.4448818897637867, 1.0471975511965967, 0.8210519882120337, 0.2617993877991494],
    [3.444881889763792, 1.0471975511965967, 0.8210519882120324, 0.2617993877991494],
    [3.4448818897637867, 1.0471975511965967, 0.8210519882120337, 0.2617993877991494],
  ] as const;

  for (
    const [
      baseRadius,
      halfAngleRadians,
      expectedUStep,
      expectedVStep,
    ] of cases
  ) {
    const result = nativeConeMaximumParamSteps(
      baseRadius,
      halfAngleRadians,
      2,
      15,
    );
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    close(result.value.maximumUStep, expectedUStep);
    close(result.value.maximumVStep, expectedVStep);
  }
});

test("rejects cone inputs outside the proven acute finite subset", () => {
  for (const radius of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(
      nativeConeMaximumParamSteps(radius, Math.PI / 3, 1, 1).ok,
      false,
    );
  }
  for (const angle of [
    0,
    -1,
    Math.PI / 2,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    assert.equal(
      nativeConeMaximumParamSteps(1, angle, 1, 1).ok,
      false,
    );
  }
  assert.equal(
    nativeConeMaximumParamSteps(1, Math.PI / 3, -1, 1).ok,
    false,
  );
  assert.equal(
    nativeConeMaximumParamSteps(1, Math.PI / 3, 1, -1).ok,
    false,
  );
});
