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

import { revitVersionFromBasicFileInfo } from "./basic-file-info.ts";
import {
  boundsOfRecords,
  detectDuplicatedBoundsRecords,
  MIN_SOLID_SPAN_FEET,
  solidBounds,
} from "./bounds-records.ts";
import {
  chainElementObjects,
  dominantMarker,
  markerCategoryConsensus,
  markerObjectSeeds,
  scanFramedObjectClassEvidence,
  scanObjectMarkers,
  type ElementObject,
} from "./element-objects.ts";
import { collectElementParameters } from "./element-parameters.ts";
import { collectTypeLinks } from "./element-types.ts";
import { collectOwnedSurfaces, type CylinderPatch, type PlanePatch } from "./surfaces.ts";
import {
  readInstancePlacement,
  readLocalBounds,
  readLocalShape,
  SHAPE_OBJECT_MARKERS,
  sharedGeometryIdsForPlacements,
  type InstancePlacement,
  type LocalBounds,
} from "./instanced-geometry.ts";
import {
  bandsMeet,
  boundaryLoopsFor,
  collectSketchCurves,
  sketchCurveBounds,
  type CurveBounds,
  type SketchCurve,
} from "./sketch-curves.ts";
import { parseElemTable } from "./elem-table.ts";
import {
  decodeElementOwnership,
  type ElementOwnershipDecode,
} from "./element-relations.ts";
import {
  decodeRevitDocumentHistory,
  decodeRevitNativeIdentities,
  type NativeIdentityDecode,
} from "./native-identity.ts";
import { scanMaterialElementRecords } from "./material-records.ts";
import {
  scanPersistedRelationshipCandidates,
  type FamilySymbolCandidate,
  type FamilySymbolReferenceSet,
  type GeometryMaterialCandidate,
  type NativeFamilyDefinition,
} from "./family-material-relations.ts";
import {
  resolveCompoundStructureDefinitions,
  scanCompoundStructureCandidates,
  type CompoundStructureCandidate,
} from "./compound-structure-materials.ts";
import {
  scanFamilySymbolMaterialPage,
  type FamilySymbolMaterialReferenceSet,
} from "./family-symbol-materials.ts";
import {
  scanHostRelationCandidates,
  type HostRelationCandidate,
} from "./host-relations.ts";
import {
  scanAssociatedLevelRelationCandidates,
  type AssociatedLevelRelationCandidate,
} from "./level-relations.ts";
import {
  collectCategoryTokens,
  resolveElementCategories,
  type CategoryToken,
} from "./native-categories.ts";
import { decoderPlanForVersion } from "./native-decoder.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  leadingU32,
  revitStoredPageOffset,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "./revit-container.ts";
import { limitCensus, resetLimitCensus } from "./limit-census.ts";
import { summariseSchema } from "./schema.ts";
import { measureStream, summariseCoverage } from "./stream-coverage.ts";
import { parsePartitionNames } from "./partition-names.ts";
import { parsePartAtomXml } from "./part-atom.ts";
import { parseProjectInformationArchive } from "./project-information.ts";
import { parseRevitTransmissionData } from "./transmission-data.ts";
import {
  persistedCadFileNames as finalisePersistedCadFileNames,
  scanPersistedDwgFileNames,
} from "./cad-files.ts";
import {
  buildMeshes,
  isNonSceneObjectDefinition,
  nonSceneNativeMeshHelperIds,
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
import { createRevit2027NativeMeshCollector } from "./revit-2027-native-mesh-bridge.ts";
import { buildDisplayScene } from "./convert-display-scene.ts";
import {
  resolveElementGeometry,
  SKETCH_BOUNDARY_CATEGORIES,
} from "./convert-element-geometry.ts";
import { reconstructNativeSurfaces } from "./convert-native-surfaces.ts";
import { resolveNativeRelations } from "./convert-native-relations.ts";
import {
  buildDecoderCoverage,
  buildWarnings,
  type ConvertCoordinateReport,
  type ConvertReportBasis,
} from "./convert-report.ts";
import { createRevit2027StairsRunCollector } from "./revit-2027-stairs-run-collector.ts";
import { createRevit2027SplitAlternateFrameCollector } from "./revit-2027-split-alternate-frame-collector.ts";
import { residualDatumPileElementIds } from "./datum-pile.ts";

import type {
  Bounds3,
  ConvertOptions,
  ConvertOutcome,
  ConvertResult,
  LocatedNativeMaterialDefinition,
  ElementBoundsRecord,
  NativeProfileLocator,
  PartitionRecordLocator,
  ElementParameter,
  ProgressUpdate,
  Segment,
} from "./types.ts";

const DEFAULT_MAX_SEGMENTS = 12_000;

/** Backstop so a pathological stream cannot turn category recovery quadratic. */
const MAX_CATEGORY_TOKENS = 400_000;

/** Exact native classes used for narrow category/helper decisions below. */
const NATIVE_OBJECT_EVIDENCE_MARKERS = new Set([
  605, // BaseRailingSym
  967, // TopRailType
  974, // ContourLabelingElem
  0x0810, // FamilySymbol
  3392, // FootprintRoof
  3462, // RampSym
]);

/** Same backstop for sketch edges, which are chained pairwise per element. */
const MAX_SKETCH_CURVES = 400_000;

/** Plan distance from the project datum inside which an envelope is unplaced. */
const DATUM_PILE_RADIUS_FEET = 1;

/** Below this a model is too small to tell a datum pile from real geometry. */
const DATUM_PILE_MIN_MODEL_SPAN_FEET = 50;

/** Records needed before a pile on the datum can be told apart from a few elements. */
const MIN_RECORDS_FOR_DATUM_PILE = 500;

/** Pages sampled to learn which object markers this file uses. */
const MARKER_SAMPLE_PAGES = 12;

/** Objects a marker must head across the sample before it is seeded from. */
const MARKER_MIN_SUPPORT = 24;

/** Cap on marker scans per page, so seeding cost stays bounded. */
const MAX_OBJECT_MARKERS = 12;

type ProgressCallback = (update: ProgressUpdate) => void;

/**
 * The elevations for a record synthesised from a boundary ring alone.
 *
 * A ring is a *plan* boundary, and a stair run's ring is **flat** — the run's
 * outline at its own base, z span 0.000 ft — so extruding it between its own
 * elevations draws the run as a sheet lying on the floor. `sketchCurveBounds`
 * already answers this from the tread and riser edges the ring did not consume,
 * but only for a run whose record is a facet hull; a run with no record at all
 * reaches the ring-synthesis block instead, and nothing there was asking.
 *
 * That is one element in the supplied model and it is measurable: **1842441,
 * `Assembled Stair:Stair:1842431 Run 1`**, drawn 16.90 × 17.06 × **0.00** ft
 * where the export writes 16.90 × 17.10 × **9.68**. Its plan is already exact to
 * 0.02 ft; its curve set spans 0.00–9.84 ft, which is the export's rise plus the
 * documented 0.16 ft by which boundary edges sit above the tread — centre error
 * 4.84 → 0.08 ft, size error 9.68 → 0.16 ft.
 *
 * The guards are the ones the facet-hull use already carries, for the same
 * reasons: the element's **own** curves only, so a neighbouring run's Sketch
 * companion cannot lend a storey of rise, and the two bands must meet, so a
 * stacked twin a floor away cannot lend any. The plan stays the **ring's** — the
 * ring is the reading verified in plan, and a curve set's extremes are a hull
 * rather than an outline.
 *
 * **Specificity, because a percentage cannot judge a rule that adds extent.**
 * This fires on **1 of the 38,960 records** here. The other two flat ring records
 * are ramps — 1586431 and 2081718 — whose whole curve neighbourhood is flat, so
 * the rule declines them and they are drawn exactly as before. Dropping the
 * flatness test and taking the curve band whenever it is thicker was measured
 * and not taken: it reaches the same one element on this model, and the ring's
 * own elevations are the element's own statement about itself wherever it has
 * them.
 */
export function ringRecordRise(ring: CurveBounds, curves: CurveBounds | null): CurveBounds {
  if (!curves) return ring;
  if (ring.max.z - ring.min.z > MIN_SOLID_SPAN_FEET) return ring;
  if (curves.max.z - curves.min.z <= MIN_SOLID_SPAN_FEET) return ring;
  if (!bandsMeet(curves, ring)) return ring;
  return {
    min: { x: ring.min.x, y: ring.min.y, z: curves.min.z },
    max: { x: ring.max.x, y: ring.max.y, z: curves.max.z },
  };
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
  const bytes = stripRevitPageChecksums(asBytes(entry.entry.content));
  const offset = gzipOffsets(bytes, 1)[0];
  const inflated = offset == null ? null : inflateRevitChunk(bytes, offset);
  return inflated ? decode(inflated) : undefined;
}

/**
 * Drop every record `shouldRemove` selects, in a single pass, **in place**.
 *
 * The array object itself has to survive: `elementBounds` is built once and then
 * read through dozens of later closures and helper calls, so a rebuild-and-
 * reassign would risk one of them holding the pre-removal array. Compacting the
 * survivors down and truncating gives every existing reference the same view
 * `splice` gave it, without the array identity ever changing.
 *
 * Removing one at a time with `splice` shifts on average half the array per
 * removal. The cached-shape and datum-pile passes drop thousands of records from
 * a ~74,000-element array, which is hundreds of millions of element moves for
 * work one filter pass does.
 *
 * Order among the survivors is unchanged, which matters: the reverse-index
 * `splice` loops this replaces preserved it too, and later passes read these
 * records in order.
 *
 * @returns how many records were removed.
 */
function removeRecordsInPlace(
  records: ElementBoundsRecord[],
  shouldRemove: (record: ElementBoundsRecord) => boolean,
): number {
  let write = 0;
  for (let read = 0; read < records.length; read += 1) {
    const record = records[read]!;
    if (shouldRemove(record)) continue;
    records[write] = record;
    write += 1;
  }
  const removed = records.length - write;
  records.length = write;
  return removed;
}

/**
 * The axis-aligned hull over a run of points.
 *
 * `Math.min(...points)` reads better but passes one argument per point, and the
 * engine's argument limit is a hard ceiling in the low hundreds of thousands —
 * a facet hull is taken over four corners per plane patch and nothing caps how
 * many patches one element may own, so the spread form is a latent
 * `RangeError`, not merely a slow path. Empty input still yields the
 * `Infinity`/`-Infinity` pair `Math.min()`/`Math.max()` return, and a `NaN`
 * coordinate still poisons its axis exactly as the spread form did.
 */
function boundsOfCornerPoints(
  points: Iterable<readonly [number, number, number]>,
): Bounds3 {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const [x, y, z] of points) {
    min.x = Math.min(min.x, x); max.x = Math.max(max.x, x);
    min.y = Math.min(min.y, y); max.y = Math.max(max.y, y);
    min.z = Math.min(min.z, z); max.z = Math.max(max.z, z);
  }
  return { min, max };
}

export function convertRvtBytes(
  input: ArrayBuffer | Uint8Array,
  fileName = "model.rvt",
  options: ConvertOptions = {},
  onProgress?: ProgressCallback,
): ConvertOutcome {
  const started = performance.now();
  // Fitted-limit counters are module-level, so a previous conversion's tally
  // must not carry into this one.
  resetLimitCensus();
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const maxSegments = options.maxSegments ?? DEFAULT_MAX_SEGMENTS;
  let decoderPlan = decoderPlanForVersion(options.revitVersion);
  const segmentScale = segmentScaleFor(fileName, options.geometryScale);
  const familyScale = segmentScale === FAMILY_SEGMENT_SCALE;

  try {
    onProgress?.({ ratio: 0.03, message: "Opening Revit container" });
    const cfb = CFB.read(bytes, { type: "buffer" });
    const partAtomEntry = cfb.FileIndex
      .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
      .find(({ entry, path }) => entry.size > 0 && /\/PartAtom$/i.test(path));
    let partAtom = partAtomEntry
      ? parsePartAtomXml(new TextDecoder().decode(asBytes(partAtomEntry.entry.content)))
      : undefined;
    if (!partAtom) {
      const projectInformationEntry = cfb.FileIndex
        .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
        .find(({ entry, path }) => entry.size > 0 && /\/ProjectInformation$/i.test(path));
      if (projectInformationEntry) {
        partAtom = parseProjectInformationArchive(
          asBytes(projectInformationEntry.entry.content),
        );
      }
    }
    if (!Number.isInteger(options.revitVersion)) {
      const basicFileInfo = cfb.FileIndex
        .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
        .find(({ entry, path }) => entry.size > 0 && /\/BasicFileInfo$/i.test(path));
      if (basicFileInfo) {
        decoderPlan = decoderPlanForVersion(
          revitVersionFromBasicFileInfo(asBytes(basicFileInfo.entry.content)) ?? undefined,
        );
      }
    }
    const nativeMeshCollector = createRevit2027NativeMeshCollector(
      decoderPlan.revitVersion,
      options.maxNativeMeshBytes == null
        ? undefined
        : { maxStoredBytes: options.maxNativeMeshBytes },
    );
    const stairsRunCollector = createRevit2027StairsRunCollector(
      decoderPlan.revitVersion,
    );
    const splitAlternateFrameCollector =
      createRevit2027SplitAlternateFrameCollector(
        decoderPlan.revitVersion,
        options.maxNativeMeshBytes,
      );
    const elemTableEntry = cfb.FileIndex
      .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
      .find(({ entry, path }) => entry.size > 0 && /\/Global\/ElemTable$/i.test(path));
    let elementIndex;
    let elementOwnership: ElementOwnershipDecode | undefined;
    let elementTableData: Uint8Array | undefined;
    if (elemTableEntry) {
      const elemTableBytes = stripRevitPageChecksums(asBytes(elemTableEntry.entry.content));
      const offset = gzipOffsets(elemTableBytes, 1)[0];
      const inflated = offset == null ? null : inflateRevitChunk(elemTableBytes, offset);
      if (inflated) {
        elementTableData = inflated;
        elementIndex = parseElemTable(inflated) ?? undefined;
        const ownership = decodeElementOwnership(inflated);
        if (ownership.format !== "unsupported") elementOwnership = ownership;
      }
    }
    let nativeIdentity: NativeIdentityDecode | undefined;
    if (elementTableData && decoderPlan.revitVersion != null) {
      const history = readStreamSummary(cfb, /\/Global\/History$/i, (data) =>
        decodeRevitDocumentHistory(data, decoderPlan.revitVersion!));
      if (history && history.format !== "unsupported") {
        const identity = decodeRevitNativeIdentities(
          elementTableData,
          history,
          decoderPlan.revitVersion,
        );
        if (identity.format !== "unsupported") nativeIdentity = identity;
      }
    }
    const transmissionEntry = cfb.FileIndex
      .map((entry, index) => ({
        entry,
        path: cfb.FullPaths[index] ?? "",
      }))
      .find(
        ({ entry, path }) =>
          entry.size > 0 && /\/TransmissionData$/i.test(path),
      );
    const decodedTransmissionData = transmissionEntry
      ? parseRevitTransmissionData(asBytes(transmissionEntry.entry.content))
      : undefined;
    const uniqueIdByElement = new Map(
      nativeIdentity?.identities.map((identity) => [
        identity.elementId,
        identity.uniqueId,
      ]) ?? [],
    );
    const transmissionData = decodedTransmissionData
      ? {
          ...decodedTransmissionData,
          references: decodedTransmissionData.references.map((reference) => ({
            ...reference,
            ...(uniqueIdByElement.get(reference.elementId)
              ? { uniqueId: uniqueIdByElement.get(reference.elementId) }
              : {}),
          })),
        }
      : undefined;
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
      const sampleData = stripRevitPageChecksums(asBytes(samplePartition.entry.content));
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
    const cylindersByElement = new Map<number, CylinderPatch[]>();
    const curvesByOwner = new Map<number, SketchCurve[]>();
    let sketchCurves = 0;
    const typeReferences = new Map<number, number>();
    const typeNames = new Map<number, string>();
    const nativeProfiles: NativeProfileLocator[] = [];
    const nativeMaterialDefinitionMap =
      new Map<number, LocatedNativeMaterialDefinition>();
    const familyElementIds = new Set<number>();
    const nativeFamilyDefinitionMap = new Map<number, NativeFamilyDefinition>();
    const familySymbolCandidates: FamilySymbolCandidate[] = [];
    const familySymbolReferenceSets: FamilySymbolReferenceSet[] = [];
    const geometryMaterialCandidates: GeometryMaterialCandidate[] = [];
    const compoundStructureCandidates: CompoundStructureCandidate[] = [];
    const familySymbolMaterialReferenceSets:
      FamilySymbolMaterialReferenceSet[] = [];
    const familySymbolMaterialPlacements: InstancePlacement[] = [];
    const hostRelationCandidates: HostRelationCandidate[] = [];
    const associatedLevelRelationCandidates: AssociatedLevelRelationCandidate[] = [];
    const boundedElementIds = new Set<number>();
    const partitionRecords: PartitionRecordLocator[] = [];
    const partitionRecordIds = new Set<number>();
    const locatedPartitionIds = new Set<number>();
    // `element id -> object marker`, read from every framed object rather than
    // only the chained ones. Used solely as a class key for the ring-synthesis
    // gate below; no object, placement or record is added from it.
    const markerByElement = new Map<number, number>();
    // Some elements carry more than one independently framed native object —
    // a FamilySymbol followed by its GElement, for example. The first marker is
    // retained above for the existing consensus logic; the complete set is
    // needed when an exact class identity decides whether an unlabelled record
    // is a placed object or merely a reusable definition.
    const markersByElement = new Map<number, Set<number>>();
    const cadFileNameOccurrences = new Map<
      string,
      { fileName: string; occurrences: number }
    >();
    let gzipChunks = 0;
    let inflatedBytes = 0;
    const scanLimit = Math.max(maxSegments * 4, 40_000);
    const objectSeedMarkers = new Set([
      ...objectMarkers,
      ...SHAPE_OBJECT_MARKERS,
    ]);

    for (let partitionIndex = 0; partitionIndex < partitions.length; partitionIndex += 1) {
      const partition = partitions[partitionIndex]!;
      const data = stripRevitPageChecksums(asBytes(partition.entry.content));
      const offsets = gzipOffsets(data);
      const stride = offsets.length > 900 ? Math.ceil(offsets.length / 700) : 1;

      // Carried so a chunk with back-references past its own start can be read
      // against the window the writer left behind; see `inflateRevitChunk`.
      let window: Uint8Array | null = null;
      for (let index = 0; index < offsets.length; index += 1) {
        // A chunk that desyncs partway is still read up to that point, and the
        // prefix is not allowed to seed the next chunk's window because it is
        // short of that chunk's true trailing 32 KiB; see `salvageRevitChunk`.
        const read = inflateRevitChunk(data, offsets[index]!, offsets[index + 1], window);
        const inflated = read ?? salvageRevitChunk(data, offsets[index]!, offsets[index + 1], window);
        if (!inflated) continue;
        if (read) window = revitWindowTail(read);
        gzipChunks += 1;
        inflatedBytes += inflated.byteLength;
        for (const fileName of scanPersistedDwgFileNames(inflated)) {
          const key = fileName.toLocaleLowerCase("en-US");
          const current = cadFileNameOccurrences.get(key);
          if (current) current.occurrences += 1;
          else cadFileNameOccurrences.set(key, { fileName, occurrences: 1 });
        }
        if (gzipChunks % 12 === 1) {
          onProgress?.({
            ratio: Math.min(0.82, 0.12 + (index / Math.max(1, offsets.length)) * 0.68),
            message: `Scanning partition ${partitionIndex + 1}/${partitions.length} · page ${index + 1}/${offsets.length} · ${elementBounds.length.toLocaleString()} exact bounds`,
          });
        }
        nativeMeshCollector.scanPage(inflated);
        for (const splitFrame of
          splitAlternateFrameCollector.pushPage(inflated)) {
          nativeMeshCollector.scanAlternateFrame(splitFrame);
        }
        stairsRunCollector.pushPage(inflated);
        if (decoderPlan.revitVersion != null) {
          const materialScan = scanMaterialElementRecords(
            inflated,
            decoderPlan.revitVersion,
          );
          for (const definition of materialScan.definitions) {
            if (nativeMaterialDefinitionMap.has(definition.elementId)) continue;
            nativeMaterialDefinitionMap.set(definition.elementId, {
              ...definition,
              stream: partition.path.replace(/^Root Entry\//, ""),
              chunkIndex: index,
              storedOffset: revitStoredPageOffset(offsets[index]!),
            });
          }
          const relationships = scanPersistedRelationshipCandidates(
            inflated,
            decoderPlan.revitVersion,
          );
          for (const familyId of relationships.familyElementIds) familyElementIds.add(familyId);
          for (const definition of relationships.familyDefinitions) {
            if (!nativeFamilyDefinitionMap.has(definition.familyId)) {
              nativeFamilyDefinitionMap.set(definition.familyId, definition);
            }
          }
          familySymbolCandidates.push(...relationships.familySymbolCandidates);
          familySymbolReferenceSets.push(
            ...relationships.familySymbolReferenceSets,
          );
          geometryMaterialCandidates.push(...relationships.geometryMaterialCandidates);
          compoundStructureCandidates.push(
            ...scanCompoundStructureCandidates(
              inflated,
              decoderPlan.revitVersion,
            ),
          );
          const familySymbolMaterialScan = scanFamilySymbolMaterialPage(
            inflated,
            decoderPlan.revitVersion,
          );
          familySymbolMaterialReferenceSets.push(
            ...familySymbolMaterialScan.referenceSets,
          );
          familySymbolMaterialPlacements.push(
            ...familySymbolMaterialScan.placements,
          );
          hostRelationCandidates.push(
            ...scanHostRelationCandidates(inflated, decoderPlan.revitVersion),
          );
          associatedLevelRelationCandidates.push(
            ...scanAssociatedLevelRelationCandidates(
              inflated,
              decoderPlan.revitVersion,
            ),
          );
        }
        const elementId = leadingU32(inflated);
        if (elementId && elementId !== 0xffffffff) {
          partitionRecordIds.add(elementId);
          if (!locatedPartitionIds.has(elementId)) {
            locatedPartitionIds.add(elementId);
            partitionRecords.push({
              elementId,
              stream: partition.path.replace(/^Root Entry\//, ""),
              chunkIndex: index,
              rawOffset: revitStoredPageOffset(offsets[index]!),
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
            // A curved wall is written as a cylinder triple exactly as a
            // straight one is written as a plane triple, so these are kept
            // rather than counted and dropped.
            const owned = cylindersByElement.get(owner);
            if (owned) owned.push(surface);
            else cylindersByElement.set(owner, [surface]);
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
        // This full-page framing pass also collects the offsets used to seed
        // the object chain. Previously each of as many as fifteen markers ran
        // its own `indexOf` walk over the same page; on the UNBC model those
        // redundant walks were the single largest CPU sample in the loader.
        const classEvidence = decoderPlan.elementBoundsDecoder
          ? scanFramedObjectClassEvidence(
              inflated,
              NATIVE_OBJECT_EVIDENCE_MARKERS,
              objectSeedMarkers,
            )
          : null;
        if (classEvidence) {
          for (const [elementId, marker] of classEvidence.classes) {
            if (!markerByElement.has(elementId)) {
              markerByElement.set(elementId, marker);
            }
          }
          for (const [elementId, pageMarkers] of classEvidence.trackedByElement) {
            const markers = markersByElement.get(elementId) ?? new Set<number>();
            for (const marker of pageMarkers) markers.add(marker);
            markersByElement.set(elementId, markers);
          }
        }
        // Seed the object chain from every validated object marker on the page,
        // not only from the bounds records.
        //
        // Chaining walks until an object fails to verify, and about one record
        // in two hundred does, so a chain grown from a handful of seeds loses
        // everything downstream of its first break. Marker seeds are already
        // self-validating — each candidate has to echo its own length — so
        // seeding from all of them makes a break local instead of terminal, and
        // reaches pages that carry no bounds record at all.
        const chainSeeds = classEvidence?.seedOffsets ?? [];
        if (!classEvidence) {
          // Releases without the full framing-evidence pass keep the original
          // targeted marker scan; do not make them pay for an otherwise unused
          // map of every framed object on the page.
          for (const marker of objectSeedMarkers) {
            for (const seed of markerObjectSeeds(inflated, marker)) chainSeeds.push(seed);
          }
        }
        // A shared shape's marker is too rare to survive the calibration above.
        // There are 250 door B-reps in this file against 51,455 objects under
        // `0x08c6`, so `0x0810` never clears the support floor and the chain
        // reaches one only when it happens to sit beside a seeded neighbour:
        // 20 of the 27 door shapes the placements point at and no pass reads
        // are isolated `0x0810` objects, and they are the shape for 500 doors.
        // Seeding the shape markers directly is what finds them; every
        // candidate still has to echo its own length to be kept.
        for (const record of detectedBoundsRecords) chainSeeds.push(record.recordOffset);
        if (chainSeeds.length) {
          for (const object of chainElementObjects(inflated, chainSeeds)) {
            elementObjects.push(object);
            partitionRecordIds.add(object.elementId);
            const placement = readInstancePlacement(inflated, object);
            if (placement) instancePlacements.set(placement.elementId, placement);
            else {
              // A shape object with no bounds sub-record at all still describes
              // its shape, as parameters or as trimmed planes.
              const local = readLocalBounds(inflated, object) ?? readLocalShape(inflated, object);
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
      stairsRunCollector.finishPartition();
      splitAlternateFrameCollector.finishPartition();
    }
    const stairsRuns = stairsRunCollector.snapshot();
    const persistedCadFileNames = finalisePersistedCadFileNames(
      cadFileNameOccurrences,
    );
    const nativeCompoundStructureDefinitions =
      resolveCompoundStructureDefinitions(
        compoundStructureCandidates,
        new Set(nativeMaterialDefinitionMap.keys()),
      );
    const wallThicknessByType = new Map(
      nativeCompoundStructureDefinitions.map((definition) => [
        definition.typeId,
        definition.layers.reduce((sum, layer) => sum + layer.widthFeet, 0),
      ]),
    );

    onProgress?.({
      ratio: 0.825,
      message: `Reconstructing native surfaces · ${planesByElement.size.toLocaleString()} surface owners`,
    });
    const solidStream = partitions[0]!.path.replace(/^Root Entry\//, "");
    const surfaces = reconstructNativeSurfaces({
      planesByElement,
      cylindersByElement,
      instancePlacements,
      localBounds,
    });
    const {
      solidGroups,
      solidsByElement,
      arcsByElement,
      orientedBoxes,
      faceReadBoxes,
      quadsByElement,
      allSurfaceQuadsByElement,
    } = surfaces;

    onProgress?.({
      ratio: 0.83,
      message: `Resolving placed geometry · ${instancePlacements.size.toLocaleString()} instances`,
    });
    // Most elements that own native geometry have no duplicated-bounds record —
    // 2,818 wall records exist against 7,401 wall objects — so building the
    // scene only from bounds records drops the majority of the walls. Elements
    // with a rebuilt solid and no bounds record get a record synthesised from
    // the solid itself, so they reach the scene as the geometry they are.
    const boundedIds = new Set(elementBounds.map((record) => record.elementId));
    let solidOnlyElements = 0;
    // An element with faces and no record of its own still gets a record
    // synthesised from the hull over those faces — not because the hull is its
    // shape, but because the record is what lets a sketch ring or a placement
    // attach to it later. Removing the synthesis outright cost 15 of the 38
    // drawn coverings and 13 slabs, all of which were being drawn correctly
    // from rings they only received because the record existed. The hull itself
    // is held back at the display gate instead; see `isSheet` in `scene.ts`.
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
      //
      // **Half a thickness goes along the run's own normal, not along both plan
      // axes.** A solid is drawn as an *oriented* box, and padding x and y alike
      // gives an axis-aligned wall a box a full thickness too long: over the 627
      // axis-aligned walls with a synthesised envelope, the slack between the
      // drawn box and this envelope was exactly 1.000 × the wall's own thickness
      // for **627 of 627**. Nothing on screen changed — the solid outranks the
      // envelope everywhere it is drawn — but the envelope is what the rest of
      // the pipeline treats as a second, independent reading of the element, and
      // a reading inflated by a thickness is not one. It is the same error
      // `overlay-diff.ts` was measuring solids with before it was corrected.
      const min = { x: Infinity, y: Infinity, z: Infinity };
      const max = { x: -Infinity, y: -Infinity, z: -Infinity };
      for (const solid of group) {
        const dx = solid.end.x - solid.start.x;
        const dy = solid.end.y - solid.start.y;
        const length = Math.hypot(dx, dy) || 1;
        const normalX = (-dy / length) * solid.thickness * 0.5;
        const normalY = (dx / length) * solid.thickness * 0.5;
        for (const end of [solid.start, solid.end]) {
          for (const sign of [1, -1]) {
            min.x = Math.min(min.x, end.x + normalX * sign);
            min.y = Math.min(min.y, end.y + normalY * sign);
            max.x = Math.max(max.x, end.x + normalX * sign);
            max.y = Math.max(max.y, end.y + normalY * sign);
          }
        }
        min.z = Math.min(min.z, solid.baseElevation);
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

    /*
     * A sketch-based element whose only geometry is its own boundary ring.
     *
     * The ring route runs over `elementBounds`, so an element that never reaches
     * a record is invisible to it however good its curves are — and **7 of this
     * building's 12 ramps are exactly that**. Every one of them owns 4 edges
     * under its Sketch companion and 8 under the id above, and assembled those
     * edges reproduce the export's own footprint to **0.000 ft at the worst
     * corner, 7 of 7**. They were never drawn because no duplicated-bounds
     * record exists for them: 5 ramps carry a second `0x08c6` object holding one
     * and the other 7 simply do not.
     *
     * So a record is synthesised from the ring, exactly as one is above from a
     * rebuilt solid, a face hull or a placement — the record is what lets the
     * rest of the pipeline attach to the element.
     *
     * **The gate is the category, and it is the one the ring route already
     * uses.** Over the whole model 2,891 elements the scan proves real have no
     * record and do own a closed ring, and the export names only 14 of them —
     * synthesising for all of them would be 2,877 records of sketch companions,
     * cached shapes and stray edge sets. Requiring the element's own decoded
     * category to be a `SKETCH_BOUNDARY_CATEGORIES` member cuts that to a
     * population the export names **100%** of, with the ring's plan reproducing
     * the export's box to a median 0.000 ft and a shuffled pairing scoring 0.
     * On this model that is the 2 ramps whose category token survives; the other
     * 25 elements it selects already have a record by another route.
     *
     * Categories are resolved here against the record ids *plus* the candidates,
     * because a candidate has no record yet and so cannot own a token under the
     * pass below. Only the candidates' answers are read; no existing record's
     * category is touched.
     *
     * **The five ramps that used to stay missing are reached by the marker
     * instead.** The file writes exactly **8** `Ramps` category tokens and those
     * five are not among them, so their own category is not in the file to be
     * found — but the object marker at `+16` is a class key they do have, and
     * the members of their class that *do* carry a token can speak for them.
     * That is `markerCategoryConsensus`, and this gate is its whole scope: used
     * as a general category decoder it disagrees with the export 265 times,
     * while used here it selects **42 record-less ring owners of which the
     * export names 42**, out of 843 candidates of which it names 67. Null
     * control, permuting which marker holds which consensus category over ten
     * shifts: 23.1 selected per trial, 8.0 named.
     *
     * A candidate qualifies on having a marker rather than a partition-record
     * id, because the chain is seeded from the markers a *sample* of pages says
     * are common and a twelve-member class never clears that floor: all five
     * ramps have a framed `0x0d7b` object that no chain reaches.
     *
     * **What this still does not reach, recorded rather than papered over.** Of
     * the 67 named candidates, 25 are declined: 13 under `0x0feb`, whose
     * consensus is `Stairs` — an assembly rather than a sketch category; 7 under
     * `0x0f3b`, whose 6,993 members are unanimously `Walls`; 4 under `0x0d40`,
     * whose 20 members carry **no category token at all**, so there is no
     * consensus to read; and 1 under `0x07ef`, at purity 0.35.
     */
    {
      onProgress?.({
        ratio: 0.835,
        message: `Recovering sketch boundaries · ${curvesByOwner.size.toLocaleString()} curve owners`,
      });
      const ringCandidates = new Set<number>();
      for (const owner of curvesByOwner.keys()) {
        // A slab's edges are filed under its Sketch companion at `id - 1`, so a
        // curve owner proposes itself and the element above it.
        for (const elementId of [owner, owner + 1]) {
          if (boundedIds.has(elementId)) continue;
          if (partitionRecordIds.has(elementId) || markerByElement.has(elementId)) {
            ringCandidates.add(elementId);
          }
        }
      }
      if (ringCandidates.size) {
        const known = new Set<number>(boundedIds);
        for (const elementId of ringCandidates) known.add(elementId);
        for (const elementId of markerByElement.keys()) known.add(elementId);
        for (const elementId of elementIndex?.uniqueElementIds ?? []) known.add(elementId);
        for (const record of elementOwnership?.records ?? []) known.add(record.elementId);
        const candidateCategories = resolveElementCategories(categoryTokens, known);
        const markerCategories = markerCategoryConsensus(markerByElement, candidateCategories);
        for (const elementId of ringCandidates) {
          const categoryId =
            candidateCategories.get(elementId) ??
            markerCategories.get(markerByElement.get(elementId) ?? -1);
          if (categoryId == null || !SKETCH_BOUNDARY_CATEGORIES.has(categoryId)) continue;
          const loops = boundaryLoopsFor(elementId, curvesByOwner);
          if (!loops.length) continue;
          const min = { x: Infinity, y: Infinity, z: Infinity };
          const max = { x: -Infinity, y: -Infinity, z: -Infinity };
          for (const loop of loops) {
            for (const [x, y, z] of loop) {
              min.x = Math.min(min.x, x); max.x = Math.max(max.x, x);
              min.y = Math.min(min.y, y); max.y = Math.max(max.y, y);
              min.z = Math.min(min.z, z); max.z = Math.max(max.z, z);
            }
          }
          elementBounds.push({
            elementId,
            stream: solidStream,
            chunkIndex: -1,
            rawOffset: -1,
            recordOffset: -1,
            boundsFeet: ringRecordRise({ min, max }, sketchCurveBounds(elementId, curvesByOwner)),
          });
          boundedIds.add(elementId);
        }
      }
    }

    // A cached family shape is not a building element. Its object carries the
    // same bounds sub-record an element does, so it was being decoded into the
    // model as though it were one — and its box is in the family's own local
    // frame, so it landed at the model origin. In the supplied project 5,995 of
    // them were drawn that way, 97% of them stacked within 50 ft of the origin,
    // and only 7 corresponded to anything in the paired export.
    //
    // The file names them: an ordinary family instance's persisted symbol id
    // points at the local shape it uses, so the referenced set is read straight
    // out of the placements rather than guessed at from position.
    //
    // A stair assembly uses that same field for a run/stringer subelement,
    // which is independently drawable. Its own native category token makes the
    // distinction before cached records are removed.
    // Category-token ownership is resolved against the complete element table,
    // just as `applyNativeCategories` does below. Restricting the known set to
    // placements alone lets an earlier nearby placement steal a stair token.
    const placementCategoryKnownIds = new Set<number>(elementBounds.map(
      (record) => record.elementId,
    ));
    for (const elementId of elementIndex?.uniqueElementIds ?? []) {
      placementCategoryKnownIds.add(elementId);
    }
    const placementCategories = resolveElementCategories(
      categoryTokens,
      placementCategoryKnownIds,
    );
    const sharedGeometryIds = sharedGeometryIdsForPlacements(
      instancePlacements.values(),
      placementCategories,
    );
    let cachedShapeRecords = 0;
    if (sharedGeometryIds.size) {
      cachedShapeRecords = removeRecordsInPlace(elementBounds, (record) =>
        sharedGeometryIds.has(record.elementId));
    }

    // Elements whose envelope was never placed.
    //
    // A second pile sits on the project datum, and it is not the cached shapes
    // removed above — these are ordinary elements whose bounds were read in
    // their family's local frame, so every one of them is centred on (0, 0)
    // instead of where the element stands. In the supplied project that is
    // 3,238 records — 2,012 balusters, 373 mullions, 309 panels — and the
    // paired export has *nothing* within two feet of the datum, against 85.4%
    // of recovered records matching it everywhere else. Real geometry does not
    // stack thousands of elements on a single point.
    let unplacedRecords = 0;
    if (elementBounds.length > MIN_RECORDS_FOR_DATUM_PILE) {
      const spread = boundsOfRecords(elementBounds);
      const wide = Math.max(spread.max.x - spread.min.x, spread.max.y - spread.min.y);
      // A component-scale file legitimately sits on its own origin; a building
      // does not.
      if (wide > DATUM_PILE_MIN_MODEL_SPAN_FEET) {
        // The two guards keep their original sense — a record whose centre is
        // not *outside* the radius is removed — so a non-finite centre is
        // removed here exactly as it was before.
        unplacedRecords += removeRecordsInPlace(elementBounds, ({ boundsFeet }) => {
          const { min, max } = boundsFeet;
          if (Math.abs((min.x + max.x) / 2) > DATUM_PILE_RADIUS_FEET) return false;
          if (Math.abs((min.y + max.y) / 2) > DATUM_PILE_RADIUS_FEET) return false;
          return true;
        });
      }
    }

    onProgress?.({
      ratio: 0.84,
      message: `Resolving native Revit categories · ${elementBounds.length.toLocaleString()} element records`,
    });
    const { nativeCategories, counts } = resolveElementGeometry({
      elementBounds,
      categoryTokens,
      elementIndex,
      elementOwnership,
      elementParameters,
      solidsByElement,
      solidGroups,
      quadsByElement,
      allSurfaceQuadsByElement,
      arcsByElement,
      orientedBoxes,
      faceReadBoxes,
      typeReferences,
      typeNames,
      wallThicknessByType,
      curvesByOwner,
      markerByElement,
      markersByElement,
      stairsRuns,
      instancePlacements,
      localBounds,
    });

    onProgress?.({
      ratio: 0.90,
      message: `Finalising element geometry · ${elementBounds.length.toLocaleString()} element records`,
    });
    const unique = deduplicate(candidates);
    const focused = trimVerticalOutliers(focusPrimaryCluster(unique));
    const used = sampleEvenly(focused, maxSegments);
    const categorisedElements = nativeCategories.directElements + nativeCategories.inheritedElements;
    const relations = resolveNativeRelations({
      elementBounds,
      instancePlacements,
      sharedGeometryIds,
      familyElementIds,
      familySymbolCandidates,
      familySymbolReferenceSets,
      nativeFamilyDefinitionMap,
      nativeMaterialDefinitionMap,
      geometryMaterialCandidates,
      familySymbolMaterialReferenceSets,
      familySymbolMaterialPlacements,
      typeReferences,
      nativeCompoundStructureDefinitions,
      hostRelationCandidates,
      associatedLevelRelationCandidates,
      markerByElement,
    });
    const {
      materials,
      materialElementIds,
      nativeMaterialDefinitions,
      nativeMaterialIndexById,
      proxyMaterialIndexByElement,
      preferredWallMaterialIdsByElement,
      nativeFamilySymbolRelations,
      nativeFamilyDefinitions,
      nativeGeometryMaterialAssignments,
      nativeElementMaterialAssignments,
      nativeCompoundLayerMaterialAssignments,
      nativeHostRelations,
      nativeAssociatedLevelRelations,
    } = relations;
    // Everything both result branches say about the file, minus the one figure
    // each branch counts for itself.
    const reportBasis: Omit<ConvertReportBasis, "approximateSolids"> = {
      revitVersion: decoderPlan.revitVersion,
      nativeCategories,
      categorisedElements,
      elementOwnership,
      nativeIdentity,
      transmissionData,
      persistedCadFileNames,
      sharedGeometryIds,
      nativeCompoundStructureDefinitions,
      ...relations,
    };
    const residualDatumPileIds = residualDatumPileElementIds(
      elementBounds,
      new Set(instancePlacements.keys()),
      new Set(nativeAssociatedLevelRelations.map((relation) => relation.elementId)),
    );
    if (residualDatumPileIds.size) {
      unplacedRecords += removeRecordsInPlace(elementBounds, (record) =>
        residualDatumPileIds.has(record.elementId));
    }
    const nonSceneObjectDefinitionIds = new Set(
      elementBounds
        .filter((record) =>
          isNonSceneObjectDefinition(
            record,
            markersByElement.get(record.elementId),
            instancePlacements.has(record.elementId),
          ),
        )
        .map((record) => record.elementId),
    );
    const nonSceneNativeMeshIds = nonSceneNativeMeshHelperIds(elementBounds);
    for (const elementId of nonSceneObjectDefinitionIds) {
      nonSceneNativeMeshIds.add(elementId);
    }
    for (const record of elementBounds) {
      if (nonSceneNativeMeshIds.has(record.elementId)) {
        record.renderGeometryProvenance = "not-rendered-helper";
      }
    }
    // An element needs a volume to be worth drawing, with one exception: a
    // sketch-bounded element is a plan boundary plus a thickness, and Revit can
    // record that thickness as zero. `prismGeometry` already substitutes a
    // minimum depth for exactly that case, so gating on a three-axis extent
    // beforehand only threw away flat ceilings and ramp landings that had a
    // perfectly good recovered outline.
    const boundedSolids = elementBounds.filter(
      (record) =>
        !nonSceneNativeMeshIds.has(record.elementId) &&
        (
          solidBounds(record) ||
          (record.loops?.length ?? 0) > 0 ||
          (record.stairTreads?.length ?? 0) > 0
        ),
    );
    if (boundedSolids.length) {
      onProgress?.({
        ratio: 0.96,
        message: `Building the display scene · ${boundedSolids.length.toLocaleString()} drawable records`,
      });
      const scene = buildDisplayScene({
        boundedSolids,
        elementBounds,
        stairsRuns,
        sharedGeometryIds,
        instancePlacements,
        elementOwnership,
        nativeHostRelations,
        nativeAssociatedLevelRelations,
        markerByElement,
        nonSceneNativeMeshIds,
        materialElementIds,
        nativeMaterialIndexById,
        proxyMaterialIndexByElement,
        preferredWallMaterialIdsByElement,
        nativeMeshCollector,
      });
      const basis: ConvertReportBasis = {
        ...reportBasis,
        approximateSolids: scene.proxyRecordCount,
      };
      const result: ConvertResult = {
        ok: true,
        fileName,
        byteLength: bytes.byteLength,
        meshes: scene.meshes,
        materials,
        segments: scene.segments,
        elementBounds,
        nativeProfiles,
        nativeCategories,
        schema,
        partitionNames,
        partAtom,
        transmissionData,
        persistedCadFileNames,
        coverage,
        decoderCoverage: buildDecoderCoverage(basis, scene.report),
        origin: scene.origin,
        bbox: scene.bbox,
        levels: scene.levels,
        method: "partition-bounds-recovery",
        elementIndex: elementIndex
          ? {
              ...elementIndex,
              partitionRecordIds: Uint32Array.from([...partitionRecordIds].sort((a, b) => a - b)),
              partitionRecords,
            }
          : undefined,
        elementOwnership,
        nativeIdentity,
        nativeMaterialDefinitions,
        nativeFamilySymbolRelations,
        nativeFamilyDefinitions,
        nativeGeometryMaterialAssignments,
        nativeElementMaterialAssignments,
        nativeCompoundStructureDefinitions,
        nativeCompoundLayerMaterialAssignments,
        nativeHostRelations,
        nativeAssociatedLevelRelations,
        warnings: buildWarnings(basis, scene.report),
        stats: {
          streamCount: cfb.FileIndex.filter((entry) => entry.size > 0).length,
          partitionStreams: partitions.length,
          gzipChunks,
          inflatedBytes,
          candidatesFound: elementBounds.length,
          candidatesFocused: scene.displayRecordCount,
          candidatesUsed: scene.proxyRecordCount + scene.nativeCoveredRecordCount,
          // Counted from the batches themselves: a drawn item is no longer
          // always an eight-vertex box.
          vertexCount: scene.meshes.reduce((total, mesh) => total + mesh.positions.length / 3, 0),
          triangleCount: scene.meshes.reduce((total, mesh) => total + mesh.indices.length / 3, 0),
          meshCount: scene.meshes.length,
          boundsRecordsFound: elementBounds.length,
          solidBoundsRecords: boundedSolids.length,
          elementObjects: elementObjects.length,
          parameterElements: elementParameters.size,
          surfaces: surfaceCounts,
          nativeSolids: solidsByElement.size,
          faceOnlyElements: quadsByElement.size,
          placedInstances: orientedBoxes.size,
          rejectedOrientedBoxes: counts.rejectedOrientedBoxes,
          cachedShapeRecords,
          unplacedRecords,
          sketchBoundaryElements: counts.sketchBoundaryElements,
          sketchBoundedFacetHulls: counts.sketchBoundedFacetHulls,
          completedFlatSketches: counts.completedFlatSketches,
          sweptRailings: counts.sweptRailings,
          curvedWalls: counts.curvedWalls,
          inferredCurtainPanels: scene.report.inferredCurtainPanels,
          doorLeaves: counts.doorLeaves,
          doorLeavesFromShape: counts.doorLeavesFromShape,
          adoptedStairBoxes: counts.adoptedStairBoxes,
          clippedSolids: counts.clippedSolids,
          extendedSolids: counts.extendedSolids,
          recoveredWallJoinEnds: counts.recoveredWallJoinEnds,
          shrunkSolids: counts.shrunkSolids,
          narrowedSolidBands: counts.narrowedSolidBands,
          disownedSolids: counts.disownedSolids,
          narrowedFacetBands: counts.narrowedFacetBands,
          unnamedSketchElements: counts.unnamedSketchElements,
          sketchCurves,
          solidOnlyElements,
          instanceOnlyElements,
          unclassifiedElements: scene.report.displaySelection.unclassifiedCount,
          typedElements: typeReferences.size,
          namedTypeElements: counts.namedTypeElements,
          elementObjectMarker: dominantMarker(elementObjects) ?? undefined,
          fittedLimitsReached: limitCensus(),
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

    const basis: ConvertReportBasis = {
      ...reportBasis,
      approximateSolids: used.length,
    };
    const coordinateReport: ConvertCoordinateReport = {
      kind: "coordinate",
      familyScale,
      omittedIsolatedCandidates: unique.length - focused.length,
    };
    const result: ConvertResult = {
      ok: true,
      fileName,
      byteLength: bytes.byteLength,
      meshes,
      materials,
      segments: used,
      elementBounds,
      nativeProfiles,
      nativeCategories,
      schema,
      partitionNames,
      partAtom,
      transmissionData,
      persistedCadFileNames,
      coverage,
      decoderCoverage: buildDecoderCoverage(basis, coordinateReport),
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
      elementOwnership,
      nativeIdentity,
      nativeMaterialDefinitions,
      nativeFamilySymbolRelations,
      nativeFamilyDefinitions,
      nativeGeometryMaterialAssignments,
      nativeElementMaterialAssignments,
      nativeCompoundStructureDefinitions,
      nativeCompoundLayerMaterialAssignments,
      nativeHostRelations,
      nativeAssociatedLevelRelations,
      warnings: buildWarnings(basis, coordinateReport),
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
        fittedLimitsReached: limitCensus(),
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
