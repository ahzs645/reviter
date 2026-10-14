/**
 * Source-authored Room evidence. This is deliberately independent of reviewed
 * indoor rooms, enclosure certification, access, and navigation.
 *
 * Room-solid face layout, tolerances and adjacent parameter entry layout are
 * adapted from Helen Kwok's Apache-2.0 rvt-rs partition_room_boundaries.rs and
 * partition_room_parameters.rs and room-record layout at 1c3d337. See
 * THIRD_PARTY_NOTICES.md.
 */
import type { SchemaSummary } from './schema.ts';
import type { ElementHeader } from './element-headers.ts';
import type { ElementParameter } from './element-parameters.ts';
import type { NativeAssociatedLevelRelation } from './level-relations.ts';
import type { Bounds3, ElementBoundsRecord } from './types.ts';

export const NATIVE_ROOM_CATEGORY = -2000160;
export const ROOM_OUTLINE_RELEASES = [2023, 2024, 2025] as const;
const BOX_EPS = 1e-3;
const JOIN_EPS = 1e-4;
const MAX_FACES = 512;
const MAX_SOLIDS = 50_000;
type Point = [number, number];
type Edge = { a: Point; b: Point; bottom: number };
type Location = { stream: string; chunkIndex: number; offset: number };
export type NativeRoomOutline = {
  source: 'partition-room-solid-faces';
  units: 'feet';
  outer: Point[];
  holes: Point[][];
  elevationFeet: number;
  areaSquareFeet: number;
  location: Location;
};
export type NativeRoom = {
  elementId: number;
  source: 'Partitions/ElementHeader.m_categoryId';
  categoryId: typeof NATIVE_ROOM_CATEGORY;
  location?: Location;
  nameSource?: 'partition-room-parameter-entries' | 'element-parameter-table';
  name?: string;
  number?: string;
  floorFinish?: string;
  levelId?: number;
  boundsFeet?: Bounds3;
  outline?: NativeRoomOutline;
  outlineStatus: 'decoded' | 'unsupported-release' | 'missing-record-bounds' | 'unresolved';
  /** Source evidence never certifies indoor enclosure or navigation. */
  enclosure: 'unreviewed-source';
  outlineIssue?: 'unsupported-curved-face';
};
export type NativeRoomCoverage = {
  revitVersion: number | null;
  semanticRooms: number;
  boxlessRooms: number;
  namedRooms: number;
  outlines: number;
  outlineSupported: boolean;
  evidenceLimitReached: boolean;
};
export type NativeRoomEvidence = {
  solids: Map<number, { edges: Edge[]; location: Location }[]>;
  names: Map<number, [string, string] | null>;
  limitReached: boolean;
  records: Map<number, { location: Location; boundsFeet?: Bounds3 }>;
  unsupportedSolidStreams: Map<number, Set<string>>;
};
export const createNativeRoomEvidence = (): NativeRoomEvidence => ({ solids: new Map(), names: new Map(), limitReached: false, records: new Map(), unsupportedSolidStreams: new Map() });

function matches(data: Uint8Array, at: number, tag: number[]): boolean {
  return at >= 0 && at + tag.length <= data.length && tag.every((b, i) => data[at + i] === b);
}
function idAt(view: DataView, at: number, width: number): number | null {
  if (at < 0 || at + width > view.byteLength || (width === 8 && view.getUint32(at + 4, true) !== 0)) return null;
  const id = view.getUint32(at, true);
  return id > 0 && id < 0x80000000 ? id : null;
}
function readFace(view: DataView, at: number): { uv: number[]; o: number[]; u: number[]; v: number[] } | null {
  const data = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  if (at + 158 > view.byteLength || !matches(data, at, [4, 0, 8, 0]) || data[at + 85] !== 1) return null;
  const read = (offset: number, n: number) => Array.from({ length: n }, (_, i) => view.getFloat64(at + offset + 8 * i, true));
  const uv = read(20, 4), o = read(86, 3), u = read(110, 3), v = read(134, 3);
  if (![...uv, ...o, ...u, ...v].every(Number.isFinite) || uv[0] > uv[2] || uv[1] > uv[3]) return null;
  const unit = (d: number[]) => Math.abs(d.reduce((s, x) => s + x * x, 0) - 1) < 1e-6;
  if (!unit(u) || !unit(v) || Math.abs(u.reduce((s, x, i) => s + x * v[i], 0)) > 1e-6) return null;
  return { uv, o, u, v };
}
function faceEdge(view: DataView, at: number): Edge | null {
  const face = readFace(view, at);
  if (!face) return null;
  const { uv, o, u, v } = face;
  const vertical = (d: number[]) => Math.abs(Math.abs(d[2]) - 1) < 1e-9;
  const horizontal = (d: number[]) => Math.abs(d[2]) < 1e-9;
  let h: number[], lo: number, hi: number, bottom: number;
  if (vertical(u) && horizontal(v)) {
    h = v; lo = uv[1]; hi = uv[3]; bottom = Math.min(o[2] + u[2] * uv[0], o[2] + u[2] * uv[2]);
  } else if (vertical(v) && horizontal(u)) {
    h = u; lo = uv[0]; hi = uv[2]; bottom = Math.min(o[2] + v[2] * uv[1], o[2] + v[2] * uv[3]);
  } else return null;
  return { a: [o[0] + h[0] * lo, o[1] + h[1] * lo], b: [o[0] + h[0] * hi, o[1] + h[1] * hi], bottom };
}
function parameterText(view: DataView, at: number, max: number): [string, number] | null {
  if (at + 4 > view.byteLength) return null;
  const n = view.getUint32(at, true);
  if (!n || n > max || at + 4 + n * 2 > view.byteLength) return null;
  try {
    const text = new TextDecoder('utf-16le', { fatal: true }).decode(new Uint8Array(view.buffer, view.byteOffset + at + 4, n * 2));
    return /[\u0000-\u001f\u007f-\u009f]/u.test(text) ? null : [text, at + 4 + n * 2];
  } catch { return null; }
}
/** RoomElem's own Outline, not the rendering GElement duplicated box. The
 * schema supplies every class tag; missing/changed classes fail closed. First
 * encountered source header wins, even when boxless, matching header selection
 * in the main scan. Other partitions cannot backfill the selected boxless record. */
export function scanNativeRoomRecords(data: Uint8Array, revitVersion: number | null, schema: SchemaSummary | undefined, location: Omit<Location, 'offset'>, evidence: NativeRoomEvidence, roomIds: ReadonlySet<number>): void {
  if (revitVersion == null || revitVersion < 2023 || revitVersion > 2027 || !schema) return;
  const tag = (name: string) => schema.taggedClasses.find(c => c.name === name)?.tag;
  const headerTag = tag('ElementHeader'), outlineTag = tag('Outline'), parentsTag = tag('ElementParents'), roomTag = tag('RoomElem');
  if (headerTag == null || outlineTag == null || parentsTag == null || roomTag == null) return;
  const width = revitVersion === 2023 ? 4 : 8, view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let at = width + 4; at + 6 < data.length; at++) {
    if (view.getUint16(at, true) !== headerTag) continue;
    const id = idAt(view, at - width - 4, width), count = view.getUint32(at + 2, true);
    if (id == null || !roomIds.has(id) || evidence.records.has(id) || count > 4096) continue;
    const categoryAt = at + 6 + count * (width === 8 ? 22 : 14);
    if (categoryAt + width > data.length || view.getInt32(categoryAt, true) !== NATIVE_ROOM_CATEGORY || (width === 8 && view.getInt32(categoryAt + 4, true) !== -1)) continue;
    const source: { location: Location; boundsFeet?: Bounds3 } = { location: { ...location, offset: at - width - 4 } };
    evidence.records.set(id, source);
    const box = categoryAt + width * 6 + 14;
    if (box + 56 > data.length || view.getUint16(box, true) !== outlineTag || !matches(data, box + 2, [255, 255, 255, 255]) || view.getUint16(box + 6, true) !== parentsTag || view.getUint16(box - 6, true) !== roomTag || view.getUint32(box - 14, true) !== 0xffffef7f) continue;
    const values = Array.from({ length: 6 }, (_, i) => view.getFloat64(box + 8 + i * 8, true));
    if (!values.every(v => Number.isFinite(v) && Math.abs(v) <= 1e7) || [0, 1, 2].some(i => values[i + 3] < values[i])) continue;
    source.boundsFeet = { min: { x: values[0], y: values[1], z: values[2] }, max: { x: values[3], y: values[4], z: values[5] } };
  }
}
/** Bounded per-page scan; truncated page-spanning solids remain unresolved. */
export function scanNativeRoomEvidence(data: Uint8Array, revitVersion: number | null, location: Omit<Location, 'offset'>, evidence: NativeRoomEvidence, roomIds: ReadonlySet<number>): void {
  if (revitVersion == null || revitVersion < 2023 || revitVersion > 2027) return;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = revitVersion === 2023 ? 4 : 8;
  const solidSupported = (ROOM_OUTLINE_RELEASES as readonly number[]).includes(revitVersion);
  for (let at = 0; at + 12 < data.length; at++) {
    if (solidSupported && matches(data, at, [4, 0x90, 8, 0])) {
      const prefix = matches(data, at - 4, [255, 255, 255, 255]) ? 12 : 8;
      const id = idAt(view, at - prefix, 8);
      if (id == null) continue;
      if (evidence.solids.size >= MAX_SOLIDS) { evidence.limitReached = true; continue; }
      const edges: Edge[] = [];
      let unsupportedSurface = false;
      let first = true, nextLimit = Math.min(data.length - 158, at + 4 + 0x10000);
      for (let cursor = at + 4; cursor <= nextLimit; cursor++) {
        if (!matches(data, cursor, [4, 0, 8, 0])) continue;
        // A valid nonvertical face is allowed between wall faces. Face parsing
        // requires the same finite unit-axis record as the upstream layout.
        const face = readFace(view, cursor);
        if (!face) continue;
        // A curved face uses a third finite orthonormal basis vector after
        // the two axes. Treating it as a horizontal plane loses curved
        // columns/shafts while still allowing the exterior loop to close.
        // Planar records end these fields with null (all-FF) handles.
        if (cursor + 182 <= data.length) {
          const w = [158, 166, 174].map(offset => view.getFloat64(cursor + offset, true));
          const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i], 0);
          if (w.every(Number.isFinite) && Math.abs(dot(w, w) - 1) < 1e-6 && Math.abs(dot(w, face.u)) < 1e-6 && Math.abs(dot(w, face.v)) < 1e-6) unsupportedSurface = true;
        }
        const edge = faceEdge(view, cursor);
        if (edge) edges.push(edge);
        first = false;
        nextLimit = Math.min(data.length - 158, cursor + 0x200 - 1);
        if (edges.length >= MAX_FACES) { evidence.limitReached = true; edges.length = 0; break; }
      }
      if (unsupportedSurface) {
        const streams = evidence.unsupportedSolidStreams.get(id) ?? new Set<string>();
        streams.add(location.stream); evidence.unsupportedSolidStreams.set(id, streams);
      }
      if (!first && edges.length && !unsupportedSurface) {
        const found = evidence.solids.get(id) ?? [];
        if (found.length < 16) found.push({ edges, location: { ...location, offset: at - prefix } });
        else evidence.limitReached = true;
        evidence.solids.set(id, found);
      }
    }
    // RE-117: object anchor, then the first adjacent number/name pair within
    // 0x400 bytes. Only exact room-category identities are joined at resolve.
    if (!matches(data, at, [1, 0, 0, 0])) continue;
    const id = idAt(view, at + 4, width);
    if (id == null || !roomIds.has(id) || (evidence.records.has(id) && evidence.records.get(id)!.location.stream !== location.stream)) continue;
    for (let p = at + 4 + width; p < Math.min(data.length - width, at + 4 + width + 0x400); p++) {
      if (view.getInt32(p, true) !== -1006901 || (width === 8 && view.getInt32(p + 4, true) !== -1)) continue;
      const number = parameterText(view, p + width, 64);
      if (!number || number[1] + width > data.length || view.getInt32(number[1], true) !== -1006900 || (width === 8 && view.getInt32(number[1] + 4, true) !== -1)) continue;
      const name = parameterText(view, number[1] + width, 256);
      if (!name) continue;
      const pair: [string, string] = [number[0], name[0]];
      const held = evidence.names.get(id);
      if (held === undefined) evidence.names.set(id, pair);
      else if (held === null || held[0] !== pair[0] || held[1] !== pair[1]) evidence.names.set(id, null);
      break;
    }
  }
}

const area = (ring: Point[]) => ring.reduce((sum, a, i) => { const b = ring[(i + 1) % ring.length]; return sum + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < Math.min(a[0], b[0]) || Math.max(a[1], b[1]) < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) < Math.min(a[1], b[1])) return false;
  return cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0;
}
function inside(p: Point, ring: Point[]): boolean {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}
/** All floor-reaching edges must form simple disjoint cycles; no gap closing. */
export function nativeRoomOutline(edges: Edge[], bounds: Bounds3, location: Location): NativeRoomOutline | undefined {
  const vertices: Point[] = [], links: number[][] = [], seen = new Set<string>();
  const vertex = (p: Point) => { let i = vertices.findIndex(q => Math.abs(q[0] - p[0]) <= JOIN_EPS && Math.abs(q[1] - p[1]) <= JOIN_EPS); if (i < 0) { i = vertices.length; vertices.push(p); links.push([]); } return i; };
  for (const edge of edges) {
    if (!Number.isFinite(edge.bottom) || Math.abs(edge.bottom - bounds.min.z) > BOX_EPS || ![...edge.a, ...edge.b].every(Number.isFinite)) continue;
    const a = vertex(edge.a), b = vertex(edge.b);
    if (a === b) return;
    const key = [Math.min(a, b), Math.max(a, b)].join(':');
    if (seen.has(key)) continue;
    seen.add(key); links[a].push(b); links[b].push(a);
  }
  if (vertices.length < 3 || links.some(list => list.length !== 2)) return;
  const visited = new Set<number>(), rings: Point[][] = [];
  for (let start = 0; start < vertices.length; start++) {
    if (visited.has(start)) continue;
    const ring: Point[] = []; let current = start, previous = -1;
    do {
      if (visited.has(current)) return;
      visited.add(current); ring.push(vertices[current]);
      const next = links[current].find(v => v !== previous)!;
      previous = current; current = next;
    } while (current !== start);
    if (ring.length < 3 || Math.abs(area(ring)) < 1e-8) return;
    rings.push(ring);
  }
  // Reject self intersections and contacts between cycles, including shafts.
  const segments = rings.flatMap((ring, r) => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length], r, i, n: ring.length })));
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const a = segments[i], b = segments[j];
    if (a.r === b.r && (Math.abs(a.i - b.i) === 1 || Math.abs(a.i - b.i) === a.n - 1)) continue;
    if (intersects(a.a, a.b, b.a, b.b)) return;
  }
  rings.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
  const [outer, ...holes] = rings;
  if (holes.some(h => !inside(h[0], outer)) || holes.some((h, i) => holes.some((q, j) => i !== j && inside(h[0], q)))) return;
  const xs = outer.map(p => p[0]), ys = outer.map(p => p[1]);
  if ([Math.min(...xs) - bounds.min.x, Math.max(...xs) - bounds.max.x, Math.min(...ys) - bounds.min.y, Math.max(...ys) - bounds.max.y].some(d => Math.abs(d) > BOX_EPS)) return;
  // Canonical winding and start let duplicate partition records agree even
  // when face traversal order differs.
  const canonical = (ring: Point[], positive: boolean) => {
    const points = (area(ring) > 0) === positive ? [...ring] : [...ring].reverse();
    let first = 0;
    for (let i = 1; i < points.length; i++) if (points[i][0] < points[first][0] || (points[i][0] === points[first][0] && points[i][1] < points[first][1])) first = i;
    return points.slice(first).concat(points.slice(0, first));
  };
  return { source: 'partition-room-solid-faces', units: 'feet', outer: canonical(outer, true), holes: holes.map(h => canonical(h, false)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), elevationFeet: bounds.min.z, areaSquareFeet: Math.abs(area(outer)) - holes.reduce((s, h) => s + Math.abs(area(h)), 0), location };
}

export function resolveNativeRooms(input: {
  revitVersion: number | null; headers: ReadonlyMap<number, ElementHeader>;
  bounds: readonly ElementBoundsRecord[]; parameters: ReadonlyMap<number, ReadonlyMap<number, ElementParameter>>;
  levels: readonly NativeAssociatedLevelRelation[]; evidence: NativeRoomEvidence;
}): { nativeRooms: NativeRoom[]; nativeRoomCoverage: NativeRoomCoverage } {
  const { revitVersion, headers, evidence } = input;
  const outlineSupported = (ROOM_OUTLINE_RELEASES as readonly number[]).includes(revitVersion ?? 0);
  const bounds = new Map(input.bounds.map(b => [b.elementId, b]));
  const levels = new Map(input.levels.map(l => [l.elementId, l.levelId]));
  const nativeRooms: NativeRoom[] = [];
  for (const header of headers.values()) {
    if (header.categoryId !== NATIVE_ROOM_CATEGORY || header.familyId != null || header.ownerViewId != null || header.unplacedOwnerId != null) continue;
    const nativeRecord = evidence.records.get(header.elementId);
    const record = nativeRecord?.boundsFeet ? { boundsFeet: nativeRecord.boundsFeet, stream: nativeRecord.location.stream } : nativeRecord ? undefined : bounds.get(header.elementId), params = input.parameters.get(header.elementId);
    const text = (id: number) => { const value = params?.get(id)?.value; return typeof value === 'string' && value.length ? value : undefined; };
    const pair = evidence.names.get(header.elementId);
    const room: NativeRoom = { elementId: header.elementId, source: 'Partitions/ElementHeader.m_categoryId', categoryId: NATIVE_ROOM_CATEGORY,
      location: nativeRecord?.location, nameSource: pair ? 'partition-room-parameter-entries' : text(-1006900) || text(-1006901) ? 'element-parameter-table' : undefined,
      name: pair?.[1] ?? text(-1006900), number: pair?.[0] ?? text(-1006901), floorFinish: text(-1006903),
      levelId: levels.get(header.elementId), boundsFeet: record?.boundsFeet,
      outlineStatus: !outlineSupported ? 'unsupported-release' : !record ? 'missing-record-bounds' : 'unresolved', enclosure: 'unreviewed-source' };
    const unsupportedSurface = record && evidence.unsupportedSolidStreams.get(header.elementId)?.has(record.stream);
    if (unsupportedSurface) room.outlineIssue = 'unsupported-curved-face';
    if (outlineSupported && record && !unsupportedSurface) {
      const candidates = (evidence.solids.get(header.elementId) ?? []).filter(s => s.location.stream === record.stream).map(s => nativeRoomOutline(s.edges, record.boundsFeet, s.location)).filter((p): p is NativeRoomOutline => p != null);
      const signature = (p: NativeRoomOutline) => JSON.stringify([p.outer, p.holes]);
      if (candidates.length && candidates.every(p => signature(p) === signature(candidates[0]))) { room.outline = candidates[0]; room.outlineStatus = 'decoded'; }
    }
    nativeRooms.push(room);
  }
  nativeRooms.sort((a, b) => a.elementId - b.elementId);
  return { nativeRooms, nativeRoomCoverage: { revitVersion, semanticRooms: nativeRooms.length, boxlessRooms: nativeRooms.filter(r => !r.boundsFeet).length, namedRooms: nativeRooms.filter(r => r.name || r.number).length, outlines: nativeRooms.filter(r => r.outline).length, outlineSupported, evidenceLimitReached: evidence.limitReached } };
}
