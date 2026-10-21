/** Actual original stair assembly membership only. Complete child ownership is
 * read from all original run/landing semantic occurrences, never inferred from
 * proximity, nominal storeys or a possibly unpopulated parent list. No graph,
 * walking join, physical clearance or route authority is issued here. */
import { Rational, rational } from "./native-rational-overlay.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { openRevitContainer } from "./convert-container.ts";
import { activeClassTagTranslation, setActiveClassTagTranslation, type ClassTagTranslation } from "./revit-class-tags.ts";
import { activeElementIdBytes, setActiveElementIdBytes } from "./element-id-width.ts";
import { asBytes, gzipOffsets, inflateRevitChunk, revitWindowTail, stripRevitPageChecksums } from "./revit-container.ts";
import { createSplitFrameStream } from "./split-frame-stream.ts";
import { readSchema, type SchemaStream, type SchemaStreamProperty } from "./schema-reader.ts";
import { readNativeStairTypedFifo } from "./native-stair-typed-fifo.ts";
import { readOriginalForeignEnvelopeScopedFrame, type OriginalNativeForeignEnvelopeCensus } from "./native-source-foreign-envelope-census.ts";
import { decodeRevit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "./revit-2027-grep-replay.ts";
import { inspectOriginalStairLandingCarrierMaterial } from "./native-source-stair-landing-carrier-material.ts";
import { revit2027OwnerMeshIndex } from "./revit-2027-owner-mesh-index.ts";
import { inspectOriginalStairSupportEnvelopes } from "./native-source-stair-support-envelopes.ts";
import { inspectOriginalStairLocalMaterialCells } from "./native-source-stair-local-material.ts";
const digest = (b: Uint8Array) => bytesToHex(sha256(b));
const validId = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= 0x7fffffff;
const sourceId = (v: unknown) => (v as { m_id?: { m_id64?: unknown } } | undefined)?.m_id?.m_id64;
type SourceValue = Record<string, unknown>;
export type OriginalAssemblySemanticPrefix = {
  nativeElementId: number;
  sourceClassName: "StairsElement" | "StairsRun" | "StairsLanding" | "StairsRunAndLanding";
  sourceFrameSha256: string;
  root: SourceValue;
  fields: { path: string; sourceClassName: string; sourceSchemaFieldOffset: number; start: number; end: number; omitted?: true }[];
  originalStaticPrefixEnd: number;
  completeSemanticFifoDecoded: false;
  sourceAuthorityGranted: false;
};
function checkedFrame(bytes: Uint8Array, marker: number) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 40 || v.getUint16(16, true) !== marker || v.getUint32(4, true) !== 0 ||
    v.getUint32(12, true) + 20 !== bytes.length || v.getUint32(bytes.length - 4, true) !== v.getUint32(12, true))
    throw Error("Invalid original assembly frame identity/echo");
  let a = 1, b = 0;
  for (let i = 16; i < bytes.length - 4; i++) { a = (a + bytes[i]!) % 65521; b = (b + a) % 65521; }
  if (((b * 65536 + a) >>> 0) !== v.getUint32(8, true)) throw Error("Original assembly frame checksum mismatch");
}
/** Schema-bound static field prefix, not a caller-provided membership authority.
 * Dynamic descriptors are retained without claiming their FIFO geometry. */
export type OriginalAssemblySemanticFifo = Omit<OriginalAssemblySemanticPrefix, "completeSemanticFifoDecoded"> & {
  completeSemanticFifoDecoded: true;
  originalSemanticFifoEnd: number;
  entries: { descriptor: { token: number; sourceClassSlot: number | null; start: number; end: number; path: string }; sourceClassName: string; start: number; end: number; value: SourceValue }[];
};
export function inspectOriginalStairAssemblySemanticPrefix(bytes: Uint8Array, schema: SchemaStream, expectedClass: OriginalAssemblySemanticPrefix["sourceClassName"]): OriginalAssemblySemanticPrefix {
  return inspectSemantic(bytes, schema, expectedClass, false) as OriginalAssemblySemanticPrefix;
}
/** Complete exact schema/FIFO replay for original assembly semantic geometry.
 * Every source descriptor remains; unread classes and unconsumed bytes refuse. */
export function inspectOriginalStairAssemblySemanticFifo(bytes: Uint8Array, schema: SchemaStream, expectedClass: OriginalAssemblySemanticPrefix["sourceClassName"]): OriginalAssemblySemanticFifo {
  return inspectSemantic(bytes, schema, expectedClass, true) as OriginalAssemblySemanticFifo;
}
function inspectSemantic(
  bytes: Uint8Array, schema: SchemaStream, expectedClass: OriginalAssemblySemanticPrefix["sourceClassName"], full: boolean,
): OriginalAssemblySemanticPrefix | OriginalAssemblySemanticFifo {
  const classes = new Map(schema.classes.map(c => [c.index, c])), wanted = schema.classes.find(c => c.name === expectedClass);
  if (classes.size !== schema.classes.length || !wanted || schema.trailingBytes || schema.terminatorBytes !== 8 || schema.unresolvedReferences.length || schema.inlineIndexMismatches.length)
    throw Error("Incomplete original assembly schema");
  checkedFrame(bytes, wanted.index);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), end = bytes.length - 4;
  let at = 18, budget = 0;
  const fields: OriginalAssemblySemanticPrefix["fields"] = [];
  const descriptors: OriginalAssemblySemanticFifo["entries"][number]["descriptor"][] = [];
  const take = (n: number) => { if (!Number.isSafeInteger(n) || n < 0 || at > end - n) throw Error("Truncated original assembly semantic prefix"); const p = at; at += n; return p; };
  const count = () => { const n = v.getInt32(take(4), true); if (n < 0 || n > 100000) throw Error("Assembly collection exceeds bound"); return n; };
  const primitive = (type: number): unknown => {
    if (type === 1) { const n = v.getUint8(take(1)); if (n > 1) throw Error("Invalid assembly boolean"); return n; }
    if (type === 2) return v.getInt8(take(1));
    if (type === 3 || type === 10) return v.getInt16(take(2), true);
    if (type === 4 || type === 5) return v.getInt32(take(4), true);
    if (type === 6 || type === 7) { const n = type === 6 ? v.getFloat32(take(4), true) : v.getFloat64(take(8), true); if (!Number.isFinite(n)) throw Error("Nonfinite assembly field"); return n; }
    if (type === 8) { const n = count(), p = take(n * 2); return new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(p, at)); }
    if (type === 9) return Array.from(bytes.subarray(take(16), at));
    if (type === 11) { const n = Number(v.getBigInt64(take(8), true)); if (!Number.isSafeInteger(n)) throw Error("Unrepresentable assembly ID"); return n; }
    throw Error("Unsupported original assembly primitive");
  };
  const object = (slot: number, path: string, depth: number): SourceValue => {
    const c = classes.get(slot);
    if (!c || c.unknownWord || c.properties.length !== c.propertyCount || depth > 64) throw Error("Unsupported assembly class ancestry");
    const result = c.parent.kind === "none" ? {} : object(c.parent.index, path, depth + 1);
    for (const f of c.properties) { if (Object.hasOwn(result, f.name)) throw Error("Duplicate inherited assembly field"); result[f.name] = field(f, `${path}.${f.name}`, c.name, depth + 1); }
    return result;
  };
  const one = (f: SchemaStreamProperty, path: string, owner: string, depth: number): unknown => {
    if (++budget > 1000000 || depth > 64) throw Error("Assembly field budget exceeded");
    const start = at; let value: unknown;
    if (f.fieldType === 14 && [1, 2, 4].includes(f.loadingMode)) {
      const token = v.getInt32(take(4), true), sourceClassSlot = token ? v.getInt16(take(2), true) : null;
      if (sourceClassSlot !== null && !classes.has(sourceClassSlot)) throw Error("Unknown queued assembly source class");
      value = { token, sourceClassSlot, start, end: at, path }; descriptors.push(value as OriginalAssemblySemanticFifo["entries"][number]["descriptor"]);
    } else if (f.fieldType === 14 && f.loadingMode === 3) value = { staticReference: v.getInt32(take(4), true) };
    else if (f.loadingMode !== 0) throw Error("Unsupported assembly loading mode");
    else if (f.fieldType === 14) { if (!f.staticType || f.staticType.kind === "none") throw Error("Missing assembly static member class"); value = object(f.staticType.index, path, depth + 1); }
    else if (f.fieldType === 13) { if (!f.element) throw Error("Missing assembly tuple element"); value = field(f.element, `${path}.tuple`, owner, depth + 1); }
    else value = primitive(f.fieldType);
    fields.push({ path, sourceClassName: owner, sourceSchemaFieldOffset: f.offset, start, end: at }); return value;
  };
  const field = (f: SchemaStreamProperty, path: string, owner: string, depth: number): unknown => {
    const omittedFlag = new Map([["StairsRunAndLanding.m_isComponentizing", 2], ["StairsLogicJoin.m_joinLineRef", 2], ["GeomTable.m_cacheIsCurrent", 34], ["GeomTabEntry.m_pGNode", 34]]).get(`${owner}.${f.name}`);
    if (omittedFlag !== undefined) {
      if (f.unknownWord !== omittedFlag) throw Error("Changed known omitted assembly field");
      fields.push({ path, sourceClassName: owner, sourceSchemaFieldOffset: f.offset, start: at, end: at, omitted: true }); return { omitted: true };
    }
    if (f.unknownWord) throw Error("Unsupported flagged assembly field");
    if (f.itemMode === 0 || (f.itemMode === 6 && f.fieldType === 8)) return one(f, path, owner, depth);
    const n = f.itemMode === 5 ? count() : f.itemMode === 1 && f.size !== undefined ? f.size : -1;
    if (n < 0 || n > 100000) throw Error("Unsupported assembly item mode");
    return Array.from({ length: n }, (_, i) => one(f, `${path}[${i}]`, owner, depth));
  };
  const root = object(wanted.index, expectedClass, 0), nativeElementId = Number(v.getBigInt64(0, true));
  if (!validId(nativeElementId) || sourceId(root.m_id) !== nativeElementId) throw Error("Assembly semantic owner differs from original frame");
  const prefix: OriginalAssemblySemanticPrefix = { nativeElementId, sourceClassName: expectedClass, sourceFrameSha256: digest(bytes), root, fields: [...fields], originalStaticPrefixEnd: at, completeSemanticFifoDecoded: false, sourceAuthorityGranted: false };
  if (!full) return prefix;
  const supported = new Set(["CellList", "CurveLoop", "Edge", "EdgeLoop", "Face", "GLine", "GPoint", "GArc", "GeomStepList", "GeomTable", "Geometry", "MultistoryStairsMembership", "Plane", "StairsCompMonolithicSupportGStep", "StairsElementMembership", "StairsRunAndLandingPatternHelper", "StairsRunInfo", "StairsRunIntermediateSupportPathGStep", "StairsRunLayoutGStep", "StairsRunRefGStep", "StairsLandingRefGStep", "StairsAutomaticLandingCell", "StairsSketchedLandingCell", "StairsLandingRiserRecognitionGStep", "StairsLandingSupportPathGStep", "StairsRunSupportPathGStep", "StairsSketchedRunCell", "StairsTreadInfo", "StairsStraightRunCell", "GCylindricalHelix", "CylSurf", "SymbolInfo", "StairsTriserSymbolGStep", "StairsTriserSymbolPatternHelper"]);
  const queue: typeof descriptors = [], tokens = new Map<number, number>(); let nextToken = 3;
  const enqueue = (list: typeof descriptors) => {
    for (const d of list) {
      if (!d.token) continue;
      if (d.sourceClassSlot === null) throw Error("Missing original assembly queued source class");
      if (d.token > 0) { const prior = tokens.get(d.token); if (prior !== undefined) { if (prior !== d.sourceClassSlot) throw Error("Reused assembly token changed class"); continue; } if (d.token !== nextToken) throw Error("Nonappend original assembly token"); tokens.set(d.token, d.sourceClassSlot); nextToken++; }
      else if (d.token !== -1) throw Error("Unsupported negative assembly token");
      if (queue.length >= 100000) throw Error("Assembly FIFO exceeds bound"); queue.push(d);
    }
  };
  enqueue(descriptors);
  const entries: OriginalAssemblySemanticFifo["entries"] = [];
  for (let head = 0; head < queue.length; head++) {
    const d = queue[head]!, c = classes.get(d.sourceClassSlot!)!;
    if (!supported.has(c.name)) throw Error(`Unsupported dynamic assembly source class ${c.name}`);
    const start = at, prior = descriptors.length, value = object(c.index, c.name, 0);
    entries.push({ descriptor: d, sourceClassName: c.name, start, end: at, value }); enqueue(descriptors.slice(prior));
  }
  if (at !== end) throw Error("Original assembly FIFO does not consume complete frame");
  return { ...prefix, completeSemanticFifoDecoded: true, originalSemanticFifoEnd: at, entries };
}
/** Schema closure is established before any original child absence can be
 * reported. Alternative native classes owning m_stairsId remain foreign,
 * never flights or source landing joins. A persisted base-only 4081 is counted
 * separately and refuses complete run/landing membership. */
export function inspectOriginalStairAssemblySchemaChildUnion(schema: SchemaStream) {
  const classes = new Map(schema.classes.map(c => [c.index, c]));
  if (classes.size !== schema.classes.length || schema.trailingBytes || schema.terminatorBytes !== 8 || schema.unresolvedReferences.length || schema.inlineIndexMismatches.length) throw Error("Incomplete original assembly schema closure");
  const ancestry = (slot: number) => {
    const result: number[] = [];
    let next: number | undefined = slot;
    while (next !== undefined) {
      const c = classes.get(next);
      if (!c || c.unknownWord || result.includes(next) || result.length >= 64 || c.properties.length !== c.propertyCount) throw Error("Unclosed original assembly schema ancestry");
      result.push(next); next = c.parent.kind === "none" ? undefined : c.parent.index;
    }
    return result;
  };
  const all = schema.classes.map(c => ({ c, ancestry: ancestry(c.index) }));
  const required = [["Element", 38], ["ElementId", 20], ["StairsElement", 4075], ["StairsRun", 4102], ["StairsLanding", 4080], ["StairsRunAndLanding", 4081], ["BaseRailing", 598], ["StairsSym", 3463], ["StairsLockControl", 4092]] as const;
  for (const [name, slot] of required) if (classes.get(slot)?.name !== name) throw Error("Original assembly schema closure class differs");
  const descendants = (slot: number) => all.filter(row => row.ancestry.includes(slot)).map(({ c }) => ({ sourceClassName: c.name, sourceClassSlot: c.index }));
  for (const [slot, expected] of [[4075, [4075]], [4102, [4102]], [4080, [4080]], [4081, [4080, 4081, 4102]]] as const) {
    const actual = descendants(slot).map(c => c.sourceClassSlot).sort((a, b) => a - b);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error("Unscanned derived original stair semantic class");
  }
  const ownerDeclarations = all.filter(row => row.ancestry.includes(38)).flatMap(({ c }) => c.properties.filter(f => f.name === "m_stairsId").map(f => {
    if (![598, 3463, 4081, 4092].includes(c.index) || f.fieldType !== 14 || f.loadingMode !== 0 || f.itemMode !== 0 || f.unknownWord || !f.staticType || f.staticType.kind === "none" || f.staticType.index !== 20) throw Error("Unknown original native stairs owner declaration");
    return { sourceClassName: c.name, sourceClassSlot: c.index, sourceSchemaFieldOffset: f.offset };
  }));
  if (JSON.stringify(ownerDeclarations.map(c => c.sourceClassSlot).sort((a, b) => a - b)) !== JSON.stringify([598, 3463, 4081, 4092])) throw Error("Missing original native stairs owner declaration");
  const alternativeForeignFamilies = [598, 3463, 4092].map(slot => ({ sourceFamilyClassName: classes.get(slot)!.name, sourceFamilyClassSlot: slot, descendants: descendants(slot) }));
  if (new Set(alternativeForeignFamilies.flatMap(f => f.descendants.map(c => c.sourceClassSlot))).size !== alternativeForeignFamilies.reduce((n, f) => n + f.descendants.length, 0)) throw Error("Overlapping original foreign stairs ownership families");
  return { originalRunClasses: descendants(4102), originalLandingClasses: descendants(4080), originalRunAndLandingClasses: descendants(4081), originalParentClasses: descendants(4075), nativeStairsOwnerDeclarations: ownerDeclarations, alternativeForeignFamilies, schemaChildUnionClosed: true as const, baseOnlyClassMustBeCensused: 4081 as const, sourceAuthorityGranted: false as const, routeApproved: false as const };
}
type ForeignSemanticOccurrence = { nativeElementId: number; sourceClassName: string; sourceClassSlot: number; sourceFamilyClassName: string; sourceFamilyClassSlot: number; sourceFrameSha256: string; originalParentIdNotDecoded: true; joinsApproved: false };
const contextBrand: unique symbol = Symbol("OriginalNativeStairAssemblyContext");
export type OriginalNativeStairAssemblyContext = {
  readonly [contextBrand]: true; readonly sourceModelSha256: string; readonly sourceSchemaSha256: string; readonly completeSourcePages: number;
};
type Stored = { schemaChildUnion: ReturnType<typeof inspectOriginalStairAssemblySchemaChildUnion>; baseOnlyChildren: OriginalAssemblySemanticPrefix[]; alternativeForeignOccurrences: ForeignSemanticOccurrence[]; parents: Map<number, OriginalAssemblySemanticPrefix>; children: OriginalAssemblySemanticPrefix[]; symbols: Map<number, Uint8Array>; semanticFrames: Map<number, Uint8Array>; schema: SchemaStream; schemaBytes: Uint8Array; translation: ClassTagTranslation; idBytes: 4 | 8 };
const contexts = new WeakMap<OriginalNativeStairAssemblyContext, Stored>();
/** Complete actual semantic occurrence census. Requested parents do not limit
 * the run/landing scan: an omitted live child can never become an absent row. */
export function createOriginalNativeStairAssemblyContext(originalRvtBytes: Uint8Array, expectedSha256: string, requestedStairIds: readonly number[]) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || !requestedStairIds.length || requestedStairIds.length > 128 || requestedStairIds.some(id => !validId(id)) || new Set(requestedStairIds).size !== requestedStairIds.length) throw Error("Invalid original assembly request");
  const bytes = Uint8Array.from(originalRvtBytes); if (digest(bytes) !== expectedSha256) throw Error("Original assembly RVT checksum mismatch");
  const previousTags = activeClassTagTranslation(), previousWidth = activeElementIdBytes();
  try {
    const opened = openRevitContainer(bytes, {});
    if (opened.decoderPlan.revitVersion !== 2027 || !opened.nativeSourceSchemaBytes || activeElementIdBytes() !== 8 || !opened.classTagTranslation.identity || opened.classTagTranslation.movedClasses) throw Error("Unsupported original assembly source schema");
    const parsed = readSchema(opened.nativeSourceSchemaBytes); if (!parsed.ok) throw Error("Original assembly schema did not decode");
    for (const [name, slot] of [["StairsElement", 4075], ["StairsRun", 4102], ["StairsLanding", 4080], ["StairsTriserSymbol", 4133]] as const) if (!parsed.schema.classes.some(c => c.name === name && c.index === slot)) throw Error("Original assembly source class slot differs");
    const schemaChildUnion = inspectOriginalStairAssemblySchemaChildUnion(parsed.schema);
    const foreignClasses = new Map(schemaChildUnion.alternativeForeignFamilies.flatMap(family => family.descendants.map(c => [c.sourceClassSlot, { ...c, sourceFamilyClassName: family.sourceFamilyClassName, sourceFamilyClassSlot: family.sourceFamilyClassSlot }] as const)));
    const baseOnlyChildren: OriginalAssemblySemanticPrefix[] = [], alternativeForeignOccurrences: ForeignSemanticOccurrence[] = [];
    const wanted = new Set(requestedStairIds), parents = new Map<number, OriginalAssemblySemanticPrefix>(), children: OriginalAssemblySemanticPrefix[] = [], symbols = new Map<number, Uint8Array>(), semanticFrames = new Map<number, Uint8Array>(), seen = new Set<string>();
    let pages = 0, retained = 0;
    for (const partition of opened.partitions) {
      const stream = createSplitFrameStream({ markers: [4075, 4080, 4081, 4102, 4133, ...foreignClasses.keys()], minObjectLength: 40, maxFrameBytes: 16 * 1024 * 1024, acceptHeader: (view, offset) => view.getUint16(offset + 16, true) !== 4075 || wanted.has(view.getUint32(offset, true)) });
      const raw = stripRevitPageChecksums(asBytes(partition.entry.content)), offsets = gzipOffsets(raw, 10001); if (offsets.length > 10000) throw Error("Assembly source page bound exceeded"); let window: Uint8Array | null = null;
      for (let i = 0; i < offsets.length; i++) {
        const page = inflateRevitChunk(raw, offsets[i]!, offsets[i + 1], window); if (!page) throw Error("Assembly source page failed inflation"); window = revitWindowTail(page); pages++;
        for (const frame of stream.push(page)) {
          const key = `${frame.elementId}:${frame.marker}`; if (seen.has(key)) throw Error("Ambiguous duplicate original assembly occurrence"); seen.add(key); checkedFrame(frame.data, frame.marker);
          retained += frame.data.length; if (retained > 128 * 1024 * 1024) throw Error("Assembly source retention bound exceeded");
          if (foreignClasses.has(frame.marker)) {
            const c = foreignClasses.get(frame.marker)!;
            alternativeForeignOccurrences.push({ nativeElementId: frame.elementId, ...c, sourceFrameSha256: digest(frame.data), originalParentIdNotDecoded: true, joinsApproved: false });
          } else if (frame.marker === 4133) symbols.set(frame.elementId, Uint8Array.from(frame.data));
          else { if (semanticFrames.has(frame.elementId)) throw Error("Ambiguous original assembly semantic identity"); semanticFrames.set(frame.elementId, Uint8Array.from(frame.data)); const prefix = inspectOriginalStairAssemblySemanticPrefix(frame.data, parsed.schema, frame.marker === 4075 ? "StairsElement" : frame.marker === 4102 ? "StairsRun" : frame.marker === 4080 ? "StairsLanding" : "StairsRunAndLanding"); if (frame.marker === 4075) parents.set(frame.elementId, prefix); else { const owner = sourceId(prefix.root.m_stairsId); if (!validId(owner) && owner !== -1) throw Error("Invalid original run/landing parent field"); if (frame.marker === 4081) baseOnlyChildren.push(prefix); else children.push(prefix); } }
        }
      }
    }
    if (requestedStairIds.some(id => !parents.has(id))) throw Error("Requested original stair parent is missing");
    const context = Object.freeze({ [contextBrand]: true as const, sourceModelSha256: expectedSha256, sourceSchemaSha256: digest(opened.nativeSourceSchemaBytes), completeSourcePages: pages });
    contexts.set(context, { schemaChildUnion, baseOnlyChildren, alternativeForeignOccurrences, parents, children, symbols, semanticFrames, schema: parsed.schema, schemaBytes: Uint8Array.from(opened.nativeSourceSchemaBytes), translation: opened.classTagTranslation, idBytes: activeElementIdBytes() }); return context;
  } finally { setActiveClassTagTranslation(previousTags); setActiveElementIdBytes(previousWidth); }
}
export function inspectOriginalNativeStairAssemblyMembership(context: OriginalNativeStairAssemblyContext, nativeStairId: number) {
  const stored = contexts.get(context); if (!stored) throw Error("Untrusted original assembly context");
  const parent = stored.parents.get(nativeStairId); if (!parent) throw Error("Stair parent was not requested in original assembly context");
  const children = stored.children.filter(c => sourceId(c.root.m_stairsId) === nativeStairId);
  const idList = parent.root.m_runsAndLandings;
  if (!Array.isArray(idList)) throw Error("Original parent run/landing list absent");
  const parentDeclaredIds = idList.map(sourceId); if (parentDeclaredIds.some(id => !validId(id)) || new Set(parentDeclaredIds).size !== parentDeclaredIds.length) throw Error("Invalid original parent membership ID");
  const members = children.map(child => {
    const def = sourceId(child.root.m_triserSymId), symbolBytes = validId(def) ? stored.symbols.get(def) : undefined;
    let symbolHostId: unknown, symbolFrameSha256: string | undefined, symbolBlocker: string | undefined;
    if (symbolBytes) { const symbol = readNativeStairTypedFifo(symbolBytes, stored.schema, "StairsTriserSymbol"); if (symbol.ok) { symbolHostId = sourceId(symbol.value.root.m_hostId); symbolFrameSha256 = digest(symbolBytes); } else symbolBlocker = symbol.error; }
    if (!validId(def) && def !== -1) throw Error("Invalid original child definition field");
    const landingMap = child.root.m_landingRisersMap;
    return { nativeElementId: child.nativeElementId, kind: child.sourceClassName === "StairsRun" ? "run" as const : "landing" as const, originalChildToParentId: nativeStairId, originalDefinitionId: validId(def) ? def : null, originalSymbolHostId: validId(symbolHostId) ? symbolHostId : null, originalSymbolFrameSha256: symbolFrameSha256, originalSymbolBlocker: symbolBlocker, originalChildSemanticFrameSha256: child.sourceFrameSha256, originalAssociatedLevelId: sourceId(child.root.m_assocLevelId), originalBaseRiserIndex: child.root.m_baseRiserIndex, originalBottomElevationFeet: child.root.m_bottomElevation, originalTopElevationFeet: child.root.m_topElevation, originalLandingBaseElevationFeet: child.root.m_baseElevation, originalBeginWithRiser: child.root.m_beginWithRiser, originalEndWithRiser: child.root.m_endWithRiser, originalTopRiserIndex: child.root.m_topRiserIndex, originalLandingRisersMap: landingMap, originalLogicJoinInfo: child.root.m_logicJoinInfo, originalBoundaryDescriptor: child.root.m_oBoundary, originalTopFaceGeometryDescriptor: child.root.m_oTopFaceGeom, originalChildRoot: child.root, originalChildFields: child.fields, originalChildGRepLocator: { nativeElementId: child.nativeElementId, marker: 2246 as const }, originalDefinitionGRepLocator: validId(def) ? { nativeElementId: def, marker: 2246 as const } : null };
  });
  const ids = new Set(members.map(m => m.nativeElementId));
  return structuredClone({ sourceModelSha256: context.sourceModelSha256, sourceSchemaSha256: context.sourceSchemaSha256, completeSourcePages: context.completeSourcePages, nativeStairId, originalParentSemanticFrameSha256: parent.sourceFrameSha256, originalParentRoot: structuredClone(parent.root), originalParentFields: parent.fields, originalParentDeclaredMemberIds: parentDeclaredIds as number[], originalParentDeclaredIdsAbsentFromLiveChildCensus: (parentDeclaredIds as number[]).filter(id => !ids.has(id)), liveOwnedChildrenNotInParentList: members.filter(m => !parentDeclaredIds.includes(m.nativeElementId)).map(m => m.nativeElementId), schemaChildUnionClosed: stored.schemaChildUnion.schemaChildUnionClosed, originalBaseOnlyChildOccurrenceCount: stored.baseOnlyChildren.length, originalOwnedBaseOnlyChildIds: stored.baseOnlyChildren.filter(c => sourceId(c.root.m_stairsId) === nativeStairId).map(c => c.nativeElementId), completeOriginalChildSemanticOccurrenceCensus: stored.baseOnlyChildren.length === 0, originalRunIds: members.filter(m => m.kind === "run").map(m => m.nativeElementId), originalLandingIds: members.filter(m => m.kind === "landing").map(m => m.nativeElementId), members, sequenceApproved: false as const, sourceJoinsApproved: false as const, physicalClearanceApproved: false as const, routeApproved: false as const });
}
/** Read-only complete actual original child census, not a join/material or
 * route certificate. Returned objects cannot mutate the private source census. */
export function inspectOriginalNativeStairAssemblyGlobalChildOwnership(context: OriginalNativeStairAssemblyContext) {
  const stored = contexts.get(context); if (!stored) throw Error("Untrusted original assembly context");
  const occurrence = (child: OriginalAssemblySemanticPrefix) => ({ nativeElementId: child.nativeElementId, sourceClassName: child.sourceClassName, originalParentNativeStairId: sourceId(child.root.m_stairsId), originalDefinitionNativeElementId: sourceId(child.root.m_triserSymId), originalAssociatedLevelId: sourceId(child.root.m_assocLevelId), originalBottomElevationFeet: child.root.m_bottomElevation, originalTopElevationFeet: child.root.m_topElevation, originalBaseRiserIndex: child.root.m_baseRiserIndex, originalTopRiserIndex: child.root.m_topRiserIndex, originalLandingBaseElevationFeet: child.root.m_baseElevation, originalMoribund: child.root.m_moribund, originalDummy: child.root.m_dummy, originalSourceFrameSha256: child.sourceFrameSha256, originalOwnershipFieldSpans: child.fields.filter(f => f.path.endsWith(".m_stairsId")) });
  return structuredClone({ sourceModelSha256: context.sourceModelSha256, sourceSchemaSha256: context.sourceSchemaSha256, completeSourcePages: context.completeSourcePages, schemaChildUnion: stored.schemaChildUnion, requestedOriginalParentIds: [...stored.parents.keys()], originalRunOccurrences: stored.children.filter(c => c.sourceClassName === "StairsRun").map(occurrence), originalLandingOccurrences: stored.children.filter(c => c.sourceClassName === "StairsLanding").map(occurrence), originalBaseOnlyRunAndLandingOccurrences: stored.baseOnlyChildren.map(occurrence), alternativeForeignOccurrences: stored.alternativeForeignOccurrences, completeOriginalRunAndLandingChildUnionCensus: stored.baseOnlyChildren.length === 0, baseOnlyClassSupportedAsRunOrLanding: false as const, alternativeForeignClassesApprovedAsJoins: false as const, sourceJoinsApproved: false as const, physicalClearanceApproved: false as const, routeApproved: false as const });
}
const assemblyBrand: unique symbol = Symbol("OriginalNativeStairAssemblyMembership");
export type OriginalNativeStairAssemblyMembership = { readonly [assemblyBrand]: true; readonly sourceModelSha256: string; readonly sourceSchemaSha256: string; readonly nativeStairId: number; readonly assemblyMembershipSha256: string };
const bindings = new WeakMap<OriginalNativeStairAssemblyMembership, { context: OriginalNativeStairAssemblyContext; facts: ReturnType<typeof inspectOriginalNativeStairAssemblyMembership> }>();
export function bindOriginalNativeStairAssembly(context: OriginalNativeStairAssemblyContext, nativeStairId: number) {
  const facts = inspectOriginalNativeStairAssemblyMembership(context, nativeStairId);
  if (!facts.completeOriginalChildSemanticOccurrenceCensus || !facts.members.length || !facts.originalRunIds.length || facts.originalParentDeclaredIdsAbsentFromLiveChildCensus.length || facts.members.some(m => m.originalDefinitionId !== null && (m.originalSymbolHostId !== m.nativeElementId || m.originalSymbolBlocker))) throw Error("Original assembly child/definition ownership correspondence unavailable");
  const handle = Object.freeze({ [assemblyBrand]: true as const, sourceModelSha256: context.sourceModelSha256, sourceSchemaSha256: context.sourceSchemaSha256, nativeStairId, assemblyMembershipSha256: digest(new TextEncoder().encode(JSON.stringify(facts))) });
  bindings.set(handle, { context, facts: structuredClone(facts) }); return handle;
}
export function originalNativeStairAssemblyMembershipFacts(handle: OriginalNativeStairAssemblyMembership) {
  const bound = bindings.get(handle); if (!bound) throw Error("Untrusted original assembly membership"); return structuredClone(bound.facts);
}
/** Copies exact source records from an already bound original membership.
 * Callers cannot mutate retained authority or substitute another child/schema. */
export function readOriginalNativeStairAssemblySemanticSource(handle: OriginalNativeStairAssemblyMembership, nativeElementId: number) {
  const bound = bindings.get(handle); if (!bound) throw Error("Untrusted original assembly membership");
  if (nativeElementId !== handle.nativeStairId && !bound.facts.members.some(m => m.nativeElementId === nativeElementId)) throw Error("Semantic member is not original assembly-owned");
  const stored = contexts.get(bound.context)!, bytes = stored.semanticFrames.get(nativeElementId); if (!bytes) throw Error("Bound original semantic frame missing");
  return { sourceModelSha256: handle.sourceModelSha256, sourceSchemaSha256: handle.sourceSchemaSha256, nativeElementId, sourceFrameSha256: digest(bytes), originalSemanticBytes: Uint8Array.from(bytes), originalSchemaBytes: Uint8Array.from(stored.schemaBytes) };
}
/** Structural source port facts only. These preserve original finite controls;
 * mathematical closure/support/clearance is not inferred from source intent. */
export function inspectOriginalStairLandingNamedBoundaryPorts(landing: OriginalAssemblySemanticFifo) {
  if (!landing.completeSemanticFifoDecoded || landing.sourceClassName !== "StairsLanding" || sourceId(landing.root.m_id) !== landing.nativeElementId) throw Error("Incomplete original landing semantic FIFO");
  const resolve = (d: unknown) => {
    const descriptor = d as OriginalAssemblySemanticFifo["entries"][number]["descriptor"];
    if (!descriptor || !descriptor.token) throw Error("Missing original landing descriptor");
    const found = landing.entries.filter(e => descriptor.token > 0 ? e.descriptor.token === descriptor.token : e.descriptor.start === descriptor.start && e.descriptor.end === descriptor.end && e.descriptor.path === descriptor.path);
    if (found.length !== 1 || found[0]!.descriptor.sourceClassSlot !== descriptor.sourceClassSlot) throw Error("Ambiguous original landing descriptor");
    return found[0]!;
  };
  const boundary = resolve(landing.root.m_oBoundary), descriptors = boundary.value.m_curves;
  if (boundary.sourceClassName !== "CurveLoop" || boundary.value.m_open !== 0 || !Array.isArray(descriptors) || !descriptors.length) throw Error("Unsupported original named landing boundary");
  const boundaryLines = descriptors.map(d => { const e = resolve(d); finiteLine(e.value, e.sourceClassName); return e; });
  const recognition = landing.entries.filter(e => e.sourceClassName === "StairsLandingRiserRecognitionGStep");
  if (recognition.length !== 1 || !Array.isArray(recognition[0]!.value.m_curveHistTableSet)) throw Error("Missing original landing riser recognition history");
  const history = recognition[0]!.value.m_curveHistTableSet as { m_id: number; m_curveHist: { m_keys: number[] } }[], maps = landing.root.m_landingRisersMap;
  if (!Array.isArray(maps) || !maps.length) throw Error("Missing original landing run-port map");
  const seen = new Set<number>();
  const joins = (landing.root.m_logicJoinInfo as { m_logiciJoins?: SourceValue[] } | undefined)?.m_logiciJoins;
  if (!Array.isArray(joins) || joins.length !== maps.length) throw Error("Incomplete original landing logical joins");
  return maps.map((map: { first: unknown; second: { first: number; second: number } }) => {
    const nativeRunId = sourceId(map.first), first = map.second?.first, last = map.second?.second;
    if (!validId(nativeRunId) || seen.has(nativeRunId) || !Number.isSafeInteger(first) || first !== last || first < 0 || first >= boundaryLines.length) throw Error("Unsupported original landing port range/owner");
    seen.add(nativeRunId);
    const h = history.filter(row => row.m_id === first && JSON.stringify(row.m_curveHist?.m_keys) === JSON.stringify([16, first, 0, -1, -1]));
    if (h.length !== 1) throw Error("Original landing map/history boundary identity unavailable");
    const j = joins.filter(row => sourceId(row.m_thisElementId) === landing.nativeElementId && sourceId(row.m_peerElementId) === nativeRunId && row.m_thisJoinEndType === 0 && (row.m_peerJoinEndType === 1 || row.m_peerJoinEndType === 2));
    if (j.length !== 1) throw Error("Original landing peer endpoint identity unavailable");
    const e = boundaryLines[first]!;
    return { nativeRunId, nativeLandingId: landing.nativeElementId, originalMapPortPair: [first, last], originalBoundaryCurveIndex: first, originalBoundaryCurveCount: boundaryLines.length, originalBoundaryCurveDescriptor: e.descriptor, originalBoundaryCurveSpan: [e.start, e.end], originalFiniteBoundaryLine: structuredClone(e.value), originalRiserRecognitionHistory: structuredClone(h[0]!), originalRiserRecognitionSpan: [recognition[0]!.start, recognition[0]!.end], originalLandingLogicalJoin: structuredClone(j[0]!), originalRunEndpointType: j[0]!.m_peerJoinEndType as 1 | 2, sourceJoinApproved: false as const, routeApproved: false as const };
  });
}
function finiteLine(v: SourceValue, name: string) {
  if (name !== "GLine") throw Error("Original port is not a finite GLine");
  for (const [key, count] of [["m_origin", 3], ["m_dirVec", 3], ["m_endParams", 2]] as const) if (!Array.isArray(v[key]) || v[key].length !== count || v[key].some((n: unknown) => typeof n !== "number" || !Number.isFinite(n))) throw Error("Invalid original finite port controls");
  const d = v.m_dirVec as number[], t = v.m_endParams as number[];
  if (d[2] !== 0 || (!d[0] && !d[1]) || t[0] === t[1]) throw Error("Unsupported original finite horizontal port");
}
function projectedFiniteIntersection(a: SourceValue, b: SourceValue) {
  finiteLine(a, "GLine"); finiteLine(b, "GLine");
  const p = (a.m_origin as number[]).map(rational), d = (a.m_dirVec as number[]).map(rational), q = (b.m_origin as number[]).map(rational), e = (b.m_dirVec as number[]).map(rational);
  const sub = (x: Rational, y: Rational) => new Rational(x.n * y.d - y.n * x.d, x.d * y.d), mul = (x: Rational, y: Rational) => new Rational(x.n * y.n, x.d * y.d), add = (x: Rational, y: Rational) => new Rational(x.n * y.d + y.n * x.d, x.d * y.d), div = (x: Rational, y: Rational) => new Rational(x.n * y.d, x.d * y.n), cross = (x: Rational[], y: Rational[]) => sub(mul(x[0]!, y[1]!), mul(x[1]!, y[0]!)), cmp = (x: Rational, y: Rational) => x.n * y.d < y.n * x.d ? -1 : x.n * y.d > y.n * x.d ? 1 : 0;
  const delta = q.map((n, i) => sub(n, p[i]!)), determinant = cross(d, e), ta = (a.m_endParams as number[]).map(rational).sort(cmp), tb = (b.m_endParams as number[]).map(rational).sort(cmp), sameOriginalHeight = cmp(p[2]!, q[2]!) === 0;
  if (determinant.n) { const t = div(cross(delta, e), determinant), u = div(cross(delta, d), determinant), boundaryParameterInside = cmp(t, ta[0]!) >= 0 && cmp(t, ta[1]!) <= 0, runParameterInside = cmp(u, tb[0]!) >= 0 && cmp(u, tb[1]!) <= 0; return { kind: "finite-crossing" as const, determinant, boundaryParameter: t, runParameter: u, boundaryParameterInside, runParameterInside, projectedFiniteIntersection: boundaryParameterInside && runParameterInside, originalPlanPointFeet: [add(p[0]!, mul(d[0]!, t)), add(p[1]!, mul(d[1]!, t))], sameOriginalHeight }; }
  if (cross(delta, d).n) return { kind: "parallel-disjoint" as const, determinant, projectedFiniteIntersection: false, sameOriginalHeight };
  const axis = d[0]!.n ? 0 : 1, coordinate = (o: Rational[], direction: Rational[], t: Rational) => add(o[axis]!, mul(direction[axis]!, t)), aa = ta.map(t => coordinate(p, d, t)).sort(cmp), bb = tb.map(t => coordinate(q, e, t)).sort(cmp), low = cmp(aa[0]!, bb[0]!) >= 0 ? aa[0]! : bb[0]!, high = cmp(aa[1]!, bb[1]!) <= 0 ? aa[1]! : bb[1]!;
  return { kind: "collinear" as const, determinant, projectedFiniteIntersection: cmp(low, high) <= 0, originalAxis: axis, originalAxisOverlapFeet: [low, high], sameOriginalHeight };
}
/** Opaque source ownership plus exact reciprocal named endpoint bindings.
 * A finite projected intersection is reported separately from source intent;
 * neither it nor the nominal source height certifies a physical walking join. */
export function inspectOriginalNativeStairAssemblyLandingPorts(handle: OriginalNativeStairAssemblyMembership, nativeLandingId: number) {
  const bound = bindings.get(handle); if (!bound) throw Error("Untrusted original assembly membership");
  const member = bound.facts.members.find(m => m.nativeElementId === nativeLandingId && m.kind === "landing"); if (!member) throw Error("Landing is not original assembly-owned");
  const stored = contexts.get(bound.context)!, landing = inspectOriginalStairAssemblySemanticFifo(stored.semanticFrames.get(nativeLandingId)!, stored.schema, "StairsLanding");
  const ports = inspectOriginalStairLandingNamedBoundaryPorts(landing).map(port => {
    const runMember = bound.facts.members.find(m => m.nativeElementId === port.nativeRunId && m.kind === "run"); if (!runMember) throw Error("Landing names a foreign or missing run");
    const originalRun = readNativeStairTypedFifo(stored.semanticFrames.get(port.nativeRunId)!, stored.schema, "StairsRun"); if (!originalRun.ok) throw Error(originalRun.error);
    const run = originalRun.value, joins = (run.root.m_logicJoinInfo as { m_logiciJoins?: SourceValue[] } | undefined)?.m_logiciJoins;
    const reciprocal = joins?.filter(j => sourceId(j.m_thisElementId) === port.nativeRunId && sourceId(j.m_peerElementId) === nativeLandingId && j.m_thisJoinEndType === port.originalRunEndpointType && j.m_peerJoinEndType === 0); if (reciprocal?.length !== 1) throw Error("Original landing/run logical join is not reciprocal");
    const d = run.root[port.originalRunEndpointType === 1 ? "m_oStartRiser" : "m_oEndRiser"] as OriginalAssemblySemanticFifo["entries"][number]["descriptor"];
    const entry = run.entries.filter(e => d && (d.token > 0 ? e.descriptor.token === d.token : e.descriptor.start === d.start && e.descriptor.end === d.end && e.descriptor.path === d.path));
    if (entry.length !== 1 || entry[0]!.descriptor.sourceClassSlot !== d.sourceClassSlot) throw Error("Original named run terminal occurrence unavailable"); finiteLine(entry[0]!.value, entry[0]!.sourceClassName);
    return { ...port, originalRunSemanticFrameSha256: runMember.originalChildSemanticFrameSha256, originalRunReciprocalLogicalJoin: structuredClone(reciprocal[0]!), originalRunTerminalDescriptor: entry[0]!.descriptor, originalRunTerminalSpan: [entry[0]!.start, entry[0]!.end], originalFiniteRunTerminalLine: structuredClone(entry[0]!.value), originalRunBottomElevationFeet: run.root.m_bottomElevation, originalRunTopElevationFeet: run.root.m_topElevation, originalLandingBaseElevationFeet: landing.root.m_baseElevation, originalFinitePlanIntersection: projectedFiniteIntersection(port.originalFiniteBoundaryLine, entry[0]!.value) };
  });
  return { sourceModelSha256: handle.sourceModelSha256, sourceSchemaSha256: handle.sourceSchemaSha256, nativeStairId: handle.nativeStairId, nativeLandingId, originalLandingSemanticFrameSha256: landing.sourceFrameSha256, originalLandingBaseElevationFeet: landing.root.m_baseElevation, completeOriginalSemanticFifo: true as const, originalReciprocalNamedPortBindingsComplete: true as const, ports, sourceJoinApproved: false as const, physicalClearanceApproved: false as const, routeApproved: false as const };
}

/** Material lookup stays bound to a complete current original foreign census.
 * No landing cap or missing foreign material is invented by the membership. */
export function inspectOriginalNativeStairAssemblyMemberMaterial(handle: OriginalNativeStairAssemblyMembership, foreign: OriginalNativeForeignEnvelopeCensus, nativeMemberId: number) {
  const bound = bindings.get(handle); if (!bound) throw Error("Untrusted original assembly membership");
  if (foreign.sourceModelSha256 !== handle.sourceModelSha256 || foreign.sourceSchemaSha256 !== handle.sourceSchemaSha256) throw Error("Foreign census and original assembly source differ");
  const member = bound.facts.members.find(m => m.nativeElementId === nativeMemberId); if (!member) throw Error("Requested member is not original assembly-owned");
  const stored = contexts.get(bound.context)!;
  const previousTags = activeClassTagTranslation(), previousWidth = activeElementIdBytes();
  try {
  setActiveClassTagTranslation(stored.translation); setActiveElementIdBytes(stored.idBytes);
  const childBytes = readOriginalForeignEnvelopeScopedFrame(foreign, nativeMemberId), defId = member.originalDefinitionId ?? nativeMemberId;
  const decode = (bytes: Uint8Array, id: number) => { checkedFrame(bytes, 2246); const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); if (view.getBigInt64(0, true) !== BigInt(id)) throw Error("Original assembly material header owner mismatch"); const root = decodeRevit2027FramedGRepRoot(bytes, { offset: 0, elementId: id, marker: 2246, objectLength: view.getUint32(12, true), typeCode: view.getUint32(18, true) }, 2027); if (!root.ok) throw Error(root.error); if (root.value.objectType !== 3 || (root.value.flags !== 0 && root.value.flags !== 2)) throw Error("Unsupported original assembly GElement semantics"); const replay = replayRevit2027GRepFifo(bytes, root.value); if (!replay.ok) throw Error(replay.error); if (replay.value.ownerElementId !== BigInt(id)) throw Error("Original assembly material owner mismatch"); return replay.value; };
  const child = decode(childBytes, nativeMemberId), bodyBytes = defId === nativeMemberId ? childBytes : readOriginalForeignEnvelopeScopedFrame(foreign, defId), body = defId === nativeMemberId ? child : decode(bodyBytes, defId);
  const carrierMaterial = inspectOriginalStairLandingCarrierMaterial(child, defId);
  if (!carrierMaterial.allOriginalCarrierMaterialEnclosed) throw Error(`Unsupported original assembly carrier material: ${carrierMaterial.blockers.join("; ")}`);
  const index = revit2027OwnerMeshIndex(body), support = inspectOriginalStairSupportEnvelopes(body), rawLocalMaterial = inspectOriginalStairLocalMaterialCells(body), localMaterial = { ...rawLocalMaterial, cells: rawLocalMaterial.cells.map(cell => ({ ...cell, sourceGeometryOwnerElementId: defId })) };
  return { sourceModelSha256: handle.sourceModelSha256, sourceSchemaSha256: handle.sourceSchemaSha256, sourceCensusSha256: foreign.sourceCensusSha256, nativeStairId: handle.nativeStairId, nativeMemberId, nativeDefinitionId: defId, originalMemberFrameSha256: digest(childBytes), originalDefinitionFrameSha256: digest(bodyBytes), originalPhysicalFaceTokens: [...index.faces.keys()], originalDefinitionPhysicalFaceTokens: [...index.faces.keys()], originalCarrierPhysicalFaceTokens: carrierMaterial.faceDomains.map(face => face.originalFaceToken), originalPrimitiveReaders: body.spans.map(s => ({ readerId: s.readerId, propertyToken: s.propertyToken })), originalMemberPhysicalReplay: child, originalDefinitionPhysicalReplay: body, originalCarrierNonSurfaceMaterialApproved: false as const, support, localMaterial, carrierMaterial, completeOriginalMemberMaterialCells: [...localMaterial.cells, ...carrierMaterial.cells], completeOriginalMemberMaterialEnclosed: localMaterial.allOriginalFaceDomainsEnclosed && carrierMaterial.allOriginalCarrierMaterialEnclosed, originalMemberSupportBoundToSource: true as const, exactBodyApproved: false as const, sourceJoinApproved: false as const, terminalSupportApproved: false as const, fullAssemblyClearanceApproved: false as const, routeApproved: false as const };
  } finally { setActiveClassTagTranslation(previousTags); setActiveElementIdBytes(previousWidth); }
}
