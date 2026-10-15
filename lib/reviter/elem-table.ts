import type { ElemTableLayout, RvtElementIndex } from "./types.ts";

function u16(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8);
}

function u32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] ?? 0) |
      ((data[offset + 1] ?? 0) << 8) |
      ((data[offset + 2] ?? 0) << 16) |
      ((data[offset + 3] ?? 0) << 24)) >>> 0
  );
}

export function detectElemTableLayout(data: Uint8Array): ElemTableLayout {
  const markers: Array<{ offset: number; length: number }> = [];
  const scanEnd = Math.min(data.length, 512);
  for (let offset = 0x10; offset + 4 <= scanEnd && markers.length < 3; offset += 1) {
    if (
      data[offset] !== 0xff ||
      data[offset + 1] !== 0xff ||
      data[offset + 2] !== 0xff ||
      data[offset + 3] !== 0xff
    ) {
      continue;
    }
    const eight =
      offset + 8 <= data.length &&
      data[offset + 4] === 0xff &&
      data[offset + 5] === 0xff &&
      data[offset + 6] === 0xff &&
      data[offset + 7] === 0xff;
    const length = eight ? 8 : 4;
    markers.push({ offset, length });
    offset += length - 1;
  }

  if (markers.length >= 2) {
    return {
      start: markers[0]!.offset,
      stride: markers[1]!.offset - markers[0]!.offset,
      markerLength: markers[0]!.length,
      framing: "explicit",
    };
  }
  return { start: 0x30, stride: 12, markerLength: 0, framing: "implicit" };
}

export function parseElemTable(data: Uint8Array): RvtElementIndex | null {
  if (data.length < 0x30) return null;
  const declaredElementCount = u16(data, 0);
  const recordCount = u16(data, 2);
  const layout = detectElemTableLayout(data);
  if (!layout.stride) return null;

  const ids = new Set<number>();
  let parsedRecordCount = 0;
  for (
    let offset = layout.start;
    parsedRecordCount < recordCount && offset + layout.stride <= data.length;
    offset += layout.stride
  ) {
    const body = offset + layout.markerLength;
    let id = 0;
    if (layout.framing === "implicit") id = u32(data, body);
    else if (layout.stride === 40) id = u32(data, body + 4);
    else id = u32(data, body);
    if (id > 0 && id !== 0xffffffff) ids.add(id);
    parsedRecordCount += 1;
  }

  return {
    declaredElementCount,
    recordCount,
    parsedRecordCount,
    uniqueElementIds: Uint32Array.from([...ids].sort((a, b) => a - b)),
    partitionRecordIds: new Uint32Array(),
    partitionRecords: [],
    layout,
  };
}

/**
 * Complete source inventory, separate from legacy scene admission above.
 *
 * rvt-rs elem_table.rs at 1c3d337 (Apache-2.0; docs/third-party/rvt-rs)
 * measures the REAL array at +6, after [u16 schema tag][u32 count]. The old
 * reader above starts on an unset owner marker, which shifts records, omits
 * the first id and truncates counts above 65535. Its geometry behavior is kept
 * intact until paired scene tests authorize a separate admission change.
 *
 * This reader accepts exact project framing only: 28-byte narrow rows plus a
 * 19-byte tail, or 40-byte wide rows plus a 24-byte tail. Family trailers and
 * guessed implicit layouts are unsupported. Secondary ids rise strictly; both
 * primary and secondary ids are retained because Snowdon differs on 84 rows.
 */
export const FULL_ELEM_TABLE_MAX_RECORDS = 1_000_000;
const PROJECT_ELEM_TABLE_TAGS: Readonly<Record<number, number>> = {
  2024: 1411, 2025: 1451, 2026: 1481, 2027: 1510,
};
export type FullElemTableInventory = {
  status: "decoded";
  source: "Global/ElemTable";
  revitVersion: number;
  /** The first u16 is a schema class tag, never an element count. */
  schemaTag: number;
  declaredRecordCount: number;
  parsedRecordCount: number;
  layout: { start: 6; stride: 28 | 40; ownerOffset: 24 | 28; idBytes: 4 | 8; suffixBytes: 19 | 24 };
  /** One current/source secondary id per row, INCLUDING the first row/id zero. */
  elementIds: Float64Array;
  primaryElementIds: Float64Array;
  /** Source owner slots: -1 means the file stores 0 or the all-FF sentinel. */
  ownerElementIds: Float64Array;
  /** Sorted union, matching upstream declared_ids; never silently narrowed. */
  declaredElementIds: Float64Array;
  differingIdRecordCount: number;
  ownerRecordCount: number;
};
export type FullElemTableInventoryFailure = { status: "unsupported"; reason: string };

export function parseFullElemTableInventory(
  data: Uint8Array,
  options: { revitVersion: number; expectedSchemaTag?: number },
): FullElemTableInventory | FullElemTableInventoryFailure {
  const fail = (reason: string): FullElemTableInventoryFailure => ({ status: "unsupported", reason });
  const { revitVersion } = options;
  if (!Number.isInteger(revitVersion) || revitVersion < 2019 || revitVersion > 2027) return fail("unsupported-release");
  const narrow = revitVersion <= 2023;
  const stride = narrow ? 28 : 40;
  const suffixBytes = narrow ? 19 : 24;
  const ownerOffset = narrow ? 24 : 28;
  const expectedTag = options.expectedSchemaTag ?? PROJECT_ELEM_TABLE_TAGS[revitVersion];
  if (!Number.isInteger(expectedTag) || expectedTag! <= 0 || expectedTag! > 0x7fff) return fail("missing-or-invalid-schema-tag");
  if (data.byteLength < 6 + stride + suffixBytes) return fail("truncated-project-framing");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const schemaTag = view.getUint16(0, true);
  if (schemaTag !== expectedTag) return fail("schema-tag-mismatch");
  const count = view.getUint32(2, true);
  if (count < 1 || count > FULL_ELEM_TABLE_MAX_RECORDS) return fail("record-count-limit");
  const end = 6 + count * stride;
  if (end + suffixBytes !== data.byteLength) return fail("record-count-and-stream-length-disagree");
  // The supplied 2024/2025/2027 project tails open with a zero word and unset
  // pointer. Narrow tails retain upstream's measured length but stay opaque.
  // No semantic interpretation is assigned to the remaining variable fields.
  if (!narrow && (view.getUint32(end, true) !== 0 || view.getUint32(end + 4, true) !== 0xffff_ffff)) return fail("unsupported-project-tail-marker");
  const current = new Float64Array(count);
  const primary = new Float64Array(count);
  const owners = new Float64Array(count);
  const declared = new Set<number>();
  const currentIndex = new Map<number, number>();
  let previous = -1;
  let differingIdRecordCount = 0;
  let ownerRecordCount = 0;
  const safeId = (value: bigint) => value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
  for (let index = 0; index < count; index++) {
    const at = 6 + index * stride;
    const first = narrow ? view.getUint32(at, true) : safeId(view.getBigUint64(at, true));
    const second = narrow ? view.getUint32(at + 4, true) : safeId(view.getBigUint64(at + 20, true));
    if (first === undefined || second === undefined || (narrow && (first === 0xffff_ffff || second === 0xffff_ffff))) return fail(`unsupported-element-id-at-row-${index}`);
    if (second <= previous) return fail(`non-increasing-or-duplicate-source-id-at-row-${index}`);
    previous = second;
    current[index] = second; primary[index] = first;
    currentIndex.set(second, index);
    declared.add(first);
    if (!narrow && second !== 0) declared.add(second);
    if (first !== second) differingIdRecordCount++;
    const rawOwner = narrow ? BigInt(view.getUint32(at + ownerOffset, true)) : view.getBigUint64(at + ownerOffset, true);
    const sentinel = narrow ? 0xffff_ffffn : 0xffff_ffff_ffff_ffffn;
    if (rawOwner === 0n || rawOwner === sentinel) owners[index] = -1;
    else {
      const owner = safeId(rawOwner);
      if (owner === undefined) return fail(`unsupported-owner-id-at-row-${index}`);
      owners[index] = owner; ownerRecordCount++;
    }
  }
  // Owner membership and acyclicity are independently measured record framing
  // checks upstream; a corrupt array cannot authorize new semantic joins.
  for (let index = 0; index < count; index++) {
    if (owners[index]! >= 0 && !currentIndex.has(owners[index]!)) return fail(`undeclared-owner-at-row-${index}`);
    if (owners[index] === current[index]) return fail(`self-owner-at-row-${index}`);
  }
  const visited = new Uint8Array(count);
  for (let index = 0; index < count; index++) {
    let cursor: number | undefined = index;
    while (cursor !== undefined && visited[cursor] === 0) {
      visited[cursor] = 1;
      cursor = owners[cursor]! < 0 ? undefined : currentIndex.get(owners[cursor]!);
    }
    if (cursor !== undefined && visited[cursor] === 1) return fail(`cyclic-owner-chain-at-row-${index}`);
    cursor = index;
    while (cursor !== undefined && visited[cursor] === 1) {
      visited[cursor] = 2;
      cursor = owners[cursor]! < 0 ? undefined : currentIndex.get(owners[cursor]!);
    }
  }
  return { status: "decoded", source: "Global/ElemTable", revitVersion, schemaTag,
    declaredRecordCount: count, parsedRecordCount: count,
    layout: { start: 6, stride, ownerOffset, idBytes: narrow ? 4 : 8, suffixBytes },
    elementIds: current, primaryElementIds: primary, ownerElementIds: owners,
    declaredElementIds: Float64Array.from([...declared].sort((a, b) => a - b)), differingIdRecordCount, ownerRecordCount };
}
