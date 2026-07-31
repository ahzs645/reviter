import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBoundsMeshes,
  displayMaterials,
  elementDisplayRoles,
  glazingElementIds,
} from "../lib/reviter/scene.ts";
import type { ElementBoundsRecord } from "../lib/reviter/types.ts";

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
