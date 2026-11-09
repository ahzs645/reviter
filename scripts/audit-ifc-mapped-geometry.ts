#!/usr/bin/env node
/** Reopen ordinary and optional mapped IFC exports from one unchanged scene. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { IfcAPI } from "web-ifc";
import { convertModel } from "./audit-coverage.ts";
import { makeIfc } from "../lib/reviter/export-ifc.ts";
import { optionValue, positionals, writeJsonReport } from "./lib/rvt-harness.ts";

const [input] = positionals("--json", "--out-dir");
if (!input) throw new Error("usage: audit-ifc-mapped-geometry.ts model.rvt [--json report.json] [--out-dir directory]");
const result = convertModel(input);
const ordinary = makeIfc(result), mapped = makeIfc(result, { reuseMappedGeometry: true });
const api = new IfcAPI(); await api.Init();
function inspect(source: string) {
  const id = api.OpenModel(new TextEncoder().encode(source), { COORDINATE_TO_ORIGIN: false });
  if (id < 0) throw new Error("web-ifc rejected IFC export");
  const products = new Map<number, { triangles: number; bounds: number[]; colors: string[] }>();
  let triangles = 0, geometries = 0;
  try {
    api.StreamAllMeshes(id, mesh => {
      const tag = Number(api.GetLine(id, mesh.expressID).Tag?.value);
      const record = { triangles: 0, bounds: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], colors: [] as string[] };
      for (let part = 0; part < mesh.geometries.size(); part += 1) {
        const placed = mesh.geometries.get(part), matrix = placed.flatTransformation;
        const geometry = api.GetGeometry(id, placed.geometryExpressID);
        const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
        const indices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
        record.triangles += indices.length / 3; triangles += indices.length / 3; geometries += 1;
        record.colors.push(JSON.stringify(placed.color));
        for (let v = 0; v < vertices.length; v += 6) {
          const x = vertices[v]!, y = vertices[v + 1]!, z = vertices[v + 2]!;
          const world = [matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
            matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
            matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!];
          for (let axis = 0; axis < 3; axis += 1) {
            record.bounds[axis] = Math.min(record.bounds[axis]!, world[axis]!);
            record.bounds[axis + 3] = Math.max(record.bounds[axis + 3]!, world[axis]!);
          }
        }
        geometry.delete();
      }
      record.colors.sort(); if (Number.isSafeInteger(tag)) products.set(tag, record);
    });
    return { schema: api.GetModelSchema(id), triangles, geometries, products };
  } finally { api.CloseModel(id); }
}
try {
  const before = inspect(ordinary), after = inspect(mapped);
  let maxBoundsErrorMetres = 0;
  const mismatches: unknown[] = [];
  for (const [tag, source] of before.products) {
    const output = after.products.get(tag);
    if (!output || source.triangles !== output.triangles || JSON.stringify(source.colors) !== JSON.stringify(output.colors)) {
      mismatches.push({ tag, reason: "missing product or changed triangle count/material" }); continue;
    }
    const error = Math.max(...source.bounds.map((value, axis) => Math.abs(value - output.bounds[axis]!)));
    maxBoundsErrorMetres = Math.max(maxBoundsErrorMetres, error);
    if (error > 1e-5) mismatches.push({ tag, reason: "changed world bounds", errorMetres: error });
  }
  const counts = (source: string) => ({ bytes: Buffer.byteLength(source),
    representationMaps: (source.match(/=IFCREPRESENTATIONMAP\(/g) ?? []).length,
    mappedItems: (source.match(/=IFCMAPPEDITEM\(/g) ?? []).length,
    tessellatedFaceSets: (source.match(/=IFCTRIANGULATEDFACESET\(/g) ?? []).length,
  });
  const report = { schemaVersion: 1, generatedBy: "scripts/audit-ifc-mapped-geometry.ts",
    input: { fileName: basename(input), sha256: createHash("sha256").update(readFileSync(input)).digest("hex") },
    policy: "Optional translation-only maps; explicit native type, owner, all ordered local vertices/topology/materials verified. Default exporter unchanged.",
    before: { ...counts(ordinary), schema: before.schema, reopenedTriangles: before.triangles, reopenedTaggedProducts: before.products.size },
    after: { ...counts(mapped), schema: after.schema, reopenedTriangles: after.triangles, reopenedTaggedProducts: after.products.size },
    byteReductionPercent: 100 * (1 - Buffer.byteLength(mapped) / Buffer.byteLength(ordinary)),
    maxBoundsErrorMetres, mismatches, geometryEquivalent: before.triangles === after.triangles && before.products.size === after.products.size && !mismatches.length,
    scope: "Same-scene exporter comparison. All tagged product bounds/counts/materials and total reader triangles checked; reference IFC geometry is not assumed identical.",
  };
  if (optionValue("--out-dir")) {
    const directory = optionValue("--out-dir")!; mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${basename(input)}-ordinary.ifc`), ordinary);
    writeFileSync(join(directory, `${basename(input)}-mapped.ifc`), mapped);
  }
  if (optionValue("--json")) writeJsonReport(optionValue("--json")!, report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.geometryEquivalent) process.exitCode = 1;
} finally { api.Dispose(); }
