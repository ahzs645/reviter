import * as THREE from "three";

import type { SectionMode } from "./viewer-tools.ts";

export type MeasurementScene = {
  root: THREE.Group;
  draft: THREE.Group;
  preview: THREE.Line;
  groups: THREE.Group[];
  pending: THREE.Vector3[];
};

export type ExplodePart =
  | {
      object: THREE.Object3D;
      basePosition: THREE.Vector3;
      direction: THREE.Vector3;
    }
  | {
      object: THREE.BatchedMesh;
      batchId: number;
      baseMatrix: THREE.Matrix4;
      direction: THREE.Vector3;
    };

function disposeObject(object: THREE.Object3D): void {
  object.traverse((entry) => {
    const flags = entry as THREE.Object3D & {
      isMesh?: boolean;
      isLine?: boolean;
      isLineSegments?: boolean;
    };
    if (!flags.isMesh && !flags.isLine && !flags.isLineSegments) return;
    const renderable = entry as THREE.Mesh | THREE.Line | THREE.LineSegments;
    renderable.geometry.dispose();
    const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
    materials.forEach((material) => material.dispose());
  });
}

function measurementMarker(point: THREE.Vector3, radius: number): THREE.Mesh {
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(0.06, radius * 0.0045), 14, 10),
    new THREE.MeshBasicMaterial({ color: 0x14a9d6, depthTest: false }),
  );
  marker.position.copy(point);
  marker.renderOrder = 30;
  return marker;
}

function measurementLine(points: readonly THREE.Vector3[]): THREE.Line {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([...points]),
    new THREE.LineBasicMaterial({ color: 0x14a9d6, depthTest: false }),
  );
  line.renderOrder = 29;
  return line;
}

export function createMeasurementScene(scene: THREE.Scene): MeasurementScene {
  const root = new THREE.Group();
  const draft = new THREE.Group();
  const previewGeometry = new THREE.BufferGeometry();
  previewGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
  previewGeometry.setDrawRange(0, 0);
  const preview = new THREE.Line(
    previewGeometry,
    new THREE.LineDashedMaterial({
      color: 0x14a9d6,
      dashSize: 0.7,
      gapSize: 0.35,
      depthTest: false,
    }),
  );
  root.name = "Measurements";
  draft.name = "Pending measurement";
  preview.name = "Live measurement";
  preview.renderOrder = 29;
  preview.visible = false;
  scene.add(root, draft, preview);
  return { root, draft, preview, groups: [], pending: [] };
}

export function addPendingMeasurementPoint(
  measurement: MeasurementScene,
  point: THREE.Vector3,
  radius: number,
): void {
  measurement.pending.push(point.clone());
  measurement.draft.add(measurementMarker(point, radius));
  if (measurement.pending.length > 1) {
    measurement.draft.add(measurementLine(measurement.pending));
  }
}

export function commitMeasurement(
  measurement: MeasurementScene,
  radius: number,
): THREE.Vector3[] {
  const points = measurement.pending.map((point) => point.clone());
  const group = new THREE.Group();
  for (const point of points) group.add(measurementMarker(point, radius));
  if (points.length > 1) group.add(measurementLine(points));
  measurement.root.add(group);
  measurement.groups.push(group);
  clearPendingMeasurement(measurement);
  return points;
}

export function clearPendingMeasurement(measurement: MeasurementScene): void {
  while (measurement.draft.children.length) {
    const child = measurement.draft.children[0];
    if (!child) break;
    measurement.draft.remove(child);
    disposeObject(child);
  }
  measurement.pending.length = 0;
  measurement.preview.visible = false;
  measurement.preview.geometry.setDrawRange(0, 0);
}

export function updateMeasurementPreview(
  measurement: MeasurementScene,
  point: THREE.Vector3 | null,
): void {
  if (!point || !measurement.pending.length) {
    measurement.preview.visible = false;
    measurement.preview.geometry.setDrawRange(0, 0);
    return;
  }
  const points = [...measurement.pending, point].slice(0, 3);
  const positions = measurement.preview.geometry.getAttribute("position") as THREE.BufferAttribute;
  points.forEach((entry, index) => positions.setXYZ(index, entry.x, entry.y, entry.z));
  positions.needsUpdate = true;
  measurement.preview.geometry.setDrawRange(0, points.length);
  measurement.preview.computeLineDistances();
  measurement.preview.visible = true;
}

export function deleteLastMeasurement(measurement: MeasurementScene): boolean {
  const group = measurement.groups.pop();
  if (!group) return false;
  measurement.root.remove(group);
  disposeObject(group);
  return true;
}

export function clearMeasurements(measurement: MeasurementScene): void {
  clearPendingMeasurement(measurement);
  for (const group of measurement.groups) disposeObject(group);
  measurement.groups.length = 0;
  measurement.root.clear();
}

export function disposeMeasurementScene(scene: THREE.Scene, measurement: MeasurementScene): void {
  clearMeasurements(measurement);
  scene.remove(measurement.root, measurement.draft, measurement.preview);
  disposeObject(measurement.preview);
}

export function sectionPlanes(
  bounds: THREE.Box3,
  mode: SectionMode,
  offset: number,
  reverse = false,
): THREE.Plane[] {
  const amount = Math.max(0, Math.min(1, offset));
  if (mode === "box") {
    const inset = Math.min(0.48, amount * 0.48);
    const size = bounds.getSize(new THREE.Vector3());
    const min = bounds.min.clone().addScaledVector(size, inset);
    const max = bounds.max.clone().addScaledVector(size, -inset);
    return [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -min.x),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), max.x),
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -min.y),
      new THREE.Plane(new THREE.Vector3(0, -1, 0), max.y),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -min.z),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), max.z),
    ];
  }

  const axis = mode;
  const position = THREE.MathUtils.lerp(bounds.min[axis], bounds.max[axis], amount);
  const normal = new THREE.Vector3(
    axis === "x" ? -1 : 0,
    axis === "y" ? -1 : 0,
    axis === "z" ? -1 : 0,
  );
  const plane = new THREE.Plane(normal, position);
  return [reverse ? plane.negate() : plane];
}

export function createSectionHelper(
  bounds: THREE.Box3,
  mode: SectionMode,
  offset: number,
): THREE.Group {
  const helper = new THREE.Group();
  helper.name = "Section helper";
  const amount = Math.max(0, Math.min(1, offset));
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0x099bc5,
    transparent: true,
    opacity: 0.82,
    depthTest: false,
  });

  if (mode === "box") {
    const inset = Math.min(0.48, amount * 0.48);
    const boxSize = size.clone().multiplyScalar(1 - inset * 2);
    const geometry = new THREE.BoxGeometry(
      Math.max(0.001, boxSize.x),
      Math.max(0.001, boxSize.y),
      Math.max(0.001, boxSize.z),
    );
    const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: 0x14a9d6,
      transparent: true,
      opacity: 0.045,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), lineMaterial);
    fill.position.copy(center);
    edges.position.copy(center);
    fill.renderOrder = 24;
    edges.renderOrder = 25;
    helper.add(fill, edges);
    return helper;
  }

  const planeSize = mode === "x"
    ? [size.y, size.z]
    : mode === "y"
      ? [size.x, size.z]
      : [size.x, size.y];
  const geometry = new THREE.PlaneGeometry(
    Math.max(0.001, planeSize[0]),
    Math.max(0.001, planeSize[1]),
  );
  const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color: 0x14a9d6,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), lineMaterial);
  if (mode === "x") {
    fill.rotation.y = Math.PI / 2;
    edges.rotation.y = Math.PI / 2;
    center.x = THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, amount);
  } else if (mode === "y") {
    fill.rotation.x = Math.PI / 2;
    edges.rotation.x = Math.PI / 2;
    center.y = THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, amount);
  } else {
    center.z = THREE.MathUtils.lerp(bounds.min.z, bounds.max.z, amount);
  }
  fill.position.copy(center);
  edges.position.copy(center);
  fill.renderOrder = 24;
  edges.renderOrder = 25;
  helper.add(fill, edges);
  return helper;
}

export function applyClippingPlanes(root: THREE.Object3D, planes: readonly THREE.Plane[]): void {
  const styled = new Set<THREE.Material>();
  root.traverse((object) => {
    const flags = object as THREE.Object3D & { isMesh?: boolean; isLineSegments?: boolean };
    if (!flags.isMesh && !flags.isLineSegments) return;
    const renderable = object as THREE.Mesh | THREE.LineSegments;
    const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
    for (const material of materials) {
      if (styled.has(material)) continue;
      styled.add(material);
      material.clippingPlanes = [...planes];
      material.clipShadows = Boolean(planes.length);
      material.needsUpdate = true;
    }
  });
}

export function collectExplodeParts(root: THREE.Object3D, center: THREE.Vector3): ExplodePart[] {
  root.updateMatrixWorld(true);
  const parts: ExplodePart[] = [];
  root.traverse((object) => {
    const flags = object as THREE.Object3D & { isMesh?: boolean; isLineSegments?: boolean };
    if (!flags.isMesh && !flags.isLineSegments) return;
    const renderable = object as THREE.Mesh | THREE.LineSegments;
    const batch = renderable as THREE.BatchedMesh;
    if (batch.isBatchedMesh) {
      const parentInverse = batch.parent?.matrixWorld.clone().invert() ?? new THREE.Matrix4();
      const centerInParent = center.clone().applyMatrix4(parentInverse);
      const geometryBounds = new THREE.Box3();
      for (let batchId = 0; batchId < batch.instanceCount; batchId += 1) {
        const geometryId = batch.getGeometryIdAt(batchId);
        const baseMatrix = batch.getMatrixAt(batchId, new THREE.Matrix4());
        batch.getBoundingBoxAt(geometryId, geometryBounds);
        const localCenter = geometryBounds.getCenter(new THREE.Vector3()).applyMatrix4(baseMatrix);
        parts.push({
          object: batch,
          batchId,
          baseMatrix,
          direction: localCenter.sub(centerInParent),
        });
      }
      return;
    }
    const geometry = renderable.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox) return;
    const worldCenter = geometry.boundingBox.getCenter(new THREE.Vector3());
    renderable.localToWorld(worldCenter);
    const direction = worldCenter.sub(center);
    const parentInverse = renderable.parent?.matrixWorld.clone().invert();
    if (parentInverse) direction.applyMatrix3(new THREE.Matrix3().setFromMatrix4(parentInverse));
    parts.push({
      object: renderable,
      basePosition: renderable.position.clone(),
      direction,
    });
  });
  return parts;
}

export function applyExplode(parts: readonly ExplodePart[], amount: number): void {
  const factor = Math.max(0, Math.min(1, amount)) * 0.42;
  const matrix = new THREE.Matrix4();
  const preparedBatches = new Set<THREE.BatchedMesh>();
  for (const part of parts) {
    if ("batchId" in part) {
      if (!preparedBatches.has(part.object)) {
        part.object.frustumCulled = factor === 0;
        preparedBatches.add(part.object);
      }
      matrix.copy(part.baseMatrix);
      matrix.elements[12] += part.direction.x * factor;
      matrix.elements[13] += part.direction.y * factor;
      matrix.elements[14] += part.direction.z * factor;
      part.object.setMatrixAt(part.batchId, matrix);
    } else {
      part.object.position.copy(part.basePosition).addScaledVector(part.direction, factor);
      part.object.updateMatrixWorld();
    }
  }
}
