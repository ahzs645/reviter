/**
 * Persisted Revit 2027 element-to-level relationships.
 *
 * The embedded schema names `Element.m_assocLevelId`, while the native reader
 * exposes `OdBmElement::getAssocLevelId()`. Revit's versioned base-object
 * layouts place that 64-bit element id at one of five aligned-by-schema
 * positions. The target is accepted only when a separately framed object
 * carries the 2027 Level marker.
 *
 * This is a two-pass decoder because a source and its Level target can live in
 * different compressed chunks. It does not consult IFC, names, elevations, or
 * geometric proximity.
 */

/** Revit 2027 framed-object marker for `Level` elements. */
export const REVIT_2027_LEVEL_MARKER = 0x0a19;

const ASSOCIATED_LEVEL_ID_OFFSETS = [64, 66, 68, 70, 72] as const;
const MIN_OBJECT_BYTES = 40;
const MAX_OBJECT_BYTES = 0xffff;

export type AssociatedLevelFieldOffset =
  typeof ASSOCIATED_LEVEL_ID_OFFSETS[number];

export type AssociatedLevelRelationCandidate = {
  elementId: number;
  levelId: number;
  fieldOffset: AssociatedLevelFieldOffset;
  recordOffset: number;
  objectLength: number;
  objectMarker: number;
};

export type NativeAssociatedLevelRelation =
  AssociatedLevelRelationCandidate & {
    kind: "associated-level";
    source: "Partitions/Element.m_assocLevelId";
    evidence: "persisted";
  };

function readId(view: DataView, offset: number, limit: number): number | null {
  if (offset < 0 || offset + 8 > limit || view.getUint32(offset + 4, true) !== 0) {
    return null;
  }
  const id = view.getUint32(offset, true);
  return id || null;
}

/** Scan one inflated partition chunk for framed associated-level candidates. */
export function scanAssociatedLevelRelationCandidates(
  data: Uint8Array,
  revitVersion: number,
): AssociatedLevelRelationCandidate[] {
  const candidates: AssociatedLevelRelationCandidate[] = [];
  if (revitVersion !== 2027 || data.byteLength < 64) return candidates;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  for (let offset = 0; offset + 24 <= data.byteLength; offset += 1) {
    if (view.getUint32(offset + 4, true) !== 0) continue;
    const elementId = view.getUint32(offset, true);
    if (!elementId) continue;
    const objectLength = view.getUint32(offset + 12, true);
    if (objectLength < MIN_OBJECT_BYTES || objectLength > MAX_OBJECT_BYTES) continue;
    const echo = offset + objectLength + 16;
    if (echo + 4 > data.byteLength || view.getUint32(echo, true) !== objectLength) {
      continue;
    }
    const limit = offset + objectLength;
    const objectMarker = view.getUint16(offset + 16, true);
    for (const fieldOffset of ASSOCIATED_LEVEL_ID_OFFSETS) {
      const levelId = readId(view, offset + fieldOffset, limit);
      if (levelId == null || levelId === elementId) continue;
      candidates.push({
        elementId,
        levelId,
        fieldOffset,
        recordOffset: offset,
        objectLength,
        objectMarker,
      });
    }
    offset += objectLength + 19;
  }
  return candidates;
}

/**
 * Resolve candidate ids against the complete framed-object class inventory.
 *
 * A source is emitted only when every resolving candidate names the same Level
 * element. Conflicting targets fail closed. Repeated copies collapse to one
 * persisted edge.
 */
export function resolveAssociatedLevelRelations(
  candidates: readonly AssociatedLevelRelationCandidate[],
  markerByElement: ReadonlyMap<number, number>,
): NativeAssociatedLevelRelation[] {
  const targetsBySource = new Map<number, Set<number>>();
  const candidateByRelation = new Map<string, AssociatedLevelRelationCandidate>();

  for (const candidate of candidates) {
    if (markerByElement.get(candidate.levelId) !== REVIT_2027_LEVEL_MARKER) continue;
    const targets = targetsBySource.get(candidate.elementId) ?? new Set<number>();
    targets.add(candidate.levelId);
    targetsBySource.set(candidate.elementId, targets);
    const key = `${candidate.elementId}:${candidate.levelId}`;
    const previous = candidateByRelation.get(key);
    if (!previous || candidate.fieldOffset < previous.fieldOffset) {
      candidateByRelation.set(key, candidate);
    }
  }

  const result: NativeAssociatedLevelRelation[] = [];
  for (const [elementId, targets] of targetsBySource) {
    if (targets.size !== 1) continue;
    const levelId = [...targets][0]!;
    const source = candidateByRelation.get(`${elementId}:${levelId}`);
    if (!source) continue;
    result.push({
      ...source,
      kind: "associated-level",
      source: "Partitions/Element.m_assocLevelId",
      evidence: "persisted",
    });
  }
  return result.sort((a, b) => a.elementId - b.elementId);
}
