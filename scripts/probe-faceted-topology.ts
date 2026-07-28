/**
 * Evidence probe for stored faceted topology in a local RVT.
 *
 * Usage:
 *   node --experimental-strip-types scripts/probe-faceted-topology.ts model.rvt
 *   node --experimental-strip-types scripts/probe-faceted-topology.ts model.rvt --max-chunks 50
 *
 * The probe never calls the ODA runtime. It reads the file's own schema,
 * checksum-strips and inflates partition chunks with Reviter's browser-safe
 * code, and counts raw u16 occurrences of schema-defined topology tags against
 * neighbouring control values. A token occurrence is deliberately not called
 * a topology record: the nested field-array framing is still unresolved.
 */
import { readFileSync } from "node:fs";
import CFB from "cfb";

import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";
import { summariseSchema, type SchemaClass } from "../lib/reviter/schema.ts";

const TOPOLOGY_CLASS = /(?:FacetedTopology|GPolyMesh)/i;
const CONTROL_RADIUS = 8;
const FACETED_FIELD_NAMES = [
  "m_commonNormal",
  "m_edgeVisFlagsArr",
  "m_facetsArr",
  "m_interiorGStyleID",
  "m_materialID",
  "m_normalsArr",
  "m_normalsFlag",
  "m_offset",
  "m_pFacetedTopology",
  "m_pointsArr",
  "m_polyMeshFlags",
  "m_UVStorage",
] as const;

type TagProbe = {
  tag: number;
  classes: string[];
  occurrences: number;
  definitionBitOccurrences: number;
  chunks: number;
  neighbourMedian: number;
  ratioToNeighbourMedian: number | null;
  first?: { stream: string; chunkIndex: number; byteOffset: number };
};

export type FacetedTopologyProbe = {
  inputBytes: number;
  schema: {
    inflatedBytes: number;
    taggedClasses: SchemaClass[];
    referencedClasses: { name: string; tagReference: number; offset: number }[];
    fieldNamesObserved: string[];
  };
  partitions: {
    streams: number;
    storedBytes: number;
    checksumStrippedBytes: number;
    gzipChunks: number;
    inflatedChunks: number;
    salvagedChunks: number;
    failedChunks: number;
    inflatedBytes: number;
    adjacentBytePairsScanned: number;
  };
  rawTagProbe: TagProbe[];
  decodedTopologyRecords: 0;
  decodedMeshes: 0;
  boundary: string;
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function topologyFieldNames(schemaBytes: Uint8Array): string[] {
  return FACETED_FIELD_NAMES.filter((name) => {
    const encoded = new TextEncoder().encode(name);
    for (
      let offset = schemaBytes.indexOf(encoded[0]!);
      offset >= 0;
      offset = schemaBytes.indexOf(encoded[0]!, offset + 1)
    ) {
      if (offset + encoded.length > schemaBytes.length) return false;
      let matches = true;
      for (let index = 1; index < encoded.length; index += 1) {
        if (schemaBytes[offset + index] !== encoded[index]) {
          matches = false;
          break;
        }
      }
      if (matches) return true;
    }
    return false;
  });
}

function firstInflatedStream(
  cfb: ReturnType<typeof CFB.read>,
  pattern: RegExp,
): Uint8Array | null {
  const item = cfb.FileIndex
    .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
    .find(({ entry, path }) => entry.size > 0 && pattern.test(path));
  if (!item) return null;
  const data = stripRevitPageChecksums(asBytes(item.entry.content));
  const offset = gzipOffsets(data, 1)[0];
  return offset == null ? null : inflateRevitChunk(data, offset);
}

function tagClassMap(classes: SchemaClass[]): Map<number, string[]> {
  const result = new Map<number, string[]>();
  for (const entry of classes.filter((candidate) => TOPOLOGY_CLASS.test(candidate.name))) {
    const names = result.get(entry.tag) ?? [];
    names.push(entry.name);
    result.set(entry.tag, names);
  }
  return result;
}

export function probeFacetedTopologyRvt(
  input: Uint8Array,
  maxChunks = Number.POSITIVE_INFINITY,
): FacetedTopologyProbe {
  const cfb = CFB.read(input, { type: "buffer" });
  const schemaBytes = firstInflatedStream(cfb, /\/Formats\/Latest$/i);
  if (!schemaBytes) throw new Error("Formats/Latest could not be inflated.");
  const schema = summariseSchema(schemaBytes);
  const tagClasses = tagClassMap(schema.taggedClasses);
  const evidenceTags = new Set(tagClasses.keys());

  const wanted = new Uint8Array(65_536);
  for (const tag of evidenceTags) {
    wanted[tag] = 1;
    wanted[tag | 0x8000] = 1;
    for (let delta = -CONTROL_RADIUS; delta <= CONTROL_RADIUS; delta += 1) {
      const control = tag + delta;
      if (control >= 0 && control < 0x8000) wanted[control] = 1;
    }
  }
  const counts = new Float64Array(65_536);
  const chunkHits = new Map<number, number>();
  const first = new Map<number, { stream: string; chunkIndex: number; byteOffset: number }>();

  const partitions = cfb.FileIndex
    .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
    .filter(({ entry, path }) => entry.size > 0 && /\/Partitions\/[^/]+$/i.test(path));

  let storedBytes = 0;
  let checksumStrippedBytes = 0;
  let gzipChunks = 0;
  let inflatedChunks = 0;
  let salvagedChunks = 0;
  let failedChunks = 0;
  let inflatedBytes = 0;
  let adjacentBytePairsScanned = 0;
  let visited = 0;

  for (const partition of partitions) {
    storedBytes += partition.entry.size;
    const data = stripRevitPageChecksums(asBytes(partition.entry.content));
    checksumStrippedBytes += data.byteLength;
    const offsets = gzipOffsets(data);
    gzipChunks += offsets.length;
    let window: Uint8Array | null = null;

    for (let chunkIndex = 0; chunkIndex < offsets.length && visited < maxChunks; chunkIndex += 1) {
      visited += 1;
      const read = inflateRevitChunk(data, offsets[chunkIndex]!, offsets[chunkIndex + 1], window);
      const inflated =
        read ??
        salvageRevitChunk(data, offsets[chunkIndex]!, offsets[chunkIndex + 1], window);
      if (!inflated) {
        failedChunks += 1;
        continue;
      }
      if (read) window = revitWindowTail(read);
      else salvagedChunks += 1;
      inflatedChunks += 1;
      inflatedBytes += inflated.byteLength;
      adjacentBytePairsScanned += Math.max(0, inflated.byteLength - 1);

      const seen = new Set<number>();
      for (let byteOffset = 0; byteOffset + 1 < inflated.byteLength; byteOffset += 1) {
        const token = inflated[byteOffset]! | (inflated[byteOffset + 1]! << 8);
        if (!wanted[token]) continue;
        counts[token] += 1;
        const baseTag = token & 0x7fff;
        if (!evidenceTags.has(baseTag)) continue;
        seen.add(baseTag);
        if (!first.has(baseTag)) {
          first.set(baseTag, {
            stream: partition.path.replace(/^Root Entry\//, ""),
            chunkIndex,
            byteOffset,
          });
        }
      }
      for (const tag of seen) chunkHits.set(tag, (chunkHits.get(tag) ?? 0) + 1);
    }
    if (visited >= maxChunks) break;
  }

  const rawTagProbe: TagProbe[] = [...tagClasses]
    .sort((a, b) => a[0] - b[0])
    .map(([tag, classes]) => {
      const neighbours: number[] = [];
      for (let delta = -CONTROL_RADIUS; delta <= CONTROL_RADIUS; delta += 1) {
        if (!delta || evidenceTags.has(tag + delta)) continue;
        const control = tag + delta;
        if (control >= 0 && control < 0x8000) neighbours.push(counts[control]!);
      }
      const neighbourMedian = median(neighbours);
      const occurrences = counts[tag]!;
      return {
        tag,
        classes,
        occurrences,
        definitionBitOccurrences: counts[tag | 0x8000]!,
        chunks: chunkHits.get(tag) ?? 0,
        neighbourMedian,
        ratioToNeighbourMedian:
          neighbourMedian > 0 ? Number((occurrences / neighbourMedian).toFixed(3)) : null,
        first: first.get(tag),
      };
    });

  return {
    inputBytes: input.byteLength,
    schema: {
      inflatedBytes: schema.byteLength,
      taggedClasses: schema.taggedClasses.filter((entry) => TOPOLOGY_CLASS.test(entry.name)),
      referencedClasses: schema.referencedClasses.filter((entry) =>
        TOPOLOGY_CLASS.test(entry.name),
      ),
      fieldNamesObserved: topologyFieldNames(schemaBytes),
    },
    partitions: {
      streams: partitions.length,
      storedBytes,
      checksumStrippedBytes,
      gzipChunks,
      inflatedChunks,
      salvagedChunks,
      failedChunks,
      inflatedBytes,
      adjacentBytePairsScanned,
    },
    rawTagProbe,
    decodedTopologyRecords: 0,
    decodedMeshes: 0,
    boundary:
      "Schema field names and storage variants are corroborated, but nested array length/offset framing is not. Raw u16 tag occurrences are evidence locations, not record boundaries.",
  };
}

function parseMaxChunks(arguments_: string[]): number {
  const index = arguments_.indexOf("--max-chunks");
  if (index < 0) return Number.POSITIVE_INFINITY;
  const value = Number(arguments_[index + 1]);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("--max-chunks must be a positive integer");
  }
  return value;
}

function main(arguments_: string[]): void {
  const inputPath = arguments_[0];
  if (!inputPath || inputPath.startsWith("-")) {
    throw new Error(
      "Usage: node --experimental-strip-types scripts/probe-faceted-topology.ts model.rvt [--max-chunks N]",
    );
  }
  const bytes = readFileSync(inputPath);
  const probe = probeFacetedTopologyRvt(
    new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    parseMaxChunks(arguments_),
  );
  console.log(JSON.stringify(probe, null, 2));
}

if ((process.argv[1] ?? "").endsWith("probe-faceted-topology.ts")) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
