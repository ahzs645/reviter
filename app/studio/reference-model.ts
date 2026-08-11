/**
 * A reference model paired with the open RVT.
 *
 * Reviter used to ship one: a 25.6 MB GLB that Autodesk's converter had
 * produced from a single building, committed to the repository and offered to
 * whichever file matched it. That is a benchmark for exactly one model. For any
 * other RVT the button was permanently disabled, and the repository carried a
 * derivative of someone's building for everyone who cloned it.
 *
 * The comparison itself is worth keeping — a conversion by Revit's own tooling
 * is the best yardstick there is for judging a recovery. So the capability
 * stays and the asset goes: pair your own GLB or glTF, the same way a paired
 * IFC export is already supplied, and it works for any model. Nothing about a
 * particular building is compiled in, so there is no identity to gate on and
 * nothing to go stale.
 *
 * The reference is drawn as it arrives and is never treated as Reviter output:
 * it carries no element ids, so the object, category and property panels stay
 * on the RVT diagnostic source.
 */
import * as THREE from "three";

import { cameraPoseForPreset, type CameraPreset, type RenderMode } from "../../lib/reviter";
import type { ReviterGlobal } from "./types.ts";

/**
 * Extent of a loaded reference, in its own units.
 *
 * Measured from the file rather than declared: the bundled derivative's extent
 * used to be four hand-entered numbers, which were that one building's and
 * would silently frame any other model wrongly.
 */
export function referenceModelBounds(root: THREE.Object3D): {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
} {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };
  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
  };
}

/**
 * Is this scene y-up, as a glTF exported from a y-up tool will be?
 *
 * glTF declares +Y up, and Revit derivatives honour that, so a reference is
 * normally taller in y than the recovery is in z. Asking the geometry keeps a
 * z-up reference from being drawn on its side, which a fixed assumption about
 * one exporter could not do.
 */
export function referenceIsYUp(bounds: ReturnType<typeof referenceModelBounds>): boolean {
  const x = bounds.max.x - bounds.min.x;
  const y = bounds.max.y - bounds.min.y;
  const z = bounds.max.z - bounds.min.z;
  return y < x && y < z;
}

export function publicAssetUrl(fileName: string): string {
  const base = document.baseURI.replace(/[?#].*$/, "").replace(/[^/]*$/, "");
  return `${base}${fileName}`;
}

export function staticWorkerUrl(
  kind: "rvt" | "ifc" | "dwg" | "plan" | "regions",
): string | undefined {
  return (globalThis as ReviterGlobal).__REVITER_STATIC_WORKERS__?.[kind];
}

export function styleReferenceModel(root: THREE.Object3D, renderMode: RenderMode) {
  const styled = new Set<THREE.Material>();
  root.name = "Paired reference model";
  // Counted from the scene that arrived, not declared. The bundled derivative's
  // 51,420 fragments and 22 materials used to be written here as literals; they
  // described one file and said nothing true about anyone else's.
  let fragments = 0;
  root.traverse((object) => { if ((object as THREE.Mesh).isMesh) fragments += 1; });
  root.userData = {
    source: "paired-reference-model",
    fidelity: "reference",
    fragments,
  };
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    // A reference routinely arrives as many thousands of fragments. Dynamic
    // per-fragment shadows nearly double its draw work and expose coplanar
    // faces as shadow acne while the camera moves.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (styled.has(material)) continue;
      styled.add(material);
      const standard = material as THREE.MeshStandardMaterial;
      if (standard.isMeshStandardMaterial) {
        // A reference exporter marks its glazing materials BLEND. Keep those
        // source alpha values in Shaded mode and do not make their back faces
        // contribute a second layer of colour.
        standard.side = THREE.FrontSide;
        standard.depthTest = true;
        if (renderMode === "technical") {
          standard.alphaHash = false;
          standard.transparent = standard.opacity < 0.995;
          standard.depthWrite = !standard.transparent;
        } else {
          // X-ray uses depth-tested alpha hashing so thousands of fragments do
          // not swap transparent sort order and flash as the view changes.
          standard.transparent = false;
          standard.opacity = Math.min(standard.opacity, 0.24);
          standard.alphaHash = true;
          standard.depthWrite = true;
        }
      }
      material.needsUpdate = true;
    }
  });
}

/**
 * The opening camera for a reference, framed from its own extent.
 *
 * This used to be four hand-measured vectors — a position, target, up and fov
 * captured while looking at one building. Any other reference opened on a view
 * of empty space. Framing the bounds that were just measured works for any.
 */
export function referenceHomePose(bounds: ReturnType<typeof referenceModelBounds>) {
  const centre = new THREE.Vector3(
    (bounds.min.x + bounds.max.x) / 2,
    (bounds.min.y + bounds.max.y) / 2,
    (bounds.min.z + bounds.max.z) / 2,
  );
  const radius = Math.max(
    bounds.max.x - bounds.min.x,
    bounds.max.y - bounds.min.y,
    bounds.max.z - bounds.min.z,
  ) / 2 || 1;
  const yUp = referenceIsYUp(bounds);
  const up = yUp ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  // A three-quarter view from above, the orientation the shared presets call
  // `iso`, expressed in whichever axis this reference calls up.
  const offset = yUp
    ? new THREE.Vector3(1, 0.62, 1).normalize()
    : new THREE.Vector3(1, 1, 0.62).normalize();
  return {
    position: centre.clone().addScaledVector(offset, radius * 2.4),
    target: centre,
    up,
    fov: 45,
  };
}

/**
 * The same ten orientations, in a y-up reference's frame.
 *
 * glTF is y-up where the recovery is z-up, so rather than keep a second table
 * that can drift out of step, the shared one is asked and its answer rotated:
 * model `(x, y, z)` is reference `(x, z, −y)`.
 */
export function referencePoseForPreset(preset: CameraPreset, radius: number) {
  const pose = cameraPoseForPreset({ x: 0, y: 0, z: 0 }, radius, preset);
  return {
    position: new THREE.Vector3(pose.position.x, pose.position.z, -pose.position.y),
    target: new THREE.Vector3(),
    up: new THREE.Vector3(pose.up.x, pose.up.z, -pose.up.y),
    fov: 45,
  };
}
