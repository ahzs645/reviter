import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readSchema } from "../lib/reviter/schema-reader.ts";
import {
  readNativeStairTypedFifo,
  type NativeStairTypedFifo,
} from "../lib/reviter/native-stair-typed-fifo.ts";
import {
  Rational,
  rational,
  nativeRationalOverlay,
} from "../lib/reviter/native-rational-overlay.ts";
import {
  inspectOriginalCapBackedTurn,
  type OriginalCapBackedTurnOperands,
} from "../lib/reviter/native-stair-cap-backed-turn.ts";
import { Rational as BrowserRational } from "../../openindoormaps/app/indoor-project/native-rational-overlay.ts";
import { inspectOriginalCapBackedTurn as inspectBrowserTurn } from "../../openindoormaps/app/indoor-project/native-stepped-stair-v2-cap-backed-turn.ts";
type EncodedFixturePacket = {
  nativeRunId: number;
  originalRunFrameSha256: string;
  typedIndex: number;
  cap: Record<string, unknown>;
};
const fixture: { sourceSchemaSha256: string; packets: EncodedFixturePacket[] } =
  JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/native-original-cap-backed-turn-domains.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
const schemaBytes = readFileSync(
    new URL(
      "./fixtures/native-drawing-reference-source-schema.bin",
      import.meta.url,
    ),
  ),
  parsed = readSchema(schemaBytes);
assert(parsed.ok);
assert.equal(
  createHash("sha256").update(schemaBytes).digest("hex"),
  fixture.sourceSchemaSha256,
);
const decode = (v: unknown, browser = false): unknown => {
  if (v && typeof v === "object" && "numerator" in v && "denominator" in v)
    return new (browser ? BrowserRational : Rational)(
      BigInt(String(v.numerator)),
      BigInt(String(v.denominator)),
    );
  if (Array.isArray(v)) return v.map((x) => decode(x, browser));
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v).map(([k, w]) => [k, decode(w, browser)]),
    );
  return v;
};
const canonical = (v: unknown): unknown => {
  if (
    v &&
    typeof v === "object" &&
    "n" in v &&
    "d" in v &&
    typeof v.n === "bigint" &&
    typeof v.d === "bigint"
  )
    return { numerator: v.n.toString(), denominator: v.d.toString() };
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v).map(([k, w]) => [k, canonical(w)]),
    );
  return v;
};
const runs = new Map<number, NativeStairTypedFifo>(
  fixture.packets.map((p) => {
    const bytes = readFileSync(
      new URL(
        `./fixtures/native-original-stair-${p.nativeRunId}.4102.bin`,
        import.meta.url,
      ),
    );
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      p.originalRunFrameSha256,
    );
    const r = readNativeStairTypedFifo(bytes, parsed.schema);
    assert(r.ok);
    return [p.nativeRunId, r.value] as const;
  }),
);
for (const raw of fixture.packets)
  test(`actual original turning cap ${raw.nativeRunId}/${raw.typedIndex} preserves exact reference/uncertainty and literal zero vectors`, () => {
    const run = runs.get(raw.nativeRunId)!;
    const packet = decode(raw) as OriginalCapBackedTurnOperands,
      before = canonical(packet),
      result = inspectOriginalCapBackedTurn(run, raw.typedIndex, packet);
    assert.deepEqual(result.originalRiserDir, [0, 0, 0]);
    assert.deepEqual(result.originalRunDirProj, [0, 0, 0]);
    assert.deepEqual(result.originalNormal, [0, 0, 0]);
    assert.equal(result.originalPhysicalFaceToken, raw.cap.physicalFaceToken);
    assert.deepEqual(
      canonical(result.originalCapReferenceIntentPartsFeet),
      raw.cap.referenceEmbedding,
    );
    assert.deepEqual(
      canonical(result.originalCapUncertaintyPartsFeet),
      raw.cap.boundaryUncertainty,
    );
    assert.deepEqual(
      canonical(result.originalGuaranteedInnerSupportPartsFeet),
      raw.cap.guaranteedInnerPlanSupport,
    );
    assert.equal(
      result.uniqueOriginalEndpointPairing,
      raw.nativeRunId === 1294068 ? 1 : 0,
    );
    assert.equal(result.hullUsedAsPositiveSupport, false);
    assert.equal(result.sourceAuthorityGranted, false);
    assert.equal(result.fullTwoFootStationOrTransferApproved, false);
    assert.equal(result.physicalBodyHeadroomOrTerminalApproved, false);
    assert.equal(result.routeApproved, false);
    assert.deepEqual(
      canonical(result),
      canonical(
        inspectBrowserTurn(
          run,
          raw.typedIndex,
          decode(raw, true) as unknown as Parameters<
            typeof inspectBrowserTurn
          >[2],
        ),
      ),
    );
    assert.deepEqual(canonical(packet), before);
  });
test("missing explicit source mode, foreign geometry/history/edges and discarded uncertainty remain refused", () => {
  const raw = fixture.packets[0]!,
    run = runs.get(raw.nativeRunId)!;
  const bad = (
    mutate: (p: OriginalCapBackedTurnOperands) => void,
    pattern: RegExp,
  ) => {
    const p = decode(raw) as OriginalCapBackedTurnOperands;
    mutate(p);
    assert.throws(
      () => inspectOriginalCapBackedTurn(run, raw.typedIndex, p),
      pattern,
    );
  };
  bad((p) => {
    p.mode = "optional-axis-fallback" as OriginalCapBackedTurnOperands["mode"];
  }, /explicit/);
  bad((p) => {
    p.sourceGeometryOwnerElementId = p.nativeRunId;
  }, /foreign/);
  bad((p) => {
    p.originalRunFrameSha256 = "cached-source";
  }, /explicit/);
  bad((p) => {
    p.originalTreadHistoryBinding.history[0]!.keys[2] = 0;
  }, /history/);
  bad((p) => {
    p.cap.originalEdgeTokens.pop();
  }, /coedge/);
  bad((p) => {
    p.cap.physicalFaceToken++;
  }, /identity/);
  bad((p) => {
    p.cap.guaranteedInnerPlanSupport = p.cap.referenceEmbedding;
  }, /uncertainty\/holes/);
});
test("zero-vector straight/unknown modes, changed local references and curved source primitives do not qualify", () => {
  const raw = fixture.packets[0]!,
    packet = decode(raw) as OriginalCapBackedTurnOperands,
    original = runs.get(raw.nativeRunId)!;
  const changed = structuredClone(original),
    tread = changed.entries.find(
      (e) =>
        e.descriptor.start ===
          (changed.root.m_stairsTreadInfoArr as { start: number }[])[
            raw.typedIndex
          ]!.start &&
        e.descriptor.path ===
          `StairsRun.m_stairsTreadInfoArr[${raw.typedIndex}]`,
    )!;
  tread.value.m_runType = 0;
  assert.throws(
    () => inspectOriginalCapBackedTurn(changed, raw.typedIndex, packet),
    /turning mode/,
  );
  const missing = structuredClone(original);
  (missing.root.m_orderedRisers as unknown[]).pop();
  assert.throws(
    () => inspectOriginalCapBackedTurn(missing, raw.typedIndex, packet),
    /cardinality/,
  );
  const curved = structuredClone(original),
    info = curved.entries.find(
      (e) =>
        e.descriptor.path ===
        `StairsRun.m_stairsTreadInfoArr[${raw.typedIndex}]`,
    )!;
  const descriptor = info.value.m_startLine as { token: number };
  curved.entries.find(
    (e) => e.descriptor.token === descriptor.token,
  )!.sourceClassName = "GArc";
  assert.throws(
    () => inspectOriginalCapBackedTurn(curved, raw.typedIndex, packet),
    /curved/,
  );
});
test("hole uncertainty control remains excluded from cap intent support; it cannot be silently filled", () => {
  const raw = fixture.packets[0]!,
    packet = decode(raw) as OriginalCapBackedTurnOperands,
    run = runs.get(raw.nativeRunId)!;
  // A mathematical hole-control packet has no original-source authority. Its
  // complete reference and derived inner domains must retain the same hole.
  const ring = [
      [-100, -100],
      [100, -100],
      [100, 300],
      [-100, 300],
    ].map((p) => p.map(rational) as [Rational, Rational]),
    hole = [
      [-92, 180],
      [-90, 180],
      [-90, 182],
      [-92, 182],
    ].map((p) => p.map(rational) as [Rational, Rational]);
  packet.cap.referenceEmbedding = [[ring, hole]];
  packet.cap.boundaryUncertainty = [];
  packet.cap.guaranteedInnerPlanSupport = nativeRationalOverlay(
    "union",
    packet.cap.referenceEmbedding,
  );
  const result = inspectOriginalCapBackedTurn(run, raw.typedIndex, packet);
  assert.equal(result.originalCapReferenceIntentPartsFeet[0]!.length, 2);
  assert.equal(
    nativeRationalOverlay(
      "intersection",
      [[hole]],
      result.originalGuaranteedInnerSupportPartsFeet,
    ).length,
    0,
  );
  packet.cap.guaranteedInnerPlanSupport = [[ring]];
  assert.throws(
    () => inspectOriginalCapBackedTurn(run, raw.typedIndex, packet),
    /uncertainty\/holes/,
  );
});

import { inspectOriginalStairTypedRiserSequence as inspectSourceSequence } from "../lib/reviter/native-source-stair-stepped-stations.ts";
import { inspectOriginalStairTypedRiserSequence as inspectNativeSequence } from "../lib/reviter/native-stepped-stair-v2-stations.ts";
import { inspectOriginalStairTypedRiserSequence as inspectBrowserSequence } from "../../openindoormaps/app/indoor-project/native-stepped-stair-v2-stations.ts";
import type { PortableOriginalRiserPartition } from "../lib/reviter/native-stair-riser-local-partition.ts";
for (const nativeRunId of new Set(fixture.packets.map((p) => p.nativeRunId)))
  test(`actual finite turn ${nativeRunId} composes through all three parsers only with explicit cap mode and full local partition`, () => {
    const raw = fixture.packets.filter((p) => p.nativeRunId === nativeRunId),
      run = runs.get(nativeRunId)!,
      packets = raw.map((p) => decode(p) as OriginalCapBackedTurnOperands),
      packet = packets[0]!,
      count = (run.root.m_stairsTreadInfoArr as unknown[]).length;
    // Synthetic parent operands exercise portable mathematics only. Actual parent
    // membership and source authority are separately issued from original RVT.
    const partition: PortableOriginalRiserPartition = {
      sourceModelSha256: packet.sourceModelSha256,
      sourceSchemaSha256: packet.sourceSchemaSha256,
      nativeStairId: packet.nativeStairId,
      originalParentFrameSha256: "c".repeat(64),
      originalParentRoot: {
        m_id: { m_id: { m_id64: packet.nativeStairId } },
        m_moribund: 0,
        m_dummy: 0,
        m_actualNumberOfRisers: count + 1,
        m_actualRiserHeight: 1,
        m_stairsHeight: count + 1,
        m_baseLevelId: { m_id: { m_id64: 1 } },
        m_topLevelId: { m_id: { m_id64: 2 } },
        m_baseLevelOffset: 0,
        m_topLevelOffset: 0,
      },
      ownedRuns: [
        {
          originalRunFrameSha256: packet.originalRunFrameSha256,
          run: structuredClone(run),
        },
      ],
    };
    assert.equal(
      inspectSourceSequence(run, count, partition)
        .completeNamedSourceRiserSequence,
      false,
    );
    const result = inspectSourceSequence(run, count, partition, packets);
    assert.equal(
      result.completeNamedSourceRiserSequence,
      true,
      result.blockers.join("; "),
    );
    assert.deepEqual(
      result.explicitCapBackedTurningTypedIndices,
      raw.map((p) => p.typedIndex),
    );
    assert.equal(result.routeApproved, false);
    assert.deepEqual(
      canonical(result),
      canonical(inspectNativeSequence(run, count, partition, packets)),
    );
    assert.deepEqual(
      canonical(result),
      canonical(
        inspectBrowserSequence(
          run,
          count,
          partition,
          raw.map(
            (p) =>
              decode(p, true) as unknown as Parameters<
                typeof inspectBrowserSequence
              >[3] extends readonly (infer T)[] | undefined
                ? T
                : never,
          ),
        ),
      ),
    );
    assert.equal(
      inspectSourceSequence(run, count, undefined, packets)
        .completeNamedSourceRiserSequence,
      false,
    );
    assert.equal(
      inspectSourceSequence(run, count, partition, [...packets, packets[0]!])
        .completeNamedSourceRiserSequence,
      false,
    );
  });
