/** Portable authoring provenance only. Retaining a source review does not
 * approve geometry or replace the original current/historical material checks. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export type NativeBoundarySourceReviewEvidence = {
  format: "source-native-boundary-review-evidence-v1";
  sourceModelSha256: string;
  reviewSha256: string;
  review: unknown;
};
const MAX_BYTES = 16 * 1024 * 1024;
const encoder = new TextEncoder();
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function fail(): never {
  throw Error("Invalid portable native boundary source-review evidence");
}

export function validateNativeBoundarySourceReviewEvidence(
  value: unknown,
  sourceModelSha256?: string,
): asserts value is NativeBoundarySourceReviewEvidence[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) fail();
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const entry of value) {
    if (!entry || Object.getPrototypeOf(entry) !== Object.prototype ||
      Object.getOwnPropertySymbols(entry).length ||
      Object.keys(entry).sort().join(",") !== "format,review,reviewSha256,sourceModelSha256" ||
      Object.values(Object.getOwnPropertyDescriptors(entry)).some(d => !('value' in d)) ||
      entry.format !== "source-native-boundary-review-evidence-v1" ||
      !hash(entry.sourceModelSha256) || !hash(entry.reviewSha256) ||
      (sourceModelSha256 !== undefined && entry.sourceModelSha256 !== sourceModelSha256) ||
      seen.has(entry.reviewSha256)) fail();
    seen.add(entry.reviewSha256);
    let nodes = 0, chars = 0;
    const active = new Set<object>();
    const json = (v: unknown, depth: number): void => {
      if (++nodes > 500000 || depth > 64 || (chars += 2) > MAX_BYTES) fail();
      if (v === null || typeof v === "boolean") return;
      if (typeof v === "number") { if (!Number.isFinite(v)) fail(); return; }
      if (typeof v === "string") { if ((chars += v.length) > MAX_BYTES) fail(); return; }
      if (!v || typeof v !== "object" || active.has(v) ||
        Object.getOwnPropertySymbols(v).length) fail();
      const proto = Object.getPrototypeOf(v);
      if (Array.isArray(v) ? proto !== Array.prototype : proto !== Object.prototype) fail();
      active.add(v);
      const fields = Object.getOwnPropertyDescriptors(v);
      if (Object.values(fields).some(d => !('value' in d))) fail();
      if (Array.isArray(v)) {
        if (Object.keys(v).length !== v.length) fail();
        for (let i = 0; i < v.length; i++) {
          if (!Object.hasOwn(fields, String(i))) fail();
          json(fields[String(i)]!.value, depth + 1);
        }
      } else for (const [key, field] of Object.entries(fields)) {
        if (!field.enumerable || (chars += key.length) > MAX_BYTES) fail();
        json(field.value, depth + 1);
      }
      active.delete(v);
    };
    json(entry.review, 0);
    const review = entry.review as Record<string, unknown>;
    if (!review || review.format !== "source-native-boundary-review-bundle-v1" ||
      review.sourceModelSha256 !== entry.sourceModelSha256 ||
      !hash(review.sourceRoomsSha256) || !hash(review.nativeCacheSha256) ||
      !Array.isArray(review.entries) || review.entries.length === 0 || review.entries.length > 100) fail();
    const bytes = encoder.encode(JSON.stringify(review));
    totalBytes += bytes.length;
    if (totalBytes > MAX_BYTES || bytesToHex(sha256(bytes)) !== entry.reviewSha256) fail();
  }
}
