/**
 * The diagnostic coordinate scanner and its cleanup passes.
 *
 * This is the fallback path for files with no release-specific element decoder.
 * It looks for six consecutive doubles that read as a plausible line segment,
 * then prunes the result down to a coherent cluster. What it produces is
 * evidence of coordinate-like data, not a decoded Revit element model, and every
 * caller labels it that way.
 */
import type { ConvertOptions, LevelBand, Segment, Vec3 } from "./types";

/**
 * Coordinate windows for the diagnostic segment scanner, in feet.
 *
 * A project spans a building; a family (`.rfa`/`.rft`) spans a single component
 * and its curves are one to two orders of magnitude shorter. Applying the
 * project window to a family rejects every candidate and admits long spurious
 * runs the component cannot physically contain.
 */
export type SegmentScale = {
  minLength: number;
  maxLength: number;
  minZ: number;
  maxZ: number;
  minMagnitude: number;
};

export const PROJECT_SEGMENT_SCALE: SegmentScale = {
  minLength: 2,
  maxLength: 400,
  minZ: -50,
  maxZ: 400,
  minMagnitude: 1,
};

export const FAMILY_SEGMENT_SCALE: SegmentScale = {
  minLength: 0.05,
  maxLength: 60,
  minZ: -60,
  maxZ: 400,
  minMagnitude: 0.02,
};

const MAX_SEGMENT_DELTA_Z = 0.5;

export function segmentScaleFor(
  fileName: string,
  requested?: ConvertOptions["geometryScale"],
): SegmentScale {
  if (requested === "family") return FAMILY_SEGMENT_SCALE;
  if (requested === "project") return PROJECT_SEGMENT_SCALE;
  return /\.(rfa|rft)$/i.test(fileName) ? FAMILY_SEGMENT_SCALE : PROJECT_SEGMENT_SCALE;
}

function plausibleCoordinate(value: number): boolean {
  return (
    Number.isFinite(value) &&
    (value === 0 || Math.abs(value) >= 1e-6) &&
    Math.abs(value) <= 50_000
  );
}

export function scanSegments(
  data: Uint8Array,
  target: Segment[],
  limit: number,
  scale: SegmentScale,
): void {
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
    if (Math.abs(z1 - z0) > MAX_SEGMENT_DELTA_Z || z0 < scale.minZ || z0 > scale.maxZ) continue;
    if (length < scale.minLength || length > scale.maxLength) continue;
    if (Math.abs(x0) + Math.abs(y0) + Math.abs(x1) + Math.abs(y1) < scale.minMagnitude) continue;

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

export function deduplicate(segments: Segment[]): Segment[] {
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

/** Flood-fill the densest occupied cell so far-flung noise is dropped. */
export function focusPrimaryCluster(segments: Segment[]): Segment[] {
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

export function sampleEvenly(segments: Segment[], limit: number): Segment[] {
  if (segments.length <= limit) return segments;
  const result: Segment[] = [];
  const stride = segments.length / limit;
  for (let i = 0; i < limit; i += 1) result.push(segments[Math.floor(i * stride)]!);
  return result;
}

export function trimVerticalOutliers(segments: Segment[]): Segment[] {
  if (segments.length < 1_000) return segments;
  const elevations = segments.map((segment) => segment.z0).sort((a, b) => a - b);
  const low = elevations[Math.floor((elevations.length - 1) * 0.005)]!;
  const high = elevations[Math.floor((elevations.length - 1) * 0.985)]!;
  const trimmed = segments.filter((segment) => segment.z0 >= low && segment.z0 <= high);
  return trimmed.length >= segments.length * 0.9 ? trimmed : segments;
}

export function rawBounds(segments: Segment[]): { min: Vec3; max: Vec3 } {
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

export function levelsFor(segments: Segment[]): LevelBand[] {
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
