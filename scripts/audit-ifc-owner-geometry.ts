#!/usr/bin/env node
/** Compare independently reopened IFC owner shapes, with no RVT conversion. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { IfcAPI } from "web-ifc";
import { compareOwnerShapes, measureShape, sampledSurfaceDistance, type OwnerShape, type Point3, type Triangle3 } from "./lib/ifc-owner-geometry.ts";
import { isIfcGlobalId } from "../lib/reviter/ifc-global-id.ts";

const args = process.argv.slice(2), jsonAt = args.indexOf("--json");
const outputPath = jsonAt < 0 ? null : args[jsonAt + 1];
if (jsonAt >= 0) args.splice(jsonAt, 2);
const sampleAt = args.indexOf("--sample-tags"), requestedSamples = sampleAt < 0 ? [] : (args[sampleAt + 1] ?? "").split(",");
if (sampleAt >= 0) args.splice(sampleAt, 2);
if (requestedSamples.length > 32 || requestedSamples.some(tag => !/^[1-9]\d*$/.test(tag))) throw new Error("sample-tags requires up to 32 exact decimal Tags");
const sampleTags = new Set(requestedSamples);
const [outputIfc, referenceIfc] = args;
if (!outputIfc || !referenceIfc || args.length !== 2 || (jsonAt >= 0 && !outputPath)) {
  throw new Error("usage: audit-ifc-owner-geometry.ts exported.ifc reference.ifc [--sample-tags decimalTag,...] [--json report.json]");
}
const scalar = (value: unknown): unknown => value != null && typeof value === "object" && "value" in value ? value.value : value;

async function inspect(path: string) {
  const bytes = readFileSync(path), api = new IfcAPI();
  await api.Init();
  const model = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false });
  if (model < 0) throw new Error("web-ifc could not open IFC");
  const owners: OwnerShape[] = [];
  const sampleTriangles = new Map<number, Triangle3[]>();
  let anonymousMeshes = 0, invalidTriangles = 0;
  try {
    api.StreamAllMeshes(model, mesh => {
      const line = api.GetLine(model, mesh.expressID, false);
      const tag = scalar(line.Tag), globalId = scalar(line.GlobalId);
      if (typeof tag !== "string" || !/^[1-9]\d*$/.test(tag) || !isIfcGlobalId(globalId)) { anonymousMeshes++; return; }
      const owner: OwnerShape = { tag, globalId, ifcType: api.GetNameFromTypeCode(line.type), expressId: mesh.expressID, parts: [] };
      for (let part = 0; part < mesh.geometries.size(); part++) {
        const placed = mesh.geometries.get(part), geometry = api.GetGeometry(model, placed.geometryExpressID);
        try {
          const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
          const indices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
          const m = placed.flatTransformation;
          const points: Point3[] = [];
          for (let v = 0; v + 2 < vertices.length; v += 6) {
            const x = vertices[v]!, y = vertices[v + 1]!, z = vertices[v + 2]!;
            // Explicit world placement, Y-up metres -> Z-up feet; no fitting.
            points.push([(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / 0.3048,
              -(m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / 0.3048,
              (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / 0.3048]);
          }
          if (indices.length) owner.parts.push(measureShape(points, indices));
          if (sampleTags.has(tag)) {
            const triangles = sampleTriangles.get(mesh.expressID) ?? [];
            if (triangles.length + indices.length / 3 > 2_000) throw new Error(`sample triangle budget exceeded for Tag ${tag}`);
            for (let i = 0; i < indices.length; i += 3) triangles.push([points[indices[i]!]!, points[indices[i + 1]!]!, points[indices[i + 2]!]!]);
            sampleTriangles.set(mesh.expressID, triangles);
          }
        } catch (error) {
          invalidTriangles++; throw error;
        } finally { geometry.delete(); }
      }
      owners.push(owner);
    });
    return { fileName: basename(path), sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length,
      schema: api.GetModelSchema(model), taggedProductsWithMeshes: owners.length, anonymousMeshes, invalidTriangles, owners, sampleTriangles };
  } finally { api.CloseModel(model); api.Dispose(); }
}

const output = await inspect(outputIfc), reference = await inspect(referenceIfc);
const { comparisons, ...coverage } = compareOwnerShapes(output.owners, reference.owners);
const surfaceSamples = comparisons.filter(record => sampleTags.has(record.tag)).map(record => {
  const own = output.owners.find(owner => owner.tag === record.tag)!;
  const ref = reference.owners.find(owner => owner.tag === record.tag)!;
  const a = output.sampleTriangles.get(own.expressId)!, b = reference.sampleTriangles.get(ref.expressId)!;
  return { tag: record.tag, globalId: record.globalId, outputToReference: sampledSurfaceDistance(a, b), referenceToOutput: sampledSurfaceDistance(b, a) };
});
const byEntity: Record<string, { compared: number; boundsWithin001Feet: number; areaWithinOnePercent: number; closedVolumePairs: number; closedVolumeWithinOnePercent: number }> = {};
for (const record of comparisons) {
  const group = byEntity[`${record.referenceIfcType} -> ${record.outputIfcType}`] ??= { compared: 0, boundsWithin001Feet: 0, areaWithinOnePercent: 0, closedVolumePairs: 0, closedVolumeWithinOnePercent: 0 };
  group.compared++;
  if (record.boundsCornerErrorFeet <= 0.01) group.boundsWithin001Feet++;
  if (record.areaDelta.relative != null && record.areaDelta.relative <= 0.01) group.areaWithinOnePercent++;
  if (record.closedPartVolumeDelta) {
    group.closedVolumePairs++;
    if (record.closedPartVolumeDelta.relative != null && record.closedPartVolumeDelta.relative <= 0.01) group.closedVolumeWithinOnePercent++;
  }
}
const metadata = (input: typeof output) => ({ fileName: input.fileName, sha256: input.sha256, bytes: input.bytes,
  schema: input.schema, taggedProductsWithMeshes: input.taggedProductsWithMeshes, anonymousMeshes: input.anonymousMeshes, invalidTriangles: input.invalidTriangles });
const report = { schemaVersion: 1, generatedBy: "scripts/audit-ifc-owner-geometry.ts",
  scope: "Rendered IFC products with one exact decimal Tag on each side and identical GlobalId. Duplicate Tags and identity disagreements excluded; no name, shape, aggregation or GLB dbId identity inference.",
  frame: "Both IFCs reopened with COORDINATE_TO_ORIGIN=false; explicit placed geometry mapped from Y-up metres to (x,-z,y)/0.3048 Z-up feet; no estimated translation/rotation/scale.",
  limitations: ["Bounds/area/volume agreement does not establish equal surfaces or decoded join order.", "Volume is the sum of absolute oriented shell volumes only when every individual part has exact-coordinate closed manifold edges and consistent winding. No welding tolerance or hole filling is used. Self-intersection and overlap between parts are not validated; this is not union/material volume.", "IFC exporter view, phase, tessellation and geometry-selection differences can change metrics; triangle count is descriptive, never an accuracy score.", "Source decoder provenance must be established separately before changing a native body. This audit never replaces source geometry with reference geometry."],
  output: metadata(output), reference: metadata(reference), coverage, byEntity,
  surfaceSampling: { scope: "Exact-identity selected owners only. Every triangle's vertices, edge midpoints and centroid tested against all opposing triangles; a finite sample diagnostic, not a continuous Hausdorff bound.", maxTags: 32, maxTrianglesPerOwner: 2_000, requestedTags: requestedSamples,
    unmatchedRequestedTags: requestedSamples.filter(tag => !surfaceSamples.some(sample => sample.tag === tag)), results: surfaceSamples },
  worstBounds: [...comparisons].sort((a, b) => b.boundsCornerErrorFeet - a.boundsCornerErrorFeet).slice(0, 40),
  worstAreaWithMatchingBounds: comparisons.filter(record => record.boundsCornerErrorFeet <= 0.01)
    .sort((a, b) => (b.areaDelta.relative ?? 0) - (a.areaDelta.relative ?? 0)).slice(0, 40),
  ownerComparisons: comparisons };
if (outputPath) writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n");
const summary = Object.fromEntries(Object.entries(report).filter(([key]) => !["ownerComparisons", "worstBounds", "worstAreaWithMatchingBounds"].includes(key)));
console.log(JSON.stringify(summary, null, 2));
