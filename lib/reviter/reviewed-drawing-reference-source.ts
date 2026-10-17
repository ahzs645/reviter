import type { ConvertResult } from "./types.ts";
import {
  nativeDrawingReferenceSourceHash,
  nativeDrawingReferenceInstanceHash,
} from "./native-drawing-reference-source.ts";
import { validateReviewedDrawingReferences, type ReviewedDrawingReferences } from "./reviewed-drawing-references.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const validSha = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/** Verify semantics against independently decoded original ImportInstance and
 * MasterImportSymbol facts. An annotation cannot impersonate a native wall or
 * a different revision/import with a copied filename. Geometry is retained. */
export function reviewedDrawingReferenceElementIds(
  model: ConvertResult,
  review: ReviewedDrawingReferences | undefined,
  expectedSourceModelSha256: string,
): Set<number> {
  validateReviewedDrawingReferences(review, expectedSourceModelSha256);
  if (review === undefined) return new Set();
  const source = model.nativeDrawingReferenceSource;
  if (!source || source.version !== 1 || source.sourceModelSha256 !== expectedSourceModelSha256 || !validSha(source.schemaSha256) ||
    source.geometrySha256 !== nativeDrawingReferenceSourceHash(source) ||
    review.sourceInventorySha256 !== source.geometrySha256 || !Array.isArray(source.instances))
    throw Error("Reviewed drawings require the matching original import source inventory.");
  const selected = new Set<number>();
  for (const entry of review.instances) {
    const facts = source.instances.filter((fact) => fact.nativeElementId === entry.nativeElementId);
    const identities = model.nativeIdentity?.identities.filter((identity) => identity.elementId === entry.nativeElementId) ?? [];
    const bounds = model.elementBounds.filter((element) => element.elementId === entry.nativeElementId);
    const fact = facts[0];
    // Source-only imports need not have renderable bounds. A missing bounds
    // record cannot remove any material row; duplicate records remain invalid.
    if (facts.length !== 1 || identities.length !== 1 || bounds.length > 1 || !fact ||
      identities[0]!.uniqueId !== entry.nativeUniqueId ||
      identities[0]!.provenance !== "Global/ElemTable.ElementHistory+Global/History.Episode" ||
      fact.sourceClass !== "ImportInstance" || fact.masterSourceClass !== "MasterImportSymbol" ||
      !Number.isSafeInteger(fact.masterSymbolId) || fact.masterSymbolId < 1 ||
      !validSha(fact.instanceFrameSha256) || !validSha(fact.masterFrameSha256) ||
      !validSha(fact.sourceFileNameSha256) || fact.sourceFileNameSha256 !== bytesToHex(sha256(new TextEncoder().encode(fact.sourceFileName))) ||
      nativeDrawingReferenceInstanceHash(fact) !== entry.sourceFactSha256 ||
      fact.sourceFileName !== entry.sourceName ||
      (bounds[0]?.familySymbolId !== undefined && bounds[0].familySymbolId !== fact.masterSymbolId))
      throw Error(`Reviewed drawing #${entry.nativeElementId} does not match its original source identity.`);
    selected.add(entry.nativeElementId);
  }
  return selected;
}
