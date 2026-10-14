import { getInheritanceChainForEntity } from "@ifc-lite/parser";

/** Recovered occurrences, excluding containers and constructed relationships. */
export function isRecoveryTaggedProduct(type: string): boolean {
  const chain = getInheritanceChainForEntity(type);
  if (!chain.includes("IfcProduct")) return false;
  return !chain.some((ancestor) => [
    "IfcSpatialElement", "IfcSpatialStructureElement", "IfcFeatureElement", "IfcPort",
  ].includes(ancestor));
}
