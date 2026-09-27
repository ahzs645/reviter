/**
 * The name a project stores for each loaded family and family type.
 *
 * Partitions carry one short entry per loaded family and per family type:
 *
 * ```text
 * [u64 element id] [u32 n] [n UTF-16LE code units] [i64 BuiltInCategory]
 * ```
 *
 * The entry is found from its end: a category id is a negative i64 in the
 * `BuiltInCategory` band, so its top five bytes are all `0xff`, and the name
 * and the id are read back from there. A placed family instance points at its
 * type (the symbol) directly, so the type's entry names it, and the entry of
 * the family its symbol resolves to names the family.
 *
 * The layout is a public observation of the rvt-rs project (report RE-38,
 * Apache-2.0), which measured Revit 2024 and 2025 files. It is reimplemented
 * here from that description, and holds on the 2027 UNBC project too. How the
 * entries are joined to instances, and how those names compare with the
 * Autodesk Viewer's, is in `family-type-names.ts`.
 */

/** A category id's band: well inside `BuiltInCategory`, never an element id. */
const MIN_CATEGORY_ID = -3_000_000;
const MAX_CATEGORY_ID = -1_000_000;

/** Longest name an entry may carry, in UTF-16 code units. */
const MAX_NAME_UNITS = 256;

/** Element ids stay well inside 32 bits in every supplied file. */
const MAX_ELEMENT_ID = 0x7fff_ffff;

export type NameEntry = {
  elementId: number;
  name: string;
  categoryId: number;
};

function readName(data: Uint8Array, start: number, units: number): string | null {
  const text = new TextDecoder("utf-16le", { fatal: true }).decode(
    data.subarray(start, start + units * 2),
  );
  // A control character or an unpaired surrogate means this is not a name.
  // Noncharacters and the private-use area are bytes read as text, not names.
  if (/[\u0000-\u001f\u007f\ufffd\ufffe\uffff\ufdd0-\ufdef\ue000-\uf8ff]/u.test(text)) return null;
  if (/[\ud800-\udfff]/u.test(text.replace(/[\ud800-\udbff][\udc00-\udfff]/gu, ""))) return null;
  if (!/[\p{L}\p{N}]/u.test(text)) return null;
  return text.normalize("NFC");
}

/** Every name entry in one inflated page. */
export function scanNameEntries(data: Uint8Array): NameEntry[] {
  const entries: NameEntry[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // The category's high word is all ones; find it by its last byte.
  for (
    let at = data.indexOf(0xff, 7);
    at >= 0 && at < data.byteLength;
    at = data.indexOf(0xff, at + 1)
  ) {
    // `at` is the category's last byte, so the category starts at `at - 7`.
    const categoryAt = at - 7;
    if (categoryAt < 14) continue;
    if (
      data[at - 1] !== 0xff || data[at - 2] !== 0xff ||
      data[at - 3] !== 0xff || data[at - 4] !== 0xff
    ) {
      continue;
    }
    const categoryId = view.getInt32(categoryAt, true);
    if (view.getInt32(categoryAt + 4, true) !== -1) continue;
    if (categoryId < MIN_CATEGORY_ID || categoryId > MAX_CATEGORY_ID) continue;
    // The name runs up to the category, and its length precedes it.
    for (let units = 1; units <= MAX_NAME_UNITS; units += 1) {
      const lengthAt = categoryAt - units * 2 - 4;
      const idAt = lengthAt - 8;
      if (idAt < 0) break;
      if (view.getUint32(lengthAt, true) !== units) continue;
      const elementId = view.getUint32(idAt, true);
      if (!elementId || elementId > MAX_ELEMENT_ID || view.getUint32(idAt + 4, true) !== 0) continue;
      let name: string | null = null;
      try {
        name = readName(data, lengthAt + 4, units);
      } catch {
        name = null;
      }
      if (name) entries.push({ elementId, name, categoryId });
      break;
    }
  }
  return entries;
}

/**
 * One name per id, from every page's entries. An id whose entries disagree on
 * the name or the category is dropped rather than guessed at.
 */
export function resolveNameEntries(entries: Iterable<NameEntry>): Map<number, NameEntry> {
  const resolved = new Map<number, NameEntry>();
  const conflicted = new Set<number>();
  for (const entry of entries) {
    if (conflicted.has(entry.elementId)) continue;
    const existing = resolved.get(entry.elementId);
    if (!existing) {
      resolved.set(entry.elementId, entry);
    } else if (existing.name !== entry.name || existing.categoryId !== entry.categoryId) {
      resolved.delete(entry.elementId);
      conflicted.add(entry.elementId);
    }
  }
  return resolved;
}
