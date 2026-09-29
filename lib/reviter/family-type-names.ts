/**
 * Each placed family instance's type and family, by name.
 *
 * A placed instance does not store its type's name, and the id a placement
 * points at is not always the type either: a door or window points at a
 * per-host clone of its symbol, so the placement's symbol has no name of its
 * own. What every instance record does hold is the id of its type, among the
 * other element ids it references, and the project stores a name entry for
 * every loaded type and family under its category (`name-entries.ts`).
 *
 * So the type is the one id the instance's own record references that has a
 * name entry in the instance's category, and the family is the one id the
 * type's record references, other than the type itself, with an entry in the
 * same category. Where there is not exactly one, nothing is claimed: a type
 * whose family nests another family names both, and neither is picked.
 *
 * The rule is the one the rvt-rs project describes in its report RE-38
 * (Apache-2.0), reimplemented here from that description.
 *
 * Against the "Type Name" the Autodesk Viewer shows for the same elements,
 * every type name this produces is equal: 35,299 in the 2027 UNBC project,
 * 5,356 in the 2025 technical school and 427 in the 2025 RAC sample, where
 * before only walls had one (7,523, 121 and 46). Family names equal the
 * Viewer's parent node wherever both are stated: 2,130, 495 and 170.
 */
import { frameHeaderBytes, narrowElementIds } from "./element-id-width.ts";
import type { ElementObject } from "./element-objects.ts";
import type { NameEntry } from "./name-entries.ts";

/** `FamilyInstance` and `FamilySymbol` in the 2027 numbering. */
export const REVIT_2027_FAMILY_INSTANCE_CLASS = 0x07ef;
export const REVIT_2027_FAMILY_SYMBOL_CLASS = 0x0810;

/** Element ids stay well inside this in every supplied file. */
const MAX_ELEMENT_ID = 0x7fff_ffff;

/** The 18-byte frame header precedes an object's first field. */
const OBJECT_BODY_OFFSET = 18;

/**
 * Every 64-bit value in an object's body that could be an element id: a
 * nonzero low word and a zero high word. Most are not ids, which is why they
 * are only ever read against the name entries.
 *
 * Where ids are 32-bit there is no high word, and every non-negative `u32` in
 * the body is offered instead; the join to a name entry of the instance's own
 * category, required to be unique, is what selects the type.
 */
export function referencedElementIds(data: Uint8Array, frame: ElementObject): Uint32Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (narrowElementIds()) {
    const bodyEnd = Math.min(data.byteLength, frame.offset + frame.objectLength + frameHeaderBytes()) - 4;
    const narrowIds = new Set<number>();
    for (let at = frame.offset + frameHeaderBytes() + 2; at <= bodyEnd; at += 1) {
      const value = view.getUint32(at, true);
      if (value && value <= MAX_ELEMENT_ID && value !== frame.elementId) narrowIds.add(value);
    }
    return Uint32Array.from(narrowIds);
  }
  const end = Math.min(data.byteLength, frame.offset + frame.objectLength) - 8;
  const ids = new Set<number>();
  for (let at = frame.offset + OBJECT_BODY_OFFSET; at <= end; at += 1) {
    if (view.getUint32(at + 4, true) !== 0) continue;
    const value = view.getUint32(at, true);
    if (value && value <= MAX_ELEMENT_ID && value !== frame.elementId) ids.add(value);
  }
  return Uint32Array.from(ids);
}

export type FamilyTypeName = {
  typeId: number;
  typeName: string;
  familyId?: number;
  familyName?: string;
};

function onlyNamed(
  references: Uint32Array | undefined,
  categoryId: number,
  nameEntries: ReadonlyMap<number, NameEntry>,
  except?: number,
): NameEntry | null {
  if (!references) return null;
  let found: NameEntry | null = null;
  for (const id of references) {
    if (id === except) continue;
    const entry = nameEntries.get(id);
    if (!entry || entry.categoryId !== categoryId) continue;
    if (found && found.elementId !== id) return null;
    found = entry;
  }
  return found;
}

/** The type and, where it is unique, the family of every instance it can name. */
export function resolveFamilyTypeNames(
  instanceReferences: ReadonlyMap<number, Uint32Array>,
  symbolReferences: ReadonlyMap<number, Uint32Array>,
  nameEntries: ReadonlyMap<number, NameEntry>,
  categoryOf: (elementId: number) => number | null | undefined,
): Map<number, FamilyTypeName> {
  const names = new Map<number, FamilyTypeName>();
  for (const [elementId, references] of instanceReferences) {
    const categoryId = categoryOf(elementId);
    if (categoryId == null) continue;
    const type = onlyNamed(references, categoryId, nameEntries);
    if (!type) continue;
    const family = onlyNamed(symbolReferences.get(type.elementId), categoryId, nameEntries, type.elementId);
    names.set(elementId, {
      typeId: type.elementId,
      typeName: type.name,
      ...(family ? { familyId: family.elementId, familyName: family.name } : {}),
    });
  }
  return names;
}
