/**
 * The page walk: one pass over every inflated page of every partition stream.
 *
 * This is the only stage that reads the file's own bytes, and everything the
 * rest of the conversion works from is collected here. Each page is handed to
 * every decoder that can read something out of it — element envelopes, category
 * tokens, native surfaces, sketch curves, placements, materials, relations,
 * parameters, DWG names — and each decoder's findings are accumulated by
 * element id.
 *
 * **Why one pass rather than one pass per decoder.** A partition stream is
 * megabytes of gzip chunks and inflating one is the expensive part; the model
 * inflated here is 3,300 pages. Every additional walk would re-inflate all of
 * them, so the scanners share the page while it is in hand.
 *
 * Two things in the loop are subtler than they look and are commented where
 * they happen: the sliding window a chunk with back-references past its own
 * start is read against, and the seeding of the object chain from every
 * validated marker on the page rather than from the bounds records alone.
 *
 * The collectors are created here because they are stateful across pages and
 * partitions. `nativeMeshCollector` outlives the walk — the display scene asks
 * it for a snapshot once it knows which shapes were placed — so it is returned
 * rather than snapshotted here.
 */
import { detectDuplicatedBoundsRecords } from "./bounds-records.ts";
import { persistedCadFileNames as finalisePersistedCadFileNames, scanPersistedDwgFileNames } from "./cad-files.ts";
import { resolveCompoundStructureDefinitions, scanCompoundStructureCandidates } from "./compound-structure-materials.ts";
import {
  chainElementObjects,
  markerObjectSeeds,
  scanFramedObjectClassEvidence,
} from "./element-objects.ts";
import { collectElementParameters } from "./element-parameters.ts";
import { collectTypeLinks } from "./element-types.ts";
import { scanPersistedRelationshipCandidates } from "./family-material-relations.ts";
import { scanFamilySymbolMaterialPage } from "./family-symbol-materials.ts";
import { scanHostRelationCandidates } from "./host-relations.ts";
import {
  readInstancePlacement,
  readLocalBounds,
  readLocalShape,
  SHAPE_OBJECT_MARKERS,
} from "./instanced-geometry.ts";
import { scanAssociatedLevelRelationCandidates } from "./level-relations.ts";
import { scanMaterialElementRecords } from "./material-records.ts";
import { collectCategoryTokens } from "./native-categories.ts";
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
import { createRevit2027NativeMeshCollector } from "./revit-2027-native-mesh-bridge.ts";
import { createRevit2027SplitAlternateFrameCollector } from "./revit-2027-split-alternate-frame-collector.ts";
import { createRevit2027StairsRunCollector } from "./revit-2027-stairs-run-collector.ts";
import { scanSegments } from "./segment-scan.ts";
import { collectOwnedSurfaces } from "./surfaces.ts";
import { collectSketchCurves } from "./sketch-curves.ts";

import type { OpenedRevitContainer } from "./convert-container.ts";
import type { NativeCompoundStructureDefinition } from "./compound-structure-materials.ts";
import type { ElementObject } from "./element-objects.ts";
import type {
  FamilySymbolCandidate,
  FamilySymbolReferenceSet,
  GeometryMaterialCandidate,
  NativeFamilyDefinition,
} from "./family-material-relations.ts";
import type { FamilySymbolMaterialReferenceSet } from "./family-symbol-materials.ts";
import type { HostRelationCandidate } from "./host-relations.ts";
import type { InstancePlacement, LocalBounds } from "./instanced-geometry.ts";
import type { AssociatedLevelRelationCandidate } from "./level-relations.ts";
import type { CategoryToken } from "./native-categories.ts";
import type { PersistedCadFileName } from "./cad-files.ts";
import type { Revit2027NativeMeshCollector } from "./revit-2027-native-mesh-bridge.ts";
import type { Revit2027StairsRunAndLandingAggregate } from "./revit-2027-stairs-aggregate.ts";
import type { CompoundStructureCandidate } from "./compound-structure-materials.ts";
import type { SegmentScale } from "./segment-scan.ts";
import type { CylinderPatch, PlanePatch } from "./surfaces.ts";
import type { SketchCurve } from "./sketch-curves.ts";
import type {
  ElementBoundsRecord,
  ElementParameter,
  LocatedNativeMaterialDefinition,
  NativeProfileLocator,
  PartitionRecordLocator,
  ProgressUpdate,
  Segment,
} from "./types";

/** Backstop so a pathological stream cannot turn category recovery quadratic. */
const MAX_CATEGORY_TOKENS = 400_000;

/**
 * Exact native classes used for narrow category/helper decisions downstream.
 * The scan only records which of them frames each element; the decisions
 * themselves are made where the record is resolved.
 */
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

export type PartitionScanInput = {
  partitions: OpenedRevitContainer["partitions"];
  decoderPlan: OpenedRevitContainer["decoderPlan"];
  objectMarkers: number[];
  /** Cap on diagnostic segments; the scan stops well before exhausting memory. */
  maxSegments: number;
  /** Feet per stored unit, which differs for a family file. */
  segmentScale: SegmentScale;
  maxNativeMeshBytes: number | undefined;
  onProgress?: (update: ProgressUpdate) => void;
};

export type PartitionScan = {
  /** Diagnostic coordinate segments, collected only when no record decoder ran. */
  candidates: Segment[];
  categoryTokens: CategoryToken[];
  /** One record per element with a duplicated-bounds block of its own. */
  elementBounds: ElementBoundsRecord[];
  elementObjects: ElementObject[];
  instancePlacements: Map<number, InstancePlacement>;
  localBounds: Map<number, LocalBounds>;
  elementParameters: Map<number, Map<number, ElementParameter>>;
  surfaceCounts: { planes: number; cylinders: number; verticalPlanes: number };
  planesByElement: Map<number, PlanePatch[]>;
  cylindersByElement: Map<number, CylinderPatch[]>;
  curvesByOwner: Map<number, SketchCurve[]>;
  sketchCurves: number;
  typeReferences: Map<number, number>;
  typeNames: Map<number, string>;
  nativeProfiles: NativeProfileLocator[];
  nativeMaterialDefinitionMap: Map<number, LocatedNativeMaterialDefinition>;
  familyElementIds: Set<number>;
  nativeFamilyDefinitionMap: Map<number, NativeFamilyDefinition>;
  familySymbolCandidates: FamilySymbolCandidate[];
  familySymbolReferenceSets: FamilySymbolReferenceSet[];
  geometryMaterialCandidates: GeometryMaterialCandidate[];
  familySymbolMaterialReferenceSets: FamilySymbolMaterialReferenceSet[];
  familySymbolMaterialPlacements: InstancePlacement[];
  hostRelationCandidates: HostRelationCandidate[];
  associatedLevelRelationCandidates: AssociatedLevelRelationCandidate[];
  /** Where each element id was seen, in container coordinates. */
  partitionRecords: PartitionRecordLocator[];
  /** Every element id the walk proved is written into a partition. */
  partitionRecordIds: Set<number>;
  markerByElement: Map<number, number>;
  markersByElement: Map<number, Set<number>>;
  gzipChunks: number;
  inflatedBytes: number;
  stairsRuns: ReadonlyMap<number, Revit2027StairsRunAndLandingAggregate>;
  persistedCadFileNames: PersistedCadFileName[];
  nativeCompoundStructureDefinitions: NativeCompoundStructureDefinition[];
  /** Total layer width per wall type, which a curved wall's sketch needs. */
  wallThicknessByType: Map<number, number>;
  /** Kept live: the display scene asks it for a snapshot once placements are known. */
  nativeMeshCollector: Revit2027NativeMeshCollector;
};

export function scanPartitions(input: PartitionScanInput): PartitionScan {
  const {
    partitions,
    decoderPlan,
    objectMarkers,
    maxSegments,
    segmentScale,
    maxNativeMeshBytes,
    onProgress,
  } = input;
  const nativeMeshCollector = createRevit2027NativeMeshCollector(
    decoderPlan.revitVersion,
    maxNativeMeshBytes == null ? undefined : { maxStoredBytes: maxNativeMeshBytes },
  );
  const stairsRunCollector = createRevit2027StairsRunCollector(
    decoderPlan.revitVersion,
  );
  const splitAlternateFrameCollector =
    createRevit2027SplitAlternateFrameCollector(
      decoderPlan.revitVersion,
      maxNativeMeshBytes,
    );
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
  // gate in `convert-synthesised-records.ts`; no object, placement or record is
  // added from it.
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
  return {
    candidates,
    categoryTokens,
    elementBounds,
    elementObjects,
    instancePlacements,
    localBounds,
    elementParameters,
    surfaceCounts,
    planesByElement,
    cylindersByElement,
    curvesByOwner,
    sketchCurves,
    typeReferences,
    typeNames,
    nativeProfiles,
    nativeMaterialDefinitionMap,
    familyElementIds,
    nativeFamilyDefinitionMap,
    familySymbolCandidates,
    familySymbolReferenceSets,
    geometryMaterialCandidates,
    familySymbolMaterialReferenceSets,
    familySymbolMaterialPlacements,
    hostRelationCandidates,
    associatedLevelRelationCandidates,
    partitionRecords,
    partitionRecordIds,
    markerByElement,
    markersByElement,
    gzipChunks,
    inflatedBytes,
    stairsRuns,
    persistedCadFileNames,
    nativeCompoundStructureDefinitions,
    wallThicknessByType,
    nativeMeshCollector,
  };
}
