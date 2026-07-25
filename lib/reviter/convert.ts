/**
 * The conversion pipeline.
 *
 * This module orchestrates; it does not decode. It walks the container, hands
 * each inflated page to the record decoders, then assembles the result from the
 * scene and category modules:
 *
 *   `revit-container`  → OLE/CFB streams and truncated-gzip chunks
 *   `elem-table`       → the native element-id index
 *   `bounds-records`   → Revit 2027 duplicated-bounds element envelopes
 *   `native-categories`→ BuiltInCategory tokens and their element ownership
 *   `segment-scan`     → the diagnostic fallback for undecoded releases
 *   `scene`            → display selection, batching, and materials
 */
import CFB from "cfb";

import {
  detectDuplicatedBoundsRecords,
  framingBoundsOfRecords,
  solidBounds,
} from "./bounds-records.ts";
import {
  chainElementObjects,
  dominantMarker,
  markerObjectSeeds,
  scanObjectMarkers,
  type ElementObject,
} from "./element-objects.ts";
import { collectElementParameters } from "./element-parameters.ts";
import { collectTypeLinks } from "./element-types.ts";
import { collectOwnedSurfaces, type PlanePatch } from "./surfaces.ts";
import {
  instanceCorners,
  readInstancePlacement,
  readLocalBounds,
  type InstancePlacement,
  type LocalBounds,
} from "./instanced-geometry.ts";
import { surfaceQuadsFor, wallSolids } from "./native-geometry.ts";
import {
  boundaryLoopsFor,
  collectSketchCurves,
  type Point3,
  type SketchCurve,
} from "./sketch-curves.ts";
import { parseElemTable } from "./elem-table.ts";
import {
  applyNativeCategories,
  collectCategoryTokens,
  type CategoryToken,
} from "./native-categories.ts";
import { decoderPlanForVersion } from "./native-decoder.ts";
import { asBytes, gzipOffsets, inflateRevitChunk, leadingU32 } from "./revit-container.ts";
import { summariseSchema } from "./schema.ts";
import { measureStream, summariseCoverage } from "./stream-coverage.ts";
import { parsePartitionNames } from "./partition-names.ts";
import {
  buildBoundsMeshes,
  buildMeshes,
  boundsPlanSegments,
  displayMaterials,
  levelsForBounds,
  selectDisplayBounds,
} from "./scene.ts";
import {
  FAMILY_SEGMENT_SCALE,
  deduplicate,
  focusPrimaryCluster,
  levelsFor,
  rawBounds,
  sampleEvenly,
  scanSegments,
  segmentScaleFor,
  trimVerticalOutliers,
} from "./segment-scan.ts";

import type {
  Bounds3,
  ConvertOptions,
  ConvertOutcome,
  ConvertResult,
  ElementBoundsRecord,
  NativeProfileLocator,
  PartitionRecordLocator,
  ElementParameter,
  ProgressUpdate,
  Segment,
} from "./types";

const DEFAULT_MAX_SEGMENTS = 12_000;

/** Backstop so a pathological stream cannot turn category recovery quadratic. */
const MAX_CATEGORY_TOKENS = 400_000;

/** Same backstop for sketch edges, which are chained pairwise per element. */
const MAX_SKETCH_CURVES = 400_000;

/**
 * Categories Revit models as a sketch extruded through a thickness. Boundary
 * recovery is limited to these because chaining is quadratic in the edges an
 * element owns, and because outside them a closed ring is not the element's
 * shape — a wall's edges bound its faces, not its footprint.
 */
const SKETCH_BOUNDARY_CATEGORIES = new Set([
  -2000032, // Floors
  -2000035, // Roofs
  -2000038, // Ceilings
  -2000180, // Ramps
  -2001300, // StructuralFoundation
]);

/**
 * Curves an uncategorised element may own before boundary chaining is skipped.
 * Ring assembly is quadratic in the edges an element holds, and an element with
 * no category is a guess rather than a known slab, so it is not worth the cost.
 */
const MAX_UNNAMED_SKETCH_CURVES = 512;

/** Plan agreement required before an unnamed element's ring is trusted, in feet. */
const SKETCH_PLAN_TOLERANCE_FEET = 0.05;

/**
 * How far a placed instance's oriented box may sit from the element's own
 * duplicated-bounds record before the box is disbelieved, in feet.
 *
 * The two are independent readings of the same element, so their agreement is a
 * free check on both. Measured against the paired export they agree to 0.000 ft
 * for curtain-wall mullions and panels — 18,357 elements — and the placed box
 * is exact there. For doors they disagree by 7.15 ft, the box is wrong by that
 * same amount, and the bounds record is wrong by 2.75: the shared shape a door
 * instance points at is not the door's own extent. The box is worth more than
 * the record when they agree and worth nothing when they do not, so it is used
 * only in the first case.
 */
const ORIENTED_BOX_AGREEMENT_FEET = 1;

/** Pages sampled to learn which object markers this file uses. */
const MARKER_SAMPLE_PAGES = 12;

/** Objects a marker must head across the sample before it is seeded from. */
const MARKER_MIN_SUPPORT = 24;

/** Cap on marker scans per page, so seeding cost stays bounded. */
const MAX_OBJECT_MARKERS = 12;

type ProgressCallback = (update: ProgressUpdate) => void;

/** True when a placed oriented box lands on the element's own decoded envelope. */
function agreesWithBounds(corners: [number, number, number][], bounds: Bounds3): boolean {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const [x, y, z] of corners) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  return (
    Math.abs(minX - bounds.min.x) <= ORIENTED_BOX_AGREEMENT_FEET &&
    Math.abs(minY - bounds.min.y) <= ORIENTED_BOX_AGREEMENT_FEET &&
    Math.abs(minZ - bounds.min.z) <= ORIENTED_BOX_AGREEMENT_FEET &&
    Math.abs(maxX - bounds.max.x) <= ORIENTED_BOX_AGREEMENT_FEET &&
    Math.abs(maxY - bounds.max.y) <= ORIENTED_BOX_AGREEMENT_FEET &&
    Math.abs(maxZ - bounds.max.z) <= ORIENTED_BOX_AGREEMENT_FEET
  );
}

/**
 * Boundary loops for one element.
 *
 * With `verify` the element's category is unknown, so the ring has to earn its
 * place: a floor, ceiling or ramp's sketch *is* its footprint, and must
 * therefore reproduce the plan extent of the envelope that the duplicated-bounds
 * record proved independently. An edge set that bounds something else — a wall's
 * faces, a stray blob — does not, and is discarded.
 */
function sketchLoopsFor(
  record: ElementBoundsRecord,
  curvesByOwner: Map<number, SketchCurve[]>,
  { verify }: { verify: boolean },
): Point3[][] {
  if (verify) {
    const owned =
      (curvesByOwner.get(record.elementId)?.length ?? 0) +
      (curvesByOwner.get(record.elementId - 1)?.length ?? 0);
    if (!owned || owned > MAX_UNNAMED_SKETCH_CURVES) return [];
  }

  const loops = boundaryLoopsFor(record.elementId, curvesByOwner);
  if (!loops.length || !verify) return loops;

  const outer = loops[0]!;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of outer) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const { min, max } = record.boundsFeet;
  const agrees =
    Math.abs(minX - min.x) <= SKETCH_PLAN_TOLERANCE_FEET &&
    Math.abs(minY - min.y) <= SKETCH_PLAN_TOLERANCE_FEET &&
    Math.abs(maxX - max.x) <= SKETCH_PLAN_TOLERANCE_FEET &&
    Math.abs(maxY - max.y) <= SKETCH_PLAN_TOLERANCE_FEET;
  return agrees ? loops : [];
}

/**
 * Inflate the first chunk of a named stream and hand it to `decode`. Returns
 * `undefined` when the stream is absent or does not decompress, so an optional
 * stream never fails the conversion.
 */
function readStreamSummary<T>(
  cfb: ReturnType<typeof CFB.read>,
  pattern: RegExp,
  decode: (data: Uint8Array) => T,
): T | undefined {
  const entry = cfb.FileIndex
    .map((candidate, index) => ({ entry: candidate, path: cfb.FullPaths[index] ?? "" }))
    .find(({ entry: candidate, path }) => candidate.size > 0 && pattern.test(path));
  if (!entry) return undefined;
  const bytes = asBytes(entry.entry.content);
  const offset = gzipOffsets(bytes, 1)[0];
  const inflated = offset == null ? null : inflateRevitChunk(bytes, offset);
  return inflated ? decode(inflated) : undefined;
}

export function convertRvtBytes(
  input: ArrayBuffer | Uint8Array,
  fileName = "model.rvt",
  options: ConvertOptions = {},
  onProgress?: ProgressCallback,
): ConvertOutcome {
  const started = performance.now();
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const maxSegments = options.maxSegments ?? DEFAULT_MAX_SEGMENTS;
  const decoderPlan = decoderPlanForVersion(options.revitVersion);
  const segmentScale = segmentScaleFor(fileName, options.geometryScale);
  const familyScale = segmentScale === FAMILY_SEGMENT_SCALE;

  try {
    onProgress?.({ ratio: 0.03, message: "Opening Revit container" });
    const cfb = CFB.read(bytes, { type: "buffer" });
    const elemTableEntry = cfb.FileIndex
      .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
      .find(({ entry, path }) => entry.size > 0 && /\/Global\/ElemTable$/i.test(path));
    let elementIndex;
    if (elemTableEntry) {
      const elemTableBytes = asBytes(elemTableEntry.entry.content);
      const offset = gzipOffsets(elemTableBytes, 1)[0];
      const inflated = offset == null ? null : inflateRevitChunk(elemTableBytes, offset);
      if (inflated) elementIndex = parseElemTable(inflated) ?? undefined;
    }
    const coverage = summariseCoverage(
      cfb.FileIndex
        .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
        .filter(({ entry }) => entry.size > 0)
        .map(({ entry, path }) =>
          measureStream(path.replace(/^Root Entry\//, ""), asBytes(entry.content)),
        ),
    );

    const schema = readStreamSummary(cfb, /\/Formats\/Latest$/i, summariseSchema);
    const partitionNames = readStreamSummary(cfb, /\/Global\/PartitionTable$/i, parsePartitionNames) ?? [];

    const partitions = cfb.FileIndex
      .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
      .filter(({ entry, path }) => entry.size > 0 && /\/Partitions\/[^/]+$/i.test(path));

    if (!partitions.length) throw new Error("No Revit partition stream was found.");

    // Learn which object markers this file actually uses, from a sample of its
    // pages, so seeding is not limited to the one class the bounds decoder
    // happens to look for. Calibrating on a sample keeps the byte-by-byte scan
    // off the other 3,300 pages.
    const objectMarkers: number[] = [];
    if (decoderPlan.elementBoundsDecoder) {
      const sampleCounts = new Map<number, number>();
      const samplePartition = partitions[0]!;
      const sampleData = asBytes(samplePartition.entry.content);
      const sampleOffsets = gzipOffsets(sampleData);
      const stride = Math.max(1, Math.floor(sampleOffsets.length / MARKER_SAMPLE_PAGES));
      for (let index = 0; index < sampleOffsets.length; index += stride) {
        const page = inflateRevitChunk(sampleData, sampleOffsets[index]!, sampleOffsets[index + 1]);
        if (!page) continue;
        for (const [marker, count] of scanObjectMarkers(page)) {
          sampleCounts.set(marker, (sampleCounts.get(marker) ?? 0) + count);
        }
      }
      objectMarkers.push(
        ...[...sampleCounts]
          .filter(([, count]) => count >= MARKER_MIN_SUPPORT)
          .sort((a, b) => b[1] - a[1])
          .slice(0, MAX_OBJECT_MARKERS)
          .map(([marker]) => marker),
      );
    }

    const candidates: Segment[] = [];
    const categoryTokens: CategoryToken[] = [];
    const elementBounds: ElementBoundsRecord[] = [];
    const elementObjects: ElementObject[] = [];
    const instancePlacements = new Map<number, InstancePlacement>();
    const localBounds = new Map<number, LocalBounds>();
    const elementParameters = new Map<number, Map<number, ElementParameter>>();
    const surfaceCounts = { planes: 0, cylinders: 0, verticalPlanes: 0 };
    const planesByElement = new Map<number, PlanePatch[]>();
    const curvesByOwner = new Map<number, SketchCurve[]>();
    let sketchCurves = 0;
    const typeReferences = new Map<number, number>();
    const typeNames = new Map<number, string>();
    const nativeProfiles: NativeProfileLocator[] = [];
    const boundedElementIds = new Set<number>();
    const partitionRecords: PartitionRecordLocator[] = [];
    const partitionRecordIds = new Set<number>();
    const locatedPartitionIds = new Set<number>();
    let gzipChunks = 0;
    let inflatedBytes = 0;
    const scanLimit = Math.max(maxSegments * 4, 40_000);

    for (let partitionIndex = 0; partitionIndex < partitions.length; partitionIndex += 1) {
      const partition = partitions[partitionIndex]!;
      const data = asBytes(partition.entry.content);
      const offsets = gzipOffsets(data);
      const stride = offsets.length > 900 ? Math.ceil(offsets.length / 700) : 1;

      for (let index = 0; index < offsets.length; index += 1) {
        const inflated = inflateRevitChunk(data, offsets[index]!, offsets[index + 1]);
        if (!inflated) continue;
        gzipChunks += 1;
        inflatedBytes += inflated.byteLength;
        const elementId = leadingU32(inflated);
        if (elementId && elementId !== 0xffffffff) {
          partitionRecordIds.add(elementId);
          if (!locatedPartitionIds.has(elementId)) {
            locatedPartitionIds.add(elementId);
            partitionRecords.push({
              elementId,
              stream: partition.path.replace(/^Root Entry\//, ""),
              chunkIndex: index,
              rawOffset: offsets[index]!,
              inflatedBytes: inflated.byteLength,
            });
          }
        }
        const typeLinks = collectTypeLinks(inflated);
        for (const reference of typeLinks.references) {
          if (!typeReferences.has(reference.elementId)) {
            typeReferences.set(reference.elementId, reference.typeId);
          }
        }
        for (const entry of typeLinks.names) {
          if (!typeNames.has(entry.typeId)) typeNames.set(entry.typeId, entry.name);
        }
        for (const { owner, surface } of collectOwnedSurfaces(inflated)) {
          if (surface.kind === "cylinder") {
            surfaceCounts.cylinders += 1;
            continue;
          }
          surfaceCounts.planes += 1;
          if (Math.abs(Math.abs(surface.vDir.z) - 1) <= 1e-9) surfaceCounts.verticalPlanes += 1;
          const planes = planesByElement.get(owner);
          if (planes) planes.push(surface);
          else planesByElement.set(owner, [surface]);
        }
        if (sketchCurves < MAX_SKETCH_CURVES) {
          for (const curve of collectSketchCurves(inflated)) {
            sketchCurves += 1;
            const owned = curvesByOwner.get(curve.owner);
            if (owned) owned.push(curve);
            else curvesByOwner.set(curve.owner, [curve]);
          }
        }
        for (const table of collectElementParameters(inflated)) {
          const existing = elementParameters.get(table.elementId);
          if (existing) for (const parameter of table.parameters) existing.set(parameter.parameterId, parameter);
          else elementParameters.set(
            table.elementId,
            new Map(table.parameters.map((parameter) => [parameter.parameterId, parameter])),
          );
        }
        if (categoryTokens.length < MAX_CATEGORY_TOKENS) {
          for (const token of collectCategoryTokens(inflated)) categoryTokens.push(token);
        }
        const detectedBoundsRecords = decoderPlan.elementBoundsDecoder
          ? detectDuplicatedBoundsRecords(inflated)
          : [];
        // Seed the object chain from every validated object marker on the page,
        // not only from the bounds records.
        //
        // Chaining walks until an object fails to verify, and about one record
        // in two hundred does, so a chain grown from a handful of seeds loses
        // everything downstream of its first break. Marker seeds are already
        // self-validating — each candidate has to echo its own length — so
        // seeding from all of them makes a break local instead of terminal, and
        // reaches pages that carry no bounds record at all.
        const chainSeeds: number[] = [];
        for (const marker of objectMarkers) {
          for (const seed of markerObjectSeeds(inflated, marker)) chainSeeds.push(seed);
        }
        for (const record of detectedBoundsRecords) chainSeeds.push(record.recordOffset);
        if (chainSeeds.length) {
          for (const object of chainElementObjects(inflated, chainSeeds)) {
            elementObjects.push(object);
            partitionRecordIds.add(object.elementId);
            const placement = readInstancePlacement(inflated, object);
            if (placement) instancePlacements.set(placement.elementId, placement);
            else {
              const local = readLocalBounds(inflated, object);
              if (local) localBounds.set(local.elementId, local);
            }
            if (!locatedPartitionIds.has(object.elementId)) {
              locatedPartitionIds.add(object.elementId);
              partitionRecords.push({
                elementId: object.elementId,
                stream: partition.path.replace(/^Root Entry\//, ""),
                chunkIndex: index,
                rawOffset: offsets[index]!,
                inflatedBytes: inflated.byteLength,
              });
            }
          }
        }
        for (const detectedBounds of detectedBoundsRecords) {
          partitionRecordIds.add(detectedBounds.elementId);
          if (!locatedPartitionIds.has(detectedBounds.elementId)) {
            locatedPartitionIds.add(detectedBounds.elementId);
            partitionRecords.push({
              elementId: detectedBounds.elementId,
              stream: partition.path.replace(/^Root Entry\//, ""),
              chunkIndex: index,
              rawOffset: offsets[index]!,
              inflatedBytes: inflated.byteLength,
            });
          }
          if (boundedElementIds.has(detectedBounds.elementId)) continue;
          boundedElementIds.add(detectedBounds.elementId);
          elementBounds.push({
            elementId: detectedBounds.elementId,
            stream: partition.path.replace(/^Root Entry\//, ""),
            chunkIndex: index,
            rawOffset: offsets[index]!,
            recordOffset: detectedBounds.recordOffset,
            boundsOffset: detectedBounds.boundsOffset,
            recordCode: detectedBounds.recordCode,
            recordCount: detectedBounds.recordCount,
            boundsFeet: detectedBounds.boundsFeet,
          });
        }
        if (
          !decoderPlan.elementBoundsDecoder &&
          inflated.byteLength >= 48 &&
          index % stride === 0 &&
          candidates.length < scanLimit
        ) {
          scanSegments(inflated, candidates, scanLimit, segmentScale);
        }
        if (gzipChunks % 36 === 0) {
          onProgress?.({
            ratio: Math.min(0.82, 0.12 + (index / Math.max(1, offsets.length)) * 0.68),
            message: `Reading partition geometry · ${elementBounds.length.toLocaleString()} exact element bounds`,
          });
        }
      }
    }

    const solidStream = partitions[0]!.path.replace(/^Root Entry\//, "");
    // An element can own more than one solid — a wall built from several
    // segments. All of them are kept and all of them are drawn; the longest is
    // singled out only as the body that properties and picking report, which is
    // what one-record-per-element requires.
    const allSolids = wallSolids(planesByElement);
    const solidGroups = new Map<number, ReturnType<typeof wallSolids>>();
    const solidsByElement = new Map<number, ReturnType<typeof wallSolids>[number]>();
    const solidLength = (candidate: (typeof allSolids)[number]) =>
      Math.hypot(candidate.end.x - candidate.start.x, candidate.end.y - candidate.start.y);
    for (const solid of allSolids) {
      const group = solidGroups.get(solid.elementId);
      if (group) group.push(solid);
      else solidGroups.set(solid.elementId, [solid]);
      const existing = solidsByElement.get(solid.elementId);
      if (!existing || solidLength(solid) > solidLength(existing)) {
        solidsByElement.set(solid.elementId, solid);
      }
    }

    // Loadable families are placed rather than written out: each instance holds
    // a rigid transform and points at a shared shape. Resolving the pair gives
    // the instance its true orientation instead of an axis-aligned envelope.
    const orientedBoxes = new Map<number, [number, number, number][]>();
    for (const [elementId, placement] of instancePlacements) {
      const shape = localBounds.get(placement.geometryId);
      if (!shape) continue;
      orientedBoxes.set(elementId, instanceCorners(placement, shape));
    }

    // Elements with surfaces that do not form a wall triple still have real
    // faces; drawing those beats falling back to a bounding box.
    const quadsByElement = new Map<number, ReturnType<typeof surfaceQuadsFor>>();
    for (const [elementId, planes] of planesByElement) {
      if (solidsByElement.has(elementId)) continue;
      const quads = surfaceQuadsFor(elementId, planes);
      if (quads.length) quadsByElement.set(elementId, quads);
    }

    // Most elements that own native geometry have no duplicated-bounds record —
    // 2,818 wall records exist against 7,401 wall objects — so building the
    // scene only from bounds records drops the majority of the walls. Elements
    // with a rebuilt solid and no bounds record get a record synthesised from
    // the solid itself, so they reach the scene as the geometry they are.
    const boundedIds = new Set(elementBounds.map((record) => record.elementId));
    let solidOnlyElements = 0;
    for (const [elementId, quads] of quadsByElement) {
      if (boundedIds.has(elementId)) continue;
      const xs = quads.flatMap((quad) => quad.corners.map((corner) => corner[0]));
      const ys = quads.flatMap((quad) => quad.corners.map((corner) => corner[1]));
      const zs = quads.flatMap((quad) => quad.corners.map((corner) => corner[2]));
      elementBounds.push({
        elementId,
        stream: solidStream,
        chunkIndex: -1,
        rawOffset: -1,
        recordOffset: -1,
        boundsFeet: {
          min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
          max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
        },
      });
      boundedIds.add(elementId);
      solidOnlyElements += 1;
    }
    for (const [elementId, group] of solidGroups) {
      if (boundedIds.has(elementId)) continue;
      // The envelope spans every segment the element was rebuilt from, not just
      // the one that happens to be longest.
      const min = { x: Infinity, y: Infinity, z: Infinity };
      const max = { x: -Infinity, y: -Infinity, z: -Infinity };
      for (const solid of group) {
        const halfThickness = solid.thickness / 2;
        min.x = Math.min(min.x, solid.start.x - halfThickness, solid.end.x - halfThickness);
        min.y = Math.min(min.y, solid.start.y - halfThickness, solid.end.y - halfThickness);
        min.z = Math.min(min.z, solid.baseElevation);
        max.x = Math.max(max.x, solid.start.x + halfThickness, solid.end.x + halfThickness);
        max.y = Math.max(max.y, solid.start.y + halfThickness, solid.end.y + halfThickness);
        max.z = Math.max(max.z, solid.topElevation);
      }
      elementBounds.push({
        elementId,
        stream: solidStream,
        chunkIndex: -1,
        rawOffset: -1,
        recordOffset: -1,
        boundsFeet: { min, max },
      });
      boundedIds.add(elementId);
      solidOnlyElements += 1;
    }

    // A placed family instance carries no bounds record of its own — its shape
    // lives once in a shared geometry object and the instance only points at it
    // with a transform. Those pairs were being resolved and then thrown away
    // unless the element happened to reach the scene some other way, which took
    // most of the model's doors, columns, panels and railings out of the view.
    let instanceOnlyElements = 0;
    for (const [elementId, corners] of orientedBoxes) {
      if (boundedIds.has(elementId)) continue;
      const xs = corners.map((corner) => corner[0]);
      const ys = corners.map((corner) => corner[1]);
      const zs = corners.map((corner) => corner[2]);
      elementBounds.push({
        elementId,
        stream: solidStream,
        chunkIndex: -1,
        rawOffset: -1,
        recordOffset: -1,
        boundsFeet: {
          min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
          max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
        },
      });
      boundedIds.add(elementId);
      instanceOnlyElements += 1;
    }

    // A cached family shape is not a building element. Its object carries the
    // same bounds sub-record an element does, so it was being decoded into the
    // model as though it were one — and its box is in the family's own local
    // frame, so it landed at the model origin. In the supplied project 5,995 of
    // them were drawn that way, 97% of them stacked within 50 ft of the origin,
    // and only 7 corresponded to anything in the paired export.
    //
    // The file names them: an instance's trailer points at the shape it uses, so
    // the referenced set is read straight out of the placements rather than
    // guessed at from position. No id is both a shape and an instance in this
    // model, so removing them cannot take an element with them.
    const sharedGeometryIds = new Set<number>();
    for (const placement of instancePlacements.values()) sharedGeometryIds.add(placement.geometryId);
    let cachedShapeRecords = 0;
    if (sharedGeometryIds.size) {
      for (let index = elementBounds.length - 1; index >= 0; index -= 1) {
        if (!sharedGeometryIds.has(elementBounds[index]!.elementId)) continue;
        elementBounds.splice(index, 1);
        cachedShapeRecords += 1;
      }
    }

    onProgress?.({ ratio: 0.84, message: "Resolving native Revit categories" });
    const nativeCategories = applyNativeCategories(
      elementBounds,
      categoryTokens,
      elementIndex?.uniqueElementIds,
    );



    let namedTypeElements = 0;
    let sketchBoundaryElements = 0;
    let unnamedSketchElements = 0;
    let rejectedOrientedBoxes = 0;
    for (const record of elementBounds) {
      const parameters = elementParameters.get(record.elementId);
      if (parameters?.size) record.parameters = [...parameters.values()];
      record.solid = solidsByElement.get(record.elementId);
      record.solids = solidGroups.get(record.elementId);
      record.quads = quadsByElement.get(record.elementId);
      const orientedBox = orientedBoxes.get(record.elementId);
      // A record synthesised from the instance itself has nothing to check
      // against; one that also carries a bounds record does.
      if (orientedBox && (record.recordOffset < 0 || agreesWithBounds(orientedBox, record.boundsFeet))) {
        record.orientedBox = orientedBox;
      } else if (orientedBox) {
        rejectedOrientedBoxes += 1;
      }
      const knownSketchCategory =
        record.categoryId != null && SKETCH_BOUNDARY_CATEGORIES.has(record.categoryId);
      // Boundary recovery used to require the category to have decoded first,
      // which is backwards for exactly the elements that need it: ceilings and
      // ramps are the smallest populations in the model and so the likeliest to
      // fail category recovery, and a sketch loop is the only thing that gives
      // them a shape rather than a box. An element with no category and no
      // other geometry is therefore also tried — and its ring is kept only if
      // it agrees with the envelope decoded independently from the file.
      const mayBeUnnamedSketch =
        record.categoryId == null &&
        !record.solid &&
        !record.quads?.length &&
        !record.orientedBox;
      if (knownSketchCategory || mayBeUnnamedSketch) {
        const loops = sketchLoopsFor(record, curvesByOwner, { verify: !knownSketchCategory });
        if (loops.length) {
          record.loops = loops;
          sketchBoundaryElements += 1;
          if (!knownSketchCategory) unnamedSketchElements += 1;
        }
      }
      const typeId = typeReferences.get(record.elementId);
      if (typeId == null) continue;
      record.typeId = typeId;
      const typeName = typeNames.get(typeId);
      if (typeName) {
        record.typeName = typeName;
        namedTypeElements += 1;
      }
    }

    onProgress?.({ ratio: 0.86, message: "Removing duplicates and spatial noise" });
    const unique = deduplicate(candidates);
    const focused = trimVerticalOutliers(focusPrimaryCluster(unique));
    const used = sampleEvenly(focused, maxSegments);
    const categorisedElements = nativeCategories.directElements + nativeCategories.inheritedElements;
    // An element needs a volume to be worth drawing, with one exception: a
    // sketch-bounded element is a plan boundary plus a thickness, and Revit can
    // record that thickness as zero. `prismGeometry` already substitutes a
    // minimum depth for exactly that case, so gating on a three-axis extent
    // beforehand only threw away flat ceilings and ramp landings that had a
    // perfectly good recovered outline.
    const boundedSolids = elementBounds.filter(
      (record) => solidBounds(record) || (record.loops?.length ?? 0) > 0,
    );
    if (boundedSolids.length) {
      const displaySelection = selectDisplayBounds(boundedSolids);
      const displayBounds = displaySelection.records;
      // Framed to the building rather than to the outermost record, so a few
      // misparsed envelopes cannot throw the camera off the model.
      const bounds = framingBoundsOfRecords(displayBounds);
      const origin = {
        x: (bounds.min.x + bounds.max.x) / 2,
        y: (bounds.min.y + bounds.max.y) / 2,
        z: bounds.min.z,
      };
      const meshes = buildBoundsMeshes(displayBounds, origin);
      const segments = boundsPlanSegments(displayBounds);
      const relativeBounds = {
        min: { x: bounds.min.x - origin.x, y: bounds.min.y - origin.y, z: 0 },
        max: {
          x: bounds.max.x - origin.x,
          y: bounds.max.y - origin.y,
          z: bounds.max.z - origin.z,
        },
      };
      const result: ConvertResult = {
        ok: true,
        fileName,
        byteLength: bytes.byteLength,
        meshes,
        materials: displayMaterials(),
        segments,
        elementBounds,
        nativeProfiles,
        nativeCategories,
        schema,
        partitionNames,
        coverage,
        decoderCoverage: {
          revitVersion: decoderPlan.revitVersion,
          activeDecoders: [
            "revit-2027-duplicated-bounds-v1",
            ...(nativeCategories.tokensFound ? ["revit-builtin-category-token-v1"] : []),
          ],
          nativeCurves: 0,
          nativeProfiles: 0,
          nativeMeshes: 0,
          nativeMaterialDefinitions: 0,
          nativeMaterialAssignments: 0,
          approximateSolids: displayBounds.length,
          nativeCategorisedElements: categorisedElements,
          geometryFidelity: "native-bounds-envelope",
          materialFidelity: "display-fallback",
          semanticFidelity: categorisedElements ? "native-categories" : "record-code-heuristic",
        },
        origin,
        bbox: relativeBounds,
        levels: levelsForBounds(displayBounds),
        method: "partition-bounds-recovery",
        elementIndex: elementIndex
          ? {
              ...elementIndex,
              partitionRecordIds: Uint32Array.from([...partitionRecordIds].sort((a, b) => a - b)),
              partitionRecords,
            }
          : undefined,
        warnings: [
          `${boundedSolids.length.toLocaleString()} native element records supplied duplicated, validated 3D bounds.`,
          ...(categorisedElements
            ? [`${categorisedElements.toLocaleString()} elements carry a Revit category decoded from the file itself (${nativeCategories.directElements.toLocaleString()} from their own category token, ${nativeCategories.inheritedElements.toLocaleString()} inherited from a record-code consensus).`]
            : ["No native Revit category tokens were decoded, so element display falls back to record-code clusters."]),
          ...(displaySelection.omittedContainerCount
            ? ["One dominant container-like envelope remains in audit and IFC output but is omitted from the default scene so it cannot hide the building."]
            : []),
          ...(displaySelection.omittedWrapperCount
            ? [`${displaySelection.omittedWrapperCount.toLocaleString()} curtain-wall/opening wrapper envelopes are hidden by default so their detailed child elements remain visible.`]
            : []),
          ...(displaySelection.unclassifiedCount
            ? [`${displaySelection.unclassifiedCount.toLocaleString()} element envelopes are drawn without a decoded Revit category, grouped as uncategorised elements.`]
            : []),
          "Geometry uses exact RVT axis-aligned element envelopes; curved profiles, openings, materials, and parameters are not decoded yet.",
        ],
        stats: {
          streamCount: cfb.FileIndex.filter((entry) => entry.size > 0).length,
          partitionStreams: partitions.length,
          gzipChunks,
          inflatedBytes,
          candidatesFound: elementBounds.length,
          candidatesFocused: displayBounds.length,
          candidatesUsed: displayBounds.length,
          // Counted from the batches themselves: a drawn item is no longer
          // always an eight-vertex box.
          vertexCount: meshes.reduce((total, mesh) => total + mesh.positions.length / 3, 0),
          triangleCount: meshes.reduce((total, mesh) => total + mesh.indices.length / 3, 0),
          meshCount: meshes.length,
          boundsRecordsFound: elementBounds.length,
          solidBoundsRecords: boundedSolids.length,
          elementObjects: elementObjects.length,
          parameterElements: elementParameters.size,
          surfaces: surfaceCounts,
          nativeSolids: solidsByElement.size,
          faceOnlyElements: quadsByElement.size,
          placedInstances: orientedBoxes.size,
          rejectedOrientedBoxes,
          cachedShapeRecords,
          sketchBoundaryElements,
          unnamedSketchElements,
          sketchCurves,
          solidOnlyElements,
          instanceOnlyElements,
          unclassifiedElements: displaySelection.unclassifiedCount,
          typedElements: typeReferences.size,
          namedTypeElements,
          elementObjectMarker: dominantMarker(elementObjects) ?? undefined,
          durationMs: performance.now() - started,
        },
      };
      onProgress?.({ ratio: 1, message: "Ready" });
      return result;
    }
    if (!used.length) throw new Error("The file opened, but no plausible geometry was recovered.");

    const bounds = rawBounds(used);
    const origin = {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: bounds.min.z,
    };
    // The diagnostic scan recovers curves, not solids, so each candidate is
    // extruded only to make it visible. At family scale a 10 ft extrusion would
    // bury the component, so the defaults follow the recovered extent instead.
    const diagonal = Math.hypot(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y);
    const extrusionHeight = options.wallHeight ?? (familyScale ? Math.max(0.05, diagonal * 0.04) : 10);
    const extrusionThickness = options.wallThickness ?? (familyScale ? Math.max(0.01, diagonal * 0.004) : 0.5);
    const meshes = buildMeshes(used, origin, extrusionThickness, extrusionHeight);
    const relativeBounds = {
      min: { x: bounds.min.x - origin.x, y: bounds.min.y - origin.y, z: 0 },
      max: {
        x: bounds.max.x - origin.x,
        y: bounds.max.y - origin.y,
        z: bounds.max.z - origin.z + extrusionHeight,
      },
    };

    const result: ConvertResult = {
      ok: true,
      fileName,
      byteLength: bytes.byteLength,
      meshes,
      materials: displayMaterials(),
      segments: used,
      elementBounds,
      nativeProfiles,
      nativeCategories,
      schema,
      partitionNames,
      coverage,
      decoderCoverage: {
        revitVersion: decoderPlan.revitVersion,
        activeDecoders: nativeCategories.tokensFound ? ["revit-builtin-category-token-v1"] : [],
        nativeCurves: 0,
        nativeProfiles: 0,
        nativeMeshes: 0,
        nativeMaterialDefinitions: 0,
        nativeMaterialAssignments: 0,
        approximateSolids: used.length,
        nativeCategorisedElements: categorisedElements,
        geometryFidelity: "diagnostic-only",
        materialFidelity: "display-fallback",
        semanticFidelity: categorisedElements ? "native-categories" : "none",
      },
      origin,
      bbox: relativeBounds,
      levels: levelsFor(used),
      method: "partition-coordinate-recovery",
      elementIndex: elementIndex
        ? {
            ...elementIndex,
            partitionRecordIds: Uint32Array.from(
              [...partitionRecordIds].sort((a, b) => a - b),
            ),
            partitionRecords,
          }
        : undefined,
      warnings: [
        ...(decoderPlan.revitVersion == null
          ? ["No Revit release was supplied, so release-specific native record decoders were safely disabled."]
          : []),
        familyScale
          ? "Family file: geometry is inferred from component-scale coordinate-like partition records and is not a native Revit element model."
          : "Geometry is inferred from coordinate-like partition records and is not a native Revit element model.",
        focused.length < unique.length
          ? `Focused on the primary spatial cluster and omitted ${(unique.length - focused.length).toLocaleString()} isolated candidates.`
          : "No isolated spatial cluster was removed.",
      ],
      stats: {
        streamCount: cfb.FileIndex.filter((entry) => entry.size > 0).length,
        partitionStreams: partitions.length,
        gzipChunks,
        inflatedBytes,
        candidatesFound: unique.length,
        candidatesFocused: focused.length,
        candidatesUsed: used.length,
        vertexCount: used.length * 8,
        triangleCount: used.length * 12,
        meshCount: meshes.length,
        boundsRecordsFound: elementBounds.length,
        solidBoundsRecords: boundedSolids.length,
        elementObjects: elementObjects.length,
        durationMs: performance.now() - started,
      },
    };
    onProgress?.({ ratio: 1, message: "Ready" });
    return result;
  } catch (error) {
    return {
      ok: false,
      fileName,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
