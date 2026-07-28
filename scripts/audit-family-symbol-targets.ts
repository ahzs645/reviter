/**
 * Measure whether a framed FamilySymbol has one unambiguous reference to a
 * separately framed Family element, without assuming a fixed field offset.
 *
 * This is a read-only hypothesis audit. Its output is not used by conversion.
 *
 * Usage:
 *   node --experimental-strip-types scripts/audit-family-symbol-targets.ts model.rvt
 */
import { readFileSync } from "node:fs";
import CFB from "cfb";

import { scanFramedElementObjects } from "../lib/reviter/element-objects.ts";
import {
  REVIT_2027_FAMILY_MARKER,
  REVIT_2027_FAMILY_SYMBOL_MARKER,
} from "../lib/reviter/family-material-relations.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";

const modelPath = process.argv[2];
if (!modelPath) {
  throw new Error(
    "usage: node --experimental-strip-types scripts/audit-family-symbol-targets.ts model.rvt",
  );
}

type SymbolReference = {
  symbolId: number;
  objectLength: number;
  references: Map<number, number[]>;
  staticTailReferences: Map<number, number[]>;
};

const input = readFileSync(modelPath);
const cfb = CFB.read(input, { type: "buffer" });
const partitions = cfb.FileIndex
  .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
  .filter(
    ({ entry, path }) =>
      entry.size > 0 && /\/Partitions\/[^/]+$/i.test(path),
  );

const familyIds = new Set<number>();
const framedElementIds = new Set<number>();
const familyStrings = new Map<
  number,
  { objectLength: number; strings: { offset: number; value: string }[] }
>();
const symbols: SymbolReference[] = [];
let chunks = 0;
let failedChunks = 0;

function readUtf16(
  view: DataView,
  offset: number,
  limit: number,
): string | null {
  if (offset + 6 > limit) return null;
  const length = view.getUint32(offset, true);
  if (length < 1 || length > 256 || offset + 4 + length * 2 > limit) {
    return null;
  }
  let value = "";
  for (let index = 0; index < length; index += 1) {
    const code = view.getUint16(offset + 4 + index * 2, true);
    if (
      code === 0 ||
      code < 0x20 ||
      code === 0xffff ||
      (code >= 0xd800 && code <= 0xdfff)
    ) {
      return null;
    }
    value += String.fromCharCode(code);
  }
  return value;
}

/**
 * Immediately before `FamilySymbol.m_familyId`, the native reader consumes an
 * Outline (two Point3d values), origin, rotation center, and exactly two cut
 * plane heights: fourteen consecutive float64 values, or 112 bytes.
 */
function hasFamilyIdStaticTail(
  view: DataView,
  objectStart: number,
  familyIdOffset: number,
): boolean {
  const start = familyIdOffset - 112;
  if (start < objectStart + 18) return false;
  const values = Array.from(
    { length: 14 },
    (_, index) => view.getFloat64(start + index * 8, true),
  );
  if (!values.every(Number.isFinite)) return false;
  const orderedOutline =
    values[0]! <= values[3]! &&
    values[1]! <= values[4]! &&
    values[2]! <= values[5]!;
  const emptyOutline =
    values[0] === 1e30 &&
    values[1] === 1e30 &&
    values[2] === 1e30 &&
    values[3] === -1e30 &&
    values[4] === -1e30 &&
    values[5] === -1e30;
  return (
    orderedOutline ||
    emptyOutline
  );
}

for (const partition of partitions) {
  const stored = stripRevitPageChecksums(asBytes(partition.entry.content));
  const offsets = gzipOffsets(stored);
  let dictionary: Uint8Array | null = null;
  for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
    const read = inflateRevitChunk(
      stored,
      offsets[chunkIndex]!,
      offsets[chunkIndex + 1],
      dictionary,
    );
    const inflated =
      read ??
      salvageRevitChunk(
        stored,
        offsets[chunkIndex]!,
        offsets[chunkIndex + 1],
        dictionary,
      );
    if (!inflated) {
      failedChunks += 1;
      continue;
    }
    if (read) dictionary = revitWindowTail(read);
    chunks += 1;
    const view = new DataView(
      inflated.buffer,
      inflated.byteOffset,
      inflated.byteLength,
    );
    for (const frame of scanFramedElementObjects(inflated)) {
      framedElementIds.add(frame.elementId);
      if (frame.marker === REVIT_2027_FAMILY_MARKER) {
        familyIds.add(frame.elementId);
        const strings: { offset: number; value: string }[] = [];
        const stringEnd = Math.min(
          frame.offset + frame.objectLength,
          frame.offset + 4_096,
        );
        for (
          let offset = frame.offset + 18;
          offset + 6 <= stringEnd;
          offset += 1
        ) {
          const value = readUtf16(view, offset, stringEnd);
          if (value != null) {
            strings.push({ offset: offset - frame.offset, value });
          }
        }
        familyStrings.set(frame.elementId, {
          objectLength: frame.objectLength,
          strings,
        });
        continue;
      }
      if (frame.marker !== REVIT_2027_FAMILY_SYMBOL_MARKER) continue;
      const references = new Map<number, number[]>();
      const staticTailReferences = new Map<number, number[]>();
      const bodyStart = frame.offset + 18;
      const bodyEnd = frame.offset + frame.objectLength;
      // Object IDs are serialized as little-endian 64-bit values with a zero
      // high word in this corpus. Scan every byte so this audit does not bake
      // in an unproven alignment.
      for (let offset = bodyStart; offset + 8 <= bodyEnd; offset += 1) {
        if (view.getUint32(offset + 4, true) !== 0) continue;
        const id = view.getUint32(offset, true);
        if (id === 0) continue;
        const relativeOffsets = references.get(id);
        if (relativeOffsets) relativeOffsets.push(offset - frame.offset);
        else references.set(id, [offset - frame.offset]);
        if (hasFamilyIdStaticTail(view, frame.offset, offset)) {
          const tailOffsets = staticTailReferences.get(id);
          if (tailOffsets) tailOffsets.push(offset - frame.offset);
          else staticTailReferences.set(id, [offset - frame.offset]);
        }
      }
      symbols.push({
        symbolId: frame.elementId,
        objectLength: frame.objectLength,
        references,
        staticTailReferences,
      });
    }
  }
}

const resolved = symbols.map((symbol) => ({
  symbolId: symbol.symbolId,
  objectLength: symbol.objectLength,
  familyTargets: [...symbol.references]
    .filter(([id]) => familyIds.has(id))
    .map(([familyId, offsets]) => ({ familyId, offsets })),
}));
const unique = resolved.filter((symbol) => symbol.familyTargets.length === 1);
const ambiguous = resolved.filter((symbol) => symbol.familyTargets.length > 1);
const afterInheritedPrefix = resolved.map((symbol) => ({
  ...symbol,
  familyTargets: symbol.familyTargets
    .map((target) => ({
      ...target,
      offsets: target.offsets.filter((offset) => offset !== 76),
    }))
    .filter((target) => target.offsets.length > 0),
}));
const staticTailResolved = symbols.map((symbol) => ({
  symbolId: symbol.symbolId,
  objectLength: symbol.objectLength,
  familyTargets: [...symbol.staticTailReferences]
    .filter(([id]) => familyIds.has(id))
    .map(([familyId, offsets]) => ({ familyId, offsets })),
}));
const uniqueStaticTail = staticTailResolved.filter(
  (symbol) => symbol.familyTargets.length === 1,
);
const ambiguousStaticTail = staticTailResolved.filter(
  (symbol) => symbol.familyTargets.length > 1,
);
const missingStaticTail = staticTailResolved.filter(
  (symbol) => symbol.familyTargets.length === 0,
);
const uniqueAfterInheritedPrefix = afterInheritedPrefix.filter(
  (symbol) => symbol.familyTargets.length === 1,
);
const ambiguousAfterInheritedPrefix = afterInheritedPrefix.filter(
  (symbol) => symbol.familyTargets.length > 1,
);
const offsetCounts = new Map<number, number>();
const maximumFramedElementId = Math.max(...framedElementIds);
for (const symbol of unique) {
  for (const offset of symbol.familyTargets[0]!.offsets) {
    offsetCounts.set(offset, (offsetCounts.get(offset) ?? 0) + 1);
  }
}

console.log(JSON.stringify({
  modelPath,
  inputBytes: input.byteLength,
  partitions: partitions.length,
  chunks,
  failedChunks,
  familyElements: familyIds.size,
  familyElementsWithCandidateStrings:
    [...familyStrings.values()].filter((family) => family.strings.length > 0)
      .length,
  familySymbols: symbols.length,
  distinctZeroHighWordReferences:
    symbols.reduce((sum, symbol) => sum + symbol.references.size, 0),
  referencesResolvingToFramedElements:
    symbols.reduce(
      (sum, symbol) =>
        sum +
        [...symbol.references.keys()].filter((id) => framedElementIds.has(id))
          .length,
      0,
    ),
  referencesWithinFramedIdRange:
    symbols.reduce(
      (sum, symbol) =>
        sum +
        [...symbol.references.keys()].filter(
          (id) => id <= maximumFramedElementId,
        ).length,
      0,
    ),
  symbolsWithOneFamilyTarget: unique.length,
  symbolsWithMultipleFamilyTargets: ambiguous.length,
  symbolsWithNoFamilyTarget:
    symbols.length - unique.length - ambiguous.length,
  excludingObservedInheritedOffset76: {
    symbolsWithOneFamilyTarget: uniqueAfterInheritedPrefix.length,
    symbolsWithMultipleFamilyTargets: ambiguousAfterInheritedPrefix.length,
    symbolsWithNoFamilyTarget:
      symbols.length -
      uniqueAfterInheritedPrefix.length -
      ambiguousAfterInheritedPrefix.length,
  },
  requiringExactFamilyIdStaticTail: {
    symbolsWithOneFamilyTarget: uniqueStaticTail.length,
    symbolsWithMultipleFamilyTargets: ambiguousStaticTail.length,
    symbolsWithNoFamilyTarget:
      symbols.length - uniqueStaticTail.length - ambiguousStaticTail.length,
  },
  uniqueTargetOffsets: Object.fromEntries(
    [...offsetCounts].sort((a, b) => b[1] - a[1]),
  ),
  ambiguousSamples: ambiguous.slice(0, 20),
  ambiguousAfterInheritedPrefixSamples:
    ambiguousAfterInheritedPrefix.slice(0, 20),
  ambiguousStaticTailSamples: ambiguousStaticTail.slice(0, 20),
  missingStaticTailSamples: missingStaticTail.slice(0, 20).map((missing) => {
    const broad = resolved.find(
      (symbol) => symbol.symbolId === missing.symbolId,
    );
    return {
      ...missing,
      broadFamilyTargets: broad?.familyTargets ?? [],
    };
  }),
  familyStringSamples: [...familyStrings]
    .filter(([, family]) => family.strings.length > 0)
    .slice(0, 30)
    .map(([familyId, family]) => ({ familyId, ...family })),
}, null, 2));
