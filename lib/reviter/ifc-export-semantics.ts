/** Conservative IFC4 semantic mapping inspired by rvt-rs RE-45 (1c3d337).
 * Source parameters remain raw; unknown classes/enums never enter STEP syntax.
 */
import type { ElementParameter } from "./element-parameters.ts";

export type IfcSemanticClass = { entity: string; typeEntity: string; predefinedType: string };
export const IFC_EXPORT_PARAMETER_IDS = [-1019014, -1019015, -1019016, -1019017] as const;

export const IFC_PREDEFINED_ENUMS: Readonly<Record<string, readonly string[]>> = {
  IFCCURTAINWALL: [],
  IFCFOOTING: ["CAISSON_FOUNDATION","FOOTING_BEAM","PAD_FOOTING","PILE_CAP","STRIP_FOOTING"],
  IFCREINFORCINGBAR: ["ANCHORING","EDGE","LIGATURE","MAIN","PUNCHING","RING","SHEAR","STUD"],
  IFCTRANSPORTELEMENT: ["ELEVATOR","ESCALATOR","MOVINGWALKWAY","CRANEWAY","LIFTINGGEAR"],
  IFCDUCTSEGMENT: ["RIGIDSEGMENT","FLEXIBLESEGMENT"],
  IFCPIPESEGMENT: ["CULVERT","FLEXIBLESEGMENT","RIGIDSEGMENT","GUTTER","SPOOL"],
  IFCDUCTFITTING: ["BEND","CONNECTOR","ENTRY","EXIT","JUNCTION","OBSTRUCTION","TRANSITION"],
  IFCPIPEFITTING: ["BEND","CONNECTOR","ENTRY","EXIT","JUNCTION","OBSTRUCTION","TRANSITION"],
  IFCAIRTERMINAL: ["DIFFUSER","GRILLE","LOUVRE","REGISTER"],
  IFCSANITARYTERMINAL: ["BATH","BIDET","CISTERN","SHOWER","SINK","SANITARYFOUNTAIN","TOILETPAN","URINAL","WASHHANDBASIN","WCSEAT"],
  IFCLIGHTFIXTURE: ["POINTSOURCE","DIRECTIONSOURCE","SECURITYLIGHTING"],
  IFCELECTRICAPPLIANCE: ["DISHWASHER","ELECTRICCOOKER","FREESTANDINGELECTRICHEATER","FREESTANDINGFAN","FREESTANDINGWATERHEATER","FREESTANDINGWATERCOOLER","FREEZER","FRIDGE_FREEZER","HANDDRYER","KITCHENMACHINE","MICROWAVE","PHOTOCOPIER","REFRIGERATOR","TUMBLEDRYER","VENDINGMACHINE","WASHINGMACHINE"],
  IFCALARM: ["BELL","BREAKGLASSBUTTON","LIGHT","MANUALPULLBOX","SIREN","WHISTLE"],
  IFCCABLECARRIERSEGMENT: ["CABLELADDERSEGMENT","CABLETRAYSEGMENT","CABLETRUNKINGSEGMENT","CONDUITSEGMENT"],
  IFCCABLECARRIERFITTING: ["BEND","CROSS","REDUCER","TEE"],
  IFCVALVE: ["AIRRELEASE","ANTIVACUUM","CHANGEOVER","CHECK","COMMISSIONING","DIVERTING","DRAWOFFCOCK","DOUBLECHECK","DOUBLEREGULATING","FAUCET","FLUSHING","GASCOCK","GASTAP","ISOLATING","MIXING","PRESSUREREDUCING","PRESSURERELIEF","REGULATING","SAFETYCUTOFF","STEAMTRAP","STOPCOCK"],
  IFCFIRESUPPRESSIONTERMINAL: ["BREECHINGINLET","FIREHYDRANT","HOSEREEL","SPRINKLER","SPRINKLERDEFLECTOR"],
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
  const mapped = entity && Object.hasOwn(IFC_PREDEFINED_ENUMS, entity)
    ? { entity, typeEntity: `${entity}TYPE`, predefinedType: entity === fallback.entity ? fallback.predefinedType : ".NOTDEFINED." }
    : { ...fallback };
  const ownPredefinedConflict = own.some(parameter => parameter.parameterId === -1019016) && uniqueParameter(own, -1019016) === undefined;
  const predefined = (textParameter(own, -1019016) ?? (ownPredefinedConflict ? undefined : textParameter(type, -1019017)))?.toUpperCase();
  // USERDEFINED requires ObjectType/ElementType; the exporter already supplies
  // ElementType, but an unnamed occurrence may have no ObjectType, so fail closed.
  if (predefined === "NOTDEFINED" || (predefined && IFC_PREDEFINED_ENUMS[mapped.entity]?.includes(predefined))) {
    mapped.predefinedType = `.${predefined}.`;
  }
  return mapped;
}

export type IfcCommonProperty = {
  name: string;
  value: string | boolean | number | readonly number[] | readonly string[];
  type: "IFCLABEL" | "IFCTEXT" | "IFCIDENTIFIER" | "IFCBOOLEAN" | "IFCPOSITIVELENGTHMEASURE" | "IFCLENGTHMEASURE" | "IFCCOUNTMEASURE" | "IFCAREAMEASURE" | "IFCVOLUMEMEASURE";
  kind?: "list" | "enumerated";
};
export type IfcCommonPropertySet = { name: string; properties: IfcCommonProperty[] };
export type IfcSemanticContext = {
  typeName?: string | null; familyName?: string | null; categoryName?: string | null; typeId?: number | null;
  nativeStairRiserCount?: number;
  readerPropertySets?: readonly IfcCommonPropertySet[];
  ifcClass?: IfcSemanticClass;
  mepDimensions?: { lengthFeet?: number; nominalDiameterFeet?: number };
};
const COMMON_NAMES: Readonly<Record<string, string>> = {
  IFCWALL: "Pset_WallCommon", IFCSLAB: "Pset_SlabCommon", IFCROOF: "Pset_RoofCommon", IFCCOVERING: "Pset_CoveringCommon",
  IFCDOOR: "Pset_DoorCommon", IFCWINDOW: "Pset_WindowCommon", IFCCOLUMN: "Pset_ColumnCommon", IFCBEAM: "Pset_BeamCommon",
  IFCMEMBER: "Pset_MemberCommon", IFCPLATE: "Pset_PlateCommon", IFCSTAIR: "Pset_StairCommon", IFCSTAIRFLIGHT: "Pset_StairFlightCommon",
  IFCRAILING: "Pset_RailingCommon", IFCRAMP: "Pset_RampCommon", IFCBUILDINGELEMENTPROXY: "Pset_BuildingElementProxyCommon",
  IFCSHADINGDEVICE: "Pset_ShadingDeviceCommon", IFCCURTAINWALL: "Pset_CurtainWallCommon", IFCFOOTING: "Pset_FootingCommon",
};
const FLOW_TYPES = new Set(["IFCDUCTSEGMENT", "IFCPIPESEGMENT", "IFCDUCTFITTING", "IFCPIPEFITTING", "IFCAIRTERMINAL", "IFCSANITARYTERMINAL", "IFCLIGHTFIXTURE", "IFCELECTRICAPPLIANCE", "IFCCABLECARRIERSEGMENT", "IFCCABLECARRIERFITTING", "IFCVALVE", "IFCFIRESUPPRESSIONTERMINAL"]);

/** A contradictory instance value is unresolved, rather than type inheritance. */
export function effectiveParameter(own: readonly ElementParameter[], type: readonly ElementParameter[], id: number): number | string | undefined {
  return own.some(parameter => parameter.parameterId === id) ? uniqueParameter(own, id) : uniqueParameter(type, id);
}
export function positiveParameter(own: readonly ElementParameter[], type: readonly ElementParameter[], ids: readonly number[]): number | undefined {
  const present = ids.map(id => effectiveParameter(own, type, id)).filter(value => value !== undefined);
  if (!present.length || !present.every(value => value === present[0])) return undefined;
  const value = present[0];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Proven source fields only: no quantities or dimensions from recovery boxes. */
export function commonIfcPropertySets(entity: string, own: readonly ElementParameter[], type: readonly ElementParameter[] = [], context: IfcSemanticContext = {}): IfcCommonPropertySet[] {
  const sets = new Map<string, IfcCommonProperty[]>();
  const add = (set: string, property: IfcCommonProperty) => {
    const properties = sets.get(set) ?? [];
    properties.push(property); sets.set(set, properties);
  };
  const setName = COMMON_NAMES[entity];
  const value = (id: number) => effectiveParameter(own, type, id);
  const reference = context.typeName?.trim() || value(-1001405);
  if (typeof reference === "string" && reference.trim()) {
    if (setName) add(setName, { name: "Reference", value: reference, type: "IFCIDENTIFIER" });
    if (FLOW_TYPES.has(entity)) add("Pset_DistributionFlowElementCommon", { name: "Reference", value: reference, type: "IFCIDENTIFIER" });
    if (setName || FLOW_TYPES.has(entity) || entity === "IFCFURNITURE" || entity === "IFCALARM") add("Pset_QuantityTakeOff", { name: "Reference", value: reference, type: "IFCIDENTIFIER" });
    if (entity === "IFCWALL" || entity === "IFCSLAB") add(entity === "IFCWALL" ? "Pset_ReinforcementBarPitchOfWall" : "Pset_ReinforcementBarPitchOfSlab", { name: "Reference", value: reference, type: "IFCLABEL" });
  }
  const text = (name: string, id: number, propertyType: "IFCLABEL" | "IFCTEXT" = "IFCLABEL") => {
    const candidate = value(id);
    if (setName && typeof candidate === "string" && candidate.trim()) add(setName, { name, value: candidate, type: propertyType });
  };
  if (["IFCWALL", "IFCSLAB", "IFCROOF", "IFCCOVERING", "IFCDOOR", "IFCWINDOW", "IFCCOLUMN", "IFCBEAM", "IFCMEMBER", "IFCPLATE", "IFCSTAIR", "IFCSTAIRFLIGHT", "IFCRAMP", "IFCCURTAINWALL"].includes(entity)) text("FireRating", -1001206);
  if (entity === "IFCCOVERING") text("Finish", -1001208, "IFCTEXT");
  const functionValue = value(-1001006);
  if (setName && ["IFCWALL", "IFCDOOR", "IFCSLAB"].includes(entity) && (functionValue === 0 || functionValue === 1)) add(setName, { name: "IsExternal", value: functionValue === 1, type: "IFCBOOLEAN" });
  const structuralId = entity === "IFCSLAB" ? -1001954 : entity === "IFCWALL" ? -1001596 : undefined;
  const structural = structuralId == null ? undefined : value(structuralId);
  if (setName && (structural === 0 || structural === 1)) add(setName, { name: "LoadBearing", value: structural === 1, type: "IFCBOOLEAN" });
  if (entity === "IFCSTAIR" || entity === "IFCSTAIRFLIGHT") {
    const countIds = entity === "IFCSTAIR" ? [-1151111, -1007246] : [-1151305];
    const parameterCount = positiveParameter(own, type, countIds);
    const hasCountParameter = [...own, ...type].some(parameter => countIds.includes(parameter.parameterId));
    const count = hasCountParameter
      ? context.nativeStairRiserCount != null && parameterCount !== context.nativeStairRiserCount ? undefined : parameterCount
      : context.nativeStairRiserCount;
    if (setName && count != null && Number.isSafeInteger(count) && count > 0) add(setName, { name: "NumberOfRiser", value: count, type: "IFCCOUNTMEASURE" });
    for (const [name, ids] of [["RiserHeight", entity === "IFCSTAIR" ? [-1007206] : [-1151307]], ["TreadLength", entity === "IFCSTAIR" ? [-1007250] : [-1151308]]] as const) {
      const measure = positiveParameter(own, type, ids);
      if (setName && measure != null) add(setName, { name, value: measure * 0.3048, type: "IFCPOSITIVELENGTHMEASURE" });
    }
  }
  if (entity === "IFCDUCTSEGMENT" || entity === "IFCPIPESEGMENT") {
    const sourceLength = positiveParameter(own, type, [-1004005]) ?? context.mepDimensions?.lengthFeet;
    if (sourceLength != null && Number.isFinite(sourceLength) && sourceLength > 0) {
      const property: IfcCommonProperty = { name: "Length", value: sourceLength * 0.3048, type: "IFCPOSITIVELENGTHMEASURE" };
      add(entity === "IFCDUCTSEGMENT" ? "Pset_FlowSegmentDuctSegment" : "Pset_FlowSegmentPipeSegment", property);
      if (entity === "IFCDUCTSEGMENT") add("Pset_DuctSegmentTypeCommon", property);
    }
  }
  const diameter = context.mepDimensions?.nominalDiameterFeet;
  if (entity === "IFCPIPEFITTING" && diameter != null && Number.isFinite(diameter) && diameter > 0) add("Pset_PipeFittingTypeCommon", { name: "NominalDiameter", value: [diameter * 0.3048], type: "IFCPOSITIVELENGTHMEASURE", kind: "list" });
  const other: IfcCommonProperty[] = [];
  const label = (name: string, text: string | null | undefined) => { if (text) other.push({ name, value: text, type: "IFCLABEL" }); };
  label("Category", context.categoryName); label("Family", context.familyName); label("Type", context.typeName);
  if (context.familyName && context.typeName) label("Family and Type", `${context.familyName}: ${context.typeName}`);
  if (context.typeId != null && Number.isSafeInteger(context.typeId) && context.typeId > 0) label("Type Id", String(context.typeId));
  if (other.length) sets.set("Other", other);
  return [...sets].map(([name, properties]) => ({ name, properties }));
}

/** Type-property sets attach through IfcTypeObject.HasPropertySets. */
export function nativeTypePropertySets(type: readonly ElementParameter[], context: IfcSemanticContext): IfcCommonPropertySet[] {
  const properties: IfcCommonProperty[] = [];
  for (const [name, parameterId] of [["Manufacturer", -1010108], ["ModelReference", -1010109]] as const) {
    const value = uniqueParameter(type, parameterId);
    if (typeof value === "string" && value.trim()) properties.push({ name, value, type: "IFCLABEL" });
  }
  const other: IfcCommonProperty[] = [];
  if (context.familyName) other.push({ name: "Family Name", value: context.familyName, type: "IFCLABEL" });
  if (context.typeName) other.push({ name: "Type Name", value: context.typeName, type: "IFCLABEL" });
  if (context.categoryName) other.push({ name: "Category", value: context.categoryName, type: "IFCLABEL" });
  return [...(properties.length ? [{ name: "Pset_ManufacturerTypeInformation", properties }] : []), ...(other.length ? [{ name: "Other", properties: other }] : [])];
}

export type IfcSourceQuantity = { name: string; type: "IFCQUANTITYAREA" | "IFCQUANTITYVOLUME" | "IFCQUANTITYLENGTH"; value: number };
export function nativeIfcQuantities(entity: string, own: readonly ElementParameter[]): { name: string; quantities: IfcSourceQuantity[] } | null {
  if (!["IFCWALL", "IFCSLAB", "IFCROOF", "IFCCOVERING", "IFCBEAM", "IFCCOLUMN", "IFCMEMBER", "IFCPLATE"].includes(entity)) return null;
  const quantities: IfcSourceQuantity[] = [];
  const volume = positiveParameter(own, [], [-1012806]);
  if (volume != null) quantities.push({ name: "HostVolumeComputed", type: "IFCQUANTITYVOLUME", value: volume * 0.028316846592 });
  const area = positiveParameter(own, [], [-1012805]);
  if (area != null) quantities.push({ name: "HostAreaComputed", type: "IFCQUANTITYAREA", value: area * 0.09290304 });
  // Host computed values are dimensional source facts. A net/gross IFC
  // quantity label requires paired proof of the source definition and is
  // deliberately not inferred from these parameter names.
  return quantities.length ? { name: "Reviter_RevitComputedQuantities", quantities } : null;
}
