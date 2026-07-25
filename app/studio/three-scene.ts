/** Building and tearing down Three.js groups for the viewer. */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  referenceRegistration,
  type ConvertResult,
  type NavigationMode,
  type ReferenceMeshData,
  type RenderMode,
} from "../../lib/reviter";

export function meshGroup(result: ConvertResult, renderMode: RenderMode): THREE.Group {
  const group = new THREE.Group();
  const isElementBounds = result.method === "partition-bounds-recovery";
  const technical = renderMode === "technical";
  group.name = "Reviter recovered geometry";
  group.userData = {
    sourceFile: result.fileName,
    method: result.method,
    originFeet: result.origin,
    fidelity: "experimental",
  };
  for (const data of result.meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(data.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geometry.computeVertexNormals();
    const sourceMaterial = result.materials[data.materialIndex] ?? result.materials[0];
    const sourceColor = sourceMaterial
      ? new THREE.Color().setRGB(...sourceMaterial.baseColorLinear.slice(0, 3) as [number, number, number])
      : new THREE.Color(0xb9cbe0);
    const glazingProxy = data.name.startsWith("Glazing");
    const material = new THREE.MeshStandardMaterial({
      color: sourceColor,
      vertexColors: !technical,
      roughness: technical ? 0.86 : sourceMaterial?.roughness ?? 0.74,
      metalness: technical ? 0 : sourceMaterial?.metallic ?? 0.04,
      flatShading: true,
      side: THREE.DoubleSide,
      transparent: isElementBounds && (!technical || glazingProxy),
      opacity: isElementBounds ? (technical ? (glazingProxy ? 0.58 : 1) : 0.32) : 1,
      depthWrite: technical ? !glazingProxy : !isElementBounds,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = data.name;
    mesh.castShadow = technical;
    mesh.receiveShadow = technical;
    mesh.userData.elementIds = data.elementIds;
    mesh.renderOrder = 1;
    group.add(mesh);
    if (isElementBounds) {
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 1),
        new THREE.LineBasicMaterial({
          color: technical ? 0x263c55 : 0x9be7e3,
          transparent: true,
          opacity: technical ? 0.56 : 0.68,
          depthWrite: false,
        }),
      );
      edges.name = `${data.name} edges`;
      edges.renderOrder = 2;
      group.add(edges);
    }
  }
  return group;
}

export function referenceMeshGroup(meshes: ReferenceMeshData[], renderMode: RenderMode): THREE.Group {
  const group = new THREE.Group();
  const technical = renderMode === "technical";
  group.name = "IFC reference geometry";
  group.userData = { source: "paired-ifc", fidelity: "reference" };
  for (const data of meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geometry.computeVertexNormals();
    const color = technical
      ? new THREE.Color(data.matched ? 0xc6d6e8 : 0xaebed2)
      : new THREE.Color().setRGB(...data.color);
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: data.matched ? color.clone().multiplyScalar(0.08) : new THREE.Color(0x000000),
      roughness: technical ? 0.84 : data.matched ? 0.58 : 0.82,
      metalness: technical ? 0 : 0.02,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = data.name;
    mesh.castShadow = technical;
    mesh.receiveShadow = technical;
    mesh.renderOrder = data.matched ? 2 : 1;
    group.add(mesh);
    if (technical && data.indices.length <= 600_000) {
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 28),
        new THREE.LineBasicMaterial({ color: 0x263c55, transparent: true, opacity: 0.42 }),
      );
      edges.name = `${data.name} edges`;
      group.add(edges);
    }
  }
  return group;
}

/**
 * Both models in one scene, in one coordinate system.
 *
 * Until now the three geometry sources were mutually exclusive, so the only way
 * to compare recovery against the export was to switch between them and
 * remember what you saw. They are both z-up and share the project's datum; all
 * that separated them was units and the origin the recovered scene is drawn
 * around, which is a scale and a translation rather than a registration
 * problem. The export is therefore parented to a group carrying exactly that
 * transform instead of having its vertices rewritten.
 *
 * The colouring is the point of the mode: the recovery reads as solid, an
 * exported element the recovery also has is a quiet ghost, and an exported
 * element that is **missing** from the recovery is picked out in red. What is
 * wrong with the conversion becomes something you can look at.
 */
export function overlayMeshGroup(
  result: ConvertResult,
  meshes: ReferenceMeshData[],
  renderMode: RenderMode,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "Recovery over export";
  group.userData = { source: "overlay", fidelity: "comparison" };

  const recovered = meshGroup(result, renderMode);
  recovered.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.color = new THREE.Color(0xff8a3d);
    material.vertexColors = false;
    material.transparent = false;
    material.opacity = 1;
    material.depthWrite = true;
    material.needsUpdate = true;
  });
  group.add(recovered);

  // metres -> feet, then into the frame the recovered scene is drawn around.
  const reference = new THREE.Group();
  reference.name = "Paired export";
  const registration = referenceRegistration(result.origin);
  reference.scale.setScalar(registration.scale);
  reference.position.set(registration.offset.x, registration.offset.y, registration.offset.z);

  for (const data of meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(data.matched ? 0x4a6b86 : 0xff3b46),
      emissive: data.matched ? new THREE.Color(0x000000) : new THREE.Color(0x3a0206),
      roughness: 0.85,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: true,
      // A matched element is context and stays out of the way; a missing one
      // has to be visible through the recovery standing in front of it.
      opacity: data.matched ? 0.22 : 0.95,
      depthWrite: !data.matched,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${data.name} (${data.matched ? "matched" : "missing from recovery"})`;
    mesh.renderOrder = data.matched ? 0 : 3;
    reference.add(mesh);
  }
  group.add(reference);
  return group;
}

export function disposeGroup(group: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  group.traverse((object) => {
    const renderable = object as THREE.Mesh | THREE.LineSegments;
    if (!(object as THREE.Mesh).isMesh && !(object as THREE.LineSegments).isLineSegments) return;
    geometries.add(renderable.geometry);
    if (Array.isArray(renderable.material)) renderable.material.forEach((material) => materials.add(material));
    else materials.add(renderable.material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

export function applyNavigationMode(controls: OrbitControls, mode: NavigationMode) {
  controls.mouseButtons.LEFT = mode === "pan"
    ? THREE.MOUSE.PAN
    : mode === "zoom"
      ? THREE.MOUSE.DOLLY
      : THREE.MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = mode === "orbit" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
}
