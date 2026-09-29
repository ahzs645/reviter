/** Owned, selector-verified faceted surfaces. No byte-pattern geometry scan. */
import { registerReleaseMarker, releaseMemo } from "./release-markers.ts";
import { decodeRevit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import { createRevit2027GRepReplayRegistry, replayRevit2027GRepFifo } from "./revit-2027-grep-replay.ts";
import { decodeRevit2026GPolyMeshStatic } from "./revit-2026-object-dispatch.ts";
import { decodeCondInt16PropertyDescriptor } from "./dynamic-geometry-queue.ts";
import { decodeFacetedTopologyFields, locateFacetedTopology0Body, type NeutralFacetedMesh } from "./faceted-topology.ts";
import type { PartitionObjectRecord } from "./partition-records.ts";
import type { Bounds3 } from "./types.ts";

let POLYMESH = registerReleaseMarker("GPolyMesh", 2277, value => { POLYMESH = value; });
let TOPOLOGY0 = registerReleaseMarker("FacetedTopology0", 1868, value => { TOPOLOGY0 = value; });

export type OwnedFacetedGeometry = {
  elementId: number;
  bounds: Bounds3;
  meshes: { mesh: NeutralFacetedMesh; materialId: number | null }[];
};

const registry = releaseMemo(() => {
  const readers = createRevit2027GRepReplayRegistry();
  readers.set(POLYMESH, { id: "GPolyMesh-static", read(data, context) {
    const bounded = data.subarray(0, context.replayEndOffset);
    const decoded = decodeRevit2026GPolyMeshStatic(bounded, context.byteOffset);
    if (!decoded.ok) return decoded;
    const descriptor = decodeCondInt16PropertyDescriptor(bounded, context.byteOffset + 20);
    if (!descriptor.ok) return descriptor;
    if (descriptor.descriptor.sourceClassSlot !== TOPOLOGY0) return { ok: false, error: "Unmeasured GPolyMesh topology class" };
    return { ok: true, startOffset: context.byteOffset, endOffset: decoded.value.endOffset,
      appendedProperties: [descriptor.descriptor], value: decoded.value.value };
  } });
  readers.set(TOPOLOGY0, { id: "FacetedTopology0-arrays", read(data, context) {
    const bounded = data.subarray(0, context.replayEndOffset);
    const located = locateFacetedTopology0Body(bounded, context.byteOffset);
    if (!located.ok) return located;
    const decoded = decodeFacetedTopologyFields(bounded, located.body.layout);
    if (!decoded.ok) return decoded;
    return { ok: true, startOffset: context.byteOffset, endOffset: located.body.endOffset,
      appendedProperties: [], value: decoded.mesh };
  } });
  return readers;
});

export function decodeOwnedFacetedGeometry(record: PartitionObjectRecord, release: number): OwnedFacetedGeometry | null {
  if (record.classIndex == null || record.objectLength < 18) return null;
  const view = new DataView(record.data.buffer, record.data.byteOffset, record.data.byteLength);
  const decoded = decodeRevit2027FramedGRepRoot(record.data, {
    elementId: record.elementId, marker: record.classIndex, offset: 0,
    objectLength: record.objectLength, typeCode: view.getUint32(18, true),
  }, release);
  if (!decoded.ok || Number(decoded.value.ownerElementId) !== record.elementId) return null;
  const root = decoded.value;
  if (!root.worldExtents.valid && !root.localExtents.valid) return null;
  if (!root.children.some(c => c.sourceClassSlot === POLYMESH)) return null;
  const replay = replayRevit2027GRepFifo(record.data, root, registry());
  if (!replay.ok || replay.value.endOffset !== root.dynamicPayloadEndOffset) return null;
  const meshes: OwnedFacetedGeometry["meshes"] = [];
  for (const span of replay.value.spans) {
    if (span.propertySourceClassSlot !== POLYMESH) continue;
    // Nested/conditioned occurrences need visibility and transform evaluation.
    // The measured SiteSurface meshes are direct children in model coordinates.
    if (span.path.length !== 1) return null;
    const topology = replay.value.spans.find(s => s.parentReplayIndex === span.replayIndex && s.propertySourceClassSlot === TOPOLOGY0);
    if (!topology) return null;
    const poly = span.value as { materialElementId: bigint; polyMeshFlags: number };
    if (poly.polyMeshFlags !== 2) return null;
    const mesh = topology.value as NeutralFacetedMesh;
    const extents = root.worldExtents.valid ? root.worldExtents : root.localExtents;
    for (let i = 0; i < mesh.positions.length; i += 1) {
      const value = mesh.positions[i]!;
      if (value < extents.minimum[i % 3]! - 0.01 || value > extents.maximum[i % 3]! + 0.01) return null;
    }
    const id = Number(poly.materialElementId);
    meshes.push({ mesh, materialId: Number.isSafeInteger(id) && id > 0 ? id : null });
  }
  if (!meshes.length) return null;
  const e = root.worldExtents.valid ? root.worldExtents : root.localExtents;
  return { elementId: record.elementId, meshes, bounds: {
    min: { x: e.minimum[0], y: e.minimum[1], z: e.minimum[2] },
    max: { x: e.maximum[0], y: e.maximum[1], z: e.maximum[2] },
  } };
}
