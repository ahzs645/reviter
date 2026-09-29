/** Length/echo records in partition sequences 102 and 103.
 * Unlike sequence 101, these store id:i64, discriminator:u32, length:u32,
 * a length-byte body (starting with a schema class), and length:u32 again.
 * A separate reader is required for each sequence and each partition.
 */
import type { PartitionBlockHeader } from "./revit-container.ts";

export type PartitionObjectRecord = {
  elementId: number;
  classIndex: number | null;
  objectLength: number;
  firstChunk: number;
  lastChunk: number;
  data: Uint8Array;
};

export class PartitionRecordReader {
  private tail: Uint8Array = new Uint8Array();
  private firstChunk = 0;
  readonly stats = { records: 0, spanningRecords: 0, rejectedBlocks: 0, incompleteRecords: 0 };

  readonly sequence: 102 | 103;
  readonly maxRecordBytes: number;
  constructor(sequence: 102 | 103, maxRecordBytes = 32 * 1024 * 1024) {
    this.sequence = sequence;
    this.maxRecordBytes = maxRecordBytes;
  }

  reset(): void {
    if (this.tail.length) this.stats.incompleteRecords += 1;
    this.tail = new Uint8Array();
  }

  push(header: PartitionBlockHeader, page: Uint8Array, chunk: number): PartitionObjectRecord[] {
    if (header.sequence !== this.sequence) return [];
    const continues = Boolean(header.flags & 1);
    if (continues !== Boolean(this.tail.length)) {
      this.reset();
      if (continues) { this.stats.rejectedBlocks += 1; return []; }
    }
    const oldTailLength = this.tail.length;
    let data = page;
    if (oldTailLength) {
      data = new Uint8Array(oldTailLength + page.length);
      data.set(this.tail); data.set(page, oldTailLength);
    }
    this.tail = new Uint8Array();
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const records: PartitionObjectRecord[] = [];
    let at = 0;
    let starts = 0;
    let rejected = false;
    while (at + 16 <= data.length) {
      const id = view.getUint32(at, true);
      const high = view.getUint32(at + 4, true);
      const length = view.getUint32(at + 12, true);
      const nullId = id === 0xffffffff && high === 0xffffffff;
      if ((high !== 0 && !nullId) || length + 20 > this.maxRecordBytes) { rejected = true; break; }
      if (at >= oldTailLength) starts += 1;
      const end = at + 20 + length;
      if (end > data.length) break;
      if (view.getUint32(end - 4, true) !== length) { rejected = true; break; }
      records.push({
        elementId: nullId ? -1 : id,
        classIndex: length >= 2 ? view.getUint16(at + 16, true) : null,
        objectLength: length,
        firstChunk: at < oldTailLength ? this.firstChunk : chunk,
        lastChunk: chunk,
        data: data.subarray(at, end),
      });
      at = end;
    }
    // A partial header also starts a record in this block.
    if (at < data.length && at >= oldTailLength && at + 16 > data.length) starts += 1;
    if (starts !== header.recordsStarting || Boolean(at < data.length) !== Boolean(header.flags & 2)) rejected = true;
    if (rejected) {
      this.stats.rejectedBlocks += 1;
      return [];
    }
    if (at < data.length) {
      this.tail = data.slice(at);
      if (at >= oldTailLength) this.firstChunk = chunk;
    }
    this.stats.records += records.length;
    this.stats.spanningRecords += records.filter(r => r.firstChunk !== r.lastChunk).length;
    return records;
  }
}
