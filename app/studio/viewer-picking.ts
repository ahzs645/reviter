/** Shared hit-test helpers and a lightweight selected-face overlay. */
import * as THREE from "three";

export type ViewerIntersection = THREE.Intersection<THREE.Object3D> & {
  batchId?: number;
};

export function isTriangleMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}

export function firstTriangleHit(
  raycaster: THREE.Raycaster,
  objects: readonly THREE.Object3D[],
  accept: (hit: ViewerIntersection) => boolean = () => true,
): ViewerIntersection | undefined {
  return raycaster.intersectObjects(objects as THREE.Object3D[], false).find((candidate) => {
    const hit = candidate as ViewerIntersection;
    return isTriangleMesh(hit.object) && hit.faceIndex != null && accept(hit);
  });
}

function instanceMatrix(hit: ViewerIntersection): THREE.Matrix4 {
  const batch = hit.object as THREE.BatchedMesh;
  return batch.isBatchedMesh && hit.batchId != null
    ? batch.getMatrixAt(hit.batchId, new THREE.Matrix4())
    : new THREE.Matrix4();
}

export function hitWorldNormal(hit: ViewerIntersection): THREE.Vector3 {
  if (!hit.face) return new THREE.Vector3(0, 1, 0);
  const localToWorld = new THREE.Matrix4()
    .multiplyMatrices(hit.object.matrixWorld, instanceMatrix(hit));
  return hit.face.normal.clone()
    .applyMatrix3(new THREE.Matrix3().getNormalMatrix(localToWorld))
    .normalize();
}

/**
 * Draw just the picked triangle. Anonymous GLB/IFC fragments cannot populate
 * the Revit properties panel, but they can still give clear selection feedback.
 */
export function createFaceSelection(
  hit: ViewerIntersection,
  camera: THREE.Camera,
  sceneScale: number,
): THREE.Group | null {
  if (hit.faceIndex == null || !isTriangleMesh(hit.object)) return null;
  const geometry = hit.object.geometry;
  const positions = geometry.getAttribute("position");
  if (!positions) return null;
  const index = geometry.index;
  const triangleOffset = hit.faceIndex * 3;
  const vertexIndex = (corner: number) =>
    index ? index.getX(triangleOffset + corner) : triangleOffset + corner;
  const localToWorld = new THREE.Matrix4()
    .multiplyMatrices(hit.object.matrixWorld, instanceMatrix(hit));
  const points = [0, 1, 2].map((corner) =>
    new THREE.Vector3().fromBufferAttribute(positions, vertexIndex(corner)).applyMatrix4(localToWorld));
  const normal = new THREE.Vector3()
    .crossVectors(points[1]!.clone().sub(points[0]!), points[2]!.clone().sub(points[0]!))
    .normalize();
  const midpoint = points[0]!.clone().add(points[1]!).add(points[2]!).multiplyScalar(1 / 3);
  if (normal.dot(camera.position.clone().sub(midpoint)) < 0) normal.negate();
  const offset = Math.max(0.001, sceneScale * 0.012);
  points.forEach((point) => point.addScaledVector(normal, offset));

  const selectedGeometry = new THREE.BufferGeometry().setFromPoints(points);
  selectedGeometry.setIndex([0, 1, 2]);
  selectedGeometry.computeVertexNormals();
  const fill = new THREE.Mesh(
    selectedGeometry,
    new THREE.MeshBasicMaterial({
      color: 0xffb52e,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  const outlineGeometry = new THREE.BufferGeometry().setFromPoints([
    points[0]!,
    points[1]!,
    points[2]!,
    points[0]!,
  ]);
  const outline = new THREE.Line(
    outlineGeometry,
    new THREE.LineBasicMaterial({ color: 0xff8a00, depthWrite: false }),
  );
  fill.renderOrder = 30;
  outline.renderOrder = 31;
  const selection = new THREE.Group();
  selection.name = "Selected reference face";
  selection.add(fill, outline);
  return selection;
}
