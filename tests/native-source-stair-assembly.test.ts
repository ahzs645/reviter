import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readSchema } from "../lib/reviter/schema-reader.ts";
import {
  inspectOriginalStairAssemblySemanticPrefix,
  inspectOriginalStairAssemblySchemaChildUnion,
  inspectOriginalNativeStairAssemblyGlobalChildOwnership,
  inspectOriginalStairAssemblySemanticFifo,
  inspectOriginalStairLandingNamedBoundaryPorts,
  inspectOriginalNativeStairAssemblyLandingPorts,
  readOriginalNativeStairAssemblySemanticSource,
  createOriginalNativeStairAssemblyContext,
  bindOriginalNativeStairAssembly,
  inspectOriginalNativeStairAssemblyMembership,
  originalNativeStairAssemblyMembershipFacts,
  inspectOriginalNativeStairAssemblyMemberMaterial,
  type OriginalNativeStairAssemblyContext,
  type OriginalNativeStairAssemblyMembership,
} from "../lib/reviter/native-source-stair-assembly.ts";
import type { OriginalNativeForeignEnvelopeCensus } from "../lib/reviter/native-source-foreign-envelope-census.ts";
const modelSha = "8c294549ee667ed7aba38f1f4f3a53514dae7544af97f0157ee8187dd8702178";
const bytes = readFileSync(new URL("./fixtures/native-original-stair-run-2474572.4102.bin", import.meta.url));
const schemaBytes = readFileSync(new URL("./fixtures/native-drawing-reference-source-schema.bin", import.meta.url));
const parsed = readSchema(schemaBytes); assert.ok(parsed.ok);
const landingBytes = readFileSync(new URL("./fixtures/native-original-stair-landing-2474574.4080.bin", import.meta.url));
test("the exact original schema closes every native run/landing subclass and separates other stairs ownership families", () => {
  const union = inspectOriginalStairAssemblySchemaChildUnion(parsed.schema);
  assert.deepEqual(union.originalRunClasses, [{ sourceClassName: "StairsRun", sourceClassSlot: 4102 }]);
  assert.deepEqual(union.originalLandingClasses, [{ sourceClassName: "StairsLanding", sourceClassSlot: 4080 }]);
  assert.deepEqual(union.originalRunAndLandingClasses.map(c => c.sourceClassSlot), [4080, 4081, 4102]);
  assert.deepEqual(union.nativeStairsOwnerDeclarations.map(c => c.sourceClassSlot), [598, 3463, 4081, 4092]);
  assert.deepEqual(union.alternativeForeignFamilies.map(c => c.sourceFamilyClassSlot), [598, 3463, 4092]);
  assert.equal(union.baseOnlyClassMustBeCensused, 4081);
  assert.equal(union.sourceAuthorityGranted, false);
  assert.equal(union.routeApproved, false);
});
test("an unscanned derived run, unknown native owner, ancestry cycle or incomplete schema refuses child closure", () => {
  const run = parsed.schema.classes.find(c => c.index === 4102)!;
  const derived = structuredClone(parsed.schema);
  derived.classes.push({ ...structuredClone(run), index: 32000, name: "UnknownDerivedStairsRun", parent: { kind: "reference", index: 4102, name: "StairsRun" }, properties: [], propertyCount: 0 });
  assert.throws(() => inspectOriginalStairAssemblySchemaChildUnion(derived), /Unscanned derived/);
  const foreign = structuredClone(parsed.schema), owner = foreign.classes.find(c => c.index === 598)!;
  foreign.classes.push({ ...structuredClone(owner), index: 32000, name: "UnknownNativeStairsOwner", properties: [structuredClone(owner.properties.find(f => f.name === "m_stairsId")!)], propertyCount: 1 });
  assert.throws(() => inspectOriginalStairAssemblySchemaChildUnion(foreign), /Unknown original native stairs owner/);
  const cycle = structuredClone(parsed.schema); cycle.classes.find(c => c.index === 4081)!.parent = { kind: "reference", index: 4102, name: "StairsRun" };
  assert.throws(() => inspectOriginalStairAssemblySchemaChildUnion(cycle), /ancestry/);
  const incomplete = structuredClone(parsed.schema); incomplete.trailingBytes = 1;
  assert.throws(() => inspectOriginalStairAssemblySchemaChildUnion(incomplete), /Incomplete/);
  assert.throws(() => inspectOriginalNativeStairAssemblyGlobalChildOwnership({} as OriginalNativeStairAssemblyContext), /Untrusted/);
});
test("actual automatic landing FIFO retains every source object and names finite boundary ports by original history", () => {
  const full = inspectOriginalStairAssemblySemanticFifo(landingBytes, parsed.schema, "StairsLanding");
  assert.equal(full.completeSemanticFifoDecoded, true);
  assert.equal(full.originalSemanticFifoEnd, landingBytes.length - 4);
  assert.equal(full.entries.length, 133);
  const ports = inspectOriginalStairLandingNamedBoundaryPorts(full);
  assert.deepEqual(ports.map(p => [p.nativeRunId, p.originalBoundaryCurveIndex, p.originalRunEndpointType]), [[2474569, 3, 2], [2474572, 6, 1]]);
  assert.ok(ports.every(p => !p.sourceJoinApproved && !p.routeApproved));
  assert.equal(createHash("sha256").update(landingBytes).digest("hex"), "46bf028cab88f21ef9debf96f47afb23911dd020f1c832161b4ac0a3b26c6f35");
});
test("unresolved sketched history, missing descriptors, open boundary, curved port and changed peer ownership refuse", () => {
  const sketched = inspectOriginalStairAssemblySemanticFifo(readFileSync(new URL("./fixtures/native-original-stair-landing-1305763.4080.bin", import.meta.url)), parsed.schema, "StairsLanding");
  assert.throws(() => inspectOriginalStairLandingNamedBoundaryPorts(sketched), /map\/history/);
  const source = inspectOriginalStairAssemblySemanticFifo(landingBytes, parsed.schema, "StairsLanding");
  const missing = structuredClone(source); missing.entries = missing.entries.filter(e => e.descriptor.token !== 20);
  assert.throws(() => inspectOriginalStairLandingNamedBoundaryPorts(missing), /descriptor/);
  const open = structuredClone(source); open.entries.find(e => e.descriptor.path === "StairsLanding.m_oBoundary")!.value.m_open = 1;
  assert.throws(() => inspectOriginalStairLandingNamedBoundaryPorts(open), /boundary/);
  const curved = structuredClone(source); curved.entries.find(e => e.descriptor.token === 20)!.sourceClassName = "GArc";
  assert.throws(() => inspectOriginalStairLandingNamedBoundaryPorts(curved), /GLine/);
  const foreign = structuredClone(source); (foreign.root.m_logicJoinInfo as { m_logiciJoins: { m_peerElementId: { m_id: { m_id64: number } } }[] }).m_logiciJoins[0]!.m_peerElementId.m_id.m_id64 = 1;
  assert.throws(() => inspectOriginalStairLandingNamedBoundaryPorts(foreign), /peer/);
});
test("an extra checksum-correct queued byte cannot be ignored by complete assembly semantic replay", () => {
  const changed = Buffer.concat([landingBytes.subarray(0, -4), Buffer.from([0]), landingBytes.subarray(-4)]), v = new DataView(changed.buffer, changed.byteOffset, changed.length), n = changed.length - 20;
  v.setUint32(12, n, true); v.setUint32(changed.length - 4, n, true);
  let a = 1, b = 0; for (let i = 16; i < changed.length - 4; i++) { a = (a + changed[i]!) % 65521; b = (b + a) % 65521; } v.setUint32(8, (b * 65536 + a) >>> 0, true);
  assert.throws(() => inspectOriginalStairAssemblySemanticFifo(changed, parsed.schema, "StairsLanding"), /complete frame/);
});
test("an exact original run static prefix binds its explicit parent/definition and keeps all dynamic source descriptors", () => {
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "6656ab15c494e8aac467f50cc5cdb35e60b1e8d5d33339c350d45f1004a3cdf3");
  const before = Buffer.from(bytes), facts = inspectOriginalStairAssemblySemanticPrefix(bytes, parsed.schema, "StairsRun");
  assert.equal(facts.nativeElementId, 2474572);
  assert.equal((facts.root.m_stairsId as { m_id: { m_id64: number } }).m_id.m_id64, 2474568);
  assert.equal((facts.root.m_triserSymId as { m_id: { m_id64: number } }).m_id.m_id64, 2474573);
  assert.equal(facts.root.m_baseRiserIndex, 12);
  assert.equal(facts.root.m_topRiserIndex, 18);
  assert.equal((facts.root.m_orderedRisers as unknown[]).length, 6);
  assert.ok(facts.originalStaticPrefixEnd < bytes.length - 4);
  assert.equal(facts.completeSemanticFifoDecoded, false);
  assert.equal(facts.sourceAuthorityGranted, false);
  assert.ok(facts.fields.some(f => f.sourceClassName === "StairsRunAndLanding" && f.path.endsWith(".m_stairsId")));
  assert.deepEqual(bytes, before);
});
test("wrong source root, changed checksum, missing bytes and changed schema cannot become an assembly prefix", () => {
  assert.throws(() => inspectOriginalStairAssemblySemanticPrefix(bytes, parsed.schema, "StairsLanding"), /identity/);
  const changed = Buffer.from(bytes); changed[64] = changed[64]! ^ 1;
  assert.throws(() => inspectOriginalStairAssemblySemanticPrefix(changed, parsed.schema, "StairsRun"), /checksum/);
  assert.throws(() => inspectOriginalStairAssemblySemanticPrefix(bytes.subarray(0, bytes.length - 1), parsed.schema, "StairsRun"), /echo/);
  const changedSchema = structuredClone(parsed.schema); changedSchema.trailingBytes = 1;
  assert.throws(() => inspectOriginalStairAssemblySemanticPrefix(bytes, changedSchema, "StairsRun"), /schema/);
});
test("caller rows, stale hashes and forged source handles grant no original assembly authority", () => {
  assert.throws(() => inspectOriginalNativeStairAssemblyMembership({} as OriginalNativeStairAssemblyContext, 2474568), /Untrusted/);
  assert.throws(() => bindOriginalNativeStairAssembly({} as OriginalNativeStairAssemblyContext, 2474568), /Untrusted/);
  assert.throws(() => originalNativeStairAssemblyMembershipFacts({} as OriginalNativeStairAssemblyMembership), /Untrusted/);
  assert.throws(() => inspectOriginalNativeStairAssemblyLandingPorts({} as OriginalNativeStairAssemblyMembership, 2474574), /Untrusted/);
  assert.throws(() => readOriginalNativeStairAssemblySemanticSource({} as OriginalNativeStairAssemblyMembership, 2474574), /Untrusted/);
  assert.throws(() => inspectOriginalNativeStairAssemblyMemberMaterial({} as OriginalNativeStairAssemblyMembership, {} as OriginalNativeForeignEnvelopeCensus, 2474572), /Untrusted/);
  assert.throws(() => createOriginalNativeStairAssemblyContext(bytes, "0".repeat(64), [2474568]), /checksum/);
  assert.throws(() => createOriginalNativeStairAssemblyContext(bytes, modelSha, [2474568, 2474568]), /request/);
});
test("actual original parent binds all globally censused owned run/landing occurrences without route authority", { skip: !process.env.UNBC_ORIGINAL_RVT }, () => {
  const source = createOriginalNativeStairAssemblyContext(readFileSync(process.env.UNBC_ORIGINAL_RVT!), modelSha, [2474568]);
  assert.equal(source.completeSourcePages, 3666);
  const census = inspectOriginalNativeStairAssemblyGlobalChildOwnership(source);
  assert.equal(census.schemaChildUnion.schemaChildUnionClosed, true);
  assert.equal(census.originalBaseOnlyRunAndLandingOccurrences.length, 0);
  assert.equal(census.completeOriginalRunAndLandingChildUnionCensus, true);
  assert.ok(census.originalRunOccurrences.some(c => c.nativeElementId === 2474572 && c.originalParentNativeStairId === 2474568));
  census.originalRunOccurrences[0]!.originalParentNativeStairId = 1;
  assert.notEqual(inspectOriginalNativeStairAssemblyGlobalChildOwnership(source).originalRunOccurrences[0]!.originalParentNativeStairId, 1);
  const handle = bindOriginalNativeStairAssembly(source, 2474568), facts = originalNativeStairAssemblyMembershipFacts(handle);
  const publicView = inspectOriginalNativeStairAssemblyMembership(source, 2474568); publicView.members[0]!.originalChildToParentId = 1;
  assert.equal(inspectOriginalNativeStairAssemblyMembership(source, 2474568).members[0]!.originalChildToParentId, 2474568);
  assert.deepEqual(new Set(facts.originalRunIds), new Set([2474569, 2474572]));
  assert.ok(facts.members.every(m => m.originalChildToParentId === 2474568));
  assert.ok(facts.members.every(m => m.originalDefinitionId === null || m.originalSymbolHostId === m.nativeElementId));
  assert.equal(facts.routeApproved, false);
  assert.equal(facts.sourceJoinsApproved, false);
  const ports = inspectOriginalNativeStairAssemblyLandingPorts(handle, 2474574);
  assert.equal(ports.ports.length, 2);
  assert.equal(ports.routeApproved, false);
  assert.throws(() => inspectOriginalNativeStairAssemblyLandingPorts(handle, 1514132), /assembly-owned/);
  const raw = readOriginalNativeStairAssemblySemanticSource(handle, 2474574); raw.originalSemanticBytes.fill(0);
  assert.equal(readOriginalNativeStairAssemblySemanticSource(handle, 2474574).originalSemanticBytes[0], landingBytes[0]);
  facts.members[0]!.originalChildToParentId = 1;
  assert.equal(originalNativeStairAssemblyMembershipFacts(handle).members[0]!.originalChildToParentId, 2474568);
  assert.throws(() => inspectOriginalNativeStairAssemblyMemberMaterial(handle, { sourceModelSha256: "0".repeat(64), sourceSchemaSha256: source.sourceSchemaSha256 } as OriginalNativeForeignEnvelopeCensus, 2474569), /differ/);
});
