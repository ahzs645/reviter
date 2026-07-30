#!/usr/bin/env node

/**
 * Read-only proof of concept for locating Autodesk GLB palette values inside
 * framed Revit 2027 MaterialElem records.
 *
 * The GLB is used only as a verification oracle. A candidate is reported only
 * when its byte representation occurs inside the independently framed RVT
 * material record.
 *
 * Usage:
 *   node --experimental-strip-types scripts/audit-rvt-glb-material-palette.ts \
 *     --rvt model.rvt --glb reference.glb --json report.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import CFB from "cfb";

import { scanMaterialElementRecords } from "../lib/reviter/material-records.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";

const argv = process.argv.slice(2);

function option(name: string): string {
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1]) return resolve(argv[index + 1]!);
  throw new Error(`Missing ${name}. Run with --rvt, --glb, and --json.`);
}

const paths = {
  rvt: option("--rvt"),
  glb: option("--glb"),
  json: option("--json"),
};

type PaletteColor = {
  materialIndex: number;
  name: string | null;
  rgba: [number, number, number, number];
  rgbaBytes: [number, number, number, number];
};

function readGlbPalette(bytes: Uint8Array): PaletteColor[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.byteLength < 20 ||
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(16, true) !== 0x4e4f534a
  ) {
    throw new Error("Expected a glTF 2.0 binary GLB");
  }
  const jsonLength = view.getUint32(12, true);
  const document = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trim(),
  ) as {
    materials?: Array<{
      name?: string;
      pbrMetallicRoughness?: { baseColorFactor?: number[] };
    }>;
  };
  return (document.materials ?? []).map((material, materialIndex) => {
    const factor = material.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1];
    const rgba = factor.map((value) => Number(value)) as PaletteColor["rgba"];
    return {
      materialIndex,
      name: material.name ?? null,
      rgba,
      rgbaBytes: rgba.map((value) =>
        Math.max(0, Math.min(255, Math.round(value * 255)))) as PaletteColor["rgbaBytes"],
    };
  });
}

type Encoding = { encoding: string; bytes: number[] };

function colorEncodings(color: PaletteColor): Encoding[] {
  const [r, g, b, a] = color.rgbaBytes;
  return [
    // rvt-rs exposes this persisted value as `color_packed`: the low byte is
    // red, then green and blue, with a zero high byte.
    { encoding: "color-packed-rgb-u32le", bytes: [r, g, b, 0] },
    // Retain alpha as a separate diagnostic. It is not treated as RVT
    // transparency because glTF alpha and Revit transparency use different
    // ranges/semantics.
    { encoding: "glb-rgba-u8", bytes: [r, g, b, a] },
  ].filter((candidate, index, all) => {
    if (r === 0 && g === 0 && b === 0) return false;
    // Pure blue produces many structural 00 00 ff 00 sequences in these
    // records and is not distinctive enough for this byte-level audit.
    if (r === 0 && g === 0 && b === 255) return false;
    return all.findIndex((other) =>
      other.bytes.length === candidate.bytes.length &&
      other.bytes.every((value, byteIndex) => value === candidate.bytes[byteIndex])
    ) === index;
  });
}

function findAll(data: Uint8Array, pattern: readonly number[]): number[] {
  const offsets: number[] = [];
  if (!pattern.length || pattern.length > data.byteLength) return offsets;
  outer: for (let offset = 0; offset <= data.byteLength - pattern.length; offset += 1) {
    for (let index = 0; index < pattern.length; index += 1) {
      if (data[offset + index] !== pattern[index]) continue outer;
    }
    offsets.push(offset);
  }
  return offsets;
}

function hexContext(data: Uint8Array, offset: number, size: number): string {
  const start = Math.max(0, offset - 12);
  const end = Math.min(data.byteLength, offset + size + 12);
  return [...data.subarray(start, end)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join(" ");
}

function utf16FieldOffsets(data: Uint8Array, value: string): number[] {
  const encoded = new Uint8Array(value.length * 2);
  const view = new DataView(encoded.buffer);
  for (let index = 0; index < value.length; index += 1) {
    view.setUint16(index * 2, value.charCodeAt(index), true);
  }
  return findAll(data, encoded).map((offset) => offset - 4).filter((offset) => offset >= 0);
}

const DIRECT_NAME_TRAILER = [0xff, 0xff, 0xff, 0xff, 0xe0, 0x0c] as const;

function candidateAppearance(
  data: Uint8Array,
  value: string,
  evidence: string,
): {
  nameFieldOffset: number;
  colorPackedOffset: number;
  colorPacked: number;
  rgb: [number, number, number];
} | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const candidates = utf16FieldOffsets(data, value);
  for (const nameFieldOffset of candidates) {
    const characters = view.getUint32(nameFieldOffset, true);
    if (characters !== value.length) continue;
    const nameEnd = nameFieldOffset + 4 + characters * 2;
    const direct = evidence === "framed-material-element-name" &&
      DIRECT_NAME_TRAILER.every((byte, index) => data[nameEnd + index] === byte);
    const nested = evidence === "framed-nested-material-name" &&
      Array.from({ length: 8 }, (_, index) => data[nameEnd + index]).every(
        (byte) => byte === 0,
      ) &&
      nameEnd + 16 <= data.byteLength &&
      view.getUint32(nameEnd + 8, true) !== 0 &&
      view.getUint32(nameEnd + 12, true) === 0;
    if (!direct && !nested) continue;
    let colorPackedOffset = nameEnd + 72;
    if (direct) {
      const structuralCandidates: number[] = [];
      for (
        let offset = nameEnd + 48;
        offset + 16 <= Math.min(data.byteLength, nameEnd + 104);
        offset += 1
      ) {
        if (
          !Array.from({ length: 12 }, (_, index) => data[offset - 12 + index])
            .every((byte) => byte === 0) ||
          data[offset + 3] !== 0
        ) {
          continue;
        }
        const descriptor = view.getUint32(offset + 4, true);
        if (
          descriptor === 0 ||
          descriptor > 0xff ||
          !Array.from({ length: 8 }, (_, index) => data[offset + 8 + index])
            .every((byte) => byte === 0)
        ) {
          continue;
        }
        structuralCandidates.push(offset);
      }
      if (!structuralCandidates.length) continue;
      structuralCandidates.sort((left, right) =>
        Math.abs(left - (nameEnd + 84)) - Math.abs(right - (nameEnd + 84)));
      colorPackedOffset = structuralCandidates[0]!;
    }
    if (colorPackedOffset + 4 > data.byteLength) continue;
    const colorPacked = view.getUint32(colorPackedOffset, true);
    if ((colorPacked >>> 24) !== 0) continue;
    return {
      nameFieldOffset,
      colorPackedOffset,
      colorPacked,
      rgb: [
        colorPacked & 0xff,
        (colorPacked >>> 8) & 0xff,
        (colorPacked >>> 16) & 0xff,
      ],
    };
  }
  return null;
}

const rvtBytes = readFileSync(paths.rvt);
const glbBytes = readFileSync(paths.glb);
const palette = readGlbPalette(glbBytes);
const cfb = CFB.read(rvtBytes, { type: "buffer" });
const records: Array<{
  elementId: number;
  name: string;
  objectLength: number;
  evidence: string;
  stream: string;
  chunkIndex: number;
  nameFieldOffsets: number[];
  decodedCandidate: ReturnType<typeof candidateAppearance>;
  nativeAppearance: ReturnType<typeof scanMaterialElementRecords>["definitions"][number]["appearance"];
  matches: Array<{
    materialIndex: number;
    rgbaBytes: PaletteColor["rgbaBytes"];
    encoding: string;
    recordOffset: number;
    context: string;
  }>;
}> = [];

for (let entryIndex = 0; entryIndex < cfb.FileIndex.length; entryIndex += 1) {
  const path = cfb.FullPaths[entryIndex] ?? "";
  if (!/Partitions\/[^/]+$/i.test(path)) continue;
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
    const scan = scanMaterialElementRecords(inflated, 2027);
    for (const definition of scan.definitions) {
      const record = inflated.subarray(
        definition.recordOffset,
        definition.recordOffset + definition.objectLength,
      );
      const matches = palette.flatMap((color) =>
        colorEncodings(color).flatMap((candidate) =>
          findAll(record, candidate.bytes).map((recordOffset) => ({
            materialIndex: color.materialIndex,
            rgbaBytes: color.rgbaBytes,
            encoding: candidate.encoding,
            recordOffset,
            context: hexContext(record, recordOffset, candidate.bytes.length),
          }))));
      records.push({
        elementId: definition.elementId,
        name: definition.name,
        objectLength: definition.objectLength,
        evidence: definition.evidence,
        stream: path.replace(/^Root Entry\//, ""),
        chunkIndex,
        nameFieldOffsets: utf16FieldOffsets(record, definition.name),
        decodedCandidate: candidateAppearance(
          record,
          definition.name,
          definition.evidence,
        ),
        nativeAppearance: definition.appearance,
        matches,
      });
    }
  }
}

const uniqueRecords = [...new Map(
  records.map((record) => [record.elementId, record]),
).values()].sort((a, b) => a.elementId - b.elementId);
const paletteMappings = palette.map((color) => ({
  materialIndex: color.materialIndex,
  rgba: color.rgba,
  rgbaBytes: color.rgbaBytes,
  rvtMaterials: uniqueRecords.flatMap((record) => {
    const rgb = record.nativeAppearance?.baseColorSrgb;
    return rgb &&
      rgb[0] === color.rgbaBytes[0] &&
      rgb[1] === color.rgbaBytes[1] &&
      rgb[2] === color.rgbaBytes[2]
      ? [{
          elementId: record.elementId,
          name: record.name,
          colorFieldOffset: record.nativeAppearance!.colorFieldOffset,
          evidence: record.nativeAppearance!.evidence,
        }]
      : [];
  }),
}));

const result = {
  schemaVersion: 1,
  generatedBy: "scripts/audit-rvt-glb-material-palette.ts",
  inputs: {
    rvt: { name: basename(paths.rvt), bytes: rvtBytes.byteLength },
    glb: { name: basename(paths.glb), bytes: glbBytes.byteLength },
  },
  palette,
  paletteMappings,
  scan: {
    namedMaterialDefinitions: uniqueRecords.length,
    recordsWithCandidateMatches:
      uniqueRecords.filter((record) => record.matches.length > 0).length,
    candidateMatches:
      uniqueRecords.reduce((sum, record) => sum + record.matches.length, 0),
    structurallyDecodedCandidates:
      uniqueRecords.filter((record) => record.nativeAppearance).length,
    structurallyDecodedPaletteMatches:
      uniqueRecords.filter((record) => {
        const rgb = record.nativeAppearance?.baseColorSrgb;
        return rgb && palette.some((color) =>
          color.rgbaBytes[0] === rgb[0] &&
          color.rgbaBytes[1] === rgb[1] &&
          color.rgbaBytes[2] === rgb[2]);
      }).length,
    glbPaletteEntriesMapped:
      paletteMappings.filter((mapping) => mapping.rvtMaterials.length > 0).length,
    records: uniqueRecords,
  },
  caveat:
    "A raw byte match is diagnostic evidence only. Stable field offsets, schema " +
    "typing, and agreement with independently named materials are required " +
    "before a match can be promoted to a decoder.",
};

mkdirSync(dirname(paths.json), { recursive: true });
writeFileSync(paths.json, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  `${uniqueRecords.length} RVT material definitions; ` +
  `${result.scan.recordsWithCandidateMatches} records contain ` +
  `${result.scan.candidateMatches} GLB-palette byte candidates`,
);
for (const record of uniqueRecords.filter((item) => item.matches.length)) {
  const summary = record.matches
    .map((match) =>
      `#${match.materialIndex} ${match.rgbaBytes.slice(0, 3).join(",")} ` +
      `${match.encoding}@+${match.recordOffset}`)
    .join("; ");
  console.log(`${record.elementId} ${record.name}: ${summary}`);
}
console.log(`Wrote ${paths.json}`);
