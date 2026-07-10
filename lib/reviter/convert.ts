import CFB from "cfb";
import { inflateSync } from "fflate";

import { parseElemTable } from "./elem-table.ts";
import { decoderPlanForVersion, scanArcWall2023Records } from "./native-decoder.ts";

import type {
  Bounds3,
  ConvertOptions,
  ConvertOutcome,
  ConvertResult,
  ElementBoundsRecord,
  LevelBand,
  MeshData,
  MaterialData,
  NativeProfileLocator,
  PartitionRecordLocator,
  ProgressUpdate,
  Segment,
  Vec3,
} from "./types";

const GZIP_MAGIC = [0x1f, 0x8b, 0x08] as const;
const DEFAULT_MAX_SEGMENTS = 12_000;
const BOUNDS_SCAN_BYTES = 1_024;
const BOUNDS_DUPLICATE_BYTES = 48;
const MIN_SOLID_SPAN_FEET = 0.001;

type ProgressCallback = (update: ProgressUpdate) => void;

function displayMaterials(): MaterialData[] {
  return [{
    name: "Reviter unassigned display material",
    baseColorLinear: [0.2, 0.75, 0.78, 1],
    metallic: 0.04,
    roughness: 0.74,
    doubleSided: true,
    source: "display-fallback",
    assignedElements: 0,
  }];
}

function asBytes(value: number[] | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function gzipHeaderLength(data: Uint8Array, offset: number): number | null {
  if (
    offset + 10 > data.length ||
    data[offset] !== GZIP_MAGIC[0] ||
    data[offset + 1] !== GZIP_MAGIC[1] ||
    data[offset + 2] !== GZIP_MAGIC[2]
  ) {
    return null;
  }

  const flags = data[offset + 3] ?? 0;
  let cursor = offset + 10;

  if (flags & 0x04) {
    if (cursor + 2 > data.length) return null;
    const extraLength = (data[cursor] ?? 0) | ((data[cursor + 1] ?? 0) << 8);
    cursor += 2 + extraLength;
  }

  for (const flag of [0x08, 0x10]) {
    if (!(flags & flag)) continue;
    while (cursor < data.length && data[cursor] !== 0) cursor += 1;
    cursor += 1;
  }

  if (flags & 0x02) cursor += 2;
  return cursor <= data.length ? cursor - offset : null;
}

function gzipOffsets(data: Uint8Array, limit = 10_000): number[] {
  const result: number[] = [];
  for (let i = 0; i + 3 <= data.length && result.length < limit; i += 1) {
    if (
      data[i] === GZIP_MAGIC[0] &&
      data[i + 1] === GZIP_MAGIC[1] &&
      data[i + 2] === GZIP_MAGIC[2]
    ) {
      result.push(i);
      i += 9;
    }
  }
  return result;
}

function inflateRevitChunk(data: Uint8Array, offset: number): Uint8Array | null {
  const headerLength = gzipHeaderLength(data, offset);
  if (headerLength == null) return null;
  const body = data.subarray(offset + headerLength);
  if (!body.length) return null;
  try {
    return inflateSync(body);
  } catch {
    return null;
  }
}

function plausibleCoordinate(value: number): boolean {
  return (
    Number.isFinite(value) &&
    (value === 0 || Math.abs(value) >= 1e-6) &&
    Math.abs(value) <= 50_000
  );
}

function scanSegments(data: Uint8Array, target: Segment[], limit: number): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let offset = 0; offset + 48 <= data.byteLength && target.length < limit; offset += 8) {
    const values = Array.from({ length: 6 }, (_, index) =>
      view.getFloat64(offset + index * 8, true),
    );
    if (!values.every(plausibleCoordinate)) continue;

    const [x0, y0, z0, x1, y1, z1] = values as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (Math.abs(z1 - z0) > 0.5 || z0 < -50 || z0 > 400) continue;
    if (length < 2 || length > 400) continue;
    if (Math.abs(x0) + Math.abs(y0) + Math.abs(x1) + Math.abs(y1) < 1) continue;

    target.push({ x0, y0, z0, x1, y1, z1 });
    offset += 40;
  }
}

function leadingU32(data: Uint8Array): number | null {
  if (data.length < 4) return null;
  return (
    ((data[0] ?? 0) |
      ((data[1] ?? 0) << 8) |
      ((data[2] ?? 0) << 16) |
      ((data[3] ?? 0) << 24)) >>> 0
  );
}

export type DetectedBoundsRecord = {
  elementId: number;
  recordOffset: number;
  boundsFeet: Bounds3;
};

export function detectDuplicatedBoundsRecord(data: Uint8Array): DetectedBoundsRecord | null {
  const elementId = leadingU32(data);
  if (!elementId || elementId === 0xffffffff || data.byteLength < BOUNDS_DUPLICATE_BYTES * 2) {
    return null;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const scanEnd = Math.min(
    data.byteLength - BOUNDS_DUPLICATE_BYTES * 2,
    BOUNDS_SCAN_BYTES,
  );
  for (let offset = 0; offset <= scanEnd; offset += 1) {
    let duplicate = true;
    for (let byte = 0; byte < BOUNDS_DUPLICATE_BYTES; byte += 1) {
      if (data[offset + byte] !== data[offset + BOUNDS_DUPLICATE_BYTES + byte]) {
        duplicate = false;
        break;
      }
    }
    if (!duplicate) continue;

    const values = Array.from({ length: 6 }, (_, index) =>
      view.getFloat64(offset + index * 8, true),
    );
    if (!values.every((value) => Number.isFinite(value) && Math.abs(value) <= 50_000)) {
      continue;
    }
    const [minX, minY, minZ, maxX, maxY, maxZ] = values as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const spans = [maxX - minX, maxY - minY, maxZ - minZ];
    if (
      spans.some((span) => span < -1e-8 || span > 5_000) ||
      spans.filter((span) => span > MIN_SOLID_SPAN_FEET).length < 2
    ) {
      continue;
    }
    return {
      elementId,
      recordOffset: offset,
      boundsFeet: {
        min: { x: minX, y: minY, z: minZ },
        max: { x: maxX, y: maxY, z: maxZ },
      },
    };
  }
  return null;
}

function segmentKey(segment: Segment): string {
  const round = (value: number) => Math.round(value * 20) / 20;
  return [segment.x0, segment.y0, segment.z0, segment.x1, segment.y1, segment.z1]
    .map(round)
    .join(",");
}

function deduplicate(segments: Segment[]): Segment[] {
  const seen = new Set<string>();
  const result: Segment[] = [];
  for (const segment of segments) {
    const forward = segmentKey(segment);
    const reverse = segmentKey({
      x0: segment.x1,
      y0: segment.y1,
      z0: segment.z1,
      x1: segment.x0,
      y1: segment.y0,
      z1: segment.z0,
    });
    if (seen.has(forward) || seen.has(reverse)) continue;
    seen.add(forward);
    result.push(segment);
  }
  return result;
}

function cellKey(x: number, y: number, cellSize: number): string {
  return `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
}

function focusPrimaryCluster(segments: Segment[]): Segment[] {
  if (segments.length < 250) return segments;

  const cellSize = 250;
  const counts = new Map<string, number>();
  for (const segment of segments) {
    const key = cellKey((segment.x0 + segment.x1) / 2, (segment.y0 + segment.y1) / 2, cellSize);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const densest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!densest) return segments;

  const threshold = Math.max(4, Math.floor(densest[1] * 0.002));
  const accepted = new Set<string>();
  const queue = [densest[0]];

  while (queue.length) {
    const current = queue.shift()!;
    if (accepted.has(current) || (counts.get(current) ?? 0) < threshold) continue;
    accepted.add(current);
    const [cx, cy] = current.split(",").map(Number);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (dx || dy) queue.push(`${cx + dx},${cy + dy}`);
      }
    }
  }

  const focused = segments.filter((segment) =>
    accepted.has(
      cellKey((segment.x0 + segment.x1) / 2, (segment.y0 + segment.y1) / 2, cellSize),
    ),
  );
  return focused.length >= Math.min(100, segments.length * 0.1) ? focused : segments;
}

function sampleEvenly(segments: Segment[], limit: number): Segment[] {
  if (segments.length <= limit) return segments;
  const result: Segment[] = [];
  const stride = segments.length / limit;
  for (let i = 0; i < limit; i += 1) result.push(segments[Math.floor(i * stride)]!);
  return result;
}

function trimVerticalOutliers(segments: Segment[]): Segment[] {
  if (segments.length < 1_000) return segments;
  const elevations = segments.map((segment) => segment.z0).sort((a, b) => a - b);
  const low = elevations[Math.floor((elevations.length - 1) * 0.005)]!;
  const high = elevations[Math.floor((elevations.length - 1) * 0.985)]!;
  const trimmed = segments.filter((segment) => segment.z0 >= low && segment.z0 <= high);
  return trimmed.length >= segments.length * 0.9 ? trimmed : segments;
}

function rawBounds(segments: Segment[]): { min: Vec3; max: Vec3 } {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const segment of segments) {
    for (const point of [
      { x: segment.x0, y: segment.y0, z: segment.z0 },
      { x: segment.x1, y: segment.y1, z: segment.z1 },
    ]) {
      min.x = Math.min(min.x, point.x);
      min.y = Math.min(min.y, point.y);
      min.z = Math.min(min.z, point.z);
      max.x = Math.max(max.x, point.x);
      max.y = Math.max(max.y, point.y);
      max.z = Math.max(max.z, point.z);
    }
  }
  if (!Number.isFinite(min.x)) return { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };
  return { min, max };
}

function levelsFor(segments: Segment[]): LevelBand[] {
  const bands = new Map<number, number>();
  for (const segment of segments) {
    const elevation = Math.round(segment.z0 * 2) / 2;
    bands.set(elevation, (bands.get(elevation) ?? 0) + 1);
  }
  return [...bands.entries()]
    .map(([elevation, candidates]) => ({ elevation, candidates }))
    .sort((a, b) => b.candidates - a.candidates)
    .slice(0, 8);
}

function extrude(segment: Segment, origin: Vec3, thickness: number, height: number) {
  const dx = segment.x1 - segment.x0;
  const dy = segment.y1 - segment.y0;
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * thickness * 0.5;
  const ny = (dx / length) * thickness * 0.5;
  const z0 = Math.min(segment.z0, segment.z1);
  const z1 = z0 + height;
  const points = [
    [segment.x0 + nx, segment.y0 + ny, z0],
    [segment.x0 - nx, segment.y0 - ny, z0],
    [segment.x1 - nx, segment.y1 - ny, z0],
    [segment.x1 + nx, segment.y1 + ny, z0],
    [segment.x0 + nx, segment.y0 + ny, z1],
    [segment.x0 - nx, segment.y0 - ny, z1],
    [segment.x1 - nx, segment.y1 - ny, z1],
    [segment.x1 + nx, segment.y1 + ny, z1],
  ];
  const positions = points.flatMap(([x, y, z]) => [x! - origin.x, y! - origin.y, z! - origin.z]);
  const indices = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
  ];
  return { positions, indices };
}

function buildMeshes(
  segments: Segment[],
  origin: Vec3,
  thickness: number,
  height: number,
): MeshData[] {
  const meshes: MeshData[] = [];
  const batchSize = 2_000;
  for (let start = 0; start < segments.length; start += batchSize) {
    const positions: number[] = [];
    const indices: number[] = [];
    const colors: number[] = [];
    const batch = segments.slice(start, start + batchSize);
    let vertexOffset = 0;
    for (const segment of batch) {
      const box = extrude(segment, origin, thickness, height);
      positions.push(...box.positions);
      indices.push(...box.indices.map((index) => index + vertexOffset));
      vertexOffset += 8;
      const level = Math.max(0, Math.min(1, (segment.z0 - origin.z + 10) / 80));
      for (let vertex = 0; vertex < 8; vertex += 1) {
        colors.push(0.2 + level * 0.18, 0.68 + level * 0.12, 0.78 + level * 0.16);
      }
    }
    meshes.push({
      name: `Recovered geometry ${meshes.length + 1}`,
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
      colors: new Float32Array(colors),
      materialIndex: 0,
    });
  }
  return meshes;
}

function solidBounds(record: ElementBoundsRecord): boolean {
  const { min, max } = record.boundsFeet;
  return (
    max.x - min.x > MIN_SOLID_SPAN_FEET &&
    max.y - min.y > MIN_SOLID_SPAN_FEET &&
    max.z - min.z > MIN_SOLID_SPAN_FEET
  );
}

function boundsOfRecords(records: ElementBoundsRecord[]): Bounds3 {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const record of records) {
    const bounds = record.boundsFeet;
    min.x = Math.min(min.x, bounds.min.x);
    min.y = Math.min(min.y, bounds.min.y);
    min.z = Math.min(min.z, bounds.min.z);
    max.x = Math.max(max.x, bounds.max.x);
    max.y = Math.max(max.y, bounds.max.y);
    max.z = Math.max(max.z, bounds.max.z);
  }
  return { min, max };
}

function selectDisplayBounds(records: ElementBoundsRecord[]): {
  records: ElementBoundsRecord[];
  omittedContainerCount: number;
} {
  if (records.length < 2) return { records, omittedContainerCount: 0 };
  const byFootprint = records
    .map((record) => {
      const { min, max } = record.boundsFeet;
      const dx = max.x - min.x;
      const dy = max.y - min.y;
      return { record, footprint: dx * dy, longestSide: Math.max(dx, dy) };
    })
    .sort((a, b) => b.footprint - a.footprint);
  const largest = byFootprint[0]!;
  const runnerUp = byFootprint[1]!;
  const isDominantContainer =
    largest.longestSide > 500 && largest.footprint > runnerUp.footprint * 2.5;
  if (!isDominantContainer) return { records, omittedContainerCount: 0 };
  return {
    records: records.filter((record) => record !== largest.record),
    omittedContainerCount: 1,
  };
}

function boxGeometry(bounds: Bounds3, origin: Vec3) {
  const { min, max } = bounds;
  const points = [
    [min.x, min.y, min.z], [max.x, min.y, min.z], [max.x, max.y, min.z], [min.x, max.y, min.z],
    [min.x, min.y, max.z], [max.x, min.y, max.z], [max.x, max.y, max.z], [min.x, max.y, max.z],
  ];
  return {
    positions: points.flatMap(([x, y, z]) => [x! - origin.x, y! - origin.y, z! - origin.z]),
    indices: [
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
      1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
    ],
  };
}

function buildBoundsMeshes(records: ElementBoundsRecord[], origin: Vec3): MeshData[] {
  const meshes: MeshData[] = [];
  const batchSize = 2_000;
  for (let start = 0; start < records.length; start += batchSize) {
    const positions: number[] = [];
    const indices: number[] = [];
    const colors: number[] = [];
    let vertexOffset = 0;
    for (const record of records.slice(start, start + batchSize)) {
      const box = boxGeometry(record.boundsFeet, origin);
      positions.push(...box.positions);
      indices.push(...box.indices.map((index) => index + vertexOffset));
      vertexOffset += 8;
      const elevation = Math.max(0, Math.min(1, (record.boundsFeet.min.z - origin.z + 10) / 80));
      for (let vertex = 0; vertex < 8; vertex += 1) {
        colors.push(0.18 + elevation * 0.2, 0.72 + elevation * 0.1, 0.74 + elevation * 0.18);
      }
    }
    meshes.push({
      name: `RVT element bounds ${meshes.length + 1}`,
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
      colors: new Float32Array(colors),
      materialIndex: 0,
    });
  }
  return meshes;
}

function boundsPlanSegments(records: ElementBoundsRecord[]): Segment[] {
  return records.flatMap(({ boundsFeet: { min, max } }) => [
    { x0: min.x, y0: min.y, z0: min.z, x1: max.x, y1: min.y, z1: min.z },
    { x0: max.x, y0: min.y, z0: min.z, x1: max.x, y1: max.y, z1: min.z },
    { x0: max.x, y0: max.y, z0: min.z, x1: min.x, y1: max.y, z1: min.z },
    { x0: min.x, y0: max.y, z0: min.z, x1: min.x, y1: min.y, z1: min.z },
  ]);
}

function levelsForBounds(records: ElementBoundsRecord[]): LevelBand[] {
  const bands = new Map<number, number>();
  for (const record of records) {
    const elevation = Math.round(record.boundsFeet.min.z * 2) / 2;
    bands.set(elevation, (bands.get(elevation) ?? 0) + 1);
  }
  return [...bands.entries()]
    .map(([elevation, candidates]) => ({ elevation, candidates }))
    .sort((a, b) => b.candidates - a.candidates)
    .slice(0, 8);
}

export function convertRvtBytes(
  input: ArrayBuffer | Uint8Array,
  fileName = "model.rvt",
  options: ConvertOptions = {},
  onProgress?: ProgressCallback,
): ConvertOutcome {
  const started = performance.now();
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const maxSegments = options.maxSegments ?? DEFAULT_MAX_SEGMENTS;
  const decoderPlan = decoderPlanForVersion(options.revitVersion);

  try {
    onProgress?.({ ratio: 0.03, message: "Opening Revit container" });
    const cfb = CFB.read(bytes, { type: "buffer" });
    const elemTableEntry = cfb.FileIndex
      .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
      .find(({ entry, path }) => entry.size > 0 && /\/Global\/ElemTable$/i.test(path));
    let elementIndex;
    if (elemTableEntry) {
      const elemTableBytes = asBytes(elemTableEntry.entry.content);
      const offset = gzipOffsets(elemTableBytes, 1)[0];
      const inflated = offset == null ? null : inflateRevitChunk(elemTableBytes, offset);
      if (inflated) elementIndex = parseElemTable(inflated) ?? undefined;
    }
    const partitions = cfb.FileIndex
      .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
      .filter(({ entry, path }) => entry.size > 0 && /\/Partitions\/[^/]+$/i.test(path));

    if (!partitions.length) throw new Error("No Revit partition stream was found.");

    const candidates: Segment[] = [];
    const elementBounds: ElementBoundsRecord[] = [];
    const nativeProfiles: NativeProfileLocator[] = [];
    const boundedElementIds = new Set<number>();
    const partitionRecords: PartitionRecordLocator[] = [];
    const partitionRecordIds = new Set<number>();
    let gzipChunks = 0;
    let inflatedBytes = 0;
    const scanLimit = Math.max(maxSegments * 4, 40_000);

    for (let partitionIndex = 0; partitionIndex < partitions.length; partitionIndex += 1) {
      const partition = partitions[partitionIndex]!;
      const data = asBytes(partition.entry.content);
      const offsets = gzipOffsets(data);
      const stride = offsets.length > 900 ? Math.ceil(offsets.length / 700) : 1;

      for (let index = 0; index < offsets.length; index += 1) {
        const inflated = inflateRevitChunk(data, offsets[index]!);
        if (!inflated) continue;
        gzipChunks += 1;
        inflatedBytes += inflated.byteLength;
        const elementId = leadingU32(inflated);
        if (elementId && elementId !== 0xffffffff) {
          partitionRecordIds.add(elementId);
          partitionRecords.push({
            elementId,
            stream: partition.path.replace(/^Root Entry\//, ""),
            chunkIndex: index,
            rawOffset: offsets[index]!,
            inflatedBytes: inflated.byteLength,
          });
        }
        for (const profile of scanArcWall2023Records(inflated, decoderPlan.revitVersion ?? undefined)) {
          nativeProfiles.push({
            decoderId: profile.decoderId,
            revitVersion: profile.revitVersion,
            stream: partition.path.replace(/^Root Entry\//, ""),
            chunkIndex: index,
            rawOffset: offsets[index]!,
            recordOffset: profile.recordOffset,
            variant: profile.variant,
            centerline: profile.centerline,
            duplicateMatches: profile.duplicateMatches,
          });
        }
        const detectedBounds = decoderPlan.elementBoundsDecoder
          ? detectDuplicatedBoundsRecord(inflated)
          : null;
        if (detectedBounds && !boundedElementIds.has(detectedBounds.elementId)) {
          boundedElementIds.add(detectedBounds.elementId);
          elementBounds.push({
            elementId: detectedBounds.elementId,
            stream: partition.path.replace(/^Root Entry\//, ""),
            chunkIndex: index,
            rawOffset: offsets[index]!,
            recordOffset: detectedBounds.recordOffset,
            boundsFeet: detectedBounds.boundsFeet,
          });
        }
        if (inflated.byteLength >= 48 && index % stride === 0 && candidates.length < scanLimit) {
          scanSegments(inflated, candidates, scanLimit);
        }
        if (gzipChunks % 36 === 0) {
          onProgress?.({
            ratio: Math.min(0.82, 0.12 + (index / Math.max(1, offsets.length)) * 0.68),
            message: `Reading partition geometry · ${nativeProfiles.length.toLocaleString()} native profiles · ${elementBounds.length.toLocaleString()} exact bounds`,
          });
        }
      }
    }

    onProgress?.({ ratio: 0.86, message: "Removing duplicates and spatial noise" });
    const unique = deduplicate(candidates);
    const focused = trimVerticalOutliers(focusPrimaryCluster(unique));
    const used = sampleEvenly(focused, maxSegments);
    const boundedSolids = elementBounds.filter(solidBounds);
    if (nativeProfiles.length) {
      const nativeSegments = sampleEvenly(
        deduplicate(nativeProfiles.map((profile) => profile.centerline)),
        maxSegments,
      );
      const bounds = rawBounds(nativeSegments);
      const origin = {
        x: (bounds.min.x + bounds.max.x) / 2,
        y: (bounds.min.y + bounds.max.y) / 2,
        z: bounds.min.z,
      };
      const height = options.wallHeight ?? 10;
      const meshes = buildMeshes(nativeSegments, origin, options.wallThickness ?? 0.5, height);
      const relativeBounds = {
        min: { x: bounds.min.x - origin.x, y: bounds.min.y - origin.y, z: 0 },
        max: {
          x: bounds.max.x - origin.x,
          y: bounds.max.y - origin.y,
          z: bounds.max.z - origin.z + height,
        },
      };
      const result: ConvertResult = {
        ok: true,
        fileName,
        byteLength: bytes.byteLength,
        meshes,
        materials: displayMaterials(),
        segments: nativeSegments,
        elementBounds,
        nativeProfiles,
        decoderCoverage: {
          revitVersion: decoderPlan.revitVersion,
          activeDecoders: ["revit-2023-arcwall-standard-v1"],
          nativeCurves: nativeProfiles.length,
          nativeProfiles: nativeProfiles.length,
          nativeMeshes: 0,
          nativeMaterialDefinitions: 0,
          nativeMaterialAssignments: 0,
          approximateSolids: nativeSegments.length,
          geometryFidelity: "native-profile-approximate-solid",
          materialFidelity: "display-fallback",
        },
        origin,
        bbox: relativeBounds,
        levels: levelsFor(nativeSegments),
        method: "native-profile-recovery",
        elementIndex: elementIndex
          ? {
              ...elementIndex,
              partitionRecordIds: Uint32Array.from([...partitionRecordIds].sort((a, b) => a - b)),
              partitionRecords,
            }
          : undefined,
        warnings: [
          `${nativeProfiles.length.toLocaleString()} Revit 2023 ArcWall records supplied native centerline profiles.`,
          "Displayed wall thickness and height are explicit defaults because those dimensions are not decoded from this record yet.",
          "No native mesh, opening, layer assignment, or texture asset was decoded; the cyan material is a display fallback.",
        ],
        stats: {
          streamCount: cfb.FileIndex.filter((entry) => entry.size > 0).length,
          partitionStreams: partitions.length,
          gzipChunks,
          inflatedBytes,
          candidatesFound: nativeProfiles.length,
          candidatesFocused: nativeProfiles.length,
          candidatesUsed: nativeSegments.length,
          vertexCount: nativeSegments.length * 8,
          triangleCount: nativeSegments.length * 12,
          meshCount: meshes.length,
          boundsRecordsFound: elementBounds.length,
          solidBoundsRecords: boundedSolids.length,
          durationMs: performance.now() - started,
        },
      };
      onProgress?.({ ratio: 1, message: "Ready" });
      return result;
    }
    if (boundedSolids.length) {
      const displaySelection = selectDisplayBounds(boundedSolids);
      const displayBounds = displaySelection.records;
      const bounds = boundsOfRecords(displayBounds);
      const origin = {
        x: (bounds.min.x + bounds.max.x) / 2,
        y: (bounds.min.y + bounds.max.y) / 2,
        z: bounds.min.z,
      };
      const meshes = buildBoundsMeshes(displayBounds, origin);
      const segments = boundsPlanSegments(displayBounds);
      const relativeBounds = {
        min: { x: bounds.min.x - origin.x, y: bounds.min.y - origin.y, z: 0 },
        max: {
          x: bounds.max.x - origin.x,
          y: bounds.max.y - origin.y,
          z: bounds.max.z - origin.z,
        },
      };
      const result: ConvertResult = {
        ok: true,
        fileName,
        byteLength: bytes.byteLength,
        meshes,
        materials: displayMaterials(),
        segments,
        elementBounds,
        nativeProfiles,
        decoderCoverage: {
          revitVersion: decoderPlan.revitVersion,
          activeDecoders: ["revit-2027-duplicated-bounds-v1"],
          nativeCurves: 0,
          nativeProfiles: 0,
          nativeMeshes: 0,
          nativeMaterialDefinitions: 0,
          nativeMaterialAssignments: 0,
          approximateSolids: displayBounds.length,
          geometryFidelity: "native-bounds-envelope",
          materialFidelity: "display-fallback",
        },
        origin,
        bbox: relativeBounds,
        levels: levelsForBounds(displayBounds),
        method: "partition-bounds-recovery",
        elementIndex: elementIndex
          ? {
              ...elementIndex,
              partitionRecordIds: Uint32Array.from([...partitionRecordIds].sort((a, b) => a - b)),
              partitionRecords,
            }
          : undefined,
        warnings: [
          `${boundedSolids.length.toLocaleString()} native element records supplied duplicated, validated 3D bounds.`,
          ...(displaySelection.omittedContainerCount
            ? ["One dominant container-like envelope remains in audit and IFC output but is omitted from the default scene so it cannot hide the building."]
            : []),
          "Geometry uses exact RVT axis-aligned element envelopes; curved profiles, openings, materials, and parameters are not decoded yet.",
        ],
        stats: {
          streamCount: cfb.FileIndex.filter((entry) => entry.size > 0).length,
          partitionStreams: partitions.length,
          gzipChunks,
          inflatedBytes,
          candidatesFound: elementBounds.length,
          candidatesFocused: displayBounds.length,
          candidatesUsed: displayBounds.length,
          vertexCount: displayBounds.length * 8,
          triangleCount: displayBounds.length * 12,
          meshCount: meshes.length,
          boundsRecordsFound: elementBounds.length,
          solidBoundsRecords: boundedSolids.length,
          durationMs: performance.now() - started,
        },
      };
      onProgress?.({ ratio: 1, message: "Ready" });
      return result;
    }
    if (!used.length) throw new Error("The file opened, but no plausible geometry was recovered.");

    const bounds = rawBounds(used);
    const origin = {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: bounds.min.z,
    };
    const meshes = buildMeshes(
      used,
      origin,
      options.wallThickness ?? 0.5,
      options.wallHeight ?? 10,
    );
    const relativeBounds = {
      min: { x: bounds.min.x - origin.x, y: bounds.min.y - origin.y, z: 0 },
      max: {
        x: bounds.max.x - origin.x,
        y: bounds.max.y - origin.y,
        z: bounds.max.z - origin.z + (options.wallHeight ?? 10),
      },
    };

    const result: ConvertResult = {
      ok: true,
      fileName,
      byteLength: bytes.byteLength,
      meshes,
      materials: displayMaterials(),
      segments: used,
      elementBounds,
      nativeProfiles,
      decoderCoverage: {
        revitVersion: decoderPlan.revitVersion,
        activeDecoders: [],
        nativeCurves: 0,
        nativeProfiles: 0,
        nativeMeshes: 0,
        nativeMaterialDefinitions: 0,
        nativeMaterialAssignments: 0,
        approximateSolids: used.length,
        geometryFidelity: "diagnostic-only",
        materialFidelity: "display-fallback",
      },
      origin,
      bbox: relativeBounds,
      levels: levelsFor(used),
      method: "partition-coordinate-recovery",
      elementIndex: elementIndex
        ? {
            ...elementIndex,
            partitionRecordIds: Uint32Array.from(
              [...partitionRecordIds].sort((a, b) => a - b),
            ),
            partitionRecords,
          }
        : undefined,
      warnings: [
        ...(decoderPlan.revitVersion == null
          ? ["No Revit release was supplied, so release-specific native record decoders were safely disabled."]
          : []),
        "Geometry is inferred from coordinate-like partition records and is not a native Revit element model.",
        focused.length < unique.length
          ? `Focused on the primary spatial cluster and omitted ${(unique.length - focused.length).toLocaleString()} isolated candidates.`
          : "No isolated spatial cluster was removed.",
      ],
      stats: {
        streamCount: cfb.FileIndex.filter((entry) => entry.size > 0).length,
        partitionStreams: partitions.length,
        gzipChunks,
        inflatedBytes,
        candidatesFound: unique.length,
        candidatesFocused: focused.length,
        candidatesUsed: used.length,
        vertexCount: used.length * 8,
        triangleCount: used.length * 12,
        meshCount: meshes.length,
        boundsRecordsFound: elementBounds.length,
        solidBoundsRecords: boundedSolids.length,
        durationMs: performance.now() - started,
      },
    };
    onProgress?.({ ratio: 1, message: "Ready" });
    return result;
  } catch (error) {
    return {
      ok: false,
      fileName,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
