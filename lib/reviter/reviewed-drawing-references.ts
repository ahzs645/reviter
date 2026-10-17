import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Owner-reviewed semantics of exact original drawing imports. This does not
 * remove their source geometry, approve an enclosure or grant route/access. */
export type ReviewedDrawingReferences = {
  version: 1;
  sourceModelSha256: string;
  sourceInventorySha256: string;
  decisionEvidenceSha256: string;
  instances: {
    nativeElementId: number;
    nativeUniqueId: string;
    sourceFactSha256: string;
    sourceName: string;
    classification: "drawing-reference";
  }[];
  geometrySha256: string;
};
const digest = (value: unknown) => bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
const validSha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export function reviewedDrawingReferencesHash(value: Omit<ReviewedDrawingReferences, "geometrySha256"> | ReviewedDrawingReferences): string {
  const { geometrySha256: _, ...raw } = value as ReviewedDrawingReferences;
  return digest(raw);
}
export function validateReviewedDrawingReferences(value: ReviewedDrawingReferences | undefined, expectedModelSha256?: string): void {
  if (value === undefined) return;
  const fail = () => { throw Error("Invalid source-bound reviewed drawing references."); };
  if (!value || value.version !== 1 || !validSha(value.sourceModelSha256) ||
    (expectedModelSha256 !== undefined && value.sourceModelSha256 !== expectedModelSha256) ||
    !validSha(value.sourceInventorySha256) || !validSha(value.decisionEvidenceSha256) ||
    !validSha(value.geometrySha256) || !Array.isArray(value.instances) || value.instances.length > 10000 ||
    new Set(value.instances.map((entry) => entry?.nativeElementId)).size !== value.instances.length) fail();
  for (const entry of value.instances) {
    if (!entry || !Number.isSafeInteger(entry.nativeElementId) || entry.nativeElementId < 1 ||
      typeof entry.nativeUniqueId !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}-[a-f0-9]{8,16}$/.test(entry.nativeUniqueId) ||
      !validSha(entry.sourceFactSha256) || typeof entry.sourceName !== "string" ||
      !entry.sourceName.trim() || entry.sourceName.length > 2048 || entry.classification !== "drawing-reference") fail();
  }
  if (reviewedDrawingReferencesHash(value) !== value.geometrySha256) fail();
}
