/**
 * Browser-safe reader for Revit's `TransmissionData` CFB stream.
 *
 * The stream is one exact uint32 UTF-16LE code-unit count followed by a small
 * XML document. Absolute source-machine paths are deliberately never returned.
 */

const DEFAULT_MAX_CODE_UNITS = 1_000_000;
const DEFAULT_MAX_REFERENCES = 10_000;

export type RevitExternalFileReference = {
  elementId: number;
  uniqueId?: string;
  referenceType: string;
  lastSavedFileName?: string;
  lastSavedPathType?: string;
  lastSavedLoadState?: string;
  desiredFileName?: string;
  desiredPathType?: string;
  desiredLoadState?: string;
  missing: boolean;
};

export type RevitTransmissionData = {
  version: number;
  isTransmitted: boolean;
  references: RevitExternalFileReference[];
  missingReferenceCount: number;
  /** `LastSavedAbsolutePath` is intentionally omitted from every record. */
  privateAbsolutePathsOmitted: true;
};

export type RevitTransmissionDataOptions = {
  maxCodeUnits?: number;
  maxReferences?: number;
};

function textValue(source: string, tag: string): string | undefined {
  const match = source.match(
    new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"),
  );
  if (!match) return undefined;
  const raw = match[1]!;
  if (/[<>]/u.test(raw)) return undefined;
  let invalidEntity = false;
  const decoded = raw.replace(
    /&([^;]+);/gu,
    (_whole, entity: string): string => {
      if (entity === "amp") return "&";
      if (entity === "lt") return "<";
      if (entity === "gt") return ">";
      if (entity === "quot") return '"';
      if (entity === "apos") return "'";
      const decimal = entity.match(/^#([0-9]+)$/u);
      const hexadecimal = entity.match(/^#x([0-9a-f]+)$/iu);
      const codePoint = Number.parseInt(
        decimal?.[1] ?? hexadecimal?.[1] ?? "",
        hexadecimal ? 16 : 10,
      );
      if (
        !Number.isInteger(codePoint) ||
        codePoint < 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        invalidEntity = true;
        return "";
      }
      return String.fromCodePoint(codePoint);
    },
  );
  if (invalidEntity) return undefined;
  const value = decoded.trim();
  return value || undefined;
}

function attribute(source: string, name: string): string | undefined {
  const match = source.match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`, "i"),
  );
  return match?.[1];
}

function fileName(path: string | undefined): string | undefined {
  const value = path?.trim().replace(/[\\/]+$/u, "");
  if (!value) return undefined;
  const result = value.split(/[\\/]/u).at(-1)?.trim();
  return result || undefined;
}

function finiteLimit(
  value: number | undefined,
  fallback: number,
): number | null {
  const result = value ?? fallback;
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

/**
 * Decode the exact length-framed XML payload and retain only bounded,
 * non-sensitive external-reference metadata.
 */
export function parseRevitTransmissionData(
  data: Uint8Array,
  options: RevitTransmissionDataOptions = {},
): RevitTransmissionData | undefined {
  const maxCodeUnits = finiteLimit(
    options.maxCodeUnits,
    DEFAULT_MAX_CODE_UNITS,
  );
  const maxReferences = finiteLimit(
    options.maxReferences,
    DEFAULT_MAX_REFERENCES,
  );
  if (maxCodeUnits == null || maxReferences == null || data.byteLength < 4) {
    return undefined;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const codeUnits = view.getUint32(0, true);
  if (
    codeUnits > maxCodeUnits ||
    codeUnits > Math.floor((Number.MAX_SAFE_INTEGER - 4) / 2) ||
    4 + codeUnits * 2 !== data.byteLength
  ) {
    return undefined;
  }
  let xml: string;
  try {
    xml = new TextDecoder("utf-16le", { fatal: true }).decode(
      data.subarray(4),
    );
  } catch {
    return undefined;
  }
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) return undefined;
  const document = xml
    .trim()
    .replace(/^<\?xml[^?]*\?>\s*/iu, "");
  const root = document.match(
    /^<TransmissionData\b([^>]*)>([\s\S]*)<\/TransmissionData>$/iu,
  );
  if (!root) return undefined;
  const version = Number(attribute(root[1]!, "version"));
  const transmittedText = attribute(root[1]!, "isTransmitted");
  if (
    !Number.isSafeInteger(version) ||
    version < 0 ||
    (transmittedText !== "true" && transmittedText !== "false")
  ) {
    return undefined;
  }

  const blocks = [
    ...root[2]!.matchAll(
      /<ExternalFileReference>([\s\S]*?)<\/ExternalFileReference>/giu,
    ),
  ];
  const residue = root[2]!.replace(
    /<ExternalFileReference>[\s\S]*?<\/ExternalFileReference>/giu,
    "",
  );
  if (blocks.length > maxReferences || residue.trim()) return undefined;

  const references: RevitExternalFileReference[] = [];
  for (const block of blocks) {
    const body = block[1]!;
    const elementIdText = textValue(body, "ElementId");
    const elementId = Number(elementIdText);
    const referenceType = textValue(body, "ExternalFileReferenceType");
    if (
      !Number.isSafeInteger(elementId) ||
      elementId <= 0 ||
      String(elementId) !== elementIdText ||
      !referenceType
    ) {
      return undefined;
    }
    const lastSavedLoadState = textValue(body, "LastSavedLoadState");
    const desiredLoadState = textValue(body, "DesiredLoadState");
    references.push({
      elementId,
      referenceType,
      ...(fileName(textValue(body, "LastSavedPath"))
        ? { lastSavedFileName: fileName(textValue(body, "LastSavedPath")) }
        : {}),
      ...(textValue(body, "LastSavedPathType")
        ? { lastSavedPathType: textValue(body, "LastSavedPathType") }
        : {}),
      ...(lastSavedLoadState ? { lastSavedLoadState } : {}),
      ...(fileName(textValue(body, "DesiredPath"))
        ? { desiredFileName: fileName(textValue(body, "DesiredPath")) }
        : {}),
      ...(textValue(body, "DesiredPathType")
        ? { desiredPathType: textValue(body, "DesiredPathType") }
        : {}),
      ...(desiredLoadState ? { desiredLoadState } : {}),
      missing:
        lastSavedLoadState?.toLocaleLowerCase("en-US") === "not found" &&
        desiredLoadState?.toLocaleLowerCase("en-US") === "loaded",
    });
  }
  return {
    version,
    isTransmitted: transmittedText === "true",
    references,
    missingReferenceCount: references.filter((reference) => reference.missing)
      .length,
    privateAbsolutePathsOmitted: true,
  };
}
