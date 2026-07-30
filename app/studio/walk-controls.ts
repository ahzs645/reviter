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
 * Mouse look follows Autodesk Viewer's left-button drag. Movement is WASD or
 * the arrow keys, `Shift` to run, and Q/E to descend/ascend between floors.
 */
import * as THREE from "three";

/** Eye height above the floor the walker is standing on, in feet. */
const EYE_HEIGHT_FEET = 5.6;

export type WalkSpeed = "slow" | "normal" | "fast";

/** Autodesk-style speed steps, expressed in model feet per second. */
export const FIRST_PERSON_SPEEDS: Readonly<Record<WalkSpeed, number>> = {
  slow: 3.5,
  normal: 9,
  fast: 24,
};

const WALK_SPEED_ORDER: readonly WalkSpeed[] = ["slow", "normal", "fast"];
const RUN_MULTIPLIER = 2;

/** Vertical pace for rising and falling, in feet per second. */
const RISE_SPEED = 7;

/** How quickly velocity reaches the target pace; larger is snappier. */
const DAMPING = 12;

/** Radians of pitch either side of the horizon, kept just short of vertical. */
const MAX_PITCH = Math.PI / 2 - 0.02;

/** Mouse sensitivity, radians per pixel. */
const LOOK_SPEED = 0.0022;
const FLOOR_PROBE_INTERVAL = 0.1;
const MAX_STEP_UP = 1.5;

export function stepWalkSpeed(speed: WalkSpeed, direction: -1 | 1): WalkSpeed {
  const index = WALK_SPEED_ORDER.indexOf(speed);
  return WALK_SPEED_ORDER[Math.max(0, Math.min(WALK_SPEED_ORDER.length - 1, index + direction))];
}

export function floorTravelDirection(keys: ReadonlySet<string>): -1 | 0 | 1 {
  return ((keys.has("KeyE") ? 1 : 0) - (keys.has("KeyQ") ? 1 : 0)) as -1 | 0 | 1;
}

export function horizontalWalkDirection(
  up: "y" | "z",
  yaw: number,
  forwardInput: number,
  strafeInput: number,
): THREE.Vector3 {
  const upVector = up === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const forward = up === "y"
    ? new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    : new THREE.Vector3(Math.cos(yaw), Math.sin(yaw), 0);
  const right = new THREE.Vector3().crossVectors(forward, upVector).normalize();
  return forward.multiplyScalar(forwardInput).addScaledVector(right, strafeInput);
}

export function droppedEyeCoordinate(
  surface: number | null,
  minimumEyeCoordinate: number,
  eyeHeight: number,
): number {
  return surface == null
    ? minimumEyeCoordinate
    : Math.max(minimumEyeCoordinate, surface + eyeHeight);
}

export type WalkControls = {
  /** Attach listeners and take over the camera. */
  enable(): void;
  /** Release the pointer and hand the camera back. */
  disable(): void;
  /** Advance by `deltaSeconds`; call once per animation frame while enabled. */
  update(deltaSeconds: number): void;
  /** True while a left-button look drag is active. */
  isLooking(): boolean;
  /** Change the persistent movement speed without rebuilding the camera. */
  setSpeed(speed: WalkSpeed): void;
  /** Toggle floor following. Off becomes a free-flight first-person camera. */
  setGravity(enabled: boolean): void;
  /** Drop vertically onto the nearest model surface and resume walking. */
  dropToSurface(): boolean;
  /** Travel to a picked surface, keeping clearance from vertical faces. */
  teleport(point: THREE.Vector3, surfaceNormal?: THREE.Vector3): void;
  dispose(): void;
};

export type WalkOptions = {
  /** Where the walker starts, in scene units. */
  start: THREE.Vector3;
  /** Direction the walker faces at the start. */
  lookAt: THREE.Vector3;
  /** Lowest the camera may go, so the walker cannot sink through the model. */
  floor: number;
  /** Eye offset above a detected walking surface. */
  eyeHeight?: number;
  /** Scene distance represented by one foot (1 for RVT recovery, 0.3048 for metre geometry). */
  sceneUnitsPerFoot?: number;
  /** Which axis points up in this scene. */
  up: "y" | "z";
  /** Initial speed shown by the first-person popup. */
  speed?: WalkSpeed;
  /** Follow horizontal model surfaces when true. */
  gravity?: boolean;
  /** Return the walking-surface coordinate below this eye position. */
  resolveFloor?: (eyePosition: THREE.Vector3, maxDrop?: number) => number | null;
  /** Longest vertical search used by the explicit Space-key drop. */
  dropDistance?: number;
  /** Constrain a proposed camera move against model walls or other obstacles. */
  resolveMovement?: (from: THREE.Vector3, to: THREE.Vector3) => THREE.Vector3;
  onLookChange?: (looking: boolean) => void;
  onSpeedChange?: (speed: WalkSpeed) => void;
  onGravityChange?: (enabled: boolean) => void;
  onExit?: () => void;
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
  let looking = false;
  let speed = options.speed ?? "normal";
  let gravity = options.gravity ?? true;
  let floorProbeElapsed = FLOOR_PROBE_INTERVAL;
  const sceneUnitsPerFoot = options.sceneUnitsPerFoot ?? 1;
  const eyeHeight = options.eyeHeight ?? EYE_HEIGHT_FEET * sceneUnitsPerFoot;

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

  function onPointerMove(event: PointerEvent): void {
    if (!looking) return;
    yaw -= event.movementX * LOOK_SPEED;
    pitch -= event.movementY * LOOK_SPEED;
    pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
    applyRotation();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!enabled) return;
    if (event.code === "Escape") {
      options.onExit?.();
      return;
    }
    if (!event.repeat && (event.code === "Minus" || event.code === "NumpadSubtract")) {
      speed = stepWalkSpeed(speed, -1);
      options.onSpeedChange?.(speed);
      event.preventDefault();
      return;
    }
    if (!event.repeat && (event.code === "Equal" || event.code === "NumpadAdd")) {
      speed = stepWalkSpeed(speed, 1);
      options.onSpeedChange?.(speed);
      event.preventDefault();
      return;
    }
    if (!event.repeat && event.code === "Space") {
      dropToSurface();
      event.preventDefault();
      return;
    }
    pressed.add(event.code);
    // The keys that drive the walker would otherwise scroll the page.
    if (/^(Arrow|Space|Key[WASDCQE])/.test(event.code)) event.preventDefault();
  }

  function onKeyUp(event: KeyboardEvent): void {
    pressed.delete(event.code);
  }

  function onPointerDown(event: PointerEvent): void {
    if (!enabled || event.button !== 0) return;
    looking = true;
    domElement.setPointerCapture(event.pointerId);
    options.onLookChange?.(true);
  }

  function releaseInput(): void {
    pressed.clear();
    stopLooking();
  }

  function onVisibilityChange(): void {
    if (document.hidden) releaseInput();
  }

  function stopLooking(event?: PointerEvent): void {
    if (!looking) return;
    looking = false;
    if (event && domElement.hasPointerCapture(event.pointerId)) {
      domElement.releasePointerCapture(event.pointerId);
    }
    options.onLookChange?.(false);
  }

  function enable(): void {
    if (enabled) return;
    enabled = true;
    camera.position.copy(options.start);
    setFacing(options.start, options.lookAt);
    applyRotation();
    velocity.set(0, 0, 0);
    floorProbeElapsed = FLOOR_PROBE_INTERVAL;
    domElement.addEventListener("pointerdown", onPointerDown);
    domElement.addEventListener("pointermove", onPointerMove);
    domElement.addEventListener("pointerup", stopLooking);
    domElement.addEventListener("pointercancel", stopLooking);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseInput);
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  function disable(): void {
    if (!enabled) return;
    enabled = false;
    releaseInput();
    domElement.removeEventListener("pointerdown", onPointerDown);
    domElement.removeEventListener("pointermove", onPointerMove);
    domElement.removeEventListener("pointerup", stopLooking);
    domElement.removeEventListener("pointercancel", stopLooking);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", releaseInput);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }

  function update(deltaSeconds: number): void {
    if (!enabled) return;
    const step = Math.min(deltaSeconds, 0.1);

    const forwardInput = (pressed.has("KeyW") || pressed.has("ArrowUp") ? 1 : 0)
      - (pressed.has("KeyS") || pressed.has("ArrowDown") ? 1 : 0);
    const strafeInput = (pressed.has("KeyD") || pressed.has("ArrowRight") ? 1 : 0)
      - (pressed.has("KeyA") || pressed.has("ArrowLeft") ? 1 : 0);
    const floorTravelInput = floorTravelDirection(pressed);

    // Movement stays in the horizontal plane whatever the camera is looking at,
    // so looking down at the floor does not drive the walker into it.
    const movementSpeed = FIRST_PERSON_SPEEDS[speed] * sceneUnitsPerFoot
      * (pressed.has("ShiftLeft") || pressed.has("ShiftRight") ? RUN_MULTIPLIER : 1);
    const target = horizontalWalkDirection(up, yaw, forwardInput, strafeInput)
      .multiplyScalar(movementSpeed);
    if (floorTravelInput) {
      target.addScaledVector(upVector, floorTravelInput * RISE_SPEED * sceneUnitsPerFoot);
    }

    velocity.lerp(target, Math.min(1, DAMPING * step));
    const from = camera.position.clone();
    const next = from.clone().addScaledVector(velocity, step);
    camera.position.copy(options.resolveMovement?.(from, next) ?? next);

    let height = up === "y" ? camera.position.y : camera.position.z;
    floorProbeElapsed += step;
    if (gravity && !floorTravelInput && options.resolveFloor && floorProbeElapsed >= FLOOR_PROBE_INTERVAL) {
      floorProbeElapsed = 0;
      const surface = options.resolveFloor(camera.position);
      if (surface != null) {
        const targetEye = surface + eyeHeight;
        // A stair riser is walkable; a desk or roof encountered by the probe is
        // not something the camera should snap upward onto.
        if (targetEye <= height + MAX_STEP_UP * sceneUnitsPerFoot) {
          height = THREE.MathUtils.lerp(height, Math.max(options.floor, targetEye), Math.min(1, DAMPING * step));
          if (up === "y") camera.position.y = height;
          else camera.position.z = height;
          velocity[up] = 0;
        }
      }
    }

    // Keep the walker above the model baseline even when no surface was hit.
    height = up === "y" ? camera.position.y : camera.position.z;
    if (height < options.floor) {
      if (up === "y") camera.position.y = options.floor;
      else camera.position.z = options.floor;
      if (velocity[up] < 0) velocity[up] = 0;
    }
    applyRotation();
  }

  function dropToSurface(): boolean {
    const surface = options.resolveFloor?.(
      camera.position,
      options.dropDistance ?? 10_000 * sceneUnitsPerFoot,
    ) ?? null;
    const droppedEye = droppedEyeCoordinate(surface, options.floor, eyeHeight);
    if (up === "y") camera.position.y = droppedEye;
    else camera.position.z = droppedEye;
    velocity.set(0, 0, 0);
    gravity = true;
    floorProbeElapsed = 0;
    options.onGravityChange?.(true);
    applyRotation();
    return surface != null;
  }

  function teleport(point: THREE.Vector3, surfaceNormal?: THREE.Vector3): void {
    const normal = surfaceNormal?.clone().normalize() ?? upVector.clone();
    const horizontalNormal = normal.clone().addScaledVector(upVector, -normal.dot(upVector));
    const isWalkingSurface = Math.abs(normal.dot(upVector)) >= 0.55;
    if (isWalkingSurface || horizontalNormal.lengthSq() < 1e-6) {
      camera.position.copy(point).addScaledVector(upVector, eyeHeight);
    } else {
      horizontalNormal.normalize();
      if (horizontalNormal.dot(camera.position.clone().sub(point)) < 0) horizontalNormal.negate();
      const standOff = 3 * sceneUnitsPerFoot;
      camera.position.copy(point).addScaledVector(horizontalNormal, standOff);
      const floor = options.resolveFloor?.(camera.position);
      if (floor != null) {
        if (up === "y") camera.position.y = floor + eyeHeight;
        else camera.position.z = floor + eyeHeight;
      }
      setFacing(camera.position, point);
    }
    velocity.set(0, 0, 0);
    floorProbeElapsed = 0;
    applyRotation();
  }

  return {
    enable,
    disable,
    update,
    isLooking: () => looking,
    setSpeed: (nextSpeed) => {
      speed = nextSpeed;
    },
    setGravity: (enabled) => {
      gravity = enabled;
      velocity[up] = 0;
      floorProbeElapsed = FLOOR_PROBE_INTERVAL;
    },
    dropToSurface,
    teleport,
    dispose: disable,
  };
}

/** Eye height above a scene's floor, exported so callers can place the walker. */
export const WALK_EYE_HEIGHT = EYE_HEIGHT_FEET;
