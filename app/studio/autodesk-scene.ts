/** Runtime compaction for the static Autodesk glTF reference scene. */
import * as THREE from "three";
import { WalkSurfaceIndex, type WalkSurfaceStats } from "./walk-surface.ts";

type MeshEntry = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
  elementKey: string;
};

export type AutodeskElementFragment = {
  object: THREE.BatchedMesh;
  batchId: number;
};

export type AutodeskSceneBatchStats = {
  sourceTriangleMeshes: number;
  sourceLineSegments: number;
  triangleBatches: number;
  lineBatches: number;
  triangleInstances: number;
  mirroredTriangleInstances: number;
  copiedGeometryVariants: number;
  disposedSourceGeometries: number;
  retainedMaterials: number;
  walkSurface: WalkSurfaceStats;
};

const MIRROR_X = new THREE.Matrix4().makeScale(-1, 1, 1);

export type AutodeskOutlineMode = "orbit" | "walk";

export function setAutodeskOutlineMode(
  root: THREE.Object3D,
  mode: AutodeskOutlineMode,
): void {
  root.traverse((object) => {
    if (object.userData.source === "autodesk-runtime-batch"
      && object.userData.primitive === "lines") {
      object.visible = true;
      const material = (object as THREE.LineSegments).material as THREE.LineBasicMaterial;
      material.opacity = mode === "walk" ? 0.26 : 0.11;
    }
  });
}

function autodeskOutlineMaterial(): THREE.LineBasicMaterial {
  const material = new THREE.LineBasicMaterial({
    color: 0x111820,
    transparent: true,
    opacity: 0.11,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  material.name = "Reviter Autodesk depth-aware outlines";
  material.depthFunc = THREE.LessEqualDepth;
  return material;
}

function createAutodeskOutlines(
  meshEntries: ReadonlyMap<THREE.Material, readonly MeshEntry[]>,
): THREE.LineSegments | null {
  const edgeGeometries = new Map<THREE.BufferGeometry, THREE.EdgesGeometry>();
  let vertexCount = 0;
  for (const entries of meshEntries.values()) {
    for (const entry of entries) {
      let edges = edgeGeometries.get(entry.geometry);
      if (!edges) {
        edges = new THREE.EdgesGeometry(entry.geometry, 28);
        edgeGeometries.set(entry.geometry, edges);
      }
      vertexCount += edges.getAttribute("position").count;
    }
  }
  if (!vertexCount) return null;

  const positions = new Float32Array(vertexCount * 3);
  const point = new THREE.Vector3();
  let offset = 0;
  for (const entries of meshEntries.values()) {
    for (const entry of entries) {
      const edgePositions = edgeGeometries.get(entry.geometry)!.getAttribute("position");
      for (let index = 0; index < edgePositions.count; index += 1) {
        point.fromBufferAttribute(edgePositions, index).applyMatrix4(entry.matrix);
        positions[offset++] = point.x;
        positions[offset++] = point.y;
        positions[offset++] = point.z;
      }
    }
  }
  edgeGeometries.forEach((geometry) => geometry.dispose());

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const lines = new THREE.LineSegments(geometry, autodeskOutlineMaterial());
  lines.name = "Autodesk generated topology outlines";
  lines.castShadow = false;
  lines.receiveShadow = false;
  lines.renderOrder = 4;
  lines.userData = {
    source: "autodesk-runtime-batch",
    primitive: "lines",
    generatedFromVisibleMeshes: true,
    vertexCount,
  };
  return lines;
}

function singleMaterial(
  object: THREE.Mesh | THREE.LineSegments,
): THREE.Material {
  if (Array.isArray(object.material)) {
    throw new Error(
      `Autodesk scene batching requires one material per primitive; "${object.name || object.uuid}" uses a material array.`,
    );
  }
  return object.material;
}

function reverseTriangleWinding(geometry: THREE.BufferGeometry): void {
  const index = geometry.getIndex();
  if (!index) {
    throw new Error("Mirrored Autodesk triangle geometry must be indexed.");
  }
  for (let offset = 0; offset + 2 < index.count; offset += 3) {
    const second = index.getX(offset + 1);
    index.setX(offset + 1, index.getX(offset + 2));
    index.setX(offset + 2, second);
  }
  index.needsUpdate = true;
}

/**
 * A reflected instance cannot be handed directly to BatchedMesh because Three
 * does not support negative instance scales. Reflecting a private geometry copy
 * and multiplying the reflection out of the instance matrix preserves the
 * original world transform while keeping the batch matrix right-handed.
 */
function mirroredGeometry(
  source: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const geometry = source.clone();
  geometry.applyMatrix4(MIRROR_X);
  reverseTriangleWinding(geometry);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function copyRootTransform(
  source: THREE.Object3D,
  target: THREE.Object3D,
): void {
  target.matrix.copy(source.matrix);
  target.matrixAutoUpdate = false;
  target.matrixWorldAutoUpdate = source.matrixWorldAutoUpdate;
}

function sourceElementKey(object: THREE.Object3D, root: THREE.Object3D): string {
  let candidate: THREE.Object3D | null = object;
  while (candidate && candidate !== root) {
    if (candidate.name) return candidate.name;
    candidate = candidate.parent;
  }
  return object.uuid;
}

/**
 * Consume a loaded, static Autodesk scene and replace its thousands of primitive
 * objects with material batches.
 *
 * Triangle instances remain independently sortable and frustum-cullable inside
 * BatchedMesh. Line transforms are baked into merged geometry. Source geometry
 * is disposed only after every batch has copied its data; source materials are
 * deliberately retained and reused by the compact scene.
 */
export function batchAutodeskScene(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const rootWorldInverse = root.matrixWorld.clone().invert();
  const meshEntries = new Map<THREE.Material, MeshEntry[]>();
  const sourceGeometries = new Set<THREE.BufferGeometry>();
  const discardedLineMaterials = new Set<THREE.Material>();
  const retainedMaterials = new Set<THREE.Material>();
  let sourceTriangleMeshes = 0;
  let sourceLineSegments = 0;

  root.traverse((object) => {
    if ((object as THREE.LineSegments).isLineSegments) {
      const line = object as THREE.LineSegments;
      const material = singleMaterial(line);
      sourceGeometries.add(line.geometry);
      discardedLineMaterials.add(material);
      sourceLineSegments += 1;
      return;
    }

    if (!(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      throw new Error("Autodesk scene batching only supports static triangle meshes.");
    }
    const material = singleMaterial(mesh);
    const entries = meshEntries.get(material) ?? [];
    const meshMatrix = rootWorldInverse.clone().multiply(mesh.matrixWorld);
    const elementKey = sourceElementKey(mesh, root);
    const instanced = mesh as THREE.InstancedMesh;
    if (instanced.isInstancedMesh) {
      if (instanced.instanceColor || instanced.morphTexture) {
        throw new Error("Autodesk scene batching does not support per-instance colors or morph targets.");
      }
      const instanceMatrix = new THREE.Matrix4();
      for (let instanceId = 0; instanceId < instanced.count; instanceId += 1) {
        instanced.getMatrixAt(instanceId, instanceMatrix);
        entries.push({
          geometry: mesh.geometry,
          material,
          matrix: meshMatrix.clone().multiply(instanceMatrix),
          elementKey,
        });
      }
    } else {
      entries.push({
        geometry: mesh.geometry,
        material,
        matrix: meshMatrix,
        elementKey,
      });
    }
    meshEntries.set(material, entries);
    sourceGeometries.add(mesh.geometry);
    retainedMaterials.add(material);
    sourceTriangleMeshes += 1;
  });

  const output = new THREE.Group();
  output.name = root.name || "Batched Autodesk derivative";
  copyRootTransform(root, output);

  let mirroredTriangleInstances = 0;
  let copiedGeometryVariants = 0;
  const walkSurface = new WalkSurfaceIndex({
    up: "y",
    cellSize: 1.25,
    minUpDot: 0.45,
  });
  const walkMatrix = new THREE.Matrix4();
  const elementFragments = new Map<string, AutodeskElementFragment[]>();

  for (const [material, entries] of meshEntries) {
    const geometryVariants = new Map<
      THREE.BufferGeometry,
      { regular?: number; mirrored?: number }
    >();
    const regularSources = new Set(
      entries
        .filter((entry) => entry.matrix.determinant() >= 0)
        .map((entry) => entry.geometry),
    );
    const mirroredSources = new Set(
      entries
        .filter((entry) => entry.matrix.determinant() < 0)
        .map((entry) => entry.geometry),
    );
    const maxVertexCount = [...regularSources].reduce(
      (sum, geometry) => sum + geometry.getAttribute("position").count,
      0,
    ) + [...mirroredSources].reduce(
      (sum, geometry) => sum + geometry.getAttribute("position").count,
      0,
    );
    const maxIndexCount = [...regularSources].reduce(
      (sum, geometry) => sum + (geometry.getIndex()?.count ?? 0),
      0,
    ) + [...mirroredSources].reduce(
      (sum, geometry) => sum + (geometry.getIndex()?.count ?? 0),
      0,
    );
    const batch = new THREE.BatchedMesh(
      entries.length,
      maxVertexCount,
      maxIndexCount,
      material,
    );
    batch.name = `Autodesk material batch · ${material.name || material.uuid}`;
    batch.castShadow = false;
    batch.receiveShadow = false;
    batch.perObjectFrustumCulled = true;
    batch.sortObjects = true;

    for (const entry of entries) {
      walkSurface.addGeometry(
        entry.geometry,
        walkMatrix.multiplyMatrices(root.matrixWorld, entry.matrix),
      );
      const mirrored = entry.matrix.determinant() < 0;
      const variants = geometryVariants.get(entry.geometry) ?? {};
      let geometryId = mirrored ? variants.mirrored : variants.regular;
      if (geometryId == null) {
        const geometry = mirrored
          ? mirroredGeometry(entry.geometry)
          : entry.geometry;
        geometryId = batch.addGeometry(geometry);
        copiedGeometryVariants += 1;
        if (mirrored) {
          variants.mirrored = geometryId;
          geometry.dispose();
        } else {
          variants.regular = geometryId;
        }
        geometryVariants.set(entry.geometry, variants);
      }

      const instanceId = batch.addInstance(geometryId);
      const matrix = mirrored
        ? entry.matrix.clone().multiply(MIRROR_X)
        : entry.matrix;
      batch.setMatrixAt(instanceId, matrix);
      const fragments = elementFragments.get(entry.elementKey) ?? [];
      fragments.push({ object: batch, batchId: instanceId });
      elementFragments.set(entry.elementKey, fragments);
      if (mirrored) mirroredTriangleInstances += 1;
    }

    batch.computeBoundingBox();
    batch.computeBoundingSphere();
    batch.userData = {
      source: "autodesk-runtime-batch",
      primitive: "triangles",
      materialName: material.name,
      transparent: material.transparent,
      instanceCount: entries.length,
      elementKeys: entries.map((entry) => entry.elementKey),
      geometryVariants: geometryVariants.size
        + [...geometryVariants.values()].filter((entry) =>
          entry.regular != null && entry.mirrored != null
        ).length,
      mirroredInstances: entries.filter((entry) => entry.matrix.determinant() < 0).length,
    };
    output.add(batch);
  }

  const outlines = createAutodeskOutlines(meshEntries);
  if (outlines) output.add(outlines);

  const stats: AutodeskSceneBatchStats = {
    sourceTriangleMeshes,
    sourceLineSegments,
    triangleBatches: meshEntries.size,
    lineBatches: outlines ? 1 : 0,
    triangleInstances: [...meshEntries.values()].reduce(
      (sum, entries) => sum + entries.length,
      0,
    ),
    mirroredTriangleInstances,
    copiedGeometryVariants,
    disposedSourceGeometries: sourceGeometries.size,
    retainedMaterials: retainedMaterials.size,
    walkSurface: walkSurface.stats(),
  };
  output.userData = {
    ...root.userData,
    source: root.userData.source ?? "autodesk-gltf-derivative",
    runtimeBatched: true,
    batchStats: stats,
    walkSurface,
    elementFragments,
  };

  // BatchedMesh and merged lines now own independent geometry buffers. Detach
  // the consumed hierarchy before releasing its originals, but retain materials
  // because the output scene reuses those exact objects.
  root.clear();
  sourceGeometries.forEach((geometry) => geometry.dispose());
  discardedLineMaterials.forEach((material) => {
    if (!retainedMaterials.has(material)) material.dispose();
  });
  return output;
}
