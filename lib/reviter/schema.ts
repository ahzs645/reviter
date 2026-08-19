/**
 * The serialization schema Revit embeds in every file.
 *
 * `Formats/Latest` is Autodesk's own dictionary for the on-disk object graph:
 * roughly half a megabyte of class names, inheritance, and field declarations.
 * A class that is serializable at the top level is written as
 *
 * ```text
 * [u16 nameLen] [name] [u16 tag | 0x8000] [u16 pad]
 * [u16 parentLen] [parent name]
 * [u16 flag] [u32 version] [u32 declared field count]
 * ```
 *
 * and the tag is what identifies the class in `Partitions/NN` records.
 *
 * `NN` is a save counter, not a type code: it is the document-increment index
 * the partition was written at, one less than `BasicFileInfo`'s "Unique
 * Document Increments". The supplied 2027 project is `Partitions/325` and
 * reports 326 increments; the same holds on all 28 Revit 2026 templates ODA
 * ships. Nothing should be read from the number itself.
 *
 * The parent name is what makes the record trustworthy. A name-and-tag pattern
 * alone also matches compressed noise — scanning for it loosely over the
 * supplied 2027 project yields 232 candidates, 48 of which are mangled strings
 * such as `Cuuuuuuuaaaas` and `HostTrfCreatDr`, including one name carrying four
 * different tags. Requiring a well-formed parent-class name to begin exactly
 * four bytes after the class name removes every one of those without losing a
 * single corroborated class.
 *
 * Corroboration: across the Revit 2020, 2023, and 2026 family files this parser
 * reproduces all 218 checkable class-to-tag pairs in the independently produced
 * tag-drift dataset published by the Apache-2.0 `rvt-rs` project, with no
 * disagreements, both before and after the parent-name filter.
 *
 * The field *list* is deliberately not walked. The declared field count is read
 * because it sits at a fixed offset, but the field records that follow contain
 * inline class definitions whose layout does not close cleanly across the
 * corpus — several framings fit the observed bytes and each leaves a variable
 * unexplained remainder. `rvt-rs` reports the same gap as field-count
 * mismatches. A field graph that is probably wrong would be worse than none.
 */

/** Class names are C++ identifiers, including templates such as `std::pair<>`. */
const CLASS_NAME = /^[A-Za-z_][A-Za-z0-9_:<>, ()[\]*&~]*$/;

const MIN_NAME_LENGTH = 3;
const MAX_NAME_LENGTH = 80;

/** Bytes between the end of a class name and the start of its parent's name. */
const PARENT_NAME_GAP = 4;

/** Declared field counts above this are noise rather than a real preamble. */
const MAX_DECLARED_FIELDS = 500;

export type SchemaClass = {
  name: string;
  /** Serialization tag with the definition bit stripped. */
  tag: number;
  /** Immediate base class, e.g. `ArcWall` → `VWall`, `HostObjAttr` → `Symbol`. */
  parent: string;
  /** Schema version of this class, incremented as Autodesk changes it. */
  version?: number;
  /** Field count the record declares. The fields themselves are not walked. */
  declaredFieldCount?: number;
  /** Byte offset of the record inside the inflated schema stream. */
  offset: number;
};

/**
 * A class named in the schema that has no definition record of its own.
 *
 * The `u16` after the name references one of the tags this file *does* define.
 * What the reference means is not established — it is not the nearest preceding
 * definition (472 of 504 differ, so it is not a proximity artefact), and it may
 * be an ancestor, a mixin, or a protocol. It is reported as a reference and
 * nothing stronger. Requiring it to match a known tag is what keeps these
 * clean: matching 1 of 184 specific values out of 65,536 by chance predicts
 * about six false entries across the whole stream.
 */
export type SchemaReference = {
  name: string;
  /** Tag referenced by this name; resolves to one of `taggedClasses`. */
  tagReference: number;
  offset: number;
};

export type SchemaSummary = {
  /** Inflated size of `Formats/Latest`. */
  byteLength: number;
  /** Classes that carry a top-level serialization tag and a parent record. */
  taggedClasses: SchemaClass[];
  /** Classes named without a definition record, referencing a defined tag. */
  referencedClasses: SchemaReference[];
  /** Name-and-tag matches rejected for having no well-formed parent record. */
  rejectedCandidates: number;
};

type NameCandidate = { offset: number; name: string; word: number; end: number };

function isAscii(data: Uint8Array, start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    const byte = data[index]!;
    if (byte < 0x20 || byte > 0x7e) return false;
  }
  return true;
}

/** Every position that reads as `[u16 len][ASCII class name][u16 word]`. */
function nameCandidates(data: Uint8Array, view: DataView): NameCandidate[] {
  const candidates: NameCandidate[] = [];
  const decoder = new TextDecoder("ascii");
  for (let offset = 0; offset + 4 <= data.byteLength; ) {
    const nameLength = view.getUint16(offset, true);
    if (
      nameLength < MIN_NAME_LENGTH ||
      nameLength > MAX_NAME_LENGTH ||
      offset + 2 + nameLength + 2 > data.byteLength ||
      !isAscii(data, offset + 2, offset + 2 + nameLength)
    ) {
      offset += 1;
      continue;
    }
    const name = decoder.decode(data.subarray(offset + 2, offset + 2 + nameLength));
    if (!CLASS_NAME.test(name)) {
      offset += 1;
      continue;
    }
    const end = offset + 2 + nameLength;
    candidates.push({ offset, name, word: view.getUint16(end, true), end });
    offset = end;
  }
  return candidates;
}

/**
 * Inventory every top-level serializable class. A candidate is accepted only
 * when a well-formed parent-class name begins exactly `PARENT_NAME_GAP` bytes
 * after it, which is what separates real records from compressed noise.
 */
function parseSchemaTags(data: Uint8Array): SchemaClass[] {
  const classes: SchemaClass[] = [];
  if (data.byteLength < 8) return classes;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const candidates = nameCandidates(data, view);
  const seen = new Set<string>();

  for (let index = 0; index < candidates.length - 1; index += 1) {
    const candidate = candidates[index]!;
    if (!(candidate.word & 0x8000)) continue;
    const parent = candidates[index + 1]!;
    if (parent.offset !== candidate.end + PARENT_NAME_GAP) continue;
    if (seen.has(candidate.name)) continue;

    let version: number | undefined;
    let declaredFieldCount: number | undefined;
    if (parent.end + 10 <= data.byteLength) {
      const declared = view.getUint32(parent.end + 6, true);
      if (declared <= MAX_DECLARED_FIELDS) {
        version = view.getUint32(parent.end + 2, true);
        declaredFieldCount = declared;
      }
    }

    seen.add(candidate.name);
    classes.push({
      name: candidate.name,
      tag: candidate.word & 0x7fff,
      parent: parent.name,
      version,
      declaredFieldCount,
      offset: candidate.offset,
    });
  }
  return classes;
}

export function summariseSchema(data: Uint8Array): SchemaSummary {
  if (data.byteLength < 8) {
    return {
      byteLength: data.byteLength,
      taggedClasses: [],
      referencedClasses: [],
      rejectedCandidates: 0,
    };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const candidates = nameCandidates(data, view);
  const tagged = candidates.filter((candidate) => candidate.word & 0x8000).length;
  const taggedClasses = parseSchemaTags(data).sort((a, b) => a.tag - b.tag);

  const definedTags = new Set(taggedClasses.map((entry) => entry.tag));
  const definedNames = new Set(taggedClasses.map((entry) => entry.name));
  const referencedClasses: SchemaReference[] = [];
  const seenReferences = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.word & 0x8000) continue;
    if (definedNames.has(candidate.name) || seenReferences.has(candidate.name)) continue;
    if (!definedTags.has(candidate.word)) continue;
    seenReferences.add(candidate.name);
    referencedClasses.push({
      name: candidate.name,
      tagReference: candidate.word,
      offset: candidate.offset,
    });
  }

  return {
    byteLength: data.byteLength,
    taggedClasses,
    referencedClasses: referencedClasses.sort((a, b) => a.name.localeCompare(b.name)),
    rejectedCandidates: Math.max(0, tagged - taggedClasses.length),
  };
}
