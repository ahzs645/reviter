/// <reference types="vite/client" />

import { IfcAPI } from "web-ifc";
import webIfcWasmUrl from "web-ifc/web-ifc.wasm?url";

import { compareRvtToIfc } from "./regression";
import type {
  IfcElementTypeMatch,
  IfcMatchedElement,
  IfcReferenceManifest,
  PairedRegressionResult,
  ProgressUpdate,
  RvtRegressionInput,
  Vec3,
} from "./types";

type ProgressCallback = (update: ProgressUpdate) => void;

function scalar(value: unknown): string {
  if (value && typeof value === "object" && "value" in value) {
    return String((value as { value: unknown }).value ?? "");
  }
  return value == null ? "" : String(value);
}

function transformPoint(matrix: Array<number>, x: number, y: number, z: number): Vec3 {
  return {
    x: matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
    y: matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
    z: matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
  };
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
  await api.Init((path) => (path.endsWith(".wasm") ? webIfcWasmUrl : path), true);
  onProgress?.({ ratio: 0.1, message: "Opening IFC reference model" });
  const modelId = api.OpenModel(bytes, {
    COORDINATE_TO_ORIGIN: true,
    MEMORY_LIMIT: 2_000_000_000,
  });
  if (modelId < 0) throw new Error("web-ifc could not open the reference model.");

  try {
    const elemTableIds = new Set<number>(rvt.elemTableIds);
    const partitionRecordIds = new Set<number>(rvt.partitionRecordIds);
    const partitionRecordById = new Map(
      rvt.partitionRecords.map((record) => [record.elementId, record] as const),
    );
    const matchedExpressIds = new Set<number>();
    const elementTypes: IfcElementTypeMatch[] = [];
    const matchedSamples: IfcMatchedElement[] = [];
    let elementCount = 0;
    let taggedElementCount = 0;
    let matchedElementCount = 0;
    let storeyCount = 0;

    const types = api.GetAllTypesOfModel(modelId);
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
      elementCount += ids.size();
      for (let index = 0; index < ids.size(); index += 1) {
        const expressId = ids.get(index);
        const line = api.GetLine(modelId, expressId) as Record<string, unknown>;
        const rawTag = scalar(line.Tag).trim();
        if (!/^\d+$/.test(rawTag)) continue;
        tagged += 1;
        taggedElementCount += 1;
        const revitElementId = Number(rawTag);
        const inElemTable = elemTableIds.has(revitElementId);
        const inPartitionRecords = partitionRecordIds.has(revitElementId);
        if (!inElemTable && !inPartitionRecords) continue;
        matched += 1;
        if (inElemTable) matchedElemTable += 1;
        if (inPartitionRecords) matchedPartitionRecords += 1;
        matchedElementCount += 1;
        matchedExpressIds.add(expressId);
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
                : "partition-record",
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
      });
      onProgress?.({
        ratio: 0.12 + ((typeIndex + 1) / Math.max(1, elementTypeRows.length)) * 0.24,
        message: `Matching IFC tags · ${matchedElementCount.toLocaleString()} RVT records`,
      });
    }

    const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
    const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
    const geometryExpressIds = new Set<number>();
    let geometryProducts = 0;
    let placedGeometries = 0;
    let vertexCount = 0;
    let triangleCount = 0;

    api.StreamAllMeshes(modelId, (mesh, index, total) => {
      geometryProducts += 1;
      geometryExpressIds.add(mesh.expressID);
      for (let placementIndex = 0; placementIndex < mesh.geometries.size(); placementIndex += 1) {
        const placed = mesh.geometries.get(placementIndex);
        const geometry = api.GetGeometry(modelId, placed.geometryExpressID);
        const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
        const indices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
        placedGeometries += 1;
        vertexCount += vertices.length / 6;
        triangleCount += indices.length / 3;
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
        }
        geometry.delete();
      }
      if (typeof mesh.delete === "function") mesh.delete();
      if (index % 250 === 0 || index + 1 === total) {
        onProgress?.({
          ratio: 0.38 + ((index + 1) / Math.max(1, total)) * 0.57,
          message: `Measuring IFC geometry · ${(index + 1).toLocaleString()} / ${total.toLocaleString()}`,
        });
      }
    });

    for (const sample of matchedSamples) sample.hasGeometry = geometryExpressIds.has(sample.expressId);
    const matchedGeometryProducts = [...matchedExpressIds].filter((id) => geometryExpressIds.has(id)).length;
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
      boundsMetres: finiteBounds
        ? { min, max }
        : { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
      elementTypes: elementTypes.sort((a, b) => b.count - a.count),
      matchedSamples,
      durationMs: performance.now() - started,
    };
    onProgress?.({ ratio: 0.98, message: "Applying paired regression gates" });
    return compareRvtToIfc(rvt, manifest);
  } finally {
    api.CloseModel(modelId);
    api.Dispose();
  }
}
