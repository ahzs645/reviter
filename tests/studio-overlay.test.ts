import assert from "node:assert/strict";
import test from "node:test";

import { FEET_PER_METRE, referenceRegistration } from "../lib/reviter/viewer.ts";

test("registers the paired export into the recovered model's own frame", () => {
  // The recovered scene is drawn with its origin subtracted, so a building far
  // from the project datum still renders near zero; the export is in metres
  // around that datum. Scale then translate is the whole of the registration,
  // and it is why the two models can be shown together at all.
  const origin = { x: 100, y: -50, z: 5 };
  const { scale, offset } = referenceRegistration(origin);
  assert.equal(scale, FEET_PER_METRE);
  assert.deepEqual(offset, { x: -100, y: 50, z: -5 });

  // A point one metre along each axis, placed through that registration.
  const place = (metres: number, axis: "x" | "y" | "z") => metres * scale + offset[axis];
  assert.ok(Math.abs(place(1, "x") - (FEET_PER_METRE - 100)) < 1e-9);
  assert.ok(Math.abs(place(1, "y") - (FEET_PER_METRE + 50)) < 1e-9);
  assert.ok(Math.abs(place(1, "z") - (FEET_PER_METRE - 5)) < 1e-9);
});

test("agrees with the offline overlay script's metre to foot factor", () => {
  // scripts/overlay-diff.ts measures the same comparison outside the browser;
  // if the two ever disagree the reported errors are unit noise, not recovery.
  assert.ok(Math.abs(FEET_PER_METRE - 1 / 0.3048) < 1e-9);
});
