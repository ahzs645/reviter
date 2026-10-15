/** Compare type identities through each product's actual RelDefinesByType. */
import { isIfcGlobalId } from "../../lib/reviter/ifc-global-id.ts";
import { stepArguments, stepRecords } from "./ifc-comparison-stats.ts";

type TypeLink = { productId: number; productEntity: string; typeEntity: string; globalId: string };

function linksByTag(source: string): Map<string, TypeLink[]> {
  const roots = new Map<number, { entity: string; args: string[] }>();
  const relations: string[][] = [];
  for (const record of stepRecords(source)) {
    if (record.entity === "IFCRELDEFINESBYTYPE") relations.push(stepArguments(record.body));
    else if (/^\s*'/.test(record.body)) {
      const args = stepArguments(record.body);
      if (isIfcGlobalId(args[0]?.slice(1, -1))) roots.set(record.id, { entity: record.entity, args });
    }
  }
  const result = new Map<string, TypeLink[]>();
  for (const args of relations) {
    const typeId = /^#(\d+)$/.exec(args[5] ?? "")?.[1];
    const type = typeId == null ? undefined : roots.get(Number(typeId));
    if (!type || !/(?:TYPE|STYLE)$|^IFCTYPE(?:PRODUCT|OBJECT)$/.test(type.entity)) continue;
    for (const match of (args[4] ?? "").matchAll(/#(\d+)/g)) {
      const productId = Number(match[1]);
      const product = roots.get(productId);
      if (!product || /^IFC(?:SPACE$|BUILDING$|BUILDINGSTOREY|SITE|PROJECT|REL|PROPERTY|ELEMENTQUANTITY)/.test(product.entity)) continue;
      const tag = /^'([0-9]+)'$/.exec(product.args[7] ?? "")?.[1];
      if (tag == null) continue;
      const links = result.get(tag) ?? [];
      links.push({ productId, productEntity: product.entity, typeEntity: type.entity, globalId: type.args[0]!.slice(1, -1) });
      result.set(tag, links);
    }
  }
  return result;
}

export function compareIfcTypeGlobalIds(exported: string, reference: string) {
  const output = linksByTag(exported), truth = linksByTag(reference);
  let matched = 0, mismatched = 0, ambiguous = 0, outputOnly = 0, referenceOnly = 0;
  const byEntity: Record<string, { compared: number; matched: number; mismatched: number }> = {};
  const mismatchExamples: Array<{ tag: string; referenceTypeEntity: string; exportedTypeEntity: string; referenceGlobalId: string; exportedGlobalId: string }> = [];
  for (const [tag, ownLinks] of output) {
    const truthLinks = truth.get(tag);
    if (!truthLinks) { outputOnly += 1; continue; }
    if (ownLinks.length !== 1 || truthLinks.length !== 1) { ambiguous += 1; continue; }
    const own = ownLinks[0]!, ref = truthLinks[0]!;
    const counts = byEntity[`${ref.typeEntity} -> ${own.typeEntity}`] ??= { compared: 0, matched: 0, mismatched: 0 };
    counts.compared += 1;
    if (own.globalId === ref.globalId) { matched += 1; counts.matched += 1; }
    else {
      mismatched += 1; counts.mismatched += 1;
      if (mismatchExamples.length < 30) mismatchExamples.push({ tag, referenceTypeEntity: ref.typeEntity, exportedTypeEntity: own.typeEntity, referenceGlobalId: ref.globalId, exportedGlobalId: own.globalId });
    }
  }
  for (const tag of truth.keys()) if (!output.has(tag)) referenceOnly += 1;
  return {
    join: "IfcRelDefinesByType -> product's exact decimal Tag; duplicate products/relations excluded",
    compared: matched + mismatched, matched, mismatched, ambiguous,
    outputOnly, referenceOnly, exportedTypedTags: output.size, referenceTypedTags: truth.size,
    byEntity, mismatchExamples,
  };
}
