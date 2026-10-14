/** Conservative IFC4 semantic mapping inspired by rvt-rs RE-45 (1c3d337).
 * Source parameters remain raw; unknown classes/enums never enter STEP syntax.
 */
import type { ElementParameter } from "./element-parameters.ts";

export type IfcSemanticClass = { entity: string; typeEntity: string; predefinedType: string };
export const IFC_EXPORT_PARAMETER_IDS = [-1019014, -1019015, -1019016, -1019017] as const;

const ENUMS: Readonly<Record<string, readonly string[]>> = {
  IFCWALL: ["STANDARD", "POLYGONAL", "SHEAR", "ELEMENTEDWALL", "PLUMBINGWALL", "MOVABLE", "SOLIDWALL", "PARAPET", "PARTITIONING"],
  IFCSLAB: ["FLOOR", "ROOF", "LANDING", "BASESLAB"],
  IFCROOF: ["FLAT_ROOF", "SHED_ROOF", "GABLE_ROOF", "HIP_ROOF", "HIPPED_GABLE_ROOF", "GAMBREL_ROOF", "MANSARD_ROOF", "BARREL_ROOF", "RAINBOW_ROOF", "BUTTERFLY_ROOF", "PAVILION_ROOF", "DOME_ROOF", "FREEFORM"],
  IFCCOVERING: ["CEILING", "FLOORING", "CLADDING", "ROOFING", "MOLDING", "SKIRTINGBOARD", "INSULATION", "MEMBRANE", "SLEEVING", "WRAPPING"],
  IFCSHADINGDEVICE: ["JALOUSIE", "SHUTTER", "AWNING"],
  IFCDOOR: ["DOOR", "GATE", "TRAPDOOR"],
  IFCWINDOW: ["WINDOW", "SKYLIGHT", "LIGHTDOME"],
  IFCCOLUMN: ["COLUMN", "PILASTER"],
  IFCBEAM: ["BEAM", "JOIST", "HOLLOWCORE", "LINTEL", "SPANDREL", "T_BEAM"],
  IFCMEMBER: ["BRACE", "CHORD", "COLLAR", "MEMBER", "MULLION", "PLATE", "POST", "PURLIN", "RAFTER", "STRINGER", "STRUT", "STUD"],
  IFCPLATE: ["CURTAIN_PANEL", "SHEET"],
  IFCSTAIR: ["STRAIGHT_RUN_STAIR", "TWO_STRAIGHT_RUN_STAIR", "QUARTER_WINDING_STAIR", "QUARTER_TURN_STAIR", "HALF_WINDING_STAIR", "HALF_TURN_STAIR", "TWO_QUARTER_WINDING_STAIR", "TWO_QUARTER_TURN_STAIR", "THREE_QUARTER_WINDING_STAIR", "THREE_QUARTER_TURN_STAIR", "SPIRAL_STAIR", "DOUBLE_RETURN_STAIR", "CURVED_RUN_STAIR", "TWO_CURVED_RUN_STAIR"],
  IFCSTAIRFLIGHT: ["STRAIGHT", "WINDER", "SPIRAL", "CURVED", "FREEFORM"],
  IFCRAILING: ["HANDRAIL", "GUARDRAIL", "BALUSTRADE"],
  IFCRAMP: ["STRAIGHT_RUN_RAMP", "TWO_STRAIGHT_RUN_RAMP", "QUARTER_TURN_RAMP", "TWO_QUARTER_TURN_RAMP", "HALF_TURN_RAMP", "SPIRAL_RAMP"],
  IFCFURNITURE: ["CHAIR", "TABLE", "DESK", "BED", "FILECABINET", "SHELF", "SOFA"],
  IFCBUILDINGELEMENTPROXY: ["COMPLEX", "ELEMENT", "PARTIAL", "PROVISIONFORVOID", "PROVISIONFORSPACE"],
};

/** Conflicting duplicates cannot authorize an override, including suppression. */
export function uniqueParameter(parameters: readonly ElementParameter[], id: number): number | string | undefined {
  const values = parameters.filter(p => p.parameterId === id).map(p => p.value);
  return values.length && values.every(value => value === values[0]) ? values[0] : undefined;
}
function textParameter(parameters: readonly ElementParameter[], id: number): string | undefined {
  const value = uniqueParameter(parameters, id);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function resolveIfcClass(
  fallback: IfcSemanticClass,
  own: readonly ElementParameter[] = [],
  type: readonly ElementParameter[] = [],
): IfcSemanticClass | null {
  // Autodesk's published enum table: instance 0=By Type, 1=Yes,
  // 2=No; type 0=Default, 1=Yes, 2=No. Unknown/conflicting instance
  // flags cannot authorize omission through a type-level setting.
  const ownFlag = uniqueParameter(own, -1019012);
  const typeFlag = uniqueParameter(type, -1019013);
  const inheritsType = ownFlag === 0 || (ownFlag === undefined && !own.some(parameter => parameter.parameterId === -1019012));
  if (ownFlag === 2 || (inheritsType && typeFlag === 2)) return null;
  const ownAs = textParameter(own, -1019014);
  // A conflicting instance override is unresolved evidence, not an absent
  // override. Inheriting NotExported here would silently omit that occurrence.
  const ownAsConflict = own.some(parameter => parameter.parameterId === -1019014) &&
    uniqueParameter(own, -1019014) === undefined;
  const typeAs = ownAsConflict ? undefined : textParameter(type, -1019015)?.replace(/type$/i, "");
  const exportAs = ownAs ?? typeAs;
  if (exportAs?.toUpperCase() === "NOTEXPORTED") return null;
  const entity = exportAs?.toUpperCase();
  const mapped = entity && Object.hasOwn(ENUMS, entity)
    ? { entity, typeEntity: `${entity}TYPE`, predefinedType: entity === fallback.entity ? fallback.predefinedType : ".NOTDEFINED." }
    : { ...fallback };
  const predefined = (textParameter(own, -1019016) ?? textParameter(type, -1019017))?.toUpperCase();
  // USERDEFINED requires ObjectType/ElementType; the exporter already supplies
  // ElementType, but an unnamed occurrence may have no ObjectType, so fail closed.
  if (predefined === "NOTDEFINED" || (predefined && ENUMS[mapped.entity]?.includes(predefined))) {
    mapped.predefinedType = `.${predefined}.`;
  }
  return mapped;
}

export type IfcCommonProperty = { name: string; value: string | boolean; type: "IFCLABEL" | "IFCTEXT" | "IFCBOOLEAN" };
export type IfcCommonPropertySet = { name: string; properties: IfcCommonProperty[] };
const COMMON_NAMES: Readonly<Record<string, string>> = {
  IFCWALL: "Pset_WallCommon", IFCSLAB: "Pset_SlabCommon", IFCROOF: "Pset_RoofCommon", IFCCOVERING: "Pset_CoveringCommon",
  IFCDOOR: "Pset_DoorCommon", IFCWINDOW: "Pset_WindowCommon", IFCCOLUMN: "Pset_ColumnCommon", IFCBEAM: "Pset_BeamCommon",
  IFCMEMBER: "Pset_MemberCommon", IFCPLATE: "Pset_PlateCommon", IFCSTAIR: "Pset_StairCommon", IFCSTAIRFLIGHT: "Pset_StairFlightCommon",
  IFCRAILING: "Pset_RailingCommon", IFCRAMP: "Pset_RampCommon", IFCBUILDINGELEMENTPROXY: "Pset_BuildingElementProxyCommon",
  IFCSHADINGDEVICE: "Pset_ShadingDeviceCommon",
};

/** Only published built-in IDs and known value domains become common properties.
 * No phase Status is inferred: source phase ids alone cannot establish lifecycle.
 */
export function commonIfcPropertySets(entity: string, own: readonly ElementParameter[], type: readonly ElementParameter[] = []): IfcCommonPropertySet[] {
  const setName = COMMON_NAMES[entity];
  if (!setName) return [];
  const properties: IfcCommonProperty[] = [];
  const value = (id: number) => uniqueParameter(own, id) ?? uniqueParameter(type, id);
  const text = (name: string, id: number, propertyType: "IFCLABEL" | "IFCTEXT" = "IFCLABEL") => {
    const candidate = value(id);
    if (typeof candidate === "string" && candidate.trim()) properties.push({ name, value: candidate, type: propertyType });
  };
  // IFC Reference denotes the type identifier, not the occurrence's Mark.
  text("Reference", -1001405);
  const fireClasses = ["IFCWALL", "IFCSLAB", "IFCROOF", "IFCCOVERING", "IFCDOOR", "IFCWINDOW", "IFCCOLUMN", "IFCBEAM", "IFCMEMBER", "IFCPLATE", "IFCSTAIR", "IFCSTAIRFLIGHT", "IFCRAMP"];
  if (fireClasses.includes(entity)) text("FireRating", -1001206);
  if (entity === "IFCCOVERING") text("Finish", -1001208, "IFCTEXT");
  const functionValue = value(-1001006);
  if (["IFCWALL", "IFCDOOR", "IFCSLAB"].includes(entity) && (functionValue === 0 || functionValue === 1)) {
    properties.push({ name: "IsExternal", value: functionValue === 1, type: "IFCBOOLEAN" });
  }
  const structuralId = entity === "IFCSLAB" ? -1001954 : entity === "IFCWALL" ? -1001596 : undefined;
  const structural = structuralId == null ? undefined : value(structuralId);
  if (structural === 0 || structural === 1) properties.push({ name: "LoadBearing", value: structural === 1, type: "IFCBOOLEAN" });
  return properties.length ? [{ name: setName, properties }] : [];
}
