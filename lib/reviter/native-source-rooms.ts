/**
 * Native room identity and stored-solid evidence, kept separate from reviewed
 * indoor/routing areas. An authored room solid is not an enclosure certificate.
 *
 * Adapted from rvt-rs partition_room_boundaries.rs and
 * partition_room_parameters.rs, helenkwok/rvt-rs commit 1c3d337.
 * Copyright 2026 Griffin Long. Licensed under Apache-2.0; see
 * docs/third-party/rvt-rs/LICENSE and NOTICE. TypeScript adaptation adds bounded
 * collection, strict loop topology, deterministic rings and explicit evidence
 * status; the measured byte offsets and release gates remain upstream's.
 */
import type { ElementHeader } from "./element-headers.ts";
import type { Bounds3, ElementBoundsRecord } from "./types.ts";
import { activeClassTagTranslation, fileClassTag } from "./revit-class-tags.ts";
import { REVIT_2027_CLASS_NAMES, REVIT_2027_FIRST_CLASS_INDEX } from "./revit-2027-class-names.data.ts";
import { hypot } from "./deterministic-math.ts";

export const NATIVE_ROOM_CATEGORY_ID = -2_000_160;
export const NATIVE_ROOM_SOLID_RELEASES = [2023, 2024, 2025] as const;
export const NATIVE_ROOM_PARAMETER_ENTRY_RELEASES = [2023, 2024, 2025] as const;
export const NATIVE_ROOM_PARAMETER_BLOCK_RELEASES = [2024] as const;
export const NATIVE_ROOM_VERTEX_TOLERANCE_FEET = 1e-4;
export const NATIVE_ROOM_BOX_TOLERANCE_FEET = 1e-3;

const SOLID_TAG = [0x04, 0x90, 0x08, 0x00];
const FACE_TAG = [0x04, 0x00, 0x08, 0x00];
const FACE_BYTES = 158;
const FACE_GAP = 0x200;
const SOLID_WINDOW = 0x1_0000;
const PARAMETER_WINDOW = 0x400;
const MAX_FACES_PER_SOLID = 2048;
const MAX_CANDIDATES = 50_000;
const MAX_TOTAL_FACES = 200_000;
const ROOM_NUMBER = -1_006_901;
const ROOM_NAME = -1_006_900;

export type NativeRoomPoint = [number, number];
export type NativeRoomPageSource = { stream: string; chunkIndex: number; rawOffset: number; complete?: boolean };
export type NativeRoomEvidenceSource = Omit<NativeRoomPageSource, "complete"> & { offset: number };
export type NativeRoomPiece = {
  outerFeet: NativeRoomPoint[];
  holesFeet: NativeRoomPoint[][];
};
export type NativeRoomOutline = NativeRoomPiece & {
  additionalPieces: NativeRoomPiece[];
  elevationFeet: number;
  areaSquareFeet: number;
  source: "partition_room_solid_faces";
  evidence: NativeRoomEvidenceSource;
};
export type NativeSourceRoom = {
  elementId: number;
  source: "element-header";
  categoryId: typeof NATIVE_ROOM_CATEGORY_ID;
  /** Stable within this source model; duplicate numbers do not collapse rooms. */
  key: string;
  designOptionId: number | null;
  /** No bounds is valid identity evidence and does not imply a zero-size box. */
  boundsFeet?: Bounds3;
  boundsSource?: "partition_room_record" | "element-bounds";
  record?: NativeRoomEvidenceSource;
  number?: string;
  name?: string;
  parameterSource?: "partition_room_parameter_entries" | "partition_room_parameter_block";
  parameterEvidence?: NativeRoomEvidenceSource;
  /** Only supplied when the persisted slot names a known native Level. */
  levelId?: number;
  outline?: NativeRoomOutline;
  outlineStatus: "unsupported-release" | "no-record-bounds" | "not-recovered" | "conflicting-solids" | "recovered";
  /** This metadata must never directly admit an indoor area or navigation edge. */
  certifiedForRouting: false;
};
export type NativeRoomFace = {
  uv: [number, number, number, number];
  origin: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
};
type SolidCandidate = { elementId: number; faces: NativeRoomFace[]; evidence: NativeRoomEvidenceSource };
type RoomRecordCandidate = { elementId: number; boundsFeet: Bounds3; evidence: NativeRoomEvidenceSource };
type ParameterCandidate = {
  elementId: number; number: string; name: string;
  levelSlot?: number; source: NonNullable<NativeSourceRoom["parameterSource"]>;
  evidence: NativeRoomEvidenceSource;
};

function viewOf(data: Uint8Array) { return new DataView(data.buffer, data.byteOffset, data.byteLength); }
function matches(data: Uint8Array, at: number, tag: readonly number[]) {
  return at >= 0 && at + tag.length <= data.length && tag.every((byte, index) => data[at + index] === byte);
}
function validId(view: DataView, at: number, width = 8): number | undefined {
  if (at < 0 || at + width > view.byteLength) return undefined;
  if (width === 8 && view.getUint32(at + 4, true) !== 0) return undefined;
  const id = view.getUint32(at, true);
  return id > 0 && id <= 0x7fff_ffff ? id : undefined;
}
function floats(view: DataView, at: number, count: number): number[] | undefined {
  if (at < 0 || at + 8 * count > view.byteLength) return undefined;
  const values = Array.from({ length: count }, (_, index) => view.getFloat64(at + 8 * index, true));
  return values.every(Number.isFinite) ? values : undefined;
}
/** A complete, finite face carrying the measured planar record signature. */
export function readNativeRoomFace(data: Uint8Array, at: number): NativeRoomFace | undefined {
  if (at < 0 || at + FACE_BYTES > data.length || !matches(data, at, FACE_TAG) || data[at + 85] !== 1) return undefined;
  const view = viewOf(data);
  const uv = floats(view, at + 20, 4) as NativeRoomFace["uv"] | undefined;
  const origin = floats(view, at + 86, 3) as NativeRoomFace["origin"] | undefined;
  const u = floats(view, at + 110, 3) as NativeRoomFace["u"] | undefined;
  const v = floats(view, at + 134, 3) as NativeRoomFace["v"] | undefined;
  const unit = (d: readonly number[]) => Math.abs(d.reduce((sum, value) => sum + value * value, 0) - 1) < 1e-6;
  if (!uv || !origin || !u || !v || !unit(u) || !unit(v) || uv[0] > uv[2] || uv[1] > uv[3]) return undefined;
  return { uv, origin, u, v };
}
function faceEdge(face: NativeRoomFace): { a: NativeRoomPoint; b: NativeRoomPoint; bottom: number } | undefined {
  const vertical = (d: readonly number[]) => Math.abs(Math.abs(d[2]!) - 1) < 1e-9;
  const horizontal = (d: readonly number[]) => Math.abs(d[2]!) < 1e-9;
  let h: readonly number[], lo: number, hi: number, up: number, z0: number, z1: number;
  if (vertical(face.u) && horizontal(face.v)) {
    h = face.v; lo = face.uv[1]; hi = face.uv[3]; up = face.u[2]; z0 = face.uv[0]; z1 = face.uv[2];
  } else if (vertical(face.v) && horizontal(face.u)) {
    h = face.u; lo = face.uv[0]; hi = face.uv[2]; up = face.v[2]; z0 = face.uv[1]; z1 = face.uv[3];
  } else return undefined;
  return {
    a: [face.origin[0] + h[0]! * lo, face.origin[1] + h[1]! * lo],
    b: [face.origin[0] + h[0]! * hi, face.origin[1] + h[1]! * hi],
    bottom: Math.min(face.origin[2] + up * z0, face.origin[2] + up * z1),
  };
}
function signedArea(ring: readonly NativeRoomPoint[]): number {
  return ring.reduce((sum, p, index) => {
    const q = ring[(index + 1) % ring.length]!;
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2;
}
function cross(a: NativeRoomPoint, b: NativeRoomPoint, c: NativeRoomPoint) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function segmentsMeet(a: NativeRoomPoint, b: NativeRoomPoint, c: NativeRoomPoint, d: NativeRoomPoint) {
  const eps = 1e-9;
  if (Math.max(a[0], b[0]) + eps < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) + eps < Math.min(a[0], b[0]) ||
      Math.max(a[1], b[1]) + eps < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) + eps < Math.min(a[1], b[1])) return false;
  const first = cross(a, b, c), second = cross(a, b, d), third = cross(c, d, a), fourth = cross(c, d, b);
  return ((first <= eps && second >= -eps) || (second <= eps && first >= -eps)) &&
    ((third <= eps && fourth >= -eps) || (fourth <= eps && third >= -eps));
}
function inside(ring: readonly NativeRoomPoint[], point: NativeRoomPoint) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < a[0] + (point[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) result = !result;
  }
  return result;
}
function canonicalRing(ring: NativeRoomPoint[], positive: boolean) {
  let simplified = ring.filter((p, i) => {
    const a = ring[(i + ring.length - 1) % ring.length]!, b = ring[(i + 1) % ring.length]!;
    const scale = hypot(p[0] - a[0], p[1] - a[1]) * hypot(b[0] - p[0], b[1] - p[1]);
    return scale === 0 || Math.abs(cross(a, p, b)) / scale >= 1e-9;
  });
  if ((signedArea(simplified) > 0) !== positive) simplified = simplified.reverse();
  let first = 0;
  for (let i = 1; i < simplified.length; i++) {
    if (simplified[i]![0] < simplified[first]![0] || (simplified[i]![0] === simplified[first]![0] && simplified[i]![1] < simplified[first]![1])) first = i;
  }
  return [...simplified.slice(first), ...simplified.slice(0, first)];
}

/** Complete degree-two loops only; crossings/touching loops reject the solid. */
function piecesFromEdges(edges: { a: NativeRoomPoint; b: NativeRoomPoint }[]): NativeRoomPiece[] | undefined {
  const vertices: NativeRoomPoint[] = [], adjacency: number[][] = [], unique = new Set<string>();
  const buckets = new Map<string, number[]>();
  const tolerance = NATIVE_ROOM_VERTEX_TOLERANCE_FEET;
  const vertex = (p: NativeRoomPoint) => {
    const x = Math.floor(p[0] / tolerance), y = Math.floor(p[1] / tolerance);
    let first: number | undefined;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const id of buckets.get(`${x + dx},${y + dy}`) ?? []) {
        const held = vertices[id]!;
        if (Math.abs(p[0] - held[0]) <= tolerance && Math.abs(p[1] - held[1]) <= tolerance && (first == null || id < first)) first = id;
      }
    }
    if (first != null) return first;
    const id = vertices.length;
    vertices.push(p); adjacency.push([]);
    const key = `${x},${y}`, existing = buckets.get(key) ?? [];
    existing.push(id); buckets.set(key, existing);
    return id;
  };
  const pairs: [number, number][] = [];
  for (const edge of edges) {
    if (![...edge.a, ...edge.b].every(Number.isFinite)) return undefined;
    const a = vertex(edge.a), b = vertex(edge.b);
    if (a === b) return undefined;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (unique.has(key)) continue; // coincident solid faces describe one edge
    unique.add(key); adjacency[a]!.push(b); adjacency[b]!.push(a); pairs.push([a, b]);
  }
  if (vertices.length < 3 || adjacency.some((neighbours) => neighbours.length !== 2)) return undefined;
  // Degree-two bow ties and touching independent loops are not valid profiles.
  for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
    const [a, b] = pairs[i]!, [c, d] = pairs[j]!;
    if (a === c || a === d || b === c || b === d) continue;
    if (segmentsMeet(vertices[a]!, vertices[b]!, vertices[c]!, vertices[d]!)) return undefined;
  }
  const visited = new Set<number>(), rings: NativeRoomPoint[][] = [];
  for (let start = 0; start < vertices.length; start++) {
    if (visited.has(start)) continue;
    const ring: NativeRoomPoint[] = [];
    let current = start, previous = -1;
    do {
      if (visited.has(current)) return undefined;
      visited.add(current); ring.push(vertices[current]!);
      const next = adjacency[current]!.find((id) => id !== previous)!;
      previous = current; current = next;
    } while (current !== start);
    if (ring.length < 3 || Math.abs(signedArea(ring)) <= 1e-8) return undefined;
    rings.push(ring);
  }
  rings.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  const depths = rings.map((ring, i) => rings.slice(0, i).filter((outer) => inside(outer, ring[0]!)).length);
  const pieces: NativeRoomPiece[] = [];
  const owners = new Map<number, NativeRoomPiece>();
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i]!;
    if (depths[i]! % 2 === 0) {
      const piece = { outerFeet: canonicalRing(ring, true), holesFeet: [] as NativeRoomPoint[][] };
      pieces.push(piece); owners.set(i, piece);
    } else {
      // The nearest containing outer at depth one less owns this hole.
      let owner: NativeRoomPiece | undefined;
      for (let j = i - 1; j >= 0; j--) if (depths[j] === depths[i]! - 1 && inside(rings[j]!, ring[0]!)) { owner = owners.get(j); break; }
      if (!owner) return undefined;
      owner.holesFeet.push(canonicalRing(ring, false));
    }
  }
  const ringOrder = (a: NativeRoomPoint[], b: NativeRoomPoint[]) => {
    const area = Math.abs(signedArea(b)) - Math.abs(signedArea(a));
    if (area !== 0) return area;
    const first = JSON.stringify(a), second = JSON.stringify(b);
    return first < second ? -1 : first > second ? 1 : 0;
  };
  for (const piece of pieces) piece.holesFeet.sort(ringOrder);
  pieces.sort((a, b) => ringOrder(a.outerFeet, b.outerFeet));
  return pieces.every((piece) => piece.outerFeet.length >= 3 && piece.holesFeet.every((hole) => hole.length >= 3)) ? pieces : undefined;
}

/** Stored faces reaching the record floor, with exact record extent agreement. */
export function nativeRoomOutlineFromFaces(faces: readonly NativeRoomFace[], bounds: Bounds3): Omit<NativeRoomOutline, "source" | "evidence"> | undefined {
  const values = [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z];
  if (faces.length > MAX_FACES_PER_SOLID || !values.every(Number.isFinite) || values.slice(0, 3).some((value, axis) => value > values[axis + 3]!)) return undefined;
  const edges = faces.map(faceEdge).filter((edge) => edge != null && Math.abs(edge.bottom - bounds.min.z) <= NATIVE_ROOM_BOX_TOLERANCE_FEET);
  const pieces = piecesFromEdges(edges as { a: NativeRoomPoint; b: NativeRoomPoint }[]);
  if (!pieces?.length) return undefined;
  const points = pieces.flatMap((piece) => piece.outerFeet);
  const extent = [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1])), Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))];
  const wanted = [bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y];
  if (!extent.every((value, axis) => Math.abs(value - wanted[axis]!) <= NATIVE_ROOM_BOX_TOLERANCE_FEET)) return undefined;
  const areaSquareFeet = pieces.reduce((sum, piece) => sum + signedArea(piece.outerFeet) + piece.holesFeet.reduce((holes, ring) => holes + signedArea(ring), 0), 0);
  if (!(areaSquareFeet > 0)) return undefined;
  return { ...pieces[0]!, additionalPieces: pieces.slice(1), elevationFeet: bounds.min.z, areaSquareFeet };
}

function stringAt(data: Uint8Array, at: number, limit: number): { value: string; end: number } | undefined {
  if (at < 0 || at + 4 > data.length) return undefined;
  const view = viewOf(data), count = view.getUint32(at, true), end = at + 4 + 2 * count;
  if (count < 1 || count > limit || end > data.length) return undefined;
  let value: string;
  try { value = new TextDecoder("utf-16le", { fatal: true, ignoreBOM: true }).decode(data.subarray(at + 4, end)); }
  catch { return undefined; }
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(value)) return undefined;
  return { value, end };
}
function signedTag(value: number, width: number) {
  const bytes = new Uint8Array(width), view = viewOf(bytes);
  if (width === 8) view.setBigInt64(0, BigInt(value), true); else view.setInt32(0, value, true);
  return bytes;
}

export type NativeRoomResolveInput = {
  elementHeaders: ReadonlyMap<number, ElementHeader>;
  elementBounds: readonly ElementBoundsRecord[];
  declaredElementIds?: ReadonlySet<number>;
  levelIds?: ReadonlySet<number>;
};
export type NativeRoomCollector = {
  consumePage(data: Uint8Array, source: NativeRoomPageSource): void;
  resolve(input: NativeRoomResolveInput): NativeSourceRoom[];
  /** Limits omit detailed evidence; header room identities remain available. */
  diagnostics(): { truncated: boolean; solidCandidates: number; parameterCandidates: number; storedFaces: number };
};

/** One-pass bounded semantic collector; owns no source bytes after each call. */
export function createNativeRoomCollector(revitVersion: number | null | undefined): NativeRoomCollector {
  const solids: SolidCandidate[] = [], parameters: ParameterCandidate[] = [];
  const roomRecords = new Map<number, RoomRecordCandidate>();
  const solidIndex = new Map<string, number>(), parameterLocations = new Set<string>();
  const solidRelease = NATIVE_ROOM_SOLID_RELEASES.some((version) => version === revitVersion);
  const entryRelease = NATIVE_ROOM_PARAMETER_ENTRY_RELEASES.some((version) => version === revitVersion);
  const width = revitVersion === 2023 ? 4 : 8;
  const numberTag = signedTag(ROOM_NUMBER, width), nameTag = signedTag(ROOM_NAME, width);
  const roomCategoryTag = signedTag(NATIVE_ROOM_CATEGORY_ID, 8);
  let storedFaces = 0, truncated = false;
  // Upstream reads joined partitions. A bounded overlap lets records/face runs
  // crossing one page boundary complete without retaining an entire partition.
  // Larger unsupported spans remain identity-only rather than partially guessed.
  let tail = new Uint8Array(0), previous: NativeRoomPageSource | undefined;
  type Span = { start: number; end: number; offset: number; source: NativeRoomPageSource };
  let tailSpans: Span[] = [];
  const locationKey = (location: NativeRoomEvidenceSource) => `${location.stream}\u0000${location.chunkIndex}:${location.rawOffset}:${location.offset}`;
  const addParameter = (value: ParameterCandidate) => {
    const key = `${locationKey(value.evidence)}:${value.source}`;
    if (parameterLocations.has(key)) return;
    if (parameters.length >= MAX_CANDIDATES) { truncated = true; return; }
    parameterLocations.add(key); parameters.push(value);
  };
  const roomId = (header: ElementHeader, declared: NativeRoomResolveInput["declaredElementIds"]) =>
    header.categoryId === NATIVE_ROOM_CATEGORY_ID && header.familyId == null && header.ownerViewId == null && header.unplacedOwnerId == null && (!declared || declared.has(header.elementId));
  return {
    consumePage(data, source) {
      if (!solidRelease && !entryRelease) return;
      if (previous?.stream !== source.stream || previous.chunkIndex + 1 !== source.chunkIndex || previous.complete === false || source.complete === false) { tail = new Uint8Array(0); tailSpans = []; }
      const incomingLength = data.length, overlapLength = tail.length;
      const spans = [...tailSpans, { start: overlapLength, end: overlapLength + incomingLength, offset: 0, source }];
      if (overlapLength) { const joined = new Uint8Array(overlapLength + incomingLength); joined.set(tail); joined.set(data, overlapLength); data = joined; }
      const view = viewOf(data), evidence = (offset: number) => {
        const span = spans.find((item) => offset >= item.start && offset < item.end);
        const location = span?.source ?? source;
        return { stream: location.stream, chunkIndex: location.chunkIndex, rawOffset: location.rawOffset, offset: span ? span.offset + offset - span.start : offset };
      };
      if (solidRelease) {
        // Room records carry their own Outline even where the scene's generic
        // GElement bounds decoder has nothing to read. RE-29/RE-81 prologues.
        const classOrdinal = (name: string) => REVIT_2027_FIRST_CLASS_INDEX + REVIT_2027_CLASS_NAMES.indexOf(name);
        const translation = activeClassTagTranslation();
        const measured = revitVersion === 2024 ? [0x46, 0x01, 255, 255, 255, 255, 0xab, 0x05] : revitVersion === 2025 ? [0x59, 0x01, 255, 255, 255, 255, 0xd3, 0x05] : undefined;
        const outlineClass = fileClassTag(classOrdinal("Outline")), parentsClass = fileClassTag(classOrdinal("ElementParents"));
        const schemaMarker = [outlineClass & 255, outlineClass >> 8, 255, 255, 255, 255, parentsClass & 255, parentsClass >> 8];
        const marker = revitVersion === 2023 ? (translation && outlineClass > 0 && parentsClass > 0 ? schemaMarker : undefined) : measured && (!translation || measured.every((byte, index) => byte === schemaMarker[index])) ? measured : undefined;
        const headerClass = fileClassTag(classOrdinal("ElementHeader"));
        const ownersByCategory = new Map<number, { elementId: number; start: number }>();
        if (revitVersion !== 2023) for (let tagAt = data.indexOf(headerClass & 255, 12); tagAt >= 12 && tagAt + 6 <= data.length; tagAt = data.indexOf(headerClass & 255, tagAt + 1)) {
          if (data[tagAt + 1] !== headerClass >> 8) continue;
          const elementId = validId(view, tagAt - 12), historyCount = view.getUint32(tagAt + 2, true);
          if (!elementId || historyCount > 4096) continue;
          const categoryAt = tagAt + 6 + historyCount * 22;
          if (matches(data, categoryAt, [...roomCategoryTag])) ownersByCategory.set(categoryAt, { elementId, start: tagAt - 12 });
        }
        if (marker) for (let categoryAt = data.indexOf(roomCategoryTag[0]!); categoryAt >= 0; categoryAt = data.indexOf(roomCategoryTag[0]!, categoryAt + 1)) {
          if (!matches(data, categoryAt, [...roomCategoryTag])) continue;
          const narrow = revitVersion === 2023;
          const prologueStart = categoryAt - (narrow ? 14 : 0x12), markerAt = categoryAt + (narrow ? 38 : 62);
          // A non-empty regen history moves the owner before the fixed tail
          // offsets. Its counted, class-confirmed header gives the exact join.
          const owner = narrow ? undefined : ownersByCategory.get(categoryAt);
          const start = owner?.start ?? prologueStart;
          const elementId = owner?.elementId ?? validId(view, start, narrow ? 4 : 8);
          if (!elementId || roomRecords.has(elementId) || markerAt + 56 > data.length || !matches(data, markerAt, marker)) continue;
          if (narrow && (start + 10 > data.length || view.getUint16(start + 8, true) !== headerClass)) continue;
          if (!narrow && (view.getUint16(prologueStart + 0x10, true) !== 0 || view.getUint32(prologueStart + 0x4c, true) !== 0xffff_ffff)) continue;
          const base = markerAt - 0x50;
          if (base + 0x32 < 0 || view.getBigUint64(base + 0x32, true) !== 0xffff_ffff_ffff_ffffn || view.getUint32(base + 0x42, true) !== 0xffff_ef7f) continue;
          const values = floats(view, markerAt + 8, 6);
          if (!values || values.some((value) => Math.abs(value) > 50_000) || values.slice(0, 3).some((value, axis) => value > values[axis + 3]!)) continue;
          if (roomRecords.size >= MAX_CANDIDATES) { truncated = true; continue; }
          roomRecords.set(elementId, { elementId, boundsFeet: { min: { x: values[0]!, y: values[1]!, z: values[2]! }, max: { x: values[3]!, y: values[4]!, z: values[5]! } }, evidence: evidence(start) });
        }
      }
      if (solidRelease) {
        for (let tag = data.indexOf(SOLID_TAG[0]!); tag >= 0; tag = data.indexOf(SOLID_TAG[0]!, tag + 1)) {
          if (!matches(data, tag, SOLID_TAG)) continue;
          const header = matches(data, tag - 4, [255, 255, 255, 255]) ? tag - 12 : tag - 8;
          const elementId = validId(view, header);
          if (!elementId) continue;
          const location = evidence(header), heldIndex = solidIndex.get(locationKey(location));
          if (heldIndex == null && (solids.length >= MAX_CANDIDATES || storedFaces >= MAX_TOTAL_FACES)) { truncated = true; continue; }
          const start = tag + 4, end = Math.min(data.length, start + SOLID_WINDOW);
          let faceAt = -1;
          for (let at = data.indexOf(FACE_TAG[0]!, start); at >= start && at < end; at = data.indexOf(FACE_TAG[0]!, at + 1)) {
            if (matches(data, at, SOLID_TAG)) break; // another stored solid is not this room's face list
            if (readNativeRoomFace(data, at)) { faceAt = at; break; }
          }
          const faces: NativeRoomFace[] = [];
          while (faceAt >= 0) {
            const face = readNativeRoomFace(data, faceAt);
            if (!face) break;
            if (faces.length >= MAX_FACES_PER_SOLID || storedFaces + faces.length >= MAX_TOTAL_FACES) { truncated = true; faces.length = 0; break; }
            faces.push(face);
            const nextEnd = Math.min(data.length, faceAt + FACE_GAP);
            let next = -1;
            for (let at = data.indexOf(FACE_TAG[0]!, faceAt + 4); at >= 0 && at < nextEnd; at = data.indexOf(FACE_TAG[0]!, at + 1)) {
              if (matches(data, at, SOLID_TAG)) break;
              if (readNativeRoomFace(data, at)) { next = at; break; }
            }
            faceAt = next;
          }
          if (faces.length) {
            if (heldIndex == null) {
              solidIndex.set(locationKey(location), solids.length); solids.push({ elementId, faces, evidence: location }); storedFaces += faces.length;
            } else if (faces.length > solids[heldIndex]!.faces.length) {
              storedFaces += faces.length - solids[heldIndex]!.faces.length;
              solids[heldIndex] = { elementId, faces, evidence: location };
            }
          }
        }
      }
      if (entryRelease) {
        // Exactly upstream RE-117: object marker, known-width id, first adjacent
        // Number/Name pair within 0x400. Category/declared identity join is deferred.
        for (let marker = data.indexOf(1); marker >= 0; marker = data.indexOf(1, marker + 1)) {
          if (!matches(data, marker, [1, 0, 0, 0])) continue;
          const elementId = validId(view, marker + 4, width);
          if (!elementId) continue;
          const start = marker + 4 + width, end = Math.min(data.length, start + PARAMETER_WINDOW);
          for (let at = data.indexOf(numberTag[0]!, start); at >= start && at + width < end; at = data.indexOf(numberTag[0]!, at + 1)) {
            if (!matches(data, at, [...numberTag])) continue;
            const number = stringAt(data, at + width, 64);
            if (!number || !matches(data, number.end, [...nameTag])) continue;
            const name = stringAt(data, number.end + width, 256);
            if (!name || name.end > end) continue;
            addParameter({ elementId, number: number.value, name: name.value, source: "partition_room_parameter_entries", evidence: evidence(marker) });
            break;
          }
        }
      }
      if (revitVersion === 2024) {
        // RE-29 block: owner id, same id at +0x3c, level slot +0x44,
        // Number length +505, then Name length eight bytes after the Number.
        for (let owner = 0; owner + 513 <= data.length; owner++) {
          const elementId = validId(view, owner);
          if (!elementId || validId(view, owner + 0x3c) !== elementId) continue;
          const number = stringAt(data, owner + 505, 64);
          if (!number) continue;
          const name = stringAt(data, number.end + 8, 64);
          if (!name) continue;
          addParameter({ elementId, number: number.value, name: name.value, levelSlot: validId(view, owner + 0x44), source: "partition_room_parameter_block", evidence: evidence(owner) });
        }
      }
      const cut = Math.max(0, data.length - SOLID_WINDOW);
      tail = data.slice(cut);
      tailSpans = spans.filter((span) => span.end > cut).map((span) => {
        const start = Math.max(cut, span.start);
        return { ...span, start: start - cut, end: span.end - cut, offset: span.offset + start - span.start };
      });
      previous = source;
      if (source.complete === false) { tail = new Uint8Array(0); tailSpans = []; }
    },
    resolve(input) {
      const byBounds = new Map(input.elementBounds.map((record) => [record.elementId, record]));
      const bySolid = new Map<number, SolidCandidate[]>(), byParameters = new Map<number, ParameterCandidate[]>();
      for (const solid of solids) { const held = bySolid.get(solid.elementId) ?? []; held.push(solid); bySolid.set(solid.elementId, held); }
      for (const parameter of parameters) { const held = byParameters.get(parameter.elementId) ?? []; held.push(parameter); byParameters.set(parameter.elementId, held); }
      const rooms: NativeSourceRoom[] = [];
      for (const [elementId, header] of input.elementHeaders) {
        if (!roomId(header, input.declaredElementIds)) continue;
        const sourceRecord = input.declaredElementIds?.has(elementId) ? roomRecords.get(elementId) : undefined;
        const genericRecord = byBounds.get(elementId);
        const record = sourceRecord ? { ...sourceRecord.evidence, recordOffset: sourceRecord.evidence.offset, boundsFeet: sourceRecord.boundsFeet } : genericRecord;
        const room: NativeSourceRoom = {
          elementId, source: "element-header", categoryId: NATIVE_ROOM_CATEGORY_ID,
          key: `native-room-${elementId}`, designOptionId: header.designOptionId,
          certifiedForRouting: false,
          outlineStatus: !solidRelease ? "unsupported-release" : !record ? "no-record-bounds" : "not-recovered",
        };
        if (record) { room.boundsFeet = record.boundsFeet; room.boundsSource = sourceRecord ? "partition_room_record" : "element-bounds"; room.record = { stream: record.stream, chunkIndex: record.chunkIndex, rawOffset: record.rawOffset, offset: record.recordOffset }; }
        const candidates = byParameters.get(elementId) ?? [];
        const agreed = (values: ParameterCandidate[]) => values.length > 0 && values.every((value) => value.number === values[0]!.number && value.name === values[0]!.name);
        const entries = candidates.filter((value) => value.source === "partition_room_parameter_entries");
        const blocks = candidates.filter((value) => value.source === "partition_room_parameter_block");
        // A contradictory entry pair must not silently fall back to a weaker block.
        const chosen = entries.length ? (agreed(entries) ? entries[0] : undefined) : (agreed(blocks) ? blocks[0] : undefined);
        if (chosen) { room.number = chosen.number; room.name = chosen.name; room.parameterSource = chosen.source; room.parameterEvidence = chosen.evidence; }
        if (blocks.length && blocks[0]!.levelSlot != null && blocks.every((block) => block.levelSlot === blocks[0]!.levelSlot) && input.levelIds?.has(blocks[0]!.levelSlot!)) room.levelId = blocks[0]!.levelSlot;
        if (solidRelease && record) {
          let found: NativeRoomOutline | undefined, signature: string | undefined;
          for (const solid of bySolid.get(elementId) ?? []) {
            if (solid.evidence.stream !== record.stream) continue;
            const profile = nativeRoomOutlineFromFaces(solid.faces, record.boundsFeet);
            if (!profile) continue;
            const current = JSON.stringify(profile);
            if (signature != null && signature !== current) { found = undefined; room.outlineStatus = "conflicting-solids"; break; }
            signature = current;
            found = { ...profile, source: "partition_room_solid_faces", evidence: solid.evidence };
          }
          if (found) { room.outline = found; room.outlineStatus = "recovered"; }
        }
        rooms.push(room);
      }
      return rooms.sort((a, b) => a.elementId - b.elementId);
    },
    diagnostics: () => ({ truncated, solidCandidates: solids.length, parameterCandidates: parameters.length, storedFaces }),
  };
}
