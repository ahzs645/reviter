/** Actual-original source binding for conservative fixed graphics operands.
 * Plain replay/schema facts cannot construct these WeakMap capabilities.
 * A successful certificate concerns foreign obstruction enclosure only. */
import { readFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { openRevitContainer } from "./convert-container.ts";
import { activeClassTagTranslation, setActiveClassTagTranslation } from "./revit-class-tags.ts";
import { activeElementIdBytes, setActiveElementIdBytes } from "./element-id-width.ts";
import { asBytes, gzipOffsets, inflateRevitChunk, revitWindowTail, stripRevitPageChecksums } from "./revit-container.ts";
import { readSchema, type SchemaStream, type SchemaStreamClass } from "./schema-reader.ts";
import { indexPageFrames } from "./page-frame-index.ts";
import { scanElementHeaders } from "./element-headers.ts";
import { createSplitFrameStream } from "./split-frame-stream.ts";
import { decodeRevit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "./revit-2027-grep-replay.ts";
import { collectRevit2027GInstanceBindings } from "./revit-2027-nested-instance.ts";
import { Rational } from "./native-rational-overlay.ts";
import { originalNativeForeignEnvelopeFacts, readOriginalForeignEnvelopeScopedFrame, type OriginalNativeForeignEnvelopeCensus } from "./native-source-foreign-envelope-census.ts";
import {
  inspectOriginalFixedGraphicsTreeOperands,
  ORIGINAL_FIXED_GRAPHICS_BIFLIP_DECODER_SHA256,
  type OriginalFixedGraphicsContract,
  type OriginalFixedGraphicsNode,
  type OriginalFixedGraphicsOperands,
  type OriginalFixedGraphicsEnclosure,
} from "./native-source-fixed-graphics-tree-enclosure.ts";

const digest = (b: Uint8Array) => bytesToHex(sha256(b));
const validId = (id: number) => Number.isSafeInteger(id) && id > 0 && id <= 0x7fffffff;
const authority = { walkingSupportApproved: false as const, indoorCellApproved: false as const, routeApproved: false as const };
/** This original schema is the independently retained decoder contract. New
 * schemas need an explicit audited grammar contract, never caller booleans. */
export const ORIGINAL_FIXED_GRAPHICS_SCHEMA_SHA256 =
  "d961c44726fe7fc32bce4425639481a5d5e91acecec7b7fd897610fc369f046f";

/** Exact schema-derived contract facts only; the return value is diagnostic.
 * The source constructor below obtains the schema bytes from the actual RVT. */
export function inspectOriginalFixedGraphicsSourceSchema(schemaBytes: Uint8Array): OriginalFixedGraphicsContract {
  if (digest(schemaBytes) !== ORIGINAL_FIXED_GRAPHICS_SCHEMA_SHA256)
    throw Error("Original fixed-graphics schema decoder contract changed");
  const parsed = readSchema(schemaBytes);
  if (!parsed.ok || parsed.schema.trailingBytes || parsed.schema.terminatorBytes !== 8 || parsed.schema.unresolvedReferences.length || parsed.schema.inlineIndexMismatches.length)
    throw Error("Incomplete original fixed-graphics schema");
  const schema: SchemaStream = parsed.schema, classes = new Map(schema.classes.map(c => [c.index, c]));
  if (classes.size !== schema.classes.length) throw Error("Aliased original fixed-graphics schema");
  const ancestry = (slot: number) => {
    const result: SchemaStreamClass[] = []; let next: number | undefined = slot;
    while (next !== undefined) {
      const c = classes.get(next);
      if (!c || c.unknownWord || c.properties.length !== c.propertyCount || result.some(x => x.index === next) || result.length >= 64) throw Error("Unclosed original graphics class ancestry");
      result.push(c); next = c.parent.kind === "none" ? undefined : c.parent.index;
    }
    return result;
  };
  for (const [slot, name] of [[2219, "GBiFlipControl"], [2343, "Geometry"], [2215, "GInstance"], [2513, "InstanceInfo"], [2246, "GElement"], [605, "BaseRailingSym"], [967, "ContinuousRailSymbol"], [2064, "FamilySymbol"], [598, "BaseRailing"], [4406, "TopRail"]] as const)
    if (classes.get(slot)?.name !== name) throw Error("Original fixed-graphics source class differs");
  const flip = ancestry(2219), control = flip.find(c => c.name === "GControl"), node = flip.find(c => c.name === "GNode");
  if (!control || control.properties.length || !node || flip.length !== 3 || node.properties.length !== 1 || node.properties[0]!.name !== "m_GInfo")
    throw Error("Original annotation control ancestry adds an unaccounted operand");
  const properties = flip[0]!.properties;
  if (JSON.stringify(properties.map(p => [p.name, p.fieldType, p.loadingMode, p.itemMode, p.size ?? null, p.unknownWord])) !== JSON.stringify([
    ["m_origin", 7, 0, 1, 3, 0], ["m_base", 7, 0, 1, 3, 0], ["m_length", 7, 0, 0, null, 0],
  ])) throw Error("Original annotation control has an unknown material/child operand");
  const gInfoRef = node.properties[0]!.staticType;
  const gInfo = gInfoRef && gInfoRef.kind !== "none" && gInfoRef.kind !== "unresolved" ? classes.get(gInfoRef.index) : undefined;
  if (!gInfo || gInfo.name !== "GInfo" || gInfo.parent.kind !== "none" || JSON.stringify(gInfo.properties.map(p => p.name)) !== JSON.stringify(["m_categoryId", "m_tag", "m_controlCommand", "m_flags"]))
    throw Error("Original common graphics metadata contract differs");
  // The schema establishes persisted field boundaries, not the meaning of a
  // nonzero command. Geometry commands remain a separate explicit refusal.
  return {
    sourceSchemaSha256: digest(schemaBytes),
    gBiFlipControl: {
      sourceClassSlot: 2219, originalClassName: "GBiFlipControl",
      originalAncestorNames: flip.slice(1).map(c => c.name),
      originalDerivedFieldNames: properties.map(p => p.name),
      originalBodyBytes: 76,
      role: "non-solid-annotation-control-no-child-or-material-operands",
      decoderSourceSha256: ORIGINAL_FIXED_GRAPHICS_BIFLIP_DECODER_SHA256,
    },
  };
}

const contextBrand: unique symbol = Symbol("OriginalFixedGraphicsTreeContext");
export type OriginalFixedGraphicsTreeContext = {
  readonly [contextBrand]: true;
  readonly sourceModelSha256: string;
  readonly sourceSchemaSha256: string;
  readonly completeSourcePages: number;
};
type NodeIdentity = {
  nativeElementId: number;
  nativeSourceClassSlot: number;
  nativeSourceClassName: string;
  nativeSourceFrameSha256: string;
  originalCategoryHeaders: ReturnType<typeof scanElementHeaders>;
  originalOwnerRecords: { elementId: number; owningElementId: number | null; byteOffset: number }[];
  originalFrameSha256: string;
};
type ContextData = { operands: OriginalFixedGraphicsOperands; identities: NodeIdentity[]; rootFrames: Map<number, Uint8Array>; decoderSourceSha256: string };
const contexts = new WeakMap<OriginalFixedGraphicsTreeContext, ContextData>();
function checkedFrame(bytes: Uint8Array, id: number, marker: number) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 40 || v.getUint32(0, true) !== id || v.getUint32(4, true) !== 0 || v.getUint16(16, true) !== marker || v.getUint32(12, true) + 20 !== bytes.length || v.getUint32(bytes.length - 4, true) !== bytes.length - 20)
    throw Error("Foreign/incomplete original fixed-graphics frame");
  let a = 1, b = 0;
  for (let i = 16; i < bytes.length - 4; i++) { a = (a + bytes[i]!) % 65521; b = (b + a) % 65521; }
  if (((b * 65536 + a) >>> 0) !== v.getUint32(8, true)) throw Error("Original fixed-graphics frame checksum mismatch");
}

/** Reads every actual source page and discovers dependencies ONLY from full
 * original GInstance/InstanceInfo bodies. Caller graphs/contracts are absent.
 * Unavailable cross-page native semantic records refuse rather than disappear.
 * This capture itself does not approve any material or resolve selectors. */
export function createOriginalFixedGraphicsTreeContext(originalRvtBytes: Uint8Array, expectedSha256: string, rootNativeElementIds: readonly number[]): OriginalFixedGraphicsTreeContext {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || !rootNativeElementIds.length || rootNativeElementIds.length > 16 || rootNativeElementIds.some(id => !validId(id)) || new Set(rootNativeElementIds).size !== rootNativeElementIds.length)
    throw Error("Invalid original fixed-graphics source request");
  const bytes = Uint8Array.from(originalRvtBytes);
  if (digest(bytes) !== expectedSha256) throw Error("Original fixed-graphics RVT checksum mismatch");
  const decoderBytes = readFileSync(new URL("./revit-2027-gbi-flip-control.ts", import.meta.url));
  if (digest(decoderBytes) !== ORIGINAL_FIXED_GRAPHICS_BIFLIP_DECODER_SHA256) throw Error("Original annotation/control decoder contract changed");
  const previousTags = activeClassTagTranslation(), previousWidth = activeElementIdBytes();
  try {
    const opened = openRevitContainer(bytes, {});
    if (opened.decoderPlan.revitVersion !== 2027 || activeElementIdBytes() !== 8 || !opened.classTagTranslation.identity || opened.classTagTranslation.movedClasses || !opened.nativeSourceSchemaBytes)
      throw Error("Unsupported original fixed-graphics source layout");
    const contracts = inspectOriginalFixedGraphicsSourceSchema(opened.nativeSourceSchemaBytes);
    const parsed = readSchema(opened.nativeSourceSchemaBytes); if (!parsed.ok) throw Error("Original graphics schema absent");
    const classes = new Map(parsed.schema.classes.map(c => [c.index, c]));
    type Location = { partition: number; page: number; offset: number; length: number; marker: number };
    const small = new Map<number, Location[]>(), large = new Map<number, Uint8Array[]>(), headers = new Map<number, ReturnType<typeof scanElementHeaders>>();
    const partitions: { raw: Uint8Array; offsets: number[]; pages: { dictionary: Uint8Array | null; length: number }[] }[] = [];
    let pages = 0, retainedLarge = 0;
    for (const partition of opened.partitions) {
      const raw = stripRevitPageChecksums(asBytes(partition.entry.content)), offsets = gzipOffsets(raw, 10001);
      if (offsets.length > 10000) throw Error("Original fixed-graphics source page ceiling");
      const current = { raw, offsets, pages: [] as { dictionary: Uint8Array | null; length: number }[] }, pi = partitions.length;
      partitions.push(current); let window: Uint8Array | null = null;
      const stream = createSplitFrameStream({ markers: [2246], minObjectLength: 40, maxFrameBytes: 16 * 1024 * 1024, minWholeObjectLength: 65535 });
      for (let pageIndex = 0; pageIndex < offsets.length; pageIndex++) {
        const dictionary = window ? Uint8Array.from(window) : null, page = inflateRevitChunk(raw, offsets[pageIndex]!, offsets[pageIndex + 1], window);
        if (!page) throw Error("Original fixed-graphics source inflation failed");
        window = revitWindowTail(page); current.pages.push({ dictionary, length: page.length }); pages++;
        for (const h of scanElementHeaders(page)) { const all = headers.get(h.elementId) ?? []; all.push(h); headers.set(h.elementId, all); }
        for (const f of indexPageFrames(page).frames) { const all = small.get(f.elementId) ?? []; all.push({ partition: pi, page: pageIndex, offset: f.offset, length: f.objectLength + 20, marker: f.marker }); small.set(f.elementId, all); }
        for (const f of stream.push(page)) {
          checkedFrame(f.data, f.elementId, 2246); retainedLarge += f.data.length;
          if (retainedLarge > 192 * 1024 * 1024) throw Error("Original fixed-graphics source retention ceiling");
          const all = large.get(f.elementId) ?? []; all.push(Uint8Array.from(f.data)); large.set(f.elementId, all);
        }
      }
    }
    const pageCache = new Map<string, Uint8Array>();
    const framesFor = (id: number) => {
      const result = new Map<string, { marker: number; bytes: Uint8Array }>();
      for (const b of large.get(id) ?? []) result.set(`2246:${digest(b)}`, { marker: 2246, bytes: b });
      for (const loc of small.get(id) ?? []) {
        const key = `${loc.partition}:${loc.page}`, p = partitions[loc.partition]!;
        let page = pageCache.get(key);
        if (!page) { page = inflateRevitChunk(p.raw, p.offsets[loc.page]!, p.offsets[loc.page + 1], p.pages[loc.page]!.dictionary) ?? undefined; if (!page || page.length !== p.pages[loc.page]!.length) throw Error("Original fixed-graphics page replay failed"); if (pageCache.size > 8) pageCache.clear(); pageCache.set(key, page); }
        const b = Uint8Array.from(page.subarray(loc.offset, loc.offset + loc.length)); checkedFrame(b, id, loc.marker);
        result.set(`${loc.marker}:${digest(b)}`, { marker: loc.marker, bytes: b });
      }
      return [...result.values()];
    };
    const todo = [...rootNativeElementIds], visited = new Set<number>(), nodes: OriginalFixedGraphicsNode[] = [], identities: NodeIdentity[] = [], rootFrames = new Map<number, Uint8Array>();
    while (todo.length) {
      const id = todo.shift()!; if (visited.has(id)) continue;
      if (!validId(id) || visited.size >= 256) throw Error("Original fixed-symbol dependency ceiling"); visited.add(id);
      const frames = framesFor(id), geometry = frames.filter(f => f.marker === 2246);
      const expectedClasses = rootNativeElementIds.includes(id) ? new Set([598, 4406]) : new Set([605, 967, 2064]);
      const semantic = frames.filter(f => expectedClasses.has(f.marker));
      if (geometry.length !== 1 || semantic.length !== 1) throw Error("Original fixed-symbol/native occurrence missing or ambiguous");
      const rootFrame = geometry[0]!.bytes, v = new DataView(rootFrame.buffer, rootFrame.byteOffset, rootFrame.byteLength);
      const decoded = decodeRevit2027FramedGRepRoot(rootFrame, { offset: 0, elementId: id, marker: 2246, objectLength: rootFrame.length - 20, typeCode: v.getUint32(18, true) }, 2027);
      if (!decoded.ok) throw Error(decoded.error);
      const replay = replayRevit2027GRepFifo(rootFrame, decoded.value); if (!replay.ok) throw Error(replay.error);
      const bindings = collectRevit2027GInstanceBindings(replay.value); if (!bindings.ok) throw Error(bindings.error);
      for (const b of bindings.value) { if (b.kind !== "external") throw Error("Original embedded fixed-symbol source not supported"); todo.push(Number(b.instance.symbolElementId)); }
      const originalCategoryHeaders = headers.get(id) ?? [], owners = opened.elementOwnership?.records.filter(r => r.elementId === id) ?? [];
      if (owners.length !== 1) throw Error("Original fixed-symbol source ownership missing or ambiguous");
      if (rootNativeElementIds.includes(id)) {
        const category = semantic[0]!.marker === 598 ? -2000126 : -2000946;
        if (!originalCategoryHeaders.length || originalCategoryHeaders.some(h => h.categoryId !== category || h.ownerViewId !== null || h.designOptionId !== null)) throw Error("Original fixed-tree occurrence category/view/option differs");
        rootFrames.set(id, rootFrame);
      }
      identities.push({ nativeElementId: id, nativeSourceClassSlot: semantic[0]!.marker, nativeSourceClassName: classes.get(semantic[0]!.marker)!.name, nativeSourceFrameSha256: digest(semantic[0]!.bytes), originalCategoryHeaders, originalOwnerRecords: owners.map(r => ({ ...r })), originalFrameSha256: digest(rootFrame) });
      nodes.push({ nativeElementId: id, originalFrameSha256: digest(rootFrame), replay: replay.value });
    }
    if (digest(readFileSync(new URL("./revit-2027-gbi-flip-control.ts", import.meta.url))) !== ORIGINAL_FIXED_GRAPHICS_BIFLIP_DECODER_SHA256) throw Error("Original annotation/control decoder changed during source capture");
    const context = Object.freeze({ [contextBrand]: true as const, sourceModelSha256: expectedSha256, sourceSchemaSha256: contracts.sourceSchemaSha256, completeSourcePages: pages });
    contexts.set(context, { operands: { mode: "all-original-fixed-graphics-branches-v1", sourceModelSha256: expectedSha256, sourceSchemaSha256: contracts.sourceSchemaSha256, rootNativeElementIds: [...rootNativeElementIds], nodes, contracts }, identities, rootFrames, decoderSourceSha256: ORIGINAL_FIXED_GRAPHICS_BIFLIP_DECODER_SHA256 });
    return context;
  } finally { setActiveClassTagTranslation(previousTags); setActiveElementIdBytes(previousWidth); }
}

export function inspectOriginalFixedGraphicsTreeContext(context: OriginalFixedGraphicsTreeContext) {
  const source = contexts.get(context); if (!source) throw Error("Untrusted original fixed-graphics context");
  return { sourceModelSha256: context.sourceModelSha256, sourceSchemaSha256: context.sourceSchemaSha256, originalNodeIdentities: structuredClone(source.identities), contracts: structuredClone(source.operands.contracts), inspection: inspectOriginalFixedGraphicsTreeOperands(source.operands), ...authority };
}

const certificateBrand: unique symbol = Symbol("OriginalFixedGraphicsForeignObstruction");
export type OriginalFixedGraphicsForeignObstruction = { readonly [certificateBrand]: true; readonly nativeRootId: number; readonly sourceModelSha256: string; readonly sourceSchemaSha256: string; readonly sourceFrameSha256: string; readonly sourceCensusSha256: string };
const certificates = new WeakMap<OriginalFixedGraphicsForeignObstruction, { cells: OriginalFixedGraphicsEnclosure[]; facts: ReturnType<typeof inspectOriginalFixedGraphicsTreeContext> }>();

/** Existing strict target/view parsers are unchanged. This separate certificate
 * may only retain a complete conservative obstruction union. It never selects
 * a view, proves support, or exempts an original body from a clearance check. */
export function proveOriginalFixedGraphicsForeignObstruction(context: OriginalFixedGraphicsTreeContext, census: OriginalNativeForeignEnvelopeCensus, nativeRootId: number): OriginalFixedGraphicsForeignObstruction {
  const source = contexts.get(context); if (!source || !source.rootFrames.has(nativeRootId)) throw Error("Untrusted/unrequested original fixed-graphics context");
  if (context.sourceModelSha256 !== census.sourceModelSha256 || context.sourceSchemaSha256 !== census.sourceSchemaSha256) throw Error("Foreign original fixed-tree model/schema");
  const originalFrame = readOriginalForeignEnvelopeScopedFrame(census, nativeRootId), frameSha = digest(originalFrame);
  if (frameSha !== digest(source.rootFrames.get(nativeRootId)!)) throw Error("Stale/foreign original fixed-tree root frame");
  const facts = originalNativeForeignEnvelopeFacts(census), rows = facts.rows.filter(r => r.nativeElementId === nativeRootId), identity = source.identities.find(i => i.nativeElementId === nativeRootId)!;
  if (rows.length !== 1 || rows[0]!.sourceFrameSha256 !== frameSha || rows[0]!.categoryId !== identity.originalCategoryHeaders[0]!.categoryId) throw Error("Original fixed-tree root census/category differs");
  const allFacts = inspectOriginalFixedGraphicsTreeContext(context);
  if (!allFacts.inspection.ok) throw Error(allFacts.inspection.blockers.join(";"));
  const certificate = Object.freeze({ [certificateBrand]: true as const, nativeRootId, sourceModelSha256: context.sourceModelSha256, sourceSchemaSha256: context.sourceSchemaSha256, sourceFrameSha256: frameSha, sourceCensusSha256: census.sourceCensusSha256 });
  certificates.set(certificate, { cells: allFacts.inspection.cells.filter(c => c.nativeRootId === nativeRootId), facts: allFacts }); return certificate;
}
function cloneCells(cells: readonly OriginalFixedGraphicsEnclosure[]) {
  return cells.map(c => ({ ...c, originalInstancePath: structuredClone(c.originalInstancePath), originalFaceTokens: [...c.originalFaceTokens], originalSourceReplayIndices: [...c.originalSourceReplayIndices], pointsFeet: c.pointsFeet.map(p => p.map(q => new Rational(q.n, q.d)) as typeof p), separatingAxes: c.separatingAxes.map(p => p.map(q => new Rational(q.n, q.d)) as typeof p) }));
}
export function originalFixedGraphicsForeignObstructionFacts(certificate: OriginalFixedGraphicsForeignObstruction) {
  const source = certificates.get(certificate); if (!source) throw Error("Untrusted original fixed-tree obstruction certificate");
  if (!source.facts.inspection.ok) throw Error("Original fixed-tree enclosure was not qualified");
  return { nativeRootId: certificate.nativeRootId, sourceModelSha256: certificate.sourceModelSha256, sourceSchemaSha256: certificate.sourceSchemaSha256, sourceFrameSha256: certificate.sourceFrameSha256, sourceCensusSha256: certificate.sourceCensusSha256, cells: cloneCells(source.cells), originalNodeIdentities: structuredClone(source.facts.originalNodeIdentities), contracts: structuredClone(source.facts.contracts), literalSelectorLedger: structuredClone(source.facts.inspection.literalSelectorLedger), originalOperandLedger: structuredClone(source.facts.inspection.originalOperandLedger), originalSourceAuthorityGranted: false as const, completeSemanticPhysicalModelApproved: false as const, targetSelectionPerformed: false as const, widgetExtentApproved: false as const, foreignHumanClearanceApproved: false as const, ...authority };
}
