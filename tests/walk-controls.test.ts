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
  walkKeyboardTargetIsInteractive,
} from "../app/studio/walk-controls.ts";

test("walk shortcuts ignore form and disclosure controls", () => {
  for (const tagName of ["INPUT", "SELECT", "TEXTAREA", "BUTTON", "A"]) {
    assert.equal(walkKeyboardTargetIsInteractive({ tagName } as unknown as EventTarget), true);
  }
  assert.equal(walkKeyboardTargetIsInteractive({ tagName: "CANVAS" } as unknown as EventTarget), false);
  assert.equal(walkKeyboardTargetIsInteractive({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget), true);
});

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

test("desktop look uses pointer drag without locking the mouse", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const fakeWindow = new EventTarget();
  const fakeDocument = Object.assign(new EventTarget(), { hidden: false });
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });

  try {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1_000);
    let exitCount = 0;
    let pointerLockRequests = 0;
    let capturedPointer: number | null = null;
    const element = Object.assign(new EventTarget(), {
      requestPointerLock() {
        pointerLockRequests += 1;
      },
      setPointerCapture: (pointerId: number) => { capturedPointer = pointerId; },
      releasePointerCapture: (pointerId: number) => {
        if (capturedPointer === pointerId) capturedPointer = null;
      },
      hasPointerCapture: (pointerId: number) => capturedPointer === pointerId,
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
    assert.equal(pointerLockRequests, 0);
    assert.equal(controls.isPointerLocked(), false);
    assert.equal(controls.isLooking(), true);
    assert.equal(capturedPointer, 1);
    const before = camera.getWorldDirection(new THREE.Vector3());
    element.dispatchEvent(Object.assign(new Event("pointermove"), {
      movementX: 40,
      movementY: -10,
    }));
    assert.ok(before.angleTo(camera.getWorldDirection(new THREE.Vector3())) > 0.01);

    const positionWhileLooking = camera.position.clone();
    fakeWindow.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), {
      code: "KeyW",
      repeat: false,
    }));
    controls.update(0.1);
    assert.deepEqual(
      camera.position.toArray(),
      positionWhileLooking.toArray(),
      "look dragging must rotate in place even while a movement key is held",
    );

    element.dispatchEvent(Object.assign(new Event("pointerup"), { pointerId: 1 }));
    assert.equal(controls.isLooking(), false);
    assert.equal(capturedPointer, null);
    controls.update(0.1);
    assert.ok(camera.position.distanceTo(positionWhileLooking) > 0, "movement resumes after the drag");

    fakeWindow.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), {
      code: "Escape",
      repeat: false,
    }));
    assert.equal(exitCount, 1);
    controls.dispose();
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
