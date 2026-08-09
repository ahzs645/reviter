#!/usr/bin/env node
// Why does snapTreadsToSketchRiserLines decline (or where does it move) the
// named runs? Replays the exact convert-site inputs with verbose gates.
import { readFileSync } from "node:fs";
import * as CFB from "cfb";
import { collectSketchCurves } from "../lib/reviter/sketch-curves.ts";
import {
  gzipOffsets, inflateRevitChunk, revitWindowTail, salvageRevitChunk, stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";
import { convertModel } from "./audit-coverage.ts";

const rvtPath = process.argv[2];
const focus = process.argv.slice(3).map(Number);
const wanted = new Set(focus.flatMap((id) => [id, id - 1]));
const curvesByOwner = new Map();
const cfb = CFB.read(readFileSync(rvtPath), { type: "buffer" });
for (let e = 0; e < cfb.FileIndex.length; e += 1) {
  const path = cfb.FullPaths[e] ?? "";
  if (!/Partitions\/[^/]+$/i.test(path)) continue;
  const stored = stripRevitPageChecksums(
    cfb.FileIndex[e].content instanceof Uint8Array
      ? cfb.FileIndex[e].content : new Uint8Array(cfb.FileIndex[e].content));
  const offsets = gzipOffsets(stored);
  let window = null;
  for (let c = 0; c < offsets.length; c += 1) {
    const read = inflateRevitChunk(stored, offsets[c], offsets[c + 1], window);
    const data = read ?? salvageRevitChunk(stored, offsets[c], offsets[c + 1], window);
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
const result = convertModel(rvtPath);
for (const id of focus) {
  const record = result.elementBounds.find((r) => r.elementId === id);
  const treads = record?.stairTreads ?? [];
  const curves = [...(curvesByOwner.get(id) ?? []), ...(curvesByOwner.get(id - 1) ?? [])];
  console.log(`\n=== ${id}: treads=${treads.length} curves=${curves.length}` +
    ` (own=${curvesByOwner.get(id)?.length ?? 0} companion=${curvesByOwner.get(id - 1)?.length ?? 0})`);
  if (!treads.length) continue;
  // replicate gates
  let dx = 0, dy = 0;
  for (const t of treads) {
    dx += (t[1][0] + t[2][0]) / 2 - (t[3][0] + t[0][0]) / 2;
    dy += (t[1][1] + t[2][1]) / 2 - (t[3][1] + t[0][1]) / 2;
  }
  const len = Math.hypot(dx, dy);
  const adv = [dx / len, dy / len];
  const stop = (x, y) => x * adv[0] + y * adv[1];
  const byE = new Map();
  for (const [i, t] of treads.entries()) {
    const k = t[0][2].toFixed(6);
    (byE.get(k) ?? byE.set(k, []).get(k)).push(i);
  }
  const keys = [...byE.keys()].sort((a, b) => Number(a) - Number(b));
  const stops = keys.map((k) => {
    const g = byE.get(k);
    return g.reduce((s, i) => s + stop((treads[i][3][0] + treads[i][0][0]) / 2, (treads[i][3][1] + treads[i][0][1]) / 2), 0) / g.length;
  });
  const top = byE.get(keys.at(-1));
  stops.push(top.reduce((s, i) => s + stop((treads[i][1][0] + treads[i][2][0]) / 2, (treads[i][1][1] + treads[i][2][1]) / 2), 0) / top.length);
  console.log("current boundary stops:", stops.map((v) => v.toFixed(2)).join(", "));
  const raw = [];
  for (const curve of curves) {
    if (curve.kind !== "line" && curve.kind !== "arc") continue;
    const cdx = curve.end[0] - curve.start[0];
    const cdy = curve.end[1] - curve.start[1];
    const clen = Math.hypot(cdx, cdy);
    if (clen < 0.5) continue;
    if (Math.abs((cdx * adv[0] + cdy * adv[1]) / clen) > 0.35) continue;
    raw.push(stop((curve.start[0] + curve.end[0]) / 2, (curve.start[1] + curve.end[1]) / 2));
  }
  raw.sort((a, b) => a - b);
  const clusters = [];
  for (const v of raw) {
    const last = clusters.at(-1);
    if (last && v - last.stop <= 0.5) {
      last.stop = (last.stop * last.count + v) / (last.count + 1);
      last.count += 1;
    } else clusters.push({ stop: v, count: 1 });
  }
  const repeated = clusters.filter((c) => c.count >= 2);
  console.log(`clusters: total=${clusters.length} repeated=${repeated.length} ` +
    repeated.map((c) => `${c.stop.toFixed(2)}x${c.count}`).join(", "));
  console.log(`gate: repeated(${repeated.length}) vs boundaries(${stops.length})`);
}
