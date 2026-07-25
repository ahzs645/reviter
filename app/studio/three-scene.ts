/** Building and tearing down Three.js groups for the viewer. */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
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
