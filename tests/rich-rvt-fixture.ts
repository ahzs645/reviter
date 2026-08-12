/**
 * A synthetic Revit 2027 container rich enough to drive the dark half of the
 * conversion pipeline.
 *
 * `tests/convert-rvt-bytes.test.ts` builds a valid container, but its partition
 * pages hold nothing except duplicated-bounds records and category tokens — so
 * every counter downstream of the record decoder reads zero: no solids, no
 * placements, no sketch rings, no arcs, no materials, no parameters, no
 * relations. This module extends that fixture with the record shapes the
 * per-decoder tests already prove are valid, laid out as whole inflated pages:
 *
 *  | page                | record shapes                | decoder |
 *  | ------------------- | ---------------------------- | ------- |
 *  | `boundsPage`        | duplicated bounds + category tokens | `bounds-records.ts`, `native-categories.ts` |
 *  | `framedObjectPage`  | length/echo-framed objects, one holding a bounds sub-record and one a 300-byte instance placement | `element-objects.ts`, `instanced-geometry.ts` |
 *  | `planeTriplePage`   | owner record + trimmed plane triples at the 105-byte stride | `surfaces.ts`, `native-geometry.ts` |
 *  | `cylinderTriplePage`| owner record + cylinder triples at the 137-byte stride | `native-geometry.ts` (`wallArcsFor`) |
 *  | `sketchCurvePage`   | owner record + line/arc edge records at the 84-byte stride | `sketch-curves.ts` |
 *  | `materialPage`      | framed `MaterialElem` records with UTF-16 names | `material-records.ts` |
 *  | `parameterPage`     | owner anchor + parameter table | `element-parameters.ts` |
 *  | `typeNamePage`      | `0x1104` type-name slot | `element-types.ts` |
 *  | `typeReferencePage` | `0x116f` field slot and the zero run behind it | `element-types.ts` |
 *  | `framedObjectsPage` | frames carrying a host id and an associated-level id | `host-relations.ts`, `level-relations.ts` |
 *  | `persistedTextPage` | UTF-16 text holding a retained DWG name | `cad-files.ts` |
 *
 * Every byte layout here is lifted from the test that already asserts that
 * decoder reads it — `tests/reviter-regression.test.ts`, `tests/tail-placement.test.ts`,
 * `tests/window-shape.test.ts`, `tests/material-records.test.ts`,
 * `tests/host-relations.test.ts`, `tests/level-relations.test.ts` — rather than
 * reverse-engineered a second time.
 *
 * **Checked against a real model.** The field-presence profile of the records
 * this produces was compared with the one the supplied 70 MB UNBC project
 * produces through the same entry point. Every record field the real file
 * yields is yielded here too, at a smaller population, except the three that
 * need decoders this fixture has no container-level fixture for: `familyId` and
 * `familyName` (persisted family definitions) and the four stair fields that
 * come from the framed `StairsRun` aggregate rather than from the curves.
 *
 * The builder is parameterised rather than hard-coded: every page is optional
 * and every population is a list, so a test can reduce the model to the one
 * route it is about — see the last test in
 * `tests/convert-rvt-bytes-rich.test.ts`, which drops the curves and then the
 * placements to show the counters follow the file rather than the pipeline.
 */
import CFB from "cfb";
import { deflateSync } from "fflate";

import {
  REVIT_PAGE_CHECKSUM_BYTES,
  REVIT_PAGE_PAYLOAD_BYTES,
} from "../lib/reviter/revit-container.ts";

/** Revit's canonical chunk header: gzip magic, no flags, no optional fields. */
const GZIP_HEADER = [0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0x0b] as const;

/** Filler for stored-page checksum tails and inter-chunk padding. */
export const FILLER_BYTE = 0xa5;

/** `ff ff ff ff 10 03 [u32 1][u32 owner][u32 0]` — the per-element blob anchor. */
const OWNER_ANCHOR_BYTES = 18;

export const PLANE_BYTES = 105;
export const CYLINDER_BYTES = 137;
export const CURVE_STRIDE = 84;

/** Object framing: payload of `objectLength`, then 16 bytes, then the echo. */
const OBJECT_TRAILER_BYTES = 20;

/** `readInstancePlacement` takes the simple path only at exactly this length. */
const INSTANCE_OBJECT_LENGTH = 300;

export const CATEGORY = {
  walls: -2_000_011,
  doors: -2_000_023,
  floors: -2_000_032,
  roofs: -2_000_035,
  ceilings: -2_000_038,
  columns: -2_000_100,
  stairs: -2_000_120,
  railings: -2_000_126,
  curtainPanels: -2_000_170,
  ramps: -2_000_180,
  stairsRuns: -2_000_919,
  stairsLandings: -2_000_920,
} as const;

export type Box = {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
};

export type BoundsElement = {
  elementId: number;
  categoryId: number | null;
  recordCode: number;
  recordCount?: number;
  box: Box;
  /** Second copy of the envelope, when the two written copies disagree. */
  alternateBox?: Box;
};

// ---------------------------------------------------------------------------
// Primitive record writers
// ---------------------------------------------------------------------------

function put(view: DataView, offset: number, values: readonly number[]): void {
  for (const [index, value] of values.entries()) {
    view.setFloat64(offset + index * 8, value, true);
  }
}

/** The 18-byte owner anchor both the surface and the curve scans key off. */
export function writeOwnerAnchor(
  data: Uint8Array,
  view: DataView,
  offset: number,
  ownerId: number,
): number {
  data.set([0xff, 0xff, 0xff, 0xff, 0x10, 0x03], offset);
  view.setUint32(offset + 6, 1, true);
  view.setUint32(offset + 10, ownerId, true);
  view.setUint32(offset + 14, 0, true);
  return offset + OWNER_ANCHOR_BYTES;
}

/**
 * One duplicated-bounds record, exactly as `bounds-records.ts` reads it. When
 * `objectLength` is given the same bytes are also a length/echo-framed element
 * object, which is how the file writes them and what makes the record reachable
 * as a shared local shape.
 */
export function writeBoundsRecord(
  data: Uint8Array,
  offset: number,
  element: BoundsElement,
  objectLength?: number,
): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = element.recordCount ?? 1;
  view.setUint32(offset, element.elementId, true);
  view.setUint32(offset + 4, 0, true);
  if (objectLength != null) view.setUint32(offset + 12, objectLength, true);
  view.setUint16(offset + 16, 0x08c6, true);
  view.setUint32(offset + 18, element.recordCode, true);
  view.setUint32(offset + 22, 0, true);
  view.setUint32(offset + 26, element.elementId, true);
  view.setUint32(offset + 30, 0, true);
  view.setUint32(offset + 34, 0x0008_8004, true);
  view.setUint32(offset + 38, count, true);
  view.setUint32(offset + 42, 3, true);
  const boundsStart = offset + 42 + count * 6;
  put(view, boundsStart, [...element.box.min, ...element.box.max]);
  const second = element.alternateBox ?? element.box;
  put(view, boundsStart + 48, [...second.min, ...second.max]);
  return boundsStart + 96;
}

/** Bytes one bounds record occupies, for a given field-table length. */
export function boundsRecordBytes(recordCount = 1): number {
  return 42 + recordCount * 6 + 96;
}

/** One `BuiltInCategory` token, attributed to the nearest preceding record. */
export function writeCategoryToken(
  data: Uint8Array,
  offset: number,
  categoryId: number,
): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  data[offset] = 0x04;
  data[offset + 1] = 0x00;
  view.setUint32(offset + 2, 1, true);
  view.setUint32(offset + 6, categoryId + 0x1_0000_0000, true);
  view.setUint32(offset + 10, 0xffff_ffff, true);
  view.setUint32(offset + 14, 0xffff_ffff, true);
  return offset + 18;
}

export const CATEGORY_TOKEN_BYTES = 18;

/** A trimmed analytic plane: `surfaces.ts` reads `origin`, `uDir`, `vDir`, trim. */
export function writePlane(
  data: Uint8Array,
  offset: number,
  plane: {
    origin: readonly [number, number, number];
    uDir: readonly [number, number, number];
    vDir: readonly [number, number, number];
    trim: readonly [number, number, number, number];
  },
): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  data[offset] = 0x01;
  put(view, offset + 1, plane.origin);
  put(view, offset + 25, plane.uDir);
  put(view, offset + 49, plane.vDir);
  put(view, offset + 73, plane.trim);
  return offset + PLANE_BYTES;
}

/** A trimmed cylinder; `zDir` must be `xDir x yDir` or the read is refused. */
export function writeCylinder(
  data: Uint8Array,
  offset: number,
  cylinder: {
    origin: readonly [number, number, number];
    xDir: readonly [number, number, number];
    yDir: readonly [number, number, number];
    zDir: readonly [number, number, number];
    radius: number;
    trim: readonly [number, number, number, number];
  },
): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  data[offset] = 0x01;
  put(view, offset + 1, cylinder.origin);
  put(view, offset + 25, cylinder.xDir);
  put(view, offset + 49, cylinder.yDir);
  put(view, offset + 73, cylinder.zDir);
  view.setFloat64(offset + 97, cylinder.radius, true);
  put(view, offset + 105, cylinder.trim);
  return offset + CYLINDER_BYTES;
}

/** One straight sketch edge, in the 84-byte line form. */
export function writeLineCurve(
  data: Uint8Array,
  offset: number,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  data.set([0x04, 0x00, 0x08, 0x01], offset);
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dy, dz);
  put(view, offset + 4, [
    0,
    length,
    from[0],
    from[1],
    from[2],
    dx / length,
    dy / length,
    dz / length,
  ]);
  return offset + CURVE_STRIDE;
}

/** A framed element object header; the caller fills the payload and the echo. */
export function writeObjectFrame(
  data: Uint8Array,
  offset: number,
  object: {
    elementId: number;
    objectLength: number;
    marker: number;
    typeCode?: number;
    discriminator?: number;
  },
): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  view.setUint32(offset, object.elementId, true);
  view.setUint32(offset + 4, 0, true);
  view.setUint32(offset + 8, object.discriminator ?? 0x1234_5678, true);
  view.setUint32(offset + 12, object.objectLength, true);
  view.setUint16(offset + 16, object.marker, true);
  view.setUint32(offset + 18, object.typeCode ?? 0, true);
  view.setUint32(offset + object.objectLength + 16, object.objectLength, true);
  return offset + object.objectLength + OBJECT_TRAILER_BYTES;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** Duplicated-bounds records, each followed by its own category token. */
export function boundsPage(elements: readonly BoundsElement[]): Uint8Array {
  const size = elements.reduce(
    (total, element) =>
      total +
      boundsRecordBytes(element.recordCount ?? 1) +
      (element.categoryId == null ? 0 : CATEGORY_TOKEN_BYTES),
    0,
  );
  const page = new Uint8Array(size);
  let cursor = 0;
  for (const element of elements) {
    cursor = writeBoundsRecord(page, cursor, element);
    if (element.categoryId != null) {
      cursor = writeCategoryToken(page, cursor, element.categoryId);
    }
  }
  return page;
}

export type ShapeSpec = {
  /** Element id of the shared geometry object; a placement's `geometryId`. */
  shapeId: number;
  localBox: Box;
  /** Category token written beside the shape record, if any. */
  categoryId?: number | null;
};

export type PlacementSpec = {
  elementId: number;
  /** Row-major 3x3; the columns are the local axes. */
  basis: readonly number[];
  origin: readonly [number, number, number];
  geometryId: number;
  categoryId?: number | null;
  /** Persisted `InsertableInst.m_hostId`, at the primary field offset. */
  hostId?: number;
};

export const IDENTITY_BASIS = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;
/** A quarter turn about z, which distinguishes columns-as-axes from rows. */
export const QUARTER_TURN_BASIS = [0, -1, 0, 1, 0, 0, 0, 0, 1] as const;

/**
 * A chain of length/echo-framed objects: the shared shapes first, then the
 * instances that point at them.
 *
 * The chain is contiguous, which is what lets `chainElementObjects` reach an
 * instance object from a shape object's seed — the shape markers are always
 * seeded, an instance marker only is where the file carries enough of them.
 */
export function framedObjectPage(
  shapes: readonly ShapeSpec[],
  placements: readonly PlacementSpec[],
): Uint8Array {
  const SHAPE_OBJECT_LENGTH = 176;
  const size =
    shapes.length * (SHAPE_OBJECT_LENGTH + OBJECT_TRAILER_BYTES) +
    placements.length * (INSTANCE_OBJECT_LENGTH + OBJECT_TRAILER_BYTES) +
    (shapes.length + placements.length) * CATEGORY_TOKEN_BYTES +
    64;
  const page = new Uint8Array(size);
  const view = new DataView(page.buffer);
  let cursor = 0;
  const tokens: { ownerId: number; categoryId: number }[] = [];

  for (const shape of shapes) {
    // The shape object *is* a duplicated-bounds record: same tag, same family
    // word. That is how the file writes a cached family shape, and it is what
    // makes `readLocalBounds` answer for it.
    writeBoundsRecord(
      page,
      cursor,
      {
        elementId: shape.shapeId,
        categoryId: shape.categoryId ?? null,
        recordCode: 71,
        box: shape.localBox,
      },
      SHAPE_OBJECT_LENGTH,
    );
    cursor = writeObjectFrame(page, cursor, {
      elementId: shape.shapeId,
      objectLength: SHAPE_OBJECT_LENGTH,
      marker: 0x08c6,
      typeCode: 71,
    });
    if (shape.categoryId != null) {
      tokens.push({ ownerId: shape.shapeId, categoryId: shape.categoryId });
    }
  }

  for (const placement of placements) {
    const start = cursor;
    const end = start + INSTANCE_OBJECT_LENGTH;
    if (placement.hostId != null) {
      // `InsertableInst.m_hostId`, at the primary field offset host-relations
      // reads; the zero word behind it is part of that field's 64-bit form.
      view.setUint32(start + 151, placement.hostId, true);
      view.setUint32(start + 155, 0, true);
    }
    put(view, end - 96, placement.basis);
    put(view, end - 24, placement.origin);
    // The first trailer word is the shared geometry object's element id.
    view.setUint32(end, placement.geometryId, true);
    view.setUint32(end + 4, 0, true);
    cursor = writeObjectFrame(page, start, {
      elementId: placement.elementId,
      objectLength: INSTANCE_OBJECT_LENGTH,
      marker: 0x07ef,
      typeCode: 30,
    });
    if (placement.categoryId != null) {
      tokens.push({ ownerId: placement.elementId, categoryId: placement.categoryId });
    }
  }

  // Category tokens go after the chain so they cannot land inside an object's
  // payload and disturb its framing; `native-categories.ts` attributes each to
  // the nearest preceding `[u32 id][u32 0]` pair, so the owner is restated
  // immediately in front of its own token.
  for (const token of tokens) {
    view.setUint32(cursor, token.ownerId, true);
    view.setUint32(cursor + 4, 0, true);
    cursor = writeCategoryToken(page, cursor + 8, token.categoryId);
  }
  return page.subarray(0, Math.max(cursor, 138));
}

export type WallSolidSpec = {
  elementId: number;
  origin: readonly [number, number, number];
  /** Unit direction of the location line. */
  uDir: readonly [number, number];
  lengthFeet: number;
  heightFeet: number;
  thicknessFeet: number;
};

/**
 * One owner anchor per element, then that element's centre plane and its two
 * face planes at the 105-byte stride `wallSolidsFor` requires.
 */
export function planeTriplePage(walls: readonly WallSolidSpec[]): Uint8Array {
  const page = new Uint8Array(
    walls.length * (OWNER_ANCHOR_BYTES + 3 * PLANE_BYTES) + 8,
  );
  let cursor = 0;
  const view = new DataView(page.buffer);
  for (const wall of walls) {
    cursor = writeOwnerAnchor(page, view, cursor, wall.elementId);
    // The face planes sit half a thickness either side along the in-plane
    // normal `uDir x vDir`, with `vDir` up.
    const nx = -wall.uDir[1];
    const ny = wall.uDir[0];
    const half = wall.thicknessFeet / 2;
    const trim = [0, 0, wall.lengthFeet, wall.heightFeet] as const;
    for (const sideways of [0, -half, half]) {
      cursor = writePlane(page, cursor, {
        origin: [
          wall.origin[0] + nx * sideways,
          wall.origin[1] + ny * sideways,
          wall.origin[2],
        ],
        uDir: [wall.uDir[0], wall.uDir[1], 0],
        vDir: [0, 0, 1],
        trim,
      });
    }
  }
  return page;
}

/** A single trimmed plane per element: a face with no triple, so a face hull. */
export function loneFacePage(
  faces: readonly {
    elementId: number;
    origin: readonly [number, number, number];
    uDir: readonly [number, number, number];
    vDir: readonly [number, number, number];
    trim: readonly [number, number, number, number];
  }[],
): Uint8Array {
  const page = new Uint8Array(
    faces.length * (OWNER_ANCHOR_BYTES + PLANE_BYTES) + 8,
  );
  const view = new DataView(page.buffer);
  let cursor = 0;
  for (const face of faces) {
    cursor = writeOwnerAnchor(page, view, cursor, face.elementId);
    cursor = writePlane(page, cursor, face);
  }
  return page;
}

export type CurvedWallSpec = {
  elementId: number;
  centre: readonly [number, number, number];
  radius: number;
  thicknessFeet: number;
  startAngle: number;
  endAngle: number;
  heightFeet: number;
};

/** A curved wall's centre cylinder and its two face cylinders, at stride 137. */
export function cylinderTriplePage(walls: readonly CurvedWallSpec[]): Uint8Array {
  const page = new Uint8Array(
    walls.length * (OWNER_ANCHOR_BYTES + 3 * CYLINDER_BYTES) + 8,
  );
  const view = new DataView(page.buffer);
  let cursor = 0;
  for (const wall of walls) {
    cursor = writeOwnerAnchor(page, view, cursor, wall.elementId);
    const half = wall.thicknessFeet / 2;
    for (const radius of [wall.radius, wall.radius - half, wall.radius + half]) {
      cursor = writeCylinder(page, cursor, {
        origin: wall.centre,
        xDir: [1, 0, 0],
        yDir: [0, 1, 0],
        zDir: [0, 0, 1],
        radius,
        trim: [wall.startAngle, 0, wall.endAngle, wall.heightFeet],
      });
    }
  }
  return page;
}

export type SketchRingSpec = {
  ownerId: number;
  /** Plan ring, walked in order; the page writes each edge once. */
  ring: readonly (readonly [number, number])[];
  elevation: number;
  /** Extra edges filed under the same owner, e.g. a stair's riser lines. */
  extraEdges?: readonly (readonly [
    readonly [number, number, number],
    readonly [number, number, number],
  ])[];
};

/** Owner anchor, then that element's boundary edges at the 84-byte stride. */
export function sketchCurvePage(rings: readonly SketchRingSpec[]): Uint8Array {
  const edges = rings.reduce(
    (total, spec) => total + spec.ring.length + (spec.extraEdges?.length ?? 0),
    0,
  );
  const page = new Uint8Array(
    rings.length * OWNER_ANCHOR_BYTES + edges * CURVE_STRIDE + 8,
  );
  const view = new DataView(page.buffer);
  let cursor = 0;
  for (const spec of rings) {
    cursor = writeOwnerAnchor(page, view, cursor, spec.ownerId);
    for (const [index, corner] of spec.ring.entries()) {
      const next = spec.ring[(index + 1) % spec.ring.length]!;
      cursor = writeLineCurve(
        page,
        cursor,
        [corner[0], corner[1], spec.elevation],
        [next[0], next[1], spec.elevation],
      );
    }
    for (const [from, to] of spec.extraEdges ?? []) {
      cursor = writeLineCurve(page, cursor, from, to);
    }
  }
  return page;
}

/**
 * A page carrying UTF-16 text, which is how a persisted DWG name survives an
 * import whose source file is gone. `cad-files.ts` looks for the `.dwg` suffix
 * in UTF-16 before decoding anything, so the page is written as UTF-16 outright.
 */
export function persistedTextPage(values: readonly string[]): Uint8Array {
  const text = values.map((value) => `${value}`).join("");
  const page = new Uint8Array(text.length * 2 + 8);
  const view = new DataView(page.buffer);
  for (let index = 0; index < text.length; index += 1) {
    view.setUint16(index * 2, text.charCodeAt(index), true);
  }
  return page;
}

export type MaterialSpec = { elementId: number; name: string };

const MATERIAL_NAME_TRAILER = [0xff, 0xff, 0xff, 0xff, 0xe0, 0x0c] as const;

function writeUtf16(
  data: Uint8Array,
  view: DataView,
  offset: number,
  value: string,
  trailer = false,
): number {
  view.setUint32(offset, value.length, true);
  for (let index = 0; index < value.length; index += 1) {
    view.setUint16(offset + 4 + index * 2, value.charCodeAt(index), true);
  }
  const end = offset + 4 + value.length * 2;
  if (trailer) data.set(MATERIAL_NAME_TRAILER, end);
  return end + (trailer ? MATERIAL_NAME_TRAILER.length : 0);
}

/** Framed `MaterialElem` objects carrying an appearance string then a name. */
export function materialPage(materials: readonly MaterialSpec[]): Uint8Array {
  const OBJECT_LENGTH = 320;
  const stride = OBJECT_LENGTH + OBJECT_TRAILER_BYTES;
  const page = new Uint8Array(materials.length * stride + 8);
  const view = new DataView(page.buffer);
  let cursor = 0;
  for (const material of materials) {
    writeUtf16(page, view, cursor + 56, "assetlibrary_base.fbx");
    writeUtf16(page, view, cursor + 140, material.name, true);
    cursor = writeObjectFrame(page, cursor, {
      elementId: material.elementId,
      objectLength: OBJECT_LENGTH,
      // `REVIT_2027_MATERIAL_ELEMENT_MARKER`, restated here so the fixture does
      // not import a decoder constant it is meant to exercise independently.
      marker: 0x0ad3,
      typeCode: 0,
    });
  }
  return page;
}

export type ParameterSpec = {
  elementId: number;
  parameters: readonly (readonly [number, number])[];
};

/** The owner anchor a parameter table hangs off, then the table itself. */
export function parameterPage(tables: readonly ParameterSpec[]): Uint8Array {
  const size = tables.reduce(
    (total, table) => total + 32 + 4 + table.parameters.length * 16 + 16,
    0,
  );
  const page = new Uint8Array(size + 8);
  const view = new DataView(page.buffer);
  let cursor = 0;
  for (const table of tables) {
    cursor += 8;
    page.set([0xff, 0xff, 0xff, 0xff, 0x10, 0x03, 0x01, 0x00, 0x00, 0x00], cursor);
    view.setUint32(cursor + 10, table.elementId, true);
    view.setUint32(cursor + 14, 0, true);
    const at = cursor + 24;
    view.setUint32(at, table.parameters.length, true);
    for (const [index, [id, value]] of table.parameters.entries()) {
      view.setUint32(at + 4 + index * 16, id + 0x1_0000_0000, true);
      view.setUint32(at + 8 + index * 16, 0xffff_ffff, true);
      view.setFloat64(at + 12 + index * 16, value, true);
    }
    cursor = at + 4 + table.parameters.length * 16 + 16;
  }
  return page;
}

export type TypeNameSpec = { typeId: number; name: string };

/** A type element's own record, with its name behind the `0x1104` field slot. */
export function typeNamePage(types: readonly TypeNameSpec[]): Uint8Array {
  const size = types.reduce((total, type) => total + 64 + type.name.length * 2 + 8, 0);
  const page = new Uint8Array(size + 8);
  const view = new DataView(page.buffer);
  let cursor = 0;
  for (const type of types) {
    view.setUint32(cursor, type.typeId, true);
    view.setUint32(cursor + 4, 0, true);
    view.setUint32(cursor + 8, 0x1234_5678, true);
    view.setUint32(cursor + 12, 0x9abc_def0, true);
    view.setUint16(cursor + 16, 0x0f3b, true);
    view.setUint32(cursor + 18, 0xffff_ffff, true);
    view.setUint16(cursor + 22, 0x0c93, true);
    page.set([0xff, 0xff, 0xff, 0xff, 0x04, 0x11], cursor + 28);
    view.setUint32(cursor + 34, type.name.length, true);
    for (let index = 0; index < type.name.length; index += 1) {
      view.setUint16(cursor + 38 + index * 2, type.name.charCodeAt(index), true);
    }
    cursor += 64 + type.name.length * 2 + 8;
  }
  return page;
}

/**
 * Category tokens for elements whose record is synthesised rather than written.
 *
 * A token is attributed to the nearest preceding `[u32 id][u32 0]` pair, so a
 * page of bare id/token pairs names elements the file gave no record of its own.
 */
export function categoryTokenPage(
  tokens: readonly { elementId: number; categoryId: number }[],
): Uint8Array {
  const page = new Uint8Array(tokens.length * (8 + CATEGORY_TOKEN_BYTES) + 8);
  const view = new DataView(page.buffer);
  let cursor = 0;
  for (const token of tokens) {
    view.setUint32(cursor, token.elementId, true);
    view.setUint32(cursor + 4, 0, true);
    cursor = writeCategoryToken(page, cursor + 8, token.categoryId);
  }
  return page;
}

export type FramedObjectSpec = {
  elementId: number;
  objectLength: number;
  marker: number;
  typeCode?: number;
  /** `u32` fields written at offsets relative to the object's own start. */
  fields?: readonly (readonly [number, number])[];
};

/**
 * A contiguous run of length/echo-framed objects with nothing in them but the
 * frame and a few named fields.
 *
 * This is what the persisted relationship scanners read: an associated-level id
 * sits at a fixed offset inside a `0x0f3b` frame, and the level it names is
 * recognised by its own object's marker. Both are field reads within a proven
 * frame, so the frame is all this has to supply.
 */
export function framedObjectsPage(
  objects: readonly FramedObjectSpec[],
): Uint8Array {
  const size = objects.reduce(
    (total, object) => total + object.objectLength + OBJECT_TRAILER_BYTES,
    0,
  );
  const page = new Uint8Array(size + 8);
  const view = new DataView(page.buffer);
  let cursor = 0;
  for (const object of objects) {
    const start = cursor;
    cursor = writeObjectFrame(page, start, object);
    for (const [offset, value] of object.fields ?? []) {
      view.setUint32(start + offset, value, true);
      view.setUint32(start + offset + 4, 0, true);
    }
  }
  return page;
}

export type TypeReferenceSpec = { elementId: number; typeId: number };

/**
 * An element record carrying its type reference behind the `0x116f` field slot.
 *
 * `element-types.ts` finds the id where the zero run after the slot's index list
 * ends, rather than at a fixed pad, so the page writes the run explicitly.
 */
export function typeReferencePage(
  references: readonly TypeReferenceSpec[],
): Uint8Array {
  const STRIDE = 96;
  const page = new Uint8Array(references.length * STRIDE + 8);
  const view = new DataView(page.buffer);
  for (const [index, reference] of references.entries()) {
    const at = index * STRIDE;
    view.setUint32(at, reference.elementId, true);
    view.setUint32(at + 4, 0, true);
    view.setUint32(at + 8, 0x1234_5678, true);
    // The word at +14 spans the pad and discriminator A; a non-zero value here
    // is what stops the `0x116f` slot below being read as a record head of its
    // own, since that candidate's `+4` would have to be zero.
    view.setUint16(at + 16, 0x0c93, true);
    view.setUint32(at + 18, 0xffff_ffff, true);
    view.setUint16(at + 22, 0x0c93, true);
    page.set([0xff, 0xff, 0xff, 0xff, 0x6f, 0x11], at + 28);
    view.setUint32(at + 34, 0, true); // no index entries
    // Eight zero bytes, then the id where the run ends.
    view.setUint32(at + 50, reference.typeId, true);
    view.setUint32(at + 54, 0, true);
  }
  return page;
}

// ---------------------------------------------------------------------------
// Container assembly
// ---------------------------------------------------------------------------

/** A Revit chunk: the canonical gzip header and a raw DEFLATE body, no trailer. */
export function gzipChunk(payload: Uint8Array): Uint8Array {
  const body = deflateSync(payload, { level: 9 });
  const chunk = new Uint8Array(GZIP_HEADER.length + body.length);
  chunk.set(GZIP_HEADER, 0);
  chunk.set(body, GZIP_HEADER.length);
  return chunk;
}

/** Insert the stored-page checksum tails `stripRevitPageChecksums` removes. */
export function withPageChecksums(payload: Uint8Array): Uint8Array {
  const fullPages = Math.floor((payload.length - 1) / REVIT_PAGE_PAYLOAD_BYTES);
  if (fullPages < 1) return payload;
  const stored = new Uint8Array(payload.length + fullPages * REVIT_PAGE_CHECKSUM_BYTES);
  stored.fill(FILLER_BYTE);
  for (let page = 0; page * REVIT_PAGE_PAYLOAD_BYTES < payload.length; page += 1) {
    const from = page * REVIT_PAGE_PAYLOAD_BYTES;
    stored.set(
      payload.subarray(from, from + REVIT_PAGE_PAYLOAD_BYTES),
      from + page * REVIT_PAGE_CHECKSUM_BYTES,
    );
  }
  return stored;
}

/**
 * Concatenate chunks into one partition payload. `straddleAt` places the
 * following chunk so its DEFLATE body crosses a stored page boundary, which is
 * unreadable unless the page tails are stripped first.
 */
export function partitionPayload(
  chunks: readonly Uint8Array[],
  straddleIndex: number | null = null,
): Uint8Array {
  const straddleAt = REVIT_PAGE_PAYLOAD_BYTES - 12;
  const pieces: { at: number; bytes: Uint8Array }[] = [];
  let cursor = 0;
  for (const [index, chunk] of chunks.entries()) {
    if (index === straddleIndex && cursor <= straddleAt) cursor = straddleAt;
    pieces.push({ at: cursor, bytes: chunk });
    cursor += chunk.length;
  }
  const payload = new Uint8Array(cursor);
  payload.fill(FILLER_BYTE);
  for (const piece of pieces) payload.set(piece.bytes, piece.at);
  return payload;
}

/** `BasicFileInfo` version 13, carrying the release as UTF-16LE text. */
export function basicFileInfo(release: string): Uint8Array {
  const data = new Uint8Array(24);
  new DataView(data.buffer).setUint32(0, 13, true);
  data.set([0x04, 0, 0, 0], 8);
  for (let index = 0; index < release.length; index += 1) {
    new DataView(data.buffer).setUint16(12 + index * 2, release.charCodeAt(index), true);
  }
  return data;
}

/** `Global/ElemTable` in the 2024-2027 layout both readers agree on. */
export function elemTable(
  rows: readonly { elementId: number; ownerId: number | null }[],
): Uint8Array {
  const data = new Uint8Array(34 + rows.length * 40 + 36);
  const view = new DataView(data.buffer);
  view.setUint32(0, rows.length, true);
  view.setUint32(2, rows.length + 1, true);
  for (const [index, row] of rows.entries()) {
    const offset = 34 + index * 40;
    view.setBigUint64(
      offset,
      row.ownerId == null ? 0xffff_ffff_ffff_ffffn : BigInt(row.ownerId),
      true,
    );
    view.setUint32(offset + 8, 0, true);
    view.setBigUint64(offset + 12, BigInt(row.elementId), true);
    view.setBigUint64(offset + 32, BigInt(row.elementId), true);
  }
  return data;
}

/** `Global/PartitionTable`: `u32` character counts and UTF-16LE names. */
export function partitionTable(names: readonly string[]): Uint8Array {
  const data = new Uint8Array(names.reduce((total, name) => total + 4 + name.length * 2, 0));
  const view = new DataView(data.buffer);
  let cursor = 0;
  for (const name of names) {
    view.setUint32(cursor, name.length, true);
    for (let index = 0; index < name.length; index += 1) {
      view.setUint16(cursor + 4 + index * 2, name.charCodeAt(index), true);
    }
    cursor += 4 + name.length * 2;
  }
  return data;
}

/** `Formats/Latest`: one tagged class and the parent it references. */
export function formatsLatest(name: string, tag: number, parent: string): Uint8Array {
  const parentOffset = 2 + name.length + 4;
  const parentEnd = parentOffset + 2 + parent.length;
  const data = new Uint8Array(parentEnd + 10);
  const view = new DataView(data.buffer);
  view.setUint16(0, name.length, true);
  for (let index = 0; index < name.length; index += 1) data[2 + index] = name.charCodeAt(index);
  view.setUint16(2 + name.length, 0x8000 | tag, true);
  view.setUint16(parentOffset, parent.length, true);
  for (let index = 0; index < parent.length; index += 1) {
    data[parentOffset + 2 + index] = parent.charCodeAt(index);
  }
  view.setUint16(parentEnd, tag, true);
  view.setUint32(parentEnd + 2, 7, true);
  view.setUint32(parentEnd + 6, 3, true);
  return data;
}

export function container(
  streams: readonly { path: string; bytes: Uint8Array }[],
): Uint8Array {
  const built = CFB.utils.cfb_new();
  for (const { path, bytes } of streams) CFB.utils.cfb_add(built, path, Array.from(bytes));
  return new Uint8Array(CFB.write(built, { type: "buffer" }) as Uint8Array);
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/**
 * A complete synthetic Revit 2027 model, as a set of populations rather than a
 * byte layout.
 *
 * Every field is a list so the model can be reduced — a test that wants only
 * the placement path drops the rest — and so the same composer can be driven
 * from a randomised generator. `richSpec()` is the instance the committed test
 * pins; it is sized to reach a branch rather than to look like a building.
 */

export type ModelSpec = {
  release?: string | null;
  boundsA: BoundsElement[];
  boundsB: BoundsElement[];
  shapes: ShapeSpec[];
  placements: PlacementSpec[];
  wallSolids: WallSolidSpec[];
  /**
   * A second plane-triple page. The two lists exist so the solids land on two
   * different chunks, which the page walk treats as independent: the surface
   * owner is reset at every page boundary, so a triple that only works when it
   * shares a page with another element's would not survive here.
   */
  extraWallSolids: WallSolidSpec[];
  curvedWalls: CurvedWallSpec[];
  faces: Parameters<typeof loneFacePage>[0];
  rings: SketchRingSpec[];
  materials: MaterialSpec[];
  parameters: ParameterSpec[];
  typeNames: TypeNameSpec[];
  typeReferences: TypeReferenceSpec[];
  persistedCadNames: string[];
  partAtomXml: string | null;
  relationObjects: FramedObjectSpec[];
  extraTokens: { elementId: number; categoryId: number }[];
  bulkFloors: number;
  datumPileRecords: number;
  ownership: { elementId: number; ownerId: number | null }[];
  partitionNames: string[];
  /** Index of the Sheet0 chunk placed across a stored-page boundary. */
  straddleIndex: number | null;
  /** Chunks to keep in Sheet0; the rest go to Sheet1. */
  sheetSplit: number;
  includeSchema: boolean;
  includeElemTable: boolean;
  includePartitionTable: boolean;
};

export function buildModel(spec: ModelSpec): Uint8Array {
  const pages: Uint8Array[] = [];
  if (spec.boundsA.length) pages.push(boundsPage(spec.boundsA));
  if (spec.shapes.length || spec.placements.length) {
    pages.push(framedObjectPage(spec.shapes, spec.placements));
  }
  if (spec.wallSolids.length) pages.push(planeTriplePage(spec.wallSolids));
  if (spec.extraWallSolids.length) pages.push(planeTriplePage(spec.extraWallSolids));
  if (spec.curvedWalls.length) pages.push(cylinderTriplePage(spec.curvedWalls));
  if (spec.rings.length) pages.push(sketchCurvePage(spec.rings));
  if (spec.faces.length) pages.push(loneFacePage(spec.faces));
  if (spec.boundsB.length) pages.push(boundsPage(spec.boundsB));
  if (spec.materials.length) pages.push(materialPage(spec.materials));
  if (spec.parameters.length) pages.push(parameterPage(spec.parameters));
  if (spec.typeNames.length) pages.push(typeNamePage(spec.typeNames));
  if (spec.typeReferences.length) pages.push(typeReferencePage(spec.typeReferences));
  if (spec.relationObjects.length) pages.push(framedObjectsPage(spec.relationObjects));
  if (spec.extraTokens.length) pages.push(categoryTokenPage(spec.extraTokens));
  if (spec.persistedCadNames.length) pages.push(persistedTextPage(spec.persistedCadNames));
  if (spec.bulkFloors || spec.datumPileRecords) {
    pages.push(boundsPage(bulkRecords(spec.bulkFloors, spec.datumPileRecords)));
  }

  const chunks = pages.map(gzipChunk);
  const split = Math.min(Math.max(spec.sheetSplit, 1), chunks.length);
  const first = chunks.slice(0, split);
  const second = chunks.slice(split);

  const streams: { path: string; bytes: Uint8Array }[] = [];
  if (spec.release != null) {
    streams.push({ path: "/BasicFileInfo", bytes: basicFileInfo(spec.release) });
  }
  if (spec.includeElemTable && spec.ownership.length) {
    streams.push({
      path: "/Global/ElemTable",
      bytes: gzipChunk(elemTable(spec.ownership)),
    });
  }
  if (spec.includePartitionTable && spec.partitionNames.length) {
    streams.push({
      path: "/Global/PartitionTable",
      bytes: gzipChunk(partitionTable(spec.partitionNames)),
    });
  }
  if (spec.partAtomXml) {
    streams.push({
      path: "/PartAtom",
      bytes: new TextEncoder().encode(spec.partAtomXml),
    });
  }
  if (spec.includeSchema) {
    streams.push({
      path: "/Formats/Latest",
      bytes: gzipChunk(formatsLatest("Wall", 1_234, "Element")),
    });
  }
  streams.push({
    path: "/Partitions/Sheet0",
    bytes: withPageChecksums(partitionPayload(first, spec.straddleIndex)),
  });
  if (second.length) {
    streams.push({
      path: "/Partitions/Sheet1",
      bytes: withPageChecksums(partitionPayload(second, null)),
    });
  }
  return container(streams);
}

/**
 * A population large enough to cross the three thresholds that only exist for
 * real models: the robust framing quantile (500 records), the datum-pile
 * removal (500 records and a 50 ft span) and the modal sketch thickness (8
 * samples per category).
 */
function bulkRecords(floors: number, datumPile: number): BoundsElement[] {
  const records: BoundsElement[] = [];
  for (let index = 0; index < floors; index += 1) {
    const x = 400 + (index % 20) * 12;
    const y = 400 + Math.floor(index / 20) * 12;
    // Two thicknesses, so the mode is a majority rather than the only value.
    const thickness = index % 5 === 0 ? 0.4 : 0.6562;
    records.push({
      elementId: 100_000 + index,
      categoryId: CATEGORY.floors,
      recordCode: 80,
      box: { min: [x, y, 0], max: [x + 10, y + 10, thickness] },
    });
  }
  for (let index = 0; index < datumPile; index += 1) {
    records.push({
      elementId: 200_000 + index,
      categoryId: CATEGORY.curtainPanels,
      recordCode: 81,
      box: { min: [-0.5, -0.5, 0], max: [0.5, 0.5, 3 + index * 0.01] },
    });
  }
  return records;
}

/** Half a wall thickness, and the plan run of a 20 ft wall at 45 degrees. */
const HALF = 0.5 * Math.SQRT1_2;
const JOIN_RUN = 20 * Math.SQRT1_2;
/** Where the mitred corner lands: past anything a square end could reach. */
const JOIN_MITRE_X = JOIN_RUN + 0.5 + 2 * HALF;

/**
 * A five-tread straight flight, in the representation `stair-treads.ts` reads:
 * six riser lines each written three times, and five short rising segments
 * whose depth and rise the lattice is solved from.
 */
function stairRunEdges(): (readonly [
  readonly [number, number, number],
  readonly [number, number, number],
])[] {
  const edges: (readonly [
    readonly [number, number, number],
    readonly [number, number, number],
  ])[] = [];
  for (let riser = 0; riser <= 5; riser += 1) {
    for (let copy = 0; copy < 3; copy += 1) {
      edges.push([[400, 400 + riser, 0], [404, 400 + riser, 0]] as const);
    }
  }
  for (let tread = 0; tread < 5; tread += 1) {
    edges.push([
      [402, 400 + tread, tread * 0.6],
      [402, 401 + tread, (tread + 1) * 0.6],
    ] as const);
  }
  return edges;
}

/**
 * The diagonal mullion's own frame: its long axis runs from the panel's top
 * edge to its bottom-right corner, so the columns of this basis are that axis,
 * the profile normal to it, and the panel depth.
 */
const MULLION_HALF = Math.hypot(1.5, 3);
const MULLION_BASIS = [
  3 / MULLION_HALF, 0, 1.5 / MULLION_HALF,
  0, -1, 0,
  1.5 / MULLION_HALF, 0, -3 / MULLION_HALF,
] as const;

/** The optional family-metadata stream, in the Atom form the reader expects. */
const PART_ATOM_XML = `<entry xmlns="http://www.w3.org/2005/Atom" xmlns:A="urn:schemas-autodesk-com:partatom">
  <title>Synthetic Family</title>
  <id>urn:family:synthetic</id>
  <updated>2026-08-12T00:00:00Z</updated>
  <category><term>Specialty Equipment</term><scheme>adsk:revit:grouping</scheme></category>
  <A:family type="user">
    <A:variationCount>1</A:variationCount>
    <A:part type="user"><title>SYN-1</title></A:part>
  </A:family>
</entry>`;

const box = (
  min: readonly [number, number, number],
  max: readonly [number, number, number],
) => ({ min, max });

/** The canonical enriched model: every page type present, every counter fed. */
export function richSpec(): ModelSpec {
  return {
    release: "2027",
    boundsA: [
      { elementId: 1_049, categoryId: CATEGORY.walls, recordCode: 61, box: box([10, 20, 0], [40, 21, 10]) },
      { elementId: 2_048, categoryId: CATEGORY.walls, recordCode: 62, box: box([10, 20, 0], [11, 60, 10]) },
      { elementId: 4_096, categoryId: CATEGORY.floors, recordCode: 63, box: box([10, 20, -0.75], [40, 60, 0]) },
      { elementId: 8_192, categoryId: CATEGORY.ceilings, recordCode: 64, box: box([10, 20, 10], [40, 60, 10.75]) },
      // A curved wall: its arc comes from the cylinder triple below.
      { elementId: 30_003, categoryId: CATEGORY.walls, recordCode: 67, box: box([50, 20, 0], [70, 40, 10]) },
      // A floor whose own ring is written under its own id.
      { elementId: 50_001, categoryId: CATEGORY.floors, recordCode: 68, box: box([0, 0, -0.75], [20, 12, 0]) },
      // A stair run and the companion record filed one id above it.
      { elementId: 55_000, categoryId: CATEGORY.stairsRuns, recordCode: 69, box: box([80, 0, 0], [90, 12, 20]) },
      { elementId: 55_001, categoryId: null, recordCode: 169_671, recordCount: 1, box: box([80, 0, 0], [90, 12, 10]) },
      // A placed instance whose oriented box lands near, but not on, its own
      // record: the agreement tolerance is what decides.
      { elementId: 44_000, categoryId: CATEGORY.columns, recordCode: 73, box: box([199.4, 49.4, 0.4], [201.4, 51.4, 8.4]) },
      // Faces that cap the element above and below, so the facet band narrows.
      { elementId: 45_000, categoryId: CATEGORY.columns, recordCode: 74, box: box([300, 0, 0], [310, 10, 20]) },
      // No category token: its ring has to earn its place against the record.
      { elementId: 53_000, categoryId: null, recordCode: 75, box: box([100, 0, -0.5], [120, 12, 0]) },
      // A railing, whose path is filed one id above it.
      { elementId: 57_000, categoryId: CATEGORY.railings, recordCode: 76, box: box([0, 200, 0], [20, 200.5, 3.609]) },
      // A solid shorter than the joined envelope its record records.
      { elementId: 61_000, categoryId: CATEGORY.walls, recordCode: 77, box: box([0, 300, 0], [40, 301, 10]) },
      // A solid taller than its own record: the band is clipped down.
      { elementId: 62_000, categoryId: CATEGORY.walls, recordCode: 78, box: box([0, 320, 0], [30, 321, 5]) },
      // A solid sharing no point with its record at all: disowned outright.
      { elementId: 63_000, categoryId: CATEGORY.walls, recordCode: 79, box: box([0, 340, 0], [10, 341, 10]) },
      // A straight flight, whose treads are its own repeated riser lines.
      { elementId: 56_000, categoryId: CATEGORY.stairsRuns, recordCode: 84, box: box([400, 400, 0], [404, 405, 3]) },
      // Two walls meeting at 45 degrees. The mitred end is what puts the
      // envelope's extreme corner where a square end cannot reach it.
      {
        elementId: 66_000,
        categoryId: CATEGORY.walls,
        recordCode: 85,
        box: box([700 - HALF, 700 - HALF, 0], [700 + JOIN_MITRE_X, 700 + JOIN_RUN + 0.5, 10]),
      },
      {
        elementId: 67_000,
        categoryId: CATEGORY.walls,
        recordCode: 86,
        box: box([700 + JOIN_RUN, 700 + JOIN_RUN - 0.5, 0], [716 + JOIN_RUN, 700 + JOIN_RUN + 0.5, 10]),
      },
      // An angled run whose envelope solves as a shorter rectangle.
      { elementId: 64_000, categoryId: CATEGORY.walls, recordCode: 82, box: box([-0.3536, 359.6464, 0], [13.0815, 373.0815, 10]) },
    ],
    boundsB: [
      { elementId: 16_384, categoryId: CATEGORY.columns, recordCode: 65, box: box([30, 50, 0], [31.5, 51.5, 10]) },
      { elementId: 20_480, categoryId: CATEGORY.roofs, recordCode: 66, box: box([10, 20, 10.75], [40, 60, 12]) },
      // Two copies that disagree, so the tighter-volume branch is taken.
      {
        elementId: 21_500,
        categoryId: CATEGORY.roofs,
        recordCode: 70,
        box: box([0, 0, 20], [30, 30, 22]),
        alternateBox: box([0, 0, 20], [10, 10, 21]),
      },
      // A curtain panel whose own faces are inside its own envelope.
      { elementId: 72_000, categoryId: CATEGORY.curtainPanels, recordCode: 87, box: box([800.4, 799.9, 0.4], [803.6, 800.1, 5.6]) },
      // A door with no shape of its own, so its leaf comes from the host wall.
      { elementId: 65_000, categoryId: CATEGORY.doors, recordCode: 83, box: box([16, 19.5, 0], [19, 21.5, 7]) },
      // A door, so the door-leaf pass has a categorised door to work on.
      { elementId: 41_000, categoryId: CATEGORY.doors, recordCode: 72, box: box([12, 20, 0], [15, 21, 7]) },
    ],
    shapes: [
      { shapeId: 40_001, localBox: box([-1, -0.5, 0], [1, 0.5, 4]), categoryId: null },
      { shapeId: 42_001, localBox: box([-1.5, -0.2, 0], [1.5, 3.8937, 7.628]), categoryId: null },
      { shapeId: 44_001, localBox: box([-1, -1, 0], [1, 1, 8]), categoryId: null },
      // A curtain panel and the diagonal mullion that cuts its corner, in the
      // local frames `curtain-panel-boundary.ts`'s own test uses.
      { shapeId: 70_001, localBox: box([-2, -0.05, -3], [2, 0.05, 3]), categoryId: null },
      {
        shapeId: 71_001,
        localBox: box([-0.08, -0.1, -MULLION_HALF], [0.08, 0.1, MULLION_HALF]),
        categoryId: null,
      },
    ],
    placements: [
      {
        elementId: 40_002,
        basis: QUARTER_TURN_BASIS,
        origin: [100, 40, 0],
        geometryId: 40_001,
        categoryId: CATEGORY.columns,
      },
      {
        elementId: 41_000,
        basis: IDENTITY_BASIS,
        origin: [13.5, 20.5, 0],
        geometryId: 42_001,
        categoryId: null,
        hostId: 40_001,
      },
      {
        elementId: 44_000,
        basis: IDENTITY_BASIS,
        origin: [200, 50, 0],
        geometryId: 44_001,
        categoryId: null,
      },
      {
        elementId: 70_000,
        basis: IDENTITY_BASIS,
        origin: [802, 800, 3],
        geometryId: 70_001,
        categoryId: CATEGORY.curtainPanels,
      },
      {
        elementId: 71_000,
        basis: MULLION_BASIS,
        origin: [802.5, 800, 3],
        geometryId: 71_001,
        categoryId: -2_000_171,
      },
    ],
    wallSolids: [
      // No bounds record of its own: this is the `solidOnlyElements` route.
      {
        elementId: 30_001,
        origin: [0, 100, 0],
        uDir: [1, 0],
        lengthFeet: 25,
        heightFeet: 10,
        thicknessFeet: 1,
      },
      // A wall that also has a record, so the clip/extend passes have both.
      {
        elementId: 1_049,
        origin: [10, 20.5, 0],
        uDir: [1, 0],
        lengthFeet: 32,
        heightFeet: 10,
        thicknessFeet: 1,
      },
    ],
    extraWallSolids: [
      { elementId: 61_000, origin: [5, 300.5, 0], uDir: [1, 0], lengthFeet: 30, heightFeet: 10, thicknessFeet: 1 },
      { elementId: 62_000, origin: [0, 320.5, 0], uDir: [1, 0], lengthFeet: 30, heightFeet: 12, thicknessFeet: 1 },
      { elementId: 63_000, origin: [500, 500, 0], uDir: [1, 0], lengthFeet: 20, heightFeet: 10, thicknessFeet: 1 },
      {
        elementId: 66_000,
        origin: [700, 700, 0],
        uDir: [Math.SQRT1_2, Math.SQRT1_2],
        lengthFeet: 20,
        heightFeet: 10,
        thicknessFeet: 1,
      },
      {
        elementId: 67_000,
        origin: [700 + JOIN_RUN, 700 + JOIN_RUN, 0],
        uDir: [1, 0],
        lengthFeet: 16,
        heightFeet: 10,
        thicknessFeet: 1,
      },
      // A plane triple whose faces are 25 ft apart: past the fitted half
      // thickness, so the census records the refusal rather than a solid.
      {
        elementId: 68_000,
        origin: [0, 380, 0],
        uDir: [1, 0],
        lengthFeet: 20,
        heightFeet: 10,
        thicknessFeet: 25,
      },
      {
        elementId: 64_000,
        origin: [0, 360, 0],
        uDir: [Math.SQRT1_2, Math.SQRT1_2],
        lengthFeet: 20,
        heightFeet: 10,
        thicknessFeet: 1,
      },
    ],
    curvedWalls: [
      {
        elementId: 30_003,
        centre: [60, 30, 0],
        radius: 10,
        thicknessFeet: 0.66,
        startAngle: 0,
        endAngle: Math.PI / 2,
        heightFeet: 10,
      },
    ],
    faces: [
      {
        elementId: 30_002,
        origin: [200, 200, 3],
        uDir: [1, 0, 0],
        vDir: [0, 1, 0],
        trim: [0, 0, 8, 6],
      },
      // A cap below and a cap above, on an element whose record is taller.
      {
        elementId: 45_000,
        origin: [300, 0, 5],
        uDir: [0, 1, 0],
        vDir: [1, 0, 0],
        trim: [0, 0, 10, 10],
      },
      {
        elementId: 45_000,
        origin: [300, 0, 15],
        uDir: [1, 0, 0],
        vDir: [0, 1, 0],
        trim: [0, 0, 10, 10],
      },
      // Two faces inside a curtain panel's own box, which is the evidence
      // `curtainPanelSurfaceQuads` is collected from. They belong to a second
      // panel so the first stays a pure placement with no record of its own.
      {
        elementId: 72_000,
        origin: [800.5, 800, 0.5],
        uDir: [1, 0, 0],
        vDir: [0, 0, 1],
        trim: [0, 0, 3, 5],
      },
      {
        elementId: 72_000,
        origin: [800.5, 800.02, 0.5],
        uDir: [1, 0, 0],
        vDir: [0, 0, 1],
        trim: [0, 0, 3, 5],
      },
      // One horizontal face and no record: a flat sketch hull to be completed.
      {
        elementId: 58_000,
        origin: [600, 600, 4],
        uDir: [1, 0, 0],
        vDir: [0, 1, 0],
        trim: [0, 0, 15, 9],
      },
    ],
    rings: [
      {
        ownerId: 50_001,
        ring: [[0, 0], [20, 0], [20, 12], [0, 12]],
        elevation: 0,
      },
      // Within the plan tolerance of its own record, but not exactly on it, so
      // the unnamed-sketch gate is what admits the ring.
      {
        ownerId: 53_000,
        ring: [[100.02, 0.02], [119.98, 0.02], [119.98, 11.98], [100.02, 11.98]],
        elevation: -0.25,
      },
      // A level rail path, filed one id above the railing that carries it.
      {
        ownerId: 57_001,
        ring: [[0, 200], [20, 200], [20, 200.5], [0, 200.5]],
        elevation: 0,
      },
      // The facet hull's own ring, which outranks the hull and supplies the
      // elevations the ring itself does not carry.
      {
        ownerId: 58_000,
        ring: [[600, 600], [615, 600], [615, 609], [600, 609]],
        elevation: 4,
      },
      // A straight flight written the way the file writes one: each riser line
      // repeated, and one short rising segment per tread between them.
      {
        ownerId: 56_000,
        ring: [],
        elevation: 0,
        extraEdges: stairRunEdges(),
      },
      // A ramp with no record of its own: the ring-synthesis route.
      {
        ownerId: 52_000,
        ring: [[40, 80], [60, 80], [60, 92], [40, 92]],
        elevation: 0,
      },
      // The stair run's own treads, as repeated riser lines.
      {
        ownerId: 55_000,
        ring: [[80, 0], [90, 0], [90, 12], [80, 12]],
        elevation: 0,
        extraEdges: Array.from({ length: 8 }, (_, index) => [
          [80, 1.5 * (index + 1), 1.25 * (index + 1)] as const,
          [90, 1.5 * (index + 1), 1.25 * (index + 1)] as const,
        ] as const),
      },
    ],
    relationObjects: [
      // A Level, recognised by its own object marker, and the elements naming
      // it. A level needs twenty members before it is reported as a storey, so
      // the members are the first of the bulk floors rather than one token
      // element — which is also what puts the relations path, rather than the
      // z-histogram fallback, in charge of `levels`.
      { elementId: 47_000, objectLength: 96, marker: 0x0a19 },
      { elementId: 46_000, objectLength: 120, marker: 0x0f3b, fields: [[70, 47_000]] },
      ...Array.from({ length: 24 }, (_, index) => ({
        elementId: 100_000 + index,
        objectLength: 120,
        marker: 0x0f3b,
        fields: [[70, 47_000]] as const,
      })),
    ],
    extraTokens: [{ elementId: 58_000, categoryId: CATEGORY.floors }],
    persistedCadNames: ["\u0001Building 10 - Teaching Centre - L3.DWG\u0002site-plan.dwg\u0000"],
    partAtomXml: PART_ATOM_XML,
    bulkFloors: 520,
    datumPileRecords: 12,
    materials: [
      { elementId: 60_001, name: "Paint - Sienna" },
      { elementId: 60_002, name: "Concrete - Cast In Situ" },
    ],
    parameters: [
      { elementId: 1_049, parameters: [[-1_001_105, 13.123359580052492], [-1_001_108, -0.65616797900262]] },
      { elementId: 4_096, parameters: [[-1_001_105, 9.5]] },
    ],
    typeNames: [
      { typeId: 609_157, name: "Interior Wall - 120mm" },
      { typeId: 609_158, name: "Generic Floor - 200mm" },
    ],
    typeReferences: [
      { elementId: 1_049, typeId: 609_157 },
      { elementId: 2_048, typeId: 609_157 },
      { elementId: 4_096, typeId: 609_158 },
    ],
    ownership: [
      { elementId: 1_049, ownerId: null },
      { elementId: 2_048, ownerId: null },
      { elementId: 4_096, ownerId: 1_049 },
      { elementId: 8_192, ownerId: 1_049 },
      { elementId: 16_384, ownerId: null },
      { elementId: 20_480, ownerId: 16_384 },
      { elementId: 30_001, ownerId: 1_049 },
      { elementId: 30_003, ownerId: 1_049 },
      { elementId: 40_002, ownerId: 16_384 },
      { elementId: 50_001, ownerId: null },
      { elementId: 52_000, ownerId: 50_001 },
      { elementId: 55_000, ownerId: null },
    ],
    partitionNames: ["Workset1", "Shared Levels and Grids"],
    straddleIndex: 1,
    sheetSplit: 6,
    includeSchema: true,
    includeElemTable: true,
    includePartitionTable: true,
  };
}

export function richModel(): Uint8Array {
  return buildModel(richSpec());
}
