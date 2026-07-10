import CFB from "cfb";
import { inflateSync } from "fflate";

import type {
  ConvertOptions,
  ConvertOutcome,
  ConvertResult,
  LevelBand,
  MeshData,
  ProgressUpdate,
  Segment,
  Vec3,
} from "./types";

const GZIP_MAGIC = [0x1f, 0x8b, 0x08] as const;
const DEFAULT_MAX_SEGMENTS = 12_000;

type ProgressCallback = (update: ProgressUpdate) => void;

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
    });
  }
  return meshes;
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

  try {
    onProgress?.({ ratio: 0.03, message: "Opening Revit container" });
    const cfb = CFB.read(bytes, { type: "buffer" });
    const partitions = cfb.FileIndex
      .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
      .filter(({ entry, path }) => entry.size > 0 && /\/Partitions\/[^/]+$/i.test(path));

    if (!partitions.length) throw new Error("No Revit partition stream was found.");

    const candidates: Segment[] = [];
    let gzipChunks = 0;
    let inflatedBytes = 0;
    const scanLimit = Math.max(maxSegments * 4, 40_000);

    for (let partitionIndex = 0; partitionIndex < partitions.length; partitionIndex += 1) {
      const partition = partitions[partitionIndex]!;
      const data = asBytes(partition.entry.content);
      const offsets = gzipOffsets(data);
      const stride = offsets.length > 900 ? Math.ceil(offsets.length / 700) : 1;

      for (let index = 0; index < offsets.length; index += stride) {
        if (candidates.length >= scanLimit) break;
        const inflated = inflateRevitChunk(data, offsets[index]!);
        if (!inflated || inflated.byteLength < 48) continue;
        gzipChunks += 1;
        inflatedBytes += inflated.byteLength;
        scanSegments(inflated, candidates, scanLimit);
        if (gzipChunks % 36 === 0) {
          onProgress?.({
            ratio: Math.min(0.82, 0.12 + (index / Math.max(1, offsets.length)) * 0.68),
            message: `Reading partition geometry · ${candidates.length.toLocaleString()} candidates`,
          });
        }
      }
    }

    onProgress?.({ ratio: 0.86, message: "Removing duplicates and spatial noise" });
    const unique = deduplicate(candidates);
    const focused = trimVerticalOutliers(focusPrimaryCluster(unique));
    const used = sampleEvenly(focused, maxSegments);
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
      segments: used,
      origin,
      bbox: relativeBounds,
      levels: levelsFor(used),
      method: "partition-coordinate-recovery",
      warnings: [
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
