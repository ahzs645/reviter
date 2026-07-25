/**
 * Instanced family geometry — curtain panels, mullions, and other loadable
 * families.
 *
 * These elements are not written in world coordinates. Each instance stores a
 * rigid placement and a reference to a *shared geometry object* that holds the
 * shape once in a local frame, which is why searching for a panel's world
 * corners finds them only 20% of the time while a wall's are found 91% of the
 * time.
 *
 * Both kinds live inside the ordinary element-object framing and are told apart
 * by their length:
 *
 * ```text
 * instance object, objLen == 300
 *   S+48            6 x f64  world AABB in feet, written twice
 *   S+objLen-96     9 x f64  3x3 basis, row-major — the COLUMNS are the axes
 *   S+objLen-24     3 x f64  placement origin, world feet
 *   S+objLen        u64      element id of the shared geometry object
 *
 * shared geometry object, objLen != 300
 *   S+48            6 x f64  AABB in the instance's local frame
 * ```
 *
 * so `world = M · local + O`.
 *
 * The basis convention is not cosmetic. Reading the 3x3 as rows-are-axes scores
 * 0.36 where columns-are-axes scores 0.999; the two agree on the 90°-multiple
 * rotations that make up most of the model and diverge exactly on the 22.5°
 * faceted curtain walls, so a corpus of ordinary rooms would not have caught it.
 *
 * **Verification.** Reconstructing world corners from bytes alone and scoring
 * against the oriented-box corners derived from the paired IFC export: 20,368
 * elements, **99.87%** within 1e-4 ft, median error 5.7e-14 ft. Null controls:
 * shuffling the rotation gives 0.039, the origin 0.0001, the geometry reference
 * 0.030, and everything 0.0001.
 *
 * The shared unit is a per-shape cache, not the family type — panel width and
 * mullion length are baked into the cached shape, so 884 distinct panel widths
 * resolve to about 1,600 geometry objects, reused 4.6 times on average.
 */
import type { ElementObject } from "./element-objects.ts";

/** Instance objects are exactly this long; anything else is shared geometry. */
const INSTANCE_OBJECT_LENGTH = 300;

/** Model coordinates in feet stay well inside this bound. */
const MAX_COORDINATE = 5e4;

export type InstancePlacement = {
  elementId: number;
  /** Row-major 3x3; the columns are the local axes. */
  basis: number[];
  origin: [number, number, number];
  /** Element id of the shared geometry object this instance references. */
  geometryId: number;
};

export type LocalBounds = {
  elementId: number;
  min: [number, number, number];
  max: [number, number, number];
};

function finite(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
}

/** Read an instance's placement and its shared-geometry reference. */
export function readInstancePlacement(
  data: Uint8Array,
  object: ElementObject,
): InstancePlacement | null {
  if (object.objectLength !== INSTANCE_OBJECT_LENGTH) return null;
  const end = object.offset + object.objectLength;
  if (end + 8 > data.byteLength) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const basis: number[] = [];
  for (let index = 0; index < 9; index += 1) {
    const value = view.getFloat64(end - 96 + index * 8, true);
    if (!Number.isFinite(value) || Math.abs(value) > 1.0001) return null;
    basis.push(value);
  }
  const origin: [number, number, number] = [
    view.getFloat64(end - 24, true),
    view.getFloat64(end - 16, true),
    view.getFloat64(end - 8, true),
  ];
  if (!origin.every(finite)) return null;

  // The first trailer word is the shared geometry object's element id.
  if (view.getUint32(end + 4, true) !== 0) return null;
  const geometryId = view.getUint32(end, true);
  if (!geometryId) return null;

  return { elementId: object.elementId, basis, origin, geometryId };
}

/** Constant word introducing an object's bounds sub-record. */
const BOUNDS_FAMILY_WORD = 0x0008_8004;

/**
 * Offset of the bounds block within an object, from the object's own start.
 *
 * A shape's AABB is not at a fixed place: it sits behind the field table, whose
 * length is driven by the record count, exactly as it does in the element bounds
 * record — `42 + 6 * count`. Reading a fixed `+48` is the `count == 1` case, and
 * it is the only case that was handled, so every shape with a longer field table
 * was rejected. The block is written twice, and that duplication is what makes
 * the read safe to widen: a false positive has to reproduce 48 bytes exactly.
 */
function boundsOffsetWithin(data: Uint8Array, start: number): number | null {
  if (start + 46 > data.byteLength) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(start + 34, true) !== BOUNDS_FAMILY_WORD) return null;
  const count = view.getUint32(start + 38, true);
  if (count < 1 || count > 10_000) return null;
  if (view.getUint32(start + 42, true) !== 3) return null;
  const at = start + 42 + count * 6;
  if (at + 96 > data.byteLength) return null;
  for (let byte = 0; byte < 48; byte += 1) {
    if (data[at + byte] !== data[at + 48 + byte]) return null;
  }
  return at;
}

/** Read a shared geometry object's bounds, expressed in the local frame. */
export function readLocalBounds(data: Uint8Array, object: ElementObject): LocalBounds | null {
  if (object.objectLength === INSTANCE_OBJECT_LENGTH) return null;
  if (object.offset + 96 > data.byteLength) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const at = boundsOffsetWithin(data, object.offset) ?? object.offset + 48;
  const values: number[] = [];
  for (let index = 0; index < 6; index += 1) {
    values.push(view.getFloat64(at + index * 8, true));
  }
  if (!values.every(finite)) return null;
  const [minX, minY, minZ, maxX, maxY, maxZ] = values as [
    number, number, number, number, number, number,
  ];
  if (maxX < minX || maxY < minY || maxZ < minZ) return null;
  return {
    elementId: object.elementId,
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

/**
 * Place a shared shape into the world: the eight corners of its local bounds
 * through `world = M · local + O`, in the corner order the box index buffer
 * expects.
 */
export function instanceCorners(
  placement: InstancePlacement,
  bounds: LocalBounds,
): [number, number, number][] {
  const [minX, minY, minZ] = bounds.min;
  const [maxX, maxY, maxZ] = bounds.max;
  const local: [number, number, number][] = [
    [minX, minY, minZ], [maxX, minY, minZ], [maxX, maxY, minZ], [minX, maxY, minZ],
    [minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ],
  ];
  const m = placement.basis;
  const [ox, oy, oz] = placement.origin;
  // Columns are the local axes, so a local vector multiplies the columns.
  return local.map(([x, y, z]) => [
    m[0]! * x + m[1]! * y + m[2]! * z + ox,
    m[3]! * x + m[4]! * y + m[5]! * z + oy,
    m[6]! * x + m[7]! * y + m[8]! * z + oz,
  ]);
}
