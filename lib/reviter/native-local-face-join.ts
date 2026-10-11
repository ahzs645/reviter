import {
  nativeRationalOverlay,
  nativeRationalScalarToIEEE,
  rational,
  type NativeRationalOverlayInput,
  type NativeRationalParts,
  type Rational,
} from "./native-rational-overlay.ts";
import { nativeRationalPointInParts } from "./native-exact-planar-topology.ts";

/** Exact "does this small piece join a large face" decisions, computed in a
 * window around the piece instead of over the whole face.
 *
 * The question asked by door approaches and foreign portal terminals is
 * `union(face, piece)` being ONE part that contains a point. When the face is
 * already one part, that holds exactly when the piece merges with the face
 * where they meet and the point lies in the merged region. Both happen inside
 * the piece's box, so the same exact overlay restricted to the face pieces
 * near that box decides the same thing. The face is split once into exact
 * tiles (exact intersections with axis-aligned half planes; their union is the
 * face). Faces that are not one part, small faces and multi-part pieces keep
 * the plain global overlay. Generic: no venue data. */

type Box = { minX: Rational; maxX: Rational; minY: Rational; maxY: Rational };
type Window = { minX: number; maxX: number; minY: number; maxY: number };
type Tile = { box: Box; parts: NativeRationalOverlayInput };
export type NativeLocalFace = {
  face: NativeRationalParts;
  tiles: Tile[];
  accepted: Tile[];
};
export const NATIVE_LOCAL_FACE_MIN_VERTICES = 2000;
const LEAF_VERTICES = 400;
const MAX_DEPTH = 14;
// Window padding beyond the piece and point. Any positive pad keeps every
// contact strictly inside the window; one foot also covers IEEE rounding of
// the rational piece bounds by many orders of magnitude.
const PAD_FEET = 1;

const compare = (a: Rational, b: Rational): number => {
  const delta = a.n * b.d - b.n * a.d;
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
};
const vertices = (parts: NativeRationalOverlayInput) =>
  parts.reduce((s, part) => s + part.reduce((t, ring) => t + ring.length, 0), 0);
function bounds(parts: NativeRationalOverlayInput): Box | undefined {
  let box: Box | undefined;
  for (const part of parts)
    for (const point of part[0] ?? []) {
      const x = rational(point[0]),
        y = rational(point[1]);
      if (!box) box = { minX: x, maxX: x, minY: y, maxY: y };
      else {
        if (compare(x, box.minX) < 0) box.minX = x;
        if (compare(x, box.maxX) > 0) box.maxX = x;
        if (compare(y, box.minY) < 0) box.minY = y;
        if (compare(y, box.maxY) > 0) box.maxY = y;
      }
    }
  return box;
}
const ieee = (value: Rational) => nativeRationalScalarToIEEE(value) as number;
const meets = (box: Box, w: Window) =>
  !(
    compare(box.maxX, rational(w.minX)) < 0 ||
    compare(box.minX, rational(w.maxX)) > 0 ||
    compare(box.maxY, rational(w.minY)) < 0 ||
    compare(box.minY, rational(w.maxY)) > 0
  );
const rect = (w: Window): NativeRationalOverlayInput => [
  [
    [
      [w.minX, w.minY],
      [w.maxX, w.minY],
      [w.maxX, w.maxY],
      [w.minX, w.maxY],
    ],
  ],
];

function tile(parts: NativeRationalOverlayInput, w: Window, depth: number, leaf: number, out: Tile[]) {
  if (!parts.length) return;
  if (vertices(parts) <= leaf || depth >= MAX_DEPTH) {
    const box = bounds(parts);
    if (box) out.push({ box, parts });
    return;
  }
  const splitX = w.maxX - w.minX >= w.maxY - w.minY;
  const mid = splitX ? (w.minX + w.maxX) / 2 : (w.minY + w.maxY) / 2;
  for (const half of splitX
    ? [{ ...w, maxX: mid }, { ...w, minX: mid }]
    : [{ ...w, maxY: mid }, { ...w, minY: mid }])
    tile(nativeRationalOverlay("intersection", parts, rect(half)), half, depth + 1, leaf, out);
}

/** Tiles for a face large enough to profit; undefined keeps the global path. */
export function createNativeLocalFace(
  face: NativeRationalParts,
  minVertices = NATIVE_LOCAL_FACE_MIN_VERTICES,
  leafVertices = LEAF_VERTICES,
): NativeLocalFace | undefined {
  if (face.length !== 1 || vertices(face) < minVertices) return;
  const box = bounds(face);
  if (!box) return;
  const w = { minX: Math.floor(ieee(box.minX)) - 1, maxX: Math.ceil(ieee(box.maxX)) + 1, minY: Math.floor(ieee(box.minY)) - 1, maxY: Math.ceil(ieee(box.maxY)) + 1 };
  const tiles: Tile[] = [];
  tile(face, w, 0, leafVertices, tiles);
  return { face, tiles, accepted: [] };
}

function windowOf(piece: NativeRationalOverlayInput, point: readonly (number | Rational)[]): Window | undefined {
  const box = bounds(piece);
  if (!box) return;
  const x = ieee(rational(point[0]!)),
    y = ieee(rational(point[1]!));
  return {
    minX: Math.min(ieee(box.minX), x) - PAD_FEET,
    maxX: Math.max(ieee(box.maxX), x) + PAD_FEET,
    minY: Math.min(ieee(box.minY), y) - PAD_FEET,
    maxY: Math.max(ieee(box.maxY), y) + PAD_FEET,
  };
}

/** Exactly `union(face ∪ accepted, piece)` is one part containing `point`. */
export function nativeLocalFaceJoins(
  local: NativeLocalFace,
  piece: NativeRationalOverlayInput,
  point: readonly (number | Rational)[],
): boolean {
  const w = piece.length === 1 ? windowOf(piece, point) : undefined;
  if (!w) {
    const joined = nativeRationalOverlay("union", nativeLocalFaceParts(local), piece);
    return joined.length === 1 && nativeRationalPointInParts(point, joined);
  }
  const near = [...local.tiles, ...local.accepted].filter((t) => meets(t.box, w));
  // No face within the window: the piece cannot touch it, so the global
  // union keeps two parts.
  if (!near.length) return false;
  const base = nativeRationalOverlay("union", near.flatMap((t) => t.parts));
  const joined = nativeRationalOverlay("union", base, piece);
  return joined.length <= base.length && nativeRationalPointInParts(point, joined);
}

/** Record a piece that joined; later decisions see it, as a grown face would. */
export function acceptNativeLocalFacePiece(local: NativeLocalFace, piece: NativeRationalOverlayInput) {
  const box = bounds(piece);
  if (box) local.accepted.push({ box, parts: piece });
}

/** The face with every accepted piece, as one exact union. */
export function nativeLocalFaceParts(local: NativeLocalFace): NativeRationalParts {
  return local.accepted.length
    ? nativeRationalOverlay("union", local.face, ...local.accepted.map((t) => t.parts))
    : local.face;
}
