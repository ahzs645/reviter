/// <reference types="vite/client" />

import { IfcAPI } from "web-ifc";

import { boxDifference, type Box } from "./drawn-bounds.ts";
import { ifcGeometryDiffStatus } from "./geometry-diff-status.ts";
import { compareRvtToIfc } from "./regression.ts";
import {
  addSurfaceTriangle,
  emptySurfaceOrientationTotals,
  hasMaterialSlopeDifference,
  unpackSurfaceOrientationSignatures,
  type SurfaceOrientationTotals,
} from "./surface-orientation.ts";
import type {
  IfcElementTypeMatch,
  IfcMatchedElement,
  IfcReferenceManifest,
  PairedRegressionResult,
  ProgressUpdate,
  ReferenceMeshData,
  RvtRegressionInput,
  Vec3,
} from "./types.ts";

/**
 * Where `web-ifc.wasm` lives depends on how this module was bundled.
 *
 * The Pages build copies the binary next to the emitted worker, so a sibling
 * URL resolves. Under Vite there is no such copy — `lib/reviter/web-ifc.wasm`
 * does not exist in the source tree — and the sibling URL 404s at `Init`,
 * taking IFC pairing down on that path entirely. The candidates are therefore
 * tried in order and the first one that actually answers is used, so the
 * bundled layout keeps working unchanged and the unbundled one starts working.
 */
const WEB_IFC_WASM_CANDIDATES = [
  new URL("./web-ifc.wasm", import.meta.url).href,
  new URL("../../node_modules/web-ifc/web-ifc.wasm", import.meta.url).href,
];

let resolvedWasmUrl: string | null = null;

async function webIfcWasmUrl(): Promise<string> {
  if (resolvedWasmUrl) return resolvedWasmUrl;
  for (const candidate of WEB_IFC_WASM_CANDIDATES) {
    try {
      const response = await fetch(candidate, { method: "HEAD" });
      if (response.ok) {
        resolvedWasmUrl = candidate;
        return candidate;
      }
    } catch {
      // A candidate that cannot be reached is simply not the right one.
    }
  }
  // Nothing answered; let `Init` fail against the first candidate so the error
  // names a real URL rather than a guess.
  resolvedWasmUrl = WEB_IFC_WASM_CANDIDATES[0]!;
  return resolvedWasmUrl;
}

type ProgressCallback = (update: ProgressUpdate) => void;
type ReferenceBatch = {
  positions: number[];
  indices: number[];
  elementIds: number[];
  vertexCount: number;
  matched: boolean;
  diffStatus: ReferenceMeshData["diffStatus"];
  batchNumber: number;
};

const MAX_REFERENCE_BATCH_VERTICES = 240_000;

function flushReferenceBatch(batch: ReferenceBatch, meshes: ReferenceMeshData[]): void {
  if (!batch.vertexCount) return;
  meshes.push({
    name: `${
      batch.diffStatus === "aligned"
        ? "Geometrically aligned"
        : batch.diffStatus === "different"
          ? "Geometric differences"
          : "IFC context"
    } ${batch.batchNumber}`,
    positions: new Float32Array(batch.positions),
    indices: new Uint32Array(batch.indices),
    elementIds: new Uint32Array(batch.elementIds),
    color: batch.diffStatus === "aligned"
      ? [0.2, 0.86, 0.76]
      : batch.diffStatus === "different"
        ? [1, 0.23, 0.28]
        : [0.1, 0.28, 0.32],
    matched: batch.matched,
    diffStatus: batch.diffStatus,
  });
  batch.positions = [];
  batch.indices = [];
  batch.elementIds = [];
  batch.vertexCount = 0;
  batch.batchNumber += 1;
}

function appendReferenceGeometry(
  batch: ReferenceBatch,
  meshes: ReferenceMeshData[],
  vertices: Float32Array,
  indices: Uint32Array,
  matrix: Array<number>,
  elementId: number,
): void {
  const incomingVertices = vertices.length / 6;
  if (batch.vertexCount && batch.vertexCount + incomingVertices > MAX_REFERENCE_BATCH_VERTICES) {
    flushReferenceBatch(batch, meshes);
  }
  const vertexOffset = batch.vertexCount;
  for (let vertex = 0; vertex + 2 < vertices.length; vertex += 6) {
    const point = transformPoint(
      matrix,
      vertices[vertex]!,
      vertices[vertex + 1]!,
      vertices[vertex + 2]!,
    );
    batch.positions.push(point.x, -point.z, point.y);
  }
  for (const index of indices) batch.indices.push(index + vertexOffset);
  for (let triangle = 0; triangle < indices.length / 3; triangle += 1) {
    batch.elementIds.push(elementId);
  }
  batch.vertexCount += incomingVertices;
}

function scalar(value: unknown): string {
  if (value && typeof value === "object" && "value" in value) {
    return String((value as { value: unknown }).value ?? "");
  }
  return value == null ? "" : String(value);
}

function expressReference(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const candidate of [record.value, record.expressID, record.expressId]) {
    if (typeof candidate === "number" && Number.isSafeInteger(candidate)) return candidate;
  }
  return undefined;
}

function transformPoint(matrix: Array<number>, x: number, y: number, z: number): Vec3 {
  return {
    x: matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
    y: matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
    z: matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
  };
}

const FEET_PER_METRE = 3.280839895;
const GEOMETRY_TOLERANCE_FEET = 0.5;

function addPointToBox(box: Box, x: number, y: number, z: number): void {
  box[0] = Math.min(box[0], x);
  box[1] = Math.min(box[1], y);
  box[2] = Math.min(box[2], z);
  box[3] = Math.max(box[3], x);
  box[4] = Math.max(box[4], y);
  box[5] = Math.max(box[5], z);
}

function displayBoundsByElement(packed?: Float64Array): Map<number, Box> {
  const result = new Map<number, Box>();
  if (!packed) return result;
  for (let index = 0; index + 6 < packed.length; index += 7) {
    result.set(packed[index]!, [
      packed[index + 1]!,
      packed[index + 2]!,
      packed[index + 3]!,
      packed[index + 4]!,
      packed[index + 5]!,
      packed[index + 6]!,
    ]);
  }
  return result;
}

export async function analyzeIfcReference(
  input: ArrayBuffer | Uint8Array,
  fileName: string,
  rvt: RvtRegressionInput,
  onProgress?: ProgressCallback,
): Promise<PairedRegressionResult> {
  const started = performance.now();
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const api = new IfcAPI();
  onProgress?.({ ratio: 0.03, message: "Starting local IFC parser" });
  const wasmUrl = await webIfcWasmUrl();
  await api.Init((path) => (path.endsWith(".wasm") ? wasmUrl : path), true);
  onProgress?.({ ratio: 0.1, message: "Opening IFC reference model" });
  const modelId = api.OpenModel(bytes, {
    // Keep the export in its authored project coordinates. The recovered RVT
    // bounds are absolute feet and the viewer already subtracts `result.origin`
    // from both sources when it registers the overlay. Asking web-ifc to apply
    // a second, opaque origin shift makes every otherwise aligned box differ.
    COORDINATE_TO_ORIGIN: false,
    MEMORY_LIMIT: 2_000_000_000,
  });
  if (modelId < 0) throw new Error("web-ifc could not open the reference model.");

  try {
    const elemTableIds = new Set<number>(rvt.elemTableIds);
    const partitionRecordIds = new Set<number>(rvt.partitionRecordIds);
    const recoveredIds = new Set<number>(rvt.recoveredIds ?? []);
    const partitionRecordById = new Map(
      rvt.partitionRecords.map((record) => [record.elementId, record] as const),
    );
    const matchedExpressIds = new Set<number>();
    const revitIdByExpressId = new Map<number, number>();
    const ifcTypeByExpressId = new Map<number, string>();
    const elementTypes: IfcElementTypeMatch[] = [];
    const matchedSamples: IfcMatchedElement[] = [];
    let elementCount = 0;
    let taggedElementCount = 0;
    let matchedElementCount = 0;
    let storeyCount = 0;

    const types = api.GetAllTypesOfModel(modelId);
    const aggregateParentExpressIds = new Set<number>();
    const aggregateRelationType = types.find(
      (type) => type.typeName.toUpperCase() === "IFCRELAGGREGATES",
    );
    if (aggregateRelationType) {
      const relationIds = api.GetLineIDsWithType(modelId, aggregateRelationType.typeID);
      for (let index = 0; index < relationIds.size(); index += 1) {
        const relation = api.GetLine(modelId, relationIds.get(index)) as Record<string, unknown>;
        const parent = expressReference(relation.RelatingObject);
        if (parent != null) aggregateParentExpressIds.add(parent);
      }
    }
    const storeyType = types.find((type) => type.typeName.toUpperCase() === "IFCBUILDINGSTOREY");
    if (storeyType) storeyCount = api.GetLineIDsWithType(modelId, storeyType.typeID).size();

    const elementTypeRows = types.filter((type) => api.IsIfcElement(type.typeID));
    for (let typeIndex = 0; typeIndex < elementTypeRows.length; typeIndex += 1) {
      const type = elementTypeRows[typeIndex]!;
      const ids = api.GetLineIDsWithType(modelId, type.typeID);
      let tagged = 0;
      let matched = 0;
      let matchedElemTable = 0;
      let matchedPartitionRecords = 0;
      const matchedIds: number[] = [];
      elementCount += ids.size();
      for (let index = 0; index < ids.size(); index += 1) {
        const expressId = ids.get(index);
        ifcTypeByExpressId.set(expressId, type.typeName.toUpperCase());
        const line = api.GetLine(modelId, expressId) as Record<string, unknown>;
        const rawTag = scalar(line.Tag).trim();
        if (!/^\d+$/.test(rawTag)) continue;
        tagged += 1;
        taggedElementCount += 1;
        const revitElementId = Number(rawTag);
        const inElemTable = elemTableIds.has(revitElementId);
        const inPartitionRecords = partitionRecordIds.has(revitElementId);
        // An element rebuilt from a solid or a sketch alone is in neither index
        // and is still, demonstrably, in the file.
        const inRecovered = recoveredIds.has(revitElementId);
        if (!inElemTable && !inPartitionRecords && !inRecovered) continue;
        matched += 1;
        matchedIds.push(revitElementId);
        if (inElemTable) matchedElemTable += 1;
        if (inPartitionRecords) matchedPartitionRecords += 1;
        matchedElementCount += 1;
        matchedExpressIds.add(expressId);
        revitIdByExpressId.set(expressId, revitElementId);
        if (matchedSamples.length < 12) {
          const partitionRecord = partitionRecordById.get(revitElementId);
          matchedSamples.push({
            expressId,
            revitElementId,
            ifcType: type.typeName.toUpperCase(),
            name: scalar(line.Name) || `Element ${revitElementId}`,
            hasGeometry: false,
            evidence: inElemTable && inPartitionRecords
              ? "both"
              : inElemTable
                ? "elem-table"
                : inPartitionRecords
                  ? "partition-record"
                  : "recovered-geometry",
            partitionRecord: partitionRecord
              ? {
                  stream: partitionRecord.stream,
                  chunkIndex: partitionRecord.chunkIndex,
                  rawOffset: partitionRecord.rawOffset,
                  inflatedBytes: partitionRecord.inflatedBytes,
                }
              : undefined,
          });
        }
      }
      elementTypes.push({
        ifcType: type.typeName.toUpperCase(),
        count: ids.size(),
        tagged,
        matchedRvtRecords: matched,
        matchedElemTable,
        matchedPartitionRecords,
        matchedIds: Uint32Array.from(matchedIds),
      });
      onProgress?.({
        ratio: 0.12 + ((typeIndex + 1) / Math.max(1, elementTypeRows.length)) * 0.24,
        message: `Matching IFC tags · ${matchedElementCount.toLocaleString()} RVT records`,
      });
    }

    const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
    const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
    const geometryExpressIds = new Set<number>();
    const truthBoundsByElement = new Map<number, Box>();
    const truthSurfaceOrientationsByElement = new Map<number, SurfaceOrientationTotals>();
    let geometryProducts = 0;
    let placedGeometries = 0;
    let vertexCount = 0;
    let triangleCount = 0;

    api.StreamAllMeshes(modelId, (mesh, index, total) => {
      geometryProducts += 1;
      geometryExpressIds.add(mesh.expressID);
      const revitElementId = revitIdByExpressId.get(mesh.expressID);
      for (let placementIndex = 0; placementIndex < mesh.geometries.size(); placementIndex += 1) {
        const placed = mesh.geometries.get(placementIndex);
        const geometry = api.GetGeometry(modelId, placed.geometryExpressID);
        const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
        const indices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
        placedGeometries += 1;
        vertexCount += vertices.length / 6;
        triangleCount += indices.length / 3;
        const displayPoints = revitElementId == null
          ? null
          : new Float64Array((vertices.length / 6) * 3);
        for (let vertex = 0; vertex + 2 < vertices.length; vertex += 6) {
          const point = transformPoint(
            placed.flatTransformation,
            vertices[vertex]!,
            vertices[vertex + 1]!,
            vertices[vertex + 2]!,
          );
          min.x = Math.min(min.x, point.x);
          min.y = Math.min(min.y, point.y);
          min.z = Math.min(min.z, point.z);
          max.x = Math.max(max.x, point.x);
          max.y = Math.max(max.y, point.y);
          max.z = Math.max(max.z, point.z);
          if (revitElementId != null) {
            let truthBox = truthBoundsByElement.get(revitElementId);
            if (!truthBox) {
              truthBox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
              truthBoundsByElement.set(revitElementId, truthBox);
            }
            // Match the displayed reference frame: Y-up metres -> Z-up feet.
            addPointToBox(
              truthBox,
              point.x * FEET_PER_METRE,
              -point.z * FEET_PER_METRE,
              point.y * FEET_PER_METRE,
            );
            const displayOffset = (vertex / 6) * 3;
            displayPoints![displayOffset] = point.x * FEET_PER_METRE;
            displayPoints![displayOffset + 1] = -point.z * FEET_PER_METRE;
            displayPoints![displayOffset + 2] = point.y * FEET_PER_METRE;
          }
        }
        if (revitElementId != null && displayPoints) {
          const totals = truthSurfaceOrientationsByElement.get(revitElementId)
            ?? emptySurfaceOrientationTotals();
          for (let triangle = 0; triangle + 2 < indices.length; triangle += 3) {
            const a = indices[triangle]! * 3;
            const b = indices[triangle + 1]! * 3;
            const c = indices[triangle + 2]! * 3;
            addSurfaceTriangle(
              totals,
              { x: displayPoints[a]!, y: displayPoints[a + 1]!, z: displayPoints[a + 2]! },
              { x: displayPoints[b]!, y: displayPoints[b + 1]!, z: displayPoints[b + 2]! },
              { x: displayPoints[c]!, y: displayPoints[c + 1]!, z: displayPoints[c + 2]! },
            );
          }
          truthSurfaceOrientationsByElement.set(revitElementId, totals);
        }
        geometry.delete();
      }
      if (typeof mesh.delete === "function") mesh.delete();
      if (index % 250 === 0 || index + 1 === total) {
        onProgress?.({
          ratio: 0.38 + ((index + 1) / Math.max(1, total)) * 0.27,
          message: `Measuring IFC geometry · ${(index + 1).toLocaleString()} / ${total.toLocaleString()}`,
        });
      }
    });

    const rvtDisplayBounds = displayBoundsByElement(rvt.displayBounds);
    const rvtSurfaceOrientationsByElement = unpackSurfaceOrientationSignatures(
      rvt.surfaceOrientationSignatures,
    );
    const incompleteStairTopologyIds = new Set(
      rvt.incompleteStairTopologyIds ?? [],
    );
    const diffStatusByElement = new Map<number, ReferenceMeshData["diffStatus"]>();
    let geometricComparedElementCount = 0;
    let geometricAlignedElementCount = 0;
    let geometricDifferentElementCount = 0;
    let geometricShapeDifferentElementCount = 0;
    const geometricShapeDifferentElementIds: number[] = [];
    for (const [elementId, truthBox] of truthBoundsByElement) {
      geometricComparedElementCount += 1;
      const recoveredBox = rvtDisplayBounds.get(elementId);
      if (!recoveredBox) {
        diffStatusByElement.set(elementId, "different");
        geometricDifferentElementCount += 1;
        continue;
      }
      const difference = boxDifference(recoveredBox, truthBox);
      const boundsAligned =
        difference.centreErrorFeet < GEOMETRY_TOLERANCE_FEET &&
        difference.sizeErrorFeet < GEOMETRY_TOLERANCE_FEET;
      const materialSlopeDifferent = hasMaterialSlopeDifference(
        rvtSurfaceOrientationsByElement.get(elementId),
        truthSurfaceOrientationsByElement.get(elementId),
      );
      const stairTopologyIncomplete = incompleteStairTopologyIds.has(elementId);
      const diffStatus = ifcGeometryDiffStatus(
        boundsAligned,
        materialSlopeDifferent,
        stairTopologyIncomplete,
      );
      const aligned = diffStatus === "aligned";
      const shapeDifferent = boundsAligned && !aligned;
      diffStatusByElement.set(elementId, diffStatus);
      if (aligned) geometricAlignedElementCount += 1;
      else {
        geometricDifferentElementCount += 1;
        if (shapeDifferent) {
          geometricShapeDifferentElementCount += 1;
          geometricShapeDifferentElementIds.push(elementId);
        }
      }
    }

    const referenceMeshes: ReferenceMeshData[] = [];
    const batches = new Map<ReferenceMeshData["diffStatus"], ReferenceBatch>([
      ["aligned", {
        positions: [], indices: [], elementIds: [], vertexCount: 0, matched: true,
        diffStatus: "aligned", batchNumber: 1,
      }],
      ["different", {
        positions: [], indices: [], elementIds: [], vertexCount: 0, matched: true,
        diffStatus: "different", batchNumber: 1,
      }],
      ["context", {
        positions: [], indices: [], elementIds: [], vertexCount: 0, matched: false,
        diffStatus: "context", batchNumber: 1,
      }],
    ]);
    api.StreamAllMeshes(modelId, (mesh, index, total) => {
      const revitElementId = revitIdByExpressId.get(mesh.expressID);
      const diffStatus = revitElementId == null
        ? "context"
        : diffStatusByElement.get(revitElementId) ?? "different";
      const batch = batches.get(diffStatus)!;
      for (let placementIndex = 0; placementIndex < mesh.geometries.size(); placementIndex += 1) {
        const placed = mesh.geometries.get(placementIndex);
        const geometry = api.GetGeometry(modelId, placed.geometryExpressID);
        const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
        const indices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
        appendReferenceGeometry(
          batch,
          referenceMeshes,
          vertices,
          indices,
          placed.flatTransformation,
          revitElementId ?? 0,
        );
        geometry.delete();
      }
      if (typeof mesh.delete === "function") mesh.delete();
      if (index % 250 === 0 || index + 1 === total) {
        onProgress?.({
          ratio: 0.66 + ((index + 1) / Math.max(1, total)) * 0.29,
          message: `Building geometric diff · ${(index + 1).toLocaleString()} / ${total.toLocaleString()}`,
        });
      }
    });
    for (const batch of batches.values()) flushReferenceBatch(batch, referenceMeshes);

    for (const sample of matchedSamples) sample.hasGeometry = geometryExpressIds.has(sample.expressId);
    const matchedGeometryProducts = [...matchedExpressIds].filter((id) => geometryExpressIds.has(id)).length;
    const completeRampAggregateElementIds = [...new Set(
      [...revitIdByExpressId]
        .filter(([expressId]) =>
          ifcTypeByExpressId.get(expressId) === "IFCRAMP" &&
          geometryExpressIds.has(expressId) &&
          !aggregateParentExpressIds.has(expressId))
        .map(([, elementId]) => elementId),
    )].sort((left, right) => left - right);
    const directRoofGeometryElementIds = [...new Set(
      [...revitIdByExpressId]
        .filter(([expressId]) =>
          ifcTypeByExpressId.get(expressId) === "IFCROOF" &&
          geometryExpressIds.has(expressId) &&
          !aggregateParentExpressIds.has(expressId))
        .map(([, elementId]) => elementId),
    )].sort((left, right) => left - right);
    const directStairFlightGeometryElementIds = [...new Set(
      [...revitIdByExpressId]
        .filter(([expressId]) =>
          ifcTypeByExpressId.get(expressId) === "IFCSTAIRFLIGHT" &&
          geometryExpressIds.has(expressId))
        .map(([, elementId]) => elementId),
    )].sort((left, right) => left - right);
    const finiteBounds = Number.isFinite(min.x);
    const manifest: IfcReferenceManifest = {
      fileName,
      byteLength: bytes.byteLength,
      schema: api.GetModelSchema(modelId),
      elementCount,
      taggedElementCount,
      matchedElementCount,
      unmatchedTaggedElementCount: taggedElementCount - matchedElementCount,
      matchedGeometryProducts,
      storeyCount,
      geometryProducts,
      placedGeometries,
      vertexCount,
      triangleCount,
      geometricComparedElementCount,
      geometricAlignedElementCount,
      geometricDifferentElementCount,
      geometricShapeDifferentElementCount,
      geometricShapeDifferentElementIds: Uint32Array.from(
        geometricShapeDifferentElementIds.sort((left, right) => left - right),
      ),
      directRoofGeometryElementIds: Uint32Array.from(directRoofGeometryElementIds),
      directStairFlightGeometryElementIds: Uint32Array.from(
        directStairFlightGeometryElementIds,
      ),
      completeRampAggregateElementIds: Uint32Array.from(completeRampAggregateElementIds),
      geometryToleranceFeet: GEOMETRY_TOLERANCE_FEET,
      boundsMetres: finiteBounds
        ? { min, max }
        : { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
      elementTypes: elementTypes.sort((a, b) => b.count - a.count),
      matchedSamples,
      durationMs: performance.now() - started,
    };
    onProgress?.({ ratio: 0.98, message: "Applying paired regression gates" });
    const comparison = compareRvtToIfc(rvt, manifest);
    comparison.referenceMeshes = referenceMeshes;
    comparison.referenceBoundsMetres = {
      min: { x: min.x, y: -max.z, z: min.y },
      max: { x: max.x, y: -min.z, z: max.y },
    };
    return comparison;
  } finally {
    api.CloseModel(modelId);
    api.Dispose();
  }
}
