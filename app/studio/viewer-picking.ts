/** Shared hit-test helpers and a lightweight selected-face overlay. */
import * as THREE from "three";

export type ViewerIntersection = THREE.Intersection<THREE.Object3D> & {
  batchId?: number;
};

type InstanceReference = {
  object: THREE.Object3D;
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

function instanceMatrix(hit: InstanceReference): THREE.Matrix4 {
  const batch = hit.object as THREE.BatchedMesh;
  return batch.isBatchedMesh && hit.batchId != null
    ? batch.getMatrixAt(hit.batchId, new THREE.Matrix4())
    : new THREE.Matrix4();
}

type SurfaceFace = {
  faceIndex: number;
  vertices: readonly [number, number, number];
  vertexKeys: readonly [string, string, string];
  normal: THREE.Vector3;
};

type SurfaceTopology = {
  faces: SurfaceFace[];
  faceOffset: number;
  edgeFaces: Map<string, number[]>;
};

const topologyCache = new WeakMap<THREE.BufferGeometry, Map<string, SurfaceTopology>>();
const SURFACE_ANGLE_RADIANS = THREE.MathUtils.degToRad(12);
const SURFACE_NORMAL_DOT = Math.cos(SURFACE_ANGLE_RADIANS);
const MAX_SURFACE_TRIANGLES = 20_000;
const MAX_ELEMENT_TRIANGLES = 100_000;

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function geometryFaceRange(hit: InstanceReference): { start: number; count: number } {
  const geometry = (hit.object as THREE.Mesh).geometry;
  const totalCount = geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0;
  const batch = hit.object as THREE.BatchedMesh;
  if (batch.isBatchedMesh && hit.batchId != null) {
    const geometryId = batch.getGeometryIdAt(hit.batchId);
    const range = batch.getGeometryRangeAt(geometryId);
    if (range) return { start: range.start, count: range.count };
  }
  const start = Math.max(0, geometry.drawRange.start);
  const available = Math.max(0, totalCount - start);
  return {
    start,
    count: Number.isFinite(geometry.drawRange.count)
      ? Math.min(available, geometry.drawRange.count)
      : available,
  };
}

function surfaceTopology(
  geometry: THREE.BufferGeometry,
  range: { start: number; count: number },
): SurfaceTopology | null {
  const positions = geometry.getAttribute("position");
  if (!positions) return null;
  const cacheKey = `${range.start}:${range.count}`;
  const geometryCache = topologyCache.get(geometry) ?? new Map<string, SurfaceTopology>();
  topologyCache.set(geometry, geometryCache);
  const cached = geometryCache.get(cacheKey);
  if (cached) return cached;

  const index = geometry.index;
  const faceOffset = Math.floor(range.start / 3);
  const faceCount = Math.floor(range.count / 3);
  const vertexIndex = (position: number) => index ? index.getX(position) : position;
  const point = new THREE.Vector3();
  const vertexKeys = new Map<number, string>();
  const keyForVertex = (vertex: number) => {
    const existing = vertexKeys.get(vertex);
    if (existing) return existing;
    point.fromBufferAttribute(positions, vertex);
    const key = `${Math.round(point.x * 100_000)},${Math.round(point.y * 100_000)},${Math.round(point.z * 100_000)}`;
    vertexKeys.set(vertex, key);
    return key;
  };
  const faces: SurfaceFace[] = [];
  const edgeFaces = new Map<string, number[]>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let localFace = 0; localFace < faceCount; localFace += 1) {
    const triangleOffset = range.start + localFace * 3;
    const vertices = [
      vertexIndex(triangleOffset),
      vertexIndex(triangleOffset + 1),
      vertexIndex(triangleOffset + 2),
    ] as const;
    const keys = vertices.map(keyForVertex) as [string, string, string];
    a.fromBufferAttribute(positions, vertices[0]);
    b.fromBufferAttribute(positions, vertices[1]);
    c.fromBufferAttribute(positions, vertices[2]);
    const normal = new THREE.Vector3()
      .crossVectors(b.clone().sub(a), c.clone().sub(a))
      .normalize();
    faces.push({
      faceIndex: faceOffset + localFace,
      vertices,
      vertexKeys: keys,
      normal,
    });
    const faceEdges = [
      edgeKey(keys[0], keys[1]),
      edgeKey(keys[1], keys[2]),
      edgeKey(keys[2], keys[0]),
    ];
    for (const key of faceEdges) {
      const linked = edgeFaces.get(key) ?? [];
      linked.push(localFace);
      edgeFaces.set(key, linked);
    }
  }
  const topology = { faces, faceOffset, edgeFaces };
  geometryCache.set(cacheKey, topology);
  return topology;
}

export function connectedSurfaceFaceIndices(
  hit: ViewerIntersection,
): number[] {
  if (hit.faceIndex == null || !isTriangleMesh(hit.object)) return [];
  const geometry = hit.object.geometry;
  const topology = surfaceTopology(geometry, geometryFaceRange(hit));
  if (!topology) return [];
  const start = hit.faceIndex - topology.faceOffset;
  if (start < 0 || start >= topology.faces.length) return [hit.faceIndex];
  const selected = new Set<number>([start]);
  const queue = [start];
  while (queue.length && selected.size < MAX_SURFACE_TRIANGLES) {
    const faceId = queue.shift()!;
    const face = topology.faces[faceId]!;
    const edges = [
      edgeKey(face.vertexKeys[0], face.vertexKeys[1]),
      edgeKey(face.vertexKeys[1], face.vertexKeys[2]),
      edgeKey(face.vertexKeys[2], face.vertexKeys[0]),
    ];
    for (const edge of edges) {
      for (const neighborId of topology.edgeFaces.get(edge) ?? []) {
        if (selected.has(neighborId)) continue;
        const neighbor = topology.faces[neighborId]!;
        if (face.normal.dot(neighbor.normal) < SURFACE_NORMAL_DOT) continue;
        selected.add(neighborId);
        queue.push(neighborId);
      }
    }
  }
  return [...selected].map((faceId) => topology.faces[faceId]!.faceIndex);
}

export function hitWorldNormal(hit: ViewerIntersection): THREE.Vector3 {
  if (!hit.face) return new THREE.Vector3(0, 1, 0);
  const localToWorld = new THREE.Matrix4()
    .multiplyMatrices(hit.object.matrixWorld, instanceMatrix(hit));
  return hit.face.normal.clone()
    .applyMatrix3(new THREE.Matrix3().getNormalMatrix(localToWorld))
    .normalize();
}

type SelectionFragment = {
  object: THREE.Mesh;
  batchId?: number;
  faceIndices: readonly number[];
  orientNormal?: THREE.Vector3;
};

type SelectionEdge = {
  count: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
  normals: THREE.Vector3[];
};

function fragmentMatrix(fragment: SelectionFragment): THREE.Matrix4 {
  return new THREE.Matrix4().multiplyMatrices(
    fragment.object.matrixWorld,
    instanceMatrix(fragment),
  );
}

function createSelectionOverlay(
  fragments: readonly SelectionFragment[],
  sceneScale: number,
  name: string,
  metadata: Record<string, unknown> = {},
): THREE.Group | null {
  if (!fragments.length) return null;
  const offset = Math.max(0.001, sceneScale * 0.012);
  const fillPoints: THREE.Vector3[] = [];
  const selectionEdges = new Map<string, SelectionEdge>();
  let triangleCount = 0;

  for (const fragment of fragments) {
    const geometry = fragment.object.geometry;
    const positions = geometry.getAttribute("position");
    if (!positions) continue;
    const index = geometry.index;
    const localToWorld = fragmentMatrix(fragment);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(localToWorld);
    const vertexIndex = (position: number) => index ? index.getX(position) : position;
    const localPoint = new THREE.Vector3();
    const localA = new THREE.Vector3();
    const localB = new THREE.Vector3();
    const localC = new THREE.Vector3();

    for (const faceIndex of fragment.faceIndices) {
      const triangleOffset = faceIndex * 3;
      const vertices = [0, 1, 2].map((corner) => vertexIndex(triangleOffset + corner));
      localA.fromBufferAttribute(positions, vertices[0]!);
      localB.fromBufferAttribute(positions, vertices[1]!);
      localC.fromBufferAttribute(positions, vertices[2]!);
      const faceNormal = new THREE.Vector3()
        .crossVectors(localB.clone().sub(localA), localC.clone().sub(localA))
        .applyMatrix3(normalMatrix)
        .normalize();
      if (!Number.isFinite(faceNormal.x) || faceNormal.lengthSq() < 1e-8) continue;
      if (fragment.orientNormal && faceNormal.dot(fragment.orientNormal) < 0) {
        faceNormal.negate();
      }
      const worldPoints = vertices.map((vertex) =>
        localPoint.fromBufferAttribute(positions, vertex)
          .clone()
          .applyMatrix4(localToWorld)
          .addScaledVector(faceNormal, offset));
      fillPoints.push(...worldPoints);
      triangleCount += 1;
      const vertexKeys = worldPoints.map((point) =>
        `${Math.round(point.x * 100_000)},${Math.round(point.y * 100_000)},${Math.round(point.z * 100_000)}`);
      const edges = [
        [0, 1],
        [1, 2],
        [2, 0],
      ] as const;
      for (const [aIndex, bIndex] of edges) {
        const key = edgeKey(vertexKeys[aIndex]!, vertexKeys[bIndex]!);
        const existing = selectionEdges.get(key);
        if (existing) {
          existing.count += 1;
          existing.normals.push(faceNormal.clone());
        } else {
          selectionEdges.set(key, {
            count: 1,
            a: worldPoints[aIndex]!,
            b: worldPoints[bIndex]!,
            normals: [faceNormal.clone()],
          });
        }
      }
    }
  }
  if (!fillPoints.length) return null;

  const selectedGeometry = new THREE.BufferGeometry().setFromPoints(fillPoints);
  selectedGeometry.computeVertexNormals();
  const throughFill = new THREE.Mesh(
    selectedGeometry,
    new THREE.MeshBasicMaterial({
      color: 0x79dcff,
      transparent: true,
      opacity: 0.14,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  const visibleFill = new THREE.Mesh(
    selectedGeometry,
    new THREE.MeshBasicMaterial({
      color: 0x56d7ff,
      transparent: true,
      opacity: 0.22,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    }),
  );
  const outlinePoints = [...selectionEdges.values()]
    .filter((edge) => edge.count === 1 || edge.normals.some((normal, index) =>
      edge.normals.slice(index + 1).some((other) =>
        Math.abs(normal.dot(other)) < SURFACE_NORMAL_DOT)))
    .flatMap((edge) => [edge.a, edge.b]);
  const outlineGeometry = new THREE.BufferGeometry().setFromPoints(outlinePoints);
  const outline = new THREE.LineSegments(
    outlineGeometry,
    new THREE.LineBasicMaterial({
      color: 0xe2f3ff,
      transparent: true,
      opacity: 0.96,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  throughFill.renderOrder = 40;
  visibleFill.renderOrder = 41;
  outline.renderOrder = 42;
  const selection = new THREE.Group();
  selection.name = name;
  selection.userData = {
    ...metadata,
    triangleCount,
    boundaryEdgeCount: outlinePoints.length / 2,
  };
  selection.add(throughFill, visibleFill, outline);
  return selection;
}

/**
 * Draw the connected continuous surface around the picked render triangle.
 * Anonymous GLB/IFC fragments cannot populate the Revit properties panel, but
 * their triangulation should not leak into the selection interaction.
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
  const faceIndices = connectedSurfaceFaceIndices(hit);
  if (!faceIndices.length) return null;
  const pickedNormal = hitWorldNormal(hit);
  if (pickedNormal.dot(camera.position.clone().sub(hit.point)) < 0) pickedNormal.negate();
  return createSelectionOverlay([{
    object: hit.object,
    ...(hit.batchId == null ? {} : { batchId: hit.batchId }),
    faceIndices,
    orientNormal: pickedNormal,
  }], sceneScale, "Selected continuous reference surface", {
    scope: "surface",
  });
}

/**
 * Select every GLB fragment carrying the picked reference element key. Complex
 * elements such as stairs can span many meshes and materials.
 */
export function createElementSelection(
  hit: ViewerIntersection,
  sceneScale: number,
): THREE.Group | null {
  const batch = hit.object as THREE.BatchedMesh;
  if (!batch.isBatchedMesh || hit.batchId == null) return null;
  const elementKey = (batch.userData.elementKeys as string[] | undefined)?.[hit.batchId];
  const elementFragments = batch.parent?.userData.elementFragments as Map<
    string,
    Array<{ object: THREE.BatchedMesh; batchId: number }>
  > | undefined;
  const matches = elementKey ? elementFragments?.get(elementKey) : undefined;
  if (!elementKey || !matches?.length) return null;

  let remaining = MAX_ELEMENT_TRIANGLES;
  const fragments: SelectionFragment[] = [];
  for (const match of matches) {
    const range = geometryFaceRange({
      object: match.object,
      batchId: match.batchId,
    });
    const faceOffset = Math.floor(range.start / 3);
    const faceCount = Math.min(Math.floor(range.count / 3), remaining);
    if (!faceCount) continue;
    fragments.push({
      object: match.object,
      batchId: match.batchId,
      faceIndices: Array.from({ length: faceCount }, (_, index) => faceOffset + index),
    });
    remaining -= faceCount;
    if (!remaining) break;
  }
  return createSelectionOverlay(
    fragments,
    sceneScale,
    "Selected reference model element",
    {
      scope: "element",
      elementKey,
      fragmentCount: fragments.length,
      truncated: remaining === 0,
    },
  );
}
