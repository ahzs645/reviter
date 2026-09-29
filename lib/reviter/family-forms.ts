/**
 * A family's forms: the extrusions, blends, revolutions, sweeps and swept
 * blends a family is modelled with, as its own document keeps them.
 *
 * Every form is a `GenSweep`, whose fields follow `Element`'s: the
 * subcategory it is drawn in, its material, its visibility settings
 * (`FamElemVisibility`, one i32 of flags) and `m_cutting`, true for a void
 * that cuts the solids rather than adding to them. `Element`'s fields end
 * 59 bytes after `m_assocLevelId`, which `level-relations.ts` locates.
 *
 * In the 2025 RAC sample 575 forms are read this way, 69 of them voids.
 *
 * **Where ids are 32-bit** (Revit 2019 to 2023; `element-id-width.ts`)
 * `Element`'s fields end 31 bytes after `m_assocLevelId`, and `GenSweep`
 * declares its fields in another order, the visibility first: `[i32
 * visibility][i32 subcategory][i32 material][u8 cutting]`. `m_id` before the
 * level is a four-byte id. The 2023 RAC sample holds the same 575 forms,
 * each with the 2025 copy's subcategory, material, visibility and cutting
 * flag.
 */
import type { ElementObject } from "./element-objects.ts";
import { narrowElementIds } from "./element-id-width.ts";
import { associatedLevelFieldOffset } from "./level-relations.ts";

/** `GenSweep`'s concrete classes in the 2027 numbering. */
export const REVIT_2027_FAMILY_FORM_CLASSES: ReadonlySet<number> = new Set([
  647, // BlendElem
  1728, // ExtrusionElem
  2175, // FormElem
  3817, // RevolutionElem
  4297, // SweepElem
  4308, // SweptBlendElem
]);

/** `GenSweep`'s own fields, after `Element`'s last three flags. */
const SUBCATEGORY_OFFSET = 59;
const MATERIAL_OFFSET = SUBCATEGORY_OFFSET + 8;
const VISIBILITY_OFFSET = MATERIAL_OFFSET + 8;
const CUTTING_OFFSET = VISIBILITY_OFFSET + 4;
const NARROW_VISIBILITY_OFFSET = 31;
const NARROW_SUBCATEGORY_OFFSET = NARROW_VISIBILITY_OFFSET + 4;
const NARROW_MATERIAL_OFFSET = NARROW_SUBCATEGORY_OFFSET + 4;
const NARROW_CUTTING_OFFSET = NARROW_MATERIAL_OFFSET + 4;

export type FamilyForm = {
  elementId: number;
  /** True for a void form. */
  cutting: boolean;
  visibilityFlags: number;
  subcategoryId: number | null;
  materialId: number | null;
};

function optionalId(value: bigint): number | null {
  return value === -1n || value < -0x8000_0000n || value > 0x7fff_ffffn ? null : Number(value);
}

/** One form's `GenSweep` fields, or null for a frame that is not a form. */
export function readFamilyForm(data: Uint8Array, frame: ElementObject): FamilyForm | null {
  if (!REVIT_2027_FAMILY_FORM_CLASSES.has(frame.marker)) return null;
  if (narrowElementIds()) return readNarrowFamilyForm(data, frame);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const limit = Math.min(data.byteLength, frame.offset + frame.objectLength);
  const fieldOffset = associatedLevelFieldOffset(view, frame.offset, limit);
  if (fieldOffset == null) return null;
  const level = frame.offset + fieldOffset;
  // `m_id`, just before `m_assocLevelId`, restates the frame's own id.
  if (view.getUint32(level - 8, true) !== frame.elementId || view.getUint32(level - 4, true) !== 0) return null;
  if (level + CUTTING_OFFSET + 1 > limit) return null;
  const cutting = data[level + CUTTING_OFFSET];
  if (cutting !== 0 && cutting !== 1) return null;
  return {
    elementId: frame.elementId,
    cutting: cutting === 1,
    visibilityFlags: view.getInt32(level + VISIBILITY_OFFSET, true),
    subcategoryId: optionalId(view.getBigInt64(level + SUBCATEGORY_OFFSET, true)),
    materialId: optionalId(view.getBigInt64(level + MATERIAL_OFFSET, true)),
  };
}

function readNarrowFamilyForm(data: Uint8Array, frame: ElementObject): FamilyForm | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const limit = Math.min(data.byteLength, frame.offset + frame.objectLength);
  const fieldOffset = associatedLevelFieldOffset(view, frame.offset, limit, true);
  if (fieldOffset == null) return null;
  const level = frame.offset + fieldOffset;
  if (view.getUint32(level - 4, true) !== frame.elementId) return null;
  if (level + NARROW_CUTTING_OFFSET + 1 > limit) return null;
  const cutting = data[level + NARROW_CUTTING_OFFSET];
  if (cutting !== 0 && cutting !== 1) return null;
  const id = (at: number) => optionalId(BigInt(view.getInt32(level + at, true)));
  return {
    elementId: frame.elementId,
    cutting: cutting === 1,
    visibilityFlags: view.getInt32(level + NARROW_VISIBILITY_OFFSET, true),
    subcategoryId: id(NARROW_SUBCATEGORY_OFFSET),
    materialId: id(NARROW_MATERIAL_OFFSET),
  };
}

/**
 * For each placed type, the solid forms of its family's own document: what
 * Revit builds the type's geometry from when the type stores none.
 *
 * A document holds its family as it was last edited, in one type's
 * dimensions, so its forms are the placed type's geometry only when that type
 * is the one the document was left in. That is not decided here; the scene
 * checks each result against the placed element's own envelope.
 */
export function familyDocumentFormsBySymbol(
  placements: Iterable<{ elementId: number; geometryId: number }>,
  familyOf: (elementId: number) => number | undefined,
  familyDocuments: ReadonlyMap<number, { elementIds: ArrayLike<number> }>,
  forms: ReadonlyMap<number, FamilyForm>,
): Map<number, number[]> {
  const bySymbol = new Map<number, number[]>();
  const familyBySymbol = new Map<number, number>();
  const conflicting = new Set<number>();
  for (const placement of placements) {
    const familyId = familyOf(placement.elementId);
    if (familyId == null) continue;
    const known = familyBySymbol.get(placement.geometryId);
    if (known != null && known !== familyId) conflicting.add(placement.geometryId);
    familyBySymbol.set(placement.geometryId, familyId);
  }
  for (const [symbolId, familyId] of familyBySymbol) {
    if (conflicting.has(symbolId)) continue;
    const document = familyDocuments.get(familyId);
    if (!document) continue;
    const solids = Array.from(document.elementIds).filter((id) => {
      const form = forms.get(id);
      return form != null && !form.cutting;
    });
    if (solids.length) bySymbol.set(symbolId, solids);
  }
  return bySymbol;
}
