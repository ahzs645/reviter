/**
 * The serialization schema Revit embeds in every file.
 *
 * `Formats/Latest` is Autodesk's own dictionary for the on-disk object graph:
 * roughly half a megabyte of class names, inheritance, and field declarations.
 * A class that is serializable at the top level carries a `u16` tag with the
 * `0x8000` bit set immediately after its name, and that tag is what identifies
 * the class in `Partitions/NN` records.
 *
 * ```text
 * [u16 nameLen] [nameLen bytes ASCII class name] [u16 tag | 0x8000]
 * ```
 *
 * Only that inventory is decoded here. The rest of a class record — parent
 * class, field list, and the inline definitions nested inside fields — is
 * genuinely ambiguous to walk from the outside: several layouts fit the
 * observed bytes and none of them close cleanly across the corpus. Reporting a
 * field graph that is probably wrong would be worse than reporting none, so the
 * parser stops at what the bytes prove.
 *
 * The tag inventory itself is verified. Across the Revit 2020, 2023, and 2026
 * family files it reproduces all 218 checkable class-to-tag pairs in the
 * independently produced tag-drift dataset published by the Apache-2.0 `rvt-rs`
 * project, with no disagreements.
 */

/** Class names are C++ identifiers, including templates such as `std::pair<>`. */
const CLASS_NAME = /^[A-Za-z_][A-Za-z0-9_:<>, ()[\]*&]*$/;

const MIN_NAME_LENGTH = 3;
const MAX_NAME_LENGTH = 80;

export type SchemaClass = {
  name: string;
  /** Serialization tag with the definition bit stripped. */
  tag: number;
  /** Byte offset of the record inside the inflated schema stream. */
  offset: number;
};

export type SchemaSummary = {
  /** Inflated size of `Formats/Latest`. */
  byteLength: number;
  /** Classes that carry a top-level serialization tag. */
  taggedClasses: SchemaClass[];
};

function isAscii(bytes: Uint8Array): boolean {
  for (const byte of bytes) if (byte < 0x20 || byte > 0x7e) return false;
  return true;
}

/**
 * Inventory every top-level serializable class in an inflated `Formats/Latest`
 * stream. The first declaration of a name wins; later repeats are references.
 */
export function parseSchemaTags(data: Uint8Array): SchemaClass[] {
  const classes: SchemaClass[] = [];
  const seen = new Set<string>();
  if (data.byteLength < 8) return classes;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder("ascii");

  for (let offset = 0; offset + 4 <= data.byteLength; ) {
    const nameLength = view.getUint16(offset, true);
    if (
      nameLength < MIN_NAME_LENGTH ||
      nameLength > MAX_NAME_LENGTH ||
      offset + 2 + nameLength + 2 > data.byteLength
    ) {
      offset += 1;
      continue;
    }
    const nameBytes = data.subarray(offset + 2, offset + 2 + nameLength);
    if (!isAscii(nameBytes)) {
      offset += 1;
      continue;
    }
    const name = decoder.decode(nameBytes);
    if (!CLASS_NAME.test(name)) {
      offset += 1;
      continue;
    }
    const tag = view.getUint16(offset + 2 + nameLength, true);
    if (!(tag & 0x8000)) {
      offset += 1;
      continue;
    }
    if (!seen.has(name)) {
      seen.add(name);
      classes.push({ name, tag: tag & 0x7fff, offset });
    }
    offset += 2 + nameLength + 2;
  }
  return classes;
}

export function summariseSchema(data: Uint8Array): SchemaSummary {
  return {
    byteLength: data.byteLength,
    taggedClasses: parseSchemaTags(data).sort((a, b) => a.tag - b.tag),
  };
}
