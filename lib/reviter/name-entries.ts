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
 *
 * **Where ids are 32-bit** (Revit 2023 and older; `element-id-width.ts`) the
 * entry is `[u32 element id] [u32 n] [n UTF-16LE code units] [i32
 * BuiltInCategory]`: in the 2023 RAC sample "hood enclosure" is written as
 * `67 a4 0a 00` (697447), the length and name, then `34 77 e1 ff` (-2001100),
 * the id and category the 2025 copy gives it. With no all-ones high word to
 * find, the category is found by its own top byte, `0xff`, and its band.
 */
import { narrowElementIds } from "./element-id-width.ts";

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

/**
 * Whether `text` is a run of `int32` category ids read as UTF-16: every second
 * code unit is then a category's high half, `0xffd2` to `0xfff0`. Arrays of
 * categories end in a category too, and in the 2023 RAC sample 18 of them
 * read as entries this way, beside the 740 real ones.
 */
function categoryArrayText(text: string): boolean {
  if (text.length < 2 || text.length % 2 !== 0) return false;
  for (let index = 1; index < text.length; index += 2) {
    const unit = text.charCodeAt(index);
    if (unit < 0xffd2 || unit > 0xfff0) return false;
  }
  return true;
}

/** A name entry whose `i32` category starts at `categoryAt`, read back from there. */
function narrowEntryBefore(data: Uint8Array, view: DataView, categoryAt: number): NameEntry | null {
  const categoryId = view.getInt32(categoryAt, true);
  if (categoryId < MIN_CATEGORY_ID || categoryId > MAX_CATEGORY_ID) return null;
  for (let units = 1; units <= MAX_NAME_UNITS; units += 1) {
    const lengthAt = categoryAt - units * 2 - 4;
    const idAt = lengthAt - 4;
    if (idAt < 0) break;
    if (view.getUint32(lengthAt, true) !== units) continue;
    const elementId = view.getUint32(idAt, true);
    if (!elementId || elementId > MAX_ELEMENT_ID) return null;
    let name: string | null = null;
    try {
      name = readName(data, lengthAt + 4, units);
    } catch {
      name = null;
    }
    return name && !categoryArrayText(name) ? { elementId, name, categoryId } : null;
  }
  return null;
}

/** Every name entry in one inflated page. */
export function scanNameEntries(data: Uint8Array): NameEntry[] {
  const entries: NameEntry[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (narrowElementIds()) {
    // The category's top byte is 0xff; `at` is that byte.
    for (
      let at = data.indexOf(0xff, 11);
      at >= 0 && at < data.byteLength;
      at = data.indexOf(0xff, at + 1)
    ) {
      const entry = narrowEntryBefore(data, view, at - 3);
      if (entry) entries.push(entry);
    }
    return entries;
  }
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
