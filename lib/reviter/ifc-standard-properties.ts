/**
 * Evidence-only IFC4 property mappings. The Reference and resolved Phasing
 * conventions were reviewed against rvt-rs (Apache-2.0), fork/main at
 * 1c3d337dbd2a6810e9dfad68fe99857843d67387, src/ifc/export_content.rs.
 * This is a separate TypeScript implementation; no Rust source is copied.
 * Raw Revit parameters and recovery evidence must still be exported separately.
 */
import type { ElementParameter } from "./element-parameters.ts";

export type IfcStandardProperty = {
  name: string;
  type: "IFCIDENTIFIER" | "IFCLABEL" | "IFCTEXT" | "IFCBOOLEAN" | "IFCCOUNTMEASURE" | "IFCPOSITIVELENGTHMEASURE";
  value: string | number | boolean;
  /** Native parameter identity, or the decoded type-name relationship. */
  evidence: string;
};
export type IfcStandardPropertySet = { name: string; properties: IfcStandardProperty[] };
export type IfcStandardPropertySource = {
  parameters?: readonly ElementParameter[];
  typeName?: string;
};

const COMMON: Readonly<Record<string, string>> = {
  IFCWALL: "Pset_WallCommon", IFCSLAB: "Pset_SlabCommon", IFCROOF: "Pset_RoofCommon",
  IFCDOOR: "Pset_DoorCommon", IFCWINDOW: "Pset_WindowCommon", IFCCOVERING: "Pset_CoveringCommon",
  IFCCURTAINWALL: "Pset_CurtainWallCommon", IFCCOLUMN: "Pset_ColumnCommon", IFCBEAM: "Pset_BeamCommon",
  IFCMEMBER: "Pset_MemberCommon", IFCPLATE: "Pset_PlateCommon", IFCSTAIR: "Pset_StairCommon",
  IFCSTAIRFLIGHT: "Pset_StairFlightCommon", IFCRAILING: "Pset_RailingCommon",
  IFCBUILDINGELEMENTPROXY: "Pset_BuildingElementProxyCommon",
};
const FIRE_RATED = new Set(["IFCWALL", "IFCSLAB", "IFCROOF", "IFCDOOR", "IFCWINDOW", "IFCCOVERING", "IFCCURTAINWALL", "IFCCOLUMN", "IFCBEAM", "IFCMEMBER", "IFCPLATE"]);

/** No category, display-label, geometric or missing-value inference. */
export function standardIfcPropertySets(
  entity: string,
  source: IfcStandardPropertySource,
  phaseNames?: ReadonlyMap<number, string>,
): IfcStandardPropertySet[] {
  entity = entity.toUpperCase();
  const sets = new Map<string, IfcStandardProperty[]>();
  const parameters = source.parameters ?? [];
  // Conflicting duplicate values are unresolved evidence, not first/last wins.
  const parameter = (id: number) => {
    const matches = parameters.filter((value) => value.parameterId === id);
    return matches.length && matches.every((value) => value.value === matches[0]!.value)
      ? matches[0] : undefined;
  };
  const add = (set: string, name: string, type: IfcStandardProperty["type"], value: IfcStandardProperty["value"], evidence: string) => {
    const properties = sets.get(set) ?? [];
    properties.push({ name, type, value, evidence });
    sets.set(set, properties);
  };
  const text = (set: string, name: string, id: number, type: "IFCLABEL" | "IFCIDENTIFIER" | "IFCTEXT" = "IFCLABEL") => {
    const candidate = parameter(id);
    if (typeof candidate?.value === "string" && candidate.value.trim()) {
      add(set, name, type, candidate.value, `Revit BuiltInParameter ${id}`);
    }
  };
  const common = COMMON[entity];
  if (common) {
    if (source.typeName?.trim()) {
      add(common, "Reference", "IFCIDENTIFIER", source.typeName, "Native instance-to-type relationship and decoded type name");
      add("Pset_QuantityTakeOff", "Reference", "IFCIDENTIFIER", source.typeName, "Native instance-to-type relationship and decoded type name");
    }
    if (FIRE_RATED.has(entity)) text(common, "FireRating", -1_001_206);
    if (entity === "IFCCOVERING") text(common, "Finish", -1_001_208, "IFCTEXT");
    const structuralId = entity === "IFCWALL" ? -1_001_596 : entity === "IFCSLAB" ? -1_001_954 : undefined;
    const structural = structuralId === undefined ? undefined : parameter(structuralId);
    if (structural && (structural.value === 0 || structural.value === 1)) {
      add(common, "LoadBearing", "IFCBOOLEAN", structural.value === 1, `Revit BuiltInParameter ${structuralId}`);
    }
    // Function has multiple enum values. Only the explicit interior/exterior
    // values are meaningful here; foundation/retaining/soffit are not booleans.
    if (entity === "IFCWALL" || entity === "IFCDOOR") {
      const func = parameter(-1_001_006);
      if (func && (func.value === 0 || func.value === 1)) {
        add(common, "IsExternal", "IFCBOOLEAN", func.value === 1, "Revit BuiltInParameter -1001006; 0 interior, 1 exterior");
      }
    }
    if (entity === "IFCSTAIRFLIGHT") {
      for (const [name, id, type] of [
        ["NumberOfRiser", -1_151_305, "IFCCOUNTMEASURE"],
        ["NumberOfTreads", -1_151_306, "IFCCOUNTMEASURE"],
        ["RiserHeight", -1_151_307, "IFCPOSITIVELENGTHMEASURE"],
        ["TreadLength", -1_151_308, "IFCPOSITIVELENGTHMEASURE"],
      ] as const) {
        const candidate = parameter(id);
        if (typeof candidate?.value !== "number" || !Number.isFinite(candidate.value) || candidate.value < 0) continue;
        if (type === "IFCCOUNTMEASURE" && !Number.isSafeInteger(candidate.value)) continue;
        if (type === "IFCPOSITIVELENGTHMEASURE" && candidate.value === 0) continue;
        add(common, name, type, type === "IFCPOSITIVELENGTHMEASURE" ? candidate.value * 0.3048 : candidate.value, `Revit BuiltInParameter ${id}${type === "IFCPOSITIVELENGTHMEASURE" ? "; feet converted to metres" : ""}`);
      }
    }
  }
  // Phase ids are references, not phase names. Only an explicitly resolved
  // native name may enter Revit's nonstandard Phasing interoperability set.
  for (const [name, id] of [["Phase Created", -1_012_100], ["Phase Demolished", -1_012_101]] as const) {
    const phase = parameter(id);
    if (!phase || typeof phase.value !== "number" || !Number.isSafeInteger(phase.value) || phase.value <= 0) continue;
    const phaseName = phaseNames?.get(phase.value);
    if (phaseName?.trim()) add("Phasing", name, "IFCLABEL", phaseName, `Revit BuiltInParameter ${id}; phase element ${phase.value} resolved to native name`);
  }
  return Array.from(sets, ([name, properties]) => ({ name, properties }));
}

/** Uses the exporter's STEP encoders and GUID namespace without duplicating them. */
export function emitStandardIfcPropertySets(
  writer: { add(value: string): number; refs(values: number[]): string },
  sets: readonly IfcStandardPropertySet[],
  ownerHistory: number,
  product: number,
  encode: { quoted(value: string): string; number(value: number): string; guid(kind: string): string },
): void {
  for (const set of sets) {
    if (!set.properties.length) continue;
    const properties = set.properties.map((property) => {
      const literal = typeof property.value === "string" ? encode.quoted(property.value)
        : typeof property.value === "boolean" ? (property.value ? ".T." : ".F.")
          : encode.number(property.value);
      return writer.add(`IFCPROPERTYSINGLEVALUE(${encode.quoted(property.name)},${encode.quoted(property.evidence)},${property.type}(${literal}),$)`);
    });
    const propertySet = writer.add(`IFCPROPERTYSET(${encode.quoted(encode.guid(`pset-standard:${set.name}`))},#${ownerHistory},${encode.quoted(set.name)},'Mapped from recovered native evidence; dimensional measures in SI',${writer.refs(properties)})`);
    writer.add(`IFCRELDEFINESBYPROPERTIES(${encode.quoted(encode.guid(`rel-standard:${set.name}`))},#${ownerHistory},$,$,(#${product}),#${propertySet})`);
  }
}
