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
import { collectSurfaces } from "./surfaces.ts";

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

/**
 * Widest window, measured back from an object's end, in which a placement's
 * basis has been seen to start. The offset is not fixed — `+418` for 22,511
 * objects, `+412` for 2,323, `+414` for 1,442 — so it is found, not indexed.
 */
const TAIL_PLACEMENT_FIRST = 149;
const TAIL_PLACEMENT_LAST = 125;

/** True when the columns of a row-major 3x3 are a right-handed orthonormal set. */
function rightHandedOrthonormal(basis: number[]): boolean {
  const column = (index: number) => [basis[index]!, basis[index + 3]!, basis[index + 6]!];
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const columns = [column(0), column(1), column(2)];
  for (const axis of columns) if (Math.abs(dot(axis, axis) - 1) > 1e-6) return false;
  if (Math.abs(dot(columns[0]!, columns[1]!)) > 1e-6) return false;
  if (Math.abs(dot(columns[0]!, columns[2]!)) > 1e-6) return false;
  if (Math.abs(dot(columns[1]!, columns[2]!)) > 1e-6) return false;
  const [a, b, c] = columns as [number[], number[], number[]];
  const determinant =
    a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) -
    a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!) +
    a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!);
  return Math.abs(determinant - 1) < 1e-6;
}

/**
 * The placement carried by an element's own object, rather than by a separate
 * 300-byte instance object.
 *
 * Most elements that never reached the scene were **not** missing from the file.
 * Their `0x07ef` object differs from a recovered sibling's in exactly one region
 * — a rigid placement holding the same three fields, in the same order, as the
 * instance object: a 3x3 basis, a world origin, and the element id of the shared
 * geometry object. `readInstancePlacement` rejected anything whose length was
 * not exactly 300, so it had never been read.
 *
 * Reading it places **3,929** elements the export names and the recovery did not
 * have, among them 2,746 curtain-wall mullions and 948 panels, all of them
 * within 0.25 ft of the export with a median error of **0.0001 ft**.
 *
 * The rule is not class-specific and the controls are what make it safe. On the
 * 19,584 elements that carry both objects it finds exactly one transform per
 * object, and its origin agrees with the instance object's for 19,582 of them;
 * the geometry reference agrees for 21,637 of 21,637. Shuffling the target scores
 * 0.1% within 0.25 ft, shuffling the origin 0.1%, shuffling the geometry
 * reference 6.3%, and transposing the basis 62.8% — that last failing only on
 * the non-90° curtain walls, exactly where the columns-are-axes convention is
 * the one that matters. It fires on 0.0% of seven other object classes.
 */
function readTailPlacement(
  data: Uint8Array,
  object: ElementObject,
): InstancePlacement | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const end = object.offset + object.objectLength;
  for (let at = end - TAIL_PLACEMENT_FIRST; at <= end - TAIL_PLACEMENT_LAST; at += 1) {
    if (at < object.offset || at + 104 > data.byteLength) continue;
    const basis: number[] = [];
    for (let index = 0; index < 9; index += 1) {
      const value = view.getFloat64(at + index * 8, true);
      if (!Number.isFinite(value) || Math.abs(value) > 1.0001) break;
      basis.push(value);
    }
    if (basis.length !== 9 || !rightHandedOrthonormal(basis)) continue;
    const origin: [number, number, number] = [
      view.getFloat64(at + 72, true),
      view.getFloat64(at + 80, true),
      view.getFloat64(at + 88, true),
    ];
    if (!origin.every(finite)) continue;
    // An orthonormal basis alone is not rare — it fires on 99.7% of one other
    // object class. A live geometry reference immediately behind it is what
    // makes the read specific.
    if (view.getUint32(at + 100, true) !== 0) continue;
    const geometryId = view.getUint32(at + 96, true);
    if (!geometryId) continue;
    return { elementId: object.elementId, basis, origin, geometryId };
  }
  return null;
}

/** Read an instance's placement and its shared-geometry reference. */
export function readInstancePlacement(
  data: Uint8Array,
  object: ElementObject,
): InstancePlacement | null {
  if (object.objectLength !== INSTANCE_OBJECT_LENGTH) {
    // A shared geometry object is not a placement, and it is told apart by
    // carrying a bounds sub-record. Testing that first keeps every shape the
    // library already reads: without it a shape whose tail happens to hold an
    // orthonormal basis would be taken for an instance and lose its own box.
    if (boundsOffsetWithin(data, object.offset) != null) return null;
    return readTailPlacement(data, object);
  }
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
  // The two copies are compared as six doubles, not as 48 bytes. Revit does not
  // always write them byte for byte — they differ in the low mantissa byte,
  // `0x68` against `0x65`, a relative 7e-16 — and on that failure the reader
  // fell back to `+48`, which is the *field table*: six subnormal doubles that
  // pass every finiteness and ordering test and yield a zero-size box. Shared
  // shapes readable go from 4,793 to 4,940 and door shapes from 678 to 1,067,
  // with no placement lost; placed columns go from 0.0% to 100.0% within half a
  // foot of the export, a median error of 20.34 ft to 0.0001.
  for (let index = 0; index < 6; index += 1) {
    const first = view.getFloat64(at + index * 8, true);
    const second = view.getFloat64(at + 48 + index * 8, true);
    if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
    if (Math.abs(first - second) > Math.max(Math.abs(first), Math.abs(second), 1) * 1e-9) return null;
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

/**
 * The local shape of an object that carries no bounds sub-record at all.
 *
 * `readLocalBounds` needs a `0x00088004` block, and **none** of the 6,864 objects
 * under markers `0x10dc`, `0x10de` and `0x0810` has one — against 73.9% of the
 * `0x08c6` objects — so the marker is a clean discriminator and this reader
 * cannot shadow a box the library already reads. Those objects are the shared
 * shape for 22,274 element ids, and until now every reference into one was read
 * and thrown away.
 *
 * There is no local box in them to find. Enumerating *every* six-`f64` window
 * that reads as a valid AABB — 178 to 1,025 windows per object — the best is
 * 0.74 to 6.87 ft out and none of 57 objects is within 0.05 ft. What is in them
 * is the shape as parameters:
 *
 * ```text
 * 0x10dc  len 1379   mullion, a rectangle swept along -z
 *   f64@565   half width, written twice          f64@618  profile depth
 *   f64@(L-40) − f64@(L-48)  swept length, less the joint cut-back
 *   byte@910 & 0x04          width flush to the origin rather than centred
 *
 * 0x10de  len 1639   panel, a rectangle swept along +y
 *   f64@770  width   f64@778  height   f64@549  thickness
 *   byte@786 & 0x01  which side of the origin the thickness sits on
 *
 * 0x0810  len 8289 / 8297   door, a genuine B-rep
 *   f64@513  half width, negated      f64@553  height
 *   ten trimmed analytic planes in the format `surfaces.ts` already decodes;
 *   the leaf's face is the y-normal plane of smallest non-zero magnitude, and
 *   the largest is the swing, which the export does not contain.
 * ```
 *
 * **Verification.** Reading the shape and putting it through the element's own
 * placement, against the union of every export product carrying the element id:
 * **21,898 elements, 100.0% within 0.05 ft, median error 0.0001 ft.** 21,254 of
 * those were already placed by another route, which makes them a cross-check 33×
 * the size of the gap; the 644 that were not placed at all score the same. 256 of
 * those 644 have a rotated basis, so they were invisible to the inversion that
 * produced these offsets in the first place — a true holdout.
 *
 * Controls: the export box shuffled scores **0.0%** (median 348 ft), the geometry
 * reference shuffled 3.0% (4.27 ft), the local shape replaced by a unit cube 0.0%
 * (3.22 ft), the basis transposed 41.8%, and inverting the two flag bits 21.9% at
 * 0.01 ft against 100% — a miss of exactly one flag's width. The only non-zero
 * residual is the panel's 0.0016 ft, where the export's inner glass face sits at
 * 0.0803 ft and the file says 25 mm; that is tessellation, not a decode error.
 *
 * The lengths are exact on purpose. 1,998 objects stream-wide sit at other
 * lengths under the same markers, the offsets are length-specific, and applying
 * the 1,379 offsets to them drops member accuracy from 100% to 97.4%.
 */
const MULLION_SHAPE_LENGTH = 1_379;
const PANEL_SHAPE_LENGTH = 1_639;
const DOOR_SHAPE_LENGTHS = [8_289, 8_297];

/** A panel's glass sits this far off the local origin: 25 mm, in feet. */
const PANEL_FACE_OFFSET_FEET = 0.0820209973753281;

export function readLocalShape(data: Uint8Array, object: ElementObject): LocalBounds | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const start = object.offset;
  const end = start + object.objectLength;
  if (end > data.byteLength) return null;
  const at = (offset: number) => view.getFloat64(start + offset, true);
  const box = (
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
  ): LocalBounds | null => {
    const values = [minX, minY, minZ, maxX, maxY, maxZ];
    if (!values.every(finite)) return null;
    if (maxX <= minX || maxY <= minY || maxZ <= minZ) return null;
    return { elementId: object.elementId, min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  };

  if (object.marker === 0x10dc && object.objectLength === MULLION_SHAPE_LENGTH) {
    const halfWidth = at(565);
    const depth = at(618);
    const length = at(object.objectLength - 40) - at(object.objectLength - 48);
    const flush = ((data[start + 910] ?? 0) & 0x04) !== 0;
    return box(
      flush ? -2 * halfWidth : -halfWidth, -depth / 2, -length,
      flush ? 0 : halfWidth, depth / 2, 0,
    );
  }

  if (object.marker === 0x10de && object.objectLength === PANEL_SHAPE_LENGTH) {
    const width = at(770);
    const height = at(778);
    const thickness = at(549);
    const near = ((data[start + 786] ?? 0) & 0x01) !== 0
      ? -(PANEL_FACE_OFFSET_FEET + thickness)
      : PANEL_FACE_OFFSET_FEET;
    const far = ((data[start + 786] ?? 0) & 0x01) !== 0
      ? -PANEL_FACE_OFFSET_FEET
      : PANEL_FACE_OFFSET_FEET + thickness;
    return box(-width / 2, near, 0, width / 2, far, height);
  }

  if (object.marker === 0x0810 && DOOR_SHAPE_LENGTHS.includes(object.objectLength)) {
    const halfWidth = at(513);
    const height = at(553);
    // The leaf's own face, not the swing: among the y-normal planes take the
    // smallest non-zero offset. The largest is the arc the leaf sweeps through,
    // and drawing to it makes a door three feet deep.
    let face = Infinity;
    for (const patch of collectSurfaces(data.subarray(start, end))) {
      if (patch.kind !== "plane") continue;
      const { uDir, vDir } = patch;
      const normalY = uDir.z * vDir.x - uDir.x * vDir.z;
      if (Math.abs(Math.abs(normalY) - 1) > 1e-9) continue;
      const offset = Math.abs(patch.origin.y);
      if (offset > 1e-9 && offset < face) face = offset;
    }
    if (!Number.isFinite(face)) return null;
    return box(
      Math.min(halfWidth, -halfWidth), -face, 0,
      Math.max(halfWidth, -halfWidth), face, height,
    );
  }
  return null;
}
