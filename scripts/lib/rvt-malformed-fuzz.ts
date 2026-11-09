/** Deterministic, bounded regression fuzzing; does not require libFuzzer. */
import { createHash } from "node:crypto";

import { parseBasicFileInfoProperties, revitVersionFromBasicFileInfo } from "../../lib/reviter/basic-file-info.ts";
import { convertRvtBytes } from "../../lib/reviter/convert.ts";
import { parseElemTable } from "../../lib/reviter/elem-table.ts";
import { scanElementHeaders } from "../../lib/reviter/element-headers.ts";
import { setActiveElementIdBytes } from "../../lib/reviter/element-id-width.ts";
import { scanFramedElementObjects } from "../../lib/reviter/element-objects.ts";
import { decodeRevitDocumentHistory } from "../../lib/reviter/native-identity.ts";
import { parsePartitionNames } from "../../lib/reviter/partition-names.ts";
import { setActiveClassTagTranslation } from "../../lib/reviter/revit-class-tags.ts";
import { gzipOffsets, inflateRevitChunk } from "../../lib/reviter/revit-container.ts";
import { readSchema } from "../../lib/reviter/schema-reader.ts";
import {
  basicFileInfo,
  boundsPage,
  container,
  elemTable,
  formatsLatest,
  gzipChunk,
  partitionTable,
} from "../../tests/rich-rvt-fixture.ts";

export const DEFAULT_FUZZ_SEED = 0x525654;
export const MAX_FUZZ_CASES = 4096;
export const MAX_FUZZ_INPUT_BYTES = 4096;
const MAX_SAVED_FAILURES = 32;

export type FuzzOptions = { seed?: number; cases?: number; maxInputBytes?: number };
export type FuzzFailure = {
  target: string;
  caseId: string;
  kind: "accidental-throw" | "invalid-result" | "unexpected-refusal";
  message: string;
  /** Exact mutated parser input; converter envelopes can be rebuilt from it. */
  inputHex: string;
};
export type FuzzTargetStats = {
  target: string;
  runs: number;
  accepted: number;
  absent: number;
  structuredRefusals: number;
};
export type FuzzReport = {
  seed: number;
  cases: number;
  maxInputBytes: number;
  corpusDigest: string;
  targets: FuzzTargetStats[];
  failureCount: number;
  failures: FuzzFailure[];
};

type Target = {
  name: string;
  run: (data: Uint8Array) => "accepted" | "absent" | "structuredRefusals";
};

function reject(message: string): never {
  throw new Error(`invalid-result:${message}`);
}

function conversionStatus(input: Uint8Array): ReturnType<Target["run"]> {
  const result = convertRvtBytes(input, "fuzz.rvt", {
    revitVersion: 2027,
    maxSegments: 64,
    maxNativeMeshBytes: 16 << 10,
  });
  if (!result || typeof result.ok !== "boolean") {
    return reject("conversion lost its structured outcome");
  }
  if (!result.ok) {
    if (typeof result.error !== "string" || !result.error) return reject("refusal has no diagnostic");
    // The converter catches exceptions. A caught parser bug must not count
    // as the same success as an intentional public-API refusal.
    if (!/^(CFB file size|Header Signature|No Revit partition stream|The file opened, but no plausible geometry)/.test(result.error)) {
      throw new Error(`unexpected-refusal:${result.error}`);
    }
    return "structuredRefusals";
  }
  if (result.byteLength !== input.byteLength) return reject("conversion lost its byte length");
  if (result.meshes.some((mesh) => mesh.positions.some((value) => !Number.isFinite(value)))) return reject("non-finite scene coordinates");
  return "accepted";
}

function randomGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return (mixed ^ (mixed >>> 14)) >>> 0;
  };
}

function historySeed(): Uint8Array {
  const data = new Uint8Array(131);
  const view = new DataView(data.buffer);
  view.setUint16(0, 0x0552, true);
  view.setUint32(2, 1, true);
  view.setUint32(14, 1, true);
  view.setUint32(106, 1, true);
  data[110] = 1;
  data[126] = 0x28;
  return data;
}

function headerSeed(width: 4 | 8, extremeCount = false): Uint8Array {
  const data = new Uint8Array(96);
  const view = new DataView(data.buffer);
  const ownerAt = 16;
  const tagAt = ownerAt + width + 4;
  const length = 6 + 6 * width;
  if (width === 8) view.setBigUint64(ownerAt, 101n, true);
  else view.setUint32(ownerAt, 101, true);
  view.setUint32(tagAt - 4, length, true);
  view.setUint16(tagAt, 1540, true);
  view.setUint32(tagAt + 2, extremeCount ? 0xffff_ffff : 0, true);
  for (let index = 0; index < 6; index += 1) {
    const value = index === 0 ? -2_000_011 : -1;
    const at = tagAt + 6 + index * width;
    if (width === 8) view.setBigInt64(at, BigInt(value), true);
    else view.setInt32(at, value, true);
  }
  view.setUint32(tagAt + length, length, true);
  return data;
}

/** Exposed for reproducibility checks and future saved-crash corpus additions. */
export function malformedCorpus(options: FuzzOptions = {}): { id: string; data: Uint8Array }[] {
  const seed = options.seed ?? DEFAULT_FUZZ_SEED;
  const cases = options.cases ?? 128;
  const maxInputBytes = options.maxInputBytes ?? MAX_FUZZ_INPUT_BYTES;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new Error("seed must be a uint32");
  if (!Number.isInteger(cases) || cases < 1 || cases > MAX_FUZZ_CASES) throw new Error(`cases must be 1–${MAX_FUZZ_CASES}`);
  if (!Number.isInteger(maxInputBytes) || maxInputBytes < 512 || maxInputBytes > MAX_FUZZ_INPUT_BYTES) {
    throw new Error(`maxInputBytes must be 512–${MAX_FUZZ_INPUT_BYTES}`);
  }
  const seeds = [
    new Uint8Array(),
    basicFileInfo("2027"),
    elemTable([{ elementId: 101, ownerId: null }, { elementId: 102, ownerId: null }]),
    partitionTable(["Main Model"]),
    formatsLatest("Element", "Base", "Sibling"),
    historySeed(),
    boundsPage([{
      elementId: 101,
      categoryId: -2_000_011,
      recordCode: 1,
      box: { min: [0, 0, 0], max: [4, 1, 8] },
    }]),
    gzipChunk(new Uint8Array(256).fill(65)),
    Uint8Array.from([0x1f, 0x8b, 0x08, 0x1f, 0, 0, 0, 0, 0]),
    headerSeed(4),
    headerSeed(8),
    headerSeed(4, true),
    headerSeed(8, true),
    gzipChunk(new Uint8Array(20 << 10).fill(65)),
  ].map((data) => data.subarray(0, maxInputBytes));
  const random = randomGenerator(seed);
  return Array.from({ length: cases }, (_, index) => {
    const sourceIndex = index % seeds.length;
    const source = seeds[sourceIndex]!;
    let data = source.slice();
    const mutation = Math.floor(index / seeds.length) % 6;
    if (mutation === 1) data = data.slice(0, data.length ? random() % data.length : 0);
    if (mutation === 2) {
      data = new Uint8Array(Math.min(maxInputBytes, Math.max(16, source.length)));
      data.set(source);
      for (let at = 0; at < data.length; at += 1) data[at] = random() & 0xff;
    }
    if (mutation === 3 && data.length >= 4) {
      const at = random() % (data.length - 3);
      data.fill(0xff, at, at + 4); // extreme length/count, not a large allocation
    }
    if (mutation === 4 && data.length) {
      const flips = 1 + random() % 8;
      for (let flip = 0; flip < flips; flip += 1) data[random() % data.length] ^= 1 << (random() % 8);
    }
    if (mutation === 5) {
      const length = Math.min(maxInputBytes, data.length + 1 + random() % 64);
      const extended = new Uint8Array(length);
      extended.set(data);
      for (let at = data.length; at < length; at += 1) extended[at] = random() & 0xff;
      data = extended;
    }
    // Use nonzero-offset views to exercise DataView byteOffset handling.
    const padded = new Uint8Array(data.length + 7);
    padded.set(data, 3);
    return { id: `seed-${sourceIndex}-mutation-${mutation}-case-${index}`, data: padded.subarray(3, 3 + data.length) };
  });
}

export function runMalformedFuzz(options: FuzzOptions = {}): FuzzReport {
  const corpus = malformedCorpus(options);
  const targets: Target[] = [
    { name: "basic-file-info", run: (data) => {
      parseBasicFileInfoProperties(data);
      return revitVersionFromBasicFileInfo(data) == null ? "absent" : "accepted";
    } },
    { name: "element-table", run: (data) => parseElemTable(data) ? "accepted" : "absent" },
    { name: "partition-names", run: (data) => parsePartitionNames(data).length ? "accepted" : "absent" },
    { name: "schema", run: (data) => {
      const result = readSchema(data);
      if (result.ok) {
        if (result.schema.consumedBytes > data.length) return reject("schema consumed beyond input");
        return "accepted";
      }
      if (!result.error || result.offset < 0 || result.offset > data.length) return reject("schema failure offset/diagnostic");
      return "structuredRefusals";
    } },
    { name: "history", run: (data) => decodeRevitDocumentHistory(data, 2027).format === "unsupported" ? "structuredRefusals" : "accepted" },
    ...([4, 8] as const).map((width): Target => ({ name: `element-framing-${width * 8}`, run: (data) => {
      setActiveElementIdBytes(width);
      try {
        return scanElementHeaders(data).length + scanFramedElementObjects(data).length ? "accepted" : "absent";
      } finally {
        setActiveElementIdBytes(null);
      }
    } })),
    { name: "gzip-chunks", run: (data) => {
      const offsets = gzipOffsets(data, 32);
      const stream = data.slice();
      let accepted = false;
      for (const [index, offset] of offsets.entries()) {
        const result = inflateRevitChunk(stream, offset, offsets[index + 1], undefined, {
          maxChunkBytes: 16 << 10,
          maxStreamBytes: 32 << 10,
        });
        if (result && result.length > 16 << 10) return reject("inflation exceeded caller ceiling");
        accepted ||= result != null;
      }
      return accepted ? "accepted" : "absent";
    } },
    { name: "conversion-raw-refusal", run: (data) => {
      // Arbitrary CFB FAT metadata is outside this bounded corpus. Keep the
      // signature invalid here; valid envelopes are exercised below.
      const raw = data.slice();
      if (raw.length) raw[0] = 0;
      return conversionStatus(raw);
    } },
    { name: "conversion-partition", run: (data) => conversionStatus(container([
      { path: "/BasicFileInfo", bytes: basicFileInfo("2027") },
      { path: "/Partitions/Sheet0", bytes: gzipChunk(data) },
      { path: "/Formats/Latest", bytes: gzipChunk(formatsLatest("Element", "Base", "Sibling")) },
    ])) },
  ];
  const failures: FuzzFailure[] = [];
  let failureCount = 0;
  const stats: FuzzTargetStats[] = [];
  const digest = createHash("sha256");
  for (const item of corpus) digest.update(item.id).update(item.data);
  setActiveClassTagTranslation(null);
  setActiveElementIdBytes(null);
  for (const target of targets) {
    const row: FuzzTargetStats = { target: target.name, runs: 0, accepted: 0, absent: 0, structuredRefusals: 0 };
    for (const item of corpus) {
      row.runs += 1;
      try {
        row[target.run(item.data)] += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const kind = message.startsWith("invalid-result:") ? "invalid-result"
          : message.startsWith("unexpected-refusal:") ? "unexpected-refusal" : "accidental-throw";
        failureCount += 1;
        if (failures.length < MAX_SAVED_FAILURES) {
          failures.push({ target: target.name, caseId: item.id, kind, message, inputHex: Buffer.from(item.data).toString("hex") });
        }
      }
    }
    stats.push(row);
  }
  setActiveClassTagTranslation(null);
  setActiveElementIdBytes(null);
  return {
    seed: options.seed ?? DEFAULT_FUZZ_SEED,
    cases: corpus.length,
    maxInputBytes: options.maxInputBytes ?? MAX_FUZZ_INPUT_BYTES,
    corpusDigest: digest.digest("hex"),
    targets: stats,
    failureCount,
    failures,
  };
}
