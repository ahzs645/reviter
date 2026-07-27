/**
 * First-person navigation for the model viewport.
 *
 * Orbiting is the right way to look at a building from outside and the wrong
 * way to understand it from inside: a corridor, a stair, a floor-to-ceiling
 * height read very differently at eye level. This adds a walk mode alongside
 * the orbit camera rather than replacing it.
 *
 * The scene is drawn in model feet with the model origin subtracted, so the
 * speeds and heights here are real building dimensions — a 5.6 ft eye height,
 * a walking pace of about 9 ft/s — and need no scaling.
 *
 * Mouse look uses the browser's pointer lock. Movement is WASD or the arrow
 * keys, `Shift` to run, `Space` and `C` to rise and fall, and `Escape` releases
 * the pointer.
 */
import * as THREE from "three";

/** Eye height above the floor the walker is standing on, in feet. */
const EYE_HEIGHT_FEET = 5.6;

/** Walking pace and the multiplier applied while running, in feet per second. */
const WALK_SPEED = 9;
const RUN_MULTIPLIER = 3.2;

/** Vertical pace for rising and falling, in feet per second. */
const RISE_SPEED = 7;

/** How quickly velocity reaches the target pace; larger is snappier. */
const DAMPING = 12;

/** Radians of pitch either side of the horizon, kept just short of vertical. */
const MAX_PITCH = Math.PI / 2 - 0.02;

/** Mouse sensitivity, radians per pixel. */
const LOOK_SPEED = 0.0022;

export type WalkControls = {
  /** Attach listeners and take over the camera. */
  enable(): void;
  /** Release the pointer and hand the camera back. */
  disable(): void;
  /** Advance by `deltaSeconds`; call once per animation frame while enabled. */
  update(deltaSeconds: number): void;
  /** True while the pointer is locked and mouse look is live. */
  isLocked(): boolean;
  dispose(): void;
};

export type WalkOptions = {
  /** Where the walker starts, in scene units. */
  start: THREE.Vector3;
  /** Direction the walker faces at the start. */
  lookAt: THREE.Vector3;
  /** Lowest the camera may go, so the walker cannot sink through the model. */
  floor: number;
  /** Which axis points up in this scene. */
  up: "y" | "z";
  onLockChange?: (locked: boolean) => void;
};

/**
 * Yaw and pitch are tracked directly rather than read back off the camera:
 * accumulating rotations on a quaternion drifts into roll, which on a building
 * reads as the horizon tipping over.
 */
export function createWalkControls(
  camera: THREE.PerspectiveCamera,
  domElement: HTMLElement,
  options: WalkOptions,
): WalkControls {
  const up = options.up;
  const pressed = new Set<string>();
  const velocity = new THREE.Vector3();
  let yaw = 0;
  let pitch = 0;
  let enabled = false;
  let locked = false;

  // A basis that maps "forward, right, up" to whichever axis this scene stands
  // on, so the same movement code serves both the Y-up and Z-up viewports.
  const upVector = up === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);

  function applyRotation(): void {
    const cosPitch = Math.cos(pitch);
    const forward = up === "y"
      ? new THREE.Vector3(Math.sin(yaw) * cosPitch, Math.sin(pitch), Math.cos(yaw) * cosPitch)
      : new THREE.Vector3(Math.cos(yaw) * cosPitch, Math.sin(yaw) * cosPitch, Math.sin(pitch));
    camera.up.copy(upVector);
    camera.lookAt(camera.position.clone().add(forward));
  }

  function setFacing(from: THREE.Vector3, to: THREE.Vector3): void {
    const direction = to.clone().sub(from);
    if (up === "y") {
      yaw = Math.atan2(direction.x, direction.z);
      pitch = Math.atan2(direction.y, Math.hypot(direction.x, direction.z));
    } else {
      yaw = Math.atan2(direction.y, direction.x);
      pitch = Math.atan2(direction.z, Math.hypot(direction.x, direction.y));
    }
    pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
  }

  function onMouseMove(event: MouseEvent): void {
    if (!locked) return;
    yaw -= event.movementX * LOOK_SPEED;
    pitch -= event.movementY * LOOK_SPEED;
    pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
    applyRotation();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!enabled) return;
    pressed.add(event.code);
    // The keys that drive the walker would otherwise scroll the page.
    if (/^(Arrow|Space|Key[WASDC])/.test(event.code)) event.preventDefault();
  }

  function onKeyUp(event: KeyboardEvent): void {
    pressed.delete(event.code);
  }

  function onPointerLockChange(): void {
    locked = document.pointerLockElement === domElement;
    if (!locked) pressed.clear();
    options.onLockChange?.(locked);
  }

  function onClick(): void {
    if (enabled && !locked) void domElement.requestPointerLock();
  }

  function enable(): void {
    if (enabled) return;
    enabled = true;
    camera.position.copy(options.start);
    setFacing(options.start, options.lookAt);
    applyRotation();
    velocity.set(0, 0, 0);
    domElement.addEventListener("click", onClick);
    document.addEventListener("pointerlockchange", onPointerLockChange);
    document.addEventListener("mousemove", onMouseMove);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    void domElement.requestPointerLock();
  }

  function disable(): void {
    if (!enabled) return;
    enabled = false;
    pressed.clear();
    domElement.removeEventListener("click", onClick);
    document.removeEventListener("pointerlockchange", onPointerLockChange);
    document.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    if (document.pointerLockElement === domElement) document.exitPointerLock();
    locked = false;
  }

  function update(deltaSeconds: number): void {
    if (!enabled) return;
    const step = Math.min(deltaSeconds, 0.1);

    const forwardInput = (pressed.has("KeyW") || pressed.has("ArrowUp") ? 1 : 0)
      - (pressed.has("KeyS") || pressed.has("ArrowDown") ? 1 : 0);
    const strafeInput = (pressed.has("KeyD") || pressed.has("ArrowRight") ? 1 : 0)
      - (pressed.has("KeyA") || pressed.has("ArrowLeft") ? 1 : 0);
    const riseInput = (pressed.has("Space") ? 1 : 0) - (pressed.has("KeyC") ? 1 : 0);

    // Movement stays in the horizontal plane whatever the camera is looking at,
    // so looking down at the floor does not drive the walker into it.
    const forward = up === "y"
      ? new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
      : new THREE.Vector3(Math.cos(yaw), Math.sin(yaw), 0);
    const right = new THREE.Vector3().crossVectors(forward, upVector).normalize();

    const speed = WALK_SPEED * (pressed.has("ShiftLeft") || pressed.has("ShiftRight") ? RUN_MULTIPLIER : 1);
    const target = new THREE.Vector3()
      .addScaledVector(forward, forwardInput * speed)
      .addScaledVector(right, -strafeInput * speed)
      .addScaledVector(upVector, riseInput * RISE_SPEED);

    velocity.lerp(target, Math.min(1, DAMPING * step));
    camera.position.addScaledVector(velocity, step);

    // Keep the walker above the floor rather than under the building.
    const height = up === "y" ? camera.position.y : camera.position.z;
    if (height < options.floor) {
      if (up === "y") camera.position.y = options.floor;
      else camera.position.z = options.floor;
      if (velocity[up] < 0) velocity[up] = 0;
    }
    applyRotation();
  }

  return {
    enable,
    disable,
    update,
    isLocked: () => locked,
    dispose: disable,
  };
}

/** Eye height above a scene's floor, exported so callers can place the walker. */
export const WALK_EYE_HEIGHT = EYE_HEIGHT_FEET;
