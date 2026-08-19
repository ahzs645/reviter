/**
 * Search RVT partition bytes for structurally valid adjacent counted
 * point/facet arrays without assuming that a polymorphic class selector is
 * present.
 *
 * This is an evidence probe, not a production record locator. A candidate must
 * satisfy both dynamic counts, finite/bounded coordinates, and every facet
 * index. Results still need an outer GPolyMesh/geometry-object boundary before
 * they can be emitted as model geometry.
 *
 * Usage:
 *   node --experimental-strip-types scripts/probe-counted-topology.ts model.rvt
 */
import { readFileSync } from "node:fs";
import CFB from "cfb";

import { decodeElementOwnership } from "../lib/reviter/element-relations.ts";
import {
  decodeRevitDocumentHistory,
  decodeRevitNativeIdentities,
} from "../lib/reviter/native-identity.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";
import { locateCountedTupleArray } from "../lib/reviter/counted-arrays.ts";

const MAX_VERTICES = 200_000;
const MAX_FACETS = 400_000;
const MAX_ABS_COORDINATE = 10_000_000;
const ROLLING_CHUNKS = 3;
const MAX_CANDIDATES_PER_LAYOUT = 40;

type Layout = {
  name: string;
  pointScalarBytes: 4 | 8;
  indexScalarBytes: 2 | 4;
};

type Candidate = {
  stream: string;
  chunkIndex: number;
  countOffset: number;
  spansChunkBoundary: boolean;
  vertices: number;
  facets: number;
  byteLength: number;
  pointBounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
  usedVertices: number;
  nonDegenerateTriangles: number;
  degenerateTriangles: number;
  edgeVisibility: {
    count: number;
    matchesFacetCount: boolean;
    sampleHex: string;
  } | null;
  followingNativeElement: {
    byteOffset: number;
    elementId: number;
    owningElementId: number | null;
    uniqueId: string;
  } | null;
  prefixHex: string;
};

type NativeElementContext = Map<
  number,
  {
    owningElementId: number | null;
    uniqueId: string;
  }
>;

const LAYOUTS: readonly Layout[] = [
  { name: "float32-u16", pointScalarBytes: 4, indexScalarBytes: 2 },
  { name: "float32-i32", pointScalarBytes: 4, indexScalarBytes: 4 },
  { name: "float64-u16", pointScalarBytes: 8, indexScalarBytes: 2 },
  { name: "float64-i32", pointScalarBytes: 8, indexScalarBytes: 4 },
];

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

function finitePoints(
  view: DataView,
  itemsOffset: number,
  endOffset: number,
  scalarBytes: 4 | 8,
): {
  spansModelSpace: boolean;
  min: [number, number, number];
  max: [number, number, number];
} | null {
  const min: [number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const max: [number, number, number] = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  let scalarIndex = 0;
  for (let offset = itemsOffset; offset < endOffset; offset += scalarBytes) {
    const value =
      scalarBytes === 4
        ? view.getFloat32(offset, true)
        : view.getFloat64(offset, true);
    if (!Number.isFinite(value) || Math.abs(value) > MAX_ABS_COORDINATE) {
      return null;
    }
    const axis = scalarIndex % 3;
    min[axis] = Math.min(min[axis]!, value);
    max[axis] = Math.max(max[axis]!, value);
    scalarIndex += 1;
  }
  return {
    // Reject integer/control arrays whose bit patterns decode only as
    // subnormal floats. A real Revit mesh must span a measurable distance.
    spansModelSpace: Math.max(
      max[0]! - min[0]!,
      max[1]! - min[1]!,
      max[2]! - min[2]!,
    ) > 1e-6,
    min,
    max,
  };
}

function coordinate(
  view: DataView,
  pointsOffset: number,
  pointScalarBytes: 4 | 8,
  point: number,
  axis: number,
): number {
  const offset = pointsOffset + (point * 3 + axis) * pointScalarBytes;
  return pointScalarBytes === 4
    ? view.getFloat32(offset, true)
    : view.getFloat64(offset, true);
}

function validIndexedTriangles(
  view: DataView,
  itemsOffset: number,
  endOffset: number,
  scalarBytes: 2 | 4,
  vertices: number,
  pointsOffset: number,
  pointScalarBytes: 4 | 8,
): {
  usedVertices: number;
  nonDegenerateTriangles: number;
  degenerateTriangles: number;
} | null {
  const readIndex = (offset: number): number =>
    scalarBytes === 2
      ? view.getUint16(offset, true)
      : view.getInt32(offset, true);
  const usedVertices = new Set<number>();
  let nonDegenerateTriangles = 0;
  let degenerateTriangles = 0;
  for (
    let offset = itemsOffset;
    offset + scalarBytes * 3 <= endOffset;
    offset += scalarBytes * 3
  ) {
    const a = readIndex(offset);
    const b = readIndex(offset + scalarBytes);
    const c = readIndex(offset + scalarBytes * 2);
    if (
      a < 0 ||
      b < 0 ||
      c < 0 ||
      a >= vertices ||
      b >= vertices ||
      c >= vertices
    ) {
      return null;
    }
    usedVertices.add(a);
    usedVertices.add(b);
    usedVertices.add(c);
    if (a === b || b === c || a === c) {
      degenerateTriangles += 1;
      continue;
    }
    const ab = [0, 1, 2].map(
      (axis) =>
        coordinate(view, pointsOffset, pointScalarBytes, b, axis) -
        coordinate(view, pointsOffset, pointScalarBytes, a, axis),
    );
    const ac = [0, 1, 2].map(
      (axis) =>
        coordinate(view, pointsOffset, pointScalarBytes, c, axis) -
        coordinate(view, pointsOffset, pointScalarBytes, a, axis),
    );
    const crossX = ab[1]! * ac[2]! - ab[2]! * ac[1]!;
    const crossY = ab[2]! * ac[0]! - ab[0]! * ac[2]!;
    const crossZ = ab[0]! * ac[1]! - ab[1]! * ac[0]!;
    if (crossX * crossX + crossY * crossY + crossZ * crossZ > 1e-20) {
      nonDegenerateTriangles += 1;
    } else {
      degenerateTriangles += 1;
    }
  }
  return nonDegenerateTriangles > 0
    ? {
        usedVertices: usedVertices.size,
        nonDegenerateTriangles,
        degenerateTriangles,
      }
    : null;
}

function validateAt(
  data: Uint8Array,
  countOffset: number,
  layout: Layout,
  nativeElements: NativeElementContext,
): {
  vertices: number;
  facets: number;
  endOffset: number;
  pointBounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
  usedVertices: number;
  nonDegenerateTriangles: number;
  degenerateTriangles: number;
  edgeVisibility: Candidate["edgeVisibility"];
  followingNativeElement: Candidate["followingNativeElement"];
} | null {
  const points = locateCountedTupleArray(
    data,
    countOffset,
    3,
    layout.pointScalarBytes,
    MAX_VERTICES,
  );
  if (!points.ok || points.array.count < 3) return null;
  const facets = locateCountedTupleArray(
    data,
    points.array.endOffset,
    3,
    layout.indexScalarBytes,
    MAX_FACETS,
  );
  if (!facets.ok || facets.array.count < 1) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const pointEvidence = finitePoints(
    view,
    points.array.itemsOffset,
    points.array.endOffset,
    layout.pointScalarBytes,
  );
  const triangleEvidence = validIndexedTriangles(
    view,
    facets.array.itemsOffset,
    facets.array.endOffset,
    layout.indexScalarBytes,
    points.array.count,
    points.array.itemsOffset,
    layout.pointScalarBytes,
  );
  if (
    !pointEvidence?.spansModelSpace ||
    !triangleEvidence
  ) {
    return null;
  }
  let edgeVisibility: Candidate["edgeVisibility"] = null;
  let followingNativeElement: Candidate["followingNativeElement"] = null;
  if (facets.array.endOffset + 4 <= data.byteLength) {
    const count = view.getInt32(facets.array.endOffset, true);
    const itemsOffset = facets.array.endOffset + 4;
    if (count >= 0 && itemsOffset + count <= data.byteLength) {
      edgeVisibility = {
        count,
        matchesFacetCount: count === facets.array.count,
        sampleHex: Buffer.from(
          data.subarray(itemsOffset, Math.min(itemsOffset + count, itemsOffset + 24)),
        ).toString("hex"),
      };
      const nextOffset = itemsOffset + count;
      if (nextOffset + 8 <= data.byteLength) {
        const rawElementId = view.getBigUint64(nextOffset, true);
        if (rawElementId <= BigInt(Number.MAX_SAFE_INTEGER)) {
          const elementId = Number(rawElementId);
          const native = nativeElements.get(elementId);
          if (native) {
            followingNativeElement = {
              byteOffset: nextOffset - countOffset,
              elementId,
              owningElementId: native.owningElementId,
              uniqueId: native.uniqueId,
            };
          }
        }
      }
    }
  }
  return {
    vertices: points.array.count,
    facets: facets.array.count,
    endOffset: facets.array.endOffset,
    pointBounds: {
      min: pointEvidence.min,
      max: pointEvidence.max,
    },
    usedVertices: triangleEvidence.usedVertices,
    nonDegenerateTriangles: triangleEvidence.nonDegenerateTriangles,
    degenerateTriangles: triangleEvidence.degenerateTriangles,
    edgeVisibility,
    followingNativeElement,
  };
}

function prefixHex(data: Uint8Array, offset: number): string {
  return Buffer.from(data.subarray(Math.max(0, offset - 24), offset)).toString(
    "hex",
  );
}

function inflateNamedStream(
  cfb: ReturnType<typeof CFB.read>,
  pattern: RegExp,
): Uint8Array | null {
  const match = cfb.FileIndex
    .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
    .find(({ entry, path }) => entry.size > 0 && pattern.test(path));
  if (!match) return null;
  const stored = stripRevitPageChecksums(asBytes(match.entry.content));
  const offset = gzipOffsets(stored, 1)[0];
  return offset == null ? null : inflateRevitChunk(stored, offset);
}

function nativeElementContext(
  cfb: ReturnType<typeof CFB.read>,
): NativeElementContext {
  const context: NativeElementContext = new Map();
  const historyBytes = inflateNamedStream(cfb, /\/Global\/History$/i);
  const elementBytes = inflateNamedStream(cfb, /\/Global\/ElemTable$/i);
  if (!historyBytes || !elementBytes) return context;
  const history = decodeRevitDocumentHistory(historyBytes, 2027);
  const ownership = decodeElementOwnership(elementBytes);
  if (history.format === "unsupported" || ownership.format === "unsupported") {
    return context;
  }
  const identities = decodeRevitNativeIdentities(elementBytes, history, 2027);
  if (identities.format === "unsupported") return context;
  const ownerByElement = new Map(
    ownership.records.map((record) => [
      record.elementId,
      record.owningElementId,
    ]),
  );
  for (const identity of identities.identities) {
    context.set(identity.elementId, {
      owningElementId: ownerByElement.get(identity.elementId) ?? null,
      uniqueId: identity.uniqueId,
    });
  }
  return context;
}

function main(arguments_: string[]): void {
  const inputPath = arguments_[0];
  if (!inputPath) throw new Error("Pass the path to an RVT file.");
  const input = readFileSync(inputPath);
  const cfb = CFB.read(input, { type: "buffer" });
  const nativeElements = nativeElementContext(cfb);
  const partitions = cfb.FileIndex
    .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
    .filter(
      ({ entry, path }) =>
        entry.size > 0 && /\/Partitions\/[^/]+$/i.test(path),
    );

  const candidates = new Map<string, Candidate[]>(
    LAYOUTS.map((layout) => [layout.name, []]),
  );
  let chunks = 0;
  let inflatedBytes = 0;
  let countOffsetsTested = 0;

  for (const partition of partitions) {
    const stored = stripRevitPageChecksums(asBytes(partition.entry.content));
    const offsets = gzipOffsets(stored);
    let dictionary: Uint8Array | null = null;
    const pending: { data: Uint8Array; chunkIndex: number }[] = [];

    const scanOldest = (): void => {
      const oldest = pending[0];
      if (!oldest) return;
      const combined = concatenate(pending.map((entry) => entry.data));
      const view = new DataView(
        combined.buffer,
        combined.byteOffset,
        combined.byteLength,
      );
      for (
        let countOffset = 0;
        countOffset + 4 <= oldest.data.byteLength;
        countOffset += 1
      ) {
        const count = view.getInt32(countOffset, true);
        if (count < 3 || count > MAX_VERTICES) continue;
        countOffsetsTested += 1;
        for (const layout of LAYOUTS) {
          const kept = candidates.get(layout.name)!;
          if (kept.length >= MAX_CANDIDATES_PER_LAYOUT) continue;
          const candidate = validateAt(
            combined,
            countOffset,
            layout,
            nativeElements,
          );
          if (!candidate) continue;
          kept.push({
            stream: partition.path.replace(/^Root Entry\//, ""),
            chunkIndex: oldest.chunkIndex,
            countOffset,
            spansChunkBoundary:
              candidate.endOffset > oldest.data.byteLength,
            vertices: candidate.vertices,
            facets: candidate.facets,
            byteLength: candidate.endOffset - countOffset,
            pointBounds: candidate.pointBounds,
            usedVertices: candidate.usedVertices,
            nonDegenerateTriangles: candidate.nonDegenerateTriangles,
            degenerateTriangles: candidate.degenerateTriangles,
            edgeVisibility: candidate.edgeVisibility,
            followingNativeElement: candidate.followingNativeElement,
            prefixHex: prefixHex(combined, countOffset),
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
        dictionary,
      );
      const inflated =
        read ??
        salvageRevitChunk(
          stored,
          offsets[chunkIndex]!,
          offsets[chunkIndex + 1],
          dictionary,
        );
      if (!inflated) continue;
      if (read) dictionary = revitWindowTail(read);
      chunks += 1;
      inflatedBytes += inflated.byteLength;
      pending.push({ data: inflated, chunkIndex });
      if (pending.length >= ROLLING_CHUNKS) scanOldest();
    }
    while (pending.length) scanOldest();
  }

  console.log(
    JSON.stringify(
      {
        inputPath,
        inputBytes: input.byteLength,
        partitions: partitions.length,
        chunks,
        inflatedBytes,
        rollingChunks: ROLLING_CHUNKS,
        bounds: {
          maxVertices: MAX_VERTICES,
          maxFacets: MAX_FACETS,
          maxAbsCoordinate: MAX_ABS_COORDINATE,
        },
        countOffsetsTested,
        nativeElementContext: {
          identities: nativeElements.size,
          evidence:
            nativeElements.size > 0
              ? "Global/History+Global/ElemTable"
              : "unavailable",
        },
        layouts: LAYOUTS.map((layout) => ({
          ...layout,
          candidates: candidates.get(layout.name),
        })),
        boundary:
          "A candidate is only an adjacent counted-array body. Emission still requires a corroborated containing GPolyMesh/geometry object, transform, owner, and material/style IDs.",
      },
      null,
      2,
    ),
  );
}

if (process.argv[1]?.endsWith("probe-counted-topology.ts")) {
  main(process.argv.slice(2));
}
