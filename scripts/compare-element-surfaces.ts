#!/usr/bin/env node
/** Fine surface checks for explicitly selected element IDs. Whole-scene
 * registration is required: fitting each object separately would hide defects.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { basename, join } from "node:path";
import { convertRvtBytes } from "../lib/reviter/convert.ts";
import { makeGlb } from "../lib/reviter/export-glb.ts";
import type { MeshData } from "../lib/reviter/types.ts";
import { compareGlbs, type Registration } from "./glb-surface-diff.ts";
import { isEntryPoint, numberOption, optionValue, positionals } from "./lib/rvt-harness.ts";

export function selectElementMeshes(meshes: readonly MeshData[], id: number): MeshData[] {
  return meshes.flatMap(mesh => {
    if (!mesh.elementIds || mesh.elementIds.length * 3 !== mesh.indices.length) return [];
    const positions: number[] = [], normals: number[] = [], colors: number[] = [], indices: number[] = [];
    const vertices = new Map<number, number>();
    for (let t = 0; t < mesh.elementIds.length; t++) {
      if (mesh.elementIds[t] !== id) continue;
      for (let j = 0; j < 3; j++) {
        const source = mesh.indices[t * 3 + j]!;
        let target = vertices.get(source);
        if (target == null) {
          target = positions.length / 3;
          vertices.set(source, target);
          positions.push(...mesh.positions.subarray(source * 3, source * 3 + 3));
          colors.push(...mesh.colors.subarray(source * 3, source * 3 + 3));
          if (mesh.normals) normals.push(...mesh.normals.subarray(source * 3, source * 3 + 3));
        }
        indices.push(target);
      }
    }
    return indices.length ? [{ ...mesh, positions: new Float32Array(positions), normals: mesh.normals ? new Float32Array(normals) : undefined, colors: new Float32Array(colors), indices: new Uint32Array(indices), elementIds: new Uint32Array(indices.length / 3).fill(id) }] : [];
  });
}

export function selectReferenceElement(bytes: Uint8Array, dbIds: ReadonlySet<number>): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(8, true) !== bytes.length) throw new Error("Invalid GLB");
  const length = view.getUint32(12, true);
  const doc = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  let kept = 0;
  for (const node of doc.nodes ?? []) if (node.mesh != null) {
    if (dbIds.has(node.extras?.autodeskDbId)) kept++;
    else delete node.mesh;
  }
  if (!kept) return null;
  const json = new TextEncoder().encode(JSON.stringify(doc));
  const padded = Math.ceil(json.length / 4) * 4;
  const rest = bytes.subarray(20 + length);
  const output = new Uint8Array(20 + padded + rest.length);
  output.set(bytes.subarray(0, 20));
  const outView = new DataView(output.buffer);
  outView.setUint32(8, output.length, true); outView.setUint32(12, padded, true);
  output.fill(32, 20, 20 + padded); output.set(json, 20); output.set(rest, 20 + padded);
  return output;
}

if (isEntryPoint(import.meta.url)) {
  const [rvt, capture] = positionals("--ids", "--cell", "--registration", "--json");
  const ids = (optionValue("--ids") ?? "").split(",").map(Number);
  const registrationPath = optionValue("--registration"), outputPath = optionValue("--json");
  const cell = numberOption("--cell", 0.1);
  if (!rvt || !capture || !registrationPath || !outputPath || ids.some(id => !Number.isSafeInteger(id) || id <= 0) || !Number.isFinite(cell) || cell <= 0) {
    throw new Error("usage: compare-element-surfaces.ts model.rvt capture-dir --ids 123,456 --registration whole-scene.json --json report.json [--cell 0.1]");
  }
  const registration = JSON.parse(readFileSync(registrationPath, "utf8")) as Registration;
  if (!(registration.scale > 0) || !Number.isFinite(registration.scale) || [registration.sourceCenter, registration.referenceCenter].some(v => v?.length !== 3 || !v.every(Number.isFinite))) throw new Error("Invalid registration");
  const result = convertRvtBytes(readFileSync(rvt), basename(rvt));
  if (!result.ok) throw new Error(result.error);
  const externalIds = JSON.parse(gunzipSync(readFileSync(join(capture, "raw/objects_ids.json.gz"))).toString()) as unknown[];
  const referenceBytes = readFileSync(join(capture, "model.glb"));
  const reports = ids.map(elementId => {
    const dbIds = new Set(externalIds.flatMap((external, db) => typeof external === "string" && Number.parseInt(external.split("-").at(-1)!, 16) === elementId ? [db] : []));
    const meshes = selectElementMeshes(result.meshes, elementId);
    const reference = selectReferenceElement(referenceBytes, dbIds);
    if (!meshes.length || !reference) return { elementId, status: !meshes.length ? "not-drawn" : "outside-reference-view" };
    const report = compareGlbs(new Uint8Array(makeGlb({ ...result, meshes })), reference, cell, registration);
    return { elementId, status: "compared", recoveredTriangles: meshes.reduce((n, m) => n + m.indices.length / 3, 0), diff: { ...report.diff, recoveredOnly: report.diff.recoveredOnly.length, referenceOnly: report.diff.referenceOnly.length } };
  });
  writeFileSync(outputPath, JSON.stringify({ schemaVersion: 1, cellMetres: cell, neighbourToleranceMetres: cell * Math.sqrt(3), registration, caveat: "Selected elements only. Surface sampling is approximate; registration is held fixed from the whole scene.", elements: reports }, null, 2) + "\n");
  console.log(`Wrote ${reports.length} local checks to ${outputPath}`);
}
