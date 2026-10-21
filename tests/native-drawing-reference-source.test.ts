import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createNativeDrawingReferenceSourceCollector, nativeDrawingReferenceInstanceHash, nativeDrawingReferenceSourceHash } from "../lib/reviter/native-drawing-reference-source.ts";
import { readNativeStairTypedFifo } from "../lib/reviter/native-stair-typed-fifo.ts";
import { readSchema } from "../lib/reviter/schema-reader.ts";
const fixture = JSON.parse(readFileSync(new URL("./fixtures/native-drawing-reference-source.json", import.meta.url), "utf8")) as { sourceModelSha256: string; schemaSha256: string; frames: { nativeElementId: number; sourceClass: "ImportInstance" | "MasterImportSymbol"; frameSha256: string; frameHex: string }[] };
const schemaBytes = readFileSync(new URL("./fixtures/native-drawing-reference-source-schema.bin", import.meta.url));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const bytes = (id: number) => Uint8Array.from(Buffer.from(fixture.frames.find(f => f.nativeElementId === id)!.frameHex, "hex"));
function collector() { return createNativeDrawingReferenceSourceCollector(2027, schemaBytes); }
function populate(c: ReturnType<typeof collector>, omitted?: number) { for (const f of fixture.frames) if (f.nativeElementId !== omitted) c.scanFrame(Uint8Array.from(Buffer.from(f.frameHex, "hex"))); }

test("all 27 original import/master pairs retain exact source identity facts without assigning semantics", () => {
  assert.equal(sha(schemaBytes), fixture.schemaSha256);
  const c = collector(); populate(c); const source = c.snapshot(fixture.sourceModelSha256)!;
  assert.equal(source.instances.length, 27); assert.equal(source.schemaSha256, fixture.schemaSha256);
  assert.equal(source.geometrySha256, nativeDrawingReferenceSourceHash(source));
  for (const fact of source.instances) {
    assert.equal(fact.sourceClass, "ImportInstance"); assert.equal(fact.masterSourceClass, "MasterImportSymbol");
    assert.equal(fact.instanceFrameSha256, fixture.frames.find(f => f.nativeElementId === fact.nativeElementId)!.frameSha256);
    assert.equal(fact.masterFrameSha256, fixture.frames.find(f => f.nativeElementId === fact.masterSymbolId)!.frameSha256);
    assert.equal(fact.sourceFileNameSha256, sha(new TextEncoder().encode(fact.sourceFileName)));
    assert.equal(Object.hasOwn(fact, "classification"), false);
  }
  assert.equal(source.instances.find(f => f.nativeElementId === 2228308)!.sourceFileName, "Building 10 - Teaching and Learning Centre - L4.DWG");
  const unnamed = source.instances.find(f => f.nativeElementId === 290698)!;
  assert.equal(unnamed.sourceFileName, "UNBC Floor Plan"); assert.equal(unnamed.sourceFileNameEvidence, "SymbolInfo.name");
  assert.equal(Object.hasOwn(unnamed, "sourceFormat"), false);
});

test("full original ImportInstance and MasterImportSymbol FIFO frames consume their source length echo", () => {
  const schema = readSchema(schemaBytes); assert.ok(schema.ok);
  for (const f of fixture.frames) {
    const b = Uint8Array.from(Buffer.from(f.frameHex, "hex")), r: ReturnType<typeof readNativeStairTypedFifo<"ImportInstance" | "MasterImportSymbol">> = readNativeStairTypedFifo(b, schema.schema, f.sourceClass);
    assert.ok(r.ok, r.ok ? "" : r.error); assert.equal(r.value.endOffset + 4, b.length);
    assert.equal(r.value.rootClassName, f.sourceClass); assert.equal(sha(b), f.frameSha256);
  }
});

test("missing or conflicting original import/master evidence cannot manufacture a source fact", () => {
  const missing = collector(); populate(missing, 2228283); assert.equal(missing.snapshot(fixture.sourceModelSha256)!.instances.some(f => f.nativeElementId === 2228308), false);
  const schema = readSchema(schemaBytes); assert.ok(schema.ok);
  for (const target of [2228308, 2228283]) {
    const c = collector(); populate(c); const b = bytes(target), kind = target === 2228308 ? "ImportInstance" : "MasterImportSymbol";
    const parsed = readNativeStairTypedFifo(b, schema.schema, kind); assert.ok(parsed.ok);
    if (target === 2228308) {
      const f = parsed.value.rootFields.find(f => f.path.endsWith(".m_background"))!; assert.ok(f);
      b[f.start] = b[f.start] ? 0 : 1;
    } else {
      const entry = parsed.value.entries.find(e => e.sourceClassName === "SymbolInfo")!;
      new DataView(b.buffer).setUint16(entry.start + 4, "X".charCodeAt(0), true);
    }
    assert.ok(readNativeStairTypedFifo(b, schema.schema, kind).ok); c.scanFrame(b);
    assert.equal(c.snapshot(fixture.sourceModelSha256)!.instances.some(f => f.nativeElementId === 2228308), false);
  }
});

test("corrupt roots, unrelated original classes, unsupported releases and incomplete schemas fail closed", () => {
  const c = collector(); populate(c); const corrupt = bytes(2228308); corrupt[corrupt.length - 1] ^= 1; c.scanFrame(corrupt);
  assert.equal(c.snapshot(fixture.sourceModelSha256)!.instances.some(f => f.nativeElementId === 2228308), false);
  const schema = readSchema(schemaBytes); assert.ok(schema.ok); const wallSlot = schema.schema.classes.find(c => c.name === "SWall")!.index;
  const other = collector(), wall = bytes(2228308); new DataView(wall.buffer).setUint16(16, wallSlot, true); other.scanFrame(wall); other.scanFrame(bytes(2228283));
  assert.equal(other.snapshot(fixture.sourceModelSha256)!.instances.length, 0);
  assert.equal(createNativeDrawingReferenceSourceCollector(2026, schemaBytes).snapshot(fixture.sourceModelSha256), undefined);
  assert.equal(createNativeDrawingReferenceSourceCollector(2027, schemaBytes.subarray(0, -1)).snapshot(fixture.sourceModelSha256), undefined);
});

test("schema and snapshot buffers are copied, fact hashes bind every field and object key order is immaterial", () => {
  const input = Buffer.from(schemaBytes), c = createNativeDrawingReferenceSourceCollector(2027, input); input.fill(0); populate(c);
  const source = c.snapshot(fixture.sourceModelSha256)!, originalHash = source.geometrySha256, fact = source.instances[0]!;
  const reordered = Object.fromEntries(Object.entries(fact).reverse()) as typeof fact;
  assert.equal(nativeDrawingReferenceInstanceHash(reordered), nativeDrawingReferenceInstanceHash(fact));
  assert.notEqual(nativeDrawingReferenceInstanceHash({ ...fact, sourceFileName: "other.dwg" }), nativeDrawingReferenceInstanceHash(fact));
  source.instances[0]!.sourceFileName = "mutated";
  assert.notEqual(nativeDrawingReferenceSourceHash(source), originalHash);
  assert.equal(c.snapshot(fixture.sourceModelSha256)!.geometrySha256, originalHash);
});

test("page framing and split source roots preserve facts without joining partition boundaries", () => {
  const instance = bytes(2228308), master = bytes(2228283), c = collector();
  c.scanFrame(master);
  const cut = Math.floor(instance.length / 2);
  c.scanPage(instance.subarray(0, cut), []); c.scanPage(instance.subarray(cut), []);
  assert.equal(c.snapshot(fixture.sourceModelSha256)!.instances[0]?.nativeElementId, 2228308);
  const separate = collector(); separate.scanFrame(master); separate.scanPage(instance.subarray(0, cut), []);
  separate.finishPartition(); separate.scanPage(instance.subarray(cut), []);
  assert.equal(separate.snapshot(fixture.sourceModelSha256)!.instances.length, 0);
});

test("only the three audited import redeclarations may shadow inherited source fields", () => {
  const schema = readSchema(schemaBytes); assert.ok(schema.ok);
  const master = schema.schema.classes.find(c => c.name === "MasterImportSymbol")!;
  const repeated = master.properties.find(f => f.name === "m_subSymbolMapInt")!; assert.ok(repeated);
  repeated.name = "m_categoryId";
  const parsed = readNativeStairTypedFifo(bytes(2228283), schema.schema, "MasterImportSymbol");
  assert.equal(parsed.ok, false); if (!parsed.ok) assert.match(parsed.error, /Duplicate inherited/);
});

test("shared page framing yields the same original facts as independently retained root frames", () => {
  const c = collector(), direct = collector(); populate(direct);
  c.scanPage(Uint8Array.from(Buffer.concat(fixture.frames.map(f => Buffer.from(f.frameHex, "hex")))));
  assert.deepEqual(c.snapshot(fixture.sourceModelSha256), direct.snapshot(fixture.sourceModelSha256));
});
