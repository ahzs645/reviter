/**
 * Persisted Revit 2027 element-to-level relationships.
 *
 * The embedded schema names `Element.m_assocLevelId`, and it says where the
 * field is. `Element` declares seven pointers before it, each written as an
 * `i32` handle plus a `u16` class when the handle is non-zero, one counted
 * collection, a four-byte document stub and the eight-byte `m_id` — so the
 * field's position is a sum the record itself determines, not a constant.
 *
 * It used to be read by trying five offsets, 64 through 72 in steps of two, and
 * keeping whatever named a Level. That window was fitted to what the supplied
 * project happened to contain and it is short at the bottom: 28,846 of its
 * 112,917 element objects, one in four, carry the field at 62. All of them are
 * null there, so the guess loses nothing on this model and would lose an edge
 * on the first file where an element with three fewer live pointers sits on a
 * storey. It also read four wrong positions for every right one — 91,451
 * candidates for 37,503 relations — and each wrong read is an id that might
 * name a Level by accident.
 *
 * The target is still accepted only when a separately framed object carries the
 * 2027 Level marker.
 *
 * This is a two-pass decoder because a source and its Level target can live in
 * different compressed chunks. It does not consult IFC, names, elevations, or
 * geometric proximity.
 *
 * **Where ids are 32-bit** (Revit 2023 and older; `element-id-width.ts`) the
 * 2023 schema declares `Element`'s fields in the same order, so the walk is the
 * same with the body starting after a 12-byte frame header and `m_id` and
 * `m_assocLevelId` four bytes each.
 */
import { narrowElementIds } from "./element-id-width.ts";
import { scanFramedElementObjects } from "./element-objects.ts";
import {
  canonicalClassTag,
  readsElementRecordLayout,
  usesRevit2027RecordLayout,
} from "./revit-class-tags.ts";

/** Revit 2027 framed-object marker for `Level` elements. */
export const REVIT_2027_LEVEL_MARKER = 0x0a19;

const MIN_OBJECT_BYTES = 40;
const MAX_OBJECT_BYTES = 0xffff;

/** `Element`'s pointers before `m_constrInfo`: four value sets and two geometry. */
const LEADING_POINTERS = 6;

/** Bytes an object's fields start after its frame header. */
const OBJECT_BODY_OFFSET = 18;

/**
 * `m_docAccess.m_pDoc` and `m_id`, which sit between `m_cellList` and the
 * target. The document stub is a plain handle with no class behind it.
 */
const DOC_STUB_AND_ID_BYTES = 4 + 8;

/**
 * Where the field can land: every pointer null, or every pointer live with an
 * empty collection. Anything outside is a walk that lost its place.
 */
const MIN_FIELD_OFFSET = OBJECT_BODY_OFFSET + (LEADING_POINTERS + 1) * 4 + 4 + DOC_STUB_AND_ID_BYTES;
const MAX_FIELD_OFFSET = OBJECT_BODY_OFFSET + (LEADING_POINTERS + 1) * 6 + 4 + DOC_STUB_AND_ID_BYTES;

/** The same bounds and body offset where ids are 32-bit. */
const NARROW_OBJECT_BODY_OFFSET = 14;
const NARROW_DOC_STUB_AND_ID_BYTES = 4 + 4;
const NARROW_MIN_FIELD_OFFSET =
  NARROW_OBJECT_BODY_OFFSET + (LEADING_POINTERS + 1) * 4 + 4 + NARROW_DOC_STUB_AND_ID_BYTES;
const NARROW_MAX_FIELD_OFFSET =
  NARROW_OBJECT_BODY_OFFSET + (LEADING_POINTERS + 1) * 6 + 4 + NARROW_DOC_STUB_AND_ID_BYTES;

/**
 * Offset of `m_assocLevelId` within one framed object, or `null` when the walk
 * runs past the object.
 */
export function associatedLevelFieldOffset(
  view: DataView,
  start: number,
  limit: number,
  narrow = false,
): number | null {
  let cursor = start + (narrow ? NARROW_OBJECT_BODY_OFFSET : OBJECT_BODY_OFFSET);
  const step = () => {
    if (cursor + 4 > limit) return false;
    cursor += view.getInt32(cursor, true) === 0 ? 4 : 6;
    return true;
  };
  for (let field = 0; field < LEADING_POINTERS; field += 1) if (!step()) return null;
  if (cursor + 4 > limit) return null;
  const constraints = view.getUint32(cursor, true);
  cursor += 4;
  // Zero on all but three objects in the supplied project, and unbounded in
  // principle, so a count that cannot fit is a desync rather than a long list.
  if (constraints > (limit - cursor) / 4) return null;
  for (let index = 0; index < constraints; index += 1) if (!step()) return null;
  if (!step()) return null;
  cursor += narrow ? NARROW_DOC_STUB_AND_ID_BYTES : DOC_STUB_AND_ID_BYTES;
  const fieldOffset = cursor - start;
  const [min, max] = narrow
    ? [NARROW_MIN_FIELD_OFFSET, NARROW_MAX_FIELD_OFFSET]
    : [MIN_FIELD_OFFSET, MAX_FIELD_OFFSET];
  if (fieldOffset < min || fieldOffset > max) return null;
  return fieldOffset;
}

/** Distance from an object's start to its `m_assocLevelId`. */
export type AssociatedLevelFieldOffset = number;

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

/**
 * The narrow walk: every frame the shared frame walk finds, stepping over a
 * frame it has read as the wide walk does, so a frame nested in another's body
 * is not read.
 */
function scanNarrowCandidates(data: Uint8Array, view: DataView): AssociatedLevelRelationCandidate[] {
  const candidates: AssociatedLevelRelationCandidate[] = [];
  let next = 0;
  for (const frame of scanFramedElementObjects(data)) {
    if (frame.offset < next) continue;
    next = frame.offset + frame.objectLength + 16;
    const limit = frame.offset + frame.objectLength + 12;
    const fieldOffset = associatedLevelFieldOffset(view, frame.offset, limit, true);
    if (fieldOffset == null || frame.offset + fieldOffset + 4 > limit) continue;
    const levelId = view.getUint32(frame.offset + fieldOffset, true);
    if (!levelId || levelId > 0x7fff_ffff || levelId === frame.elementId) continue;
    candidates.push({
      elementId: frame.elementId,
      levelId,
      fieldOffset,
      recordOffset: frame.offset,
      objectLength: frame.objectLength,
      objectMarker: frame.marker,
    });
  }
  return candidates;
}

/** Scan one inflated partition chunk for framed associated-level candidates. */
export function scanAssociatedLevelRelationCandidates(
  data: Uint8Array,
  revitVersion: number,
): AssociatedLevelRelationCandidate[] {
  const candidates: AssociatedLevelRelationCandidate[] = [];
  if (!readsElementRecordLayout(revitVersion) || data.byteLength < 64) return candidates;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (!usesRevit2027RecordLayout(revitVersion) && narrowElementIds()) {
    return scanNarrowCandidates(data, view);
  }

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
    const objectMarker = canonicalClassTag(view.getUint16(offset + 16, true));
    const fieldOffset = associatedLevelFieldOffset(view, offset, limit);
    if (fieldOffset != null) {
      const levelId = readId(view, offset + fieldOffset, limit);
      if (levelId != null && levelId !== elementId) {
        candidates.push({
          elementId,
          levelId,
          fieldOffset,
          recordOffset: offset,
          objectLength,
          objectMarker,
        });
      }
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
