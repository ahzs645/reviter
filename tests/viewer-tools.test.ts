import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { applyExplode, sectionPlanes } from "../app/studio/scene-tools.ts";
import {
  formatMeasuredLength,
  isNavigationTool,
  measuredAngleDegrees,
  modelFeetToScenePoint,
  NAVIGATION_TOOLS,
  navigationModeForTool,
  sceneUnitsPerPixel,
  scenePointToModelFeet,
  WALK_COMPARISON_SOURCES,
  walkComparisonSourceForCode,
} from "../app/studio/viewer-tools.ts";

test("viewer tools only change the camera navigation mode when appropriate", () => {
  assert.equal(navigationModeForTool("pan"), "pan");
  assert.equal(navigationModeForTool("zoom"), "zoom");
  assert.equal(navigationModeForTool("orbit"), "orbit");
  assert.equal(navigationModeForTool("firstPerson"), "orbit");
});

test("navigating and acting are separate choices", () => {
  // Measuring, commenting and marking up are things a click does; they are not
  // ways of driving the camera. Holding them in one `activeTool` meant arming
  // the Comment tool dropped you out of first person — out of the very place
  // the comment was being written about.
  assert.deepEqual([...NAVIGATION_TOOLS], ["orbit", "pan", "zoom", "firstPerson"]);
  for (const tool of NAVIGATION_TOOLS) assert.equal(isNavigationTool(tool), true);
  for (const tool of ["measure", "section", "explode", "comment", "markup"] as const) {
    assert.equal(isNavigationTool(tool), false, `${tool} is an action, not a navigation mode`);
  }
});

test("Walk comparison shortcuts select only the three standalone sources", () => {
  assert.deepEqual(
    WALK_COMPARISON_SOURCES.map(({ source, key }) => [key, source]),
    [["1", "recovered"], ["2", "reference"], ["3", "reference-model"]],
  );
  assert.equal(walkComparisonSourceForCode("Digit1"), "recovered");
  assert.equal(walkComparisonSourceForCode("Digit2"), "reference");
  assert.equal(walkComparisonSourceForCode("Digit3"), "reference-model");
  assert.equal(walkComparisonSourceForCode("Digit4"), null);
  assert.equal(walkComparisonSourceForCode("Numpad1"), null);
});

test("a markup width is stored as a length in the room, not a count of pixels", () => {
  // Twice as far away is half as wide on screen, so converting a pixel width to
  // world units at draw time and back at render time is what makes a redline
  // grow as you walk up to it instead of hanging in front of your eyes.
  const near = sceneUnitsPerPixel(10, 45, 1000);
  const far = sceneUnitsPerPixel(20, 45, 1000);
  assert.ok(Math.abs(far - near * 2) < 1e-12);

  const drawnAt = 10;
  const widthPx = 4;
  const worldWeight = widthPx * sceneUnitsPerPixel(drawnAt, 45, 1000);
  assert.ok(Math.abs(worldWeight / sceneUnitsPerPixel(drawnAt, 45, 1000) - widthPx) < 1e-9);
  assert.ok(Math.abs(worldWeight / sceneUnitsPerPixel(drawnAt / 2, 45, 1000) - widthPx * 2) < 1e-9);

  // A zero-height viewport has no pixels to divide by, and must not produce NaN.
  assert.equal(sceneUnitsPerPixel(10, 45, 0), 0);
});

test("measurement helpers format calibrated lengths and stable angles", () => {
  assert.equal(formatMeasuredLength(10, "feet"), "10.000 ft");
  assert.equal(formatMeasuredLength(10, "metres"), "3.048 m");
  assert.equal(formatMeasuredLength(10, "feet", 0.5), "5.000 ft");
  assert.equal(
    measuredAngleDegrees(
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    ),
    90,
  );
});

test("comment anchors register between RVT feet and IFC metres", () => {
  const origin: [number, number, number] = [100, 200, 300];
  assert.deepEqual(
    scenePointToModelFeet([1, 2, 3], "recovered", origin),
    [101, 202, 303],
  );
  const inIfc = modelFeetToScenePoint([101, 202, 303], "reference", origin);
  assert.deepEqual(inIfc?.map((value) => Number(value.toFixed(4))), [30.7848, 61.5696, 92.3544]);
  assert.deepEqual(
    scenePointToModelFeet(inIfc!, "reference", origin)?.map((value) => Number(value.toFixed(6))),
    [101, 202, 303],
  );
  assert.equal(scenePointToModelFeet([1, 2, 3], "reference-model", origin), undefined);
});

test("section direction reverses axis clipping and boxes use six planes", () => {
  const bounds = new THREE.Box3(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(10, 20, 30),
  );
  const forward = sectionPlanes(bounds, "x", 0.5)[0]!;
  const reverse = sectionPlanes(bounds, "x", 0.5, true)[0]!;
  assert.equal(forward.distanceToPoint(new THREE.Vector3(5, 0, 0)), 0);
  assert.equal(reverse.distanceToPoint(new THREE.Vector3(5, 0, 0)), 0);
  assert.equal(forward.normal.dot(reverse.normal), -1);
  assert.equal(sectionPlanes(bounds, "box", 0.25).length, 6);
});

test("explode applies and restores stable base positions", () => {
  const object = new THREE.Object3D();
  const parts = [{
    object,
    basePosition: new THREE.Vector3(1, 2, 3),
    direction: new THREE.Vector3(10, 0, 0),
  }];
  applyExplode(parts, 1);
  assert.deepEqual(object.position.toArray(), [5.2, 2, 3]);
  applyExplode(parts, 0);
  assert.deepEqual(object.position.toArray(), [1, 2, 3]);
});
