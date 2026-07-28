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
import { collectSurfaces, type PlanePatch, type SurfacePatch } from "./surfaces.ts";

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
  /**
   * Persisted `InstInfoBase.m_symbolId`. In Revit 2027 the symbol object also
   * owns the shared local geometry, so this is the renderer's geometry id too.
   */
  symbolId?: number;
};

export type LocalBounds = {
  elementId: number;
  min: [number, number, number];
  max: [number, number, number];
  /**
   * True when the box is the element's own solid rather than the whole region
   * the family sweeps through.
   *
   * The distinction only matters for doors, and there it matters a lot. A
   * door's cached AABB is its **swing** — the quarter circle the leaf turns
   * through — so it has to be folded before it is the door. The same door's
   * B-rep shape is the leaf outright, and folding that would be a no-op that
   * quietly replaced it with the host wall's thickness instead of the door's
   * own. Without this flag the two are indistinguishable to `door-leaf.ts`,
   * because a leaf and an unfoldable swing are both symmetric in plan.
   */
  leaf?: boolean;
  /**
   * True when the box was read from the **bounding faces of the shape's own
   * B-rep**, rather than from a cached AABB or from the trim ranges.
   *
   * It exists for one decision in `convert.ts`. A placed instance's oriented box
   * is otherwise disbelieved wherever it disagrees with the element's own
   * duplicated-bounds record by more than a foot, and that check assumes the two
   * are readings of the same thing. For a casement window they are not: the
   * record is the family's box **including the sash swung open**, 1.35 ft deeper
   * than the window the export writes, so the tighter reading was being rejected
   * in favour of the swept one and 3 of the 20 windows were drawn 1.35 ft
   * oversized.
   *
   * The flag is deliberately narrower than `leaf`. Exempting every `leaf` shape
   * instead was measured and **rejected**: `doorShapeFromPlanes` flags its
   * reading too, and 17 of the `0x0810` shapes it reads belong to columns whose
   * oriented box that check is right to refuse — columns fell from 100.0% to
   * **90.5%** centre agreement, 26 of 275, to gain 3 windows.
   */
  faceRead?: boolean;
};

/** Native category of a Revit stair assembly (`OST_Stairs`). */
const STAIRS_CATEGORY_ID = -2_000_120;

/**
 * Resolve the ids that are genuinely reusable local shapes.
 *
 * `InstInfoBase` persists the trailing id as `m_symbolId`, and for ordinary
 * family instances that symbol owns the local geometry cache. A stair assembly
 * is the measured exception: its same field points at a run or stringer
 * subelement, which has its own validated bounds and must remain a scene
 * element. Treating those two meanings as interchangeable removed the only
 * `IfcMember` and `IfcStairFlight` products absent from the exact UNBC scene.
 *
 * The exception is gated by the assembly's own persisted `OST_Stairs` token.
 * No IFC class, element id, adjacency, or object-marker singleton participates.
 */
export function sharedGeometryIdsForPlacements(
  placements: Iterable<InstancePlacement>,
  categoryByElement: ReadonlyMap<number, number>,
): Set<number> {
  const shared = new Set<number>();
  for (const placement of placements) {
    if (categoryByElement.get(placement.elementId) === STAIRS_CATEGORY_ID) continue;
    shared.add(placement.geometryId);
  }
  return shared;
}

function finite(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
}

/**
 * Window, measured from an object's **start**, in which a placement's basis has
 * been seen to begin. The offset is not fixed — `+418` for 22,511 objects,
 * `+412` for 2,323, `+414` for 1,442 — so it is found, not indexed.
 *
 * **It was measured from the end, and that is why the longer objects had no
 * placement.** Searching every offset of the 63 doors that own a `0x07ef`
 * object and yield nothing, all 63 carry a placement-shaped field — an
 * orthonormal basis, a world origin, a live geometry reference — and every one
 * of them sits at `+414`, `+418`, `+420`, `+422` or `+444` from the object's
 * start. From the *end* the same fields are at −163 to −199, outside the
 * −149..−125 window the reader used. The window worked at all only because most
 * of these objects are 539 to 551 bytes long, where `end − 149` lands on `+390`
 * and the field is swept up anyway; a 581-byte object puts `+414` at `end −
 * 167` and it was missed.
 *
 * The control is in the same measurement: over 1,600 objects that *do* resolve,
 * the offsets from the start cluster on five values and 1,297 of them are
 * `+414`, while the offsets from the end spread across −125 to −199. A field at
 * a fixed distance from the start of a record is what a fixed-layout header
 * looks like; the end-anchored reading was a coincidence of one length.
 *
 * This is not the widening this project already measured and rejected — that
 * one searched 80 to 240 bytes back from the *end*, found 1,331 extra
 * candidates and reproduced only 24 export elements. Anchoring on the start
 * narrows the search rather than widening it.
 */
const TAIL_PLACEMENT_FROM_START_FIRST = 408;
const TAIL_PLACEMENT_FROM_START_LAST = 448;

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
  const first = object.offset + TAIL_PLACEMENT_FROM_START_FIRST;
  const last = object.offset + TAIL_PLACEMENT_FROM_START_LAST;
  for (let at = first; at <= last; at += 1) {
    if (at < object.offset || at + 104 > Math.min(end, data.byteLength)) continue;
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
    return { elementId: object.elementId, basis, origin, geometryId, symbolId: geometryId };
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

  return { elementId: object.elementId, basis, origin, geometryId, symbolId: geometryId };
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

/**
 * Smallest extent, on any axis, a shape may have and still be a shape.
 *
 * **A box with no extent at all is not a shape, and the `+48` fallback produces
 * one.** `boundsOffsetWithin` derives the block's offset from the field count —
 * `42 + 6 * count`, which *is* `+48` when the count is 1 — so the fallback only
 * runs when the framing check has already failed, and on that path `+48` lands
 * on the field table instead: six subnormal doubles that are finite, ordered
 * correctly, and enclose nothing. 368 of the 3,699 objects that reach the
 * fallback read as such a box, against 1,444 flat on one axis and 1,887 solid,
 * and 12 of those zero boxes are the shape 26 placements point at — 6 doors, 2
 * windows and 4 elements the export does not name, each drawn as eight identical
 * corners. Two *framed* reads produce one too, so the refusal is not scoped to
 * the fallback: a shape with no extent is undrawable whatever offset it came
 * from.
 *
 * Flatness on a single axis is **not** refused, because it is not evidence of a
 * bad read: 4,077 of the 14,876 framed reads — the ones whose duplicated block
 * proves the offset — are flat on one axis. Only a box that is degenerate on
 * every axis is rejected, which is exactly the failure and nothing else.
 *
 * `door-leaf.ts` already refused such a box downstream, for doors alone. This
 * puts the refusal where every consumer benefits, and it also stops the zero box
 * *displacing* a good one: `convert.ts` keys shared shapes by element id and the
 * last read wins, and a window's B-rep object and this zero-box object carry the
 * same id.
 */
const MIN_SHAPE_EXTENT_FEET = 1e-6;

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
  if (
    maxX - minX <= MIN_SHAPE_EXTENT_FEET &&
    maxY - minY <= MIN_SHAPE_EXTENT_FEET &&
    maxZ - minZ <= MIN_SHAPE_EXTENT_FEET
  ) return null;
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
 * 0x0810  len 5,786 .. 11,285   door, a genuine B-rep
 *   ten to sixteen trimmed analytic planes in the format `surfaces.ts` already
 *   decodes; see `doorShapeFromPlanes` for how the leaf is read out of them.
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
 * The two parameterised lengths are exact on purpose. 1,998 objects stream-wide
 * sit at other lengths under the same markers, the offsets are length-specific,
 * and applying the 1,379 offsets to them drops member accuracy from 100% to
 * 97.4%. The door read carries no offsets, so it is not gated on a length at
 * all; see `doorShapeFromPlanes`.
 */
const MULLION_SHAPE_LENGTH = 1_379;
const PANEL_SHAPE_LENGTH = 1_639;

/** Markers heading a shared shape `readLocalShape` knows how to read. */
export const SHAPE_OBJECT_MARKERS = [0x10dc, 0x10de, 0x0810];

/** A panel's glass sits this far off the local origin: 25 mm, in feet. */
const PANEL_FACE_OFFSET_FEET = 0.0820209973753281;

/** A patch range counts as centred on the origin within this, in feet. */
const SYMMETRY_TOLERANCE_FEET = 1e-6;

/**
 * A door's leaf, read out of the trimmed planes its B-rep is made of.
 *
 * The shape is a real solid rather than a box, and it is written as ten to
 * sixteen trimmed analytic planes. Three readings of them were tried against
 * the paired export, over the 335 doors whose shape object is one of these:
 *
 * | reading | size within 0.5 ft | median |
 * | --- | --- | --- |
 * | the union of the trimmed patches | 0.0% | 10.4 ft |
 * | the span of the plane origins | 77.9% | 0.29 ft |
 * | **this one** | **99.4%** | **0.00 ft** |
 *
 * The union of the patches is not the shape, because the ranges are not all
 * tight: several patches carry a neighbour's range verbatim — a z-normal face
 * whose `v` range is the model's *height* rather than its own depth — so the
 * hull they span is three times the door. **The planes do not form a closed
 * solid, and a B-rep leaf cannot be built from them.** The span of the plane
 * origins is the leaf alone, which is a real shape but the wrong one: it is
 * short by 0.2493 ft on each side, the 76 mm the frame reveals, and the export
 * writes the frame with the door.
 *
 * What does work is reading each axis from the evidence that is sound for it:
 *
 * - **width** from the widest patch range that is *symmetric about the local
 *   origin*. A door family is centred on its width and on nothing else, so a
 *   range running `-w/2 .. +w/2` is that width — frame included, which the span
 *   of the plane origins misses.
 * - **height** from the longest range of any patch, which is the leaf's own
 *   vertical extent; every patch that spans the opening carries it.
 * - **thickness** from the y-normal plane nearest the origin without being on
 *   it. The furthest is the swing — the arc the leaf turns through, which the
 *   export does not contain — and drawing to it makes a door three feet deep.
 *
 * **This is not a new hypothesis about the file.** The two object lengths the
 * old length-indexed read handled — `f64@513` for the half width and `f64@553`
 * for the height — are reproduced by this read **exactly, for 58 of 58 shapes,
 * worst disagreement 8.9e-16 ft**. What it adds is the other 91 shapes, whose
 * lengths (5,786, 5,966, 7,185, 8,113, 11,105, 11,285) the whitelist rejected
 * and which serve 185 more doors. Null control: against a shuffled door-to-shape
 * pairing the same boxes score **14.0%**.
 */
function doorShapeFromPlanes(patches: SurfacePatch[], elementId: number): LocalBounds | null {
  let face = Infinity;
  let halfWidth = 0;
  let height = 0;
  for (const patch of patches) {
    if (patch.kind !== "plane") continue;
    const { uDir, vDir } = patch;
    for (const [lo, hi] of [[patch.uMin, patch.uMax], [patch.vMin, patch.vMax]] as const) {
      height = Math.max(height, hi - lo);
      if (hi > 0 && Math.abs(lo + hi) <= SYMMETRY_TOLERANCE_FEET) halfWidth = Math.max(halfWidth, hi);
    }
    const normalY = uDir.z * vDir.x - uDir.x * vDir.z;
    if (Math.abs(Math.abs(normalY) - 1) > 1e-9) continue;
    const offset = Math.abs(patch.origin.y);
    if (offset > 1e-9 && offset < face) face = offset;
  }
  if (!Number.isFinite(face) || !(halfWidth > 0) || !(height > 0)) return null;
  return {
    elementId,
    min: [-halfWidth, -face, 0],
    max: [halfWidth, face, height],
    // Already the leaf, so `doorLeafFromShape` must not fold it again.
    leaf: true,
  };
}

/** Trimmed plane records are this long, and one B-rep's table is contiguous. */
const PLANE_RECORD_BYTES = 105;

/** A face's mid-plane must be its pair's exact mean to within this, in feet. */
const MIDPLANE_TOLERANCE_FEET = 1e-6;

/**
 * How far above the local origin a shape's base must sit to be read as a sill.
 *
 * A door leaf stands on the floor and a window sits on a sill, and that is the
 * whole discriminator: the base of the box is **0.0000 ft for every one of the
 * 257 door shapes** in the supplied project — minimum −0.0000, maximum 0.0000,
 * none above the origin — and 1.0007 to 3.0020 ft for all 8 window shapes. Any
 * threshold strictly inside that gap separates the two, so this is a plateau six
 * orders of magnitude wide rather than a fitted value: **1e-6, 0.001, 0.01, 0.1,
 * 0.5 and 1.0 ft all select the same 8 window shapes and the same 0 door
 * shapes**, and only at 1.5 ft does a real window start to be lost. 0.1 ft is 30
 * mm, comfortably above authoring noise and far below the shallowest sill.
 */
const SILL_ABOVE_ORIGIN_FEET = 0.1;

/** Which model axis a unit vector lies along, or -1 for an oblique one. */
function unitAxis(vector: { x: number; y: number; z: number }): number {
  const components = [vector.x, vector.y, vector.z];
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(Math.abs(components[axis]!) - 1) < 1e-9) return axis;
  }
  return -1;
}

/** A plane's normal, from its two in-plane directions. */
function planeNormal(patch: PlanePatch): { x: number; y: number; z: number } {
  const { uDir, vDir } = patch;
  return {
    x: uDir.y * vDir.z - uDir.z * vDir.y,
    y: uDir.z * vDir.x - uDir.x * vDir.z,
    z: uDir.x * vDir.y - uDir.y * vDir.x,
  };
}

/**
 * One B-rep's surface table: the maximal run of plane records at the 105-byte
 * stride. A shape written as several solids gives several tables, and a patch
 * found after a break in the stride is a byte pattern in some other structure
 * rather than the next surface — in the 26,012-byte casement object the run after
 * the break reads origins at x = 14.9 ft on a 6 ft window, each record's trim
 * range centred on the *next* record's origin, which is what a misframed read of
 * a neighbouring structure looks like.
 */
function planeTables(patches: SurfacePatch[]): PlanePatch[][] {
  const tables: PlanePatch[][] = [];
  let current: PlanePatch[] = [];
  for (const patch of patches) {
    if (patch.kind !== "plane") continue;
    const previous = current[current.length - 1];
    if (previous && patch.offset !== previous.offset + PLANE_RECORD_BYTES) {
      tables.push(current);
      current = [];
    }
    current.push(patch);
  }
  if (current.length) tables.push(current);
  return tables;
}

/**
 * The extent one surface table bounds, axis by axis, from its faces alone.
 *
 * An axis's extent is the span of the **origins of the planes whose normal is
 * that axis**: the outermost face perpendicular to an axis is what bounds the
 * solid along it. The trim ranges are not consulted at all, and that is
 * deliberate — several patches carry a neighbour's range verbatim (a z-normal
 * face whose `v` range is the model's *width*), which is why the hull over the
 * trimmed patches is 27.3 x 12.6 x 10.4 ft on a 6.0 x 1.0 x 4.4 ft window.
 *
 * The gate is arithmetic on the same origins: every axis's extreme pair must have
 * its own **mid-plane** present, the exact mean of the two to 1e-6 — which needs
 * three faces normal to each axis, so a table bounding fewer is refused. A window is
 * written as three parallel triples — two faces and the plane between them — so
 * the test is self-checking in the way the curved-wall cylinder triple is, and it
 * is what separates a window from a door: a door family's x triple sits at
 * `-w, 0.0001, +w`, its mid-plane 0.0001 ft off the mean, and its y triple runs
 * `-t, 0, +R` where the swing radius has no partner at all.
 */
function faceExtent(table: PlanePatch[]): { min: number[]; max: number[] } | null {
  const origins: number[][] = [[], [], []];
  for (const patch of table) {
    const axis = unitAxis(planeNormal(patch));
    if (axis < 0) continue;
    origins[axis]!.push([patch.origin.x, patch.origin.y, patch.origin.z][axis]!);
  }
  const min: number[] = [];
  const max: number[] = [];
  for (let axis = 0; axis < 3; axis += 1) {
    const values = origins[axis]!;
    if (values.length < 3) return null;
    const low = Math.min(...values);
    const high = Math.max(...values);
    if (!(high > low)) return null;
    const middle = (low + high) / 2;
    if (!values.some((value) => Math.abs(value - middle) <= MIDPLANE_TOLERANCE_FEET)) return null;
    min.push(low);
    max.push(high);
  }
  return { min, max };
}

/**
 * A window's box, read from the faces of its own B-rep.
 *
 * Windows were placed correctly and drawn wrong: every one of the 20 in the
 * supplied project carries a complete placement, and `doorShapeFromPlanes` then
 * read their shape as a door's, giving 21.4% centre and 14.3% size agreement with
 * a median 2.208 ft centre and 1.583 ft size error. The two readings disagree
 * because a door and a window are bounded by different evidence: a door's own
 * thickness is the **nearest** y-normal plane, because the furthest is the swing,
 * while a window's frame depth is the **outermost** pair, the nearest being the
 * glass.
 *
 * So each axis is read from its outermost faces, and where the shape holds a
 * second surface table the two are **intersected** per axis — two independent
 * readings of one shape, so the tighter is not a guess, the same argument that
 * picks the smaller of the two bounds copies and clips a wall solid to its own
 * envelope. It is the intersection that cuts the casement's swung-open sash: the
 * first table's depth runs `-t .. 1.3448 + t` for all five casement shapes, the
 * second gives `-t .. +t`, and the export writes the second.
 *
 * | 20 windows | centre within 0.5 ft | size within 0.5 ft | median centre | median size |
 * | --- | --- | --- | --- | --- |
 * | read as a door's shape | 0.0% | 15.0% | 2.208 ft | 1.583 ft |
 * | faces, one table only | 45.0% | 45.0% | 0.570 ft | 1.141 ft |
 * | **faces, tables intersected** | **100.0%** | **100.0%** | **0.042 ft** | **0.141 ft** |
 *
 * Measured on the box this returns, carried out through each window's own
 * placement. Three of the 20 need `LocalBounds.faceRead` as well to reach the
 * viewer, because the agreement check in `convert.ts` would otherwise draw them
 * from their record instead; without it the conversion reads 85.0% / 85.0%.
 *
 * **What it costs elsewhere is nothing, and that is measured rather than
 * asserted.** Over all 2,157 `0x0810` shapes the gate fires on 8, and they are
 * the 8 the 20 windows point at: **0 of 228 door shapes, 0 of 29 door-and-opening
 * shapes, 0 of 17 column shapes, 0 of 1,662 shapes only unnamed elements use, 0
 * of 4 opening shapes**, and 3 shapes no placement references at all. Doors sit
 * at 99.2% / 99.1% and 1,824 of them outrank 20 windows, so this route is
 * ordered ahead of the door reading only because it cannot reach a door shape.
 *
 * Each clause of the gate is load-bearing and was measured on its own. Dropping
 * the mid-plane test admits 53 door shapes serving 195 doors and takes them from
 * 99.5% to **0.0%** on both centre and size, because the outermost y-normal plane
 * of a door is its swing. Dropping the sill test in favour of "exactly three
 * faces per axis" reaches only the 5 casement shapes, leaving 9 windows on the
 * door reading. Dropping the mid-plane test and keeping the sill breaks two
 * columns, 100.0% to 0.0% on size.
 *
 * Null control, over 20 trials, each window given a shape that is not its own:
 * drawn from the 8 window shapes it scores **63.8% on centre and 21.0% on size**,
 * median size error 2.001 ft; drawn from all 2,157 `0x0810` shapes, **1.3% and
 * 0.5%**, median 3.728 ft. The within-family centre figure is high for a null and
 * the reason is the population rather than the rule — 8 shapes across 3 families,
 * and the five casement shapes differ from one another only in frame depth, so a
 * swap inside that family is nearly a no-op. 21.0% is the figure comparable to
 * the door reading's 14.0%.
 *
 * The residual is 0.042 ft on centre and 0.141 ft on size, and it is the
 * intersection being an inch tight: a casement's second table is the sash, inset
 * exactly 1 inch into the frame in the plane of the window, so x and the top of z
 * come back 0.0833 ft short. Reading those two axes from the first table alone
 * would be exact, and is not done, because "take the tighter of two readings"
 * needs no per-axis exception and an inch is not worth inventing one for.
 */
function windowShapeFromFaces(patches: SurfacePatch[], elementId: number): LocalBounds | null {
  const tables = planeTables(patches);
  const first = tables[0];
  if (!first) return null;
  const extent = faceExtent(first);
  if (!extent) return null;
  if (!(extent.min[2]! > SILL_ABOVE_ORIGIN_FEET)) return null;
  const min = [...extent.min];
  const max = [...extent.max];
  for (const table of tables.slice(1)) {
    const other = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const patch of table) {
      const axis = unitAxis(planeNormal(patch));
      if (axis < 0) continue;
      const at = [patch.origin.x, patch.origin.y, patch.origin.z][axis]!;
      other.min[axis] = Math.min(other.min[axis]!, at);
      other.max[axis] = Math.max(other.max[axis]!, at);
    }
    for (let axis = 0; axis < 3; axis += 1) {
      if (!Number.isFinite(other.min[axis]!)) continue;
      min[axis] = Math.max(min[axis]!, other.min[axis]!);
      max[axis] = Math.min(max[axis]!, other.max[axis]!);
    }
  }
  for (let axis = 0; axis < 3; axis += 1) {
    if (!(max[axis]! - min[axis]! > MIN_SHAPE_EXTENT_FEET)) return null;
  }
  return {
    elementId,
    min: min as [number, number, number],
    max: max as [number, number, number],
    // The window's own solid, so nothing may fold it into a leaf later.
    leaf: true,
    faceRead: true,
  };
}

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

  if (object.marker === 0x0810) {
    const patches = collectSurfaces(data.subarray(start, end));
    // The window route is tried first because it cannot reach a door shape: its
    // gate fires on 0 of the 257 shapes a door points at, measured. The door
    // route is the general one for this marker and stays the fallback.
    return windowShapeFromFaces(patches, object.elementId)
      ?? doorShapeFromPlanes(patches, object.elementId);
  }
  return null;
}
