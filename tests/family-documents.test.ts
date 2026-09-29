import assert from "node:assert/strict";
import test from "node:test";

import {
  contentDocumentLookup,
  familyContentDocument,
  readContentDocuments,
} from "../lib/reviter/content-documents.ts";
import {
  familyDocumentFormsBySymbol,
  readFamilyForm,
  type FamilyForm,
} from "../lib/reviter/family-forms.ts";

// With no class translation installed, the file's class numbers are the 2027
// ones: ContentMarker 951 and ContentKey 950.
const CONTENT_MARKER = 951;
const CONTENT_KEY = 950;

function guidBytes(seed: number): number[] {
  return Array.from({ length: 16 }, (_, index) => (seed * 37 + index * 11 + 5) & 0xff);
}

/** One indexed document: its header, GUID, 101 opaque bytes, then its table. */
function contentDocument(seed: number, elementIds: number[]): number[] {
  const bytes = new Uint8Array(137 + elementIds.length * 40);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length, true);
  view.setUint16(4, CONTENT_MARKER, true);
  view.setInt32(6, -1, true);
  view.setUint16(10, CONTENT_KEY, true);
  view.setInt32(12, -1, true);
  bytes.set(guidBytes(seed), 16);
  view.setUint32(133, elementIds.length, true);
  elementIds.forEach((id, index) => {
    const record = 137 + index * 40;
    view.setUint32(record, id, true);
    view.setUint32(record + 8, 0x328, true);
    view.setUint32(record + 12, 0x341 + index, true);
    view.setInt32(record + 16, -1, true);
    view.setUint32(record + 20, id, true);
    view.setBigInt64(record + 28, index ? BigInt(elementIds[index - 1]!) : -1n, true);
  });
  return [...bytes];
}

test("the content-document index lists each family document's elements", () => {
  const stream = Uint8Array.from([
    ...new Array(9).fill(0),
    ...contentDocument(1, [1047105, 1047106, 1047107]),
    ...contentDocument(2, [1063132, 1063133]),
  ]);
  const documents = readContentDocuments(stream);
  assert.equal(documents.size, 2);
  const [first, second] = [...documents.values()];
  assert.deepEqual([...first!.elementIds], [1047105, 1047106, 1047107]);
  assert.deepEqual([...second!.elementIds], [1063132, 1063133]);
});

test("a table whose records do not restate their ids is not read", () => {
  const document = contentDocument(3, [500, 501]);
  // The second record's restated id no longer matches.
  document[137 + 40 + 20] = 0x99;
  assert.equal(readContentDocuments(Uint8Array.from(document)).size, 0);
});

test("a Family record names its document by GUID and first element id", () => {
  const documents = readContentDocuments(Uint8Array.from([
    ...contentDocument(1, [1047105, 1047106]),
    ...contentDocument(2, [1063132]),
  ]));
  const lookup = contentDocumentLookup(documents);
  const record = new Uint8Array(96);
  const view = new DataView(record.buffer);
  record.set(guidBytes(2), 40);
  view.setUint32(40 + 16 + 12, 1063132, true);
  assert.deepEqual([...familyContentDocument(record, 0, record.length, lookup)!.elementIds], [1063132]);
  // The same GUID without its document's first id after it is not a link.
  view.setUint32(40 + 16 + 12, 7, true);
  assert.equal(familyContentDocument(record, 0, record.length, lookup), undefined);
});

/** A framed form whose `Element` pointers are all null. */
function formFrame(elementId: number, marker: number, cutting: number): Uint8Array {
  const objectLength = 160;
  const data = new Uint8Array(objectLength + 20);
  const view = new DataView(data.buffer);
  view.setUint32(0, elementId, true);
  view.setUint32(12, objectLength, true);
  view.setUint16(16, marker, true);
  // Six null pointers, an empty m_constrInfo, a null m_cellList, the document
  // stub, then m_id and m_assocLevelId at 62.
  view.setUint32(54, elementId, true);
  const level = 62;
  view.setBigInt64(level, -1n, true);
  view.setBigInt64(level + 59, -2000151n, true); // subcategory
  view.setBigInt64(level + 67, 26n, true); // material
  view.setInt32(level + 75, 0xe03e, true); // visibility
  data[level + 79] = cutting;
  view.setUint32(objectLength + 16, objectLength, true);
  return data;
}

test("a form's GenSweep fields say whether it is a void", () => {
  const extrusion = 1728;
  const solid = readFamilyForm(formFrame(1064600, extrusion, 0), {
    offset: 0, elementId: 1064600, objectLength: 160, marker: extrusion, typeCode: 0,
  });
  assert.deepEqual(solid, {
    elementId: 1064600,
    cutting: false,
    visibilityFlags: 0xe03e,
    subcategoryId: -2000151,
    materialId: 26,
  });
  const frame = { offset: 0, elementId: 1064601, objectLength: 160, marker: extrusion, typeCode: 0 };
  assert.equal(readFamilyForm(formFrame(1064601, extrusion, 1), frame)?.cutting, true);
  assert.equal(readFamilyForm(formFrame(1064601, extrusion, 2), frame), null);
  // Not a form class.
  assert.equal(readFamilyForm(formFrame(1064601, 2064, 0), { ...frame, marker: 2064 }), null);
});

test("each placed type gets its family document's solid forms", () => {
  const form = (elementId: number, cutting: boolean): [number, FamilyForm] => [
    elementId,
    { elementId, cutting, visibilityFlags: 0, subcategoryId: null, materialId: null },
  ];
  const forms = new Map([form(11, false), form(12, true), form(13, false)]);
  const documents = new Map([[900, { elementIds: [10, 11, 12, 13] }]]);
  const bySymbol = familyDocumentFormsBySymbol(
    [{ elementId: 1, geometryId: 500 }, { elementId: 2, geometryId: 500 }, { elementId: 3, geometryId: 600 }],
    (elementId) => (elementId === 3 ? undefined : 900),
    documents,
    forms,
  );
  assert.deepEqual([...bySymbol], [[500, [11, 13]]]);
});
