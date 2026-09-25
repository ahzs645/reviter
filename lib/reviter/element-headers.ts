/**
 * `ElementHeader`: the per-element record that states an element's category and
 * owning view directly.
 *
 * The file's own `Formats/Latest` declares the class the same way from 2024
 * through 2027 (version 24 in 2024, 26 in 2027, twelve fields in both):
 *
 * ```text
 * m_regenHistory     counted list: [u32 n] then n x 22-byte entries
 * m_categroryId      i64 BuiltInCategory (sic, the schema's spelling), -1 for none
 * m_familyId         i64 element id, -1 for none
 * m_ownerViewId      i64 element id of the view that owns it, -1 for a model element
 * m_designOptionId   i64 element id, -1 for the main model
 * m_unplacedOwnerId  i64
 * m_miscId           i64
 * ...                m_viewRules, m_abFlags4Bytes, m_classDef, m_pBBox, m_parents
 * ```
 *
 * The record is written behind its owner, as `[u64 element id][u32][u16 class]`,
 * the class being `ElementHeader`'s own index in the file (1540 in 2027, 1479 in
 * 2025, 1439 in 2024 — `revit-class-tags.ts` resolves it). Nothing about the
 * owner is inferred: the id the header belongs to is the one in front of it.
 *
 * **How it was measured.** Joined to the Autodesk Viewer property database of
 * the same file by element id, the category read here names the same category
 * Autodesk does for every element Autodesk draws, in all four supplied projects
 * — 36,432 in the 2027 UNBC project, 5,479 in the 2025 technical school, 450 in
 * the 2025 RAC basic sample, 1,310 in the 2024 Snowdon walls view — counting the
 * handful of categories Autodesk shows under an interface name
 * (`OST_StairsStringerCarriage` as "Supports", `OST_CLines` as "Reference
 * Planes"). Across every element either side names, the only disagreements are
 * those same aliases.
 *
 * It also explains the older category decoder's `04 00 [u32] [i64 category]
 * ffffffff` "token": in the 2027 file it matches the tail of an
 * `m_regenHistory` entry followed by the next i64, which is why that decoder had
 * to guess each token's owner from the nearest preceding element id.
 */
import { fileClassTag } from "./revit-class-tags.ts";

/** `ElementHeader` in the 2027 numbering. */
export const REVIT_2027_ELEMENT_HEADER_CLASS = 1540;

/** Bytes of one `m_regenHistory` entry: two i64, a u16 and a u32. */
const REGEN_ENTRY_BYTES = 22;

/**
 * The largest history list accepted. The supplied projects peak at 0 (both
 * 2025 files), 13 (the 2027 project) and 1,815 (the 2024 Snowdon sample).
 */
const MAX_REGEN_ENTRIES = 4096;

/** BuiltInCategory values are negative and sit in this band. */
const MIN_CATEGORY_ID = -3_000_000;
const MAX_CATEGORY_ID = -1_000_000;

/** Element ids in the supplied projects stay far below this. */
const MAX_ELEMENT_ID = 0x7fff_ffff;

/** i64 slots the header states after the category. */
const HEADER_ID_FIELDS = 5;

export type ElementHeader = {
  elementId: number;
  /** BuiltInCategory, or null when the header states none (-1). */
  categoryId: number | null;
  /** The view that owns the element, or null for a model element. */
  ownerViewId: number | null;
  /** The design option the element belongs to, or null for the main model. */
  designOptionId: number | null;
};

/** -1 is "none"; anything else must look like an element id. */
function optionalId(value: bigint): number | null | undefined {
  if (value === -1n) return null;
  if (value > 0n && value <= BigInt(MAX_ELEMENT_ID)) return Number(value);
  return undefined;
}

/**
 * Every `ElementHeader` on one inflated page. The caller decides the release;
 * this reads whatever index `ElementHeader` has in the installed translation.
 */
export function scanElementHeaders(data: Uint8Array): ElementHeader[] {
  const headers: ElementHeader[] = [];
  const tag = fileClassTag(REVIT_2027_ELEMENT_HEADER_CLASS);
  if (tag < 0 || tag > 0xffff || data.byteLength < 64) return headers;
  const low = tag & 0xff;
  const high = tag >> 8;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (
    let at = data.indexOf(low, 12);
    at >= 12 && at + 6 <= data.byteLength;
    at = data.indexOf(low, at + 1)
  ) {
    if (data[at + 1] !== high) continue;
    // The owner's 64-bit id: a zero high word, then a plausible low word.
    if (view.getUint32(at - 8, true) !== 0) continue;
    const elementId = view.getUint32(at - 12, true);
    if (!elementId || elementId > MAX_ELEMENT_ID) continue;
    const entries = view.getUint32(at + 2, true);
    if (entries > MAX_REGEN_ENTRIES) continue;
    const categoryAt = at + 6 + entries * REGEN_ENTRY_BYTES;
    if (categoryAt + 8 * (1 + HEADER_ID_FIELDS) > data.byteLength) continue;

    const rawCategory = view.getBigInt64(categoryAt, true);
    let categoryId: number | null;
    if (rawCategory === -1n) categoryId = null;
    else if (rawCategory > BigInt(MIN_CATEGORY_ID) && rawCategory <= BigInt(MAX_CATEGORY_ID)) {
      categoryId = Number(rawCategory);
    } else continue;

    // The ids after the category are each "none" or a real element id; a
    // false match on the class bytes fails this long before it gets here.
    const familyId = optionalId(view.getBigInt64(categoryAt + 8, true));
    const ownerViewId = optionalId(view.getBigInt64(categoryAt + 16, true));
    const designOptionId = optionalId(view.getBigInt64(categoryAt + 24, true));
    if (familyId === undefined || ownerViewId === undefined || designOptionId === undefined) continue;

    headers.push({ elementId, categoryId, ownerViewId, designOptionId });
  }
  return headers;
}
