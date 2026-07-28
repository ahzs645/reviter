/**
 * Browser-safe, release-gated persisted family and material relationships.
 *
 * These offsets are not inferred from nearby ids. They are fields inside
 * length/echo-framed Revit 2027 objects and were accepted only after the
 * embedded schema and the paired IFC independently agreed:
 *
 * - `FamilySymbol` (schema tag 2065, object marker `tag - 1 = 0x0810`)
 *   carries `m_familyId` at `+449`;
 * - the referenced `Family` has schema tag 2010 / object marker `0x07d9`;
 * - three shared-geometry layouts carry MaterialElem ids at the offsets below.
 *
 * The scanner returns candidates and target class ids separately. Resolution
 * is deliberately a second step so references can cross compressed chunks.
 */

export const REVIT_2027_FAMILY_MARKER = 0x07d9;
export const REVIT_2027_FAMILY_SYMBOL_MARKER = 0x0810;

const FAMILY_ID_OFFSET = 449;
const MIN_OBJECT_BYTES = 40;
const MAX_OBJECT_BYTES = 0xffff;

const MATERIAL_FIELDS = new Map<number, readonly number[]>([
  [0x08c6, [356, 418, 480, 542, 604, 666]],
  [0x10dc, [135]],
  [0x10de, [133]],
]);

export type FamilySymbolCandidate = {
  symbolId: number;
  familyId: number;
  recordOffset: number;
  objectLength: number;
  objectMarker: typeof REVIT_2027_FAMILY_SYMBOL_MARKER;
};

export type NativeFamilyDefinition = {
  familyId: number;
  name: string;
  /** The adjacent FamilyBase path field validated the name; its value is not exported. */
  pathKind: "directory";
  recordOffset: number;
  nameOffset: number;
  pathOffset: number;
  objectLength: number;
  objectMarker: typeof REVIT_2027_FAMILY_MARKER;
  evidence: "framed-family-name-path";
};

export type GeometryMaterialCandidate = {
  geometryId: number;
  materialId: number;
  recordOffset: number;
  fieldOffset: number;
  objectLength: number;
  objectMarker: number;
};

export type PersistedRelationshipScan = {
  familyElementIds: number[];
  familyDefinitions: NativeFamilyDefinition[];
  familySymbolCandidates: FamilySymbolCandidate[];
  geometryMaterialCandidates: GeometryMaterialCandidate[];
};

export type NativeFamilySymbolRelation = FamilySymbolCandidate & {
  evidence: "framed-family-symbol-family-id";
};

export type NativeGeometryMaterialAssignment = GeometryMaterialCandidate & {
  evidence: "framed-geometry-material-id";
};

function readId(view: DataView, offset: number, limit: number): number | null {
  if (offset < 0 || offset + 8 > limit || view.getUint32(offset + 4, true) !== 0) return null;
  const id = view.getUint32(offset, true);
  return id || null;
}

function readUtf16String(
  view: DataView,
  offset: number,
  limit: number,
): { value: string; endOffset: number } | null {
  if (offset < 0 || offset + 4 > limit) return null;
  const length = view.getUint32(offset, true);
  if (length < 1 || length > 512 || offset + 4 + length * 2 > limit) return null;
  let value = "";
  for (let index = 0; index < length; index += 1) {
    const code = view.getUint16(offset + 4 + index * 2, true);
    if (
      code === 0 ||
      code < 0x20 ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 0xffff
    ) {
      return null;
    }
    value += String.fromCharCode(code);
  }
  return { value, endOffset: offset + 4 + length * 2 };
}

/**
 * `FamilyBase` reads `m_name` and `m_path` as two consecutive `OdString`
 * fields. Earlier fields have variable-length collections, so their absolute
 * offset changes; the consecutive pair and the path shape are the stable
 * boundary. Fail closed for empty/in-memory paths instead of guessing a name.
 */
function readFamilyDefinition(
  view: DataView,
  objectOffset: number,
  objectLength: number,
  familyId: number,
): NativeFamilyDefinition | null {
  const limit = objectOffset + objectLength;
  const scanEnd = Math.min(limit, objectOffset + 1_024);
  for (let nameOffset = objectOffset + 18; nameOffset + 8 <= scanEnd; nameOffset += 1) {
    const name = readUtf16String(view, nameOffset, scanEnd);
    if (!name || name.value.length > 256 || /[\\/]/u.test(name.value)) continue;
    const path = readUtf16String(view, name.endOffset, scanEnd);
    if (
      !path ||
      !/[\\/]/u.test(path.value) ||
      !/[\\/]$/u.test(path.value)
    ) {
      continue;
    }
    return {
      familyId,
      name: name.value,
      pathKind: "directory",
      recordOffset: objectOffset,
      nameOffset: nameOffset - objectOffset,
      pathOffset: name.endOffset - objectOffset,
      objectLength,
      objectMarker: REVIT_2027_FAMILY_MARKER,
      evidence: "framed-family-name-path",
    };
  }
  return null;
}

export function scanPersistedRelationshipCandidates(
  data: Uint8Array,
  revitVersion: number,
): PersistedRelationshipScan {
  const familyElementIds: number[] = [];
  const familyDefinitions: NativeFamilyDefinition[] = [];
  const familySymbolCandidates: FamilySymbolCandidate[] = [];
  const geometryMaterialCandidates: GeometryMaterialCandidate[] = [];
  if (revitVersion !== 2027 || data.byteLength < 64) {
    return {
      familyElementIds,
      familyDefinitions,
      familySymbolCandidates,
      geometryMaterialCandidates,
    };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let offset = 0; offset + 24 <= data.byteLength; offset += 1) {
    if (view.getUint32(offset + 4, true) !== 0) continue;
    const elementId = view.getUint32(offset, true);
    if (!elementId) continue;
    const objectLength = view.getUint32(offset + 12, true);
    if (objectLength < MIN_OBJECT_BYTES || objectLength > MAX_OBJECT_BYTES) continue;
    const echo = offset + objectLength + 16;
    if (echo + 4 > data.byteLength || view.getUint32(echo, true) !== objectLength) continue;
    const marker = view.getUint16(offset + 16, true);
    if (marker === REVIT_2027_FAMILY_MARKER) {
      familyElementIds.push(elementId);
      const definition = readFamilyDefinition(
        view,
        offset,
        objectLength,
        elementId,
      );
      if (definition) familyDefinitions.push(definition);
    }

    if (marker === REVIT_2027_FAMILY_SYMBOL_MARKER) {
      const familyId = readId(view, offset + FAMILY_ID_OFFSET, offset + objectLength);
      if (familyId != null) {
        familySymbolCandidates.push({
          symbolId: elementId,
          familyId,
          recordOffset: offset,
          objectLength,
          objectMarker: REVIT_2027_FAMILY_SYMBOL_MARKER,
        });
      }
    }

    const fields = MATERIAL_FIELDS.get(marker);
    if (fields) {
      const seen = new Set<number>();
      for (const fieldOffset of fields) {
        const materialId = readId(view, offset + fieldOffset, offset + objectLength);
        if (materialId == null || seen.has(materialId)) continue;
        seen.add(materialId);
        geometryMaterialCandidates.push({
          geometryId: elementId,
          materialId,
          recordOffset: offset,
          fieldOffset,
          objectLength,
          objectMarker: marker,
        });
      }
    }
    offset += objectLength + 19;
  }
  return {
    familyElementIds,
    familyDefinitions,
    familySymbolCandidates,
    geometryMaterialCandidates,
  };
}

export function resolveFamilySymbolRelations(
  candidates: readonly FamilySymbolCandidate[],
  familyElementIds: ReadonlySet<number>,
  referencedSymbolIds: ReadonlySet<number>,
): NativeFamilySymbolRelation[] {
  const result = new Map<number, NativeFamilySymbolRelation>();
  for (const candidate of candidates) {
    if (
      !familyElementIds.has(candidate.familyId) ||
      !referencedSymbolIds.has(candidate.symbolId) ||
      result.has(candidate.symbolId)
    ) {
      continue;
    }
    result.set(candidate.symbolId, {
      ...candidate,
      evidence: "framed-family-symbol-family-id",
    });
  }
  return [...result.values()].sort((a, b) => a.symbolId - b.symbolId);
}

export function resolveGeometryMaterialAssignments(
  candidates: readonly GeometryMaterialCandidate[],
  materialElementIds: ReadonlySet<number>,
  referencedGeometryIds: ReadonlySet<number>,
): NativeGeometryMaterialAssignment[] {
  const result = new Map<string, NativeGeometryMaterialAssignment>();
  for (const candidate of candidates) {
    if (
      !materialElementIds.has(candidate.materialId) ||
      !referencedGeometryIds.has(candidate.geometryId)
    ) {
      continue;
    }
    const key = `${candidate.geometryId}:${candidate.materialId}`;
    if (result.has(key)) continue;
    result.set(key, {
      ...candidate,
      evidence: "framed-geometry-material-id",
    });
  }
  return [...result.values()].sort((a, b) =>
    a.geometryId - b.geometryId || a.materialId - b.materialId);
}
