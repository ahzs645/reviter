import assert from "node:assert/strict";
import test from "node:test";

import {
  FIRST_PERSON_SPEEDS,
  floorTravelDirection,
  horizontalWalkDirection,
  stepWalkSpeed,
} from "../app/studio/walk-controls.ts";

test("first-person speed steps are ordered and clamp at both ends", () => {
  assert.ok(FIRST_PERSON_SPEEDS.slow < FIRST_PERSON_SPEEDS.normal);
  assert.ok(FIRST_PERSON_SPEEDS.normal < FIRST_PERSON_SPEEDS.fast);

  assert.equal(stepWalkSpeed("slow", -1), "slow");
  assert.equal(stepWalkSpeed("slow", 1), "normal");
  assert.equal(stepWalkSpeed("normal", 1), "fast");
  assert.equal(stepWalkSpeed("fast", 1), "fast");
});

test("first-person floor travel matches Autodesk Q down and E up controls", () => {
  assert.equal(floorTravelDirection(new Set(["KeyQ"])), -1);
  assert.equal(floorTravelDirection(new Set(["KeyE"])), 1);
  assert.equal(floorTravelDirection(new Set(["KeyQ", "KeyE"])), 0);
  assert.equal(floorTravelDirection(new Set()), 0);
});

test("first-person strafing moves to the camera's visual right", () => {
  const yUpRight = horizontalWalkDirection("y", 0, 0, 1);
  assert.deepEqual(yUpRight.toArray(), [-1, 0, 0]);

  const zUpRight = horizontalWalkDirection("z", 0, 0, 1);
  assert.deepEqual(zUpRight.toArray(), [0, -1, 0]);
});
