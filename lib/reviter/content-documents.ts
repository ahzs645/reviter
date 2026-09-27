/**
 * The loaded families' own documents, as the project keeps them.
 *
 * A family instance usually draws its type's geometry, stored with the type
 * (`FamilySymbol`) as a `GElement`. Some types have none stored: in the 2025
 * RAC sample, 25 placed instances (windows, a cabinet, a seat, lavatories, the
 * wind generators) point at types with no geometry object anywhere in the
 * file. Revit builds that geometry from the family's own document, and the
 * project carries every loaded family's document with it.
 *
 * Those documents' elements live in the project partition next to the
 * project's, under ids of their own (the RAC sample's "Single Window" family
 * document holds 892, from 1,047,105 up), and include the family's forms:
 * the extrusions, blends, revolutions and sweeps it is modelled with, each
 * with its own stored geometry in the family's coordinates.
 *
 * `Global/ContentDocuments` is the index. It holds one entry per document,
 * each opening with a `ContentMarker` and a `ContentKey` (the file's own
 * class numbers) and the document's GUID, and 117 bytes after the GUID a
 * counted table of 40-byte records, one per element of the document:
 *
 * ```text
 * u64 element id, u32, u32, u32, u64 element id again, u64 previous id, u32
 * ```
 *
 * A project `Family` names its document by that GUID (`FamilyBase` holds it
 * with the document's first element id right after it). Every record restates
 * its id, and a table is read only when all of its records do. Documents
 * found: 162 in the RAC sample, 116 in the 2025 technical school, 172 in the
 * 2024 Snowdon sample, each linked from exactly one `Family`.
 */
import { fileClassTag } from "./revit-class-tags.ts";

/** `ContentMarker` and `ContentKey` in the 2027 numbering. */
const REVIT_2027_CONTENT_MARKER_CLASS = 951;
const REVIT_2027_CONTENT_KEY_CLASS = 950;

const GUID_OFFSET = 16;
const GUID_BYTES = 16;
const TABLE_COUNT_OFFSET = GUID_OFFSET + 117;
const TABLE_OFFSET = TABLE_COUNT_OFFSET + 4;
const RECORD_BYTES = 40;
const MAX_RECORDS = 1_000_000;

export type ContentDocument = {
  /** The document's GUID, as its 16 stored bytes in hex. */
  guid: string;
  /** Every element of the document, in the order its table lists them. */
  elementIds: Uint32Array;
};

function hex(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += byte.toString(16).padStart(2, "0");
  return text;
}

function recordsRestateIds(view: DataView, tableAt: number, count: number): boolean {
  for (let index = 0; index < count; index += 1) {
    const record = tableAt + index * RECORD_BYTES;
    if (
      view.getUint32(record + 4, true) !== 0 ||
      view.getUint32(record + 24, true) !== 0 ||
      view.getUint32(record + 20, true) !== view.getUint32(record, true) ||
      view.getUint32(record, true) === 0
    ) {
      return false;
    }
  }
  return true;
}

/** Every family document `Global/ContentDocuments` indexes, keyed by GUID. */
export function readContentDocuments(data: Uint8Array): Map<string, ContentDocument> {
  const documents = new Map<string, ContentDocument>();
  const marker = fileClassTag(REVIT_2027_CONTENT_MARKER_CLASS);
  const key = fileClassTag(REVIT_2027_CONTENT_KEY_CLASS);
  if (marker < 0 || key < 0) return documents;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let at = 0; at + TABLE_OFFSET <= data.byteLength; at += 1) {
    if (
      view.getUint16(at + 4, true) !== marker ||
      view.getInt32(at + 6, true) !== -1 ||
      view.getUint16(at + 10, true) !== key ||
      view.getInt32(at + 12, true) !== -1
    ) {
      continue;
    }
    const count = view.getUint32(at + TABLE_COUNT_OFFSET, true);
    const tableAt = at + TABLE_OFFSET;
    if (count === 0 || count > MAX_RECORDS || tableAt + count * RECORD_BYTES > data.byteLength) continue;
    if (!recordsRestateIds(view, tableAt, count)) continue;
    const guid = hex(data.subarray(at + GUID_OFFSET, at + GUID_OFFSET + GUID_BYTES));
    if (documents.has(guid)) continue;
    const elementIds = new Uint32Array(count);
    for (let index = 0; index < count; index += 1) {
      elementIds[index] = view.getUint32(tableAt + index * RECORD_BYTES, true);
    }
    documents.set(guid, { guid, elementIds });
    at = tableAt + count * RECORD_BYTES - 1;
  }
  return documents;
}

/** The documents keyed by their GUID's first four bytes, for searching records. */
export type ContentDocumentLookup = ReadonlyMap<number, readonly ContentDocument[]>;

export function contentDocumentLookup(
  documents: ReadonlyMap<string, ContentDocument>,
): ContentDocumentLookup {
  const lookup = new Map<number, ContentDocument[]>();
  for (const document of documents.values()) {
    const prefix = Number.parseInt(document.guid.slice(6, 8) + document.guid.slice(4, 6) + document.guid.slice(2, 4) + document.guid.slice(0, 2), 16);
    const bucket = lookup.get(prefix) ?? [];
    bucket.push(document);
    lookup.set(prefix, bucket);
  }
  return lookup;
}

/**
 * The one indexed document a `Family` record names, or undefined when it
 * names none or more than one. The GUID is followed in the record, 12 bytes
 * on, by the document's first element id, which is checked as well.
 */
export function familyContentDocument(
  data: Uint8Array,
  recordOffset: number,
  recordEnd: number,
  lookup: ContentDocumentLookup,
): ContentDocument | undefined {
  if (lookup.size === 0) return undefined;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let found: ContentDocument | undefined;
  for (let at = recordOffset; at + GUID_BYTES + 16 <= recordEnd; at += 1) {
    const bucket = lookup.get(view.getUint32(at, true));
    if (!bucket) continue;
    for (const document of bucket) {
      if (hex(data.subarray(at, at + GUID_BYTES)) !== document.guid) continue;
      if (view.getUint32(at + GUID_BYTES + 12, true) !== document.elementIds[0]) continue;
      if (found && found !== document) return undefined;
      found = document;
    }
  }
  return found;
}
