/**
 * `schema-reader.ts` walks the whole of `Formats/Latest` rather than scanning
 * it, so the test that matters is whether the walk tiles a real stream: a
 * recursive descent over variable-length records either lands on the last byte
 * or it does not, and there is no partial credit.
 *
 * Both real streams are read here. The 2014 family is the committed fixture and
 * always runs; the 2027 project is the 70 MB model, so that case runs only when
 * the file is present — set `REVITER_MODEL_2027` to point at it.
 *
 * The counts below are measurements, not targets. They were taken with an
 * independent reference implementation of the same grammar before this reader
 * existed, and they are asserted exactly so that a framing change that still
 * "works" cannot pass quietly.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import CFB from "cfb";

import { REVIT_2027_LEVEL_MARKER } from "../lib/reviter/level-relations.ts";
import { REVIT_2027_GELEMENT_SOURCE_CLASS_SLOT } from "../lib/reviter/revit-2027-gelement.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  isRevitChecksumPagedStream,
  revitWindowTail,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";
import {
  INITIAL_SCHEMA_CLASS_INDEX,
  readSchema,
  schemaFieldVariant,
  type SchemaStream,
  type SchemaStreamProperty,
  type SchemaStreamTypeRef,
} from "../lib/reviter/schema-reader.ts";

const FIXTURES = new URL("./fixtures/revitless-toolkit/", import.meta.url);

/** The 2014 family file this repository ships. */
const FAMILY_2014 = join(FIXTURES.pathname, "qf_hatco_hdw-2bn_cat.rfa");

/** The supplied 2027 project, which is too large to commit. */
const MODEL_2027 =
  process.env.REVITER_MODEL_2027 ??
  "/Users/ahmadjalil/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Projects/UNBC BIM/UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt";

/** Inflate `Formats/Latest` out of a Revit container, chunk by chunk. */
function schemaStreamOf(path: string): Uint8Array {
  const cfb = CFB.read(readFileSync(path), { type: "buffer" });
  const found = cfb.FileIndex
    .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
    .find(({ entry, path: entryPath }) => entry.size > 0 && /\/Formats\/Latest$/i.test(entryPath));
  assert.ok(found, `${path} holds no Formats/Latest stream`);

  const stored = asBytes(found.entry.content);
  const clean = isRevitChecksumPagedStream(found.path.replace(/^Root Entry\//i, ""))
    ? stripRevitPageChecksums(stored)
    : stored;

  const offsets = gzipOffsets(clean);
  const parts: Uint8Array[] = [];
  let window: Uint8Array | null = null;
  for (let index = 0; index < offsets.length; index += 1) {
    const inflated = inflateRevitChunk(clean, offsets[index]!, offsets[index + 1], window);
    assert.ok(inflated, `chunk ${index} of ${path} did not inflate`);
    parts.push(inflated);
    window = revitWindowTail(inflated);
  }

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const stream = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    stream.set(part, at);
    at += part.length;
  }
  return stream;
}

/** Every type reference the schema holds, in the order the walk read them. */
function typeReferences(schema: SchemaStream): SchemaStreamTypeRef[] {
  const references: SchemaStreamTypeRef[] = [];
  const walk = (property: SchemaStreamProperty): void => {
    if (property.staticType) references.push(property.staticType);
    if (property.element) walk(property.element);
  };
  for (const record of schema.classes) {
    references.push(record.parent);
    for (const property of record.properties) walk(property);
  }
  return references;
}

const countOf = (references: SchemaStreamTypeRef[], kind: SchemaStreamTypeRef["kind"]): number =>
  references.filter((reference) => reference.kind === kind).length;

const classNamed = (schema: SchemaStream, name: string) => {
  const found = schema.classes.filter((record) => record.name === name);
  assert.equal(found.length, 1, `${name} is not defined exactly once`);
  return found[0]!;
};

/**
 * The two redundancies the stream carries about its own indices.
 *
 * Indices are predicted from creation order, and every inline definition also
 * carries its index in the word that introduced it; every plain reference has
 * to name a class that already exists. Both are checked here from the walk's
 * output rather than trusted from its counters, and the totals are asserted so
 * that a traversal which found no references cannot pass by finding no faults.
 */
function assertIndexRedundanciesHold(
  schema: SchemaStream,
  expected: { inline: number; reference: number; none: number },
): void {
  schema.classes.forEach((record, position) => {
    assert.equal(record.index, INITIAL_SCHEMA_CLASS_INDEX + position);
    assert.equal(schema.classesByIndex.get(record.index), record);
    assert.equal(record.properties.length, record.propertyCount);
  });

  const references = typeReferences(schema);
  assert.equal(countOf(references, "inline"), expected.inline);
  assert.equal(countOf(references, "reference"), expected.reference);
  assert.equal(countOf(references, "none"), expected.none);
  assert.equal(countOf(references, "unresolved"), 0);
  assert.deepEqual(schema.unresolvedReferences, []);
  assert.deepEqual(schema.inlineIndexMismatches, []);

  for (const reference of references) {
    if (reference.kind === "inline") {
      // The word's own copy of the index, against the one creation order gives.
      assert.equal(reference.declaredIndex, reference.index);
    }
    if (reference.kind === "inline" || reference.kind === "reference") {
      const target = schema.classesByIndex.get(reference.index);
      assert.ok(target, `reference to ${reference.index} resolves to nothing`);
      assert.equal(target.name, reference.name);
    }
  }
}

/** `Element` is the root of the persisted object model and is version-stable. */
function assertElementLooksRight(schema: SchemaStream): void {
  const element = classNamed(schema, "Element");
  assert.equal(element.version, 21);
  assert.equal(element.propertyCount, 20);
  assert.deepEqual(
    element.properties.slice(0, 4).map((property) => property.name),
    [
      "m_pParamValueSetDouble",
      "m_pParamValueSetInt",
      "m_pParamValueSetAString",
      "m_pParamValueSetElementId",
    ],
  );
}

/**
 * The same class `tests/schema-fields.test.ts` decodes from a hand-cut fixture,
 * read here out of a whole file by a reader that shares no code with it.
 *
 * That test's "argument count of 1" followed by `0x20` is this grammar's nested
 * tuple element: a property whose name is the single space `0x20`. Its element
 * types and tuple widths — float triples of points, int16 triples of facets —
 * are what the geometry pipeline already reads at those widths.
 */
function assertFacetedTopologyMatchesSchemaFields(schema: SchemaStream): void {
  const topology = classNamed(schema, "FacetedTopology0");
  assert.equal(topology.parent.kind, "inline");
  const parent = schema.classesByIndex.get(topology.index + 1);
  assert.ok(parent);
  assert.equal(parent.name, "FloatFacetedTopology");

  const facets = topology.properties[0]!;
  assert.equal(facets.name, "m_facetsArr");
  assert.equal(facets.variant.kind, "tuple");
  assert.equal(facets.element?.name, " ");
  assert.equal(facets.element?.variant.kind, "int16");
  assert.equal(facets.element?.size, 3);

  const points = parent.properties[0]!;
  assert.equal(points.name, "m_pointsArr");
  assert.equal(points.variant.kind, "tuple");
  assert.equal(points.element?.variant.kind, "float");
  assert.equal(points.element?.size, 3);

  assert.equal(parent.parent.kind, "reference");
  if (parent.parent.kind === "reference") {
    assert.equal(parent.parent.name, "FloatNormalsFacetedTopology");
  }
}

test("tiles the 2014 family's schema stream exactly", () => {
  const stream = schemaStreamOf(FAMILY_2014);
  assert.equal(stream.byteLength, 367_595);

  const result = readSchema(stream);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const schema = result.schema;

  assert.equal(schema.consumedBytes, 367_587);
  assert.equal(schema.terminatorBytes, 8);
  assert.equal(schema.trailingBytes, 0);
  assert.equal(schema.classes.length, 3_619);
  assert.equal(schema.topLevelClassCount, 2_802);
  assert.equal(schema.propertyCount, 9_859);

  assertIndexRedundanciesHold(schema, { inline: 817, reference: 5_031, none: 1_216 });
  assertElementLooksRight(schema);
  assertFacetedTopologyMatchesSchemaFields(schema);
});

test("tiles the 2027 project's schema stream exactly", (t) => {
  if (!existsSync(MODEL_2027)) {
    t.skip("set REVITER_MODEL_2027 to run the 2027 project case");
    return;
  }
  const stream = schemaStreamOf(MODEL_2027);
  assert.equal(stream.byteLength, 513_948);

  const result = readSchema(stream);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const schema = result.schema;

  assert.equal(schema.consumedBytes, 513_940);
  assert.equal(schema.terminatorBytes, 8);
  assert.equal(schema.trailingBytes, 0);
  assert.equal(schema.classes.length, 4_757);
  assert.equal(schema.topLevelClassCount, 3_647);
  assert.equal(schema.propertyCount, 13_080);

  assertIndexRedundanciesHold(schema, { inline: 1_110, reference: 6_587, none: 1_594 });
  assertElementLooksRight(schema);
  assertFacetedTopologyMatchesSchemaFields(schema);

  // Indices measured elsewhere in this repository, from element records rather
  // than from the schema. `GElement` is the object marker `element-objects.ts`
  // reads off `Partitions/*`; `Level` is the marker `level-relations.ts`
  // matches on. Both constants are asserted against their literal value too, so
  // this stays a cross-check if either is ever edited.
  assert.equal(classNamed(schema, "GElement").index, 0x08c6);
  assert.equal(REVIT_2027_GELEMENT_SOURCE_CLASS_SLOT, 0x08c6);
  assert.equal(classNamed(schema, "Level").index, 0x0a19);
  assert.equal(REVIT_2027_LEVEL_MARKER, 0x0a19);
  assert.equal(classNamed(schema, "CellList").index, 784);
});

test("reads a minimal hand-built stream, terminator included", () => {
  // One class, `Ab`, whose parent is defined inline as `C`, with one double
  // property and one trailing GUID.
  const bytes = Uint8Array.from([
    0x00, 0x00, // class reserved word
    0x02, 0x00, 0x41, 0x62, // name "Ab"
    0x0d, 0x80, // parent: inline definition carrying index 13
    0x00, 0x00, // inline class reserved word
    0x01, 0x00, 0x43, // name "C"
    0x00, 0x00, // inline class has no parent
    0x07, 0x00, 0x00, 0x00, // version 7
    0x00, 0x00, 0x00, 0x00, // no properties
    0x00, 0x00, 0x00, 0x00, // no GUIDs
    0x05, 0x00, 0x00, 0x00, // version 5
    0x01, 0x00, 0x00, 0x00, // one property
    0x02, 0x00, 0x00, 0x00, 0x6d, 0x5f, // name "m_"
    0x07, 0x00, 0x00, 0x00, // double, modes 0, reserved 0
    0x01, 0x00, 0x00, 0x00, // one GUID
    0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
    0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // terminator
  ]);

  const result = readSchema(bytes);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const schema = result.schema;

  assert.equal(schema.consumedBytes, bytes.length - 8);
  assert.equal(schema.trailingBytes, 0);
  assert.equal(schema.topLevelClassCount, 1);
  assert.deepEqual(
    schema.classes.map((record) => [record.index, record.name, record.version, record.inline]),
    [
      [12, "Ab", 5, false],
      [13, "C", 7, true],
    ],
  );
  assert.deepEqual(schema.classes[0]!.parent, {
    kind: "inline",
    index: 13,
    name: "C",
    declaredIndex: 13,
  });
  assert.deepEqual(schema.classes[0]!.guids, ["00112233445566778899aabbccddeeff"]);
  assert.equal(schema.classes[0]!.properties[0]!.variant.kind, "double");
  assert.equal(schema.classes[1]!.parent.kind, "none");
});

test("an empty stream is the terminator alone, not a failure", () => {
  const result = readSchema(new Uint8Array(8));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.schema.classes.length, 0);
  assert.equal(result.schema.consumedBytes, 0);
  assert.equal(result.schema.trailingBytes, 0);
});

test("a truncated real stream reports where it stopped instead of throwing", () => {
  const stream = schemaStreamOf(FAMILY_2014);
  const whole = readSchema(stream);
  assert.equal(whole.ok, true);
  if (!whole.ok) return;

  // Cut on a class boundary: every record in front of the cut is complete, so
  // the only thing missing is the terminator, and the walk says exactly that.
  const boundary = whole.schema.classes.filter((record) => !record.inline)[100]!.endOffset;
  const atBoundary = readSchema(stream.subarray(0, boundary));
  assert.equal(atBoundary.ok, false);
  if (atBoundary.ok) return;
  assert.equal(atBoundary.error, "stream ended without its zero terminator");
  assert.equal(atBoundary.offset, boundary);
  assert.equal(atBoundary.classesRead, 101 + whole.schema.classes
    .filter((record) => record.inline && record.offset < boundary).length);

  // Cut mid-record: the walk stops inside the record it was reading and reports
  // the offset rather than salvaging what came before it.
  const cut = stream.subarray(0, 100_000);
  const result = readSchema(cut);
  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.equal(result.error, "class property count 1 exceeds what the stream can hold");
  assert.ok(result.offset > 99_000 && result.offset <= cut.byteLength);
  assert.ok(result.classesRead > 0 && result.classesRead < 3_619);
  assert.ok(result.propertiesRead > 0);
  // The failure carries counts, not records: a stream that did not tile is not
  // a schema to be used.
  assert.deepEqual(Object.keys(result).sort(), [
    "classesRead",
    "error",
    "offset",
    "ok",
    "propertiesRead",
  ]);
});

test("hostile input fails closed rather than crashing or running away", () => {
  const empty = readSchema(new Uint8Array(0));
  assert.equal(empty.ok, false);

  // A field type the native reader rejects, in an otherwise well-formed class.
  const badFieldType = Uint8Array.from([
    0x00, 0x00, 0x01, 0x00, 0x41, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, // version
    0x01, 0x00, 0x00, 0x00, // one property
    0x01, 0x00, 0x00, 0x00, 0x61, // name "a"
    0x0c, 0x00, 0x00, 0x00, // field type 0x0c is invalid
  ]);
  const rejected = readSchema(badFieldType);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.error, "invalid property field type 12");
  assert.equal(schemaFieldVariant(0x0c), undefined);
  assert.equal(schemaFieldVariant(0x00), undefined);

  // A property count no remaining number of bytes could hold.
  const hugeCount = Uint8Array.from([
    0x00, 0x00, 0x01, 0x00, 0x41, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0xff, 0xff, 0xff, 0x7f,
  ]);
  const refused = readSchema(hugeCount);
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.match(refused.error, /property count 2147483647 exceeds/);
  }

  // Every type reference opens another inline definition: unbounded recursion
  // in the file, bounded descent in the reader.
  const level = [0x00, 0x00, 0x00, 0x00, 0x01, 0x80];
  const bomb = Uint8Array.from(Array.from({ length: 4_000 }, () => level).flat());
  const stopped = readSchema(bomb);
  assert.equal(stopped.ok, false);
  if (!stopped.ok) {
    assert.equal(stopped.error, "class nesting exceeds the depth bound");
    assert.ok(stopped.classesRead <= 70, `read ${stopped.classesRead} classes before stopping`);
  }

  // Bytes that are not a schema at all still terminate, and say where.
  let seed = 0x2f6e2b1;
  const noise = new Uint8Array(64 * 1024);
  for (let index = 0; index < noise.length; index += 1) {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
    noise[index] = (seed >>> 16) & 0xff;
  }
  const garbage = readSchema(noise);
  assert.equal(garbage.ok, false);
  if (!garbage.ok) assert.ok(garbage.offset >= 0 && garbage.offset <= noise.length);
});
