/**
 * Persisted Revit 2027 FamilyInstance host relationships.
 *
 * The file's embedded schema declares `InsertableInst.m_hostId`, and the native
 * API independently exposes `OdBmInsertableInst::getBaseHostId()` /
 * `OdBmFamilyInstance::getHostId()`. In framed `0x07ef` objects the field is at
 * `+151`; a versioned optional-field layout moves it to `+153`.
 *
 * Resolution is intentionally a second pass. The primary `+151` value wins only
 * when it targets another framed element; `+153` is considered only when the
 * primary does not resolve. This rejects the overlapping byte windows that
 * otherwise make `+153` look like a live id in unrelated records.
 *
 * **Where ids are 32-bit** (Revit 2019 to 2023; `element-id-width.ts`) the
 * same field is a four-byte id 36 bytes nearer the frame's start, the 12-byte
 * header and `Element`'s eight narrowed ids: `+115`, or `+117` in the
 * versioned layout. Every one of the 304 hosts the 2025 RAC sample resolves
 * is at one of the two in the 2023 copy of the same instance.
 */
import { narrowElementIds } from "./element-id-width.ts";
import { scanFramedElementObjects } from "./element-objects.ts";
import { canonicalClassTag, readsElementRecordLayout, usesRevit2027RecordLayout } from "./revit-class-tags.ts";

export const REVIT_2027_INSERTABLE_INSTANCE_MARKER = 0x07ef;

const PRIMARY_HOST_ID_OFFSET = 151;
const ALTERNATE_HOST_ID_OFFSET = 153;
const NARROW_PRIMARY_HOST_ID_OFFSET = 115;
const NARROW_ALTERNATE_HOST_ID_OFFSET = 117;

/** The field a host id was read from: the 2024-on offsets, or the 2019-2023 ones. */
export type HostIdFieldOffset = 151 | 153 | 115 | 117;

function isPrimaryHostField(fieldOffset: HostIdFieldOffset): boolean {
  return fieldOffset === PRIMARY_HOST_ID_OFFSET || fieldOffset === NARROW_PRIMARY_HOST_ID_OFFSET;
}
const MIN_OBJECT_BYTES = 40;
const MAX_OBJECT_BYTES = 0xffff;

export type HostRelationCandidate = {
  elementId: number;
  hostId: number;
  fieldOffset: HostIdFieldOffset;
  recordOffset: number;
  objectLength: number;
  objectMarker: typeof REVIT_2027_INSERTABLE_INSTANCE_MARKER;
};

export type NativeHostRelation = HostRelationCandidate & {
  kind: "host";
  source: "Partitions/InsertableInst.m_hostId";
  evidence: "persisted";
};

function readId(view: DataView, offset: number, limit: number): number | null {
  if (offset < 0 || offset + 8 > limit || view.getUint32(offset + 4, true) !== 0) return null;
  const id = view.getUint32(offset, true);
  return id || null;
}

/** Scan one inflated partition chunk for framed host-id candidates. */
export function scanHostRelationCandidates(
  data: Uint8Array,
  revitVersion: number,
): HostRelationCandidate[] {
  const candidates: HostRelationCandidate[] = [];
  if (!readsElementRecordLayout(revitVersion) || data.byteLength < 64) return candidates;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (!usesRevit2027RecordLayout(revitVersion) && narrowElementIds()) {
    let next = 0;
    for (const frame of scanFramedElementObjects(data)) {
      if (frame.offset < next || frame.marker !== REVIT_2027_INSERTABLE_INSTANCE_MARKER) continue;
      next = frame.offset + frame.objectLength + 16;
      const limit = frame.offset + frame.objectLength;
      for (const fieldOffset of [
        NARROW_PRIMARY_HOST_ID_OFFSET,
        NARROW_ALTERNATE_HOST_ID_OFFSET,
      ] as const) {
        if (frame.offset + fieldOffset + 4 > limit) continue;
        const hostId = view.getUint32(frame.offset + fieldOffset, true);
        if (!hostId || hostId > 0x7fff_ffff || hostId === frame.elementId) continue;
        candidates.push({
          elementId: frame.elementId,
          hostId,
          fieldOffset,
          recordOffset: frame.offset,
          objectLength: frame.objectLength,
          objectMarker: REVIT_2027_INSERTABLE_INSTANCE_MARKER,
        });
      }
    }
    return candidates;
  }
  for (let offset = 0; offset + 24 <= data.byteLength; offset += 1) {
    if (view.getUint32(offset + 4, true) !== 0) continue;
    const elementId = view.getUint32(offset, true);
    if (!elementId) continue;
    const objectLength = view.getUint32(offset + 12, true);
    if (objectLength < MIN_OBJECT_BYTES || objectLength > MAX_OBJECT_BYTES) continue;
    const echo = offset + objectLength + 16;
    if (
      echo + 4 > data.byteLength ||
      view.getUint32(echo, true) !== objectLength ||
      canonicalClassTag(view.getUint16(offset + 16, true)) !== REVIT_2027_INSERTABLE_INSTANCE_MARKER
    ) {
      continue;
    }
    const limit = offset + objectLength;
    for (const fieldOffset of [
      PRIMARY_HOST_ID_OFFSET,
      ALTERNATE_HOST_ID_OFFSET,
    ] as const) {
      const hostId = readId(view, offset + fieldOffset, limit);
      if (hostId == null || hostId === elementId) continue;
      candidates.push({
        elementId,
        hostId,
        fieldOffset,
        recordOffset: offset,
        objectLength,
        objectMarker: REVIT_2027_INSERTABLE_INSTANCE_MARKER,
      });
    }
    offset += objectLength + 19;
  }
  return candidates;
}

/**
 * Resolve cross-chunk host ids against the complete framed-element id set.
 *
 * Conflicting records are omitted instead of picking one. Repeated identical
 * candidates collapse to one persisted edge.
 */
export function resolveHostRelations(
  candidates: readonly HostRelationCandidate[],
  framedElementIds: ReadonlySet<number>,
): NativeHostRelation[] {
  const byElement = new Map<number, Map<"primary" | "alternate", Set<number>>>();
  const candidateByKey = new Map<string, HostRelationCandidate>();
  for (const candidate of candidates) {
    if (!framedElementIds.has(candidate.hostId)) continue;
    const field = isPrimaryHostField(candidate.fieldOffset) ? "primary" : "alternate";
    const fields = byElement.get(candidate.elementId) ?? new Map<"primary" | "alternate", Set<number>>();
    const ids = fields.get(field) ?? new Set<number>();
    ids.add(candidate.hostId);
    fields.set(field, ids);
    byElement.set(candidate.elementId, fields);
    candidateByKey.set(
      `${candidate.elementId}:${field}:${candidate.hostId}`,
      candidate,
    );
  }

  const result: NativeHostRelation[] = [];
  for (const [elementId, fields] of byElement) {
    const primary = fields.get("primary");
    const alternate = fields.get("alternate");
    const selected: { hostId: number; field: "primary" | "alternate" } | null =
      primary?.size === 1
        ? { hostId: [...primary][0]!, field: "primary" }
        : !primary?.size && alternate?.size === 1
        ? { hostId: [...alternate][0]!, field: "alternate" }
        : null;
    if (!selected) continue;
    const source = candidateByKey.get(
      `${elementId}:${selected.field}:${selected.hostId}`,
    );
    if (!source) continue;
    result.push({
      ...source,
      kind: "host",
      source: "Partitions/InsertableInst.m_hostId",
      evidence: "persisted",
    });
  }
  return result.sort((a, b) => a.elementId - b.elementId);
}
