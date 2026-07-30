/** Load the Autodesk reference derivative with the application's Three.js instance. */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Keeping GLTFLoader in an ordinary application module gives Vite a lazy chunk
 * without bundling a second copy of Three.js. Objects returned here therefore
 * pass the same type checks and use the same renderer internals as the viewer.
 */
export async function loadReferenceModel(url: string): Promise<THREE.Group> {
  const gltf = await new GLTFLoader().loadAsync(url);
  return gltf.scene;
}
