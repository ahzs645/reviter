/**
 * End-to-end coverage for `convertRvtBytes`, the library's entry point.
 *
 * Every other test in this suite imports one decoder and feeds it a synthetic
 * byte stream. Nothing assembled them. This file builds a real OLE/CFB
 * container in memory — checksum-paged streams, truncated-gzip chunk framing,
 * duplicated-bounds element records, `BuiltInCategory` tokens, the element
 * table and the release stream — and drives the whole pipeline over it, so a
 * staging mistake in `convert.ts` fails here rather than in production.
 *
 * ## What this reaches
 *
 * Both success branches of the function, and all three ways it can refuse: an
 * unreadable container, a container with no partition stream, and a container
 * that opened but yielded no geometry.
 *
 * With the Revit 2027 release gate satisfied from `BasicFileInfo` the
 * conversion takes the `partition-bounds-recovery` branch and every progress
 * stage fires. Reached and asserted:
 *
 *  - container open and release selection (`BasicFileInfo`, and the
 *    `options.revitVersion` override that bypasses it);
 *  - `Global/ElemTable` — the element index *and* the persisted ownership graph;
 *  - `Global/PartitionTable` and `Formats/Latest` stream summaries;
 *  - stored-page checksum stripping, gzip chunk framing and chunk inflation
 *    across two partition streams — one chunk body deliberately straddles a
 *    stored page boundary, so it is unreadable unless the page tails are
 *    stripped first (the test proves that separately);
 *  - duplicated-bounds element records and category-token ownership;
 *  - the datum-pile, cached-shape and non-scene record filters — they must
 *    keep these records, and the `stats` counters say they did;
 *  - display selection, mesh batching, framing origin, level bands, `stats`
 *    and `decoderCoverage`.
 *
 * Without a release the same pipeline falls through to the diagnostic
 * `partition-coordinate-recovery` branch, which is asserted from its own
 * coordinate fixture.
 *
 * ## What this does NOT reach
 *
 * These stages run but decode nothing here, because a faithful fixture for
 * them is out of reach at this size. Their outputs are asserted as empty, which
 * pins the plumbing but not the decoders — each of those has its own unit test:
 *
 *  - native 2027 BRep/mesh collection, stairs runs and split alternate frames;
 *  - instance placements, local shapes, surfaces, sketch curves and rebuilt
 *    solids, so oriented boxes, swept railings, curved walls, stair treads,
 *    door leaves and curtain panels are all zero;
 *  - materials, compound structures, family/symbol relations, host relations
 *    and associated-level relations;
 *  - `Global/History` native identity (`decodeRevitDocumentHistory` demands an
 *    exact episode table this fixture does not build), `TransmissionData`,
 *    `PartAtom`/`ProjectInformation`, element parameters and persisted DWG
 *    names.
 *
 * `lib/reviter/index.ts`, where `convertRvtBytes` is re-exported, cannot be
 * imported here: it uses extensionless relative specifiers, which Node's type
 * stripping does not resolve. The implementation module is imported directly.
 */
import assert from "node:assert/strict";
import test from "node:test";

import CFB from "cfb";
import { deflateSync } from "fflate";

import { convertRvtBytes } from "../lib/reviter/convert.ts";
import { formatsLatest } from "./rich-rvt-fixture.ts";
import {
  gzipOffsets,
  inflateRevitChunk,
  REVIT_PAGE_CHECKSUM_BYTES,
  REVIT_PAGE_PAYLOAD_BYTES,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";
import type {
  ConvertFailure,
  ConvertOptions,
  ConvertResult,
  ProgressUpdate,
} from "../lib/reviter/types.ts";

/** Revit's canonical chunk header: gzip magic, no flags, no optional fields. */
const GZIP_HEADER = [0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0x0b] as const;

/** Filler for stored-page checksum tails and inter-chunk padding. */
const FILLER_BYTE = 0xa5;

/** Bytes one element contributes to an inflated page: record plus its token. */
const BOUNDS_RECORD_BYTES = 144;
const CATEGORY_TOKEN_BYTES = 18;
const ELEMENT_PAGE_BYTES = BOUNDS_RECORD_BYTES + CATEGORY_TOKEN_BYTES;

/**
 * Non-empty CFB *streams* the writer contributes on its own: the default stream
 * `cfb_new` seeds every container with. The root storage also reports a
 * non-zero size — the mini-stream it holds — but it is a storage, not a stream,
 * and is no longer counted.
 */
const CONTAINER_OWN_STREAMS = 1;

type Box = { min: readonly [number, number, number]; max: readonly [number, number, number] };

type Element = {
  elementId: number;
  categoryId: number;
  categoryName: string;
  recordCode: number;
  /** Partition stream this element's record is written into. */
  stream: string;
  box: Box;
};

/**
 * One Revit 2027 duplicated-bounds record, laid out as `bounds-records.ts`
 * reads it: the element id, the `0x08c6` tag sixteen bytes in, the id again,
 * the constant family word, a one-entry field table, and the six-`f64`
 * envelope written twice. Returns the offset just past the record.
 */
function writeBoundsRecord(page: Uint8Array, offset: number, element: Element): number {
  const view = new DataView(page.buffer, page.byteOffset, page.byteLength);
  view.setUint32(offset, element.elementId, true);
  view.setUint32(offset + 4, 0, true);
  view.setUint16(offset + 16, 0x08c6, true);
  view.setUint32(offset + 18, element.recordCode, true);
  view.setUint32(offset + 22, 0, true);
  view.setUint32(offset + 26, element.elementId, true);
  view.setUint32(offset + 30, 0, true);
  view.setUint32(offset + 34, 0x0008_8004, true);
  view.setUint32(offset + 38, 1, true); // one field-table entry
  view.setUint32(offset + 42, 3, true);
  const boundsStart = offset + 42 + 1 * 6;
  const values = [...element.box.min, ...element.box.max];
  for (const copy of [0, 48]) {
    for (const [index, value] of values.entries()) {
      view.setFloat64(boundsStart + copy + index * 8, value, true);
    }
  }
  return boundsStart + 96;
}

/**
 * One `BuiltInCategory` token: `04 00`, a discriminator, the negative category
 * id as an `i64`, and the all-ones terminator. `native-categories.ts` attributes
 * it to the nearest preceding `u32` element id followed by a zero word, which is
 * the head of the record written immediately in front of it.
 */
function writeCategoryToken(page: Uint8Array, offset: number, categoryId: number): number {
  const view = new DataView(page.buffer, page.byteOffset, page.byteLength);
  page[offset] = 0x04;
  page[offset + 1] = 0x00;
  view.setUint32(offset + 2, 1, true);
  view.setUint32(offset + 6, categoryId + 0x1_0000_0000, true);
  view.setUint32(offset + 10, 0xffff_ffff, true);
  view.setUint32(offset + 14, 0xffff_ffff, true);
  return offset + 18;
}

/** An inflated partition page holding each element's record and its category. */
function partitionPage(elements: readonly Element[]): Uint8Array {
  const page = new Uint8Array(elements.length * ELEMENT_PAGE_BYTES);
  let cursor = 0;
  for (const element of elements) {
    cursor = writeBoundsRecord(page, cursor, element);
    cursor = writeCategoryToken(page, cursor, element.categoryId);
  }
  assert.equal(cursor, page.length, "element page layout is not the size it claims");
  return page;
}

/** A Revit chunk: the canonical gzip header and a raw DEFLATE body, no trailer. */
function gzipChunk(payload: Uint8Array): Uint8Array {
  const body = deflateSync(payload, { level: 9 });
  const chunk = new Uint8Array(GZIP_HEADER.length + body.length);
  chunk.set(GZIP_HEADER, 0);
  chunk.set(body, GZIP_HEADER.length);
  return chunk;
}

/**
 * Insert the stored-page checksum tails `stripRevitPageChecksums` removes, so
 * the stream on disk is paged the way Revit writes it. Only complete pages
 * carry a tail; the trailing partial page is stored as-is.
 */
function withPageChecksums(payload: Uint8Array): Uint8Array {
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

/** `BasicFileInfo` version 13, carrying the release as UTF-16LE text. */
function basicFileInfo(release: string): Uint8Array {
  const data = new Uint8Array(24);
  new DataView(data.buffer).setUint32(0, 13, true);
  data.set([0x04, 0, 0, 0], 8);
  data.set(new Uint8Array(Buffer.from(release, "utf16le")), 12);
  return data;
}

/**
 * `Global/ElemTable` in the 2024–2027 layout both readers agree on: a declared
 * count at offset 2, 40-byte rows of `[u64 owner][u32 0][u64 elementId]` from
 * offset 34, and a 36-byte suffix. The first two rows must be roots, because
 * their all-ones owner words are the stride markers `detectElemTableLayout`
 * measures the row pitch from.
 */
function elemTable(rows: readonly { elementId: number; ownerId: number | null }[]): Uint8Array {
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
function partitionTable(names: readonly string[]): Uint8Array {
  const data = new Uint8Array(names.reduce((total, name) => total + 4 + name.length * 2, 0));
  const view = new DataView(data.buffer);
  let cursor = 0;
  for (const name of names) {
    view.setUint32(cursor, name.length, true);
    data.set(new Uint8Array(Buffer.from(name, "utf16le")), cursor + 4);
    cursor += 4 + name.length * 2;
  }
  return data;
}

const SHEET_0 = "Partitions/Sheet0";
const SHEET_1 = "Partitions/Sheet1";

const WALL_A: Element = {
  elementId: 1_049,
  categoryId: -2_000_011,
  categoryName: "Walls",
  recordCode: 61,
  stream: SHEET_0,
  box: { min: [10, 20, 0], max: [40, 21, 10] },
};
const WALL_B: Element = {
  elementId: 2_048,
  categoryId: -2_000_011,
  categoryName: "Walls",
  recordCode: 62,
  stream: SHEET_0,
  box: { min: [10, 20, 0], max: [11, 60, 10] },
};
const FLOOR: Element = {
  elementId: 4_096,
  categoryId: -2_000_032,
  categoryName: "Floors",
  recordCode: 63,
  stream: SHEET_0,
  box: { min: [10, 20, -0.75], max: [40, 60, 0] },
};
/** Written into the chunk whose DEFLATE body straddles a stored page boundary. */
const CEILING: Element = {
  elementId: 8_192,
  categoryId: -2_000_038,
  categoryName: "Ceilings",
  recordCode: 64,
  stream: SHEET_0,
  box: { min: [10, 20, 10], max: [40, 60, 10.75] },
};
const COLUMN: Element = {
  elementId: 16_384,
  categoryId: -2_000_100,
  categoryName: "Columns",
  recordCode: 65,
  stream: SHEET_1,
  box: { min: [30, 50, 0], max: [31.5, 51.5, 10] },
};
const ROOF: Element = {
  elementId: 20_480,
  categoryId: -2_000_035,
  categoryName: "Roofs",
  recordCode: 66,
  stream: SHEET_1,
  box: { min: [10, 20, 10.75], max: [40, 60, 12] },
};

const LEADING_ELEMENTS = [WALL_A, WALL_B, FLOOR] as const;
const STRADDLING_ELEMENTS = [CEILING] as const;
const SECOND_PARTITION_ELEMENTS = [COLUMN, ROOF] as const;
const ALL_ELEMENTS = [
  ...LEADING_ELEMENTS,
  ...STRADDLING_ELEMENTS,
  ...SECOND_PARTITION_ELEMENTS,
] as const;

/**
 * Where the first partition's second chunk starts, in checksum-free payload
 * bytes.
 *
 * Twelve bytes short of the first stored page's payload, so the chunk's
 * ten-byte gzip header ends two bytes into its DEFLATE body and the 353-byte
 * checksum tail lands inside that body. A conversion that skipped the page
 * tails would still *find* this chunk — the signature is intact and in the
 * clear — but could not read it, so `CEILING` reaching `elementBounds` is
 * evidence that the container layer is wired in, not merely called.
 */
const STRADDLING_CHUNK_OFFSET = REVIT_PAGE_PAYLOAD_BYTES - 12;

function firstPartitionPayload(): Uint8Array {
  const leading = gzipChunk(partitionPage(LEADING_ELEMENTS));
  assert.ok(leading.length <= STRADDLING_CHUNK_OFFSET);
  const straddling = gzipChunk(partitionPage(STRADDLING_ELEMENTS));
  const payload = new Uint8Array(STRADDLING_CHUNK_OFFSET + straddling.length);
  payload.fill(FILLER_BYTE, leading.length, STRADDLING_CHUNK_OFFSET);
  payload.set(leading, 0);
  payload.set(straddling, STRADDLING_CHUNK_OFFSET);
  return payload;
}

function container(streams: readonly { path: string; bytes: Uint8Array }[]): Uint8Array {
  const built = CFB.utils.cfb_new();
  for (const { path, bytes } of streams) CFB.utils.cfb_add(built, path, Array.from(bytes));
  return new Uint8Array(CFB.write(built, { type: "buffer" }) as Uint8Array);
}

/** The complete synthetic Revit 2027 model the positive assertions run against. */
function syntheticModel(): Uint8Array {
  return container([
    { path: "/BasicFileInfo", bytes: basicFileInfo("2027") },
    {
      path: "/Global/ElemTable",
      bytes: gzipChunk(elemTable([
        // The first two rows are roots; the rest hang off them, which is what
        // gives the ownership decoder three relations to report.
        { elementId: WALL_A.elementId, ownerId: null },
        { elementId: WALL_B.elementId, ownerId: null },
        { elementId: FLOOR.elementId, ownerId: WALL_A.elementId },
        { elementId: CEILING.elementId, ownerId: WALL_A.elementId },
        { elementId: COLUMN.elementId, ownerId: null },
        { elementId: ROOF.elementId, ownerId: COLUMN.elementId },
      ])),
    },
    {
      path: "/Global/PartitionTable",
      bytes: gzipChunk(partitionTable(["Workset1", "Shared Levels and Grids"])),
    },
    { path: "/Formats/Latest", bytes: gzipChunk(formatsLatest("Wall", "Element", "Floor")) },
    { path: `/${SHEET_0}`, bytes: withPageChecksums(firstPartitionPayload()) },
    { path: `/${SHEET_1}`, bytes: gzipChunk(partitionPage(SECOND_PARTITION_ELEMENTS)) },
  ]);
}

/** A container whose partitions carry a closed plan outline at two elevations. */
function coordinateOnlyModel(): Uint8Array {
  const corners = [[0, 0], [40, 0], [40, 30], [0, 30]] as const;
  const segments: number[][] = [];
  for (const elevation of [0, 12]) {
    for (const [index, corner] of corners.entries()) {
      const next = corners[(index + 1) % corners.length]!;
      segments.push([corner[0], corner[1], elevation, next[0], next[1], elevation]);
    }
  }
  const page = new Uint8Array(segments.length * 48);
  const view = new DataView(page.buffer);
  for (const [index, segment] of segments.entries()) {
    for (const [axis, value] of segment.entries()) {
      view.setFloat64(index * 48 + axis * 8, value, true);
    }
  }
  return container([{ path: `/${SHEET_0}`, bytes: gzipChunk(page) }]);
}

function converted(
  bytes: Uint8Array,
  fileName = "synthetic.rvt",
  options: ConvertOptions = {},
): ConvertResult {
  const outcome = convertRvtBytes(bytes, fileName, options);
  if (!outcome.ok) assert.fail(`expected a conversion, got: ${outcome.error}`);
  return outcome;
}

function refused(
  bytes: Uint8Array,
  fileName = "synthetic.rvt",
  options: ConvertOptions = {},
): ConvertFailure {
  const outcome = convertRvtBytes(bytes, fileName, options);
  if (outcome.ok) assert.fail("expected the conversion to be refused");
  return outcome;
}

function progressOf(bytes: Uint8Array, fileName: string): ProgressUpdate[] {
  const updates: ProgressUpdate[] = [];
  const outcome = convertRvtBytes(bytes, fileName, {}, (update) => updates.push(update));
  assert.equal(outcome.ok, true);
  return updates;
}

test("a synthetic Revit 2027 container converts to a bounds-recovered scene", () => {
  const bytes = syntheticModel();
  const result = converted(bytes, "synthetic.rvt");

  assert.equal(result.fileName, "synthetic.rvt");
  assert.equal(result.byteLength, bytes.byteLength);
  assert.equal(result.method, "partition-bounds-recovery");

  // Identity end to end: every element written into the container comes back
  // with the id, category and envelope it was given, attributed to the stream
  // it was written into.
  assert.deepEqual(
    result.elementBounds.map((record) => ({
      elementId: record.elementId,
      categoryId: record.categoryId,
      categoryName: record.categoryName,
      categorySource: record.categorySource,
      recordCode: record.recordCode,
      stream: record.stream,
      boundsFeet: record.boundsFeet,
    })),
    ALL_ELEMENTS.map((element) => ({
      elementId: element.elementId,
      categoryId: element.categoryId,
      categoryName: element.categoryName,
      categorySource: "native-token",
      recordCode: element.recordCode,
      stream: element.stream,
      boundsFeet: {
        min: { x: element.box.min[0], y: element.box.min[1], z: element.box.min[2] },
        max: { x: element.box.max[0], y: element.box.max[1], z: element.box.max[2] },
      },
    })),
  );

  // The scene is framed on the envelopes the fixture supplied: the plan centre
  // of the model and the lowest recorded elevation.
  assert.deepEqual(result.origin, { x: 25, y: 40, z: -0.75 });
  assert.deepEqual(result.bbox, {
    min: { x: -15, y: -20, z: 0 },
    max: { x: 15, y: 20, z: 12.75 },
  });
  // Four level bands, clustered out of the same six envelopes: the floor's
  // underside, the slab and wall bases, the wall tops, and the roof.
  assert.deepEqual(
    result.levels.map((level) => level.elevation),
    [-0.5, 0, 10, 11],
  );
});

test("the counters agree with what the container was given", () => {
  const result = converted(syntheticModel());

  // Pinned as a whole rather than field by field. Every one of these is
  // accumulated in a function-scope binding hundreds of lines before it is
  // read, which is exactly what a stage split has to carry across a boundary
  // intact; a partial assertion would let the untested half drift.
  const { durationMs, ...counters } = result.stats;
  assert.ok(durationMs >= 0);
  assert.deepEqual(counters, {
    streamCount: 6 + CONTAINER_OWN_STREAMS,
    partitionStreams: 2,
    gzipChunks: 3,
    inflatedBytes: ALL_ELEMENTS.length * ELEMENT_PAGE_BYTES,
    candidatesFound: ALL_ELEMENTS.length,
    candidatesFocused: ALL_ELEMENTS.length,
    candidatesUsed: ALL_ELEMENTS.length,
    // Six axis-aligned boxes: eight corners and twelve triangles each.
    vertexCount: ALL_ELEMENTS.length * 8,
    triangleCount: ALL_ELEMENTS.length * 12,
    // One batch per display group; the two walls share theirs.
    meshCount: 5,
    boundsRecordsFound: ALL_ELEMENTS.length,
    solidBoundsRecords: ALL_ELEMENTS.length,
    elementObjects: 0,
    parameterElements: 0,
    surfaces: { planes: 0, cylinders: 0, verticalPlanes: 0 },
    nativeSolids: 0,
    faceOnlyElements: 0,
    placedInstances: 0,
    rejectedOrientedBoxes: 0,
    // No record may be dropped as a cached family shape, a datum pile, or an
    // unplaced definition; every envelope the fixture wrote is a scene element.
    cachedShapeRecords: 0,
    unplacedRecords: 0,
    sketchBoundaryElements: 0,
    sketchBoundedFacetHulls: 0,
    completedFlatSketches: 0,
    sweptRailings: 0,
    curvedWalls: 0,
    inferredCurtainPanels: 0,
    doorLeaves: 0,
    doorLeavesFromShape: 0,
    adoptedStairBoxes: 0,
    clippedSolids: 0,
    extendedSolids: 0,
    recoveredWallJoinEnds: 0,
    shrunkSolids: 0,
    narrowedSolidBands: 0,
    disownedSolids: 0,
    narrowedFacetBands: 0,
    unnamedSketchElements: 0,
    sketchCurves: 0,
    solidOnlyElements: 0,
    instanceOnlyElements: 0,
    // Every record carries a decoded category, so none is drawn unclassified.
    unclassifiedElements: 0,
    typedElements: 0,
    namedTypeElements: 0,
    elementObjectMarker: undefined,
    fittedLimitsReached: [],
  });

  assert.equal(result.meshes.length, counters.meshCount);
  assert.equal(
    result.meshes.reduce((total, mesh) => total + mesh.positions.length / 3, 0),
    counters.vertexCount,
  );

  // The container census counts the same streams from the other direction.
  assert.deepEqual(
    Object.fromEntries(
      (result.coverage?.streams ?? [])
        .filter((stream) => stream.path.startsWith("Partitions/") ||
          stream.path.startsWith("Global/") ||
          stream.path === "Formats/Latest" ||
          stream.path === "BasicFileInfo")
        .map((stream) => [stream.path, stream.chunks]),
    ),
    {
      [SHEET_0]: 2,
      [SHEET_1]: 1,
      "Global/ElemTable": 1,
      "Global/PartitionTable": 1,
      "Formats/Latest": 1,
      BasicFileInfo: 0,
    },
  );
});

test("decoder coverage names the decoders the container actually fed", () => {
  const result = converted(syntheticModel());
  const coverage = result.decoderCoverage;

  assert.equal(coverage.revitVersion, 2027);
  assert.deepEqual([...coverage.activeDecoders].sort(), [
    "revit-2024-2027-elem-table-ownership-v1",
    "revit-2027-duplicated-bounds-v1",
    "revit-builtin-category-token-v1",
  ]);
  assert.equal(coverage.nativeCategorisedElements, ALL_ELEMENTS.length);
  assert.equal(coverage.approximateSolids, ALL_ELEMENTS.length);
  assert.equal(coverage.nativeOwnershipRecords, ALL_ELEMENTS.length);
  assert.equal(coverage.nativeOwnershipRelations, 3);
  assert.equal(coverage.geometryFidelity, "native-bounds-envelope");
  assert.equal(coverage.semanticFidelity, "native-categories-and-ownership");
  assert.equal(coverage.materialFidelity, "display-fallback");

  // Nothing in this fixture carries native geometry, materials, identities or
  // relations, and the coverage report must not claim otherwise.
  assert.equal(coverage.nativeMeshes, 0);
  assert.equal(coverage.nativeCurves, 0);
  assert.equal(coverage.nativeProfiles, 0);
  assert.equal(coverage.nativeMaterialDefinitions, 0);
  assert.equal(coverage.nativeMaterialAssignments, 0);
  assert.equal(coverage.nativeFamilyRelations, 0);
  assert.equal(coverage.nativeHostRelations, 0);
  assert.equal(coverage.nativeAssociatedLevelRelations, 0);
  assert.equal(coverage.nativeUniqueIds, 0);
  assert.equal(result.nativeIdentity, undefined);
  assert.equal(result.partAtom, undefined);
  assert.equal(result.transmissionData, undefined);
  assert.deepEqual(result.persistedCadFileNames, []);
  assert.deepEqual(result.nativeProfiles, []);
  // On this branch `segments` is the plan outline of the drawn records, four
  // edges apiece, rather than the diagnostic scanner's output.
  assert.equal(result.segments.length, ALL_ELEMENTS.length * 4);

  assert.deepEqual(result.nativeCategories, {
    tokensFound: ALL_ELEMENTS.length,
    directElements: ALL_ELEMENTS.length,
    inheritedElements: 0,
    donatedTokenElements: 0,
    donatedTokensOverridden: 0,
    categories: [
      { categoryId: WALL_A.categoryId, name: "Walls", elements: 2 },
      { categoryId: FLOOR.categoryId, name: "Floors", elements: 1 },
      { categoryId: CEILING.categoryId, name: "Ceilings", elements: 1 },
      { categoryId: COLUMN.categoryId, name: "Columns", elements: 1 },
      { categoryId: ROOF.categoryId, name: "Roofs", elements: 1 },
    ],
    codeConsensus: [],
  });
  assert.ok(
    result.warnings.some((warning) =>
      warning.startsWith("3 persisted element ownership relationships")),
    `ownership warning missing from ${JSON.stringify(result.warnings)}`,
  );
});

test("the auxiliary container streams reach the result", () => {
  const result = converted(syntheticModel());

  assert.deepEqual(result.partitionNames?.map((entry) => entry.name), [
    "Workset1",
    "Shared Levels and Grids",
  ]);

  // Every class the stream declares, not the ones a pattern matched: indices run
  // from 12 in creation order and a class is written before the parent it
  // defines inline, so `Wall` is 12, the `Element` it defines is 13, and the
  // sibling naming that parent by index is 14. Each field count is the class's
  // own.
  assert.deepEqual(result.schema?.taggedClasses, [
    { name: "Wall", tag: 12, parent: "Element", version: 7, declaredFieldCount: 0, offset: 0 },
    { name: "Element", tag: 13, parent: "", version: 3, declaredFieldCount: 3, offset: 10 },
    { name: "Floor", tag: 14, parent: "Element", version: 5, declaredFieldCount: 0, offset: 83 },
  ]);
  // Nothing is left referenced-only once the whole stream is read: every name
  // in it carries a definition.
  assert.deepEqual(result.schema?.referencedClasses, []);

  // `Global/ElemTable` is read twice, once as an index and once as a graph.
  assert.equal(result.elementIndex?.recordCount, ALL_ELEMENTS.length + 1);
  assert.equal(result.elementIndex?.parsedRecordCount, ALL_ELEMENTS.length);
  assert.deepEqual(
    [...(result.elementIndex?.uniqueElementIds ?? [])],
    ALL_ELEMENTS.map((element) => element.elementId),
  );
  // The partition locators are collected during the page walk and only
  // published through the element index, so they cross the whole pipeline.
  assert.deepEqual(
    result.elementIndex?.partitionRecords.map((record) => [record.elementId, record.stream]),
    ALL_ELEMENTS.map((element) => [element.elementId, element.stream]),
  );

  assert.equal(result.elementOwnership?.format, "revit-2024-2027-elem-table");
  assert.deepEqual(
    result.elementOwnership?.relations.map((relation) => [relation.ownerId, relation.elementId]),
    [
      [WALL_A.elementId, FLOOR.elementId],
      [WALL_A.elementId, CEILING.elementId],
      [COLUMN.elementId, ROOF.elementId],
    ],
  );
});

test("a chunk body split by a stored page checksum is still read", () => {
  // Prove the fixture is shaped as claimed before trusting what it proves: the
  // straddling chunk starts inside the first stored page and its body runs past
  // the page's payload, so the checksum tail is written into the middle of it.
  const payload = firstPartitionPayload();
  const stored = withPageChecksums(payload);
  assert.deepEqual(gzipOffsets(payload), [0, STRADDLING_CHUNK_OFFSET]);
  assert.ok(STRADDLING_CHUNK_OFFSET + GZIP_HEADER.length < REVIT_PAGE_PAYLOAD_BYTES);
  assert.ok(payload.length > REVIT_PAGE_PAYLOAD_BYTES);
  assert.equal(stored.length, payload.length + REVIT_PAGE_CHECKSUM_BYTES);
  assert.deepEqual(stripRevitPageChecksums(stored), payload);

  // With the tails still in place the chunk is found and cannot be read, so the
  // record below is not reachable by accident.
  assert.deepEqual(gzipOffsets(stored), [0, STRADDLING_CHUNK_OFFSET]);
  assert.equal(inflateRevitChunk(stored, STRADDLING_CHUNK_OFFSET), null);

  const result = converted(syntheticModel());
  const record = result.elementBounds.find((entry) => entry.elementId === CEILING.elementId);
  assert.ok(record, "the straddling chunk's element did not reach the result");
  assert.equal(record.chunkIndex, 1);
  assert.equal(record.rawOffset, STRADDLING_CHUNK_OFFSET);
  assert.deepEqual(record.boundsFeet.max, { x: 40, y: 60, z: 10.75 });
});

test("progress reports every stage of the bounds path, in order", () => {
  const updates = progressOf(syntheticModel(), "synthetic.rvt");

  // These messages are the stage boundaries. Their order, their ratios and the
  // running counts they quote are the contract a stage split has to preserve.
  assert.deepEqual(
    updates.map((update) => [update.ratio, update.message]),
    [
      [0.03, "Opening Revit container"],
      [0.12, "Scanning partition 1/2 · page 1/2 · 0 exact bounds"],
      [0.825, "Reconstructing native surfaces · 0 surface owners"],
      [0.83, "Resolving placed geometry · 0 instances"],
      [0.835, "Recovering sketch boundaries · 0 curve owners"],
      [0.84, "Resolving native Revit categories · 6 element records"],
      [0.9, "Finalising element geometry · 6 element records"],
      [0.96, "Building the display scene · 6 drawable records"],
      [1, "Ready"],
    ],
  );
  assert.deepEqual(
    updates.map((update) => update.ratio).sort((left, right) => left - right),
    updates.map((update) => update.ratio),
  );
  assert.equal(updates.filter((update) => update.message === "Ready").length, 1);
});

test("without a release the diagnostic coordinate branch runs instead", () => {
  const result = converted(coordinateOnlyModel(), "legacy.rvt");

  assert.equal(result.method, "partition-coordinate-recovery");
  assert.equal(result.decoderCoverage.revitVersion, null);
  assert.deepEqual(result.decoderCoverage.activeDecoders, []);
  assert.equal(result.decoderCoverage.geometryFidelity, "diagnostic-only");
  assert.equal(result.decoderCoverage.semanticFidelity, "none");
  assert.ok(
    result.warnings.includes(
      "No Revit release was supplied, so release-specific native record decoders were safely disabled.",
    ),
  );

  // The eight plan edges come back as the segments they were written as, and
  // nothing claims they are decoded elements.
  assert.equal(result.segments.length, 8);
  assert.deepEqual(result.segments[0], { x0: 0, y0: 0, z0: 0, x1: 40, y1: 0, z1: 0 });
  assert.deepEqual(result.elementBounds, []);
  assert.equal(result.stats.boundsRecordsFound, 0);
  assert.equal(result.stats.candidatesUsed, 8);
  assert.equal(result.stats.vertexCount, 8 * 8);
  assert.deepEqual(result.levels.map((level) => level.elevation), [0, 12]);

  // This branch never reaches the display-scene stage, and says so.
  assert.deepEqual(
    progressOf(coordinateOnlyModel(), "legacy.rvt").map((update) => update.message),
    [
      "Opening Revit container",
      "Scanning partition 1/1 · page 1/1 · 0 exact bounds",
      "Reconstructing native surfaces · 0 surface owners",
      "Resolving placed geometry · 0 instances",
      "Recovering sketch boundaries · 0 curve owners",
      "Resolving native Revit categories · 0 element records",
      "Finalising element geometry · 0 element records",
      "Ready",
    ],
  );
});

test("the release gate, not the record shape, decides which decoder runs", () => {
  // The same 2027 records, in a container with no BasicFileInfo. Nothing may be
  // decoded from them, and the diagnostic scanner finds no segment either, so
  // the conversion is refused rather than half-read.
  const gated = container([
    { path: `/${SHEET_1}`, bytes: gzipChunk(partitionPage(SECOND_PARTITION_ELEMENTS)) },
  ]);
  assert.equal(
    refused(gated, "gated.rvt").error,
    "The file opened, but no plausible geometry was recovered.",
  );

  // Naming the release explicitly is the documented way past that gate.
  const result = converted(gated, "gated.rvt", { revitVersion: 2027 });
  assert.equal(result.decoderCoverage.revitVersion, 2027);
  assert.deepEqual(
    result.elementBounds.map((record) => record.elementId),
    SECOND_PARTITION_ELEMENTS.map((element) => element.elementId),
  );
});

test("a malformed container is refused rather than thrown out of", () => {
  const notAContainer = refused(new Uint8Array(64).fill(0x41), "junk.rvt");
  assert.equal(notAContainer.fileName, "junk.rvt");
  assert.match(notAContainer.error, /CFB file size/);

  assert.match(refused(new Uint8Array(0), "empty.rvt").error, /CFB file size/);

  assert.equal(
    refused(container([{ path: "/BasicFileInfo", bytes: basicFileInfo("2027") }])).error,
    "No Revit partition stream was found.",
  );

  // A partition stream that holds no readable chunk opens and decodes nothing.
  assert.equal(
    refused(container([{ path: `/${SHEET_0}`, bytes: new Uint8Array(256).fill(FILLER_BYTE) }]))
      .error,
    "The file opened, but no plausible geometry was recovered.",
  );
});

test("conversion accepts an ArrayBuffer as readily as a view", () => {
  const bytes = syntheticModel();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const fromBuffer = convertRvtBytes(buffer as ArrayBuffer, "synthetic.rvt");
  assert.ok(fromBuffer.ok);
  assert.equal(fromBuffer.byteLength, bytes.byteLength);
  assert.equal(fromBuffer.stats.boundsRecordsFound, ALL_ELEMENTS.length);
});
