/**
 * The shared harness for `scripts/`.
 *
 * Every audit and probe in this directory repeats the same four things: open an
 * RVT compound file, walk its checksum-paged partitions through the cross-chunk
 * inflate window, parse a handful of `--flag value` arguments, and print a JSON
 * report. Before this file each of those was retyped per script — the
 * container sequence at 51 sites across 48 files, an `option()` parser in 12
 * files with four incompatible signatures, `splitStepArgs` in 10, and so on.
 * A retyped copy is a copy that can drift, and the container sequence is the
 * one that must not: the dictionary carried between chunks
 * (`revitWindowTail`) recovers 273 of 332 otherwise unreadable chunks, and a
 * script that forgets it silently measures a smaller building.
 *
 * Nothing here decodes anything. It is the plumbing around
 * `lib/reviter/revit-container.ts`, which stays the single source of truth for
 * what a Revit stream is; this module only stops each caller from rebuilding
 * the same loop around it.
 *
 * ```ts
 * import { openRvt, requireModelPath, iterateInflatedChunks } from "./lib/rvt-harness.ts";
 *
 * const model = openRvt(requireModelPath("audit-thing.ts model.rvt"));
 * model.requireRelease(2027);
 * for (const chunk of iterateInflatedChunks(model)) { … }
 * ```
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import CFB from "cfb";

import { revitVersionFromBasicFileInfo } from "../../lib/reviter/basic-file-info.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../../lib/reviter/revit-container.ts";

/* ------------------------------------------------------------------ *
 * Arguments
 * ------------------------------------------------------------------ */

/** The arguments this process was invoked with, flags and positionals alike. */
export const argv: readonly string[] = process.argv.slice(2);

let usageLine: string | null = null;

/**
 * Declare this script's one-line invocation.
 *
 * It is what `--help` prints and what a missing-argument error appends, so the
 * usage text is written once rather than pasted into every `throw` — which is
 * how the copies this replaces drifted, several of them naming flags the script
 * no longer took. Call it before reading any argument.
 */
export function declareUsage(text: string): void {
  usageLine = text;
  helpExit(text);
}

function missing(name: string): Error {
  return new Error(
    usageLine == null ? `Missing ${name}` : `Missing ${name}\nusage: ${usageLine}`,
  );
}

/**
 * The value following `name`, or `null`.
 *
 * This is the one signature. The twelve copies it replaces disagreed on
 * whether a missing option threw, returned `null`, or depended on a second
 * `required` parameter whose default flipped between call sites — so a reader
 * could not tell from `option("--json")` alone what happened when `--json` was
 * absent. Here the question is answered by which function you call.
 */
export function optionValue(
  name: string,
  from: readonly string[] = argv,
): string | null {
  const index = from.indexOf(name);
  if (index < 0) return null;
  const value = from[index + 1];
  return value == null || value.startsWith("--") ? null : value;
}

/** The value following `name`, resolved as a path, or `null`. */
export function optionalPath(
  name: string,
  from: readonly string[] = argv,
): string | null {
  const value = optionValue(name, from);
  return value == null ? null : resolve(value);
}

/** The value following `name`, resolved as a path. Throws when absent. */
export function requirePath(
  name: string,
  from: readonly string[] = argv,
): string {
  const value = optionalPath(name, from);
  if (value == null) throw missing(name);
  return value;
}

/** Whether the bare flag `name` was passed. */
export function hasFlag(name: string, from: readonly string[] = argv): boolean {
  return from.includes(name);
}

/**
 * The value following `name` parsed as a finite number, or `fallback`.
 */
export function numberOption(
  name: string,
  fallback: number,
  from: readonly string[] = argv,
): number {
  const value = optionValue(name, from);
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} expects a number, received ${value}`);
  }
  return parsed;
}

/**
 * Arguments that are neither a flag nor a flag's value.
 *
 * `--json out.json model.rvt` and `model.rvt --json out.json` both yield
 * `["model.rvt"]`, which is what a caller taking a positional model path wants.
 */
export function positionals(from: readonly string[] = argv): string[] {
  const result: string[] = [];
  for (let index = 0; index < from.length; index += 1) {
    const value = from[index]!;
    if (value.startsWith("--")) {
      const next = from[index + 1];
      if (next != null && !next.startsWith("--")) index += 1;
      continue;
    }
    result.push(value);
  }
  return result;
}

/** Whether `--help` or `-h` was passed. */
export function wantsHelp(from: readonly string[] = argv): boolean {
  return from.includes("--help") || from.includes("-h");
}

/**
 * Print `usage` and exit 0 when `--help` was passed.
 *
 * Called before any file is read so that `--help` works on a machine that has
 * no model, which is the state most readers of this directory are in.
 */
export function helpExit(usage: string, from: readonly string[] = argv): void {
  if (!wantsHelp(from)) return;
  process.stdout.write(`usage: ${usage}\n`);
  process.exit(0);
}

/** The declared usage line, or a generic one. */
export function usageText(): string {
  return usageLine ?? "see the header comment of this script";
}

/**
 * The first positional argument, or a usage error.
 *
 * `usage` is the one-line invocation, without the leading `usage:`.
 */
export function requireModelPath(
  usage: string,
  from: readonly string[] = argv,
): string {
  declareUsage(usage);
  const [first] = positionals(from);
  if (!first) throw new Error(`usage: ${usage}`);
  return resolve(first);
}

/**
 * Whether this module's file is the process entry point.
 *
 * Pass `import.meta.url`. Scripts that are also imported — `overlay-diff.ts`,
 * `audit-coverage.ts`, `holdout.ts` — guard their CLI block with this so that
 * importing them does not run a conversion.
 */
export function isEntryPoint(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(importMetaUrl) === resolve(entry);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

/**
 * Write `report` as indented JSON to `path`, or to stdout when `path` is null.
 *
 * Returns the path written, so a caller can log it.
 */
export function writeJsonReport(
  path: string | null,
  report: unknown,
): string | null {
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (path == null) {
    process.stdout.write(text);
    return null;
  }
  writeFileSync(path, text);
  return path;
}

/** `count / total` as a percentage string, with `total === 0` reading `n/a`. */
export function percent(count: number, total: number, digits = 1): string {
  if (total === 0) return "n/a";
  return `${((count / total) * 100).toFixed(digits)}%`;
}

/** `numerator / denominator`, or `null` when the denominator is zero. */
export function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/** Hex SHA-256, the identity every audit stamps its inputs with. */
export function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/* ------------------------------------------------------------------ *
 * Counting
 * ------------------------------------------------------------------ */

/** Add `amount` to `map`'s entry for `key`, starting from zero. */
export function increment<Key>(
  map: Map<Key, number>,
  key: Key,
  amount = 1,
): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

/**
 * A count map as a JSON-safe record, most frequent first.
 *
 * Ties break on the key rendered numerically, so `10` sorts after `9` rather
 * than after `1`. The copies this replaces disagreed here: some sorted on
 * count alone, which made their JSON output depend on `Map` insertion order
 * and so on the order of the file being read.
 */
export function countsByFrequency<Key extends string | number | bigint>(
  map: ReadonlyMap<Key, number>,
  limit?: number,
): Record<string, number> {
  const sorted = [...map].sort(
    (left, right) =>
      right[1] - left[1] ||
      String(left[0]).localeCompare(String(right[0]), "en", { numeric: true }),
  );
  return Object.fromEntries(
    (limit == null ? sorted : sorted.slice(0, limit)).map(([key, count]) => [
      String(key),
      count,
    ]),
  );
}

/** A count map as a JSON-safe record, ordered by key rather than by count. */
export function countsByKey<Key extends string | number | bigint>(
  map: ReadonlyMap<Key, number>,
): Record<string, number> {
  return Object.fromEntries(
    [...map]
      .sort((left, right) =>
        String(left[0]).localeCompare(String(right[0]), "en", {
          numeric: true,
        }),
      )
      .map(([key, count]) => [String(key), count]),
  );
}

/* ------------------------------------------------------------------ *
 * The container
 * ------------------------------------------------------------------ */

/** CFB paths of the per-partition element streams. */
export const PARTITION_STREAM_PATTERN = /\/Partitions\/[^/]+$/iu;

/** CFB path of the schema stream every 2027 audit certifies against. */
export const FORMATS_LATEST_PATTERN = /\/Formats\/Latest$/iu;

/** CFB path of the release marker. */
export const BASIC_FILE_INFO_PATTERN = /\/BasicFileInfo$/iu;

/** One non-empty stream of an opened compound file. */
export type RvtStream = {
  readonly path: string;
  /** Stored bytes, still carrying their page checksums. */
  readonly bytes: Uint8Array;
};

/** One inflated chunk of one stream. */
export type RvtChunk = {
  readonly path: string;
  /** Index of this chunk within its own stream. */
  readonly chunkIndex: number;
  /** Offset of the gzip member within the checksum-stripped stream. */
  readonly offset: number;
  readonly data: Uint8Array;
  /**
   * Whether this chunk came from `salvageRevitChunk` — a partial read of a
   * chunk that desynced. A salvaged chunk is real payload but is short, and
   * deliberately does not seed the next chunk's window.
   */
  readonly salvaged: boolean;
};

/** An opened RVT, with the lookups every script performs on one. */
export type RvtModel = {
  readonly path: string;
  readonly cfb: ReturnType<typeof CFB.read>;
  /** Every non-empty stream, in CFB order. */
  streams(): RvtStream[];
  /** Non-empty streams whose path matches `pattern`. */
  streamsMatching(pattern: RegExp): RvtStream[];
  /** The first non-empty stream matching `pattern`, or `null`. */
  stream(pattern: RegExp): RvtStream | null;
  /**
   * The first gzip member of the first stream matching `pattern`, inflated.
   *
   * This is the `Formats/Latest` read, whose schema every 2027 audit certifies
   * against before trusting a decoder.
   */
  firstInflatedStream(pattern: RegExp): Uint8Array | null;
  /** `firstInflatedStream`, throwing rather than returning null. */
  requireInflatedStream(pattern: RegExp): Uint8Array;
  /** The inflated `Formats/Latest` schema stream. */
  requireSchema(): Uint8Array;
  /** The release from `BasicFileInfo`, or `null` when it cannot be read. */
  release(): number | null;
  /** The release, asserted to equal `expected`. */
  requireRelease(expected: number): number;
};

/** Open an RVT compound file. */
export function openRvt(path: string): RvtModel {
  const cfb = CFB.read(readFileSync(path), { type: "buffer" });
  let cachedStreams: RvtStream[] | null = null;

  const streams = (): RvtStream[] => {
    cachedStreams ??= cfb.FileIndex.map((entry, index) => ({
      entry,
      path: cfb.FullPaths[index] ?? "",
    }))
      .filter(({ entry }) => entry.size > 0 && entry.content != null)
      .map(({ entry, path: streamPath }) => ({
        path: streamPath,
        bytes: asBytes(entry.content as number[] | Uint8Array),
      }));
    return cachedStreams;
  };

  const stream = (pattern: RegExp): RvtStream | null =>
    streams().find((item) => pattern.test(item.path)) ?? null;

  const firstInflatedStream = (pattern: RegExp): Uint8Array | null => {
    const item = stream(pattern);
    if (!item) return null;
    const stored = stripRevitPageChecksums(item.bytes);
    const offset = gzipOffsets(stored, 1)[0];
    return offset == null ? null : inflateRevitChunk(stored, offset);
  };

  const requireInflatedStream = (pattern: RegExp): Uint8Array => {
    const inflated = firstInflatedStream(pattern);
    if (!inflated) {
      throw new Error(`RVT has no readable ${pattern.source} stream`);
    }
    return inflated;
  };

  const release = (): number | null => {
    const info = stream(BASIC_FILE_INFO_PATTERN);
    return info ? revitVersionFromBasicFileInfo(info.bytes) : null;
  };

  return {
    path,
    cfb,
    streams,
    streamsMatching: (pattern) =>
      streams().filter((item) => pattern.test(item.path)),
    stream,
    firstInflatedStream,
    requireInflatedStream,
    requireSchema: () => requireInflatedStream(FORMATS_LATEST_PATTERN),
    release,
    requireRelease(expected) {
      const found = release();
      if (found !== expected) {
        throw new Error(
          `audit requires a Revit ${expected} file, received ${found ?? "unknown"}`,
        );
      }
      return found;
    },
  };
}

/** What `iterateInflatedChunks` was asked to walk, and how. */
export type InflateOptions = {
  /** Which streams to walk. Defaults to the partitions. */
  readonly pattern?: RegExp;
  /**
   * Whether to fall back to `salvageRevitChunk` for a chunk that will not
   * inflate. On by default: 56 chunks of the reference model desync partway
   * and their prefixes hold records no other read reaches.
   */
  readonly salvage?: boolean;
  /** Called once per chunk that neither inflated nor salvaged. */
  readonly onFailure?: (path: string, chunkIndex: number) => void;
};

/**
 * Every inflated chunk of the matching streams, in order.
 *
 * This is the sequence that was retyped at 51 sites. It carries three things a
 * hand-written copy tends to lose:
 *
 * - the **next chunk's offset** as the end bound, so a chunk does not read
 *   past itself into the following member;
 * - the **cross-chunk dictionary** from `revitWindowTail`, which is how the
 *   minority of chunks that back-reference past their own start are read at
 *   all;
 * - **salvage** of a chunk that desyncs, whose prefix is ordinary payload.
 *
 * A salvaged chunk deliberately does not update the dictionary: it is short of
 * its own trailing 32 KiB, so seeding the next chunk from it would decode
 * against the wrong bytes.
 */
export function* iterateInflatedChunks(
  model: RvtModel,
  options: InflateOptions = {},
): Generator<RvtChunk> {
  const {
    pattern = PARTITION_STREAM_PATTERN,
    salvage = true,
    onFailure,
  } = options;
  for (const item of model.streamsMatching(pattern)) {
    const stored = stripRevitPageChecksums(item.bytes);
    const offsets = gzipOffsets(stored);
    let dictionary: Uint8Array | null = null;
    for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
      const offset = offsets[chunkIndex]!;
      const end = offsets[chunkIndex + 1];
      const read = inflateRevitChunk(stored, offset, end, dictionary);
      const inflated =
        read ?? (salvage ? salvageRevitChunk(stored, offset, end, dictionary) : null);
      if (!inflated) {
        onFailure?.(item.path, chunkIndex);
        continue;
      }
      if (read) dictionary = revitWindowTail(read);
      yield {
        path: item.path,
        chunkIndex,
        offset,
        data: inflated,
        salvaged: read == null,
      };
    }
  }
}

/** Running totals of one `iterateInflatedChunks` walk. */
export type ChunkCensus = {
  chunks: number;
  salvaged: number;
  failed: number;
};

/**
 * `iterateInflatedChunks` with the read/salvage/fail counts every audit
 * reports alongside its findings.
 *
 * The census is mutated as the generator advances, so read it after the loop.
 */
export function inflatedChunksWithCensus(
  model: RvtModel,
  options: Omit<InflateOptions, "onFailure"> = {},
): { chunks: Generator<RvtChunk>; census: ChunkCensus } {
  const census: ChunkCensus = { chunks: 0, salvaged: 0, failed: 0 };
  const inner = iterateInflatedChunks(model, {
    ...options,
    onFailure: () => {
      census.failed += 1;
    },
  });
  function* counted(): Generator<RvtChunk> {
    for (const chunk of inner) {
      census.chunks += 1;
      if (chunk.salvaged) census.salvaged += 1;
      yield chunk;
    }
  }
  return { chunks: counted(), census };
}

/* ------------------------------------------------------------------ *
 * Schema reading
 * ------------------------------------------------------------------ */

/** Whether `value` sits at `byteOffset` as ASCII. */
export function matchesAscii(
  data: Uint8Array,
  byteOffset: number,
  value: string,
): boolean {
  if (byteOffset < 0 || byteOffset > data.byteLength - value.length) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (data[byteOffset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

/**
 * Offset of the length-prefixed class name `name` in a schema stream, or
 * `null` when it is absent.
 */
export function findNameOffset(
  data: Uint8Array,
  name: string,
  firstOffset = 0,
): number | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (
    let offset = firstOffset;
    offset <= data.byteLength - name.length - 2;
    offset += 1
  ) {
    if (
      view.getUint16(offset, true) === name.length &&
      matchesAscii(data, offset + 2, name)
    ) {
      return offset;
    }
  }
  return null;
}

/** `findNameOffset`, throwing rather than returning null. */
export function requireNameOffset(
  data: Uint8Array,
  name: string,
  firstOffset = 0,
): number {
  const offset = findNameOffset(data, name, firstOffset);
  if (offset == null) {
    throw new Error(`Formats/Latest does not contain ${name}`);
  }
  return offset;
}

/** One declared field of a schema class. */
export type SchemaField = {
  readonly name: string;
  readonly offset: number;
  /** The type descriptor bytes, as space-separated hex. */
  readonly descriptor: string;
};

/**
 * Read a class's fields at `byteOffset`, asserting each name and type
 * descriptor in the declared order.
 *
 * The assertion is the point: an audit that decodes a body by fixed offsets is
 * only sound while the schema it was fitted to is the schema in the file, and
 * this is how each of them says so before decoding anything.
 */
export function decodeSchemaFields(
  data: Uint8Array,
  byteOffset: number,
  expected: readonly (readonly [string, readonly number[]])[],
): SchemaField[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let cursor = byteOffset;
  return expected.map(([name, descriptor]) => {
    if (
      cursor > data.byteLength - 4 ||
      view.getUint32(cursor, true) !== name.length ||
      !matchesAscii(data, cursor + 4, name)
    ) {
      throw new Error(`schema field ${name} is not in declared order`);
    }
    const offset = cursor;
    cursor += 4 + name.length;
    if (
      cursor > data.byteLength - descriptor.length ||
      descriptor.some((value, index) => data[cursor + index] !== value)
    ) {
      throw new Error(`schema descriptor ${name} changed`);
    }
    cursor += descriptor.length;
    return {
      name,
      offset,
      descriptor: descriptor
        .map((value) => value.toString(16).padStart(2, "0"))
        .join(" "),
    };
  });
}

/**
 * The ASCII class name a source-class slot resolves to.
 *
 * Slots are numbered from 12 in the schema's own candidate ordering; the
 * offset by twelve is the file's, not this function's.
 */
export function sourceNameAtSlot(
  data: Uint8Array,
  sourceClassSlot: number,
): { name: string; offset: number } {
  const candidates: { name: string; offset: number }[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let offset = 0; offset <= data.byteLength - 4; offset += 1) {
    const length = view.getUint16(offset, true);
    if (length < 2 || length > 100 || offset > data.byteLength - length - 2) {
      continue;
    }
    let ascii = true;
    for (let index = 0; index < length; index += 1) {
      const value = data[offset + 2 + index]!;
      if (value < 0x20 || value > 0x7e) {
        ascii = false;
        break;
      }
    }
    if (ascii) {
      candidates.push({
        name: new TextDecoder("ascii").decode(
          data.subarray(offset + 2, offset + 2 + length),
        ),
        offset,
      });
    }
  }
  const candidate = candidates[sourceClassSlot - 12];
  if (!candidate) {
    throw new Error(`Formats/Latest source slot ${sourceClassSlot} is missing`);
  }
  return candidate;
}

/* ------------------------------------------------------------------ *
 * IFC text
 * ------------------------------------------------------------------ */

/**
 * Split one STEP instance's argument list on top-level commas.
 *
 * Nested parentheses and `''`-escaped quotes are respected, which is why a
 * bare `source.split(",")` is wrong: an `IfcCartesianPoint((1.,2.,3.))` or a
 * name holding a comma both break it.
 */
export function splitStepArgs(source: string): string[] {
  const result: string[] = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "'") {
      if (quoted && source[index + 1] === "'") index += 1;
      else quoted = !quoted;
    } else if (!quoted) {
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      if (character === "," && depth === 0) {
        result.push(source.slice(start, index).trim());
        start = index + 1;
      }
    }
  }
  result.push(source.slice(start).trim());
  return result;
}

/** Every `#nnn` express id referenced in a STEP argument string. */
export function stepReferences(source = ""): number[] {
  return [...source.matchAll(/#(\d+)/gu)].map((match) => Number(match[1]));
}

/** Decode `\X2\…\X0\` and `\X\` escapes in an IFC string literal. */
export function decodeIfcString(source: string): string {
  return source
    .replace(/\\X2\\([0-9A-F]+)\\X0\\/giu, (_match, hex: string) => {
      let decoded = "";
      for (let index = 0; index + 3 < hex.length; index += 4) {
        decoded += String.fromCharCode(
          Number.parseInt(hex.slice(index, index + 4), 16),
        );
      }
      return decoded;
    })
    .replace(/\\X\\([0-9A-F]{2})/giu, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/''/gu, "'");
}

/**
 * Unwrap a `web-ifc` property, which hands back either a bare value or a
 * `{ value }` box depending on the attribute.
 */
export function ifcScalar(value: unknown): unknown {
  if (value != null && typeof value === "object" && "value" in value) {
    return (value as { value: unknown }).value;
  }
  return value;
}
