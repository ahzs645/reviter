import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { meshGroup } from "../app/studio/three-scene.ts";
import {
  anonymousWallDuplicateProxyIds,
  buildBoundsMeshes,
  displayMaterials,
  elementDisplayRoles,
  glazingElementIds,
  selectDisplayBounds,
} from "../lib/reviter/scene.ts";
import type { ConvertResult, ElementBoundsRecord } from "../lib/reviter/types.ts";

function record(elementId: number, categoryId: number): ElementBoundsRecord {
  return {
    elementId,
    recordOffset: 0,
    boundsOffset: 0,
    recordCode: 44,
    recordCount: 1,
    categoryId,
    stream: "Partitions/0",
    chunkIndex: 0,
    rawOffset: 0,
    boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 1, z: 8 } },
  };
}

test("glazing is identified from the decoded category, not a material's alpha", () => {
  // Revit's persisted material transparency is not decoded, so every native
  // material arrives opaque — including the one the supplied model names
  // `Стекло`, which is glass and carries 74,968 of its glazing triangles.
  const records = [
    record(1, -2000170), // Curtain Wall Panels
    record(2, -2000014), // Windows
    record(3, -2000011), // Walls
    record(4, -2000171), // Curtain Wall Mullions
  ];
  assert.deepEqual([...glazingElementIds(records)].sort(), [1, 2]);
});

test("display roles are exposed per element, because a native batch mixes categories", () => {
  // Native batches group by native material, so a batch's material says nothing
  // about what its elements are; the per-element roles are what the viewer can
  // actually act on.
  const roles = elementDisplayRoles([
    record(1, -2000170),
    record(3, -2000011),
    record(5, -2000126),
  ]);
  assert.equal(roles.get(1), "glazing");
  assert.equal(roles.get(3), "wall");
  assert.equal(roles.get(5), "railing");
});

test("anonymous wall-contained fallback bodies do not pierce the recovered host", () => {
  const wall = record(1, -2000011);
  wall.boundsFeet = {
    min: { x: -5, y: -0.5, z: 0 },
    max: { x: 5, y: 0.5, z: 8 },
  };
  const anonymous = record(2, -2000011);
  delete anonymous.categoryId;
  anonymous.boundsFeet = {
    min: { x: -2, y: -0.4, z: 0 },
    max: { x: 2, y: 0.52, z: 7 },
  };
  const namedInsert = { ...anonymous, elementId: 3, categoryName: "Specialty Equipment" };
  const outside = { ...anonymous, elementId: 4, boundsFeet: {
    min: { x: -2, y: 0.3, z: 0 },
    max: { x: 2, y: 1.3, z: 7 },
  } };

  assert.deepEqual(
    [...anonymousWallDuplicateProxyIds([wall, anonymous, namedInsert, outside])],
    [anonymous.elementId],
  );
});

test("curtain panel analytic faces replace its enclosing box", () => {
  const panel = record(9, -2000170);
  panel.curtainPanelSurfaceQuads = [{
    elementId: 9,
    corners: [
      [0, 0, 0],
      [4, 0, 0],
      [4, 0, 8],
      [0, 0, 8],
    ],
  }];
  const [mesh] = buildBoundsMeshes([panel], { x: 0, y: 0, z: 0 });
  assert.equal(mesh!.indices.length / 3, 2);
  assert.equal(mesh!.positions.length / 3, 4);
  assert.deepEqual([...mesh!.elementIds!], [9, 9]);
});

test("a proxy with one persisted material uses its native material batch", () => {
  const nativeGlassMaterialIndex = displayMaterials().length;
  const assigned = record(10, -2000170);
  const fallback = record(11, -2000170);
  const meshes = buildBoundsMeshes(
    [assigned, fallback],
    { x: 0, y: 0, z: 0 },
    [],
    new Map([[assigned.elementId, nativeGlassMaterialIndex]]),
  );

  assert.equal(meshes.length, 2, "different materials require separate draw batches");
  const native = meshes.find((mesh) => mesh.materialIndex === nativeGlassMaterialIndex);
  const categoryFallback = meshes.find((mesh) => mesh.materialIndex !== nativeGlassMaterialIndex);
  assert.deepEqual([...native!.elementIds!], Array(12).fill(assigned.elementId));
  assert.deepEqual([...categoryFallback!.elementIds!], Array(12).fill(fallback.elementId));

  const materials = [
    ...displayMaterials(),
    {
      name: "Native glass",
      baseColorLinear: [0, 0.5, 0.75, 0.1] as [number, number, number, number],
      metallic: 0,
      roughness: 0.2,
      doubleSided: true,
      source: "rvt-material" as const,
      assignedElements: 1,
      transparency: 0.9,
    },
  ];
  const group = meshGroup({
    fileName: "proxy-material.rvt",
    method: "partition-bounds-recovery",
    origin: { x: 0, y: 0, z: 0 },
    elementBounds: [assigned, fallback],
    materials,
    meshes,
  } as unknown as ConvertResult, "technical");
  const renderedNative = group.children.find((child): child is THREE.Mesh =>
    (child as THREE.Mesh).isMesh &&
    (child.userData.elementIds as Uint32Array | undefined)?.includes(assigned.elementId));
  assert.ok(renderedNative);
  assert.equal(
    (renderedNative.material as THREE.MeshStandardMaterial).opacity,
    0.1,
    "the proxy keeps Revit's 90%-transparent glass instead of the 55%-opaque fallback",
  );
  assert.equal(
    (renderedNative.material as THREE.MeshStandardMaterial).transparent,
    false,
    "technical glass does not enter Three's distance-sorted transparent queue",
  );
  assert.equal(
    (renderedNative.material as THREE.MeshStandardMaterial).alphaHash,
    true,
    "front and back pane surfaces use stable depth-tested alpha hashing",
  );
  assert.equal(
    (renderedNative.material as THREE.MeshStandardMaterial).depthWrite,
    true,
  );
  assert.equal(
    (renderedNative.material as THREE.MeshStandardMaterial).side,
    THREE.DoubleSide,
    "glass remains visible from both exterior Orbit and interior Walk views",
  );
});

test("a record with no decoded category contributes no glazing claim", () => {
  const bare: ElementBoundsRecord = {
    elementId: 9,
    recordOffset: 0,
    boundsOffset: 0,
    recordCode: 999,
    recordCount: 7,
    stream: "Partitions/0",
    chunkIndex: 0,
    rawOffset: 0,
    boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
  };
  assert.equal(glazingElementIds([bare]).size, 0);
});

test("proxy batches are tagged as proxies, so the wireframe overlay can find them", () => {
  // The overlay is what makes a twelve-triangle envelope box read as a
  // technical drawing; on 1,001,796 native triangles it emitted 928,488 line
  // segments and became the viewer's dominant cost. Telling the two apart by
  // batch name was what failed before, so the batch states its own provenance.
  const meshes = buildBoundsMeshes([record(1, -2000011)], { x: 0, y: 0, z: 0 });
  assert.ok(meshes.length > 0);
  for (const mesh of meshes) assert.equal(mesh.source, "display-proxy");
});

test("curtain-wall wrappers cut openings through an intersecting reconstructed wall", () => {
  const wall: ElementBoundsRecord = {
    ...record(100, -2000011),
    recordCode: 30,
    recordCount: 5,
    categoryName: "Walls",
    typeName: "Interior Wall - 175mm",
    boundsFeet: {
      min: { x: 0, y: -0.5, z: 0 },
      max: { x: 10, y: 0.5, z: 10 },
    },
    solid: {
      elementId: 100,
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      baseElevation: 0,
      topElevation: 10,
      thickness: 1,
    },
  };
  const wrapper: ElementBoundsRecord = {
    ...record(200, -2000011),
    recordCode: 30,
    recordCount: 9,
    categoryName: "Walls",
    boundsFeet: {
      min: { x: 3, y: -2, z: 2 },
      max: { x: 7, y: 2, z: 8 },
    },
  };
  const panel: ElementBoundsRecord = {
    ...record(201, -2000170),
    recordCode: 114,
    recordCount: 1,
    categoryName: "Curtain Wall Panels",
    boundsFeet: {
      min: { x: 3.2, y: -0.25, z: 2.2 },
      max: { x: 6.8, y: 0.25, z: 7.8 },
    },
  };
  const selection = selectDisplayBounds([wall, wrapper, panel]);
  assert.deepEqual(
    selection.records.map((entry) => entry.elementId),
    [wall.elementId, panel.elementId],
  );
  assert.deepEqual(
    selection.openingWrappers.map((entry) => entry.elementId),
    [wrapper.elementId],
  );

  const [data] = buildBoundsMeshes(
    [wall],
    { x: 0, y: 0, z: 0 },
    selection.openingWrappers,
  );
  assert.ok(data);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const intersectionsAt = (x: number, z: number) => {
    ray.set(new THREE.Vector3(x, 3, z), new THREE.Vector3(0, -1, 0));
    return ray.intersectObject(mesh).length;
  };

  assert.equal(intersectionsAt(5, 5), 0, "the curtain panel has a clear opening");
  assert.ok(intersectionsAt(1, 5) > 0, "the wall remains beside the opening");
  assert.ok(intersectionsAt(5, 1) > 0, "the wall remains below the opening");
  geometry.dispose();
  (mesh.material as THREE.Material).dispose();
});

test("a wrapper beside one wall face does not cut the wall", () => {
  const wall: ElementBoundsRecord = {
    ...record(300, -2000011),
    categoryName: "Walls",
    solid: {
      elementId: 300,
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      baseElevation: 0,
      topElevation: 10,
      thickness: 1,
    },
  };
  const adjacent = {
    ...record(301, -2000011),
    boundsFeet: {
      min: { x: 3, y: 0.2, z: 2 },
      max: { x: 7, y: 2, z: 8 },
    },
  };
  const [uncut] = buildBoundsMeshes(
    [wall],
    { x: 0, y: 0, z: 0 },
    [adjacent],
  );
  assert.ok(uncut);
  assert.equal(uncut.indices.length / 3, 12);
});

test("a persisted door host relation cuts a reconstructed wall proxy", () => {
  const wall: ElementBoundsRecord = {
    ...record(804162, -2000011),
    categoryName: "Walls",
    solid: {
      elementId: 804162,
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      baseElevation: 0,
      topElevation: 10,
      thickness: 0.4,
    },
  };
  const door: ElementBoundsRecord = {
    ...record(1028273, -2000023),
    categoryName: "Doors",
    boundsFeet: {
      min: { x: 3, y: -2, z: 0 },
      max: { x: 7, y: 2, z: 7 },
    },
  };
  const [data] = buildBoundsMeshes(
    [wall],
    { x: 0, y: 0, z: 0 },
    [],
    new Map(),
    new Map([[wall.elementId, [door]]]),
  );
  assert.ok(data);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  const rendered = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  rendered.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  ray.set(new THREE.Vector3(5, 3, 4), new THREE.Vector3(0, -1, 0));
  assert.equal(
    ray.intersectObject(rendered).length,
    0,
    "the persisted door envelope opens the proxy host wall",
  );
  geometry.dispose();
  (rendered.material as THREE.Material).dispose();
});

test("the glazing display material keeps the alpha the viewer reuses for native glass", () => {
  const glazing = displayMaterials().find((material) => material.name.startsWith("Glazing"));
  assert.ok(glazing);
  assert.equal(glazing!.baseColorLinear[3], 0.55);
});

test("the residual railing display material is opaque", () => {
  // Native admission suppresses the proxy per railing. The fallback material
  // therefore serves only the evidence-starved residuals, not the native
  // category population, and no longer needs a global translucency concession.
  const railing = displayMaterials().find((material) => material.name.startsWith("Railing"));
  assert.ok(railing);
  assert.equal(railing!.baseColorLinear[3], 1);
});

test("opaque hosted inserts win coplanar depth ties with their host wall", () => {
  const wall = record(1, -2000011);
  const door = record(2, -2000023);
  const result = {
    fileName: "coplanar.rvt",
    method: "partition-bounds-recovery",
    origin: { x: 0, y: 0, z: 0 },
    elementBounds: [wall, door],
    materials: [{
      name: "Resolved native material",
      baseColorLinear: [0.5, 0.5, 0.5, 1],
      metallic: 0,
      roughness: 0.8,
      doubleSided: true,
      source: "rvt-material",
      assignedElements: 2,
    }],
    meshes: [{
      name: "Mixed wall and door material",
      positions: new Float32Array([
        0, 0, 0, 1, 0, 0, 0, 1, 0,
        0, 0, 0, 1, 0, 0, 0, 1, 0,
      ]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      colors: new Float32Array([
        1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1,
      ]),
      elementIds: new Uint32Array([wall.elementId, door.elementId]),
      materialIndex: 0,
      source: "native-brep",
    }],
  } as unknown as ConvertResult;

  const group = meshGroup(result, "technical");
  const meshes = group.children.filter((child): child is THREE.Mesh => (child as THREE.Mesh).isMesh);
  assert.equal(meshes.length, 2, "a mixed native batch is split only at the semantic depth boundary");

  const forElement = (elementId: number) => meshes.find((mesh) =>
    (mesh.userData.elementIds as Uint32Array | undefined)?.[0] === elementId);
  const wallMesh = forElement(wall.elementId);
  const doorMesh = forElement(door.elementId);
  assert.ok(wallMesh);
  assert.ok(doorMesh);
  assert.equal((wallMesh.material as THREE.MeshStandardMaterial).depthFunc, THREE.LessDepth);
  assert.equal((doorMesh.material as THREE.MeshStandardMaterial).depthFunc, THREE.LessDepth);
  assert.equal((wallMesh.material as THREE.MeshStandardMaterial).polygonOffset, true);
  assert.ok(
    (wallMesh.material as THREE.MeshStandardMaterial).polygonOffsetUnits > 0,
    "conventional depth moves the lower-priority host away with a positive unit bias",
  );
  assert.ok(
    (wallMesh.material as THREE.MeshStandardMaterial).polygonOffsetFactor > 0,
    "the host also receives a slope bias so differently tessellated coplanar faces stay ordered",
  );
  assert.equal(
    (doorMesh.material as THREE.MeshStandardMaterial).polygonOffset,
    false,
    "the hosted insert remains the unbiased foreground surface",
  );
  assert.equal(
    (doorMesh.material as THREE.MeshStandardMaterial).side,
    THREE.DoubleSide,
    "recovered native faces remain visible when an incomplete shell is viewed from behind",
  );
  assert.ok(
    doorMesh.renderOrder < wallMesh.renderOrder,
    "the door draws first, so equal-depth wall fragments cannot replace its material",
  );

  const proxyResult = {
    ...result,
    materials: displayMaterials(),
    elementBounds: [wall],
    meshes: buildBoundsMeshes([wall], { x: 0, y: 0, z: 0 }),
  } as unknown as ConvertResult;
  const proxyGroup = meshGroup(proxyResult, "technical");
  const proxyMesh = proxyGroup.children.find((child): child is THREE.Mesh =>
    (child as THREE.Mesh).isMesh);
  assert.ok(proxyMesh);
  assert.equal(
    (proxyMesh.material as THREE.MeshStandardMaterial).side,
    THREE.DoubleSide,
    "fallback envelopes remain visible even when their winding is not certified",
  );

  const reverseGroup = meshGroup(result, "technical", new Set(), true);
  const reverseWall = reverseGroup.children.find((child): child is THREE.Mesh =>
    (child as THREE.Mesh).isMesh &&
    (child.userData.elementIds as Uint32Array | undefined)?.[0] === wall.elementId);
  assert.ok(reverseWall);
  assert.ok(
    (reverseWall.material as THREE.MeshStandardMaterial).polygonOffsetUnits < 0,
    "reverse-Z flips the unit-bias sign while keeping the same material priority",
  );
  assert.ok(
    (reverseWall.material as THREE.MeshStandardMaterial).polygonOffsetFactor < 0,
    "reverse-Z also flips the slope-bias sign",
  );
});
