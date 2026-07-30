/** Runtime compaction for the static Autodesk glTF reference scene. */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type MeshEntry = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
};

type LineEntry = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
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
};

const MIRROR_X = new THREE.Matrix4().makeScale(-1, 1, 1);

export function setAutodeskLineVisibility(
  root: THREE.Object3D,
  visible: boolean,
): void {
  root.traverse((object) => {
    if (object.userData.source === "autodesk-runtime-batch"
      && object.userData.primitive === "lines") {
      object.visible = visible;
    }
  });
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
  const lineEntries = new Map<THREE.Material, LineEntry[]>();
  const sourceGeometries = new Set<THREE.BufferGeometry>();
  const retainedMaterials = new Set<THREE.Material>();
  let sourceTriangleMeshes = 0;

  root.traverse((object) => {
    if ((object as THREE.LineSegments).isLineSegments) {
      const line = object as THREE.LineSegments;
      const material = singleMaterial(line);
      const matrix = rootWorldInverse.clone().multiply(line.matrixWorld);
      const entries = lineEntries.get(material) ?? [];
      entries.push({ geometry: line.geometry, material, matrix });
      lineEntries.set(material, entries);
      sourceGeometries.add(line.geometry);
      retainedMaterials.add(material);
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
        });
      }
    } else {
      entries.push({ geometry: mesh.geometry, material, matrix: meshMatrix });
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
      geometryVariants: geometryVariants.size
        + [...geometryVariants.values()].filter((entry) =>
          entry.regular != null && entry.mirrored != null
        ).length,
      mirroredInstances: entries.filter((entry) => entry.matrix.determinant() < 0).length,
    };
    output.add(batch);
  }

  for (const [material, entries] of lineEntries) {
    const transformed = entries.map((entry) => {
      const geometry = entry.geometry.clone();
      geometry.applyMatrix4(entry.matrix);
      return geometry;
    });
    const merged = mergeGeometries(transformed, false);
    transformed.forEach((geometry) => geometry.dispose());
    if (!merged) {
      throw new Error(
        `Could not merge Autodesk line material "${material.name || material.uuid}".`,
      );
    }
    const lines = new THREE.LineSegments(merged, material);
    lines.name = `Autodesk line batch · ${material.name || material.uuid}`;
    lines.castShadow = false;
    lines.receiveShadow = false;
    lines.userData = {
      source: "autodesk-runtime-batch",
      primitive: "lines",
      materialName: material.name,
      sourceObjectCount: entries.length,
    };
    output.add(lines);
  }

  const stats: AutodeskSceneBatchStats = {
    sourceTriangleMeshes,
    sourceLineSegments: [...lineEntries.values()].reduce(
      (sum, entries) => sum + entries.length,
      0,
    ),
    triangleBatches: meshEntries.size,
    lineBatches: lineEntries.size,
    triangleInstances: [...meshEntries.values()].reduce(
      (sum, entries) => sum + entries.length,
      0,
    ),
    mirroredTriangleInstances,
    copiedGeometryVariants,
    disposedSourceGeometries: sourceGeometries.size,
    retainedMaterials: retainedMaterials.size,
  };
  output.userData = {
    ...root.userData,
    source: root.userData.source ?? "autodesk-gltf-derivative",
    runtimeBatched: true,
    batchStats: stats,
  };

  // BatchedMesh and merged lines now own independent geometry buffers. Detach
  // the consumed hierarchy before releasing its originals, but retain materials
  // because the output scene reuses those exact objects.
  root.clear();
  sourceGeometries.forEach((geometry) => geometry.dispose());
  return output;
}
