/**
 * Revit IFC identity and export parameter semantics.
 *
 * GlobalId reconstruction and override precedence adapted from Helen Kwok's
 * rvt-rs (Apache-2.0), commit 1c3d337, src/revit_global_ids.rs and
 * src/partition_ifc_export_overrides.rs. See vendor/rvt-rs/NOTICE.md.
 * This consumes Reviter's owned parameter tables, not a nearest-header scan.
 */
import type { ElementParameter } from "./element-parameters.ts";

const IFC_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Revit XORs the original (not necessarily current) handle into the GUID tail. */
export function revitIfcGlobalId(episodeGuid: string, originalElementId: number): string | null {
  if (!GUID.test(episodeGuid) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(episodeGuid) ||
    !Number.isSafeInteger(originalElementId) || originalElementId < 1 || originalElementId > 0xffff_ffff) return null;
  let value = BigInt(`0x${episodeGuid.replaceAll("-", "")}`) ^ BigInt(originalElementId);
  const out = new Array<string>(22).fill("0");
  for (let index = 21; index >= 0; index -= 1) {
    out[index] = IFC_ALPHABET[Number(value & 63n)]!;
    value >>= 6n;
  }
  return out.join("");
}

export function revitIfcGlobalIdFromUniqueId(uniqueId: string | undefined): string | null {
  if (!uniqueId) return null;
  const match = /^(.{36})-([0-9a-f]{8})$/i.exec(uniqueId);
  return match ? revitIfcGlobalId(match[1]!, Number.parseInt(match[2]!, 16)) : null;
}

export const IFC_EXPORT_PARAMETER_IDS = new Map<number, keyof IfcExportParameters>([
  [-1_019_014, "exportAs"],
  [-1_019_015, "typeExportAs"],
  [-1_019_016, "predefinedType"],
  [-1_019_017, "typePredefinedType"],
]);

export type IfcExportParameters = {
  exportAs?: string;
  typeExportAs?: string;
  predefinedType?: string;
  typePredefinedType?: string;
};

export type NativeIfcExportParameters = IfcExportParameters & {
  elementId: number;
  provenance: "owned-element-parameter-table";
};

/** Sticky conflicts: a later copy cannot resurrect an ambiguous parameter. */
export class IfcExportParameterCollector {
  private readonly values = new Map<number, Map<number, string>>();
  private readonly conflicts = new Set<string>();

  add(elementId: number, parameters: readonly ElementParameter[]): void {
    for (const parameter of parameters) {
      if (!IFC_EXPORT_PARAMETER_IDS.has(parameter.parameterId)) continue;
      const key = `${elementId}:${parameter.parameterId}`;
      if (this.conflicts.has(key)) continue;
      // Empty values are Revit's unset/inherit state, not an override.
      const value = typeof parameter.value === "string" ? parameter.value.trim() : "";
      if (!value) continue;
      const held = this.values.get(elementId) ?? new Map<number, string>();
      const previous = held.get(parameter.parameterId);
      if (previous !== undefined && previous !== value) {
        held.delete(parameter.parameterId);
        this.conflicts.add(key);
      } else held.set(parameter.parameterId, value);
      this.values.set(elementId, held);
    }
  }

  entries(): NativeIfcExportParameters[] {
    return [...this.values].sort(([a], [b]) => a - b).flatMap(([elementId, values]) => {
      if (!values.size) return [];
      const result: NativeIfcExportParameters = { elementId, provenance: "owned-element-parameter-table" };
      for (const [key, value] of values) result[IFC_EXPORT_PARAMETER_IDS.get(key)!] = value;
      return [result];
    });
  }
}

export type IfcExportClass = { entity: string; typeEntity: string; predefinedType: string };

// Deliberately bounded to exporter-supported entities and IFC4 enums. A schema
// name is not enough: emitProduct/emitTypeObject must know its exact arity.
const ENUMS: Readonly<Record<string, readonly string[]>> = {
  IFCWALL: ["MOVABLE", "PARAPET", "PARTITIONING", "PLUMBINGWALL", "SHEAR", "SOLIDWALL", "STANDARD", "POLYGONAL", "ELEMENTEDWALL"],
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

export type IfcExportDecision = {
  ifcClass: IfcExportClass;
  requestedEntity?: string;
  requestedPredefinedType?: string;
  entityStatus: "category-default" | "instance-override" | "type-override" | "unsupported-override";
  predefinedTypeStatus: "default" | "accepted" | "unsupported";
};

export function resolveIfcExportClass(
  base: IfcExportClass,
  instance: IfcExportParameters | undefined,
  type: IfcExportParameters | undefined,
  hasObjectType = false,
): IfcExportDecision {
  const requestedEntity = instance?.exportAs ?? type?.typeExportAs?.replace(/Type$/i, "");
  const requestedPredefinedType = instance?.predefinedType ?? type?.typePredefinedType;
  let ifcClass = base;
  let entityStatus: IfcExportDecision["entityStatus"] = "category-default";
  if (requestedEntity) {
    const entity = requestedEntity.toUpperCase();
    if (Object.hasOwn(ENUMS, entity)) {
      const predefinedType = entity === "IFCSLAB" ? ".FLOOR." : ".NOTDEFINED.";
      ifcClass = { entity, typeEntity: `${entity}TYPE`, predefinedType };
      entityStatus = instance?.exportAs ? "instance-override" : "type-override";
    } else entityStatus = "unsupported-override";
  }
  let predefinedTypeStatus: IfcExportDecision["predefinedTypeStatus"] = "default";
  if (requestedPredefinedType) {
    const value = requestedPredefinedType.toUpperCase();
    const allowed = entityStatus !== "unsupported-override" &&
      (value === "NOTDEFINED" || (value === "USERDEFINED" && hasObjectType) || ENUMS[ifcClass.entity]?.includes(value));
    if (allowed) {
      ifcClass = { ...ifcClass, predefinedType: `.${value}.` };
      predefinedTypeStatus = "accepted";
    } else predefinedTypeStatus = "unsupported";
  }
  return { ifcClass, requestedEntity, requestedPredefinedType, entityStatus, predefinedTypeStatus };
}
