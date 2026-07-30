/** Browser-safe extraction of embedded DWG PNG and indexed-BMP previews. */

export type DwgThumbnail = {
  data: Uint8Array;
  mimeType: "image/png" | "image/bmp";
  sourceType: "png" | "bmp";
  width?: number;
  height?: number;
};

function hasRange(data: Uint8Array, offset: number, length: number): boolean {
  return Number.isInteger(offset) && Number.isInteger(length) &&
    offset >= 0 && length > 0 && offset + length <= data.byteLength;
}

function png(data: Uint8Array): boolean {
  return data.length >= 8 &&
    data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 &&
    data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a;
}

function bmpFromDib(dib: Uint8Array): DwgThumbnail | undefined {
  if (dib.byteLength < 40) return undefined;
  const view = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
  const headerSize = view.getUint32(0, true);
  const width = view.getInt32(4, true);
  const rawHeight = view.getInt32(8, true);
  const bitCount = view.getUint16(14, true);
  const compression = view.getUint32(16, true);
  const colorsUsed = view.getUint32(32, true);
  if (headerSize < 40 || headerSize > dib.byteLength || width <= 0 || rawHeight === 0) {
    return undefined;
  }
  const paletteEntries = bitCount <= 8 ? colorsUsed || 2 ** bitCount : 0;
  const bitMasks = headerSize === 40 && compression === 3 ? 12 : 0;
  const pixelOffset = 14 + headerSize + bitMasks + paletteEntries * 4;
  if (pixelOffset > dib.byteLength + 14) return undefined;

  const output = new Uint8Array(14 + dib.byteLength);
  const outputView = new DataView(output.buffer);
  output[0] = 0x42;
  output[1] = 0x4d;
  outputView.setUint32(2, output.byteLength, true);
  outputView.setUint32(10, pixelOffset, true);
  output.set(dib, 14);
  return {
    data: output,
    mimeType: "image/bmp",
    sourceType: "bmp",
    width,
    height: Math.abs(rawHeight),
  };
}

export function extractDwgThumbnail(data: Uint8Array): DwgThumbnail | undefined {
  if (data.byteLength < 0x20) return undefined;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const locator = view.getInt32(0x0d, true);
  const tableOffset = 0x14 + locator;
  if (!hasRange(data, tableOffset, 1)) return undefined;
  const count = data[tableOffset]!;
  if (count <= 1 || count > 64) return undefined;

  for (let index = 0; index < count; index += 1) {
    const recordOffset = tableOffset + 1 + index * 9;
    if (!hasRange(data, recordOffset, 9)) break;
    const type = data[recordOffset]!;
    const start = view.getInt32(recordOffset + 1, true);
    const length = view.getInt32(recordOffset + 5, true);
    if (!hasRange(data, start, length)) continue;
    const payload = data.slice(start, start + length);
    if (type === 6 && png(payload)) {
      const pngView = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      return {
        data: payload,
        mimeType: "image/png",
        sourceType: "png",
        ...(payload.byteLength >= 24
          ? { width: pngView.getUint32(16), height: pngView.getUint32(20) }
          : {}),
      };
    }
    if (type === 2) {
      const thumbnail = bmpFromDib(payload);
      if (thumbnail) return thumbnail;
    }
  }
  return undefined;
}

export function dwgThumbnailBlob(thumbnail: DwgThumbnail): Blob {
  return new Blob([thumbnail.data as BlobPart], { type: thumbnail.mimeType });
}
