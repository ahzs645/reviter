/** Typed, serialized document records from the pinned rvt-rs native graph bridge.
 * Field projections follow the file's structural schema, not drafting.rs's
 * illustrative aliases. Raw graphs remain in the containing evidence report.
 * Upstream: src/native_document.rs, native_parameters.rs, elements/{drafting,
 * annotations,grid,reference_points,reference_planes,project_organization,zones}.rs
 * Apache-2.0 attribution: docs/rvt-semantic-attribution.md.
 */
import type { NativeEvidenceReport } from "./native-evidence-reader.ts";

export const NATIVE_RECORD_INVENTORY_CLASSES = [
  "DBViewPlan", "DBView3d", "DBViewProject", "DBViewSchedule", "DBViewSection",
  "DBViewDrafting", "DBViewLegend", "Grid", "RefPlane", "BasePoint", "TextNote",
  "Dimension", "DimWithSegRefs", "ProjectRevision", "AreaMeasureElem", "RoomElem",
  "WorksetVisibilitySettingsElem", "Viewport", "ViewSheetSet", "DBDrawing",
] as const;
/** Focused selection keeps annotation-heavy files inside the default 4096 decode
 * budget. Detailed dimension records should be requested by class/ID separately. */
export const NATIVE_DRAWING_ANNOTATION_CLASSES = ["TextNote", "IndependentTag", "RoomTag", "AreaTag"] as const;
export const NATIVE_DRAWING_CURVE_CLASSES = ["CurveElem"] as const;
type JsonObject = Record<string, unknown>;
type FieldType = "string" | "boolean" | "number" | "integer" | "element-id" | "element-id-list" | "point-feet" | "vector" | "rtf-bytes" | "point-feet-list" | "number-list";
type FieldValue = string | number | boolean | string[] | number[] | number[][];
export type NativeRecordPointer = { sourceObjectIndex: number; field: string; pointerOffset: number; pointerToken: number; targetObjectIndex: number; targetClass: string };
export type NativeRecordField = {
  value: FieldValue; type: FieldType;
  source: { objectIndex: number; objectClass: string; field: string; pointerPath: NativeRecordPointer[] };
};
export type NativeInventoryRecord = {
  elementId: string; className: string; kind: string; rawRecordIndex: number;
  values: Record<string, NativeRecordField>;
  source: { stream: string; groupRecordOffset: number; bodyBytes: number; bodySha256: string; graphBytes: number };
  diagnostics: string[];
};
export type NativeRecordInventory = {
  kind: "native-record-inventory"; sourceSha256: string | null; revitVersion: number | null;
  schemaSha256: string | null; status: "complete" | "partial" | "unsupported" | "budget-blocked";
  records: NativeInventoryRecord[];
  fallbacks: { rawRecordIndex: number; elementId: string | null; className: string | null; reason: string }[];
  coverage: { retainedRecords: number; projectedRecords: number; projectedFields: number; sourceClasses: unknown };
  limitations: string[];
};
type Descriptor = [key: string, field: string, type: FieldType];
const common: Descriptor[] = [
  ["ownerViewId", "m_ownerDBViewId", "element-id"], ["associatedLevelId", "m_assocLevelId", "element-id"],
  ["designOptionId", "m_designOptionId", "element-id"], ["createdPhaseId", "m_createdPhaseId", "element-id"],
  ["demolishedPhaseId", "m_demolishedPhaseId", "element-id"],
];
const view: Descriptor[] = [
  ["name", "m_viewName", "string"], ["description", "m_viewDescription", "string"],
  ["storedScaleRatio", "m_scale", "number"], ["isTemplate", "m_isTemplate", "boolean"],
  ["templateId", "m_viewTemplateId", "element-id"], ["primaryViewId", "m_primaryViewId", "element-id"],
  ["originFeet", "m_origin", "point-feet"], ["horizontalDirection", "m_horzDir", "vector"],
  ["verticalDirection", "m_vertDir", "vector"], ["viewDirection", "m_viewDir", "vector"],
  ["explicitlyHiddenElementIds", "m_explicitlyHiddenElements", "element-id-list"],
  ["dependentViewIds", "m_dependentViewIds", "element-id-list"],
  ["drawingId", "m_dbDrawingId", "element-id"], ["sheetViewportId", "m_sheetViewportElemId", "element-id"],
  ["sheetNumber", "m_sheetNumber", "string"], ["issueDate", "m_issueDate", "string"],
];
const datum: Descriptor[] = [
  ["label", "m_text", "string"], ["bubbleEndFeet", "m_bubbleEnd", "point-feet"],
  ["freeEndFeet", "m_freeEnd", "point-feet"], ["cutVector", "m_cutVec", "vector"],
];
const classDescriptors: Record<string, { kind: string; fields: Descriptor[] }> = {
  CurveElem: { kind: "source-curve", fields: [["detailCurve", "m_detail", "boolean"], ["usesOffsetPosition", "m_useOffsetPos", "boolean"], ["sketchPlaneId", "m_sketchPlaneId", "element-id"], ["categoryId", "m_categoryId", "element-id"], ["referenceTypeCode", "m_referenceType", "integer"]] },
  DBDrawing: { kind: "drawing", fields: [["viewportIds", "m_viewports", "element-id-list"]] },
  IndependentTag: { kind: "tag", fields: [["symbolId", "m_symbolId", "element-id"], ["hideIn3DView", "m_hideTagIn3DView", "boolean"], ["relativePositionValid", "m_isRelPosValid", "boolean"], ["multiReferenceAnnotationId", "m_multiReferenceAnnotationId", "element-id"]] },
  RoomTag: { kind: "spatial-tag", fields: [["symbolId", "m_symbolId", "element-id"], ["taggedHostId", "m_taggedRoomElemId.m_linkInstOrHostId", "element-id"], ["taggedLinkedId", "m_taggedRoomElemId.m_linkRef", "element-id"], ["hasLeader", "m_bLeader", "boolean"], ["leaderStraight", "m_bLeaderIsStraight", "boolean"], ["leaderAnchorFeet", "m_leaderAnchor", "point-feet"], ["tagOffsetFeet", "m_tagOffset", "point-feet"], ["zoneSchemeId", "m_zoneSchemeId", "element-id"]] },
  AreaTag: { kind: "spatial-tag", fields: [["symbolId", "m_symbolId", "element-id"]] },
  LinearDimString: { kind: "linear-dimension", fields: [["typeId", "m_styleSymbolId", "element-id"], ["locked", "m_locked", "boolean"], ["storedReferencePointsFeet", "m_refPnts", "point-feet-list"], ["storedOriginFeet", "m_oldOrigin", "point-feet"], ["planeNormal", "m_planeNormal", "vector"], ["usesEqualityFormula", "m_useEqualityFormula", "boolean"], ["directionTypeCode", "m_dirType", "integer"]] },
  RadialDim: { kind: "radial-dimension", fields: [["typeId", "m_styleSymbolId", "element-id"], ["locked", "m_locked", "boolean"]] },
  AngularDim: { kind: "angular-dimension", fields: [["typeId", "m_styleSymbolId", "element-id"], ["locked", "m_locked", "boolean"]] },
  ArcLengthDim: { kind: "arc-length-dimension", fields: [["typeId", "m_styleSymbolId", "element-id"], ["locked", "m_locked", "boolean"]] },
  DBViewPlan: { kind: "plan-view", fields: [...view, ["planViewTypeCode", "m_planViewType", "integer"], ["usesTrueNorth", "m_bUseTrueNorth", "boolean"], ["cutPlaneElevationFeet", "m_cutPlaneElev", "number"], ["topClipElevationFeet", "m_topClipElev", "number"], ["bottomClipElevationFeet", "m_bottomClipElev", "number"]] },
  DBView3d: { kind: "3d-view", fields: view }, DBViewProject: { kind: "project-view", fields: view },
  DBViewSchedule: { kind: "schedule-view", fields: view }, DBViewSection: { kind: "section-view", fields: view },
  DBViewDrafting: { kind: "drafting-view", fields: view }, DBViewLegend: { kind: "legend-view", fields: view },
  Grid: { kind: "grid", fields: datum }, RefPlane: { kind: "reference-plane", fields: [...datum, ["definesOrigin", "m_definesOrigin", "boolean"], ["definesWallClosure", "m_definesWallClosure", "boolean"]] },
  BasePoint: { kind: "base-point", fields: [["locationTypeCode", "m_locationType", "integer"], ["clippedToShared", "m_isClippedToShared", "boolean"], ["storedTransformedPositionFeet", "m_transformedPosition", "point-feet"]] },
  TextNote: { kind: "text-note", fields: [["typeId", "m_attrId", "element-id"], ["originFeet", "m_orig", "point-feet"], ["baseDirection", "m_baseVec", "vector"], ["upDirection", "m_upVec", "vector"], ["heightFeet", "m_height", "number"], ["storedWidthFeet", "m_trueWidth", "number"], ["noWrapping", "m_bNoWrapping", "boolean"]] },
  Dimension: { kind: "dimension", fields: [["typeId", "m_attrId", "element-id"], ["locked", "m_locked", "boolean"]] },
  DimWithSegRefs: { kind: "dimension", fields: [["typeId", "m_attrId", "element-id"], ["locked", "m_locked", "boolean"]] },
  ProjectRevision: { kind: "revision", fields: [["number", "m_numberStr", "string"], ["description", "m_description", "string"], ["date", "m_date", "string"], ["issued", "m_issued", "boolean"], ["issuedBy", "m_issuedBy", "string"], ["issuedTo", "m_issuedTo", "string"], ["sequenceNumber", "m_sequenceNumber", "integer"], ["visibilityCode", "m_revVisible", "integer"]] },
  AreaMeasureElem: { kind: "area-scheme", fields: [["name", "m_areaElemName", "string"], ["description", "m_areaElemDescription", "string"], ["areaTypeCode", "m_eAreaType", "integer"], ["areaTypeIds", "m_areaTypeElemSet", "element-id-list"]] },
  RoomElem: { kind: "spatial-element", fields: [["levelId", "m_levelId", "element-id"], ["upperLevelId", "m_upperLevelId", "element-id"], ["phaseId", "m_phaseId", "element-id"], ["areaSchemeId", "m_areaSchemeId", "element-id"], ["zoneElementId", "m_zoneElementId", "element-id"], ["heightFeet", "m_height", "number"], ["lowerOffsetFeet", "m_lowerOffset", "number"], ["upperOffsetFeet", "m_upperOffset", "number"], ["isLocationless", "m_bIsLocationless", "boolean"], ["isPlenum", "m_bPlenum", "boolean"], ["occupiable", "m_bOccupiable", "boolean"]] },
  WorksetVisibilitySettingsElem: { kind: "workset-visibility", fields: [["invisibleWorksetIds", "m_invisibleWorksets", "element-id-list"]] },
  Viewport: { kind: "viewport", fields: [["viewId", "m_dbViewId", "element-id"], ["drawingId", "m_dbDrawingId", "element-id"], ["typeId", "m_attrId", "element-id"], ["detailNumber", "m_detailNumber", "string"], ["storedScaleRatio", "m_scale", "number"], ["offsetFeet", "m_offset", "point-feet"], ["labelOriginFeet", "m_labelOrigin", "point-feet"], ["labelLengthFeet", "m_labelLength", "number"], ["orientationCode", "m_viewportOrientation", "integer"], ["clipping", "m_clipping", "boolean"]] },
  ViewSheetSet: { kind: "view-sheet-set", fields: [["name", "m_name", "string"], ["orderedDrawingIds", "m_orderedViewSheetList.m_dbDrawingIds", "element-id-list"], ["automaticOrder", "m_orderedViewSheetList.m_isAutomatic", "boolean"], ["sheetOrganizationId", "m_orderedViewSheetList.m_sheetOrganizationId", "element-id"], ["viewOrganizationId", "m_orderedViewSheetList.m_viewOrganizationId", "element-id"]] },
};
const object = (value: unknown): JsonObject | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
const natural = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function savedField(fields: JsonObject, path: string): { value: unknown } | null {
  let current: unknown = fields;
  for (const key of path.split(".")) {
    const node = Array.isArray(current) ? current as unknown as JsonObject : object(current); if (!node || !Object.hasOwn(node, key)) return null;
    current = node[key];
  }
  return { value: current };
}
function identifier(value: unknown): string | null {
  for (let i = 0; i < 5; i++) {
    if (typeof value === "number") return Number.isSafeInteger(value) ? String(value) : null;
    if (typeof value === "string" && /^-?(?:0|[1-9][0-9]{0,19})$/.test(value)) {
      const n = BigInt(value); return n >= -(1n << 63n) && n <= (1n << 64n) - 1n ? n.toString() : null;
    }
    const fields = object(value); if (!fields) return null;
    value = fields.m_id64 ?? fields.m_id;
  }
  return null;
}
function fieldValue(value: unknown, type: FieldType): FieldValue | null {
  if (type === "element-id") return identifier(value);
  if (type === "string") return typeof value === "string" && value.length <= 16_384 ? value : null;
  if (type === "boolean") return typeof value === "boolean" ? value : null;
  if (type === "integer") return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
  if (type === "number") return typeof value === "number" && Number.isFinite(value) ? value : null;
  if (type === "element-id-list") {
    if (!Array.isArray(value) || value.length > 2048) return null;
    const ids = value.map(identifier); return ids.every((id): id is string => id !== null) ? ids : null;
  }
  if (type === "point-feet" || type === "vector") {
    const xyz = object(value)?.m_xyz ?? value;
    return Array.isArray(xyz) && xyz.length === 3 && xyz.every(n => typeof n === "number" && Number.isFinite(n)) ? [...xyz] as number[] : null;
  }
  if (type === "number-list") return Array.isArray(value) && value.length <= 2048 && value.every(n => typeof n === "number" && Number.isFinite(n)) ? [...value] as number[] : null;
  if (type === "point-feet-list") {
    if (!Array.isArray(value) || value.length > 2048) return null;
    const points = value.map(p => fieldValue(p, "point-feet"));
    return points.every(p => p !== null) ? points as number[][] : null;
  }
  return Array.isArray(value) && value.length <= 262_144 && value.every(n => natural(n) && n <= 255) ? [...value] as number[] : null;
}

/** Projects only complete graphs with a restated root owner and pinned context.
 * The graph decoder's status and all output/selection limits remain visible.
 */
export function buildNativeRecordInventory(report: NativeEvidenceReport): NativeRecordInventory {
  const summary = object(report.source.summary);
  const inventory: NativeRecordInventory = {
    kind: "native-record-inventory", sourceSha256: report.sourceSha256,
    revitVersion: typeof summary?.revit_version === "number" ? summary.revit_version : null,
    schemaSha256: hash(summary?.schema_sha256) ? summary.schema_sha256 : null,
    status: report.source.status,
    records: [], fallbacks: [], coverage: { retainedRecords: report.source.records.length, projectedRecords: 0, projectedFields: 0, sourceClasses: summary?.classes ?? null },
    limitations: ["Serialized source fields retain sentinel IDs and elevations; values are not Revit API evaluations.", "Scale is the stored native ratio. Base-point codes and positions do not establish a shared-coordinate transform.", "Text notes retain owned RTF bytes without interpreting markup; schedules are definitions, not recalculated rows.", "Spatial records and area schemes do not establish room outlines, MEP-space classification or navigation enclosures.", "Source graphs remain available through rawRecordIndex in the containing evidence report."],
  };
  const contextValid = hash(report.sourceSha256) && report.readerCommit === "1c3d337dbd2a6810e9dfad68fe99857843d67387" && report.readerPatch === "native-evidence" && [2024, 2025, 2026].includes(inventory.revitVersion ?? 0) && inventory.schemaSha256 !== null && !["unsupported", "budget-blocked"].includes(report.source.status);
  const seen = new Map<string, NativeInventoryRecord>(); const conflicting = new Set<string>();
  report.source.records.forEach((raw, rawRecordIndex) => {
    const record = object(raw), identity = object(record?.identity), graph = object(record?.graph), source = object(record?.source);
    const elementId = identifier(identity?.element_id), className = typeof record?.class_name === "string" ? record.class_name : null;
    const fallback = (reason: string) => inventory.fallbacks.push({ rawRecordIndex, elementId, className, reason });
    if (!contextValid) { fallback("Unsupported or incomplete source/reader/schema context."); return; }
    const descriptor = className && Object.hasOwn(classDescriptors, className) ? classDescriptors[className] : null;
    if (!descriptor) { fallback("No typed projection for this stored class."); return; }
    if (record?.status !== "complete_bounded_graph" || record.diagnostic !== null || !Array.isArray(graph?.objects) || !Array.isArray(graph?.edges)) { fallback("A complete bounded source graph without a record diagnostic is required."); return; }
    const nodes = graph.objects.map(object), root = nodes[0], fields = object(root?.fields);
    if (elementId === null || BigInt(elementId) <= 0n || root?.class_name !== className || !fields || identifier(fields.m_id) !== elementId) { fallback("The root class or restated element identity disagrees."); return; }
    if (!source || typeof source.stream !== "string" || !/^Partitions\/\d+$/.test(source.stream) || !natural(source.group_record_offset) || !natural(source.body_bytes) || source.body_bytes === 0 || !hash(source.body_sha256) || graph.consumed_bytes !== source.body_bytes) { fallback("Source record boundaries or digest are missing/inconsistent."); return; }
    if (!natural(root.start) || !natural(root.fields_end) || root.start >= root.fields_end || root.fields_end > source.body_bytes) { fallback("Root field boundaries lie outside the source record."); return; }
    const projected: NativeInventoryRecord = { elementId, className: className!, kind: descriptor.kind, rawRecordIndex, values: {}, source: { stream: source.stream, groupRecordOffset: source.group_record_offset, bodyBytes: source.body_bytes, bodySha256: source.body_sha256, graphBytes: graph.consumed_bytes as number }, diagnostics: [] };
    const append = (descriptors: Descriptor[], objectIndex = 0, pointerPath: NativeRecordPointer[] = []) => {
      const node = nodes[objectIndex], nodeFields = object(node?.fields); if (!nodeFields) return;
      for (const [key, field, type] of descriptors) {
        const saved = savedField(nodeFields, field); if (!saved) continue;
        const value = fieldValue(saved.value, type);
        if (value === null) { projected.diagnostics.push(`${objectIndex}.${field}: unsupported ${type} value shape or budget.`); continue; }
        projected.values[key] = { value, type, source: { objectIndex, objectClass: String(node!.class_name), field, pointerPath } };
      }
    };
    const owned = (objectIndex: number, field: string, targetClass: string, priorPath: NativeRecordPointer[] = []): { objectIndex: number; path: NativeRecordPointer[] } | null => {
      const owner = nodes[objectIndex], ownerFields = object(owner?.fields), pointer = object(ownerFields && savedField(ownerFields, field)?.value);
      if (!pointer || pointer.pointer_token === 0) return null;
      const edges = (graph.edges as unknown[]).map(object).filter(edge => edge?.source_object_index === objectIndex && edge.pointer_offset === pointer.offset);
      if (edges.length !== 1) { projected.diagnostics.push(`${objectIndex}.${field}: missing or ambiguous owned pointer edge.`); return null; }
      const edge = edges[0]!, targetIndex = edge.target_object_index, target = natural(targetIndex) ? nodes[targetIndex] : null;
      if (!target || target.class_name !== targetClass || target.class_tag !== pointer.class_tag || edge.target_class_tag !== pointer.class_tag || edge.pointer_token !== pointer.pointer_token || target.token !== pointer.pointer_token || !natural(target.start) || !natural(target.fields_end) || target.start >= target.fields_end || target.fields_end > (source.body_bytes as number) || !natural(pointer.offset) || !natural(pointer.pointer_token) || !natural(owner?.start) || !natural(owner?.fields_end) || pointer.offset < owner.start || pointer.offset >= owner.fields_end) { projected.diagnostics.push(`${objectIndex}.${field}: owned pointer token/class/bounds disagree.`); return null; }
      return { objectIndex: targetIndex as number, path: [...priorPath, { sourceObjectIndex: objectIndex, field, pointerOffset: pointer.offset, pointerToken: pointer.pointer_token, targetObjectIndex: targetIndex as number, targetClass }] };
    };
    const through = (field: string, targetClass: string, descriptors: Descriptor[], objectIndex = 0, priorPath: NativeRecordPointer[] = []) => {
      const target = owned(objectIndex, field, targetClass, priorPath); if (target) append(descriptors, target.objectIndex, target.path);
      return target;
    };
    append([...common, ...descriptor.fields]);
    if (className === "BasePoint") through("m_oGPoint", "GPoint", [["storedGeometryPointFeet", "m_coord", "point-feet"]]);
    if (className === "TextNote") through("m_oSavedRtfData", "RtfData", [["storedRtfBytes", "m_arrRtfStream", "rtf-bytes"]]);
    if (className === "Grid" || className === "RefPlane") through("m_pSurface", "Plane", [["storedPlaneOriginFeet", "m_origin", "point-feet"], ["storedPlaneXDirection", "m_xVec", "vector"], ["storedPlaneYDirection", "m_yVec", "vector"]]);
    if (className === "DBViewSchedule") through("m_pSchema", "ScheduleSchema", [["categoryId", "m_categoryId", "element-id"], ["areaSchemeId", "m_areaSchemeId", "element-id"], ["includeLinkedFiles", "m_bIncludeLinkedFiles", "boolean"], ["materialSchedule", "m_bMaterialSchedule", "boolean"], ["alternateTitle", "m_altScheduleTitle", "string"]]);
    if (className === "CurveElem") {
      const driver = owned(0, "m_pCurveDriver", "CurveElemDriver");
      const pointer = driver && object(object(nodes[driver.objectIndex]?.fields)?.m_pCrv);
      const edge = driver && (graph.edges as unknown[]).map(object).find(e => e?.source_object_index === driver.objectIndex && e.pointer_offset === pointer?.offset);
      const index = edge?.target_object_index, curveClass = natural(index) ? nodes[index]?.class_name : null;
      if (driver && curveClass === "GLine") through("m_pCrv", "GLine", [["storedLineOriginFeet", "m_origin", "point-feet"], ["storedLineDirection", "m_dirVec", "vector"], ["storedLineEndParameters", "m_endParams", "number-list"]], driver.objectIndex, driver.path);
      if (driver && curveClass === "GArc") through("m_pCrv", "GArc", [["storedArcCenterFeet", "m_center", "point-feet"], ["storedArcXDirection", "m_xVec", "vector"], ["storedArcYDirection", "m_yVec", "vector"], ["storedArcRadiusFeet", "m_radius", "number"], ["storedArcEndParameters", "m_endParams", "number-list"]], driver.objectIndex, driver.path);
    }
    if (className === "TextNote" && Array.isArray(fields.m_leaders) && fields.m_leaders.length <= 256) fields.m_leaders.forEach((_, i) => through(`m_leaders.${i}`, "Leader", [[`leader${i}AnchorFeet`, "m_anchor", "point-feet"], [`leader${i}ElbowFeet`, "m_elbow", "point-feet"], [`leader${i}EndFeet`, "m_end", "point-feet"], [`leader${i}Straight`, "m_bStraight", "boolean"]]));
    if (["IndependentTag", "RoomTag", "AreaTag"].includes(className!)) {
      through("m_oTagOrientationCell", "TagOrientationCell", [["headLocationFeet", "m_headLocation", "point-feet"], ["orientationCode", "m_orientation", "integer"], ["rotationRadians", "m_rotationAngle", "number"], ["isSpatialElementTag", "m_isSpatialElementTag", "boolean"]]);
      const cells = owned(0, "m_cellList", "CellList");
      const cellFields = cells && object(nodes[cells.objectIndex]?.fields), pointers = cellFields?.m_cells;
      if (cells && Array.isArray(pointers) && pointers.length <= 256) pointers.forEach((pointer, i) => {
        const edge = (graph.edges as unknown[]).map(object).find(e => e?.source_object_index === cells.objectIndex && e.pointer_offset === object(pointer)?.offset);
        const index = edge?.target_object_index;
        if (!natural(index) || nodes[index]?.class_name !== "TagReferencesWithLeaderCell") return;
        const cell = owned(cells.objectIndex, `m_cells.${i}`, "TagReferencesWithLeaderCell", cells.path);
        const refs = cell && object(nodes[cell.objectIndex]?.fields)?.m_references;
        if (cell && Array.isArray(refs) && refs.length <= 256) refs.forEach((_, j) => through(`m_references.${j}`, "TagReferenceWithLeader", [[`reference${i}_${j}HostId`, "m_referenceIdKey.m_hostOrLinkElemId.m_linkInstOrHostId", "element-id"], [`reference${i}_${j}LinkedId`, "m_referenceIdKey.m_hostOrLinkElemId.m_linkRef", "element-id"], [`reference${i}_${j}LeaderEnabled`, "m_isLeaderEnabled", "boolean"], [`reference${i}_${j}StraightLeader`, "m_isStraightLeader", "boolean"], [`reference${i}_${j}EndOffsetFeet`, "m_endOffset", "point-feet"], [`reference${i}_${j}ElbowOffsetFeet`, "m_elbowOffset", "point-feet"]], cell.objectIndex, cell.path));
      });
    }
    if (["LinearDimString", "RadialDim", "AngularDim", "ArcLengthDim"].includes(className!)) {
      if (className === "LinearDimString") through("m_pDimLine", "GLine", [["storedLineOriginFeet", "m_origin", "point-feet"], ["storedLineDirection", "m_dirVec", "vector"], ["storedLineEndParameters", "m_endParams", "number-list"]]);
      const witnesses = fields.m_witnessRefs;
      if (Array.isArray(witnesses) && witnesses.length <= 2048) witnesses.forEach((_, i) => {
        const field = `m_witnessRefs.${i}.m_pWitnessRef`, pointer = object(savedField(fields, field)?.value);
        const edge = (graph.edges as unknown[]).map(object).find(e => e?.source_object_index === 0 && e.pointer_offset === pointer?.offset);
        const index = edge?.target_object_index, targetClass = natural(index) ? nodes[index]?.class_name : null;
        if (targetClass === "GeomSegInPlaneRef" || targetClass === "ArcRef") through(field, targetClass, [[`witness${i}ElementId`, "m_geomRef.m_elemId", "element-id"], [`witness${i}ForeignReferenceId`, "m_geomRef.m_foreignElemIdRef", "element-id"], [`witness${i}OwnerViewId`, "m_geomRef.m_ownerDBViewId", "element-id"], [`witness${i}SubTag`, "m_geomRef.m_subTag", "integer"]]);
      });
      const segments = fields.m_ArrSegInfo;
      if (Array.isArray(segments) && segments.length <= 2048) segments.forEach((segment, i) => {
        const values = object(segment)?.m_values;
        if (Array.isArray(values) && values.length <= 16) values.forEach((_, j) => append([[`segment${i}StoredValue${j}`, `m_ArrSegInfo.${i}.m_values.${j}.m_value`, "number"]]));
        append([[`segment${i}OriginFeet`, `m_ArrSegInfo.${i}.m_origin`, "point-feet"], [`segment${i}LockedValue`, `m_ArrSegInfo.${i}.m_lockedValue`, "number"]]);
      });
    }
    const prior = seen.get(elementId);
    if (prior && (prior.className !== projected.className || prior.source.bodySha256 !== projected.source.bodySha256)) { conflicting.add(elementId); fallback("Conflicting current records for the same owner."); return; }
    if (!prior) { seen.set(elementId, projected); inventory.records.push(projected); }
  });
  inventory.records = inventory.records.filter(record => !conflicting.has(record.elementId));
  inventory.coverage.projectedRecords = inventory.records.length;
  inventory.coverage.projectedFields = inventory.records.reduce((count, record) => count + Object.keys(record.values).length, 0);
  if (!contextValid) inventory.status = report.source.status === "budget-blocked" ? "budget-blocked" : "unsupported";
  else if (inventory.fallbacks.length || inventory.records.some(record => record.diagnostics.length)) inventory.status = "partial";
  return inventory;
}

/** One source field per row; formula-like text is neutralized for spreadsheets. */
export function makeNativeRecordInventoryCsv(inventory: NativeRecordInventory, options: { excelBom?: boolean } = {}): string {
  const cell = (raw: unknown) => {
    const text = String(raw ?? "");
    const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const scope = "Selected serialized source fields; raw graphs retained in evidence JSON; no regenerated Revit drawing or shared-coordinate transform.";
  const rows: unknown[][] = [["Inventory status", "Scope", "Retained source records", "Projected records", "Source SHA256", "Element ID", "Class", "Kind", "Field", "Type", "Stored value", "Stream", "Record offset", "Body SHA256", "Object index", "Object class", "Source field", "Pointer path", "Raw record index"]];
  for (const record of inventory.records) for (const [field, evidence] of Object.entries(record.values)) rows.push([
    inventory.status, scope, inventory.coverage.retainedRecords, inventory.coverage.projectedRecords,
    inventory.sourceSha256, record.elementId, record.className, record.kind, field, evidence.type,
    Array.isArray(evidence.value) ? JSON.stringify(evidence.value) : evidence.value,
    record.source.stream, record.source.groupRecordOffset, record.source.bodySha256, evidence.source.objectIndex,
    evidence.source.objectClass, evidence.source.field, JSON.stringify(evidence.source.pointerPath), record.rawRecordIndex,
  ]);
  if (rows.length === 1) rows.push([inventory.status, scope, inventory.coverage.retainedRecords, 0, inventory.sourceSha256, "", "", "", "Inventory status", "string", "No typed fields were projected.", "", "", "", "", "", "", "", ""]);
  return (options.excelBom ? "\ufeff" : "") + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
