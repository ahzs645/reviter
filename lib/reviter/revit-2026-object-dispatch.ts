import {
  SurrogateObjectPropertyRegistry,
  type RegistryResult,
} from "./dynamic-object-registry.ts";

export const REVIT_2026_GNODE_SOURCE_CLASS = 1399;
export const REVIT_2026_GINFO_SOURCE_CLASS = 1400;
export const REVIT_2026_GPOLYMESH_SOURCE_CLASS = 2237;
export const REVIT_2026_GPOLYMESH_TOPOLOGY_PROPERTY =
  "OdBmGPolyMesh.m_pFacetedTopology";

export type Revit2026GInfoStatic = {
  gStyleElementId: bigint;
  tag: number;
  controlCommand: number;
  flags: number;
};

export type Revit2026GPolyMeshStatic = {
  gInfo: Revit2026GInfoStatic;
  topologyPropertyToken: number;
  topologySourceClassSlot: number | null;
  topologyDescriptorEndOffset: number;
  interiorStyleElementId: bigint;
  materialElementId: bigint;
  polyMeshFlags: number;
};

export type Revit2026ObjectPtrInitDispatch = {
  selectorOffset: number | null;
  bodyOffset: number;
  endOffset: number;
  sourceClassSlot: number;
  objectIdentity: string;
  selectorReadFromStream: boolean;
  value: Revit2026GPolyMeshStatic;
};

export type Revit2026ObjectPtrInitOptions = {
  byteOffset: number;
  objectIdentity: string;
  parentIdentity: string | null;
  /**
   * Mirrors the native context-class branch. When supplied, no selector bytes
   * are consumed. Otherwise one signed little-endian int16 is read.
   */
  scopedSourceClassSlot?: number;
};

function fits(data: Uint8Array, offset: number, byteLength: number): boolean {
  return (
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(byteLength) &&
    offset >= 0 &&
    byteLength >= 0 &&
    offset <= data.byteLength - byteLength
  );
}

function validSourceClassSlot(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= 0x7fff;
}

/**
 * Exact static field order of the Revit 2026 slot-2237 direct reader.
 * The topology object itself is queued; this reads only its descriptor and
 * the fields that remain inline in the GPolyMesh record.
 */
export function decodeRevit2026GPolyMeshStatic(
  data: Uint8Array,
  bodyOffset: number,
): RegistryResult<{ value: Revit2026GPolyMeshStatic; endOffset: number }> {
  if (!fits(data, bodyOffset, 24)) {
    return { ok: false, error: "Revit 2026 GPolyMesh static prefix is truncated" };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const gInfo: Revit2026GInfoStatic = {
    gStyleElementId: view.getBigUint64(bodyOffset, true),
    tag: view.getInt32(bodyOffset + 8, true),
    controlCommand: view.getInt32(bodyOffset + 12, true),
    flags: view.getUint32(bodyOffset + 16, true),
  };
  const topologyPropertyToken = view.getInt32(bodyOffset + 20, true);
  let offset = bodyOffset + 24;
  let topologySourceClassSlot: number | null = null;
  if (topologyPropertyToken !== 0) {
    if (!fits(data, offset, 2)) {
      return { ok: false, error: "GPolyMesh topology source-class slot is truncated" };
    }
    topologySourceClassSlot = view.getInt16(offset, true);
    if (!validSourceClassSlot(topologySourceClassSlot)) {
      return { ok: false, error: "GPolyMesh topology source-class slot is invalid" };
    }
    offset += 2;
  }
  const topologyDescriptorEndOffset = offset;
  if (!fits(data, offset, 20)) {
    return { ok: false, error: "Revit 2026 GPolyMesh inline tail is truncated" };
  }
  const value: Revit2026GPolyMeshStatic = {
    gInfo,
    topologyPropertyToken,
    topologySourceClassSlot,
    topologyDescriptorEndOffset,
    interiorStyleElementId: view.getBigUint64(offset, true),
    materialElementId: view.getBigUint64(offset + 8, true),
    polyMeshFlags: view.getInt32(offset + 16, true),
  };
  return { ok: true, value: { value, endOffset: offset + 20 } };
}

/**
 * Reproduce the proven class-selection subset of
 * `OdBmObjectPtrInitReader::read` for Revit 2026.
 *
 * Only slot 2237 has a registered static reader. Unknown or unimplemented
 * slots fail closed instead of falling back to a generic/schema guess.
 */
export function dispatchRevit2026ObjectPtrInit(
  data: Uint8Array,
  registry: SurrogateObjectPropertyRegistry,
  options: Revit2026ObjectPtrInitOptions,
): RegistryResult<Revit2026ObjectPtrInitDispatch> {
  let sourceClassSlot = options.scopedSourceClassSlot;
  let bodyOffset = options.byteOffset;
  let selectorOffset: number | null = null;
  if (sourceClassSlot == null) {
    if (!fits(data, bodyOffset, 2)) {
      return { ok: false, error: "ObjectPtrInitReader source-class selector is truncated" };
    }
    selectorOffset = bodyOffset;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    sourceClassSlot = view.getInt16(bodyOffset, true);
    bodyOffset += 2;
  }
  if (!validSourceClassSlot(sourceClassSlot)) {
    return { ok: false, error: "ObjectPtrInitReader source-class slot is invalid" };
  }
  if (sourceClassSlot !== REVIT_2026_GPOLYMESH_SOURCE_CLASS) {
    return {
      ok: false,
      error: `Revit 2026 source-class slot ${sourceClassSlot} has no proven browser static reader`,
    };
  }

  const decoded = decodeRevit2026GPolyMeshStatic(data, bodyOffset);
  if (!decoded.ok) return decoded;
  const classProperty = registry.ensureClassProperty({
    identity: REVIT_2026_GPOLYMESH_TOPOLOGY_PROPERTY,
    declaringSourceClassSlot: REVIT_2026_GPOLYMESH_SOURCE_CLASS,
    name: "m_pFacetedTopology",
  });
  if (!classProperty.ok) return classProperty;
  const registered = registry.registerObject({
    identity: options.objectIdentity,
    sourceClassSlot,
    parentIdentity: options.parentIdentity,
  });
  if (!registered.ok) return registered;

  const staticValue = decoded.value.value;
  if (
    staticValue.topologyPropertyToken !== 0 &&
    staticValue.topologySourceClassSlot != null
  ) {
    const queued = registry.enqueueDynamicProperty({
      dataKey: {
        objectIdentity: options.objectIdentity,
        classPropertyIdentity: REVIT_2026_GPOLYMESH_TOPOLOGY_PROPERTY,
        sequenceIndex: -1,
      },
      propertyToken: staticValue.topologyPropertyToken,
      propertySourceClassSlot: staticValue.topologySourceClassSlot,
      descriptorOffset: bodyOffset + 20,
      descriptorEndOffset: staticValue.topologyDescriptorEndOffset,
    });
    if (!queued.ok) return queued;
  }

  return {
    ok: true,
    value: {
      selectorOffset,
      bodyOffset,
      endOffset: decoded.value.endOffset,
      sourceClassSlot,
      objectIdentity: options.objectIdentity,
      selectorReadFromStream: selectorOffset != null,
      value: staticValue,
    },
  };
}
