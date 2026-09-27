import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027FacetedTopology,
  REVIT_2027_FACETED_TOPOLOGY_FORMS,
} from "../lib/reviter/revit-2027-faceted-topology.ts";
import {
  decodeRevit2027GPolyMesh,
  REVIT_2027_GPOLYMESH_BODY_BYTES,
  REVIT_2027_GPOLYMESH_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-gpolymesh.ts";
import { createRevit2027GRepReplayRegistry } from "../lib/reviter/revit-2027-grep-replay.ts";
import type { Revit2027GRepReplay, Revit2027GRepReplaySpan } from "../lib/reviter/revit-2027-grep-replay.ts";
import { meshRevit2027PolyMeshReplay } from "../lib/reviter/revit-2027-polymesh-owner-mesh.ts";

const FACETED_TOPOLOGY_0 = 1868;
const FACETED_TOPOLOGY_8 = 1899;
const FACETED_TOPOLOGY_2 = 1874;

/** Little-endian bytes. */
class Bytes {
  readonly parts: number[] = [];
  private put(size: number, write: (view: DataView) => void): this {
    const view = new DataView(new ArrayBuffer(size));
    write(view);
    this.parts.push(...new Uint8Array(view.buffer));
    return this;
  }
  i32(value: number) { return this.put(4, (view) => view.setInt32(0, value, true)); }
  u16(value: number) { return this.put(2, (view) => view.setUint16(0, value, true)); }
  i16(value: number) { return this.put(2, (view) => view.setInt16(0, value, true)); }
  i64(value: bigint) { return this.put(8, (view) => view.setBigInt64(0, value, true)); }
  f32(...values: number[]) { for (const value of values) this.put(4, (view) => view.setFloat32(0, value, true)); return this; }
  f64(...values: number[]) { for (const value of values) this.put(8, (view) => view.setFloat64(0, value, true)); return this; }
  u8(...values: number[]) { this.parts.push(...values); return this; }
  build() { return Uint8Array.from(this.parts); }
}

/** A unit square in z = 0 as two triangles, with its normals as stored. */
function square(mode: 0 | 2, form: "float" | "offset-float" = "float", edges = false): Uint8Array {
  const bytes = new Bytes().i32(mode).f32(0, 0, 0);
  if (mode === 0) bytes.i32(4).f32(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
  else bytes.i32(2).f32(0, 0, 1, 0, 0, 1);
  if (form === "offset-float") bytes.f64(100, 200, 300);
  bytes.i32(4).f32(0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0);
  bytes.i32(2).u16(0).u16(1).u16(2).u16(0).u16(2).u16(3);
  if (edges) bytes.i32(2).u8(7, 7);
  return bytes.build();
}

test("faceted topology is read in each form the files use", () => {
  const perPoint = square(0);
  const decoded = decodeRevit2027FacetedTopology(perPoint, 0, perPoint.length, 2027, FACETED_TOPOLOGY_0);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.endOffset, perPoint.length);
  assert.equal(decoded.value.positions.length, 12);
  assert.deepEqual([...decoded.value.indices], [0, 1, 2, 0, 2, 3]);
  assert.equal(decoded.value.normals.length, 12);

  const withEdges = square(2, "float", true);
  const eight = decodeRevit2027FacetedTopology(withEdges, 0, withEdges.length, 2027, FACETED_TOPOLOGY_8);
  assert.equal(eight.ok && eight.value.endOffset, withEdges.length);

  const offset = square(2, "offset-float");
  const two = decodeRevit2027FacetedTopology(offset, 0, offset.length, 2027, FACETED_TOPOLOGY_2);
  assert.deepEqual(two.ok && [...two.value.positions.slice(3, 6)], [101, 200, 300]);
  assert.equal(REVIT_2027_FACETED_TOPOLOGY_FORMS.size, 12);
});

test("faceted topology that cannot be a mesh is refused", () => {
  const bad = square(0);
  // A facet index past the last point.
  bad[bad.length - 2] = 9;
  assert.equal(decodeRevit2027FacetedTopology(bad, 0, bad.length, 2027, FACETED_TOPOLOGY_0).ok, false);
  // Truncated.
  const good = square(0);
  assert.equal(decodeRevit2027FacetedTopology(good, 0, good.length - 1, 2027, FACETED_TOPOLOGY_0).ok, false);
  // A form this reader does not know.
  assert.equal(decodeRevit2027FacetedTopology(good, 0, good.length, 2027, 1887).ok, false);
});

test("a GPolyMesh is a style, a queued topology, a material and flags", () => {
  const data = new Bytes()
    .i64(102861n).i32(-1).i32(0x08000000).i32(0x0008e004)
    .i32(-1).i16(FACETED_TOPOLOGY_0)
    .i64(7566n).i64(490603n).i32(2)
    .build();
  assert.equal(data.length, REVIT_2027_GPOLYMESH_BODY_BYTES);
  const decoded = decodeRevit2027GPolyMesh(data, 0, data.length, 2027);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.topology.sourceClassSlot, FACETED_TOPOLOGY_0);
  assert.equal(decoded.value.materialElementId, 490603n);
  assert.equal(decoded.value.polyMeshFlags, 2);
  const registry = createRevit2027GRepReplayRegistry();
  assert.equal(registry.get(REVIT_2027_GPOLYMESH_SOURCE_CLASS_SLOT)?.id, "Revit2027GPolyMesh");
  assert.equal(registry.get(FACETED_TOPOLOGY_8)?.id, "Revit2027FacetedTopology8");
});

function span(
  replayIndex: number,
  parentReplayIndex: number | null,
  readerId: string,
  value: unknown,
): Revit2027GRepReplaySpan {
  return {
    replayIndex,
    queueSequence: replayIndex,
    ownerElementId: 42n,
    path: parentReplayIndex == null ? [replayIndex] : [parentReplayIndex, 0],
    parentPath: parentReplayIndex == null ? null : [parentReplayIndex],
    parentReplayIndex,
    propertyToken: 1,
    propertySourceClassSlot: 0,
    descriptorOffset: 0,
    descriptorEndOffset: 0,
    startOffset: 0,
    endOffset: 1,
    readerId,
    value,
  };
}

test("each polymesh is meshed from the one topology it queued", () => {
  const data = square(2);
  const topology = decodeRevit2027FacetedTopology(data, 0, data.length, 2027, FACETED_TOPOLOGY_0);
  assert.equal(topology.ok, true);
  if (!topology.ok) return;
  const polyMesh = { byteOffset: 0, materialElementId: 490603n };
  const replay = (spans: Revit2027GRepReplaySpan[]): Revit2027GRepReplay => ({
    ownerElementId: 42n,
    startOffset: 0,
    endOffset: 1,
    initialTokenCount: 0,
    finalTokenCount: 0,
    descriptors: [],
    spans,
  });
  const meshed = meshRevit2027PolyMeshReplay(replay([
    span(0, null, "Revit2027GPolyMesh", polyMesh),
    span(1, 0, "Revit2027FacetedTopology0", topology.value),
  ]));
  assert.equal(meshed.ok, true);
  if (!meshed.ok) return;
  assert.equal(meshed.value.length, 1);
  const [face] = meshed.value;
  // Per-triangle normals become flat triangles of their own.
  assert.equal(face!.mesh.indices.length, 6);
  assert.equal(face!.mesh.positions.length, 18);
  assert.deepEqual([...face!.mesh.normals.slice(0, 3)], [0, 0, 1]);
  assert.equal(face!.mesh.groups[0]!.materialId, 490603);

  // A polymesh whose topology is missing fails its owner.
  assert.equal(meshRevit2027PolyMeshReplay(replay([span(0, null, "Revit2027GPolyMesh", polyMesh)])).ok, false);
});
