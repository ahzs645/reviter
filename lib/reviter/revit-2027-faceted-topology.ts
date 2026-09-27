/**
 * The triangle mesh a `GPolyMesh` queues, read in the geometry replay.
 *
 * `FacetedTopology` is a family of classes that differ only in how they store
 * the same three arrays. Every member starts with `FloatNormalsFacetedTopology`
 * (a normals mode, a common normal and a counted array of float normals), then
 * holds its points as floats, as floats plus a double offset, or as doubles,
 * then its triangles as 16- or 32-bit index triples, and in the 8 to 13 forms a
 * counted array of edge-visibility bytes. Each array is a u32 count followed by
 * its items. The forms that add UV storage (16 and up) and the "tiny" forms are
 * not read: nothing in the supplied files shows how they are laid out.
 *
 * In the 2025 RAC sample the pendant lights' lens and rod and the site's
 * imported meshes are `FacetedTopology0` and `FacetedTopology8`: after the last
 * array, the next queued object starts exactly where this reading ends, and
 * every index is below the point count.
 */
import { usesRevit2027RecordLayout } from "./revit-class-tags.ts";

type PointStorage = "float" | "offset-float" | "double";
type IndexStorage = "u16" | "i32";

type Form = { points: PointStorage; indices: IndexStorage; edgeFlags: boolean };

/** Exact Revit 2027 source-class slots of the forms read here. */
export const REVIT_2027_FACETED_TOPOLOGY_FORMS: ReadonlyMap<number, Form & { name: string }> = new Map([
  [1868, { name: "FacetedTopology0", points: "float", indices: "u16", edgeFlags: false }],
  [1872, { name: "FacetedTopology1", points: "float", indices: "i32", edgeFlags: false }],
  [1874, { name: "FacetedTopology2", points: "offset-float", indices: "u16", edgeFlags: false }],
  [1880, { name: "FacetedTopology3", points: "offset-float", indices: "i32", edgeFlags: false }],
  [1882, { name: "FacetedTopology4", points: "double", indices: "u16", edgeFlags: false }],
  [1886, { name: "FacetedTopology5", points: "double", indices: "i32", edgeFlags: false }],
  [1899, { name: "FacetedTopology8", points: "float", indices: "u16", edgeFlags: true }],
  [1903, { name: "FacetedTopology9", points: "float", indices: "i32", edgeFlags: true }],
  [1873, { name: "FacetedTopology10", points: "offset-float", indices: "u16", edgeFlags: true }],
  [1879, { name: "FacetedTopology11", points: "offset-float", indices: "i32", edgeFlags: true }],
  [1881, { name: "FacetedTopology12", points: "double", indices: "u16", edgeFlags: true }],
  [1885, { name: "FacetedTopology13", points: "double", indices: "i32", edgeFlags: true }],
] as const satisfies readonly [number, Form & { name: string }][]);

/** Far more than any family mesh holds; beyond it the bytes are not a mesh. */
const MAX_ITEMS = 4_000_000;
/** Coordinates beyond this many feet are not a building. */
const MAX_COORDINATE_FEET = 1e7;

export type Revit2027FacetedTopology = {
  byteOffset: number;
  endOffset: number;
  className: string;
  normalsMode: number;
  /** Stored normals, three floats each: one per point, one per triangle, or none. */
  normals: Float32Array;
  /** Point coordinates in feet, offset applied. */
  positions: Float64Array;
  indices: Uint32Array;
};

export type Revit2027FacetedTopologyDecodeResult =
  | { ok: true; value: Revit2027FacetedTopology }
  | { ok: false; error: string };

/** Decode one faceted-topology object of a known form. */
export function decodeRevit2027FacetedTopology(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
  sourceClassSlot: number,
): Revit2027FacetedTopologyDecodeResult {
  const form = REVIT_2027_FACETED_TOPOLOGY_FORMS.get(sourceClassSlot);
  if (!form) {
    return { ok: false, error: `source slot ${sourceClassSlot} is not a read faceted-topology form` };
  }
  const fail = (error: string): Revit2027FacetedTopologyDecodeResult => ({
    ok: false,
    error: `Revit 2027 ${form.name} ${error}`,
  });
  if (!usesRevit2027RecordLayout(revitVersion)) return fail("decoding requires release 2027");
  if (
    !Number.isSafeInteger(byteOffset) ||
    byteOffset < 0 ||
    !Number.isSafeInteger(enclosingEndOffset) ||
    enclosingEndOffset > data.byteLength ||
    byteOffset >= enclosingEndOffset
  ) {
    return fail("body is outside its owner");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = byteOffset;
  const fits = (bytes: number) => at + bytes <= enclosingEndOffset;
  const count = (itemBytes: number): number | null => {
    if (!fits(4)) return null;
    const value = view.getUint32(at, true);
    if (value > MAX_ITEMS || !fits(4 + value * itemBytes)) return null;
    at += 4;
    return value;
  };

  if (!fits(16)) return fail("header is truncated");
  const normalsMode = view.getInt32(at, true);
  const common = [view.getFloat32(at + 4, true), view.getFloat32(at + 8, true), view.getFloat32(at + 12, true)];
  if (normalsMode < 0 || normalsMode > 2 || !common.every((value) => Number.isFinite(value) && Math.abs(value) <= 1.0001)) {
    return fail("normals header is invalid");
  }
  at += 16;
  const normalCount = count(12);
  if (normalCount == null) return fail("normals array is invalid");
  const normals = new Float32Array(normalCount * 3);
  for (let index = 0; index < normals.length; index += 1) {
    normals[index] = view.getFloat32(at + index * 4, true);
    if (!Number.isFinite(normals[index]!)) return fail("contains a non-finite normal");
  }
  at += normalCount * 12;

  const offset = [0, 0, 0];
  if (form.points === "offset-float") {
    if (!fits(24)) return fail("offset is truncated");
    for (let axis = 0; axis < 3; axis += 1) offset[axis] = view.getFloat64(at + axis * 8, true);
    at += 24;
  }
  const scalarBytes = form.points === "double" ? 8 : 4;
  const pointCount = count(3 * scalarBytes);
  if (pointCount == null || pointCount < 3) return fail("points array is invalid");
  const positions = new Float64Array(pointCount * 3);
  for (let index = 0; index < positions.length; index += 1) {
    const value = scalarBytes === 8
      ? view.getFloat64(at + index * 8, true)
      : view.getFloat32(at + index * 4, true);
    const coordinate = value + offset[index % 3]!;
    if (!Number.isFinite(coordinate) || Math.abs(coordinate) > MAX_COORDINATE_FEET) {
      return fail("contains an invalid point");
    }
    positions[index] = coordinate;
  }
  at += positions.length * scalarBytes;

  const indexBytes = form.indices === "u16" ? 2 : 4;
  const triangleCount = count(3 * indexBytes);
  if (triangleCount == null || triangleCount < 1) return fail("facets array is invalid");
  const indices = new Uint32Array(triangleCount * 3);
  for (let index = 0; index < indices.length; index += 1) {
    const value = indexBytes === 2
      ? view.getUint16(at + index * 2, true)
      : view.getInt32(at + index * 4, true);
    if (value < 0 || value >= pointCount) return fail("has a facet index outside its points");
    indices[index] = value;
  }
  at += indices.length * indexBytes;

  // The per-vertex and per-face modes are the ones measured; a count that
  // fits neither is a misread, not a third binding.
  if (normalCount !== 0 && normalCount !== pointCount && normalCount !== triangleCount) {
    return fail("normal count matches neither its points nor its facets");
  }

  if (form.edgeFlags) {
    const edgeCount = count(1);
    if (edgeCount == null) return fail("edge-visibility array is invalid");
    at += edgeCount;
  }

  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: at,
      className: form.name,
      normalsMode,
      normals,
      positions,
      indices,
    },
  };
}
