/**
 * The bundled Autodesk derivative used as a high-fidelity visual reference.
 *
 * It applies only to the one sample file it was converted from; every other
 * model uses Reviter's own recovery or a paired IFC.
 */
import * as THREE from "three";

import { cameraPoseForPreset, type CameraPreset, type ConvertResult, type RenderMode } from "../../lib/reviter";
import type { ReviterGlobal } from "./types.ts";
import {
  AUTODESK_REFERENCE_FILE,
  hasAutodeskReference,
} from "./autodesk-reference-file.ts";

export { AUTODESK_REFERENCE_FILE, hasAutodeskReference };
export const AUTODESK_REFERENCE_BOUNDS = {
  min: { x: -108.9497, y: -9.7, z: -187.3832 },
  max: { x: 108.9497, y: 9.7, z: 187.3832 },
};
export const AUTODESK_HOME_CAMERA = {
  position: new THREE.Vector3(41.734, 26.243, -88.721),
  target: new THREE.Vector3(128.105, 17.516, -36.128),
  up: new THREE.Vector3(0.07347, 0.99629, 0.04472),
  fov: 62.7447,
};
export const AUTODESK_PREVIEW_RESULT: ConvertResult = {
  ok: true,
  fileName: AUTODESK_REFERENCE_FILE,
  byteLength: 0,
  meshes: [],
  materials: [],
  segments: [],
  elementBounds: [],
  nativeProfiles: [],
  decoderCoverage: {
    revitVersion: 2026,
    activeDecoders: [],
    nativeCurves: 0,
    nativeProfiles: 0,
    nativeMeshes: 0,
    nativeMaterialDefinitions: 0,
    nativeMaterialAssignments: 0,
    approximateSolids: 0,
    nativeCategorisedElements: 0,
    geometryFidelity: "diagnostic-only",
    materialFidelity: "display-fallback",
    semanticFidelity: "none",
  },
  origin: { x: 0, y: 0, z: 0 },
  bbox: AUTODESK_REFERENCE_BOUNDS,
  levels: [],
  stats: {
    streamCount: 0,
    partitionStreams: 0,
    gzipChunks: 0,
    inflatedBytes: 0,
    candidatesFound: 0,
    candidatesFocused: 0,
    candidatesUsed: 0,
    vertexCount: 0,
    triangleCount: 1_220_000,
    meshCount: 8_698,
    boundsRecordsFound: 0,
    solidBoundsRecords: 0,
    durationMs: 0,
  },
  warnings: [],
  method: "partition-coordinate-recovery",
};

export function publicAssetUrl(fileName: string): string {
  const base = document.baseURI.replace(/[?#].*$/, "").replace(/[^/]*$/, "");
  return `${base}${fileName}`;
}

export function staticWorkerUrl(kind: "rvt" | "ifc"): string | undefined {
  return (globalThis as ReviterGlobal).__REVITER_STATIC_WORKERS__?.[kind];
}

export function styleAutodeskReference(root: THREE.Object3D, renderMode: RenderMode) {
  const styled = new Set<THREE.Material>();
  root.name = "Autodesk derivative reference";
  root.userData = {
    source: "autodesk-svf-derivative",
    fidelity: "reference",
    fragments: 51_420,
    materials: 22,
  };
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = renderMode === "technical";
    mesh.receiveShadow = renderMode === "technical";
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (styled.has(material)) continue;
      styled.add(material);
      material.side = THREE.DoubleSide;
      const standard = material as THREE.MeshStandardMaterial;
      if (standard.isMeshStandardMaterial) {
        if (renderMode !== "technical") {
          standard.transparent = true;
          standard.opacity = Math.min(standard.opacity, 0.24);
          standard.depthWrite = false;
        }
      }
      material.needsUpdate = true;
    }
  });
}

/** The curated opening camera for the Autodesk derivative, which is not a preset. */
export function autodeskHomePose() {
  return {
    position: AUTODESK_HOME_CAMERA.position.clone(),
    target: AUTODESK_HOME_CAMERA.target.clone(),
    up: AUTODESK_HOME_CAMERA.up.clone(),
    fov: AUTODESK_HOME_CAMERA.fov,
  };
}

/**
 * The same ten orientations, in the derivative's frame.
 *
 * The SVF is y-up and metres where the recovery is z-up and feet, so rather
 * than keep a second table that can drift out of step, the shared one is asked
 * and its answer rotated: model `(x, y, z)` is derivative `(x, z, −y)`.
 */
export function autodeskPoseForPreset(preset: CameraPreset, radius: number) {
  const pose = cameraPoseForPreset({ x: 0, y: 0, z: 0 }, radius, preset);
  return {
    position: new THREE.Vector3(pose.position.x, pose.position.z, -pose.position.y),
    target: new THREE.Vector3(),
    up: new THREE.Vector3(pose.up.x, pose.up.z, -pose.up.y),
    fov: 45,
  };
}
