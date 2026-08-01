import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  createWalkControls,
  droppedEyeCoordinate,
  easeTravelProgress,
  FIRST_PERSON_SPEEDS,
  floorTravelDirection,
  horizontalWalkDirection,
  stepWalkSpeed,
  travelDurationSeconds,
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

test("surface drop uses the hit surface or the safe model baseline", () => {
  assert.equal(droppedEyeCoordinate(12, 5.6, 5.6), 17.6);
  assert.equal(droppedEyeCoordinate(null, 5.6, 5.6), 5.6);
  assert.equal(droppedEyeCoordinate(-20, 5.6, 5.6), 5.6);
});

test("face travel uses a bounded ease-out animation", () => {
  assert.equal(easeTravelProgress(0), 0);
  assert.ok(easeTravelProgress(0.5) > 0.5);
  assert.equal(easeTravelProgress(1), 1);
  assert.equal(travelDurationSeconds(0), 0.42);
  assert.equal(travelDurationSeconds(100), 1.25);
});

test("face travel preserves the first-person view direction", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const fakeWindow = new EventTarget();
  const fakeDocument = Object.assign(new EventTarget(), { hidden: false });
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });

  try {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1_000);
    const element = Object.assign(new EventTarget(), {
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
      hasPointerCapture: () => false,
    }) as unknown as HTMLElement;
    const controls = createWalkControls(camera, element, {
      start: new THREE.Vector3(0, 5.6, 10),
      lookAt: new THREE.Vector3(0, 5.6, 0),
      floor: 5.6,
      up: "y",
      gravity: false,
    });
    controls.enable();
    const before = new THREE.Vector3();
    camera.getWorldDirection(before);

    controls.travelToSurface(
      new THREE.Vector3(0, 20, 0),
      new THREE.Vector3(0, 0, 1),
    );
    for (let frame = 0; frame < 20; frame += 1) controls.update(0.1);

    const after = new THREE.Vector3();
    camera.getWorldDirection(after);
    assert.ok(before.angleTo(after) < 1e-6);
    assert.ok(camera.position.z < 10);
    controls.dispose();
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("desktop click captures mouse look and Escape releases without exiting Walk", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const fakeWindow = new EventTarget();
  const fakeDocument = Object.assign(new EventTarget(), {
    hidden: false,
    pointerLockElement: null as HTMLElement | null,
    exitPointerLock() {
      this.pointerLockElement = null;
      this.dispatchEvent(new Event("pointerlockchange"));
    },
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });

  try {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1_000);
    let exitCount = 0;
    const element = Object.assign(new EventTarget(), {
      requestPointerLock() {
        fakeDocument.pointerLockElement = element as unknown as HTMLElement;
        fakeDocument.dispatchEvent(new Event("pointerlockchange"));
      },
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
      hasPointerCapture: () => false,
    }) as unknown as HTMLElement;
    const controls = createWalkControls(camera, element, {
      start: new THREE.Vector3(0, 5.6, 10),
      lookAt: new THREE.Vector3(0, 5.6, 0),
      floor: 5.6,
      up: "y",
      gravity: false,
      onExit: () => { exitCount += 1; },
    });
    controls.enable();

    element.dispatchEvent(Object.assign(new Event("pointerdown"), {
      button: 0,
      pointerType: "mouse",
      pointerId: 1,
    }));
    assert.equal(controls.isPointerLocked(), true);
    assert.equal(controls.isLooking(), true);
    const before = camera.getWorldDirection(new THREE.Vector3());
    fakeDocument.dispatchEvent(Object.assign(new Event("mousemove"), {
      movementX: 40,
      movementY: -10,
    }));
    assert.ok(before.angleTo(camera.getWorldDirection(new THREE.Vector3())) > 0.01);

    fakeWindow.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), {
      code: "Escape",
      repeat: false,
    }));
    assert.equal(controls.isPointerLocked(), false);
    assert.equal(exitCount, 0, "the release Escape must not also close Walk");
    controls.dispose();
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
