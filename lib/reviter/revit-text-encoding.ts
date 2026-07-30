/** Browser-safe decoding for Revit's UTF and legacy Windows text files. */

export type RevitTextEncoding =
  | "utf-8"
  | "utf-16le"
  | "utf-16be"
  | "windows-1251"
  | "windows-1252";

export type DecodedRevitText = {
  text: string;
  encoding: RevitTextEncoding;
  confidence: "high" | "medium" | "low";
  hadBom: boolean;
};

const BOM: Array<{ bytes: number[]; encoding: RevitTextEncoding }> = [
  { bytes: [0xef, 0xbb, 0xbf], encoding: "utf-8" },
  { bytes: [0xff, 0xfe], encoding: "utf-16le" },
  { bytes: [0xfe, 0xff], encoding: "utf-16be" },
];

function startsWith(data: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => data[index] === value);
}

function decode(data: Uint8Array, encoding: RevitTextEncoding): string {
  return new TextDecoder(encoding).decode(data).replace(/^\uFEFF/, "");
}

function utf16Pattern(data: Uint8Array): RevitTextEncoding | undefined {
  const sample = data.subarray(0, Math.min(data.byteLength, 4_096));
  let evenZeros = 0;
  let oddZeros = 0;
  for (let index = 0; index + 1 < sample.length; index += 2) {
    if (sample[index] === 0) evenZeros += 1;
    if (sample[index + 1] === 0) oddZeros += 1;
  }
  const pairs = Math.max(1, Math.floor(sample.length / 2));
  if (oddZeros / pairs > 0.35 && evenZeros / pairs < 0.1) return "utf-16le";
  if (evenZeros / pairs > 0.35 && oddZeros / pairs < 0.1) return "utf-16be";
  return undefined;
}

function legacyEncoding(data: Uint8Array): "windows-1251" | "windows-1252" {
  const cyrillic = decode(data, "windows-1251");
  const latin = decode(data, "windows-1252");
  const cyrillicLetters = cyrillic.match(/[\u0400-\u04ff]/g)?.length ?? 0;
  const cyrillicWord = /[\u0400-\u04ff]{3,}/.test(cyrillic);
  const latinMojibake = /[ÃÂ][\u0080-\u00ff]/.test(latin);
  return cyrillicLetters >= 3 && cyrillicWord && !latinMojibake
    ? "windows-1251"
    : "windows-1252";
}

export function decodeRevitTextBytes(data: Uint8Array): DecodedRevitText {
  for (const candidate of BOM) {
    if (startsWith(data, candidate.bytes)) {
      return {
        text: decode(data.subarray(candidate.bytes.length), candidate.encoding),
        encoding: candidate.encoding,
        confidence: "high",
        hadBom: true,
      };
    }
  }

  const patterned = utf16Pattern(data);
  if (patterned) {
    return {
      text: decode(data, patterned),
      encoding: patterned,
      confidence: "high",
      hadBom: false,
    };
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    return { text, encoding: "utf-8", confidence: "high", hadBom: false };
  } catch {
    const encoding = legacyEncoding(data);
    return {
      text: decode(data, encoding),
      encoding,
      confidence: "medium",
      hadBom: false,
    };
  }
}
