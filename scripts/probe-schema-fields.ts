/**
 * Decode faceted-topology class layers from Formats/Latest and test the
 * simplest verified selector/collection framing against partition bytes.
 *
 * Usage:
 *   node --experimental-strip-types scripts/probe-schema-fields.ts model.rvt
 *
 * A zero direct-body count is not reported as "no geometry". The primitive
 * reader framing is corroborated; this probe tests whether raw selector-like
 * bytes can safely identify a scoped topology object boundary.
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
import {
  locateCountedTupleArray,
  readClassSelector,
} from "../lib/reviter/counted-arrays.ts";
import {
  readSchema,
  schemaAncestorChain,
  schemaClassesByName,
} from "../lib/reviter/schema-reader.ts";

const TARGET_CLASSES = [
  "DoubleFacetedTopology",
  "FloatNormalsFacetedTopology",
  "FacetedTopologyImpl",
  "DoubleTinyFacetedTopology",
  "FacetedTopology0",
  "FacetedTopology0t",
  "FacetedTopology1",
  "FacetedTopology2",
  "FacetedTopology10",
  "FacetedTopology10t",
  "FacetedTopology2t",
  "FacetedTopology11",
  "FacetedTopology12",
  "FacetedTopology12t",
  "FacetedTopology13",
  "FacetedTopology24",
  "FacetedTopology24t",
  "FacetedTopology25",
] as const;

type ClassProbe = {
  name: string;
  decoded: boolean;
  classId?: number;
  layers?: string[];
  fields?: {
    name: string;
    typeCode: number;
    mode: number;
    arrayElement?: { typeCode: number; tupleWidth: number };
  }[];
  error?: string;
  errorOffset?: number;
};

type DirectCandidate = {
  stream: string;
  chunkIndex: number;
  selectorOffset: number;
  selector: number;
  bodyPrefixBytes: number;
  spansChunkBoundary: boolean;
  vertices: number;
  facets: number;
};

type SelectorProbe = {
  selector: number;
  unsignedSelector?: number;
  selectorOccurrences: number;
  directCandidates: DirectCandidate[];
};

type SelectorConfiguration = {
  selector: number;
  bodyPrefixBytes: readonly number[];
};

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

function classProbes(schemaBytes: Uint8Array): ClassProbe[] {
  const parsed = readSchema(schemaBytes);
  if (!parsed.ok) {
    return TARGET_CLASSES.map((name) => ({
      name,
      decoded: false,
      error: parsed.error,
      errorOffset: parsed.offset,
    }));
  }
  const { schema } = parsed;
  const byName = schemaClassesByName(schema);
  return TARGET_CLASSES.map((name) => {
    const definition = byName.get(name);
    if (!definition) {
      return { name, decoded: false, error: "not declared by this file", errorOffset: 0 };
    }
    // Base first, which is the order an instance writes its fields in.
    const chain = schemaAncestorChain(schema, definition.index);
    return {
      name,
      decoded: true,
      classId: definition.index,
      layers: chain.map((entry) => entry.name),
      fields: chain.flatMap((entry) =>
        entry.properties.map((property) => ({
          name: `${entry.name}.${property.name}`,
          typeCode: property.fieldType,
          mode: property.loadingMode | (property.itemMode << 4),
          arrayElement: property.element
            ? { typeCode: property.element.fieldType, tupleWidth: property.size ?? 0 }
            : undefined,
        })),
      ),
    };
  });
}

function validateDirectCandidate(
  data: Uint8Array,
  selectorOffset: number,
  bodyPrefixBytes: number,
): { vertices: number; facets: number; endOffset: number } | null {
  if (readClassSelector(data, selectorOffset) == null) return null;
  const points = locateCountedTupleArray(
    data,
    selectorOffset + 2 + bodyPrefixBytes,
    3,
    4,
    200_000,
  );
  if (!points.ok || points.array.count < 3) return null;
  const facets = locateCountedTupleArray(
    data,
    points.array.endOffset,
    3,
    2,
    400_000,
  );
  if (!facets.ok || facets.array.count < 1) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (
    let offset = points.array.itemsOffset;
    offset < points.array.endOffset;
    offset += points.array.scalarByteLength
  ) {
    const value = view.getFloat32(offset, true);
    if (!Number.isFinite(value) || Math.abs(value) > 10_000_000) return null;
  }
  for (
    let offset = facets.array.itemsOffset;
    offset < facets.array.endOffset;
    offset += facets.array.scalarByteLength
  ) {
    if (view.getUint16(offset, true) >= points.array.count) return null;
  }
  return {
    vertices: points.array.count,
    facets: facets.array.count,
    endOffset: facets.array.endOffset,
  };
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const byteLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function scanDirectBodies(
  cfb: ReturnType<typeof CFB.read>,
  configurations: readonly SelectorConfiguration[],
): {
  probes: SelectorProbe[];
  chunks: number;
  inflatedBytes: number;
  rollingChunks: number;
} {
  let chunks = 0;
  let inflatedBytes = 0;
  const rollingChunks = 3;
  const bySelector = new Map<number, SelectorProbe & SelectorConfiguration>();
  for (const configuration of configurations) {
    bySelector.set(configuration.selector, {
      ...configuration,
      unsignedSelector:
        configuration.selector < 0 ? configuration.selector & 0xffff : undefined,
      selectorOccurrences: 0,
      directCandidates: [],
    });
  }
  const partitions = cfb.FileIndex
    .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
    .filter(({ entry, path }) => entry.size > 0 && /\/Partitions\/[^/]+$/i.test(path));

  for (const partition of partitions) {
    const stored = stripRevitPageChecksums(asBytes(partition.entry.content));
    const offsets = gzipOffsets(stored);
    let window: Uint8Array | null = null;
    const pending: { data: Uint8Array; chunkIndex: number }[] = [];

    const scanOldest = (): void => {
      const oldest = pending[0];
      if (!oldest) return;
      const combined = concatenate(pending.map((entry) => entry.data));
      const view = new DataView(combined.buffer, combined.byteOffset, combined.byteLength);
      for (let offset = 0; offset < oldest.data.byteLength; offset += 1) {
        if (offset + 2 > combined.byteLength) break;
        const selector = view.getInt16(offset, true);
        const probe = bySelector.get(selector);
        if (!probe) continue;
        probe.selectorOccurrences += 1;
        for (const prefix of probe.bodyPrefixBytes) {
          const candidate = validateDirectCandidate(combined, offset, prefix);
          if (!candidate || probe.directCandidates.length >= 20) continue;
          probe.directCandidates.push({
            stream: partition.path.replace(/^Root Entry\//, ""),
            chunkIndex: oldest.chunkIndex,
            selectorOffset: offset,
            selector,
            bodyPrefixBytes: prefix,
            spansChunkBoundary: candidate.endOffset > oldest.data.byteLength,
            vertices: candidate.vertices,
            facets: candidate.facets,
          });
        }
      }
      pending.shift();
    };

    for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
      const read = inflateRevitChunk(
        stored,
        offsets[chunkIndex]!,
        offsets[chunkIndex + 1],
        window,
      );
      const inflated =
        read ??
        salvageRevitChunk(
          stored,
          offsets[chunkIndex]!,
          offsets[chunkIndex + 1],
          window,
        );
      if (!inflated) continue;
      if (read) window = revitWindowTail(read);
      chunks += 1;
      inflatedBytes += inflated.byteLength;
      pending.push({ data: inflated, chunkIndex });
      if (pending.length >= rollingChunks) scanOldest();
    }
    while (pending.length) scanOldest();
  }
  return {
    probes: [...bySelector.values()].map((probe) => ({
      selector: probe.selector,
      unsignedSelector: probe.unsignedSelector,
      selectorOccurrences: probe.selectorOccurrences,
      directCandidates: probe.directCandidates,
    })),
    chunks,
    inflatedBytes,
    rollingChunks,
  };
}

function main(arguments_: string[]): void {
  const inputPath = arguments_[0];
  if (!inputPath) {
    throw new Error("Pass the path to an RVT file.");
  }
  const input = readFileSync(inputPath);
  const cfb = CFB.read(input, { type: "buffer" });
  const schemaBytes = firstInflatedStream(cfb, /\/Formats\/Latest$/i);
  if (!schemaBytes) throw new Error("Formats/Latest could not be inflated.");
  const classes = classProbes(schemaBytes);
  const direct = classes.find(
    (entry) =>
      entry.name === "FacetedTopology0" &&
      entry.decoded &&
      entry.fields?.map((field) => field.name).join(",") ===
        "m_pointsArr,m_facetsArr",
  );
  if (direct?.classId == null) {
    throw new Error("FacetedTopology0 did not decode to the expected two-field layout.");
  }
  const referenceSelector = direct.classId;
  const definitionSelector = (direct.classId | 0x8000) - 0x1_0000;
  const bodyPrefixRobustness = Array.from({ length: 17 }, (_, index) => index);
  const selectors = [
    { selector: referenceSelector, bodyPrefixBytes: bodyPrefixRobustness },
    { selector: definitionSelector, bodyPrefixBytes: bodyPrefixRobustness },
    ...[1874, 1875].flatMap((selector) => [
      { selector, bodyPrefixBytes: [12, 24] },
      {
        selector: (selector | 0x8000) - 0x1_0000,
        bodyPrefixBytes: [12, 24],
      },
    ]),
  ];
  const partitionProbe = scanDirectBodies(cfb, selectors);
  const noCandidates = partitionProbe.probes.every(
    (probe) => probe.directCandidates.length === 0,
  );

  console.log(
    JSON.stringify(
      {
        inputPath,
        inputBytes: input.byteLength,
        schemaBytes: schemaBytes.byteLength,
        classes,
        verifiedFraming: {
          classSelector: "signed int16 little-endian",
          dynamicCollectionCount: "signed int32 little-endian",
          fixedTupleCount: "schema getSize value; no runtime tuple-width token",
          primitiveItemModes: "mode 0/6 dispatches directly to the primitive reader",
          schemaInheritance: "high-bit class id + zero u16 + recursive parent",
        },
        directBodyTest: {
          selectors: selectors.map((entry) => entry.selector),
          assumedLayout:
            "[i16 selector][bounded 0..16-byte prefix robustness scan][i32 vertexCount][float32 xyz]*[i32 facetCount][uint16 ijk]*",
          partitionProbe,
        },
        scopedTagEvidence: {
          alias: 1426,
          classes: ["GPolyMesh", "GBRep", "GFakeBRep", "GEdgeBase"],
          conclusion:
            "Formats/Latest tag references are scoped aliases, so raw 1426 or topology-selector byte hits are not globally valid object boundaries.",
        },
        remainingObjectLocationBoundary:
          noCandidates
            ? "No validated body begins at the tested raw selector-like bytes, including bodies spanning up to three inflated chunks. Primitive PArray framing is corroborated; the remaining blocker is the outer geometry-object reader and its scoped class-resolution context, not an assumed per-item token."
            : null,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1]?.endsWith("probe-schema-fields.ts")) {
  main(process.argv.slice(2));
}
