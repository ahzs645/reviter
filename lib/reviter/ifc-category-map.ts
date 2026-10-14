/** IFC4 category choices follow rvt-rs category_map.rs, pinned 1c3d337.
 * Numeric Revit categories are authoritative; labels/family names are ignored.
 */
import type { ElementParameter } from "./element-parameters.ts";
import type { IfcSemanticClass } from "./ifc-export-semantics.ts";
import { uniqueParameter } from "./ifc-export-semantics.ts";

const BY_CATEGORY: ReadonlyMap<number, readonly [string, string?]> = new Map([
  [-2000011, ["IFCWALL"]], [-2000032, ["IFCSLAB", "FLOOR"]], [-2000035, ["IFCROOF"]], [-2000038, ["IFCCOVERING", "CEILING"]],
  [-2000023, ["IFCDOOR", "DOOR"]], [-2000014, ["IFCWINDOW", "WINDOW"]], [-2000100, ["IFCCOLUMN", "COLUMN"]], [-2001330, ["IFCCOLUMN", "COLUMN"]],
  [-2001320, ["IFCBEAM", "BEAM"]], [-2001336, ["IFCMEMBER", "CHORD"]], [-2000171, ["IFCMEMBER", "MULLION"]], [-2000170, ["IFCPLATE", "CURTAIN_PANEL"]],
  [-2000120, ["IFCSTAIR"]], [-2000919, ["IFCSTAIRFLIGHT"]], [-2000175, ["IFCRAILING"]], [-2000126, ["IFCRAILING"]],
  [-2000920, ["IFCSLAB", "LANDING"]], [-2000946, ["IFCMEMBER"]], [-2000127, ["IFCMEMBER"]], [-2000123, ["IFCMEMBER"]],
  [-2000080, ["IFCFURNITURE"]], [-2001100, ["IFCFURNITURE"]], [-2001000, ["IFCFURNITURE"]], [-2000180, ["IFCRAMP"]],
  [-2001263, ["IFCSLAB", "FLOOR"]], [-2001300, ["IFCFOOTING"]], [-2009000, ["IFCREINFORCINGBAR"]], [-2001052, ["IFCTRANSPORTELEMENT"]],
  [-2008000, ["IFCDUCTSEGMENT"]], [-2008020, ["IFCDUCTSEGMENT", "FLEXIBLESEGMENT"]], [-2008010, ["IFCDUCTFITTING"]],
  [-2008044, ["IFCPIPESEGMENT"]], [-2008050, ["IFCPIPESEGMENT", "FLEXIBLESEGMENT"]], [-2008049, ["IFCPIPEFITTING"]],
  [-2008013, ["IFCAIRTERMINAL"]], [-2001160, ["IFCSANITARYTERMINAL"]], [-2001120, ["IFCLIGHTFIXTURE"]],
  [-2008085, ["IFCALARM"]], [-2008083, ["IFCELECTRICAPPLIANCE"]], [-2001043, ["IFCELECTRICAPPLIANCE"]],
  [-2008130, ["IFCCABLECARRIERSEGMENT", "CABLETRAYSEGMENT"]], [-2008132, ["IFCCABLECARRIERSEGMENT", "CONDUITSEGMENT"]],
  [-2008126, ["IFCCABLECARRIERFITTING"]], [-2008128, ["IFCCABLECARRIERFITTING"]],
  [-2008099, ["IFCFIRESUPPRESSIONTERMINAL", "SPRINKLER"]],
]);

export function categoryIfcClass(categoryId: number | null | undefined, source?: { wallKind?: "basic" | "curtain" | "stacked"; parameters?: readonly ElementParameter[] }): IfcSemanticClass {
  let [entity, predefined = "NOTDEFINED"] = (categoryId == null ? undefined : BY_CATEGORY.get(categoryId)) ?? ["IFCBUILDINGELEMENTPROXY"];
  if (categoryId === -2000011 && source?.wallKind === "curtain") entity = "IFCCURTAINWALL";
  if (categoryId === -2001320) {
    const usage = uniqueParameter(source?.parameters ?? [], -1001381);
    if (usage === 4) predefined = "JOIST";
    if (usage === 5) { entity = "IFCMEMBER"; predefined = "PURLIN"; }
    if (usage === 7 || usage === 8 || usage === 9) { entity = "IFCMEMBER"; predefined = "BRACE"; }
    if (usage === 11) { entity = "IFCMEMBER"; predefined = "CHORD"; }
    if (usage === 12) { entity = "IFCMEMBER"; predefined = "MEMBER"; }
  }
  return { entity, typeEntity: `${entity}TYPE`, predefinedType: `.${predefined}.` };
}
