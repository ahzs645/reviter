/** Persisted DWG file names found inside inflated Revit partition records. */

const DWG_FILE_NAME =
  /[A-Za-z\u0400-\u04ff0-9][A-Za-z\u0400-\u04ff0-9 _.,()&+\/'\-]{0,180}\.dwg/giu;

export type PersistedCadFileName = {
  fileName: string;
  occurrences: number;
  evidence: "partition-utf16-file-name";
  /** Revit retained the name, but the original DWG byte stream was not found. */
  rawDwgPayloadAvailable: false;
};

/**
 * Read bounded UTF-16 file-name fields without treating arbitrary RVT text as
 * an extractable DWG. Imported CAD geometry can survive after the source file
 * itself is gone; this scanner reports that distinction explicitly.
 */
export function scanPersistedDwgFileNames(data: Uint8Array): string[] {
  if (!data.byteLength) return [];
  let hasDwgSuffix = false;
  for (let offset = 0; offset + 8 <= data.byteLength; offset += 2) {
    if (
      data[offset] === 0x2e && data[offset + 1] === 0 &&
      (data[offset + 2] === 0x44 || data[offset + 2] === 0x64) && data[offset + 3] === 0 &&
      (data[offset + 4] === 0x57 || data[offset + 4] === 0x77) && data[offset + 5] === 0 &&
      (data[offset + 6] === 0x47 || data[offset + 6] === 0x67) && data[offset + 7] === 0
    ) {
      hasDwgSuffix = true;
      break;
    }
  }
  if (!hasDwgSuffix) return [];
  const text = new TextDecoder("utf-16le").decode(data);
  const names = new Map<string, string>();
  for (const match of text.matchAll(DWG_FILE_NAME)) {
    const fileName = match[0].trim();
    if (fileName.length <= 4) continue;
    const key = fileName.toLocaleLowerCase("en-US");
    if (!names.has(key)) names.set(key, fileName);
  }
  return [...names.values()];
}

export function persistedCadFileNames(
  occurrences: ReadonlyMap<string, { fileName: string; occurrences: number }>,
): PersistedCadFileName[] {
  return [...occurrences.values()]
    .map(({ fileName, occurrences }) => ({
      fileName,
      occurrences,
      evidence: "partition-utf16-file-name" as const,
      rawDwgPayloadAvailable: false as const,
    }))
    .sort((left, right) => left.fileName.localeCompare(right.fileName, "en"));
}
