/**
 * Native analytic surface patches in `Partitions/*`.
 *
 * Revit does not store element shapes as vertex soup. It stores trimmed
 * analytic surfaces — a plane or a cylinder plus the parameter range over which
 * it is used. Two record shapes carry them, both at arbitrary byte alignment:
 *
 * ```text
 * plane, 105 bytes            cylinder, 137 bytes
 * +0    u8  0x01              +0    u8  0x01
 * +1    f64 origin (3)        +1    f64 origin (3)          arc centre
 * +25   f64 uDir (3)          +25   f64 xDir (3)
 * +49   f64 vDir (3)          +49   f64 yDir (3)
 * +73   f64 uMin, vMin,       +73   f64 zDir (3)
 *           uMax, vMax        +97   f64 radius
 *                             +105  f64 uMin, vMin, uMax, vMax
 * ```
 *
 * A surface point is `origin + u·uDir + v·vDir`; for a cylinder `u` is an angle
 * in radians and `v` a height. For a wall the plane is its centre plane, so the
 * location line is `origin + t·uDir` for `t` in `[uMin, uMax]` and the height is
 * `vMax − vMin`.
 *
 * **Verification against the paired IFC export.** Of 7,443 walls with a
 * two-point axis, 91.0% have a vertical plane record exactly collinear with
 * that axis — the in-plane line passes through the axis start within 1e-6 ft.
 * The controls are decisive: shifting the query line sideways by 0.01 ft drops
 * the hit rate to 0.0%, as does rotating it by half a degree. Separately,
 * `vMax − vMin` equals the IFC extrusion height to within 1e-9 ft for 94.2% of
 * walls, against 34.2% under randomised re-pairing.
 *
 * The trim range is the wall *as modelled*, before Revit's join trimming: the
 * difference between `uMin`/`uMax` and the IFC axis endpoints is, element by
 * element, exactly half of a wall thickness present in the model (60 mm, 100 mm,
 * 125 mm, 150 mm…). The IFC axis is the post-join version, so the disagreement
 * is evidence the record is genuine rather than evidence of an error.
 *
 * **Attribution.** Geometry lives in per-element blobs, and each blob is
 * introduced by an owner record that names its element outright:
 *
 * ```text
 * ff ff ff ff 10 03 [u32 count][count x u64 element id]
 * ```
 *
 * A surface belongs to the last such record before it. That record is the same
 * anchor the parameter tables hang off, so one scan serves both.
 *
 * The rule verifies at 99.87% on the 4,544 wall plane-triples that have a unique
 * geometric owner, against 0.04% when the truth is shuffled and 0.00% for a
 * random tag. Across all categories, 96.9% of attributed planes have their
 * origin inside the owner's own bounding box, against 5.5% for a random element.
 *
 * Two earlier readings were wrong and are recorded so they are not retried: the
 * nearest preceding element id owns the surface only 0.6% of the time, and the
 * `[u64 elementId][u32 n][n x u32 itemIndex]` table nearby contains the true
 * owner only 0.4% of the time — its indices address a face/edge graph, not
 * surfaces.
 */

/** `ff ff ff ff 10 03` — the owner record that introduces an element's blob. */
const OWNER_RECORD = [0xff, 0xff, 0xff, 0xff, 0x10, 0x03] as const;

/** Record sizes, in bytes. */
const PLANE_BYTES = 105;
const CYLINDER_BYTES = 137;

/** Direction vectors are unit length to within this tolerance. */
const UNIT_TOLERANCE = 1e-9;

/** Model coordinates in feet stay well inside this bound. */
const MAX_COORDINATE = 5e4;

/** A trim range wider than this is a misread rather than a surface. */
const MAX_TRIM_SPAN = 1e5;

export type Vector3 = { x: number; y: number; z: number };

export type PlanePatch = {
  kind: "plane";
  offset: number;
  origin: Vector3;
  /** In-plane direction; for a wall centre plane this is the location line. */
  uDir: Vector3;
  vDir: Vector3;
  uMin: number;
  vMin: number;
  uMax: number;
  vMax: number;
};

export type CylinderPatch = {
  kind: "cylinder";
  offset: number;
  origin: Vector3;
  xDir: Vector3;
  yDir: Vector3;
  zDir: Vector3;
  radius: number;
  /** `u` is an angle in radians, `v` a height. */
  uMin: number;
  vMin: number;
  uMax: number;
  vMax: number;
};

export type SurfacePatch = PlanePatch | CylinderPatch;

/** A surface together with the element whose blob it was found in. */
export type OwnedSurface = { owner: number; surface: SurfacePatch };

export type SurfaceSummary = {
  planes: number;
  cylinders: number;
  /** Planes whose `vDir` is vertical — wall centre planes are in this set. */
  verticalPlanes: number;
};

function readVector(view: DataView, offset: number): Vector3 | null {
  const x = view.getFloat64(offset, true);
  const y = view.getFloat64(offset + 8, true);
  const z = view.getFloat64(offset + 16, true);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}

function isUnit(vector: Vector3): boolean {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return Math.abs(length - 1) <= UNIT_TOLERANCE;
}

function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function withinModel(point: Vector3): boolean {
  return (
    Math.abs(point.x) <= MAX_COORDINATE &&
    Math.abs(point.y) <= MAX_COORDINATE &&
    Math.abs(point.z) <= MAX_COORDINATE
  );
}

function readTrim(view: DataView, offset: number): [number, number, number, number] | null {
  const values = [0, 1, 2, 3].map((index) => view.getFloat64(offset + index * 8, true));
  if (!values.every((value) => Number.isFinite(value) && Math.abs(value) <= MAX_TRIM_SPAN)) {
    return null;
  }
  const [uMin, vMin, uMax, vMax] = values as [number, number, number, number];
  if (uMax < uMin || vMax < vMin) return null;
  return [uMin, vMin, uMax, vMax];
}

function readPlane(view: DataView, offset: number, byteLength: number): PlanePatch | null {
  if (offset + PLANE_BYTES > byteLength) return null;
  const origin = readVector(view, offset + 1);
  const uDir = readVector(view, offset + 25);
  const vDir = readVector(view, offset + 49);
  if (!origin || !uDir || !vDir) return null;
  if (!withinModel(origin) || !isUnit(uDir) || !isUnit(vDir)) return null;
  if (Math.abs(dot(uDir, vDir)) > 1e-9) return null;
  const trim = readTrim(view, offset + 73);
  if (!trim) return null;
  return {
    kind: "plane",
    offset,
    origin,
    uDir,
    vDir,
    uMin: trim[0],
    vMin: trim[1],
    uMax: trim[2],
    vMax: trim[3],
  };
}

function readCylinder(view: DataView, offset: number, byteLength: number): CylinderPatch | null {
  if (offset + CYLINDER_BYTES > byteLength) return null;
  const origin = readVector(view, offset + 1);
  const xDir = readVector(view, offset + 25);
  const yDir = readVector(view, offset + 49);
  const zDir = readVector(view, offset + 73);
  if (!origin || !xDir || !yDir || !zDir) return null;
  if (!withinModel(origin) || !isUnit(xDir) || !isUnit(yDir) || !isUnit(zDir)) return null;
  if (Math.abs(dot(xDir, yDir)) > 1e-9) return null;
  // zDir must be the cross product of the other two: that is what separates a
  // cylinder from a plane whose trailing bytes happen to read as a basis.
  const cross = {
    x: xDir.y * yDir.z - xDir.z * yDir.y,
    y: xDir.z * yDir.x - xDir.x * yDir.z,
    z: xDir.x * yDir.y - xDir.y * yDir.x,
  };
  if (Math.abs(dot(cross, zDir) - 1) > 1e-6) return null;
  const radius = view.getFloat64(offset + 97, true);
  if (!Number.isFinite(radius) || radius <= 0 || radius > MAX_COORDINATE) return null;
  const trim = readTrim(view, offset + 105);
  if (!trim) return null;
  return {
    kind: "cylinder",
    offset,
    origin,
    xDir,
    yDir,
    zDir,
    radius,
    uMin: trim[0],
    vMin: trim[1],
    uMax: trim[2],
    vMax: trim[3],
  };
}

/**
 * Decode every analytic surface patch in one inflated page. Cylinders are
 * tested first because a cylinder's leading bytes also satisfy the weaker plane
 * checks.
 */
export function collectSurfaces(data: Uint8Array): SurfacePatch[] {
  const surfaces: SurfacePatch[] = [];
  if (data.byteLength < PLANE_BYTES) return surfaces;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  for (
    let offset = data.indexOf(0x01);
    offset >= 0 && offset + PLANE_BYTES <= data.byteLength;
    offset = data.indexOf(0x01, offset + 1)
  ) {
    const cylinder = readCylinder(view, offset, data.byteLength);
    if (cylinder) {
      surfaces.push(cylinder);
      offset += CYLINDER_BYTES - 1;
      continue;
    }
    const plane = readPlane(view, offset, data.byteLength);
    if (plane) {
      surfaces.push(plane);
      offset += PLANE_BYTES - 1;
    }
  }
  return surfaces;
}

/**
 * Decode surfaces and attribute each to the element that owns its blob, in one
 * pass: owner records and surface records are found in the same scan, and a
 * surface takes the id of the most recent owner record before it.
 */
export function collectOwnedSurfaces(data: Uint8Array): OwnedSurface[] {
  const owned: OwnedSurface[] = [];
  if (data.byteLength < PLANE_BYTES) return owned;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let owner = 0;

  for (let offset = 0; offset + PLANE_BYTES <= data.byteLength; ) {
    if (data[offset] === 0xff && matchesOwnerRecord(data, view, offset)) {
      owner = view.getUint32(offset + 10, true);
      offset += 18;
      continue;
    }
    if (data[offset] !== 0x01) {
      offset += 1;
      continue;
    }
    const cylinder = readCylinder(view, offset, data.byteLength);
    if (cylinder) {
      if (owner) owned.push({ owner, surface: cylinder });
      offset += CYLINDER_BYTES;
      continue;
    }
    const plane = readPlane(view, offset, data.byteLength);
    if (plane) {
      if (owner) owned.push({ owner, surface: plane });
      offset += PLANE_BYTES;
      continue;
    }
    offset += 1;
  }
  return owned;
}

function matchesOwnerRecord(data: Uint8Array, view: DataView, offset: number): boolean {
  if (offset + 18 > data.byteLength) return false;
  for (let index = 0; index < OWNER_RECORD.length; index += 1) {
    if (data[offset + index] !== OWNER_RECORD[index]) return false;
  }
  // A single-element owner record; the id follows as a 64-bit value.
  if (view.getUint32(offset + 6, true) !== 1) return false;
  if (view.getUint32(offset + 14, true) !== 0) return false;
  return view.getUint32(offset + 10, true) > 0;
}

export function summariseSurfaces(surfaces: Iterable<SurfacePatch>): SurfaceSummary {
  let planes = 0;
  let cylinders = 0;
  let verticalPlanes = 0;
  for (const surface of surfaces) {
    if (surface.kind === "cylinder") {
      cylinders += 1;
      continue;
    }
    planes += 1;
    if (Math.abs(Math.abs(surface.vDir.z) - 1) <= 1e-9) verticalPlanes += 1;
  }
  return { planes, cylinders, verticalPlanes };
}
