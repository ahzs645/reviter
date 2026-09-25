/**
 * Which elements are part of the 3D model at all.
 *
 * A Revit file holds far more than the building: views and the annotation drawn
 * in them, datums, sketches, the containers that group other elements, and the
 * family subcategory projections that only exist inside a family's own
 * geometry. None of them is drawn in a 3D view, but each can carry a bounds
 * record or a native mesh, and drawing it puts a text note, a reference plane
 * or a storey-sized sketch into the building.
 *
 * Two kinds of evidence decide it, and both are the file's own statement:
 *
 *  - **The element's `ElementHeader`.** An element owned by a view is
 *    view-specific — a detail item, a tag, a text note, a dimension — and an
 *    element whose header states no category is an internal record rather than
 *    a building element. Joined to the Autodesk Viewer property database of
 *    the same files, every element Autodesk draws in a 3D view has no owning
 *    view and a stated category: 36,283 of 36,283 in the 2027 UNBC project,
 *    5,404 of 5,404 in the 2025 technical school, 421 of 421 in the 2025 RAC
 *    sample. So excluding the rest costs no drawn element.
 *  - **The category.** Revit's own enumeration names what a category is, so
 *    the list below is by meaning rather than by what one building happened to
 *    draw: datums and reference geometry, sketch and path lines, spatial
 *    elements, assemblies whose members are drawn in their own right, massing
 *    (hidden in Revit views unless masses are switched on), opening voids, and
 *    family subcategory projections.
 */
import type { ElementHeader } from "./element-headers.ts";
import type { ElementBoundsRecord } from "./types.ts";

export const NON_MODEL_CATEGORY_IDS: ReadonlySet<number> = new Set([
  // Datums and reference geometry.
  -2000530, // CLines: reference planes
  -2000083, // ReferenceLines
  -2000240, // Levels
  -2000220, // Grids
  // Sketch and path lines.
  -2000045, // SketchLines
  -2000051, // Lines: model lines, drawn by Revit as lines rather than solids
  -2000938, // StairsPaths
  -2000954, // RailingRailPathExtensionLines
  -2000067, // StairsSketchBoundaryLines
  -2000068, // StairsSketchRiserLines
  -2000066, // RoomSeparationLines
  -2000079, // AreaSchemeLines
  // Spatial elements: volumes and regions, not built objects.
  -2000160, // Rooms
  -2003200, // Areas
  -2003600, // MEPSpaces
  // Assemblies whose members are elements drawn in their own right.
  -2000980, // MultistoryStairs
  -2000095, // IOSModelGroups
  // Massing, off in Revit's views unless "Show Mass" is on.
  -2003400, // Mass
  -2003403, // MassFloor
  -2003404, // MassForm
  // Opening voids: they cut their host rather than add to it.
  -2000996, // ShaftOpening
  -2000997, // SWallRectOpening
  -2000999, // ArcWallRectOpening
  // Family subcategory projections, never a placed element's own category.
  -2000025, // DoorsPanelProjection
  -2000018, // WindowsFrameMullionProjection
]);

/** Why an element is not part of the 3D model, or null when it is. */
export function nonModelReason(
  header: ElementHeader | undefined,
  categoryId: number | undefined,
): "view-owned" | "no-category" | "non-model-category" | null {
  if (header?.ownerViewId != null) return "view-owned";
  if (header && header.categoryId == null) return "no-category";
  const category = header?.categoryId ?? categoryId;
  if (category != null && NON_MODEL_CATEGORY_IDS.has(category)) return "non-model-category";
  return null;
}

/**
 * Every element that must not be drawn: from the headers, which cover elements
 * with no bounds record of their own, and from the records, whose category may
 * have come from another source.
 */
export function nonModelElementIds(
  records: readonly Pick<ElementBoundsRecord, "elementId" | "categoryId">[],
  headers: ReadonlyMap<number, ElementHeader> | undefined,
): Set<number> {
  const excluded = new Set<number>();
  for (const [elementId, header] of headers ?? []) {
    if (nonModelReason(header, undefined)) excluded.add(elementId);
  }
  for (const record of records) {
    if (nonModelReason(headers?.get(record.elementId), record.categoryId ?? undefined)) {
      excluded.add(record.elementId);
    }
  }
  return excluded;
}
