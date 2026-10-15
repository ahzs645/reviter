/** IFC4 material profiles (rvt-rs IFC-30/RE-103). Section parameters and
 * a proved source shape are required; absent materials remain explicitly unknown.
 * Conflicting/invalid material assignments withhold the profile; no stand-in exists. */
import type { ConvertResult } from "./types.ts";
import type { NativeStructuralSection } from "./native-structural-profiles.ts";
export type NativeMaterialProfilePlan = { elementId: number; materialId: number | null; section: NativeStructuralSection };
export function planNativeMaterialProfiles(result: ConvertResult): NativeMaterialProfilePlan[] {
  const sections = new Map<number, NativeStructuralSection | null>();
  for (const section of result.nativeStructuralSections ?? []) {
    const previous = sections.get(section.typeId);
    if (!Number.isSafeInteger(section.typeId) || section.typeId <= 0) continue;
    if (previous === undefined) sections.set(section.typeId, section);
    else if (previous && JSON.stringify(previous) !== JSON.stringify(section)) sections.set(section.typeId, null);
  }
  const materials = new Set((result.nativeMaterialDefinitions ?? []).map(material => material.elementId));
  const assignments = new Map<number, Set<number>>();
  for (const assignment of result.nativeElementMaterialAssignments ?? []) {
    const ids = assignments.get(assignment.elementId) ?? new Set(); ids.add(assignment.materialId); assignments.set(assignment.elementId, ids);
  }
  const elements = new Map<number, ConvertResult["elementBounds"][number] | null>();
  for (const record of result.elementBounds) {
    const previous = elements.get(record.elementId);
    if (previous === undefined) elements.set(record.elementId, record);
    else if (previous && (previous.typeId !== record.typeId || previous.familySymbolId !== record.familySymbolId || previous.categoryId !== record.categoryId)) elements.set(record.elementId, null);
  }
  const plans: NativeMaterialProfilePlan[] = [];
  for (const [elementId, record] of elements) {
    if (!record || ![-2001320, -2001330].includes(record.categoryId ?? 0)) continue;
    const type = record.typeId ?? record.familySymbolId;
    const section = type === undefined ? undefined : sections.get(type), ids = assignments.get(elementId);
    if (!section || (ids && (ids.size !== 1 || !Number.isSafeInteger([...ids][0]!) || [...ids][0]! <= 0 || !materials.has([...ids][0]!))) || section.source !== "declared-type-value-block-six-section-parameters" || section.shape !== "symmetric-I" || section.shapeSource !== "owned-integer-STRUCTURAL_SECTION_SHAPE" || ![6, 8].includes(section.shapeCode ?? 0) ||
      ![section.widthFeet, section.depthFeet, section.webFeet, section.flangeFeet].every(value => Number.isFinite(value) && value > 0) ||
      section.webFeet >= section.widthFeet || 2 * section.flangeFeet >= section.depthFeet ||
      !Number.isFinite(section.centroidXFeet) || !Number.isFinite(section.centroidYFeet) ||
      Math.abs(section.centroidXFeet - section.widthFeet / 2) > 1e-4 || Math.abs(section.centroidYFeet - section.depthFeet / 2) > 1e-4) continue;
    plans.push({ elementId, materialId: ids ? [...ids][0]! : null, section });
  }
  return plans;
}
