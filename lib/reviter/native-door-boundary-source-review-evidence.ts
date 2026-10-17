/** Portable authoring history only. No geometry, source application, route or
 * accessibility approval is issued by validating this metadata. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export type NativeDoorBoundarySourceReviewEvidence = {
  format: "source-door-boundary-closure-review-evidence-v1";
  sourceModelSha256: string;
  reviewSha256: string;
  review: unknown;
  /** Current family preserves every logical partition exactly. */
  partitionTransitions: unknown[];
};
const MAX_BYTES = 16 * 1024 * 1024;
const hash = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function fail(): never {
  throw Error("Invalid portable native door boundary source-review evidence");
}
const keys = (v: object, expected: string) =>
  Object.keys(v).sort().join(",") === expected;

export function validateNativeDoorBoundarySourceReviewEvidence(
  value: unknown,
  sourceModelSha256?: string,
): asserts value is NativeDoorBoundarySourceReviewEvidence[] | undefined {
  if (value === undefined) return;
  // Check descriptors before reading values: accessors and exotic containers
  // cannot hide additional mutable or unserializable provenance operands.
  let nodes = 0,
    chars = 0;
  const active = new Set<object>();
  function json(v: unknown, depth: number): void {
    if (++nodes > 500000 || depth > 64 || (chars += 2) > MAX_BYTES) fail();
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) fail();
      return;
    }
    if (typeof v === "string") {
      if ((chars += v.length) > MAX_BYTES) fail();
      return;
    }
    if (
      !v ||
      typeof v !== "object" ||
      active.has(v) ||
      Object.getOwnPropertySymbols(v).length
    )
      fail();
    if (
      Object.getPrototypeOf(v) !==
      (Array.isArray(v) ? Array.prototype : Object.prototype)
    )
      fail();
    const fields = Object.getOwnPropertyDescriptors(v);
    if (Object.values(fields).some((d) => !("value" in d))) fail();
    active.add(v);
    if (Array.isArray(v)) {
      if (Object.keys(v).length !== v.length) fail();
      for (let i = 0; i < v.length; i++) {
        const d = fields[String(i)];
        if (!d || !d.enumerable) fail();
        json(d.value, depth + 1);
      }
    } else
      for (const [key, d] of Object.entries(fields)) {
        if (!d.enumerable || (chars += key.length) > MAX_BYTES) fail();
        json(d.value, depth + 1);
      }
    active.delete(v);
  }
  json(value, 0);
  if (!Array.isArray(value) || !value.length || value.length > 1000) fail();
  const encoder = new TextEncoder();
  if (encoder.encode(JSON.stringify(value)).length > MAX_BYTES) fail();
  const seen = new Set<string>();
  for (const entry of value) {
    if (
      !entry ||
      Array.isArray(entry) ||
      !keys(
        entry,
        "format,partitionTransitions,review,reviewSha256,sourceModelSha256",
      ) ||
      entry.format !== "source-door-boundary-closure-review-evidence-v1" ||
      !hash(entry.sourceModelSha256) ||
      !hash(entry.reviewSha256) ||
      (sourceModelSha256 !== undefined &&
        entry.sourceModelSha256 !== sourceModelSha256) ||
      seen.has(entry.reviewSha256) ||
      !Array.isArray(entry.partitionTransitions) ||
      entry.partitionTransitions.length !== 0
    )
      fail();
    seen.add(entry.reviewSha256);
    const r = entry.review;
    if (
      !r ||
      typeof r !== "object" ||
      Array.isArray(r) ||
      !keys(
        r,
        "currentPreparedSnapshot,currentPreparedSnapshotSha256,descriptorBeforeSha256,entries,format,nativeCacheSha256,sourceBeforeSha256,sourceModelSha256,sourceRoomsSha256",
      ) ||
      r.format !== "source-door-boundary-closure-review-v1" ||
      r.sourceModelSha256 !== entry.sourceModelSha256 ||
      ![
        r.sourceRoomsSha256,
        r.nativeCacheSha256,
        r.sourceBeforeSha256,
        r.descriptorBeforeSha256,
        r.currentPreparedSnapshotSha256,
      ].every(hash) ||
      !r.currentPreparedSnapshot ||
      !keys(r.currentPreparedSnapshot, "bytes,path,sha256") ||
      typeof r.currentPreparedSnapshot.path !== "string" ||
      !r.currentPreparedSnapshot.path ||
      r.currentPreparedSnapshot.path.length > 4096 ||
      r.currentPreparedSnapshot.sha256 !== r.currentPreparedSnapshotSha256 ||
      !Number.isSafeInteger(r.currentPreparedSnapshot.bytes) ||
      r.currentPreparedSnapshot.bytes <= 0 ||
      r.currentPreparedSnapshot.bytes >= 2 ** 31 ||
      !Array.isArray(r.entries) ||
      !r.entries.length ||
      r.entries.length > 1000
    )
      fail();
    const ids = new Set<string>();
    for (const e of r.entries) {
      if (
        !e ||
        typeof e !== "object" ||
        Array.isArray(e) ||
        !keys(
          e,
          e.replacement === undefined
            ? "oldId,oldRecordSha256,reason,reviewState"
            : "oldId,oldRecordSha256,reason,replacement,reviewState",
        ) ||
        typeof e.oldId !== "string" ||
        !e.oldId ||
        e.oldId.length > 200 ||
        ids.has(e.oldId) ||
        !hash(e.oldRecordSha256) ||
        typeof e.reason !== "string" ||
        !e.reason.trim() ||
        e.reason.length > 10000 ||
        (e.reviewState !== "held" && e.reviewState !== "superseded") ||
        (e.reviewState === "superseded") !== (e.replacement !== undefined) ||
        (e.replacement !== undefined &&
          (!e.replacement ||
            typeof e.replacement !== "object" ||
            Array.isArray(e.replacement)))
      )
        fail();
      ids.add(e.oldId);
    }
    if (
      bytesToHex(sha256(encoder.encode(JSON.stringify(r)))) !==
      entry.reviewSha256
    )
      fail();
  }
}
