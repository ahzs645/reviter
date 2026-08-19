/**
 * A strict, browser-safe reader for `Formats/Latest`, the serialization schema
 * Revit embeds in every file.
 *
 * `schema.ts` inventories the same stream by scanning for records that look
 * right, and deliberately stops at the declared field count: no framing it
 * tried closed cleanly across the corpus, and a field graph that is probably
 * wrong would be worse than none. This module is the missing framing. It is a
 * recursive descent over the grammar ODA's `TB_Loader` reader implements, and
 * it either tiles the whole stream or reports the offset where it stopped —
 * there is no scanning, no name pattern, no ASCII test, and no length guess
 * anywhere in it.
 *
 * ```text
 * stream   := ClassDef* then eight zero bytes
 * ClassDef := i16 unknown, u16 nameLen, name, TypeRef parent, i32 version,
 *             i32 propertyCount, Property[propertyCount],
 *             i32 guidCount, u8[16 * guidCount]
 * TypeRef  := u16 word — 0 is no type; the 0x8000 bit means a ClassDef follows
 *             inline and the low fifteen bits carry the index it is given;
 *             any other value references an already-defined class index
 * Property := i32 nameLen, name, i8 fieldType, i8 modes, i16 unknown,
 *             [i32 size] when itemMode is 1, and when loadingMode is 0 either
 *             a nested Property (fieldType 0x0d) or a TypeRef (fieldType 0x0e,
 *             followed by one i16 when the property's name is a single space)
 * ```
 *
 * `modes` packs two fields: `loadingMode` is its low nibble and `itemMode` its
 * arithmetically shifted high nibble.
 *
 * Four independent measurements say this is the file's own framing rather than
 * one that merely fits:
 *
 * - **It tiles.** The 2027 project's schema is 513,948 bytes and the walk
 *   consumes 513,940 of them, leaving exactly the eight zero bytes that close
 *   the stream; the 2014 family's is 367,595 and the walk consumes 367,587.
 *   A wrong framing does not land on the last byte of half a megabyte of
 *   variable-length records twice.
 * - **The indices check themselves.** Indices are handed out in creation order
 *   from {@link INITIAL_SCHEMA_CLASS_INDEX}, and every inline definition also
 *   carries its index in the low fifteen bits of the word that introduced it.
 *   The predicted and the carried index agree for all 1,110 inline definitions
 *   in the 2027 stream and all 817 in the 2014 one.
 * - **The references close.** All 6,587 plain back-references in the 2027
 *   stream and all 5,031 in the 2014 one name a class the walk had already
 *   created. None points past the end, which is what a drifting cursor
 *   produces.
 * - **It reproduces measurements taken elsewhere in this repository.**
 *   `GElement` comes out at `0x08c6`, the object marker `element-objects.ts`
 *   measured from `Partitions/*` records rather than from the schema; `Level`
 *   comes out at `0x0a19`, which is `REVIT_2027_LEVEL_MARKER` in
 *   `level-relations.ts`. And the `FacetedTopology0` fixture in
 *   `tests/schema-fields.test.ts`, whose descriptor reader was derived
 *   separately from geometry, is reproduced field for field: its `[1:u32][0x20]`
 *   "argument count" is this grammar's nested tuple element, a property whose
 *   name is the single space that the extra-word rule above is about.
 *
 * A class is registered before the parent it defines inline, so an inline
 * parent's index is exactly one above its child's. That is load-bearing and it
 * is the reading `schema.ts` documents at length: the word beside `GElement` is
 * `0x08c7` and belongs to its parent.
 *
 * What this reader does not establish: the meaning of the two words it reads
 * and reports without interpreting (`unknownWord` on classes, always zero in
 * both files, and on properties, non-zero in 340 of the 2027 stream's records,
 * so not padding); the byte order of the GUIDs, which are reported as raw file
 * order; and the loading modes above zero, which suppress the nested read and
 * are otherwise opaque here.
 */

/**
 * First index the native container hands out (`kInitialIndex`). Lower indices
 * belong to the reader's own built-in types and never carry a definition.
 */
export const INITIAL_SCHEMA_CLASS_INDEX = 12;

/** Zero bytes that close the stream after the last class definition. */
const TERMINATOR_BYTES = 8;

/**
 * Deepest chain of nested definitions and tuple elements accepted.
 *
 * The deepest chain in either real stream is six, so this is not a limit the
 * corpus approaches; it is what stops a hostile file whose every type reference
 * opens another inline definition from recursing until the stack gives out.
 */
const MAX_NESTING_DEPTH = 64;

/** Class definitions one stream may declare. The 2027 project declares 4,757. */
const MAX_CLASSES = 1 << 18;

/**
 * Property records one stream may declare, nested tuple elements included. The
 * 2027 project declares 13,080 and nests 80 more inside them.
 */
const MAX_PROPERTIES = 1 << 21;

/**
 * Smallest property record the grammar can produce: a zero-length name behind
 * its `i32` length, the field type, the modes byte and the unknown word. A
 * declared count above what the remaining bytes can hold is refused before the
 * loop rather than discovered inside it.
 */
const MIN_PROPERTY_BYTES = 8;

const GUID_BYTES = 16;

/** `fieldType` of a nested tuple element, whose descriptor is a Property. */
const FIELD_TYPE_TUPLE = 0x0d;

/** `fieldType` of a complex member, whose type follows as a TypeRef. */
const FIELD_TYPE_OBJECT = 0x0e;

/** The name an object-typed property carries an extra `i16` after. */
const SPACE_NAME = " ";

export type SchemaFieldVariantKind =
  | "bool"
  | "int8"
  | "int16"
  | "int32"
  | "int64"
  | "float"
  | "double"
  | "string"
  | "guid"
  | "tuple"
  | "object";

export type SchemaFieldVariant = {
  readonly kind: SchemaFieldVariantKind;
  /**
   * Width one value occupies in an instance record. Absent for the three forms
   * that have no fixed width: a string is `[i32 charCount][UTF-16LE]`, a tuple
   * is described by its element property, and an object is described by its
   * type reference.
   */
  readonly byteLength?: number;
};

/**
 * The variant each `fieldType` selects.
 *
 * `0x00` and `0x0c` are absent because the native reader treats them as
 * invalid, and a record that carries one is a desync rather than a member this
 * table is missing. Neither value occurs in either real stream; between them
 * the two streams use every other code in the table except `0x0b`, which only
 * the 2027 one uses.
 *
 * One entry disagrees with the description this grammar was handed. `0x06` is
 * given there as a second spelling of `double`, eight bytes wide, but this
 * repository already reads it as a four-byte float and does so against real
 * geometry: `schema-fields.ts` decodes the `m_pointsArr` of a class literally
 * named `FloatFacetedTopology` — element type `0x06`, tuple width 3 — with
 * `getFloat32`, and the meshes come out at the right coordinates. The width is
 * not observable from the schema stream itself, so the reader that consumes
 * instances is taken as the authority and `0x06` is reported as `float`.
 */
const FIELD_VARIANTS = new Map<number, SchemaFieldVariant>([
  [0x01, { kind: "bool", byteLength: 1 }],
  [0x02, { kind: "int8", byteLength: 1 }],
  [0x03, { kind: "int16", byteLength: 2 }],
  [0x04, { kind: "int32", byteLength: 4 }],
  [0x05, { kind: "int32", byteLength: 4 }],
  [0x06, { kind: "float", byteLength: 4 }],
  [0x07, { kind: "double", byteLength: 8 }],
  [0x08, { kind: "string" }],
  [0x09, { kind: "guid", byteLength: 16 }],
  [0x0a, { kind: "int16", byteLength: 2 }],
  [0x0b, { kind: "int64", byteLength: 8 }],
  [FIELD_TYPE_TUPLE, { kind: "tuple" }],
  [FIELD_TYPE_OBJECT, { kind: "object" }],
]);

/** The variant a `fieldType` selects, or `undefined` when it selects none. */
export function schemaFieldVariant(fieldType: number): SchemaFieldVariant | undefined {
  return FIELD_VARIANTS.get(fieldType);
}

/**
 * What a type-reference word named.
 *
 * - `none` — the word was zero and no type was named.
 * - `inline` — a definition followed the word. `declaredIndex` is the index the
 *   word itself carries, and `index` is the one the walk assigned; they agree
 *   throughout both real streams and are reported separately so that a file
 *   where they disagree says so instead of being averaged into one number.
 * - `reference` — the word named a class the walk had already created.
 * - `unresolved` — the word named no such class. Reported, never repaired.
 */
export type SchemaStreamTypeRef =
  | { kind: "none" }
  | { kind: "inline"; index: number; name: string; declaredIndex: number }
  | { kind: "reference"; index: number; name: string }
  | { kind: "unresolved"; index: number };

export type SchemaStreamProperty = {
  name: string;
  /** Raw field-type byte; {@link schemaFieldVariant} is the same value read. */
  fieldType: number;
  /** Shared table entry for `fieldType`, not a per-property allocation. */
  variant: SchemaFieldVariant;
  /** Low nibble of the modes byte. Above zero it suppresses the nested read. */
  loadingMode: number;
  /** High nibble of the modes byte, arithmetically shifted. */
  itemMode: number;
  /** A word the native reader discards; non-zero often enough not to be padding. */
  unknownWord: number;
  /**
   * The `i32` an `itemMode` of 1 carries. `schema-fields.ts` reads this same
   * word as a fixed tuple width, and the values here are consistent with that:
   * 3 and 2 dominate, and nothing exceeds 24.
   */
  size?: number;
  /**
   * Element descriptor of a tuple: `fieldType` `0x0d` at loading mode 0. The
   * other loading modes carry no descriptor, so this is absent there.
   */
  element?: SchemaStreamProperty;
  /**
   * Declared type of a complex member: `fieldType` `0x0e` at loading mode 0.
   * The 1,428 object properties in the 2027 stream that load some other way
   * name no type here, which is the file's shape and not a read that failed.
   */
  staticType?: SchemaStreamTypeRef;
  /**
   * The extra `i16` that follows the type of an object-typed property whose
   * name is a single space. Four such properties exist in each real stream and
   * all eight carry the value 20; what it selects is not established.
   */
  spaceNameWord?: number;
  offset: number;
};

export type SchemaStreamClass = {
  /** Index the container gives this class, in creation order from index 12. */
  index: number;
  name: string;
  parent: SchemaStreamTypeRef;
  version: number;
  /** Count the record declares; always the length of `properties`. */
  propertyCount: number;
  properties: SchemaStreamProperty[];
  /** Trailing GUIDs as lowercase hex, in file byte order. */
  guids: string[];
  /** A word the native reader discards. Zero throughout both real streams. */
  unknownWord: number;
  /** Whether this definition was written inside a type reference. */
  inline: boolean;
  offset: number;
  endOffset: number;
};

/** A word that named a class index no definition ever claimed. */
export type SchemaStreamUnresolvedReference = {
  offset: number;
  index: number;
  /** Classes that existed when the word was read, which is what bounds it. */
  definedClassCount: number;
};

/** An inline definition whose carried index differs from its assigned one. */
export type SchemaStreamIndexMismatch = {
  /** Offset of the word that introduced the definition. */
  offset: number;
  index: number;
  declaredIndex: number;
};

export type SchemaStream = {
  byteLength: number;
  /** Bytes of class definitions: everything before the zero terminator. */
  consumedBytes: number;
  /** Length of the terminator that closed the stream. Always eight. */
  terminatorBytes: number;
  /** Bytes past the terminator, which the grammar does not account for. */
  trailingBytes: number;
  /** Every definition in creation order; `classes[n].index` is `12 + n`. */
  classes: SchemaStreamClass[];
  classesByIndex: Map<number, SchemaStreamClass>;
  /** Definitions written at the top level rather than inside a type reference. */
  topLevelClassCount: number;
  /** Property records the classes declare. Nested tuple elements are excluded. */
  propertyCount: number;
  unresolvedReferences: SchemaStreamUnresolvedReference[];
  inlineIndexMismatches: SchemaStreamIndexMismatch[];
};

export type SchemaStreamResult =
  | { ok: true; schema: SchemaStream }
  | {
      ok: false;
      error: string;
      /** Byte offset the walk stopped at. */
      offset: number;
      /** Definitions read before the stop, reported as a count only: a stream
       * that did not tile is evidence about the stream, not a partial schema to
       * be used. */
      classesRead: number;
      propertiesRead: number;
    };

export type SchemaReadOptions = {
  /**
   * Version of the containing format. The native reader writes the trailing
   * GUID table only above version 2, which covers every file Revit 2014 and
   * later writes — both real streams carry it. The number is not in the stream,
   * so it cannot be recovered from the bytes; a caller reading an older file
   * has to say so.
   */
  streamVersion?: number;
};

/** Thrown by the walk and converted to a structured failure by `readSchema`. */
class SchemaReadStop extends Error {
  readonly at: number;

  constructor(message: string, at: number) {
    super(message);
    this.name = "SchemaReadStop";
    this.at = at;
  }
}

type Reader = {
  data: Uint8Array;
  view: DataView;
  offset: number;
  streamVersion: number;
  classes: SchemaStreamClass[];
  /** Resolved references, held so their target names can be filled in later. */
  references: Extract<SchemaStreamTypeRef, { kind: "reference" }>[];
  unresolved: SchemaStreamUnresolvedReference[];
  mismatches: SchemaStreamIndexMismatch[];
  declaredProperties: number;
  readProperties: number;
};

/** Claim `byteLength` bytes and return where they start, or stop the walk. */
function take(reader: Reader, byteLength: number, what: string): number {
  const at = reader.offset;
  if (byteLength < 0 || byteLength > reader.data.byteLength - at) {
    throw new SchemaReadStop(`truncated ${what}`, at);
  }
  reader.offset = at + byteLength;
  return at;
}

function readInt8(reader: Reader, what: string): number {
  return reader.view.getInt8(take(reader, 1, what));
}

function readInt16(reader: Reader, what: string): number {
  return reader.view.getInt16(take(reader, 2, what), true);
}

function readUint16(reader: Reader, what: string): number {
  return reader.view.getUint16(take(reader, 2, what), true);
}

function readInt32(reader: Reader, what: string): number {
  return reader.view.getInt32(take(reader, 4, what), true);
}

/**
 * Read a counted name.
 *
 * Every byte becomes one code unit. The names in both real streams are C++
 * identifiers and so are ASCII throughout, but nothing here tests that: a name
 * is whatever bytes its length claims, because rejecting one for its contents
 * would be the kind of sniff this reader exists to avoid.
 */
function readName(reader: Reader, lengthBytes: 2 | 4, what: string): string {
  const length =
    lengthBytes === 2 ? readUint16(reader, `${what} length`) : readInt32(reader, `${what} length`);
  const at = take(reader, length, what);
  let name = "";
  for (let index = at; index < at + length; index += 1) {
    name += String.fromCharCode(reader.data[index]!);
  }
  return name;
}

function readGuids(reader: Reader, count: number): string[] {
  const at = take(reader, count * GUID_BYTES, "class GUID table");
  const guids: string[] = [];
  for (let guid = 0; guid < count; guid += 1) {
    let hex = "";
    for (let byte = 0; byte < GUID_BYTES; byte += 1) {
      hex += reader.data[at + guid * GUID_BYTES + byte]!.toString(16).padStart(2, "0");
    }
    guids.push(hex);
  }
  return guids;
}

function readTypeRef(reader: Reader, depth: number): SchemaStreamTypeRef {
  const at = reader.offset;
  const word = readUint16(reader, "type reference");
  if (word === 0) return { kind: "none" };

  if (word & 0x8000) {
    const declaredIndex = word & 0x7fff;
    const definition = readClass(reader, depth + 1, declaredIndex, at);
    return { kind: "inline", index: definition.index, name: definition.name, declaredIndex };
  }

  const definedClassCount = reader.classes.length;
  if (
    word < INITIAL_SCHEMA_CLASS_INDEX ||
    word - INITIAL_SCHEMA_CLASS_INDEX >= definedClassCount
  ) {
    // The native reader resolves against the classes it has already created, so
    // a word naming one it has not is a reference to nothing at the moment it
    // is read. It is recorded rather than repaired.
    reader.unresolved.push({ offset: at, index: word, definedClassCount });
    return { kind: "unresolved", index: word };
  }

  // The target's name may not have been read yet — a class can be referenced
  // from inside its own definition — so the name is filled in once the walk is
  // over and every definition is complete.
  const reference: Extract<SchemaStreamTypeRef, { kind: "reference" }> = {
    kind: "reference",
    index: word,
    name: "",
  };
  reader.references.push(reference);
  return reference;
}

function readProperty(reader: Reader, depth: number): SchemaStreamProperty {
  if (depth > MAX_NESTING_DEPTH) {
    throw new SchemaReadStop("property nesting exceeds the depth bound", reader.offset);
  }
  reader.readProperties += 1;
  if (reader.readProperties > MAX_PROPERTIES) {
    throw new SchemaReadStop("property count exceeds the safety bound", reader.offset);
  }

  const offset = reader.offset;
  const name = readName(reader, 4, "property name");
  const fieldType = readInt8(reader, "property field type");
  const variant = FIELD_VARIANTS.get(fieldType);
  if (!variant) {
    throw new SchemaReadStop(`invalid property field type ${fieldType}`, offset);
  }
  const modes = readInt8(reader, "property modes");
  const property: SchemaStreamProperty = {
    name,
    fieldType,
    variant,
    loadingMode: modes & 0x0f,
    itemMode: modes >> 4,
    unknownWord: readInt16(reader, "property reserved word"),
    offset,
  };

  if (property.itemMode === 1) property.size = readInt32(reader, "property item size");
  if (property.loadingMode !== 0) return property;

  if (fieldType === FIELD_TYPE_TUPLE) {
    property.element = readProperty(reader, depth + 1);
  } else if (fieldType === FIELD_TYPE_OBJECT) {
    property.staticType = readTypeRef(reader, depth + 1);
    if (name === SPACE_NAME) property.spaceNameWord = readInt16(reader, "space-named property word");
  }
  return property;
}

/**
 * Read one definition, registering it before anything else is read.
 *
 * The registration order is the grammar: the parent a class defines inline is
 * created after the class itself, which is why an inline parent's index is one
 * above its child's.
 */
function readClass(
  reader: Reader,
  depth: number,
  declaredIndex: number | undefined,
  referenceOffset: number,
): SchemaStreamClass {
  if (depth > MAX_NESTING_DEPTH) {
    throw new SchemaReadStop("class nesting exceeds the depth bound", reader.offset);
  }
  if (reader.classes.length >= MAX_CLASSES) {
    throw new SchemaReadStop("class count exceeds the safety bound", reader.offset);
  }

  const offset = reader.offset;
  const record: SchemaStreamClass = {
    index: INITIAL_SCHEMA_CLASS_INDEX + reader.classes.length,
    name: "",
    parent: { kind: "none" },
    version: 0,
    propertyCount: 0,
    properties: [],
    guids: [],
    unknownWord: 0,
    inline: declaredIndex !== undefined,
    offset,
    endOffset: offset,
  };
  reader.classes.push(record);

  record.unknownWord = readInt16(reader, "class reserved word");
  record.name = readName(reader, 2, "class name");
  record.parent = readTypeRef(reader, depth);
  record.version = readInt32(reader, "class version");

  const propertyCount = readInt32(reader, "class property count");
  const remaining = reader.data.byteLength - reader.offset;
  if (propertyCount < 0 || propertyCount > remaining / MIN_PROPERTY_BYTES) {
    throw new SchemaReadStop(
      `class property count ${propertyCount} exceeds what the stream can hold`,
      reader.offset - 4,
    );
  }
  record.propertyCount = propertyCount;
  reader.declaredProperties += propertyCount;
  for (let index = 0; index < propertyCount; index += 1) {
    record.properties.push(readProperty(reader, depth + 1));
  }

  if (reader.streamVersion > 2) {
    const guidCount = readInt32(reader, "class GUID count");
    if (guidCount < 0 || guidCount > (reader.data.byteLength - reader.offset) / GUID_BYTES) {
      throw new SchemaReadStop(
        `class GUID count ${guidCount} exceeds what the stream can hold`,
        reader.offset - 4,
      );
    }
    record.guids = readGuids(reader, guidCount);
  }

  record.endOffset = reader.offset;
  if (declaredIndex !== undefined && declaredIndex !== record.index) {
    reader.mismatches.push({ offset: referenceOffset, index: record.index, declaredIndex });
  }
  return record;
}

/**
 * Whether the terminator starts here.
 *
 * The eight zero bytes are only looked for where a definition would otherwise
 * begin, and only a class with an empty name could be written to look like
 * them. No class in either real stream has one.
 */
function atTerminator(reader: Reader): boolean {
  const at = reader.offset;
  if (at + TERMINATOR_BYTES > reader.data.byteLength) return false;
  for (let index = at; index < at + TERMINATOR_BYTES; index += 1) {
    if (reader.data[index] !== 0) return false;
  }
  return true;
}

/**
 * Walk the whole of an inflated `Formats/Latest`.
 *
 * The walk succeeds only when it reaches the stream's zero terminator having
 * read every definition in front of it. Anything else — a truncated record, a
 * field type the native reader rejects, a count larger than the remaining
 * bytes, a stream that simply ends — is returned as a failure carrying the
 * offset it stopped at. Nothing partial is handed back: a stream that did not
 * tile is a fact about the stream, not a schema to be used.
 */
export function readSchema(data: Uint8Array, options: SchemaReadOptions = {}): SchemaStreamResult {
  const reader: Reader = {
    data,
    view: new DataView(data.buffer, data.byteOffset, data.byteLength),
    offset: 0,
    streamVersion: options.streamVersion ?? 3,
    classes: [],
    references: [],
    unresolved: [],
    mismatches: [],
    declaredProperties: 0,
    readProperties: 0,
  };

  let topLevelClassCount = 0;
  let consumedBytes = 0;
  try {
    let terminated = false;
    while (reader.offset < data.byteLength) {
      if (atTerminator(reader)) {
        consumedBytes = reader.offset;
        reader.offset += TERMINATOR_BYTES;
        terminated = true;
        break;
      }
      readClass(reader, 0, undefined, reader.offset);
      topLevelClassCount += 1;
    }
    if (!terminated) {
      throw new SchemaReadStop("stream ended without its zero terminator", reader.offset);
    }
  } catch (cause) {
    const stop = cause instanceof SchemaReadStop ? cause : undefined;
    return {
      ok: false,
      error: stop ? stop.message : "unexpected failure while reading the schema stream",
      offset: stop ? stop.at : reader.offset,
      classesRead: reader.classes.length,
      propertiesRead: reader.readProperties,
    };
  }

  const classesByIndex = new Map<number, SchemaStreamClass>();
  for (const record of reader.classes) classesByIndex.set(record.index, record);
  for (const reference of reader.references) {
    const target = classesByIndex.get(reference.index);
    if (target) reference.name = target.name;
  }

  return {
    ok: true,
    schema: {
      byteLength: data.byteLength,
      consumedBytes,
      terminatorBytes: TERMINATOR_BYTES,
      trailingBytes: data.byteLength - reader.offset,
      classes: reader.classes,
      classesByIndex,
      topLevelClassCount,
      propertyCount: reader.declaredProperties,
      unresolvedReferences: reader.unresolved,
      inlineIndexMismatches: reader.mismatches,
    },
  };
}

/**
 * Every class in the stream by name.
 *
 * Names are unique: 4,757 classes carry 4,757 distinct names in the supplied
 * 2027 project, and 3,619 carry 3,619 in the 2014 family file. That uniqueness
 * is what lets a decoder ask for a class by name instead of pinning the index
 * it happened to have in one release — and the indices move a long way. Of the
 * 3,508 class names the two files share, 25 keep the same index; `ArcWall`
 * moves 330 places and `SysMullionFamSym` 1,055, and the shift is not a
 * constant, so nothing short of a lookup survives a release change.
 */
export function schemaClassesByName(schema: SchemaStream): Map<string, SchemaStreamClass> {
  const byName = new Map<string, SchemaStreamClass>();
  for (const entry of schema.classes) if (!byName.has(entry.name)) byName.set(entry.name, entry);
  return byName;
}

/**
 * Index of a named class, or `-1`.
 *
 * `-1` rather than `undefined` because these values are compared against class
 * markers read out of a file, and a marker of `0` occurs — on frames that are
 * not objects at all. A sentinel that could match one would turn a class this
 * release does not have into a silent false positive.
 */
export function schemaClassIndex(
  classesByName: Map<string, SchemaStreamClass>,
  name: string,
): number {
  return classesByName.get(name)?.index ?? -1;
}

/**
 * A class and its ancestors, base first, which is the order their fields are
 * written in: an instance carries `Element`'s fields, then `DatumPlane`'s, then
 * `Level`'s. Stops at a reference the stream never defined, and cannot loop —
 * a parent is always a lower index than the class that names it.
 */
export function schemaAncestorChain(
  schema: SchemaStream,
  index: number,
): SchemaStreamClass[] {
  const chain: SchemaStreamClass[] = [];
  let current = schema.classesByIndex.get(index);
  const seen = new Set<number>();
  while (current && !seen.has(current.index)) {
    seen.add(current.index);
    chain.push(current);
    const parent = current.parent;
    if (parent.kind !== "inline" && parent.kind !== "reference") break;
    current = schema.classesByIndex.get(parent.index);
  }
  return chain.reverse();
}
