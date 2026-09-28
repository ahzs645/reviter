import {
  decodeCondInt16PropertyDescriptor,
  type CondInt16QueueEntry,
} from "./dynamic-geometry-queue.ts";
import { readRevit2027GInfo, type Revit2027GInfo } from "./revit-2027-grep-prefixes.ts";
import { narrowElementIds } from "./element-id-width.ts";
import { fileClassFieldCount, usesRevit2027RecordLayout } from "./revit-class-tags.ts";

/** Exact Revit 2027 source-class slot for `GPolyMesh`. */
export const REVIT_2027_GPOLYMESH_SOURCE_CLASS_SLOT = 2277;
export const REVIT_2027_GPOLYMESH_BODY_BYTES = 46;

const GINFO_BYTES = 20;
const TOPOLOGY_OFFSET = GINFO_BYTES;
const INTERIOR_STYLE_OFFSET = TOPOLOGY_OFFSET + 6;
const MATERIAL_OFFSET = INTERIOR_STYLE_OFFSET + 8;
const FLAGS_OFFSET = MATERIAL_OFFSET + 8;

/**
 * The same body where ids are 32-bit, in the older field order: a 16-byte
 * `GInfo`, the topology descriptor, then `m_polyMeshFlags` before the two
 * ids (2024 moved the ids first), 34 bytes. The 2019 to 2022 schemas declare
 * version 8, with a fifth field, `m_allowSolidFillPatternOverride`, a
 * trailing boolean: 35 bytes.
 */
const NARROW_GINFO_BYTES = 16;
const NARROW_FLAGS_OFFSET = NARROW_GINFO_BYTES + 6;
const NARROW_INTERIOR_STYLE_OFFSET = NARROW_FLAGS_OFFSET + 4;
const NARROW_MATERIAL_OFFSET = NARROW_INTERIOR_STYLE_OFFSET + 4;
const NARROW_BODY_BYTES = NARROW_MATERIAL_OFFSET + 4;

function withFillPatternOverride(): boolean {
  return fileClassFieldCount(REVIT_2027_GPOLYMESH_SOURCE_CLASS_SLOT) === 5;
}

/** Bytes of a `GPolyMesh` body in the current file. */
export function revit2027GPolyMeshBodyBytes(): number {
  if (!narrowElementIds()) return REVIT_2027_GPOLYMESH_BODY_BYTES;
  return NARROW_BODY_BYTES + (withFillPatternOverride() ? 1 : 0);
}

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
  if (narrowElementIds()) return decodeNarrowGPolyMesh(data, byteOffset, enclosingEndOffset);
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

function decodeNarrowGPolyMesh(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
): Revit2027GPolyMeshDecodeResult {
  const byteLength = revit2027GPolyMeshBodyBytes();
  if (
    !Number.isSafeInteger(byteOffset) ||
    byteOffset < 0 ||
    !Number.isSafeInteger(enclosingEndOffset) ||
    enclosingEndOffset > data.byteLength ||
    byteOffset > enclosingEndOffset - byteLength
  ) {
    return { ok: false, error: "Revit 2027 GPolyMesh body is truncated or outside its owner" };
  }
  const topology = decodeCondInt16PropertyDescriptor(data, byteOffset + NARROW_GINFO_BYTES);
  if (!topology.ok) return topology;
  if (
    topology.descriptor.endOffset !== byteOffset + NARROW_FLAGS_OFFSET ||
    topology.descriptor.token === 0
  ) {
    return {
      ok: false,
      error: "Revit 2027 GPolyMesh has no queued faceted topology",
    };
  }
  if (withFillPatternOverride()) {
    const override = data[byteOffset + NARROW_BODY_BYTES];
    if (override !== 0 && override !== 1) {
      return { ok: false, error: "Revit 2027 GPolyMesh fill-pattern override is not boolean" };
    }
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: byteOffset + byteLength,
      gInfo: readRevit2027GInfo(view, byteOffset),
      topology: topology.descriptor,
      interiorGStyleElementId: BigInt(view.getInt32(byteOffset + NARROW_INTERIOR_STYLE_OFFSET, true)),
      materialElementId: BigInt(view.getInt32(byteOffset + NARROW_MATERIAL_OFFSET, true)),
      polyMeshFlags: view.getInt32(byteOffset + NARROW_FLAGS_OFFSET, true),
    },
  };
}
