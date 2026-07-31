/** Building and tearing down Three.js groups for the viewer. */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  glazingElementIds,
  referenceRegistration,
  type ConvertResult,
  type NavigationMode,
  type ReferenceMeshData,
  type RenderMode,
} from "../../lib/reviter";

/**
 * The triangles of one batch minus the ones belonging to a hidden element.
 *
 * Every batch carries one element id per triangle, which is what makes turning
 * a whole category off a filter over the index rather than a rebuild of the
 * geometry: the vertices stay exactly where the converter put them.
 */
function visibleTriangles(
  indices: Uint32Array,
  elementIds: Uint32Array | undefined,
  hidden: ReadonlySet<number>,
): { indices: Uint32Array; elementIds: Uint32Array | undefined } {
  if (!hidden.size || !elementIds) return { indices, elementIds };
  const keptIndices = new Uint32Array(indices.length);
  const keptIds = new Uint32Array(elementIds.length);
  let at = 0;
  for (let triangle = 0; triangle < elementIds.length; triangle += 1) {
    const elementId = elementIds[triangle]!;
    if (hidden.has(elementId)) continue;
    keptIndices[at] = indices[triangle * 3]!;
    keptIndices[at + 1] = indices[triangle * 3 + 1]!;
    keptIndices[at + 2] = indices[triangle * 3 + 2]!;
    // Picking indexes by face, so the id table has to be filtered in step or
    // every click after a hidden category would name the wrong element.
    keptIds[at / 3] = elementId;
    at += 3;
  }
  return { indices: keptIndices.subarray(0, at), elementIds: keptIds.subarray(0, at / 3) };
}

/** Alpha the glazing display material carries, reused for native glass. */
const GLAZING_DISPLAY_ALPHA = 0.55;

type BatchPart = {
  indices: Uint32Array;
  elementIds: Uint32Array | undefined;
  glazing: boolean;
};

/**
 * Split one batch's triangles into its glazing and non-glazing halves.
 *
 * Returns the batch untouched when it is already uniform, which is the common
 * case — the split only costs anything for a batch that genuinely mixes glass
 * with something else.
 */
function splitByGlazing(
  visible: { indices: Uint32Array; elementIds: Uint32Array | undefined },
  glazingIds: ReadonlySet<number>,
): BatchPart[] {
  const { indices, elementIds } = visible;
  if (!elementIds || !glazingIds.size) return [{ indices, elementIds, glazing: false }];

  let glazingTriangles = 0;
  for (const elementId of elementIds) if (glazingIds.has(elementId)) glazingTriangles += 1;
  if (glazingTriangles === 0) return [{ indices, elementIds, glazing: false }];
  if (glazingTriangles === elementIds.length) return [{ indices, elementIds, glazing: true }];

  const glass = { indices: new Uint32Array(glazingTriangles * 3), ids: new Uint32Array(glazingTriangles), at: 0 };
  const rest = {
    indices: new Uint32Array((elementIds.length - glazingTriangles) * 3),
    ids: new Uint32Array(elementIds.length - glazingTriangles),
    at: 0,
  };
  for (let triangle = 0; triangle < elementIds.length; triangle += 1) {
    const elementId = elementIds[triangle]!;
    const into = glazingIds.has(elementId) ? glass : rest;
    into.indices[into.at * 3] = indices[triangle * 3]!;
    into.indices[into.at * 3 + 1] = indices[triangle * 3 + 1]!;
    into.indices[into.at * 3 + 2] = indices[triangle * 3 + 2]!;
    // Picking indexes by face, so the id table has to stay in step with the
    // split exactly as it does with the hidden-category filter above.
    into.ids[into.at] = elementId;
    into.at += 1;
  }
  return [
    { indices: rest.indices, elementIds: rest.ids, glazing: false },
    { indices: glass.indices, elementIds: glass.ids, glazing: true },
  ];
}

export function meshGroup(
  result: ConvertResult,
  renderMode: RenderMode,
  hiddenElementIds: ReadonlySet<number> = new Set(),
): THREE.Group {
  const group = new THREE.Group();
  const isElementBounds = result.method === "partition-bounds-recovery";
  const technical = renderMode === "technical";
  // Where a batch's native material carries the decoded persisted transparency
  // the material decides: glass reads translucent because Revit says 0.9, and
  // a spandrel panel reads solid because Revit says 0. The decoded categories
  // below remain the fallback for batches whose material never framed the
  // field — the same evidence the proxy path uses to pick the glazing slot.
  const glazingIds = glazingElementIds(result.elementBounds);
  group.name = "Reviter recovered geometry";
  group.userData = {
    sourceFile: result.fileName,
    method: result.method,
    originFeet: result.origin,
    fidelity: "experimental",
  };
  for (const data of result.meshes) {
    const visible = visibleTriangles(data.indices, data.elementIds, hiddenElementIds);
    if (!visible.indices.length) continue;
    const sourceMaterial = result.materials[data.materialIndex] ?? result.materials[0];
    const sourceColor = sourceMaterial
      ? new THREE.Color().setRGB(...sourceMaterial.baseColorLinear.slice(0, 3) as [number, number, number])
      : new THREE.Color(0xb9cbe0);
    const sourceOpacity = sourceMaterial?.baseColorLinear[3] ?? 1;

    // A native batch is grouped by native *material*. When that material's
    // persisted transparency was decoded, the whole batch shares one verdict
    // and there is nothing to split. Otherwise one batch routinely holds
    // several categories — the model's largest is 97.4% curtain-wall glazing
    // and 2.6% something else — and splitting the triangles is exact, where a
    // "mostly glazing" threshold would either turn 2,028 opaque triangles
    // translucent or leave 74,968 glass ones solid, and would be one more
    // number fitted to one building. Two draw calls at most, and only when a
    // batch is genuinely mixed.
    const materialDecides = sourceMaterial?.transparency != null;
    const parts = materialDecides
      ? [{ indices: visible.indices, elementIds: visible.elementIds, glazing: sourceOpacity < 0.995 }]
      : splitByGlazing(visible, glazingIds);
    for (const part of parts) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(data.colors, 3));
      geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
      geometry.computeVertexNormals();

      // `data.name.startsWith("Glazing")` used to stand here. It had not matched
      // anything for some time: batches are named by decoded Revit category
      // ("Curtain Wall Panels 1") or by native material ("Certified native BRep
      // · Material 26 · 19"), and neither starts with "Glazing". The
      // material-alpha clause sees a native batch now that the persisted
      // transparency is decoded into the palette alpha; `part.glazing` carries
      // the category fallback for batches without a decoded material.
      const glazing = part.glazing || sourceOpacity < 0.995;
      const transparent = technical ? glazing : true;
      const glazingOpacity = Math.min(sourceOpacity, GLAZING_DISPLAY_ALPHA);
      const opacity = technical
        ? (glazing
            ? (isElementBounds ? Math.min(glazingOpacity, 0.58) : glazingOpacity)
            : sourceOpacity)
        : Math.min(sourceOpacity, isElementBounds ? 0.32 : 0.28);
      const material = new THREE.MeshStandardMaterial({
        color: sourceColor,
        vertexColors: !technical,
        roughness: technical ? 0.86 : sourceMaterial?.roughness ?? 0.74,
        metalness: technical ? 0 : sourceMaterial?.metallic ?? 0.04,
        flatShading: true,
        side: THREE.DoubleSide,
        transparent,
        opacity,
        depthWrite: !transparent,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = part.glazing ? `${data.name} · glazing` : data.name;
      // Recovered BRep batches contain many unwelded, double-sided faces.
      // Shadowing those faces makes the depth pass self-interfere: opaque walls
      // acquire a stippled diagonal pattern that shimmers as the camera moves.
      // The paired Autodesk scene deliberately remains shadow-free for the same
      // reason, so keep both comparison sources on stable direct lighting.
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.userData.elementIds = part.elementIds;
      mesh.renderOrder = 1;
      group.add(mesh);

      // The wireframe overlay is what makes a twelve-triangle envelope box read
      // as a technical drawing. On native BRep geometry it is the opposite of
      // legible: the recovered scene is 912,044 native triangles against 49,738
      // proxy ones, and running `EdgesGeometry` over all of it emitted **928,488
      // line segments** — 1.86M line vertices rebuilt on the CPU and redrawn
      // every frame, transparent and depth-write-disabled. That is the lag, and
      // the interference between a million hairlines and the pixel grid is the
      // moiré that looks like the viewport is pixelating.
      //
      // Raising the threshold angle does not help — 28° still yields 894,064 —
      // because these batches are assembled from many elements' faces and are
      // not index-welded, so almost every triangle edge reads as a boundary.
      // The overlay belongs on the proxies it was built for.
      if (isElementBounds && data.source !== "native-brep") {
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
    const color = data.diffStatus === "different"
      ? new THREE.Color(0xff3b46)
      : technical
        ? new THREE.Color(data.diffStatus === "aligned" ? 0xc6d6e8 : 0xaebed2)
        : new THREE.Color().setRGB(...data.color);
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: data.diffStatus === "different"
        ? new THREE.Color(0x3a0206)
        : data.matched ? color.clone().multiplyScalar(0.08) : new THREE.Color(0x000000),
      roughness: technical ? 0.84 : data.diffStatus === "aligned" ? 0.58 : 0.82,
      metalness: technical ? 0 : 0.02,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = data.name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
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
 * The colouring is the point of the mode: recovery reads as solid orange,
 * IFC geometry aligned within tolerance is a quiet ghost, and actual
 * centre/size differences are red.
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
    const aligned = data.diffStatus === "aligned";
    const different = data.diffStatus === "different";
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(aligned ? 0x4a6b86 : different ? 0xff3b46 : 0x334e55),
      emissive: different ? new THREE.Color(0x3a0206) : new THREE.Color(0x000000),
      roughness: 0.85,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: aligned ? 0.18 : different ? 0.92 : 0.12,
      depthWrite: different,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${data.name} (${data.diffStatus})`;
    mesh.renderOrder = different ? 3 : 0;
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
  group.traverse((object) => {
    const batch = object as THREE.BatchedMesh;
    if (batch.isBatchedMesh) batch.dispose();
  });
}

export function applyNavigationMode(controls: OrbitControls, mode: NavigationMode) {
  // OrbitControls defaults to moving the camera in the pointer's direction,
  // which makes the model under the cursor appear to move the other way.
  // Reviter treats an orbit drag as direct manipulation of the building: pull
  // right/down and the building follows right/down.
  controls.rotateSpeed = -1;
  controls.mouseButtons.LEFT = mode === "pan"
    ? THREE.MOUSE.PAN
    : mode === "zoom"
      ? THREE.MOUSE.DOLLY
      : THREE.MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = mode === "orbit" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
}
