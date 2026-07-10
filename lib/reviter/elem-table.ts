import type { ElemTableLayout, RvtElementIndex } from "./types";

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
