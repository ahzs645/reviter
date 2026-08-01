import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { referenceMeshGroup } from "../app/studio/three-scene.ts";

import {
  CAMERA_PRESETS,
  cameraPoseForPreset,
  DEFAULT_CAMERA_PRESET,
  FEET_PER_METRE,
  isPlanPreset,
  referenceRegistration,
} from "../lib/reviter/viewer.ts";

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

test("names ten camera orientations and puts the camera outside the model for each", () => {
  // A view cube with three faces and a separate 3D/Plan switch could not say
  // "SE isometric", which is the vocabulary people arrive with.
  assert.equal(CAMERA_PRESETS.length, 10);
  assert.ok(CAMERA_PRESETS.some((entry) => entry.label === "SE isometric"));
  assert.ok(CAMERA_PRESETS.some((entry) => entry.preset === DEFAULT_CAMERA_PRESET));

  const center = { x: 10, y: -4, z: 3 };
  for (const { preset } of CAMERA_PRESETS) {
    const pose = cameraPoseForPreset(center, 50, preset);
    const distance = Math.hypot(
      pose.position.x - center.x,
      pose.position.y - center.y,
      pose.position.z - center.z,
    );
    assert.ok(distance > 50, `${preset} put the camera inside the model`);
    // Looking straight down an axis leaves "up" undefined along it, so the two
    // plan views have to be the ones that pick north instead of z.
    assert.deepEqual(pose.up, isPlanPreset(preset) ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 });
  }
});

test("top and bottom look at the model from opposite sides", () => {
  const center = { x: 0, y: 0, z: 0 };
  const top = cameraPoseForPreset(center, 20, "top");
  const bottom = cameraPoseForPreset(center, 20, "bottom");
  assert.ok(top.position.z > 0 && bottom.position.z < 0);
  assert.equal(top.position.z, -bottom.position.z);
});

test("IFC X-ray reveals geometry behind aligned and context surfaces", () => {
  const triangle = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    color: [0.2, 0.86, 0.76] as [number, number, number],
    matched: true,
  };
  const xray = referenceMeshGroup([
    { ...triangle, name: "Aligned", diffStatus: "aligned" },
    { ...triangle, name: "Difference", diffStatus: "different" },
    { ...triangle, name: "Context", diffStatus: "context", matched: false },
  ], "xray");
  const materials = Object.fromEntries(xray.children.map((child) => {
    const mesh = child as THREE.Mesh;
    return [mesh.name, mesh.material as THREE.MeshStandardMaterial];
  }));

  assert.equal(materials.Aligned.transparent, true);
  assert.equal(materials.Aligned.depthWrite, false);
  assert.equal(materials.Context.opacity, 0.14);
  assert.ok(materials.Aligned.opacity < materials.Difference.opacity);
  assert.equal(xray.getObjectByName("Difference")!.renderOrder, 3);

  const shaded = referenceMeshGroup([
    { ...triangle, name: "Aligned", diffStatus: "aligned" },
  ], "technical");
  const shadedMaterial = (shaded.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
  assert.equal(shadedMaterial.transparent, false);
  assert.equal(shadedMaterial.opacity, 1);
  assert.equal(shadedMaterial.depthWrite, true);
});
