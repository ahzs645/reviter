/** Building and tearing down Three.js groups for the viewer. */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  elementDisplayRoles,
  glazingElementIds,
  type DisplayRole,
} from "../../lib/reviter/scene.ts";
import type {
  ConvertResult,
  ReferenceMeshData,
} from "../../lib/reviter/types.ts";
import {
  referenceRegistration,
  type NavigationMode,
  type RenderMode,
} from "../../lib/reviter/viewer.ts";

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
  foreground: boolean;
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
  if (!elementIds || !glazingIds.size) {
    return [{ indices, elementIds, glazing: false, foreground: false }];
  }

  let glazingTriangles = 0;
  for (const elementId of elementIds) if (glazingIds.has(elementId)) glazingTriangles += 1;
  if (glazingTriangles === 0) {
    return [{ indices, elementIds, glazing: false, foreground: false }];
  }
  if (glazingTriangles === elementIds.length) {
    return [{ indices, elementIds, glazing: true, foreground: false }];
  }

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
    { indices: rest.indices, elementIds: rest.ids, glazing: false, foreground: false },
    { indices: glass.indices, elementIds: glass.ids, glazing: true, foreground: false },
  ];
}

/**
 * Hosted inserts and facade children win an exact depth tie with their host.
 *
 * The recovered RVT contains uncut host faces under doors, panels and frames.
 * They occupy the same plane as the insert, so merely changing the depth
 * comparison would make whichever batch happened to be created first win.
 * Splitting only the mixed batches lets semantic evidence decide that tie
 * without turning every element into its own draw call.
 */
const FOREGROUND_ROLES = new Set<DisplayRole>(["door", "panel", "frame", "covering"]);

function splitByForeground(
  part: BatchPart,
  foregroundIds: ReadonlySet<number>,
): BatchPart[] {
  const { indices, elementIds } = part;
  if (part.glazing || !elementIds || !foregroundIds.size) return [part];

  let foregroundTriangles = 0;
  for (const elementId of elementIds) {
    if (foregroundIds.has(elementId)) foregroundTriangles += 1;
  }
  if (foregroundTriangles === 0) return [part];
  if (foregroundTriangles === elementIds.length) return [{ ...part, foreground: true }];

  const foreground = {
    indices: new Uint32Array(foregroundTriangles * 3),
    ids: new Uint32Array(foregroundTriangles),
    at: 0,
  };
  const background = {
    indices: new Uint32Array((elementIds.length - foregroundTriangles) * 3),
    ids: new Uint32Array(elementIds.length - foregroundTriangles),
    at: 0,
  };
  for (let triangle = 0; triangle < elementIds.length; triangle += 1) {
    const elementId = elementIds[triangle]!;
    const into = foregroundIds.has(elementId) ? foreground : background;
    into.indices[into.at * 3] = indices[triangle * 3]!;
    into.indices[into.at * 3 + 1] = indices[triangle * 3 + 1]!;
    into.indices[into.at * 3 + 2] = indices[triangle * 3 + 2]!;
    into.ids[into.at] = elementId;
    into.at += 1;
  }
  return [
    {
      indices: foreground.indices,
      elementIds: foreground.ids,
      glazing: false,
      foreground: true,
    },
    {
      indices: background.indices,
      elementIds: background.ids,
      glazing: false,
      foreground: false,
    },
  ];
}

function recoveredRenderOrder(
  source: "native-brep" | "display-proxy" | undefined,
  materialSource: "rvt-material" | "display-fallback" | undefined,
  foreground: boolean,
): number {
  // Opaque objects are sorted from low to high renderOrder. With LessDepth,
  // this is also their deterministic priority when two fragments are exactly
  // coplanar: hosted native inserts first, then resolved native materials,
  // unresolved native material, and finally display proxies.
  if (source !== "display-proxy") {
    if (foreground) return 0;
    return materialSource === "rvt-material" ? 1 : 2;
  }
  return foreground ? 3 : 4;
}

/**
 * A tiny deterministic separation for recovered layers that occupy one plane.
 *
 * Strict depth comparison stabilises bit-identical triangles, but Revit also
 * emits overlapping faces with different tessellations and material ids. Their
 * interpolated depths can alternate by a handful of buffer units across one
 * wall, producing the fine horizontal/diagonal bands. Hosted inserts remain
 * unbiased; resolved native materials follow their stable palette order, then
 * unresolved native faces and display proxies sit progressively farther away.
 */
function recoveredDepthBias(
  source: "native-brep" | "display-proxy" | undefined,
  materialSource: "rvt-material" | "display-fallback" | undefined,
  materialIndex: number,
  foreground: boolean,
): number {
  if (source !== "display-proxy") {
    if (foreground) return 0;
    return materialSource === "rvt-material"
      ? 1 + Math.min(Math.max(materialIndex, 0), 127) * 2
      : 320;
  }
  return foreground ? 384 : 448;
}

export function meshGroup(
  result: ConvertResult,
  renderMode: RenderMode,
  hiddenElementIds: ReadonlySet<number> = new Set(),
  reverseDepthBuffer = false,
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
  const foregroundIds = new Set(
    [...elementDisplayRoles(result.elementBounds)]
      .filter(([, role]) => FOREGROUND_ROLES.has(role))
      .map(([elementId]) => elementId),
  );
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
    const glazingParts = materialDecides
      ? [{
          indices: visible.indices,
          elementIds: visible.elementIds,
          glazing: sourceOpacity < 0.995,
          foreground: false,
        }]
      : splitByGlazing(visible, glazingIds);
    const parts = glazingParts.flatMap((part) => splitByForeground(part, foregroundIds));
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
      const depthBias = technical && !transparent
        ? recoveredDepthBias(
            data.source,
            sourceMaterial?.source,
            data.materialIndex,
            part.foreground,
          )
        : 0;
      // `units` separates fragments that quantise to the same depth value.
      // Revit's overlapping material faces are frequently triangulated along
      // different diagonals, though, so their interpolated depth also changes
      // with screen-space slope. A small, capped factor keeps the established
      // material priority stable through an orbit without visibly pulling a
      // layer away from the building.
      const depthSlopeBias = depthBias > 0
        ? Math.min(1.5, Math.max(0.125, depthBias / 256))
        : 0;
      const depthBiasSign = reverseDepthBuffer ? -1 : 1;
      const material = new THREE.MeshStandardMaterial({
        color: sourceColor,
        vertexColors: !technical,
        roughness: technical ? 0.86 : sourceMaterial?.roughness ?? 0.74,
        metalness: technical ? 0 : sourceMaterial?.metallic ?? 0.04,
        flatShading: true,
        // Recovered native faces are not guaranteed to form a closed,
        // consistently wound shell. Roof 1848155, for example, has only the
        // top-facing surface on this route; front-face culling therefore makes
        // it disappear from below. Keep recovered geometry visible from both
        // sides. Coplanar material competition is handled by the deterministic
        // depth ordering and bias above rather than by discarding back faces.
        side: THREE.DoubleSide,
        transparent,
        opacity,
        depthWrite: !transparent,
        // The supplied RVT contains about 91k repeated native triangles, with
        // some host-wall faces also left beneath doors and facade children.
        // LessEqual lets coplanar triangles overwrite the same depth sample,
        // producing the moving diagonal patches visible at eye height. Keep the
        // first opaque fragment instead; genuinely nearer faces still pass,
        // while glazing keeps the normal transparency path below.
        depthFunc: technical && !transparent ? THREE.LessDepth : THREE.LessEqualDepth,
        // In reverse-Z a negative polygon offset moves a lower-priority layer
        // away; the sign is the opposite for the conventional depth buffer.
        // Reverse-Z flips both parts of the offset; otherwise an oblique face
        // would move toward the camera while its depth-unit offset moves away.
        polygonOffset: depthBias > 0,
        polygonOffsetFactor: depthBiasSign * depthSlopeBias,
        polygonOffsetUnits: depthBiasSign * depthBias,
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
      mesh.renderOrder = technical && !transparent
        ? recoveredRenderOrder(data.source, sourceMaterial?.source, part.foreground)
        : 1;
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
      if (isElementBounds && data.source === "display-proxy") {
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
    // IFC batches are diagnostic geometry rather than authored materials. In
    // X-ray, make that distinction useful: aligned/context surfaces become a
    // quiet ghost so stairs and walls remain readable behind curtain panels,
    // while geometric differences stay visibly red. Previously both visual
    // styles were fully opaque, so the X-ray button could not reveal anything
    // behind the first IFC face it encountered.
    const transparent = !technical;
    const opacity = technical
      ? 1
      : data.diffStatus === "different"
        ? 0.72
        : data.diffStatus === "aligned"
          ? 0.22
          : 0.14;
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: data.diffStatus === "different"
        ? new THREE.Color(0x3a0206)
        : data.matched ? color.clone().multiplyScalar(0.08) : new THREE.Color(0x000000),
      roughness: technical ? 0.84 : data.diffStatus === "aligned" ? 0.58 : 0.82,
      metalness: technical ? 0 : 0.02,
      side: THREE.DoubleSide,
      transparent,
      opacity,
      depthWrite: !transparent,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = data.name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = data.diffStatus === "different" ? 3 : data.matched ? 2 : 1;
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
 * The colouring is the point of the mode. The paired IFC is deliberately
 * rendered over the RVT body instead of as a faint ghost: gray means the IFC
 * covers the recovered body, amber remains visible only where the RVT has no
 * paired surface, red is a geometric disagreement, and violet is IFC-only
 * context. Polygon offset keeps coincident matched faces stable while orbiting.
 */
export function overlayMeshGroup(
  result: ConvertResult,
  meshes: ReferenceMeshData[],
  renderMode: RenderMode,
  reverseDepthBuffer = false,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "Recovery over export";
  group.userData = { source: "overlay", fidelity: "comparison" };

  const recovered = meshGroup(result, renderMode, new Set(), reverseDepthBuffer);
  recovered.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.color = new THREE.Color(0xf2a93b);
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
    const context = data.diffStatus === "context";
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(aligned ? 0x7d8792 : different ? 0xff1744 : 0x6f5ee8),
      emissive: new THREE.Color(
        aligned ? 0x11161b : different ? 0x42000f : context ? 0x100b38 : 0x000000,
      ),
      emissiveIntensity: aligned ? 0.12 : different ? 0.34 : 0.18,
      roughness: 0.78,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: context,
      opacity: context ? 0.78 : 1,
      depthWrite: !context,
      polygonOffset: true,
      polygonOffsetFactor: reverseDepthBuffer ? 2 : -2,
      polygonOffsetUnits: reverseDepthBuffer ? 2 : -2,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${data.name} (${data.diffStatus})`;
    mesh.renderOrder = different ? 3 : context ? 2 : 1;
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
