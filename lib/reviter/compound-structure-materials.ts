/**
 * Browser-safe Revit 2027 BasicWallType compound-structure material reader.
 *
 * `Formats/Latest` identifies BasicWallType as tag 625, written in partition
 * object headers as `0x0270`, which is the class's own index. Its inherited HostObjAttr owns
 * `m_pCompoundStructure`; the nested CompoundStructure field `m_layers` is
 * selected by `ff ff ff ff ab 11`.
 *
 * Each counted layer is exactly 41 bytes, matching the embedded field graph:
 * f64 width, two u64 object ids, four i32 enum/index fields, and one boolean.
 */
import {
  scanFramedElementObjects,
  type ElementObject,
} from "./element-objects.ts";

export const REVIT_2027_BASIC_WALL_TYPE_MARKER = 0x0270;

const LAYERS_FIELD = [0xff, 0xff, 0xff, 0xff, 0xab, 0x11] as const;
const LAYERS_FIELD_BYTES = LAYERS_FIELD.length;
const LAYER_BYTES = 41;
const MAX_LAYERS = 64;
const MAX_LAYER_WIDTH_FEET = 100;

const ORDINARY_FUNCTIONS = new Set([0, 1, 2, 3, 4, 5]);
const MEMBRANE_FUNCTION = 100;
const MEMBRANE_PRIORITY = 999;

export type CompoundStructureLayerCandidate = {
  layerIndex: number;
  widthFeet: number;
  materialId: number | null;
  profileId: number | null;
  function: number;
  priority: number;
  embeddingType: number;
  layerId: number;
  capFlag: boolean;
};

export type CompoundStructureCandidate = {
  typeId: number;
  layers: CompoundStructureLayerCandidate[];
  recordOffset: number;
  objectLength: number;
  objectMarker: typeof REVIT_2027_BASIC_WALL_TYPE_MARKER;
  layersFieldOffset: number;
};

export type NativeCompoundStructureDefinition = CompoundStructureCandidate & {
  evidence: "framed-basic-wall-type-compound-layers";
};

export type NativeCompoundLayerMaterialAssignment = {
  elementId: number;
  typeId: number;
  layerIndex: number;
  materialId: number;
  widthFeet: number;
  function: number;
  evidence: "persisted-element-type-compound-layer-material";
};

type ObjectIdRead =
  | { valid: true; value: number | null }
  | { valid: false; value: null };

function matchesAt(
  data: Uint8Array,
  offset: number,
  pattern: readonly number[],
): boolean {
  if (offset < 0 || offset + pattern.length > data.byteLength) return false;
  for (let index = 0; index < pattern.length; index += 1) {
    if (data[offset + index] !== pattern[index]) return false;
  }
  return true;
}

function readObjectId(view: DataView, offset: number): ObjectIdRead {
  const low = view.getUint32(offset, true);
  const high = view.getUint32(offset + 4, true);
  if (low === 0xffff_ffff && high === 0xffff_ffff) {
    return { valid: true, value: null };
  }
  if (low > 0 && high === 0) return { valid: true, value: low };
  return { valid: false, value: null };
}

function readLayer(
  view: DataView,
  offset: number,
  layerIndex: number,
): CompoundStructureLayerCandidate | null {
  const widthFeet = view.getFloat64(offset, true);
  if (
    !Number.isFinite(widthFeet) ||
    widthFeet < 0 ||
    widthFeet > MAX_LAYER_WIDTH_FEET
  ) {
    return null;
  }
  const material = readObjectId(view, offset + 8);
  const profile = readObjectId(view, offset + 16);
  if (!material.valid || !profile.valid) return null;

  const layerFunction = view.getInt32(offset + 24, true);
  const priority = view.getInt32(offset + 28, true);
  const embeddingType = view.getInt32(offset + 32, true);
  const layerId = view.getInt32(offset + 36, true);
  const capFlag = view.getUint8(offset + 40);
  const ordinary =
    ORDINARY_FUNCTIONS.has(layerFunction) &&
    priority === layerFunction;
  const membrane =
    layerFunction === MEMBRANE_FUNCTION &&
    priority === MEMBRANE_PRIORITY &&
    widthFeet === 0;
  // The supplied file has one intentionally unassigned BasicWallType layer:
  // Structure(0), default priority 999, null material and null profile. Keep
  // this exact persisted state as a definition; it produces no assignment.
  const unassignedDefault =
    layerFunction === 0 &&
    priority === MEMBRANE_PRIORITY &&
    material.value == null &&
    profile.value == null;
  if (
    (!ordinary && !membrane && !unassignedDefault) ||
    embeddingType !== -1 ||
    layerId !== layerIndex ||
    capFlag > 1
  ) {
    return null;
  }
  return {
    layerIndex,
    widthFeet,
    materialId: material.value,
    profileId: profile.value,
    function: layerFunction,
    priority,
    embeddingType,
    layerId,
    capFlag: capFlag === 1,
  };
}

function readCandidate(
  data: Uint8Array,
  view: DataView,
  object: ElementObject,
): CompoundStructureCandidate | null {
  const objectEnd = object.offset + object.objectLength;
  const fields: number[] = [];
  for (
    let offset = object.offset;
    offset + LAYERS_FIELD_BYTES + 4 <= objectEnd;
    offset += 1
  ) {
    if (matchesAt(data, offset, LAYERS_FIELD)) fields.push(offset);
  }
  if (fields.length !== 1) return null;

  const field = fields[0]!;
  const count = view.getUint32(field + LAYERS_FIELD_BYTES, true);
  const layersOffset = field + LAYERS_FIELD_BYTES + 4;
  if (
    count < 1 ||
    count > MAX_LAYERS ||
    layersOffset + count * LAYER_BYTES > objectEnd
  ) {
    return null;
  }

  const layers: CompoundStructureLayerCandidate[] = [];
  for (let layerIndex = 0; layerIndex < count; layerIndex += 1) {
    const layer = readLayer(
      view,
      layersOffset + layerIndex * LAYER_BYTES,
      layerIndex,
    );
    if (!layer) return null;
    layers.push(layer);
  }
  return {
    typeId: object.elementId,
    layers,
    recordOffset: object.offset,
    objectLength: object.objectLength,
    objectMarker: REVIT_2027_BASIC_WALL_TYPE_MARKER,
    layersFieldOffset: field - object.offset,
  };
}

export function scanCompoundStructureCandidates(
  data: Uint8Array,
  revitVersion: number,
): CompoundStructureCandidate[] {
  if (revitVersion !== 2027) return [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const result: CompoundStructureCandidate[] = [];
  for (const object of scanFramedElementObjects(data)) {
    if (object.marker !== REVIT_2027_BASIC_WALL_TYPE_MARKER) continue;
    const candidate = readCandidate(data, view, object);
    if (candidate) result.push(candidate);
  }
  return result;
}

export function resolveCompoundStructureDefinitions(
  candidates: readonly CompoundStructureCandidate[],
  materialElementIds: ReadonlySet<number>,
): NativeCompoundStructureDefinition[] {
  const result = new Map<number, NativeCompoundStructureDefinition>();
  const conflicts = new Set<number>();
  for (const candidate of candidates) {
    if (
      candidate.layers.some(
        (layer) =>
          layer.materialId != null &&
          !materialElementIds.has(layer.materialId),
      )
    ) {
      continue;
    }
    const existing = result.get(candidate.typeId);
    if (existing) {
      const signature = (layers: readonly CompoundStructureLayerCandidate[]) =>
        JSON.stringify(layers);
      if (signature(existing.layers) !== signature(candidate.layers)) {
        result.delete(candidate.typeId);
        conflicts.add(candidate.typeId);
      }
      continue;
    }
    if (conflicts.has(candidate.typeId)) continue;
    result.set(candidate.typeId, {
      ...candidate,
      evidence: "framed-basic-wall-type-compound-layers",
    });
  }
  return [...result.values()].sort((left, right) => left.typeId - right.typeId);
}

export function resolveCompoundLayerMaterialAssignments(
  typeReferences: Iterable<{ elementId: number; typeId: number }>,
  definitions: readonly NativeCompoundStructureDefinition[],
): NativeCompoundLayerMaterialAssignment[] {
  const typeByElement = new Map<number, number | null>();
  for (const reference of typeReferences) {
    if (
      !Number.isSafeInteger(reference.elementId) ||
      reference.elementId <= 0 ||
      !Number.isSafeInteger(reference.typeId) ||
      reference.typeId <= 0
    ) {
      continue;
    }
    const previous = typeByElement.get(reference.elementId);
    if (previous === undefined) typeByElement.set(reference.elementId, reference.typeId);
    else if (previous !== reference.typeId) typeByElement.set(reference.elementId, null);
  }

  const definitionByType = new Map(
    definitions.map((definition) => [definition.typeId, definition]),
  );
  const result: NativeCompoundLayerMaterialAssignment[] = [];
  for (const [elementId, typeId] of typeByElement) {
    if (typeId == null) continue;
    const definition = definitionByType.get(typeId);
    if (!definition) continue;
    for (const layer of definition.layers) {
      if (layer.materialId == null) continue;
      result.push({
        elementId,
        typeId,
        layerIndex: layer.layerIndex,
        materialId: layer.materialId,
        widthFeet: layer.widthFeet,
        function: layer.function,
        evidence: "persisted-element-type-compound-layer-material",
      });
    }
  }
  return result.sort((left, right) =>
    left.elementId - right.elementId ||
    left.layerIndex - right.layerIndex ||
    left.materialId - right.materialId);
}
