/**
 * Browser-safe Revit 2027 FamilySymbol geometry-tag material map reader.
 *
 * The embedded schema declares:
 *
 *   FamilySymbol.m_geomTag2MaterialId
 *     std::map<int, MaterialElemId>
 *
 * The persisted map is `[u32 count][count * (i32 geometryTag, u64 id)]`.
 * Discovery retains compact object-id references from framed FamilySymbol
 * bodies. Resolution happens after all framed MaterialElem ids are known, so
 * cross-chunk references never need an ordering assumption.
 *
 * **Where ids are 32-bit** (Revit 2019 to 2023; `element-id-width.ts`) an
 * entry is `(i32 geometryTag, i32 id)`, eight bytes. Every one of the 97 maps
 * the 2025 RAC sample resolves is in the 2023 copy's frame of the same symbol
 * with the same entries. Only entries of a whole map-shaped run are retained,
 * since a four-byte id alone is not specific.
 */
import { narrowElementIds } from "./element-id-width.ts";
import { scanFramedElementObjects } from "./element-objects.ts";
import {
  readInstancePlacement,
  type InstancePlacement,
} from "./instanced-geometry.ts";
import { readsElementRecordLayout } from "./revit-class-tags.ts";

export const REVIT_2027_FAMILY_SYMBOL_MATERIAL_MARKER = 0x0810;

const MAX_MAP_ENTRIES = 512;
const MAP_ENTRY_BYTES = 12;
const NARROW_MAP_ENTRY_BYTES = 8;
/** `ElementId` -1, a map entry with no material. */
const NULL_NARROW_ID = 0xffff_ffff;

function mapEntryBytes(): number {
  return narrowElementIds() ? NARROW_MAP_ENTRY_BYTES : MAP_ENTRY_BYTES;
}
const MAX_GEOMETRY_TAG = 0x7fff_ffff;
const MAX_ELEMENT_ID = 0x7fff_ffff;

export type FamilySymbolMaterialReferenceSet = {
  symbolId: number;
  recordOffset: number;
  objectLength: number;
  objectMarker: typeof REVIT_2027_FAMILY_SYMBOL_MATERIAL_MARKER;
  /**
   * `[objectId, relativeIdOffset, geometryTagAsU32, precedingU32, ...]`.
   *
   * The preceding word is the map count only for a map's first entry. Keeping
   * it here lets the resolver prove a whole stride-aligned map without
   * retaining the complete FamilySymbol body.
   */
  referenceQuads: Uint32Array;
};

export type FamilySymbolMaterialPageScan = {
  referenceSets: FamilySymbolMaterialReferenceSet[];
  placements: InstancePlacement[];
};

export type FamilySymbolGeometryTagMaterial = {
  geometryTag: number;
  materialId: number;
};

export type NativeFamilySymbolMaterialMap = {
  symbolId: number;
  entries: FamilySymbolGeometryTagMaterial[];
  recordOffset: number;
  mapOffset: number;
  objectLength: number;
  objectMarker: typeof REVIT_2027_FAMILY_SYMBOL_MATERIAL_MARKER;
  evidence: "framed-family-symbol-geometry-tag-material-map";
};

export type NativeFamilySymbolMaterialAssignment = {
  elementId: number;
  symbolId: number;
  materialId: number;
  geometryTags: number[];
  evidence: "persisted-instance-family-symbol-geometry-tag-material";
};

/**
 * Narrow maps: `[u32 count][count x (i32 tag, i32 id)]` runs whose tags are
 * distinct and non-negative and whose ids are positive, as quads of the same
 * shape the wide scan keeps.
 */
function scanNarrowReferenceQuads(
  view: DataView,
  object: ReturnType<typeof scanFramedElementObjects>[number],
): number[] {
  const limit = object.offset + object.objectLength;
  const quads: number[] = [];
  const kept = new Set<number>();
  for (let mapOffset = object.offset + 14; mapOffset + 4 + NARROW_MAP_ENTRY_BYTES <= limit; mapOffset += 1) {
    const count = view.getUint32(mapOffset, true);
    if (count < 1 || count > MAX_MAP_ENTRIES) continue;
    if (mapOffset + 4 + count * NARROW_MAP_ENTRY_BYTES > limit) continue;
    const tags = new Set<number>();
    let valid = true;
    for (let index = 0; index < count && valid; index += 1) {
      const entry = mapOffset + 4 + index * NARROW_MAP_ENTRY_BYTES;
      const geometryTag = view.getInt32(entry, true);
      const objectId = view.getUint32(entry + 4, true);
      valid = geometryTag >= 0 && !tags.has(geometryTag) &&
        ((objectId >= 1 && objectId <= MAX_ELEMENT_ID) || objectId === NULL_NARROW_ID);
      tags.add(geometryTag);
    }
    if (!valid) continue;
    for (let index = 0; index < count; index += 1) {
      const idOffset = mapOffset + 8 + index * NARROW_MAP_ENTRY_BYTES;
      if (kept.has(idOffset)) continue;
      kept.add(idOffset);
      quads.push(
        view.getUint32(idOffset, true),
        idOffset - object.offset,
        view.getUint32(idOffset - 4, true),
        view.getUint32(idOffset - 8, true),
      );
    }
  }
  return quads;
}

function scanReferenceSet(
  data: Uint8Array,
  object: ReturnType<typeof scanFramedElementObjects>[number],
): FamilySymbolMaterialReferenceSet {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const limit = object.offset + object.objectLength;
  if (narrowElementIds()) {
    return {
      symbolId: object.elementId,
      recordOffset: object.offset,
      objectLength: object.objectLength,
      objectMarker: REVIT_2027_FAMILY_SYMBOL_MATERIAL_MARKER,
      referenceQuads: Uint32Array.from(scanNarrowReferenceQuads(view, object)),
    };
  }
  const quads: number[] = [];
  for (
    let idOffset = object.offset + 26;
    idOffset + 8 <= limit;
    idOffset += 1
  ) {
    const objectId = view.getUint32(idOffset, true);
    const high = view.getUint32(idOffset + 4, true);
    if (objectId < 1 || objectId > MAX_ELEMENT_ID || high !== 0) continue;
    const geometryTag = view.getInt32(idOffset - 4, true);
    if (geometryTag < 0 || geometryTag > MAX_GEOMETRY_TAG) continue;
    quads.push(
      objectId,
      idOffset - object.offset,
      geometryTag >>> 0,
      view.getUint32(idOffset - 8, true),
    );
  }
  return {
    symbolId: object.elementId,
    recordOffset: object.offset,
    objectLength: object.objectLength,
    objectMarker: REVIT_2027_FAMILY_SYMBOL_MATERIAL_MARKER,
    referenceQuads: Uint32Array.from(quads),
  };
}

export function scanFamilySymbolMaterialPage(
  data: Uint8Array,
  revitVersion: number,
): FamilySymbolMaterialPageScan {
  const result: FamilySymbolMaterialPageScan = {
    referenceSets: [],
    placements: [],
  };
  if (!readsElementRecordLayout(revitVersion)) return result;
  for (const object of scanFramedElementObjects(data)) {
    if (object.marker === REVIT_2027_FAMILY_SYMBOL_MATERIAL_MARKER) {
      result.referenceSets.push(scanReferenceSet(data, object));
    }
    const placement = readInstancePlacement(data, object);
    if (placement) result.placements.push(placement);
  }
  return result;
}

export function scanFamilySymbolMaterialReferenceSets(
  data: Uint8Array,
  revitVersion: number,
): FamilySymbolMaterialReferenceSet[] {
  return scanFamilySymbolMaterialPage(data, revitVersion).referenceSets;
}

function candidateMaps(
  referenceSet: FamilySymbolMaterialReferenceSet,
  materialElementIds: ReadonlySet<number>,
): Array<{ mapOffset: number; entries: FamilySymbolGeometryTagMaterial[] }> {
  if (referenceSet.referenceQuads.length % 4 !== 0) return [];
  const resolvedByOffset = new Map<
    number,
    FamilySymbolGeometryTagMaterial
  >();
  for (
    let index = 0;
    index < referenceSet.referenceQuads.length;
    index += 4
  ) {
    const materialId = referenceSet.referenceQuads[index]!;
    if (!materialElementIds.has(materialId)) continue;
    const idOffset = referenceSet.referenceQuads[index + 1]!;
    resolvedByOffset.set(idOffset, {
      geometryTag: referenceSet.referenceQuads[index + 2]!,
      materialId,
    });
  }

  const result: Array<{
    mapOffset: number;
    entries: FamilySymbolGeometryTagMaterial[];
  }> = [];
  const signatures = new Set<string>();
  const entryBytes = mapEntryBytes();
  for (
    let index = 0;
    index < referenceSet.referenceQuads.length;
    index += 4
  ) {
    const firstIdOffset = referenceSet.referenceQuads[index + 1]!;
    const count = referenceSet.referenceQuads[index + 3]!;
    const mapOffset = firstIdOffset - 8;
    if (
      count < 1 ||
      count > MAX_MAP_ENTRIES ||
      mapOffset < 14 ||
      mapOffset + 4 + count * entryBytes > referenceSet.objectLength
    ) {
      continue;
    }
    const entries: FamilySymbolGeometryTagMaterial[] = [];
    const geometryTags = new Set<number>();
    let valid = true;
    for (let entryIndex = 0; entryIndex < count; entryIndex += 1) {
      const idOffset = mapOffset + 8 + entryIndex * entryBytes;
      const entry = resolvedByOffset.get(idOffset);
      if (!entry || geometryTags.has(entry.geometryTag)) {
        valid = false;
        break;
      }
      geometryTags.add(entry.geometryTag);
      entries.push(entry);
    }
    if (!valid) continue;
    const signature = JSON.stringify(entries);
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    result.push({ mapOffset, entries });
  }
  return result;
}

/**
 * The map of a narrow symbol: the first map-shaped run whose first id is a
 * MaterialElem, accepted only when every one of its ids is. A four-byte id
 * is less specific than an eight-byte one, and later in a symbol a table of
 * 16-byte records reads as one-entry maps of Revit's own low-numbered
 * materials (`Default`, `Default Wall`): on the 2023 RAC sample taking the
 * first run gives the 2025 copy's map for all 97 symbols it resolves, and a
 * map with an empty entry fails closed as it does there.
 */
function narrowCandidateMap(
  referenceSet: FamilySymbolMaterialReferenceSet,
  materialElementIds: ReadonlySet<number>,
): Array<{ mapOffset: number; entries: FamilySymbolGeometryTagMaterial[] }> {
  const quads = referenceSet.referenceQuads;
  if (quads.length % 4 !== 0) return [];
  const entryAt = new Map<number, FamilySymbolGeometryTagMaterial>();
  for (let index = 0; index < quads.length; index += 4) {
    entryAt.set(quads[index + 1]!, { geometryTag: quads[index + 2]!, materialId: quads[index]! });
  }
  let first: { mapOffset: number; entries: FamilySymbolGeometryTagMaterial[]; complete: boolean } | null = null;
  for (let index = 0; index < quads.length; index += 4) {
    const mapOffset = quads[index + 1]! - 8;
    const count = quads[index + 3]!;
    if (count < 1 || count > MAX_MAP_ENTRIES || (first && first.mapOffset <= mapOffset)) continue;
    const entries: FamilySymbolGeometryTagMaterial[] = [];
    for (let entryIndex = 0; entryIndex < count; entryIndex += 1) {
      const entry = entryAt.get(mapOffset + 8 + entryIndex * NARROW_MAP_ENTRY_BYTES);
      if (!entry) break;
      entries.push(entry);
    }
    if (entries.length !== count || !materialElementIds.has(entries[0]!.materialId)) continue;
    first = {
      mapOffset,
      entries,
      complete: entries.every((entry) => materialElementIds.has(entry.materialId)),
    };
  }
  return first?.complete ? [{ mapOffset: first.mapOffset, entries: first.entries }] : [];
}

/**
 * Resolve exactly one schema-shaped material map per FamilySymbol.
 *
 * A map is rejected unless every non-null target resolves to an independently
 * framed MaterialElem. More than one distinct map in the same bounded symbol,
 * or disagreeing duplicate symbol frames, fails closed.
 */
export function resolveFamilySymbolMaterialMaps(
  referenceSets: readonly FamilySymbolMaterialReferenceSet[],
  materialElementIds: ReadonlySet<number>,
): NativeFamilySymbolMaterialMap[] {
  const result = new Map<number, NativeFamilySymbolMaterialMap>();
  const conflicts = new Set<number>();
  const narrow = narrowElementIds();
  for (const referenceSet of referenceSets) {
    const candidates = narrow
      ? narrowCandidateMap(referenceSet, materialElementIds)
      : candidateMaps(referenceSet, materialElementIds);
    if (candidates.length > 1) {
      result.delete(referenceSet.symbolId);
      conflicts.add(referenceSet.symbolId);
      continue;
    }
    if (candidates.length !== 1 || conflicts.has(referenceSet.symbolId)) {
      continue;
    }
    const candidate = candidates[0]!;
    const resolved: NativeFamilySymbolMaterialMap = {
      symbolId: referenceSet.symbolId,
      entries: candidate.entries,
      recordOffset: referenceSet.recordOffset,
      mapOffset: candidate.mapOffset,
      objectLength: referenceSet.objectLength,
      objectMarker: referenceSet.objectMarker,
      evidence: "framed-family-symbol-geometry-tag-material-map",
    };
    const previous = result.get(referenceSet.symbolId);
    if (
      previous &&
      JSON.stringify(previous.entries) !== JSON.stringify(resolved.entries)
    ) {
      result.delete(referenceSet.symbolId);
      conflicts.add(referenceSet.symbolId);
      continue;
    }
    if (!previous) result.set(referenceSet.symbolId, resolved);
  }
  return [...result.values()].sort((left, right) => left.symbolId - right.symbolId);
}

export function resolveFamilySymbolMaterialAssignments(
  placements: Iterable<{
    elementId: number;
    symbolId?: number;
    geometryId: number;
  }>,
  maps: readonly NativeFamilySymbolMaterialMap[],
): NativeFamilySymbolMaterialAssignment[] {
  const symbolByElement = new Map<number, number | null>();
  for (const placement of placements) {
    const symbolId = placement.symbolId ?? placement.geometryId;
    if (
      !Number.isSafeInteger(placement.elementId) ||
      placement.elementId <= 0 ||
      !Number.isSafeInteger(symbolId) ||
      symbolId <= 0
    ) {
      continue;
    }
    const previous = symbolByElement.get(placement.elementId);
    if (previous === undefined) symbolByElement.set(placement.elementId, symbolId);
    else if (previous !== symbolId) symbolByElement.set(placement.elementId, null);
  }

  const mapBySymbol = new Map(maps.map((map) => [map.symbolId, map]));
  const result: NativeFamilySymbolMaterialAssignment[] = [];
  for (const [elementId, symbolId] of symbolByElement) {
    if (symbolId == null) continue;
    const map = mapBySymbol.get(symbolId);
    if (!map) continue;
    const geometryTagsByMaterial = new Map<number, number[]>();
    for (const entry of map.entries) {
      const tags = geometryTagsByMaterial.get(entry.materialId);
      if (tags) tags.push(entry.geometryTag);
      else geometryTagsByMaterial.set(entry.materialId, [entry.geometryTag]);
    }
    for (const [materialId, geometryTags] of geometryTagsByMaterial) {
      result.push({
        elementId,
        symbolId,
        materialId,
        geometryTags: geometryTags.sort((left, right) => left - right),
        evidence: "persisted-instance-family-symbol-geometry-tag-material",
      });
    }
  }
  return result.sort((left, right) =>
    left.elementId - right.elementId ||
    left.materialId - right.materialId ||
    left.symbolId - right.symbolId);
}
