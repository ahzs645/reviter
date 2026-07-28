/**
 * Browser-safe inspection of shared tag references in `Formats/Latest`.
 *
 * The signed int16 consumed by the outer object reader is a class-table slot.
 * A similarly shaped low-bit word follows some schema class names. Its exact
 * role is not established by the available format module, so this module uses
 * the neutral term `tagReference`. `GPolyMesh`, `GBRep`, and `GFakeBRep` all
 * carry reference 1426, but that does not make 1426 their object selector.
 */

const MAX_CLASS_NAME_BYTES = 96;
const MAX_CLASS_VERSION = 10_000;
const MAX_CLASS_FIELDS = 4_096;
const MAX_FIELD_NAME_BYTES = 256;

export type SchemaTagDefinition = {
  name: string;
  offset: number;
  rawWord: number;
  tag: number;
};

export type SchemaTagReferenceRecord = {
  name: string;
  offset: number;
  rawWord: number;
  tagReference: number;
  version: number;
  fieldCount: number;
  firstFieldName?: string;
};

export type SchemaTagReferenceInspection = {
  tagReference: number;
  taggedDefinitions: SchemaTagDefinition[];
  referenceRecords: SchemaTagReferenceRecord[];
  status:
    | "missing"
    | "definition-only"
    | "unique-reference"
    | "shared-reference";
};

export type SchemaReferenceRecordSelection =
  | {
      ok: true;
      record: SchemaTagReferenceRecord;
      selectedBy: "only-reference" | "expected-name";
    }
  | { ok: false; error: string; candidates: string[] };

function rangeFits(data: Uint8Array, offset: number, byteLength: number): boolean {
  return (
    Number.isSafeInteger(offset) &&
    offset >= 0 &&
    Number.isSafeInteger(byteLength) &&
    byteLength >= 0 &&
    offset <= data.byteLength - byteLength
  );
}

function readAscii(
  data: Uint8Array,
  offset: number,
  byteLength: number,
): string | null {
  if (!rangeFits(data, offset, byteLength)) return null;
  for (let index = offset; index < offset + byteLength; index += 1) {
    const byte = data[index]!;
    if (byte < 0x20 || byte > 0x7e) return null;
  }
  return new TextDecoder("ascii").decode(data.subarray(offset, offset + byteLength));
}

function isClassName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9_:<>]*$/.test(name);
}

function readClassName16(
  data: Uint8Array,
  view: DataView,
  offset: number,
): { name: string; endOffset: number } | null {
  if (!rangeFits(data, offset, 2)) return null;
  const byteLength = view.getUint16(offset, true);
  if (byteLength < 1 || byteLength > MAX_CLASS_NAME_BYTES) return null;
  const name = readAscii(data, offset + 2, byteLength);
  if (name == null || !isClassName(name)) return null;
  return { name, endOffset: offset + 2 + byteLength };
}

function readFirstFieldName(
  data: Uint8Array,
  view: DataView,
  offset: number,
): string | null {
  if (!rangeFits(data, offset, 4)) return null;
  const byteLength = view.getUint32(offset, true);
  if (byteLength < 1 || byteLength > MAX_FIELD_NAME_BYTES) return null;
  const name = readAscii(data, offset + 4, byteLength);
  if (name == null || !/^[A-Za-z_][A-Za-z0-9_:<>]*$/.test(name)) return null;
  return name;
}

/**
 * Find a high-bit tag definition and all structurally valid class headers
 * carrying the corresponding low-bit reference.
 *
 * A low-bit hit is accepted only when it is followed by a bounded
 * `[version:u32, fieldCount:u32]` pair and, for non-empty classes, a valid
 * first `[nameLength:u32, ASCII name]` field header. These checks exclude raw
 * two-byte coincidences without pretending to decode every property
 * descriptor.
 */
export function inspectSchemaTagReference(
  data: Uint8Array,
  tagReference: number,
): SchemaTagReferenceInspection {
  if (
    !Number.isSafeInteger(tagReference) ||
    tagReference < 0 ||
    tagReference > 0x7fff
  ) {
    throw new RangeError("tagReference must be an unsigned 15-bit integer");
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const definitionWord = tagReference | 0x8000;
  const taggedDefinitions: SchemaTagDefinition[] = [];
  const referenceRecords: SchemaTagReferenceRecord[] = [];

  for (let offset = 0; offset + 4 <= data.byteLength; offset += 1) {
    const named = readClassName16(data, view, offset);
    if (!named || !rangeFits(data, named.endOffset, 2)) continue;
    const rawWord = view.getUint16(named.endOffset, true);

    if (rawWord === definitionWord) {
      taggedDefinitions.push({
        name: named.name,
        offset,
        rawWord,
        tag: tagReference,
      });
      continue;
    }
    if (
      rawWord !== tagReference ||
      !rangeFits(data, named.endOffset + 2, 8)
    ) {
      continue;
    }

    const version = view.getUint32(named.endOffset + 2, true);
    const fieldCount = view.getUint32(named.endOffset + 6, true);
    if (version > MAX_CLASS_VERSION || fieldCount > MAX_CLASS_FIELDS) continue;

    let firstFieldName: string | undefined;
    if (fieldCount > 0) {
      const fieldName = readFirstFieldName(data, view, named.endOffset + 10);
      if (fieldName == null) continue;
      firstFieldName = fieldName;
    }
    referenceRecords.push({
      name: named.name,
      offset,
      rawWord,
      tagReference,
      version,
      fieldCount,
      firstFieldName,
    });
  }

  const status =
    referenceRecords.length > 1
      ? "shared-reference"
      : referenceRecords.length === 1
        ? "unique-reference"
        : taggedDefinitions.length
          ? "definition-only"
          : "missing";
  return { tagReference, taggedDefinitions, referenceRecords, status };
}

/**
 * Locate a schema reference record by independently known class name. This is
 * a schema lookup only; it does not resolve a partition object selector.
 */
export function selectSchemaReferenceRecord(
  inspection: SchemaTagReferenceInspection,
  expectedName?: string,
): SchemaReferenceRecordSelection {
  if (expectedName != null) {
    const matches = inspection.referenceRecords.filter(
      (record) => record.name === expectedName,
    );
    if (matches.length === 1) {
      return {
        ok: true,
        record: matches[0]!,
        selectedBy: "expected-name",
      };
    }
    return {
      ok: false,
      error:
        matches.length === 0
          ? `tag reference ${inspection.tagReference} has no record named ${expectedName}`
          : `tag reference ${inspection.tagReference} has duplicate records named ${expectedName}`,
      candidates: inspection.referenceRecords.map((record) => record.name),
    };
  }

  if (inspection.referenceRecords.length === 1) {
    return {
      ok: true,
      record: inspection.referenceRecords[0]!,
      selectedBy: "only-reference",
    };
  }
  return {
    ok: false,
    error:
      inspection.referenceRecords.length === 0
        ? `tag reference ${inspection.tagReference} has no class record`
        : `tag reference ${inspection.tagReference} is shared by several class records`,
    candidates: inspection.referenceRecords.map((record) => record.name),
  };
}
