/**
 * Partition names from `Global/PartitionTable`.
 *
 * Each name is a UTF-16LE string with a `u32` character count. What the names
 * mean depends on the file: a project lists its worksets, and a non-workshared
 * project still declares the single default one, while a family file carries
 * its family partition path here instead. The decoder reports the names; it
 * does not assert which kind they are.
 */

const MIN_NAME_CHARS = 1;
const MAX_NAME_CHARS = 260;

export type PartitionName = {
  name: string;
  /** Byte offset of the length prefix inside the inflated stream. */
  offset: number;
};

export function parsePartitionNames(data: Uint8Array): PartitionName[] {
  const names: PartitionName[] = [];
  if (data.byteLength < 6) return names;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder("utf-16le");

  for (let offset = 0; offset + 4 <= data.byteLength; offset += 1) {
    const chars = view.getUint32(offset, true);
    if (chars < MIN_NAME_CHARS || chars > MAX_NAME_CHARS) continue;
    const end = offset + 4 + chars * 2;
    if (end > data.byteLength) continue;

    let printable = true;
    for (let index = offset + 4; index < end; index += 2) {
      const unit = view.getUint16(index, true);
      if (unit < 0x20 || unit > 0x7e) {
        printable = false;
        break;
      }
    }
    if (!printable) continue;

    names.push({ name: decoder.decode(data.subarray(offset + 4, end)), offset });
    offset = end - 1;
  }
  return names;
}
