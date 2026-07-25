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
  boundsOfRecords,
  detectDuplicatedBoundsRecords,
  solidBounds,
} from "./bounds-records.ts";
import { chainElementObjects, dominantMarker, type ElementObject } from "./element-objects.ts";
import { collectElementParameters } from "./element-parameters.ts";
import { collectTypeLinks } from "./element-types.ts";
import { collectOwnedSurfaces, type PlanePatch } from "./surfaces.ts";
import { wallSolids } from "./native-geometry.ts";
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

type ProgressCallback = (update: ProgressUpdate) => void;

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

    const candidates: Segment[] = [];
    const categoryTokens: CategoryToken[] = [];
    const elementBounds: ElementBoundsRecord[] = [];
    const elementObjects: ElementObject[] = [];
    const elementParameters = new Map<number, Map<number, ElementParameter>>();
    const surfaceCounts = { planes: 0, cylinders: 0, verticalPlanes: 0 };
    const planesByElement = new Map<number, PlanePatch[]>();
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
        // Seed the object chain from the records just found: objects that carry
        // no bounds record are still linked into the chain and recoverable.
        if (detectedBoundsRecords.length) {
          for (const object of chainElementObjects(
            inflated,
            detectedBoundsRecords.map((record) => record.recordOffset),
          )) {
            elementObjects.push(object);
            partitionRecordIds.add(object.elementId);
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

    onProgress?.({ ratio: 0.84, message: "Resolving native Revit categories" });
    const nativeCategories = applyNativeCategories(
      elementBounds,
      categoryTokens,
      elementIndex?.uniqueElementIds,
    );

    const solidsByElement = new Map<number, ReturnType<typeof wallSolids>[number]>();
    for (const solid of wallSolids(planesByElement)) {
      // One element can own several solids; keep the longest as its body.
      const existing = solidsByElement.get(solid.elementId);
      const length = (candidate: typeof solid) =>
        Math.hypot(candidate.end.x - candidate.start.x, candidate.end.y - candidate.start.y);
      if (!existing || length(solid) > length(existing)) solidsByElement.set(solid.elementId, solid);
    }

    let namedTypeElements = 0;
    for (const record of elementBounds) {
      const parameters = elementParameters.get(record.elementId);
      if (parameters?.size) record.parameters = [...parameters.values()];
      record.solid = solidsByElement.get(record.elementId);
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
    const boundedSolids = elementBounds.filter(solidBounds);
    if (boundedSolids.length) {
      const displaySelection = selectDisplayBounds(boundedSolids);
      const displayBounds = displaySelection.records;
      const bounds = boundsOfRecords(displayBounds);
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
          ...(displaySelection.omittedUnknownCount
            ? [`${displaySelection.omittedUnknownCount.toLocaleString()} unclassified record envelopes remain in the audit/export but are hidden from the default category scene.`]
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
          vertexCount: displayBounds.length * 8,
          triangleCount: displayBounds.length * 12,
          meshCount: meshes.length,
          boundsRecordsFound: elementBounds.length,
          solidBoundsRecords: boundedSolids.length,
          elementObjects: elementObjects.length,
          parameterElements: elementParameters.size,
          surfaces: surfaceCounts,
          nativeSolids: solidsByElement.size,
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
