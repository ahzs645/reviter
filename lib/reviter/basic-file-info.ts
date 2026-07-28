/**
 * The Revit release stored in the uncompressed `BasicFileInfo` CFB stream.
 *
 * Reviter's browser UI already reads this through `@phi-ag/rvt`, but the
 * reusable converter accepts bytes directly. Keeping the tiny release read in
 * the core means `convertRvtBytes(bytes)` can select its release-gated decoder
 * without making every caller parse the container a second way first.
 */

const UTF16 = new TextDecoder("utf-16le");
const MIN_REVIT_VERSION = 2000;
const MAX_REVIT_VERSION = 2099;

function release(value: string): number | null {
  const match = value.match(/\b(20\d{2})\b/);
  if (!match) return null;
  const version = Number(match[1]);
  return version >= MIN_REVIT_VERSION && version <= MAX_REVIT_VERSION ? version : null;
}

/**
 * Parse the Revit release from a `BasicFileInfo` stream.
 *
 * Legacy file-info versions 6–10 store a length-prefixed application string
 * beginning at byte 14. Versions 13 and 14 introduce the release with the
 * four-byte marker `04 00 00 00`, followed by four UTF-16LE characters.
 */
export function revitVersionFromBasicFileInfo(data: Uint8Array): number | null {
  if (data.byteLength < 18) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fileInfoVersion = view.getUint32(0, true);

  if (fileInfoVersion >= 6 && fileInfoVersion <= 10) {
    const characters = view.getInt32(14, true);
    if (characters <= 0 || characters > (data.byteLength - 18) / 2) return null;
    return release(UTF16.decode(data.subarray(18, 18 + characters * 2)));
  }

  if (fileInfoVersion !== 13 && fileInfoVersion !== 14) return null;
  for (let offset = 4; offset + 12 <= data.byteLength; offset += 1) {
    if (
      data[offset] !== 0x04 ||
      data[offset + 1] !== 0 ||
      data[offset + 2] !== 0 ||
      data[offset + 3] !== 0
    ) continue;
    const version = release(UTF16.decode(data.subarray(offset + 4, offset + 12)));
    if (version != null) return version;
  }
  return null;
}
