/**
 * Decode faceted-topology class layers from Formats/Latest and test the
 * simplest verified selector/collection framing against partition bytes.
 *
 * Usage:
 *   node --experimental-strip-types scripts/probe-schema-fields.ts model.rvt
 *
 * A zero direct-body count is not reported as "no geometry". It isolates the
 * remaining grammar gap to a token between the polymorphic selector and the
 * first counted array (or to PArray's item framing).
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
  findSchemaClassDefinition,
  flattenSchemaFields,
  locateDirectFacetedTuplePair,
  type DecodedSchemaLayer,
} from "../lib/reviter/schema-fields.ts";

const TARGET_CLASSES = [
  "FacetedTopology0",
  "FacetedTopology1",
  "FacetedTopology2",
  "FacetedTopology10",
  "FacetedTopology11",
  "FacetedTopology12",
  "FacetedTopology13",
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
  vertices: number;
  facets: number;
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

function layerNames(layer: DecodedSchemaLayer): string[] {
  return [...(layer.parent ? layerNames(layer.parent) : []), layer.name];
}

function classProbes(schemaBytes: Uint8Array): ClassProbe[] {
  return TARGET_CLASSES.map((name) => {
    const result = findSchemaClassDefinition(schemaBytes, name);
    if (!result.ok) {
      return {
        name,
        decoded: false,
        error: result.error,
        errorOffset: result.offset,
      };
    }
    return {
      name,
      decoded: true,
      classId: result.layer.classId,
      layers: layerNames(result.layer),
      fields: flattenSchemaFields(result.layer).map((field) => ({
        name: field.name,
        typeCode: field.typeCode,
        mode: field.mode,
        arrayElement: field.arrayElement,
      })),
    };
  });
}

function validateDirectCandidate(
  data: Uint8Array,
  selectorOffset: number,
): { vertices: number; facets: number } | null {
  const result = locateDirectFacetedTuplePair(
    data,
    selectorOffset,
    4,
    2,
    200_000,
    400_000,
  );
  if (!result.ok) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const { points, facets } = result.pair;
  for (
    let offset = points.itemsOffset;
    offset < points.endOffset;
    offset += points.scalarByteLength
  ) {
    const value = view.getFloat32(offset, true);
    if (!Number.isFinite(value) || Math.abs(value) > 10_000_000) return null;
  }
  for (
    let offset = facets.itemsOffset;
    offset < facets.endOffset;
    offset += facets.scalarByteLength
  ) {
    if (view.getUint16(offset, true) >= points.count) return null;
  }
  return { vertices: points.count, facets: facets.count };
}

function scanDirectBodies(
  cfb: ReturnType<typeof CFB.read>,
  selector: number,
): {
  selectorOccurrences: number;
  directCandidates: DirectCandidate[];
  chunks: number;
  inflatedBytes: number;
} {
  let selectorOccurrences = 0;
  let chunks = 0;
  let inflatedBytes = 0;
  const directCandidates: DirectCandidate[] = [];
  const partitions = cfb.FileIndex
    .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
    .filter(({ entry, path }) => entry.size > 0 && /\/Partitions\/[^/]+$/i.test(path));

  for (const partition of partitions) {
    const stored = stripRevitPageChecksums(asBytes(partition.entry.content));
    const offsets = gzipOffsets(stored);
    let window: Uint8Array | null = null;
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
      const view = new DataView(
        inflated.buffer,
        inflated.byteOffset,
        inflated.byteLength,
      );
      for (let offset = 0; offset + 2 <= inflated.byteLength; offset += 1) {
        if (view.getInt16(offset, true) !== selector) continue;
        selectorOccurrences += 1;
        const candidate = validateDirectCandidate(inflated, offset);
        if (!candidate || directCandidates.length >= 20) continue;
        directCandidates.push({
          stream: partition.path.replace(/^Root Entry\//, ""),
          chunkIndex,
          selectorOffset: offset,
          selector,
          ...candidate,
        });
      }
    }
  }
  return { selectorOccurrences, directCandidates, chunks, inflatedBytes };
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
  const partitionProbe = scanDirectBodies(cfb, direct.classId);

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
          schemaInheritance: "high-bit class id + zero u16 + recursive parent",
        },
        directBodyTest: {
          selector: direct.classId,
          assumedLayout:
            "[i16 selector][i32 vertexCount][float32 xyz]*[i32 facetCount][uint16 ijk]*",
          ...partitionProbe,
        },
        unresolvedTokenGrammar:
          partitionProbe.directCandidates.length === 0
            ? "Formats/Latest closes the m_pointsArr/m_facetsArr descriptors, but no selector occurrence begins the two counted arrays directly. The unresolved byte grammar is now specifically the inherited-property/property-presence token(s) between OdBmObjectPtrInitReader's int16 class selector and PArray data, and whether PArray adds an item/group token before its int32 dynamic count."
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
