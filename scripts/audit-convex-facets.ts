#!/usr/bin/env node
/**
 * Measure how many persisted planar face sets can be promoted to closed convex
 * meshes without guessing loops or extending a face beyond its stored trims.
 */
import fs from "node:fs";

import CFB from "cfb";

import {
  analyseConvexFacetMesh,
  type ConvexFacetFailure,
} from "../lib/reviter/convex-facets.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";
import { collectOwnedSurfaces, type PlanePatch } from "../lib/reviter/surfaces.ts";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node --experimental-strip-types scripts/audit-convex-facets.ts model.rvt");
  process.exit(2);
}

const container = CFB.read(fs.readFileSync(inputPath), { type: "buffer" });
const planesByOwner = new Map<number, PlanePatch[]>();
let chunks = 0;
let inflatedBytes = 0;

for (let entryIndex = 0; entryIndex < container.FileIndex.length; entryIndex += 1) {
  const path = container.FullPaths[entryIndex] ?? "";
  const entry = container.FileIndex[entryIndex];
  if (!entry || !/^Root Entry\/Partitions\/[^/]+$/i.test(path)) continue;
  const data = stripRevitPageChecksums(asBytes(entry.content));
  const offsets = gzipOffsets(data);
  let window: Uint8Array | null = null;
  for (let index = 0; index < offsets.length; index += 1) {
    const inflated = inflateRevitChunk(data, offsets[index]!, offsets[index + 1], window);
    if (!inflated) continue;
    window = revitWindowTail(inflated);
    chunks += 1;
    inflatedBytes += inflated.byteLength;
    for (const { owner, surface } of collectOwnedSurfaces(inflated)) {
      if (surface.kind !== "plane") continue;
      const planes = planesByOwner.get(owner);
      if (planes) planes.push(surface);
      else planesByOwner.set(owner, [surface]);
    }
  }
}

const failures: Record<ConvexFacetFailure, number> = {
  "too-few-planes": 0,
  "ambiguous-coplanar-trims": 0,
  "unbounded-or-empty": 0,
  "incomplete-face": 0,
  "outside-source-trim": 0,
  "degenerate-volume": 0,
};
let accepted = 0;
let triangles = 0;
for (const [elementId, planes] of planesByOwner) {
  const result = analyseConvexFacetMesh(elementId, planes);
  if (!result.mesh) {
    failures[result.reason] += 1;
    continue;
  }
  accepted += 1;
  triangles += result.mesh.indices.length / 3;
}

console.log(JSON.stringify({
  input: inputPath,
  chunks,
  inflatedBytes,
  planeOwners: planesByOwner.size,
  accepted,
  triangles,
  failures,
}, null, 2));
