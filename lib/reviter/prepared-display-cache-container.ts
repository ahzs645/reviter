import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

// Standalone cache metadata DTO. Source compilation does not consume display geometry.
export type PreparedDisplayOptions = Readonly<
  Record<string, boolean | string | number | null>
>;
export type PreparedDisplayAssetBinding = {
  version: 1;
  datasetSha256: string;
  enginePreparationSha256: string;
  levelIds: number[];
  building: string;
  windowMode: string;
  options: PreparedDisplayOptions;
};
export type PreparedDisplayChunk = {
  sha256: string;
  storedBytes: number;
  expandedBytes: number;
  expandedSha256: string;
};
export type PreparedDisplayAssetDescriptor = {
  version: 1;
  format: "openindoormaps-prepared-display-v1";
  encoding: "gzip-json-subtree-pool-v1";
  binding: PreparedDisplayAssetBinding;
  bindingSha256: string;
  logicalJsonSha256: string;
  logicalJsonBytes: number;
  pooledJsonSha256: string;
  pooledJsonBytes: number;
  poolEntries: number;
  chunks: PreparedDisplayChunk[];
};
export type PreparedDisplayAssetLimits = {
  storedChunkBytes: number;
  expandedChunkBytes: number;
  aggregateStoredBytes: number;
  aggregatePooledBytes: number;
  logicalJsonBytes: number;
  poolEntries: number;
  nodes: number;
  depth: number;
  chunks: number;
};
/** Limits apply to separate display assets, never enlarge indoor/viewer JSON limits. */
export const PREPARED_DISPLAY_ASSET_LIMITS: Readonly<PreparedDisplayAssetLimits> =
  Object.freeze({
    storedChunkBytes: 16 * 1024 * 1024,
    expandedChunkBytes: 64 * 1024 * 1024,
    aggregateStoredBytes: 128 * 1024 * 1024,
    aggregatePooledBytes: 256 * 1024 * 1024,
    logicalJsonBytes: 512 * 1024 * 1024,
    poolEntries: 200000,
    nodes: 50000000,
    depth: 128,
    chunks: 64,
  });
export class PreparedDisplayAssetError extends Error {
  readonly code: "binding" | "limit" | "checksum" | "format";
  constructor(
    code: "binding" | "limit" | "checksum" | "format",
    message: string,
  ) {
    super(`Prepared display asset: ${message}`);
    this.name = "PreparedDisplayAssetError";
    this.code = code;
  }
}
const encoder = new TextEncoder();
const hashPattern = /^[a-f0-9]{64}$/;
const digest = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
const hashText = (text: string) => digest(encoder.encode(text));
const integer = (n: unknown, maximum: number, minimum = 1): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= minimum && n <= maximum;
const fail = (code: PreparedDisplayAssetError["code"], text: string): never => {
  throw new PreparedDisplayAssetError(code, text);
};
function canonicalBinding(
  binding: PreparedDisplayAssetBinding,
): PreparedDisplayAssetBinding {
  if (
    !binding ||
    typeof binding !== "object" ||
    binding.version !== 1 ||
    !hashPattern.test(binding.datasetSha256) ||
    !hashPattern.test(binding.enginePreparationSha256) ||
    !Array.isArray(binding.levelIds) ||
    !binding.levelIds.length ||
    binding.levelIds.length > 256 ||
    binding.levelIds.some((n) => !Number.isSafeInteger(n)) ||
    new Set(binding.levelIds).size !== binding.levelIds.length ||
    typeof binding.building !== "string" ||
    binding.building.length > 256 ||
    typeof binding.windowMode !== "string" ||
    binding.windowMode.length > 256 ||
    !binding.options ||
    typeof binding.options !== "object" ||
    Array.isArray(binding.options)
  )
    fail("binding", "invalid binding");
  const options: Record<string, boolean | string | number | null> = {};
  for (const key of Object.keys(binding.options).sort()) {
    const value = binding.options[key];
    if (
      key.length > 256 ||
      !(
        value === null ||
        typeof value === "boolean" ||
        (typeof value === "string" && value.length <= 1024) ||
        (typeof value === "number" && Number.isFinite(value))
      )
    )
      fail("binding", "non-scalar option");
    Object.defineProperty(options, key, { value, enumerable: true });
  }
  if (Object.keys(options).length > 64) fail("binding", "too many options");
  return {
    version: 1,
    datasetSha256: binding.datasetSha256,
    enginePreparationSha256: binding.enginePreparationSha256,
    levelIds: [...binding.levelIds],
    building: binding.building,
    windowMode: binding.windowMode,
    options,
  };
}
export function preparedDisplayBindingSha256(
  binding: PreparedDisplayAssetBinding,
): string {
  return hashText(JSON.stringify(canonicalBinding(binding)));
}
/** Package import validates this lightweight metadata before any lazy inflate. */
export function validatePreparedDisplayAssetDescriptor(
  value: unknown,
  limits: PreparedDisplayAssetLimits = PREPARED_DISPLAY_ASSET_LIMITS,
): asserts value is PreparedDisplayAssetDescriptor {
  const descriptor = value as PreparedDisplayAssetDescriptor;
  if (
    !descriptor ||
    descriptor.version !== 1 ||
    descriptor.format !== "openindoormaps-prepared-display-v1" ||
    descriptor.encoding !== "gzip-json-subtree-pool-v1"
  )
    fail("format", "invalid asset header");
  if (
    preparedDisplayBindingSha256(descriptor.binding) !==
    descriptor.bindingSha256
  )
    fail("binding", "descriptor binding checksum mismatch");
  if (
    !integer(descriptor.pooledJsonBytes, limits.aggregatePooledBytes) ||
    !integer(descriptor.logicalJsonBytes, limits.logicalJsonBytes) ||
    !integer(descriptor.poolEntries, limits.poolEntries, 0) ||
    !Array.isArray(descriptor.chunks) ||
    !integer(descriptor.chunks.length, limits.chunks) ||
    !hashPattern.test(descriptor.pooledJsonSha256) ||
    !hashPattern.test(descriptor.logicalJsonSha256)
  )
    fail("limit", "invalid declared asset bounds");
  let expandedTotal = 0,
    storedTotal = 0;
  for (const c of descriptor.chunks) {
    if (
      !c ||
      typeof c !== "object" ||
      !hashPattern.test(c.sha256) ||
      !hashPattern.test(c.expandedSha256) ||
      !integer(c.storedBytes, limits.storedChunkBytes) ||
      !integer(c.expandedBytes, limits.expandedChunkBytes)
    )
      fail("limit", "invalid chunk bounds");
    expandedTotal += c.expandedBytes;
    storedTotal += c.storedBytes;
  }
  if (
    expandedTotal !== descriptor.pooledJsonBytes ||
    storedTotal > limits.aggregateStoredBytes
  )
    fail("limit", "aggregate chunk bound mismatch");
}


export type PreparedDisplayIndexEntry = { path: string; bytes: number; sha256: string };
export const PREPARED_DISPLAY_INDEX_PATH = "viewer/display/index.json";
export const PREPARED_DISPLAY_INDEX_LIMIT = 1024 * 1024;
export const PREPARED_DISPLAY_ARCHIVE_STORED_LIMIT = 128 * 1024 * 1024;
const chunkPattern = /^viewer\/display\/([a-f0-9]{64})\.bin$/;
export const isPreparedDisplayChunkPath = (path: string) => chunkPattern.test(path);
export const preparedDisplayChunkPath = (hash: string) => `viewer/display/${hash}.bin`;
export function preparedDisplayCacheEntryLimit(path: string): number | undefined {
  return path === PREPARED_DISPLAY_INDEX_PATH ? PREPARED_DISPLAY_INDEX_LIMIT : isPreparedDisplayChunkPath(path) ? PREPARED_DISPLAY_ASSET_LIMITS.storedChunkBytes : undefined;
}

/** Validate opaque DERIVED cache bytes only; never inflate/use these as source
 * geometry, routing, enclosure or absence authority during fresh compilation. */
export function validatePreparedDisplayCacheContainer(
  entry: PreparedDisplayIndexEntry | undefined,
  files: Record<string, Uint8Array>,
): ReadonlySet<string> {
  const listed = Object.keys(files).filter(path => path.startsWith("viewer/display/"));
  if (!entry) {
    if (listed.length) throw new Error("Unlisted prepared display entries.");
    return new Set();
  }
  const bytes = files[PREPARED_DISPLAY_INDEX_PATH];
  if (entry.path !== PREPARED_DISPLAY_INDEX_PATH || !bytes || !bytes.length || bytes.length > PREPARED_DISPLAY_INDEX_LIMIT || entry.bytes !== bytes.length || digest(bytes) !== entry.sha256) throw new Error("Damaged prepared display index.");
  const value: unknown = JSON.parse(new TextDecoder("utf-8", {fatal:true}).decode(bytes));
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "descriptors,version") throw new Error("Invalid prepared display index.");
  const index = value as {version:1;descriptors:PreparedDisplayAssetDescriptor[]};
  if (index.version !== 1 || !Array.isArray(index.descriptors) || !index.descriptors.length || index.descriptors.length > 32) throw new Error("Invalid prepared display descriptor inventory.");
  const bindings = new Set<string>(), paths = new Set([PREPARED_DISPLAY_INDEX_PATH]), uniqueChunks = new Set<string>();
  let stored = 0;
  for (const descriptor of index.descriptors) {
    validatePreparedDisplayAssetDescriptor(descriptor);
    if (bindings.has(descriptor.bindingSha256)) throw new Error("Duplicate prepared display scope binding.");
    bindings.add(descriptor.bindingSha256);
    for (const chunk of descriptor.chunks) {
      const path = preparedDisplayChunkPath(chunk.sha256), blob = files[path];
      if (!blob || blob.length !== chunk.storedBytes || digest(blob) !== chunk.sha256) throw new Error("Damaged prepared display chunk.");
      paths.add(path);
      if (!uniqueChunks.has(path)) { uniqueChunks.add(path); stored += blob.length; }
    }
  }
  if (stored > PREPARED_DISPLAY_ARCHIVE_STORED_LIMIT) throw new Error("Prepared display archive exceeds its stored budget.");
  if (listed.some(path => !paths.has(path))) throw new Error("Unlisted prepared display chunk.");
  return paths;
}
