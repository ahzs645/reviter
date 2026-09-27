import {
  decodeCondInt16PropertyDescriptor,
  type CondInt16QueueEntry,
} from "./dynamic-geometry-queue.ts";
import type { Revit2027GInfo } from "./revit-2027-grep-prefixes.ts";
import { narrowElementIds } from "./element-id-width.ts";
import { usesRevit2027RecordLayout } from "./revit-class-tags.ts";

/** Exact Revit 2027 source-class slot for `GPolyMesh`. */
export const REVIT_2027_GPOLYMESH_SOURCE_CLASS_SLOT = 2277;
export const REVIT_2027_GPOLYMESH_BODY_BYTES = 46;

const GINFO_BYTES = 20;
const TOPOLOGY_OFFSET = GINFO_BYTES;
const INTERIOR_STYLE_OFFSET = TOPOLOGY_OFFSET + 6;
const MATERIAL_OFFSET = INTERIOR_STYLE_OFFSET + 8;
const FLAGS_OFFSET = MATERIAL_OFFSET + 8;

/**
 * A triangle mesh stored as such: an imported or generated mesh a family
 * holds instead of solids, such as a light fitting's lens and rod.
 */
export type Revit2027GPolyMesh = {
  byteOffset: number;
  endOffset: number;
  gInfo: Revit2027GInfo;
  /** The queued `m_pFacetedTopology`, which holds the triangles. */
  topology: CondInt16QueueEntry;
  interiorGStyleElementId: bigint;
  materialElementId: bigint;
  polyMeshFlags: number;
};

export type Revit2027GPolyMeshDecodeResult =
  | { ok: true; value: Revit2027GPolyMesh }
  | { ok: false; error: string };

/**
 * Decode the schema-complete Revit 2027 `GPolyMesh` body: the 20-byte `GInfo`
 * prefix, one CondInt16 descriptor queueing its faceted topology, the
 * interior style and material element ids, and the mesh flags.
 */
export function decodeRevit2027GPolyMesh(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
): Revit2027GPolyMeshDecodeResult {
  if (!usesRevit2027RecordLayout(revitVersion)) {
    return { ok: false, error: "Revit 2027 GPolyMesh decoding requires release 2027" };
  }
  // Through 2023 its two element ids are 32-bit and 2019-2022 add a trailing
  // flag; that layout has not been checked against a file, so it is not read.
  if (narrowElementIds()) {
    return { ok: false, error: "Revit 2027 GPolyMesh is not read where element ids are 32-bit" };
  }
  if (
    !Number.isSafeInteger(byteOffset) ||
    byteOffset < 0 ||
    !Number.isSafeInteger(enclosingEndOffset) ||
    enclosingEndOffset > data.byteLength ||
    byteOffset > enclosingEndOffset - REVIT_2027_GPOLYMESH_BODY_BYTES
  ) {
    return { ok: false, error: "Revit 2027 GPolyMesh body is truncated or outside its owner" };
  }
  const topology = decodeCondInt16PropertyDescriptor(data, byteOffset + TOPOLOGY_OFFSET);
  if (!topology.ok) return topology;
  if (
    topology.descriptor.endOffset !== byteOffset + INTERIOR_STYLE_OFFSET ||
    topology.descriptor.token === 0
  ) {
    return {
      ok: false,
      error: "Revit 2027 GPolyMesh has no queued faceted topology",
    };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: byteOffset + REVIT_2027_GPOLYMESH_BODY_BYTES,
      gInfo: {
        gStyleElementId: view.getBigInt64(byteOffset, true),
        tag: view.getInt32(byteOffset + 8, true),
        controlCommand: view.getInt32(byteOffset + 12, true),
        flags: view.getUint32(byteOffset + 16, true),
      },
      topology: topology.descriptor,
      interiorGStyleElementId: view.getBigInt64(byteOffset + INTERIOR_STYLE_OFFSET, true),
      materialElementId: view.getBigInt64(byteOffset + MATERIAL_OFFSET, true),
      polyMeshFlags: view.getInt32(byteOffset + FLAGS_OFFSET, true),
    },
  };
}
