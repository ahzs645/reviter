import { MAX_REVIEW_BYTES } from "./review-bundle-limits.ts";
import { deflateSync } from "fflate";
import {
  MAX_REVIEW_FILES,
  validateReviewBundle,
  type ReviewBundle,
} from "./review-bundle-core.ts";
import { boundedInflate } from "./review-bundle-inflate.ts";

const MAX_FILE = 32 * 1024 * 1024;
const MAX_TOTAL = MAX_REVIEW_BYTES;
const MAX_HEADER = 1024 * 1024;
const MAX_CONTAINER = MAX_TOTAL + MAX_HEADER;
export const REVIEW_BUNDLE_ARCHIVE_PATH = "review/companions.bin";
export const REVIEW_BUNDLE_ARCHIVE_LIMIT = MAX_CONTAINER;
const JSON_LIMIT = 64 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const fail = () => {
  throw new Error("Invalid packed review companion container.");
};
const hash = async (bytes: Uint8Array) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
const base64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
};
const unbase64 = (value: string) => {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return fail();
  try {
    return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  } catch {
    return fail();
  }
};
export type PackedReviewBundle = {
  format: "openindoormaps-review-bundle-wire";
  version: 1;
  encoding: "deflate-binary-v1";
  bytes: number;
  sha256: string;
  compressedBase64: string;
};
/** Legacy metadata alone cannot certify a compressed companion. Check its
 * actual bounded expansion and checksum before either package import/export. */
export async function verifyReviewBundleContent(value: unknown) {
  validateReviewBundle(value);
  for (const file of value?.files ?? []) {
    const raw = boundedInflate(unbase64(file.compressedBase64), file.bytes);
    if ((await hash(raw)) !== file.sha256) fail();
  }
}
type HeaderFile = Omit<ReviewBundle["files"][number], "compressedBase64"> & {
  mode: "raw" | "compressed";
  storedBytes: number;
  // Preserve even noncanonical legacy padding/last sextet spelling exactly.
  base64Ending?: string;
  base64Length?: number;
};

/** Raw mode is permitted only when default recompression reproduces the exact
 * original companion stream. Otherwise retain its original compressed bytes. */
export async function packReviewBundle(
  bundle: ReviewBundle,
): Promise<PackedReviewBundle> {
  validateReviewBundle(bundle);
  const files: HeaderFile[] = [],
    parts: Uint8Array[] = [];
  for (const file of bundle.files) {
    const compressed = unbase64(file.compressedBase64);
    const raw = boundedInflate(compressed, file.bytes);
    if ((await hash(raw)) !== file.sha256) fail();
    const recompressed = base64(deflateSync(raw));
    const canonical = base64(compressed);
    const mode = recompressed === file.compressedBase64 ? "raw" : "compressed";
    const part = mode === "raw" ? raw : compressed;
    files.push({
      path: file.path,
      bytes: file.bytes,
      sha256: file.sha256,
      mode,
      storedBytes: part.length,
      ...(canonical !== file.compressedBase64
        ? {
            base64Ending: file.compressedBase64.slice(-4),
            base64Length: file.compressedBase64.length,
          }
        : {}),
    });
    parts.push(part);
  }
  const header = encoder.encode(
    JSON.stringify({ version: 1, masterSha256: bundle.masterSha256, files }),
  );
  const length = 4 + header.length + parts.reduce((n, p) => n + p.length, 0);
  if (header.length > MAX_HEADER || length > MAX_CONTAINER) fail();
  const raw = new Uint8Array(length);
  new DataView(raw.buffer).setUint32(0, header.length, true);
  raw.set(header, 4);
  let offset = 4 + header.length;
  for (const part of parts) {
    raw.set(part, offset);
    offset += part.length;
  }
  return {
    format: "openindoormaps-review-bundle-wire",
    version: 1,
    encoding: "deflate-binary-v1",
    bytes: length,
    sha256: await hash(raw),
    compressedBase64: base64(deflateSync(raw, { level: 9 })),
  };
}

/** Hydrate normal in-memory companions before their existing validation/UI.
 * Legacy bundles remain untouched. The outer and each individual file are
 * bounded and checksummed; no packed payload is executable source material. */
export async function unpackReviewBundle(
  value: unknown,
  archiveFiles?: Record<string, Uint8Array>,
): Promise<ReviewBundle | undefined> {
  if (
    !value ||
    (value as PackedReviewBundle).format !== "openindoormaps-review-bundle-wire"
  ) {
    await verifyReviewBundleContent(value);
    return value as ReviewBundle | undefined;
  }
  let wire = value as PackedReviewBundle;
  if ((value as PackedReviewBundleReference).storage === "archive-entry") {
    const ref = value as PackedReviewBundleReference;
    const bytes = archiveFiles?.[REVIEW_BUNDLE_ARCHIVE_PATH];
    if (
      ref.path !== REVIEW_BUNDLE_ARCHIVE_PATH ||
      !bytes ||
      bytes.length > REVIEW_BUNDLE_ARCHIVE_LIMIT ||
      bytes.length !== ref.compressedBytes ||
      !/^[a-f0-9]{64}$/.test(ref.compressedSha256) ||
      (await hash(bytes)) !== ref.compressedSha256
    )
      fail();
    wire = {
      format: ref.format,
      version: ref.version,
      encoding: ref.encoding,
      bytes: ref.bytes,
      sha256: ref.sha256,
      compressedBase64: base64(bytes!),
    };
  }
  if (
    wire.version !== 1 ||
    wire.encoding !== "deflate-binary-v1" ||
    !Number.isSafeInteger(wire.bytes) ||
    wire.bytes < 4 ||
    wire.bytes > MAX_CONTAINER ||
    !/^[a-f0-9]{64}$/.test(wire.sha256) ||
    typeof wire.compressedBase64 !== "string" ||
    wire.compressedBase64.length > MAX_CONTAINER * 2
  )
    fail();
  const raw = boundedInflate(unbase64(wire.compressedBase64), wire.bytes);
  if ((await hash(raw)) !== wire.sha256) fail();
  if (base64(deflateSync(raw, { level: 9 })) !== wire.compressedBase64) fail();
  const headerLength = new DataView(
    raw.buffer,
    raw.byteOffset,
    raw.byteLength,
  ).getUint32(0, true);
  if (headerLength > MAX_HEADER || headerLength > raw.length - 4) fail();
  const header = JSON.parse(
    decoder.decode(raw.subarray(4, 4 + headerLength)),
  ) as { version: number; masterSha256: string; files: HeaderFile[] };
  if (
    header.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(header.masterSha256) ||
    !Array.isArray(header.files) ||
    header.files.length > MAX_REVIEW_FILES
  )
    fail();
  let total = 0,
    offset = 4 + headerLength;
  const files: ReviewBundle["files"] = [];
  // Validate all metadata before expanding any per-file compressed stream.
  for (const f of header.files) {
    if (
      !f ||
      !["raw", "compressed"].includes(f.mode) ||
      !Number.isSafeInteger(f.bytes) ||
      f.bytes < 0 ||
      f.bytes > MAX_FILE ||
      !Number.isSafeInteger(f.storedBytes) ||
      f.storedBytes < 0 ||
      f.storedBytes > MAX_FILE * 2 ||
      !/^[a-f0-9]{64}$/.test(f.sha256) ||
      (f.mode === "raw" && f.storedBytes !== f.bytes)
    )
      fail();
    if (
      f.base64Ending !== undefined &&
      (f.mode !== "compressed" ||
        typeof f.base64Ending !== "string" ||
        f.base64Ending.length > 4 ||
        !Number.isSafeInteger(f.base64Length) ||
        f.base64Length! < f.base64Ending.length ||
        f.base64Length! > MAX_FILE * 2)
    )
      fail();
    total += f.bytes;
    offset += f.storedBytes;
    if (total > MAX_TOTAL || offset > raw.length) fail();
    files.push({
      path: f.path,
      bytes: f.bytes,
      sha256: f.sha256,
      compressedBase64: "",
    });
  }
  if (offset !== raw.length) fail();
  const bundle: ReviewBundle = {
    version: 1,
    masterSha256: header.masterSha256,
    files,
  };
  validateReviewBundle(bundle);
  offset = 4 + headerLength;
  for (let i = 0; i < header.files.length; i++) {
    const f = header.files[i],
      part = raw.subarray(offset, offset + f.storedBytes);
    offset += f.storedBytes;
    const content = f.mode === "raw" ? part : boundedInflate(part, f.bytes);
    if ((await hash(content)) !== f.sha256) fail();
    let compressedBase64 = base64(
      f.mode === "raw" ? deflateSync(content) : part,
    );
    if (f.base64Ending !== undefined) {
      compressedBase64 =
        compressedBase64.slice(0, f.base64Length! - f.base64Ending.length) +
        f.base64Ending;
      const restored = unbase64(compressedBase64);
      if (
        restored.length !== part.length ||
        restored.some((n, k) => n !== part[k])
      )
        fail();
    }
    files[i].compressedBase64 = compressedBase64;
  }
  validateReviewBundle(bundle);
  return bundle;
}

/** The existing rooms JSON ceiling is unchanged. Only oversized authoring
 * bundles gain compact wire storage; normal legacy exports keep exact JSON. */
export async function serializeRoomsWithReviewBundle<
  T extends { reviewBundle?: ReviewBundle },
>(rooms: T, maxBytes = JSON_LIMIT) {
  const legacy = encoder.encode(JSON.stringify(rooms));
  if (legacy.length <= maxBytes) {
    await verifyReviewBundleContent(rooms.reviewBundle);
    return legacy;
  }
  if (!rooms.reviewBundle)
    throw new Error("Source rooms JSON exceeds its size limit.");
  const packed = encoder.encode(
    JSON.stringify({
      ...rooms,
      reviewBundle: await packReviewBundle(rooms.reviewBundle),
    }),
  );
  if (packed.length > maxBytes)
    throw new Error(
      "Source rooms JSON exceeds its size limit after lossless review packing.",
    );
  return packed;
}

export type PackedReviewBundleReference = Omit<
  PackedReviewBundle,
  "compressedBase64"
> & {
  storage: "archive-entry";
  path: typeof REVIEW_BUNDLE_ARCHIVE_PATH;
  compressedBytes: number;
  compressedSha256: string;
};
/** If opaque historical packs still exceed the JSON ceiling, keep the exact
 * same bounded container as a separately checksummed binary archive entry.
 * Only its reference occupies rooms JSON; the normal bundle hydrates on read. */
export async function serializeRoomsForArchive<
  T extends { reviewBundle?: ReviewBundle },
>(
  rooms: T,
  maxBytes = JSON_LIMIT,
): Promise<{
  rooms: Uint8Array;
  reviewEntry?: {
    path: typeof REVIEW_BUNDLE_ARCHIVE_PATH;
    bytes: Uint8Array;
    sha256: string;
  };
}> {
  const legacy = encoder.encode(JSON.stringify(rooms));
  if (legacy.length <= maxBytes) {
    await verifyReviewBundleContent(rooms.reviewBundle);
    return { rooms: legacy };
  }
  if (!rooms.reviewBundle)
    throw new Error("Source rooms JSON exceeds its size limit.");
  const wire = await packReviewBundle(rooms.reviewBundle);
  const inline = encoder.encode(
    JSON.stringify({ ...rooms, reviewBundle: wire }),
  );
  if (inline.length <= maxBytes) return { rooms: inline };
  const bytes = unbase64(wire.compressedBase64);
  if (bytes.length > REVIEW_BUNDLE_ARCHIVE_LIMIT) fail();
  const sha256 = await hash(bytes);
  const { compressedBase64: _, ...metadata } = wire;
  const ref: PackedReviewBundleReference = {
    ...metadata,
    storage: "archive-entry",
    path: REVIEW_BUNDLE_ARCHIVE_PATH,
    compressedBytes: bytes.length,
    compressedSha256: sha256,
  };
  const serialized = encoder.encode(
    JSON.stringify({ ...rooms, reviewBundle: ref }),
  );
  if (serialized.length > maxBytes)
    throw new Error(
      "Source rooms JSON exceeds its size limit after lossless review packing.",
    );
  return {
    rooms: serialized,
    reviewEntry: { path: REVIEW_BUNDLE_ARCHIVE_PATH, bytes, sha256 },
  };
}
