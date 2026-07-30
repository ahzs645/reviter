import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { applyExplode, sectionPlanes } from "../app/studio/scene-tools.ts";
import {
  formatMeasuredLength,
  measuredAngleDegrees,
  modelFeetToScenePoint,
  navigationModeForTool,
  scenePointToModelFeet,
} from "../app/studio/viewer-tools.ts";

test("viewer tools only change the camera navigation mode when appropriate", () => {
  assert.equal(navigationModeForTool("pan"), "pan");
  assert.equal(navigationModeForTool("zoom"), "zoom");
  assert.equal(navigationModeForTool("firstPerson"), "orbit");
  assert.equal(navigationModeForTool("measure"), "orbit");
  assert.equal(navigationModeForTool("markup"), "orbit");
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
