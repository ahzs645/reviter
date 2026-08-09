#!/usr/bin/env node

/**
 * For a sketched monumental run: do the sketch curves contain lines at the
 * positions where the paired export actually puts its risers?
 *
 * Prints three sorted stop lists along the run's advance direction —
 * (a) the recovered tread boundaries, (b) every parallel sketch line owned by
 * the element or its sketch companion, with repeat counts, and (c) the
 * export's vertical riser planes clustered from the IfcStairFlight mesh —
 * so a reader-selection defect separates from a genuinely absent line.
 *
 *   node --experimental-strip-types scripts/probe-riser-line-evidence.ts \
 *     model.rvt model.ifc 1801503 [ids...]
 */
import { readFileSync } from "node:fs";

import * as CFB from "cfb";
import { IfcAPI } from "web-ifc";

import { collectSketchCurves, type SketchCurve } from "../lib/reviter/sketch-curves.ts";
import {
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";
import { convertModel } from "./audit-coverage.ts";

type Point3 = [number, number, number];

const FEET_PER_METRE = 3.280839895;

const [rvtPath, ifcPath, ...idArguments] = process.argv.slice(2);
const focusIds = idArguments.map(Number).filter((id) => Number.isFinite(id));
if (!rvtPath || !ifcPath || !focusIds.length) {
  throw new Error("usage: probe-riser-line-evidence.ts model.rvt model.ifc <id...>");
}

const asBytes = (content: unknown): Uint8Array =>
  content instanceof Uint8Array ? content : new Uint8Array(content as ArrayBuffer);

// --- sketch curves owned by the elements or their id-1 companions ----------
const wanted = new Set(focusIds.flatMap((id) => [id, id - 1]));
const curvesByOwner = new Map<number, SketchCurve[]>();
const cfb = CFB.read(readFileSync(rvtPath), { type: "buffer" });
for (let entryIndex = 0; entryIndex < cfb.FileIndex.length; entryIndex += 1) {
  const path = cfb.FullPaths[entryIndex] ?? "";
  if (!/Partitions\/[^/]+$/i.test(path)) continue;
  const stored = stripRevitPageChecksums(asBytes(cfb.FileIndex[entryIndex]!.content));
  const offsets = gzipOffsets(stored);
  let window: Uint8Array | null = null;
  for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
    const read = inflateRevitChunk(stored, offsets[chunkIndex]!, offsets[chunkIndex + 1], window);
    const data = read ??
      salvageRevitChunk(stored, offsets[chunkIndex]!, offsets[chunkIndex + 1], window);
    if (!data) continue;
    if (read) window = revitWindowTail(read);
    for (const curve of collectSketchCurves(data)) {
      if (!wanted.has(curve.owner)) continue;
      const list = curvesByOwner.get(curve.owner) ?? [];
      list.push(curve);
      curvesByOwner.set(curve.owner, list);
    }
  }
}

// --- IFC flight meshes by tag ----------------------------------------------
const ifcText = readFileSync(ifcPath, "latin1");
const expressByTag = new Map<number, Set<number>>();
const entity = /^#(\d+) *= *IFCSTAIRFLIGHT\(([\s\S]*?)\);\s*$/gm;
for (let match = entity.exec(ifcText); match; match = entity.exec(ifcText)) {
  for (const quoted of match[2]!.matchAll(/'([^']*)'/g)) {
    if (/^\d+$/.test(quoted[1]!)) {
      const tag = Number(quoted[1]!);
      const set = expressByTag.get(tag) ?? new Set<number>();
      set.add(Number(match[1]!));
      expressByTag.set(tag, set);
    }
  }
}
const api = new IfcAPI();
await api.Init();
const modelID = api.OpenModel(new Uint8Array(readFileSync(ifcPath)));
const verticalTriangles = new Map<number, Array<[number, number, number]>>();
api.StreamAllMeshes(modelID, (mesh) => {
  let tag: number | null = null;
  for (const [candidate, ids] of expressByTag) {
    if (ids.has(mesh.expressID)) tag = candidate;
  }
  if (tag == null) return;
  const parts = mesh.geometries;
  const centroids: Array<[number, number, number]> = [];
  for (let part = 0; part < parts.size(); part += 1) {
    const item = parts.get(part);
    const geometry = api.GetGeometry(modelID, item.geometryExpressID);
    const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
    const indexArray = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
    const m = item.flatTransformation;
    const world = (vertex: number): Point3 => {
      const x = vertices[vertex * 6]!;
      const y = vertices[vertex * 6 + 1]!;
      const z = vertices[vertex * 6 + 2]!;
      return [
        (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) * FEET_PER_METRE,
        -(m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) * FEET_PER_METRE,
        (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) * FEET_PER_METRE,
      ];
    };
    for (let index = 0; index + 2 < indexArray.length; index += 3) {
      const a = world(indexArray[index]!);
      const b = world(indexArray[index + 1]!);
      const c = world(indexArray[index + 2]!);
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz);
      if (length < 1e-9) continue;
      if (Math.abs(nz / length) > 0.2) continue; // keep near-vertical faces
      centroids.push([
        (a[0] + b[0] + c[0]) / 3,
        (a[1] + b[1] + c[1]) / 3,
        (a[2] + b[2] + c[2]) / 3,
      ]);
    }
    geometry.delete();
  }
  const list = verticalTriangles.get(tag) ?? [];
  list.push(...centroids);
  verticalTriangles.set(tag, list);
});

// --- comparison per element -------------------------------------------------
const result = convertModel(rvtPath);
for (const elementId of focusIds) {
  const record = result.elementBounds.find((entry) => entry.elementId === elementId);
  const treads = record?.stairTreads as [Point3, Point3, Point3, Point3][] | undefined;
  console.log(`\n=== element ${elementId}: treads=${treads?.length ?? 0}`);
  if (!treads?.length) continue;

  // Advance direction from rear->front midpoints, boundary stops as before.
  let directionX = 0, directionY = 0;
  for (const tread of treads) {
    directionX += (tread[1][0] + tread[2][0]) / 2 - (tread[3][0] + tread[0][0]) / 2;
    directionY += (tread[1][1] + tread[2][1]) / 2 - (tread[3][1] + tread[0][1]) / 2;
  }
  const directionLength = Math.hypot(directionX, directionY);
  const advance: [number, number] = [directionX / directionLength, directionY / directionLength];
  const stop = (x: number, y: number) => x * advance[0] + y * advance[1];

  const byElevation = new Map<string, [Point3, Point3, Point3, Point3][]>();
  for (const tread of treads) {
    const key = tread[0][2].toFixed(6);
    const group = byElevation.get(key) ?? [];
    group.push(tread);
    byElevation.set(key, group);
  }
  const keys = [...byElevation.keys()].sort((a, b) => Number(a) - Number(b));
  const recoveredStops: number[] = keys.map((key) => {
    const group = byElevation.get(key)!;
    let sum = 0, weight = 0;
    for (const tread of group) {
      sum += stop((tread[3][0] + tread[0][0]) / 2, (tread[3][1] + tread[0][1]) / 2);
      weight += 1;
    }
    return sum / weight;
  });
  const top = byElevation.get(keys.at(-1)!)!;
  recoveredStops.push(top.reduce((sum, tread) =>
    sum + stop((tread[1][0] + tread[2][0]) / 2, (tread[1][1] + tread[2][1]) / 2), 0) / top.length);
  console.log("recovered stops: " +
    recoveredStops.map((value) => value.toFixed(2)).join(", "));

  // Sketch lines roughly perpendicular to the advance direction, clustered.
  const lineStops = new Map<string, { stop: number; count: number; zs: Set<string> }>();
  for (const owner of [elementId, elementId - 1]) {
    for (const curve of curvesByOwner.get(owner) ?? []) {
      if (curve.kind !== "line" && curve.kind !== "arc") continue;
      const dx = curve.end[0] - curve.start[0];
      const dy = curve.end[1] - curve.start[1];
      const length = Math.hypot(dx, dy);
      if (length < 0.5) continue;
      const along = Math.abs((dx * advance[0] + dy * advance[1]) / length);
      if (along > 0.35) continue; // keep cross-run curves only
      const mid = stop(
        (curve.start[0] + curve.end[0]) / 2,
        (curve.start[1] + curve.end[1]) / 2,
      );
      const key = (Math.round(mid * 20) / 20).toFixed(2);
      const bucket = lineStops.get(key) ?? { stop: mid, count: 0, zs: new Set<string>() };
      bucket.count += 1;
      bucket.zs.add(curve.start[2].toFixed(1));
      lineStops.set(key, bucket);
    }
  }
  const sketchRows = [...lineStops.values()].sort((a, b) => a.stop - b.stop);
  console.log("sketch cross-run curves: " + sketchRows
    .map((row) => `${row.stop.toFixed(2)}x${row.count}`)
    .join(", "));

  // IFC vertical-face planes clustered along the advance direction.
  const planes = new Map<number, number>();
  for (const centroid of verticalTriangles.get(elementId) ?? []) {
    const value = stop(centroid[0], centroid[1]);
    const key = Math.round(value * 4) / 4;
    planes.set(key, (planes.get(key) ?? 0) + 1);
  }
  const planeRows = [...planes].sort((a, b) => a[0] - b[0])
    .filter(([, count]) => count >= 2);
  console.log("ifc vertical planes: " + planeRows
    .map(([value, count]) => `${value.toFixed(2)}x${count}`)
    .join(", "));
}
