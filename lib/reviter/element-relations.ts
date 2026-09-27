/**
 * Persisted element ownership from Revit 2024-2027 `Global/ElemTable`.
 *
 * This decoder is intentionally narrow. It accepts only the fixed-width layout
 * whose invariants can be checked for every row:
 *
 * - the collection count at byte 2;
 * - one special leading record, followed by 40-byte element records at byte 34;
 * - a zero word at row + 8;
 * - a 64-bit current object id at row + 12;
 * - a 64-bit `OwningElementId` at row + 0;
 * - the 36-byte table suffix used by the 2024-2027 files validated so far.
 *
 * The field identity is independently corroborated by the public
 * `OdBmElemRec::getOwningElementId` API and its four reflected properties:
 * ObjectId, History, PartitionId, and OwningElementId. No neighbouring-record
 * or element-id adjacency is used to construct an edge.
 *
 * **Where ids are 32-bit** (Revit 2019 to 2023; `element-id-width.ts`) the
 * same records are 28 bytes from byte 30: `[i32 OwningElementId (-1 for
 * none)][i32 ObjectId][4 x i32 History][i32 PartitionId]`, with no zero word
 * between the two ids, and the table ends in a 23-byte suffix in every
 * 2019-2023 sample here. On the 2023 RAC sample 8,214 of the 8,216 elements
 * it shares with the 2025 copy of the project have the same owner.
 */
import { narrowElementIds } from "./element-id-width.ts";

const RECORD_START = 34;
const RECORD_STRIDE = 40;
const TABLE_SUFFIX_BYTES = 36;
const INVALID_OBJECT_ID = 0xffff_ffff_ffff_ffffn;
const MAX_ARRAY_RECORDS = 10_000_000;

export type ElementOwnershipRecord = {
  elementId: number;
  owningElementId: number | null;
  byteOffset: number;
};

export type ElementOwnershipRelation = {
  ownerId: number;
  elementId: number;
  kind: "owning-element";
  source: "Global/ElemTable.OwningElementId";
  evidence: "persisted";
};

/** The 40-byte rows of 2024 on, or the 28-byte rows of 2019 to 2023. */
export type ElementOwnershipFormat = "revit-2024-2027-elem-table" | "revit-2019-2023-elem-table";

const NARROW_RECORD_START = 30;
const NARROW_RECORD_STRIDE = 28;
const NARROW_TABLE_SUFFIX_BYTES = 23;

export type ElementOwnershipDecode = {
  format: ElementOwnershipFormat;
  declaredRecordCount: number;
  decodedRecordCount: number;
  skippedLeadingRecordCount: 1;
  rootRecordCount: number;
  selfOwnedRecordCount: number;
  danglingOwnerCount: number;
  records: ElementOwnershipRecord[];
  relations: ElementOwnershipRelation[];
};

export type ElementOwnershipFailure = {
  format: "unsupported";
  reason: string;
};

export type ElementOwnershipGraph = {
  recordsById: Map<number, ElementOwnershipRecord>;
  parentByElement: Map<number, number>;
  childrenByOwner: Map<number, number[]>;
  roots: number[];
  selfOwned: number[];
};

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function u64(view: DataView, offset: number): bigint {
  return view.getBigUint64(offset, true);
}

function safeObjectId(value: bigint): number | null {
  if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

function unsupported(reason: string): ElementOwnershipFailure {
  return { format: "unsupported", reason };
}

/**
 * Decode only persisted ownership edges from an inflated `Global/ElemTable`.
 *
 * The compressed CFB stream must be checksum-stripped and inflated before this
 * function is called. The implementation uses only Web Platform primitives, so
 * it can run unchanged in a browser or Web Worker.
 */
export function decodeElementOwnership(
  data: Uint8Array,
): ElementOwnershipDecode | ElementOwnershipFailure {
  if (narrowElementIds()) return decodeNarrowElementOwnership(data);
  if (data.byteLength < RECORD_START + TABLE_SUFFIX_BYTES) {
    return unsupported("element table is shorter than the 2024-2027 framing");
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const declaredRecordCount = u32(view, 2);
  if (declaredRecordCount < 2 || declaredRecordCount > MAX_ARRAY_RECORDS) {
    return unsupported(`implausible element record count ${declaredRecordCount}`);
  }

  // The first collection item has a compact special representation. It carries
  // the table/root record and no usable OwningElementId, so the relation decoder
  // starts at the first complete OdBmElemRec.
  const decodedRecordCount = declaredRecordCount - 1;
  const recordsEnd = RECORD_START + decodedRecordCount * RECORD_STRIDE;
  if (recordsEnd + TABLE_SUFFIX_BYTES !== data.byteLength) {
    return unsupported(
      `record count and stream length disagree (${recordsEnd + TABLE_SUFFIX_BYTES} != ${data.byteLength})`,
    );
  }

  const records: ElementOwnershipRecord[] = [];
  const ids = new Set<number>();
  let rootRecordCount = 0;
  let selfOwnedRecordCount = 0;

  for (let index = 0; index < decodedRecordCount; index += 1) {
    const byteOffset = RECORD_START + index * RECORD_STRIDE;
    if (u32(view, byteOffset + 8) !== 0) {
      return unsupported(`row ${index} has a non-zero object-id prefix`);
    }

    const rawElementId = u64(view, byteOffset + 12);
    const elementId = safeObjectId(rawElementId);
    if (elementId == null) {
      return unsupported(`row ${index} has an invalid object id`);
    }
    if (ids.has(elementId)) {
      return unsupported(`row ${index} repeats element id ${elementId}`);
    }
    ids.add(elementId);

    const rawOwnerId = u64(view, byteOffset);
    let owningElementId: number | null;
    if (rawOwnerId === INVALID_OBJECT_ID) {
      owningElementId = null;
      rootRecordCount += 1;
    } else {
      owningElementId = safeObjectId(rawOwnerId);
      if (owningElementId == null) {
        return unsupported(`row ${index} has an invalid owning element id`);
      }
      if (owningElementId === elementId) selfOwnedRecordCount += 1;
    }

    records.push({
      elementId,
      owningElementId,
      byteOffset,
    });
  }

  const relations: ElementOwnershipRelation[] = [];
  let danglingOwnerCount = 0;
  for (const record of records) {
    const ownerId = record.owningElementId;
    if (ownerId == null || ownerId === record.elementId) continue;
    if (!ids.has(ownerId)) danglingOwnerCount += 1;
    relations.push({
      ownerId,
      elementId: record.elementId,
      kind: "owning-element",
      source: "Global/ElemTable.OwningElementId",
      evidence: "persisted",
    });
  }

  return {
    format: "revit-2024-2027-elem-table",
    declaredRecordCount,
    decodedRecordCount,
    skippedLeadingRecordCount: 1,
    rootRecordCount,
    selfOwnedRecordCount,
    danglingOwnerCount,
    records,
    relations,
  };
}

/** `decodeElementOwnership` for the 28-byte rows of a 32-bit-id file. */
function decodeNarrowElementOwnership(
  data: Uint8Array,
): ElementOwnershipDecode | ElementOwnershipFailure {
  if (data.byteLength < NARROW_RECORD_START + NARROW_TABLE_SUFFIX_BYTES) {
    return unsupported("element table is shorter than the 2019-2023 framing");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const declaredRecordCount = u32(view, 2);
  if (declaredRecordCount < 2 || declaredRecordCount > MAX_ARRAY_RECORDS) {
    return unsupported(`implausible element record count ${declaredRecordCount}`);
  }
  const decodedRecordCount = declaredRecordCount - 1;
  const recordsEnd = NARROW_RECORD_START + decodedRecordCount * NARROW_RECORD_STRIDE;
  if (recordsEnd + NARROW_TABLE_SUFFIX_BYTES !== data.byteLength) {
    return unsupported(
      `record count and stream length disagree (${recordsEnd + NARROW_TABLE_SUFFIX_BYTES} != ${data.byteLength})`,
    );
  }

  const records: ElementOwnershipRecord[] = [];
  const ids = new Set<number>();
  let rootRecordCount = 0;
  let selfOwnedRecordCount = 0;
  for (let index = 0; index < decodedRecordCount; index += 1) {
    const byteOffset = NARROW_RECORD_START + index * NARROW_RECORD_STRIDE;
    const elementId = view.getInt32(byteOffset + 4, true);
    if (elementId <= 0) return unsupported(`row ${index} has an invalid object id`);
    if (ids.has(elementId)) return unsupported(`row ${index} repeats element id ${elementId}`);
    ids.add(elementId);
    const rawOwnerId = view.getInt32(byteOffset, true);
    let owningElementId: number | null;
    if (rawOwnerId === -1) {
      owningElementId = null;
      rootRecordCount += 1;
    } else if (rawOwnerId > 0) {
      owningElementId = rawOwnerId;
      if (owningElementId === elementId) selfOwnedRecordCount += 1;
    } else {
      return unsupported(`row ${index} has an invalid owning element id`);
    }
    records.push({ elementId, owningElementId, byteOffset });
  }

  const relations: ElementOwnershipRelation[] = [];
  let danglingOwnerCount = 0;
  for (const record of records) {
    const ownerId = record.owningElementId;
    if (ownerId == null || ownerId === record.elementId) continue;
    if (!ids.has(ownerId)) danglingOwnerCount += 1;
    relations.push({
      ownerId,
      elementId: record.elementId,
      kind: "owning-element",
      source: "Global/ElemTable.OwningElementId",
      evidence: "persisted",
    });
  }
  return {
    format: "revit-2019-2023-elem-table",
    declaredRecordCount,
    decodedRecordCount,
    skippedLeadingRecordCount: 1,
    rootRecordCount,
    selfOwnedRecordCount,
    danglingOwnerCount,
    records,
    relations,
  };
}

/** Build the bidirectional model-tree index without inventing inferred edges. */
export function buildElementOwnershipGraph(
  decoded: ElementOwnershipDecode,
): ElementOwnershipGraph {
  const recordsById = new Map<number, ElementOwnershipRecord>();
  const parentByElement = new Map<number, number>();
  const childrenByOwner = new Map<number, number[]>();
  const roots: number[] = [];
  const selfOwned: number[] = [];

  for (const record of decoded.records) {
    recordsById.set(record.elementId, record);
    if (record.owningElementId == null) roots.push(record.elementId);
    else if (record.owningElementId === record.elementId) selfOwned.push(record.elementId);
  }
  for (const relation of decoded.relations) {
    parentByElement.set(relation.elementId, relation.ownerId);
    const children = childrenByOwner.get(relation.ownerId);
    if (children) children.push(relation.elementId);
    else childrenByOwner.set(relation.ownerId, [relation.elementId]);
  }

  return { recordsById, parentByElement, childrenByOwner, roots, selfOwned };
}
