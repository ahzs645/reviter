/** Original import identity facts only. This module never assigns a drawing
 * reference role or removes geometry; that requires an independent review. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { readSchema } from "./schema-reader.ts";
import { readNativeStairTypedFifo, type NativeStairTypedFifo, type NativeTypedRootClassName } from "./native-stair-typed-fifo.ts";
import { indexPageFrames } from "./page-frame-index.ts";
import { canonicalClassTag } from "./revit-class-tags.ts";
import { createSplitFrameStream } from "./split-frame-stream.ts";
import type { ElementObject } from "./element-objects.ts";

export type NativeDrawingReferenceInstanceFact = {
  nativeElementId: number;
  sourceClass: "ImportInstance";
  instanceFrameSha256: string;
  masterSymbolId: number;
  masterSourceClass: "MasterImportSymbol";
  masterFrameSha256: string;
  masterName: string;
  sourceFileName: string;
  sourceFileNameEvidence: "ImportFileData.fileNameOnly" | "SymbolInfo.name";
  sourceFileNameSha256: string;
  sourcePath?: string;
  associatedLevelId?: number;
};
export type NativeDrawingReferenceSource = {
  version: 1;
  sourceModelSha256: string;
  schemaSha256: string;
  geometrySha256: string;
  instances: NativeDrawingReferenceInstanceFact[];
};
const hashBytes = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
const validSha = (value: string) => /^[a-f0-9]{64}$/.test(value);
const validId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])])) : value;
const hashValue = (value: unknown) => hashBytes(new TextEncoder().encode(JSON.stringify(canonical(value))));
export function nativeDrawingReferenceInstanceHash(fact: NativeDrawingReferenceInstanceFact): string { return hashValue(fact); }
export function nativeDrawingReferenceSourceHash(value: Omit<NativeDrawingReferenceSource, "geometrySha256"> | NativeDrawingReferenceSource): string {
  const raw: Partial<NativeDrawingReferenceSource> = { ...value }; delete raw.geometrySha256; return hashValue(raw);
}
const roots = new Set<NativeTypedRootClassName>(["ImportInstance", "MasterImportSymbol", "SlaveImportSymbol"]);
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const elementId = (value: unknown): number | undefined => {
  const outer = object(value), inner = object(outer?.m_id), id = inner?.m_id64;
  return validId(id) ? id : undefined;
};
const sourceName = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096 && !value.includes("\0");
type Root = { value: NativeStairTypedFifo; frameSha256: string };

export type NativeDrawingReferenceSourceCollector = {
  scanFrame(originalFrameBytes: Uint8Array): void;
  scanPage(page: Uint8Array, frames?: readonly ElementObject[]): void;
  finishPartition(): void;
  snapshot(sourceModelSha256: string): NativeDrawingReferenceSource | undefined;
};

/** Read each complete root/FIFO against the actual original embedded schema.
 * Unsupported/conflicting roots cannot produce a source fact. A source name
 * without a file extension remains exactly that name, with unknown format. */
export function createNativeDrawingReferenceSourceCollector(
  revitVersion: number | null | undefined,
  originalSchemaBytes?: Uint8Array,
): NativeDrawingReferenceSourceCollector {
  const schemaBytes = originalSchemaBytes ? Uint8Array.from(originalSchemaBytes) : undefined;
  const decoded = revitVersion === 2027 && schemaBytes ? readSchema(schemaBytes) : undefined;
  const schema = decoded?.ok ? decoded.schema : undefined;
  const classes = new Map(schema?.classes.map((c) => [c.index, c.name]) ?? []);
  const markers = [...classes].filter(([, name]) => roots.has(name as NativeTypedRootClassName)).map(([slot]) => canonicalClassTag(slot));
  const splitter = schema ? createSplitFrameStream({ markers, minObjectLength: 18, maxFrameBytes: 16 * 1024 * 1024, crossingOnly: true }) : undefined;
  const found = new Map<number, Root>(), refused = new Set<number>();
  const scanFrame = (bytes: Uint8Array) => {
    if (!schema || bytes.length < 18) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), name = classes.get(view.getUint16(16, true));
    if (!name || !roots.has(name as NativeTypedRootClassName)) return;
    const id = Number(view.getBigInt64(0, true)); if (!validId(id)) return;
    const result = readNativeStairTypedFifo(bytes, schema, name as NativeTypedRootClassName);
    if (!result.ok) { refused.add(id); return; }
    const digest = hashBytes(bytes), existing = found.get(id);
    if (found.size >= 16_384 || (existing && existing.frameSha256 !== digest)) { refused.add(id); return; }
    found.set(id, { value: result.value, frameSha256: digest });
  };
  const snapshot = (sourceModelSha256: string): NativeDrawingReferenceSource | undefined => {
    if (!schema || !schemaBytes || !validSha(sourceModelSha256)) return;
    const instances: NativeDrawingReferenceInstanceFact[] = [];
    for (const [id, instance] of found) {
      if (refused.has(id) || instance.value.rootClassName !== "ImportInstance") continue;
      const infoPointer = object(instance.value.root.m_pInstanceInfo);
      const info = instance.value.entries.filter((e) => e.sourceClassName === "InstanceInfo" &&
        e.descriptor.path === infoPointer?.path && e.descriptor.token === infoPointer?.token &&
        e.descriptor.sourceClassSlot === infoPointer?.sourceClassSlot);
      if (info.length !== 1) continue;
      const masterId = elementId(info[0]!.value.m_symbolId), master = masterId ? found.get(masterId) : undefined;
      if (!masterId || !master || refused.has(masterId) || master.value.rootClassName !== "MasterImportSymbol") continue;
      const namePointer = object(master.value.root.m_symbolInfo), filePointer = object(master.value.root.m_pImportData);
      const names = master.value.entries.filter((e) => e.sourceClassName === "SymbolInfo" &&
        e.descriptor.path === namePointer?.path && e.descriptor.token === namePointer?.token &&
        e.descriptor.sourceClassSlot === namePointer?.sourceClassSlot);
      const fileData = master.value.entries.filter((e) => e.sourceClassName === "ImportFileData" &&
        e.descriptor.path === filePointer?.path && e.descriptor.token === filePointer?.token &&
        e.descriptor.sourceClassSlot === filePointer?.sourceClassSlot);
      if (names.length !== 1 || !filePointer || (filePointer.token === 0 ? fileData.length !== 0 : fileData.length !== 1) || !sourceName(names[0]!.value.m_name)) continue;
      const masterName = names[0]!.value.m_name;
      if (fileData.length && elementId(fileData[0]!.value.m_symbolId) !== masterId) continue;
      const fileName = fileData.length ? fileData[0]!.value.m_fileNameOnly : masterName;
      if (!sourceName(fileName)) continue;
      const sourcePath = fileData[0]?.value.m_fullName, level = elementId(instance.value.root.m_assocLevelId);
      const fact: NativeDrawingReferenceInstanceFact = {
        nativeElementId: id, sourceClass: "ImportInstance", instanceFrameSha256: instance.frameSha256,
        masterSymbolId: masterId, masterSourceClass: "MasterImportSymbol", masterFrameSha256: master.frameSha256,
        masterName, sourceFileName: fileName, sourceFileNameEvidence: fileData.length ? "ImportFileData.fileNameOnly" : "SymbolInfo.name",
        sourceFileNameSha256: hashBytes(new TextEncoder().encode(fileName)),
        ...(sourceName(sourcePath) ? { sourcePath } : {}), ...(level ? { associatedLevelId: level } : {}),
      };
      instances.push(fact);
    }
    instances.sort((a, b) => a.nativeElementId - b.nativeElementId);
    const raw = { version: 1 as const, sourceModelSha256, schemaSha256: hashBytes(schemaBytes), instances };
    return { ...raw, geometrySha256: nativeDrawingReferenceSourceHash(raw) };
  };
  return {
    scanFrame,
    scanPage(page, frames) {
      if (!schema) return;
      for (const frame of frames ?? indexPageFrames(page).frames) scanFrame(page.subarray(frame.offset, frame.offset + frame.objectLength + 20));
      for (const split of splitter!.push(page)) for (const frame of indexPageFrames(split.data).frames) scanFrame(split.data.subarray(frame.offset, frame.offset + frame.objectLength + 20));
    },
    finishPartition() { splitter?.reset(); },
    snapshot,
  };
}
