/** Decode semantic evidence from the same-byte, pinned rvt-rs native model.
 * No scene geometry, placements, materials or bounds enter this projection.
 * Upstream: ifc/export_content.rs RE-45/47/76/153–165 and native_duct_shapes.rs.
 */
import { IFC_PREDEFINED_ENUMS } from "./ifc-export-semantics.ts";
import type { IfcCommonProperty, IfcCommonPropertySet, IfcSemanticClass } from "./ifc-export-semantics.ts";
export const IFC_SEMANTIC_READER_COMMIT = "1c3d337dbd2a6810e9dfad68fe99857843d67387";
export type NativeIfcSemanticElement = {
  elementId: number; entityIndex: number; ifcClass: IfcSemanticClass; revitClass?: string; typeName?: string; typeId?: number;
  propertySets: IfcCommonPropertySet[];
};
export type NativeIfcSemanticEvidence = {
  revitVersion: number; readerCommit: string; readerMode: string;
  elements: NativeIfcSemanticElement[]; limitations: string[];
};
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | undefined => value != null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : undefined;
const id = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 0xffff_ffff;
const boundedText = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096;
function equalProperty(a: IfcCommonProperty | null | undefined, b: IfcCommonProperty): boolean {
  if (a == null || a.name !== b.name || a.type !== b.type || a.kind !== b.kind) return false;
  const equal = (left: unknown, right: unknown) => typeof left === "number" && typeof right === "number"
    ? a.type === "IFCCOUNTMEASURE" ? left === right : Number(left.toPrecision(12)) === Number(right.toPrecision(12))
    : left === right;
  // Compare the numeric precision actually emitted to IFC; independent
  // arithmetic on the same native coordinates can differ in its final bit.
  const left = a.value, right = b.value;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => equal(value, right[index]));
  return equal(left, right);
}
const FLOW = new Set(["IFCDUCTSEGMENT", "IFCPIPESEGMENT", "IFCDUCTFITTING", "IFCPIPEFITTING", "IFCAIRTERMINAL", "IFCSANITARYTERMINAL", "IFCLIGHTFIXTURE", "IFCELECTRICAPPLIANCE"]);
const COMMON: Readonly<Record<string, string>> = {
  IFCWALL: "Pset_WallCommon", IFCSLAB: "Pset_SlabCommon", IFCCOVERING: "Pset_CoveringCommon", IFCDOOR: "Pset_DoorCommon", IFCWINDOW: "Pset_WindowCommon", IFCCURTAINWALL: "Pset_CurtainWallCommon",
  IFCMEMBER: "Pset_MemberCommon", IFCPLATE: "Pset_PlateCommon", IFCRAILING: "Pset_RailingCommon", IFCBUILDINGELEMENTPROXY: "Pset_BuildingElementProxyCommon", IFCSTAIR: "Pset_StairCommon", IFCSTAIRFLIGHT: "Pset_StairFlightCommon",
};

function scalar(raw: unknown): IfcCommonProperty | undefined {
  const value = object(raw); if (!value) return undefined;
  const textType = value.kind === "Identifier" ? "IFCIDENTIFIER" : value.kind === "Label" ? "IFCLABEL" : value.kind === "Text" ? "IFCTEXT" : undefined;
  if (textType && boundedText(value.value)) return { name: "", type: textType, value: value.value };
  if (value.kind === "Boolean" && typeof value.value === "boolean") return { name: "", type: "IFCBOOLEAN", value: value.value };
  if (typeof value.value !== "number" || !Number.isFinite(value.value)) return undefined;
  if (value.kind === "PositiveLengthFeet" && value.value > 0) return { name: "", type: "IFCPOSITIVELENGTHMEASURE", value: value.value * 0.3048 };
  if (value.kind === "LengthFeet") return { name: "", type: "IFCLENGTHMEASURE", value: value.value * 0.3048 };
  if (value.kind === "CountValue" && Number.isSafeInteger(value.value) && value.value >= 0) return { name: "", type: "IFCCOUNTMEASURE", value: value.value };
  return undefined;
}
function property(entity: string, set: string, raw: unknown): IfcCommonProperty | undefined {
  const row = object(raw), value = object(row?.value);
  if (!row || !value || typeof row.name !== "string") return undefined;
  const name = row.name;
  let decoded = scalar(value);
  let expected: IfcCommonProperty["type"] | undefined;
  const common = COMMON[entity] === set;
  if (name === "Reference" && (common || set === "Pset_QuantityTakeOff" || (FLOW.has(entity) && set === "Pset_DistributionFlowElementCommon"))) expected = "IFCIDENTIFIER";
  if (name === "Reference" && ((entity === "IFCWALL" && set === "Pset_ReinforcementBarPitchOfWall") || (entity === "IFCSLAB" && set === "Pset_ReinforcementBarPitchOfSlab"))) expected = "IFCLABEL";
  if (common && name === "FireRating" && ["IFCWALL", "IFCSLAB", "IFCCOVERING", "IFCDOOR", "IFCWINDOW", "IFCCURTAINWALL", "IFCMEMBER", "IFCPLATE", "IFCSTAIR", "IFCSTAIRFLIGHT"].includes(entity)) expected = "IFCLABEL";
  // Some upstream from_decoded paths fill conventional boolean defaults.
  // Bare model booleans cannot prove authoring values; native parameter IDs
  // in the independent page reader remain the authority for these properties.
  if (entity === "IFCCOVERING" && set === "Pset_CoveringCommon" && name === "Finish") expected = "IFCTEXT";
  if (["IFCSTAIR", "IFCSTAIRFLIGHT"].includes(entity) && common) {
    if (name === "NumberOfRiser") expected = "IFCCOUNTMEASURE";
    if (name === "RiserHeight" || name === "TreadLength") expected = "IFCPOSITIVELENGTHMEASURE";
  }
  if (["IFCDUCTSEGMENT", "IFCPIPESEGMENT"].includes(entity) && ["Pset_FlowSegmentPipeSegment", "Pset_FlowSegmentDuctSegment"].includes(set)) {
    if (name === "Length") expected = "IFCPOSITIVELENGTHMEASURE";
    // The model's invert is relative to its own bound storey. Until that
    // storey is joined to this export's actual container it is not transferable.
  }
  if (entity === "IFCDUCTSEGMENT" && set === "Pset_DuctSegmentTypeCommon") {
    if (name === "Length") expected = "IFCPOSITIVELENGTHMEASURE";
    if (name === "Shape" && value.kind === "Enumerated" && Array.isArray(value.value) && value.value.length === 1 && ["RECTANGULAR", "ROUND", "FLATOVAL"].includes(value.value[0] as string)) return { name, type: "IFCLABEL", kind: "enumerated", value: value.value as string[] };
  }
  if (entity === "IFCPIPEFITTING" && set === "Pset_PipeFittingTypeCommon" && name === "NominalDiameter" && value.kind === "List" && Array.isArray(value.value) && value.value.length > 0 && value.value.length <= 64) {
    const sizes = value.value.map(scalar);
    if (sizes.every(size => size?.type === "IFCPOSITIVELENGTHMEASURE" && typeof size.value === "number")) return { name, type: "IFCPOSITIVELENGTHMEASURE", kind: "list", value: sizes.map(size => size!.value as number) };
  }
  if (name === "SerialNumber" && (set === "Pset_ManufacturerOccurrence" || (entity === "IFCBUILDINGELEMENTPROXY" && set === "Pset_PrecastConcreteElementGeneral"))) expected = "IFCIDENTIFIER";
  // Keep decoded metadata in the producer's nonreserved set, without parsing
  // an entity's display name to reconstruct fields.
  if (set === "Other" && ["Category", "Family", "Family and Type", "Type", "Type Id"].includes(name)) expected = "IFCLABEL";
  if (!expected || decoded?.type !== expected) return undefined;
  decoded = { ...decoded, name };
  return decoded;
}

export function decodeNativeIfcSemanticModel(model: unknown, context: { revitVersion: number; readerCommit: string; readerMode: string; declaredElementIds: ReadonlySet<number> }): NativeIfcSemanticEvidence {
  const result: NativeIfcSemanticEvidence = { revitVersion: context.revitVersion, readerCommit: context.readerCommit, readerMode: context.readerMode, elements: [], limitations: ["Semantic evidence comes from the pinned reader's model entity; binary byte spans are not exposed.", "Only schema-checked properties are imported; unsupported source properties remain unresolved."] };
  if (context.readerCommit !== IFC_SEMANTIC_READER_COMMIT || ![2024, 2025, 2026].includes(context.revitVersion) || !["scaffold", "typed-no-geometry"].includes(context.readerMode)) return result;
  const entities = object(model)?.entities;
  if (!Array.isArray(entities) || entities.length > 500_000) return result;
  const byIndex = new Map<number, NativeIfcSemanticElement>(), seen = new Set<number>(), conflicts = new Set<number>();
  for (let index = 0; index < entities.length; index++) {
    const entity = object(entities[index]);
    if (entity?.kind !== "BuildingElement" || typeof entity.type_guid !== "string" || !/^[1-9]\d{0,9}$/.test(entity.type_guid)) continue;
    const elementId = Number(entity.type_guid), ifcType = entity.ifc_type;
    if (!id(elementId) || !context.declaredElementIds.has(elementId) || typeof ifcType !== "string" || !Object.hasOwn(IFC_PREDEFINED_ENUMS, ifcType)) continue;
    if (seen.has(elementId)) conflicts.add(elementId); seen.add(elementId);
    const predefined = typeof entity.predefined_type === "string" ? entity.predefined_type : "NOTDEFINED";
    const enumerator = predefined === "NOTDEFINED" || IFC_PREDEFINED_ENUMS[ifcType]?.includes(predefined) ? predefined : "NOTDEFINED";
    const record = object(entity.property_set);
    const recorded = record?.name === "RvtElementRecordGeometry" && Array.isArray(record.properties) && record.properties.length <= 256 ? record.properties : [];
    const text = (name: string) => {
      const values = recorded.map(object).filter(p => p?.name === name).map(p => object(p?.value)).filter(v => v?.kind === "Text" && boundedText(v.value)).map(v => v!.value as string);
      return values.length && values.every(v => v === values[0]) ? values[0] : undefined;
    };
    byIndex.set(index, { elementId, entityIndex: index, ifcClass: { entity: ifcType, typeEntity: `${ifcType}TYPE`, predefinedType: `.${enumerator}.` }, revitClass: text("RevitClass"), typeName: text("TypeName"), propertySets: [] });
  }
  const properties = new Map<number, Map<string, Map<string, IfcCommonProperty | null>>>();
  let rejected = 0, inspectedProperties = 0;
  for (const raw of entities) {
    const entity = object(raw), set = object(entity?.set);
    if (entity?.kind !== "ElementPropertySet" || !id(entity.element) || !set || typeof set.name !== "string" || !Array.isArray(set.properties) || set.properties.length > 256) continue;
    const owner = byIndex.get(entity.element); if (!owner || conflicts.has(owner.elementId)) continue;
    const bySet = properties.get(entity.element) ?? new Map(); properties.set(entity.element, bySet);
    const slots = bySet.get(set.name) ?? new Map<string, IfcCommonProperty | null>(); bySet.set(set.name, slots);
    for (const rawProperty of set.properties) {
      if (++inspectedProperties > 500_000) break;
      const decoded = property(owner.ifcClass.entity, set.name, rawProperty);
      if (!decoded) { rejected++; continue; }
      if (!slots.has(decoded.name)) slots.set(decoded.name, decoded);
      else if (!equalProperty(slots.get(decoded.name), decoded)) slots.set(decoded.name, null);
    }
  }
  for (const [index, element] of byIndex) {
    if (conflicts.has(element.elementId)) continue;
    element.propertySets = [...(properties.get(index) ?? [])].flatMap(([name, slots]) => {
      const properties = [...slots.values()].filter((value): value is IfcCommonProperty => value != null);
      return properties.length ? [{ name, properties }] : [];
    });
    const metadata = element.propertySets.find(set => set.name === "Other")?.properties;
    const typeId = metadata?.find(property => property.name === "Type Id");
    if (typeof typeId?.value === "string" && /^[1-9]\d{0,9}$/.test(typeId.value)) {
      const candidate = Number(typeId.value);
      if (id(candidate) && context.declaredElementIds.has(candidate)) element.typeId = candidate;
    }
    const typeName = metadata?.find(property => property.name === "Type");
    if (typeof typeName?.value === "string") {
      if (element.typeName != null && element.typeName !== typeName.value) element.typeName = undefined;
      else element.typeName = typeName.value;
    }
    result.elements.push(element);
  }
  if (inspectedProperties > 500_000) result.limitations.push("Semantic property inspection reached the 500000-entry budget; remaining properties were omitted.");
  if (conflicts.size) result.limitations.push(`${conflicts.size} duplicate native product identities were suppressed.`);
  if (rejected) result.limitations.push(`${rejected} source properties were outside the validated semantic contract.`);
  return result;
}

/** A native record that reads as a curtain wall can refine an unresolved
 * wall-type join. An explicit basic/stacked native type always retains priority. */
export function refineIfcClassFromModel(fallback: IfcSemanticClass, wallKind: "basic" | "curtain" | "stacked" | undefined, evidence: NativeIfcSemanticElement | undefined): IfcSemanticClass {
  if (evidence) {
    const entity = evidence.ifcClass.entity;
    if (!Object.hasOwn(IFC_PREDEFINED_ENUMS, entity)) return fallback;
    const value = /^\.([A-Z0-9_]+)\.$/.exec(evidence.ifcClass.predefinedType)?.[1];
    const predefined = value === "NOTDEFINED" || (value && IFC_PREDEFINED_ENUMS[entity]?.includes(value)) ? value : "NOTDEFINED";
    evidence = { ...evidence, ifcClass: { entity, typeEntity: `${entity}TYPE`, predefinedType: `.${predefined}.` } };
  }
  if (fallback.entity === "IFCWALL" && wallKind == null && evidence?.ifcClass.entity === "IFCCURTAINWALL" && ["SWall", "ArcWall", "FaceWall", "CurtainPanelWall", "CurtainWall"].includes(evidence.revitClass ?? "")) return evidence.ifcClass;
  // RE-45's native keyed overrides only target these four horizontal
  // entities. The record class must also match the original category family;
  // this never interprets a label or permits arbitrary cross-category casts.
  const horizontal = ["IFCSLAB", "IFCCOVERING", "IFCSHADINGDEVICE", "IFCROOF"];
  const original = evidence?.revitClass === "Floor" ? "IFCSLAB" : evidence?.revitClass === "Ceiling" ? "IFCCOVERING" : ["Roof", "FootprintRoof", "ExtrusionRoof"].includes(evidence?.revitClass ?? "") ? "IFCROOF" : undefined;
  if (original === fallback.entity && evidence && horizontal.includes(evidence.ifcClass.entity)) return evidence.ifcClass;
  return fallback;
}

/** Conflicting independent source values are withheld from standard sets. */
export function mergeIfcPropertySets(...groups: readonly IfcCommonPropertySet[][]): IfcCommonPropertySet[] {
  const sets = new Map<string, Map<string, IfcCommonProperty | null>>();
  for (const group of groups) for (const set of group) {
    const values = sets.get(set.name) ?? new Map<string, IfcCommonProperty | null>(); sets.set(set.name, values);
    for (const property of set.properties) {
      if (!values.has(property.name)) values.set(property.name, property);
      else if (!equalProperty(values.get(property.name), property)) values.set(property.name, null);
    }
  }
  return [...sets].flatMap(([name, values]) => {
    const properties = [...values.values()].filter((value): value is IfcCommonProperty => value != null);
    return properties.length ? [{ name, properties }] : [];
  });
}
