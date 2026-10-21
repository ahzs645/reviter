import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readSchema } from "../lib/reviter/schema-reader.ts";
import { readNativeStairTypedFifo } from "../lib/reviter/native-stair-typed-fifo.ts";
import { inspectOriginalStairAssemblySemanticPrefix } from "../lib/reviter/native-source-stair-assembly.ts";
import type { PortableOriginalRiserPartition } from "../lib/reviter/native-stair-riser-local-partition.ts";
import { inspectOriginalStairTypedRiserSequence as inspectNativeSequence } from "../lib/reviter/native-source-stair-stepped-stations.ts";
import { inspectOriginalStairTypedRiserSequence as inspectBrowserSequence } from "../../openindoormaps/app/indoor-project/native-stepped-stair-v2-stations.ts";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const schemaBytes = fixture("native-drawing-reference-source-schema.bin"), parsed = readSchema(schemaBytes); assert(parsed.ok);
const lowerBytes = fixture("native-original-stair-2474569.4102.bin"), upperBytes = fixture("native-original-stair-run-2474572.4102.bin");
const lower = readNativeStairTypedFifo(lowerBytes, parsed.schema), upper = readNativeStairTypedFifo(upperBytes, parsed.schema); assert(lower.ok && upper.ok);
const parent = inspectOriginalStairAssemblySemanticPrefix(fixture("native-original-stair-2474568.4075.bin"), parsed.schema, "StairsElement");
const actualPacket: PortableOriginalRiserPartition = { sourceModelSha256: "8c294549ee667ed7aba38f1f4f3a53514dae7544af97f0157ee8187dd8702178", sourceSchemaSha256: hash(schemaBytes), nativeStairId: 2474568, originalParentFrameSha256: parent.sourceFrameSha256, originalParentRoot: parent.root, ownedRuns: [{ originalRunFrameSha256: hash(lowerBytes), run: lower.value }, { originalRunFrameSha256: hash(upperBytes), run: upper.value }] };
// Mathematical control only: change one retained scalar in both the current
// snapshot and its full packet. This never creates original-source authority.
const control = () => { const packet = structuredClone(actualPacket); const run = packet.ownedRuns[1]!.run; run.root.m_topRiserIndex = 24; return { packet, run }; };
for (const [name, inspect] of [["native", inspectNativeSequence], ["browser", inspectBrowserSequence]] as const) {
  test(`${name}: complete original peer lists resolve local indices while retaining a distinct nominal root disagreement`, () => {
    const { packet, run } = control(), before = structuredClone(run);
    const legacy = inspect(run, 5); assert.equal(legacy.completeNamedSourceRiserSequence, false); assert.match(legacy.blockers.join(" "), /ordered-riser layout/);
    const explicit = inspect(run, 5, packet);
    assert.equal(explicit.completeNamedSourceRiserSequence, true, explicit.blockers.join(" "));
    assert.deepEqual(explicit.originalAuthoredRunRiserRange, { baseRiserIndex: 12, topRiserIndex: 24 });
    assert.equal(explicit.orderedRisers.length, 6); assert.equal(explicit.treadRelations.length, 5);
    assert.deepEqual(explicit.treadRelations.map(t => [t.startRiserIndex, t.endRiserIndex]), [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]);
    assert.equal(explicit.originalSourceAuthorityGranted, false); assert.equal(explicit.exactPhysicalRiserBodyCorrespondenceApproved, false); assert.equal(explicit.routeApproved, false);
    assert.deepEqual(run, before);
  });
  test(`${name}: incomplete peers/count, foreign owner, stale snapshot and end0 cannot replace the legacy refusal`, () => {
    const missing = control(); missing.packet.ownedRuns.shift();
    assert.equal(inspect(missing.run, 5, missing.packet).completeNamedSourceRiserSequence, false);
    const count = control(); count.packet.originalParentRoot.m_actualNumberOfRisers = 19;
    assert.equal(inspect(count.run, 5, count.packet).completeNamedSourceRiserSequence, false);
    const foreign = control(); (foreign.packet.ownedRuns[0]!.run.root.m_stairsId as {m_id:{m_id64:number}}).m_id.m_id64 = 1;
    assert.equal(inspect(foreign.run, 5, foreign.packet).completeNamedSourceRiserSequence, false);
    const stale = control(), current = structuredClone(stale.run); current.root.m_isMirrored = 1;
    assert.equal(inspect(current, 5, stale.packet).completeNamedSourceRiserSequence, false);
    const end0 = control(); end0.run.root.m_endWithRiser = 0;
    assert.equal(inspect(end0.run, 5, end0.packet).completeNamedSourceRiserSequence, false);
    const omittedRiser = control(); (omittedRiser.packet.ownedRuns[0]!.run.root.m_orderedRisers as unknown[]).pop();
    assert.equal(inspect(omittedRiser.run, 5, omittedRiser.packet).completeNamedSourceRiserSequence, false);
  });
}
