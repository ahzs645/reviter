import * as fs from "node:fs";

import * as CFB from "cfb";

import {
  buildElementOwnershipGraph,
  decodeElementOwnership,
} from "../lib/reviter/element-relations.ts";
import {
  gzipOffsets,
  inflateRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";

const filePath = process.argv[2];
if (!filePath) {
  throw new Error(
    "Usage: node --experimental-strip-types scripts/probe-element-relations.ts model.rvt [element-id ...]",
  );
}

const input = fs.readFileSync(filePath);
const cfb = CFB.read(input, { type: "buffer" });
const streamIndex = cfb.FullPaths.findIndex((path) => /\/Global\/ElemTable$/i.test(path));
if (streamIndex < 0) throw new Error("The RVT has no Global/ElemTable stream.");

const raw = new Uint8Array(cfb.FileIndex[streamIndex]!.content);
const payload = stripRevitPageChecksums(raw);
const gzipOffset = gzipOffsets(payload, 1)[0];
if (gzipOffset == null) throw new Error("Global/ElemTable has no supported gzip member.");
const inflated = inflateRevitChunk(payload, gzipOffset);
if (!inflated) throw new Error("Global/ElemTable could not be inflated.");

const decoded = decodeElementOwnership(inflated);
if (decoded.format === "unsupported") {
  console.log(JSON.stringify({
    filePath,
    streamPath: cfb.FullPaths[streamIndex],
    rawBytes: raw.byteLength,
    inflatedBytes: inflated.byteLength,
    decoder: decoded,
  }, null, 2));
  process.exitCode = 2;
} else {
  const graph = buildElementOwnershipGraph(decoded);
  const requestedIds = process.argv
    .slice(3)
    .map(Number)
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  const targets = requestedIds.map((elementId) => {
    const record = graph.recordsById.get(elementId);
    return {
      elementId,
      present: Boolean(record),
      owningElementId: record?.owningElementId ?? null,
      partitionId: record?.partitionId ?? null,
      byteOffset: record?.byteOffset ?? null,
      childIds: graph.childrenByOwner.get(elementId) ?? [],
    };
  });

  console.log(JSON.stringify({
    filePath,
    streamPath: cfb.FullPaths[streamIndex],
    rawBytes: raw.byteLength,
    inflatedBytes: inflated.byteLength,
    decoder: {
      format: decoded.format,
      declaredRecordCount: decoded.declaredRecordCount,
      decodedRecordCount: decoded.decodedRecordCount,
      skippedLeadingRecordCount: decoded.skippedLeadingRecordCount,
      rootRecordCount: decoded.rootRecordCount,
      selfOwnedRecordCount: decoded.selfOwnedRecordCount,
      persistedRelationCount: decoded.relations.length,
      danglingOwnerCount: decoded.danglingOwnerCount,
    },
    targets,
  }, null, 2));
}
