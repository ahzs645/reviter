/**
 * The Revit 2027 nested duplicated-bounds record.
 *
 * Inside an inflated partition page, an element envelope is framed by the tag
 * `0x08c6` at a fixed offset, the native element id repeated twice, a constant
 * family word, and a field table whose length is driven by the record count.
 * The axis-aligned bounds that follow are written twice, and that duplication is
 * what makes the signature strict enough to trust: a false positive would have
 * to reproduce 48 bytes exactly.
 */
import type { Bounds3, ElementBoundsRecord } from "./types";

const BOUNDS_DUPLICATE_BYTES = 48;

/** Span below which an axis is treated as degenerate rather than solid. */
export const MIN_SOLID_SPAN_FEET = 0.001;

export type DetectedBoundsRecord = {
  elementId: number;
  recordOffset: number;
  boundsOffset: number;
  recordCode: number;
  recordCount: number;
  boundsFeet: Bounds3;
};

export function detectDuplicatedBoundsRecords(data: Uint8Array): DetectedBoundsRecord[] {
  const records: DetectedBoundsRecord[] = [];
  if (data.byteLength < 138) return records;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (
    let tagOffset = data.indexOf(0xc6, 16);
    tagOffset >= 0 && tagOffset + 122 < data.byteLength;
    tagOffset = data.indexOf(0xc6, tagOffset + 1)
  ) {
    if (data[tagOffset + 1] !== 0x08) continue;
    const recordOffset = tagOffset - 16;
    const elementId = view.getUint32(recordOffset, true);
    if (
      !elementId ||
      elementId === 0xffffffff ||
      view.getUint32(recordOffset + 4, true) !== 0 ||
      view.getUint32(recordOffset + 26, true) !== elementId ||
      view.getUint32(recordOffset + 30, true) !== 0 ||
      view.getUint32(recordOffset + 34, true) !== 0x0008_8004 ||
      view.getUint32(recordOffset + 42, true) !== 3
    ) {
      continue;
    }
    const recordCount = view.getUint32(recordOffset + 38, true);
    if (recordCount < 1 || recordCount > 10_000) continue;
    const boundsOffset = 42 + recordCount * 6;
    const boundsStart = recordOffset + boundsOffset;
    if (boundsStart + BOUNDS_DUPLICATE_BYTES * 2 > data.byteLength) continue;
    let duplicate = true;
    for (let byte = 0; byte < BOUNDS_DUPLICATE_BYTES; byte += 1) {
      if (data[boundsStart + byte] !== data[boundsStart + BOUNDS_DUPLICATE_BYTES + byte]) {
        duplicate = false;
        break;
      }
    }
    if (!duplicate) continue;

    const values = Array.from({ length: 6 }, (_, index) =>
      view.getFloat64(boundsStart + index * 8, true),
    );
    if (!values.every((value) => Number.isFinite(value) && Math.abs(value) <= 50_000)) {
      continue;
    }
    const [minX, minY, minZ, maxX, maxY, maxZ] = values as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const spans = [maxX - minX, maxY - minY, maxZ - minZ];
    if (
      spans.some((span) => span < -1e-8 || span > 5_000) ||
      spans.filter((span) => span > MIN_SOLID_SPAN_FEET).length < 2
    ) {
      continue;
    }
    records.push({
      elementId,
      recordOffset,
      boundsOffset,
      recordCode: view.getUint32(recordOffset + 18, true),
      recordCount,
      boundsFeet: {
        min: { x: minX, y: minY, z: minZ },
        max: { x: maxX, y: maxY, z: maxZ },
      },
    });
  }
  return records;
}

export function detectDuplicatedBoundsRecord(data: Uint8Array): DetectedBoundsRecord | null {
  return detectDuplicatedBoundsRecords(data)[0] ?? null;
}

/** True when every axis has real extent, so the envelope encloses a volume. */
export function solidBounds(record: ElementBoundsRecord): boolean {
  const { min, max } = record.boundsFeet;
  return (
    max.x - min.x > MIN_SOLID_SPAN_FEET &&
    max.y - min.y > MIN_SOLID_SPAN_FEET &&
    max.z - min.z > MIN_SOLID_SPAN_FEET
  );
}

/** Records below which a tail trim would be guesswork rather than statistics. */
const MIN_RECORDS_FOR_ROBUST_BOUNDS = 500;

/** Share of records ignored at each end of each axis when framing the scene. */
const ROBUST_BOUNDS_TAIL = 0.001;

function quantile(sorted: number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * fraction)));
  return sorted[index]!;
}

/**
 * The extent the scene should be *framed* to, as opposed to the extent it
 * contains.
 *
 * A handful of misparsed records land thousands of feet from the building, and
 * because the origin is the midpoint of the absolute extent, three of them were
 * enough to move the supplied model's centre 1,811 ft — more than a building
 * length — so the camera opened on empty space. Ignoring one part in a thousand
 * at each end of each axis reproduces the paired export's building extent to
 * within a few feet, where the absolute min/max does not.
 *
 * Nothing is discarded: every record is still drawn, exported, and audited.
 * This decides only where the viewer looks.
 */
export function framingBoundsOfRecords(records: ElementBoundsRecord[]): Bounds3 {
  if (records.length < MIN_RECORDS_FOR_ROBUST_BOUNDS) return boundsOfRecords(records);
  const axes = ["x", "y", "z"] as const;
  const min = { x: 0, y: 0, z: 0 };
  const max = { x: 0, y: 0, z: 0 };
  for (const axis of axes) {
    const lower = records.map((record) => record.boundsFeet.min[axis]).sort((a, b) => a - b);
    const upper = records.map((record) => record.boundsFeet.max[axis]).sort((a, b) => a - b);
    min[axis] = quantile(lower, ROBUST_BOUNDS_TAIL);
    max[axis] = quantile(upper, 1 - ROBUST_BOUNDS_TAIL);
  }
  // A degenerate axis would collapse the view; fall back rather than produce it.
  return axes.every((axis) => max[axis] > min[axis]) ? { min, max } : boundsOfRecords(records);
}

export function boundsOfRecords(records: ElementBoundsRecord[]): Bounds3 {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const record of records) {
    const bounds = record.boundsFeet;
    min.x = Math.min(min.x, bounds.min.x);
    min.y = Math.min(min.y, bounds.min.y);
    min.z = Math.min(min.z, bounds.min.z);
    max.x = Math.max(max.x, bounds.max.x);
    max.y = Math.max(max.y, bounds.max.y);
    max.z = Math.max(max.z, bounds.max.z);
  }
  return { min, max };
}
