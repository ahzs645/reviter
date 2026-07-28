#!/usr/bin/env node

/**
 * Read-only proof of concept for native Revit 2027 material definitions.
 *
 * Usage:
 *   node --experimental-strip-types scripts/audit-rvt-materials.ts \
 *     --rvt model.rvt --ifc reference.ifc --json report.json
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import CFB from "cfb";

import { scanMaterialElementRecords } from "../lib/reviter/material-records.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitStoredPageOffset,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";

const argv = process.argv.slice(2);

function option(name: string): string {
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1]) return resolve(argv[index + 1]!);
  throw new Error(`Missing ${name}. Run with --rvt, --ifc, and --json.`);
}

const paths = {
  rvt: option("--rvt"),
  ifc: option("--ifc"),
  json: option("--json"),
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function decodeIfcString(source: string): string {
  return source
    .replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (_match, hex: string) => {
      let decoded = "";
      for (let index = 0; index + 3 < hex.length; index += 4) {
        decoded += String.fromCharCode(Number.parseInt(hex.slice(index, index + 4), 16));
      }
      return decoded;
    })
    .replace(/\\X\\([0-9A-F]{2})/gi, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)))
    .replaceAll("''", "'");
}

function readIfcMaterialNames(text: string): string[] {
  const names: string[] = [];
  const material = /^#\d+ *= *IFCMATERIAL\('((?:''|[^'])*)'\);\s*$/gm;
  for (let match = material.exec(text); match; match = material.exec(text)) {
    names.push(decodeIfcString(match[1]!));
  }
  return names;
}

const rvtBytes = readFileSync(paths.rvt);
const ifcBytes = readFileSync(paths.ifc);
const cfb = CFB.read(rvtBytes, { type: "buffer" });
const definitions = new Map<number, {
  elementId: number;
  name: string;
  stream: string;
  chunkIndex: number;
  storedOffset: number;
  recordOffset: number;
  objectLength: number;
  evidence: "framed-material-element-name";
}>();
let framedMaterialElements = 0;
let partitionStreams = 0;
let gzipChunks = 0;
let inflatedBytes = 0;

for (let entryIndex = 0; entryIndex < cfb.FileIndex.length; entryIndex += 1) {
  const path = cfb.FullPaths[entryIndex] ?? "";
  if (!/Partitions\/[^/]+$/i.test(path)) continue;
  partitionStreams += 1;
  const data = stripRevitPageChecksums(asBytes(cfb.FileIndex[entryIndex]!.content));
  const offsets = gzipOffsets(data);
  let window: Uint8Array | null = null;
  for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
    const read = inflateRevitChunk(
      data,
      offsets[chunkIndex]!,
      offsets[chunkIndex + 1],
      window,
    );
    const inflated = read ??
      salvageRevitChunk(data, offsets[chunkIndex]!, offsets[chunkIndex + 1], window);
    if (!inflated) continue;
    if (read) window = revitWindowTail(read);
    gzipChunks += 1;
    inflatedBytes += inflated.byteLength;

    const scan = scanMaterialElementRecords(inflated, 2027);
    framedMaterialElements += scan.framedMaterialElements;
    for (const definition of scan.definitions) {
      if (definitions.has(definition.elementId)) continue;
      definitions.set(definition.elementId, {
        elementId: definition.elementId,
        name: definition.name,
        stream: path.replace(/^Root Entry\//, ""),
        chunkIndex,
        storedOffset: revitStoredPageOffset(offsets[chunkIndex]!),
        recordOffset: definition.recordOffset,
        objectLength: definition.objectLength,
        evidence: definition.evidence,
      });
    }
  }
}

const ifcText = ifcBytes.toString("latin1");
const ifcNames = readIfcMaterialNames(ifcText);
const uniqueIfcNames = new Set(ifcNames);
const uniqueRvtNames = new Set([...definitions.values()].map((definition) => definition.name));
const exactNameMatches = [...uniqueIfcNames]
  .filter((name) => uniqueRvtNames.has(name))
  .sort((a, b) => a.localeCompare(b));
const missingIfcNames = [...uniqueIfcNames]
  .filter((name) => !uniqueRvtNames.has(name))
  .sort((a, b) => a.localeCompare(b));
const materialAssociationRelations =
  ifcText.match(/^#\d+ *= *IFCRELASSOCIATESMATERIAL\(/gm)?.length ?? 0;

const result = {
  schemaVersion: 1,
  generatedBy: "scripts/audit-rvt-materials.ts",
  inputs: {
    rvt: { name: basename(paths.rvt), bytes: rvtBytes.length, sha256: sha256(rvtBytes) },
    ifc: { name: basename(paths.ifc), bytes: ifcBytes.length, sha256: sha256(ifcBytes) },
  },
  scan: {
    revitVersion: 2027,
    partitionStreams,
    gzipChunks,
    inflatedBytes,
    materialElementMarker: "0x0ad3",
    framedMaterialElements,
    namedMaterialDefinitions: definitions.size,
    unnamedOrUnsupportedNameLayout: framedMaterialElements - definitions.size,
    uniqueDecodedNames: uniqueRvtNames.size,
    definitions: [...definitions.values()].sort((a, b) => a.elementId - b.elementId),
  },
  ifcReference: {
    materialEntities: ifcNames.length,
    uniqueMaterialNames: uniqueIfcNames.size,
    materialAssociationRelations,
    exactDecodedNameMatches: exactNameMatches.length,
    exactDecodedNameCoverage: uniqueIfcNames.size
      ? exactNameMatches.length / uniqueIfcNames.size
      : null,
    exactNameMatches,
    missingIfcNames,
  },
  assignments: {
    decodedElementAssignments: 0,
    decodedPrimitiveAssignments: 0,
    status: "not-decoded",
    reason:
      "The proven outer MaterialElem record contains definition identity and name only. " +
      "Element/type, geometry-tag, stored-mesh, BRep-face, category-style, and view-override " +
      "assignment layers remain schema-generic or geometry-dependent and are not inferred.",
  },
};

mkdirSync(dirname(paths.json), { recursive: true });
writeFileSync(paths.json, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  `RVT: ${framedMaterialElements} framed material elements; ` +
  `${definitions.size} named definitions; ${uniqueRvtNames.size} unique names`,
);
console.log(
  `IFC: ${ifcNames.length} material entities; ${uniqueIfcNames.size} unique names; ` +
  `${exactNameMatches.length} exact name matches`,
);
console.log("Assignments: 0 (intentionally not inferred)");
console.log(`Wrote ${paths.json}`);
