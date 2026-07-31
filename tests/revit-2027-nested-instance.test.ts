import assert from "node:assert/strict";
import test from "node:test";

import type { RevitTransform3d } from "../lib/reviter/dynamic-geometry-queue.ts";
import type {
  Revit2027GInstance,
  Revit2027InstanceInfo,
} from "../lib/reviter/revit-2027-ginstance.ts";
import type {
  Revit2027GRepReplay,
  Revit2027GRepReplaySpan,
} from "../lib/reviter/revit-2027-grep-replay.ts";
import {
  collectRevit2027GInstanceBindings,
  collectRevit2027NestedInstances,
  composeRevit2027EmbeddedPathTransform,
  composeRevit2027NestedMesh,
  type Revit2027NestedInstance,
  type Revit2027NestedMeshOwner,
} from "../lib/reviter/revit-2027-nested-instance.ts";

function transform(
  matrix: RevitTransform3d["matrix"],
): RevitTransform3d {
  return {
    byteOffset: 100,
    endOffset: 196,
    xAxis: [matrix[0], matrix[1], matrix[2]],
    yAxis: [matrix[4], matrix[5], matrix[6]],
    zAxis: [matrix[8], matrix[9], matrix[10]],
    origin: [matrix[12], matrix[13], matrix[14]],
    matrix,
  };
}

const IDENTITY = transform([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

function span(
  partial: Partial<Revit2027GRepReplaySpan> &
    Pick<
      Revit2027GRepReplaySpan,
      "replayIndex" | "readerId" | "propertySourceClassSlot" | "value"
    >,
): Revit2027GRepReplaySpan {
  return {
    replayIndex: partial.replayIndex,
    queueSequence: partial.queueSequence ?? partial.replayIndex,
    ownerElementId: partial.ownerElementId ?? 10n,
    path: partial.path ?? [0],
    parentPath: partial.parentPath ?? null,
    parentReplayIndex: partial.parentReplayIndex ?? null,
    propertyToken: partial.propertyToken ?? 3,
    propertySourceClassSlot: partial.propertySourceClassSlot,
    descriptorOffset: partial.descriptorOffset ?? 20,
    descriptorEndOffset: partial.descriptorEndOffset ?? 26,
    startOffset: partial.startOffset ?? 64,
    endOffset: partial.endOffset ?? 108,
    readerId: partial.readerId,
    value: partial.value,
  };
}

function replay(
  spans: readonly Revit2027GRepReplaySpan[],
): Revit2027GRepReplay {
  return {
    ownerElementId: 10n,
    startOffset: 64,
    endOffset: 264,
    initialTokenCount: 3,
    finalTokenCount: 4,
    descriptors: [],
    spans,
  };
}

function gInstance(): Revit2027GInstance {
  return {
    byteOffset: 64,
    endOffset: 108,
    gInfo: {
      gStyleElementId: -1n,
      tag: 2,
      controlCommand: 0,
      flags: 0x0008_8024,
    },
    instanceInfo: {
      byteOffset: 84,
      endOffset: 90,
      token: -1,
      sourceClassSlot: 2_513,
    },
    embeddedSymbolGRep: {
      byteOffset: 90,
      endOffset: 94,
      token: 0,
      sourceClassSlot: null,
    },
    tagElementId: -1n,
    forbiddenTarget: 53_246,
    resolveSymbolInView: false,
    hasScale: false,
  };
}

function instanceInfo(): Revit2027InstanceInfo {
  return {
    byteOffset: 152,
    endOffset: 264,
    transform: IDENTITY,
    symbolElementId: 20n,
    gRepId: 0,
    cda: 1,
  };
}

function exactReplay(): Revit2027GRepReplay {
  return replay([
    span({
      replayIndex: 0,
      readerId: "Revit2027GInstance",
      propertySourceClassSlot: 2_215,
      path: [0],
      descriptorOffset: 0,
      descriptorEndOffset: 6,
      value: gInstance(),
    }),
    span({
      replayIndex: 1,
      readerId: "Revit2027GLine",
      propertySourceClassSlot: 1_973,
      path: [1],
      descriptorOffset: 6,
      descriptorEndOffset: 12,
      value: {},
    }),
    span({
      replayIndex: 2,
      readerId: "Revit2027InstanceInfo",
      propertySourceClassSlot: 2_513,
      path: [0, 0],
      parentPath: [0],
      parentReplayIndex: 0,
      propertyToken: -1,
      descriptorOffset: 84,
      descriptorEndOffset: 90,
      startOffset: 152,
      endOffset: 264,
      value: instanceInfo(),
    }),
  ]);
}

test("pairs GInstance with its queued InstanceInfo across older siblings", () => {
  const collected = collectRevit2027NestedInstances(exactReplay());
  assert.equal(collected.ok, true);
  if (!collected.ok) return;
  assert.equal(collected.value.length, 1);
  assert.deepEqual(
    {
      owner: collected.value[0]!.ownerElementId,
      instanceReplay: collected.value[0]!.instanceReplayIndex,
      infoReplay: collected.value[0]!.instanceInfoReplayIndex,
      path: collected.value[0]!.path,
      symbol: collected.value[0]!.symbolElementId,
      gRepId: collected.value[0]!.gRepId,
      cda: collected.value[0]!.cda,
    },
    {
      owner: 10n,
      instanceReplay: 0,
      infoReplay: 2,
      path: [0],
      symbol: 20n,
      gRepId: 0,
      cda: 1,
    },
  );
});

test("rejects missing, duplicate, or descriptor-mismatched InstanceInfo", () => {
  const base = exactReplay();
  const missing = collectRevit2027NestedInstances(
    replay(base.spans.slice(0, 2)),
  );
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /0 InstanceInfo children/);

  const duplicate = collectRevit2027NestedInstances(
    replay([...base.spans, { ...base.spans[2]!, replayIndex: 3 }]),
  );
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.match(duplicate.error, /2 InstanceInfo children/);

  const mismatched = collectRevit2027NestedInstances(
    replay([
      base.spans[0]!,
      base.spans[1]!,
      { ...base.spans[2]!, descriptorOffset: 85 },
    ]),
  );
  assert.equal(mismatched.ok, false);
  if (!mismatched.ok) assert.match(mismatched.error, /descriptor and path/);
});

function embeddedReplay(): Revit2027GRepReplay {
  const base = exactReplay();
  const embeddedInstance: Revit2027GInstance = {
    ...gInstance(),
    endOffset: 110,
    embeddedSymbolGRep: {
      byteOffset: 90,
      endOffset: 96,
      token: 4,
      sourceClassSlot: 2_246,
    },
    forbiddenTarget: 0,
  };
  const embeddedInfo: Revit2027InstanceInfo = {
    ...instanceInfo(),
    transform: transform([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      5, 6, 7, 1,
    ]),
  };
  return replay([
    {
      ...base.spans[0]!,
      value: embeddedInstance,
    },
    {
      ...base.spans[1]!,
    },
    {
      ...base.spans[2]!,
      value: embeddedInfo,
    },
    span({
      replayIndex: 3,
      readerId: "Revit2027GElement",
      propertySourceClassSlot: 2_246,
      path: [0, 1],
      parentPath: [0],
      parentReplayIndex: 0,
      propertyToken: 4,
      descriptorOffset: 90,
      descriptorEndOffset: 96,
      value: {
        byteOffset: 264,
        endOffset: 412,
        elementId: 20n,
        objectType: 3,
        flags: 2,
      },
    }),
  ]);
}

test("embedded GElement takes precedence over external symbol traversal", () => {
  const replayed = embeddedReplay();
  const bindings = collectRevit2027GInstanceBindings(replayed);
  assert.equal(bindings.ok, true);
  if (!bindings.ok) return;
  assert.equal(bindings.value.length, 1);
  assert.equal(bindings.value[0]!.kind, "embedded");

  const external = collectRevit2027NestedInstances(replayed);
  assert.deepEqual(external, { ok: true, value: [] });

  const direct = composeRevit2027EmbeddedPathTransform(
    bindings.value,
    [0, 1, 0, 2],
  );
  assert.equal(direct.ok, true);
  if (direct.ok) assert.deepEqual(direct.value?.slice(12, 15), [5, 6, 7]);
  const outside = composeRevit2027EmbeddedPathTransform(
    bindings.value,
    [1, 0],
  );
  assert.deepEqual(outside, { ok: true, value: null });
});

test("embedded GElement pairing fails closed on identity mismatch", () => {
  const replayed = embeddedReplay();
  const spans = replayed.spans.map((entry) =>
    entry.readerId === "Revit2027GElement"
      ? {
          ...entry,
          value: {
            ...(entry.value as Record<string, unknown>),
            elementId: 21n,
          },
        }
      : entry);
  const bindings = collectRevit2027GInstanceBindings({
    ...replayed,
    spans,
  });
  assert.equal(bindings.ok, false);
  if (!bindings.ok) assert.match(bindings.error, /does not match InstanceInfo/);
});

function nested(
  ownerElementId: bigint,
  symbolElementId: bigint,
  matrix: RevitTransform3d["matrix"],
  overrides: Partial<Revit2027NestedInstance> = {},
): Revit2027NestedInstance {
  return {
    ownerElementId,
    instanceReplayIndex: 1,
    instanceInfoReplayIndex: 2,
    path: [0],
    symbolElementId,
    gRepId: 0,
    cda: 1,
    transform: transform(matrix),
    tagElementId: -1n,
    forbiddenTarget: 0,
    resolveSymbolInView: false,
    hasScale: false,
    ...overrides,
  };
}

test("composes outer-to-inner symbol transforms and preserves shared meshes", () => {
  const outer = [
    0, 1, 0, 0,
    -1, 0, 0, 0,
    0, 0, 1, 0,
    10, 0, 0, 1,
  ] as const;
  const inner = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    2, 0, 0, 1,
  ] as const;
  const owners: Revit2027NestedMeshOwner<string>[] = [
    {
      ownerElementId: 10n,
      geometry: null,
      nestedInstances: [nested(10n, 20n, outer)],
    },
    {
      ownerElementId: 20n,
      geometry: "mesh-20",
      nestedInstances: [nested(20n, 30n, inner)],
    },
    {
      ownerElementId: 30n,
      geometry: "mesh-30",
      nestedInstances: [],
    },
  ];

  const composed = composeRevit2027NestedMesh(10n, owners);
  assert.equal(composed.ok, true);
  if (!composed.ok) return;
  assert.deepEqual(
    composed.value.occurrences.map((occurrence) => ({
      owner: occurrence.geometryOwnerElementId,
      geometry: occurrence.geometry,
      chain: occurrence.chain.length,
      origin: occurrence.transform.slice(12, 15),
    })),
    [
      { owner: 20n, geometry: "mesh-20", chain: 1, origin: [10, 0, 0] },
      { owner: 30n, geometry: "mesh-30", chain: 2, origin: [10, 2, 0] },
    ],
  );
});

test("composition rejects missing targets, cycles, conflicts, and selectors", () => {
  const identity = IDENTITY.matrix;
  const missing = composeRevit2027NestedMesh(10n, [
    {
      ownerElementId: 10n,
      geometry: null,
      nestedInstances: [nested(10n, 20n, identity)],
    },
  ]);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /target 20 is missing/);

  const cycle = composeRevit2027NestedMesh(10n, [
    {
      ownerElementId: 10n,
      geometry: null,
      nestedInstances: [nested(10n, 20n, identity)],
    },
    {
      ownerElementId: 20n,
      geometry: "mesh",
      nestedInstances: [nested(20n, 10n, identity)],
    },
  ]);
  assert.equal(cycle.ok, false);
  if (!cycle.ok) assert.match(cycle.error, /owner cycle: 10 -> 20 -> 10/);

  const duplicate = composeRevit2027NestedMesh(10n, [
    { ownerElementId: 10n, geometry: "a", nestedInstances: [] },
    { ownerElementId: 10n, geometry: "b", nestedInstances: [] },
  ]);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.match(duplicate.error, /duplicate.*owner 10/);

  const selector = composeRevit2027NestedMesh(10n, [
    {
      ownerElementId: 10n,
      geometry: null,
      nestedInstances: [
        nested(10n, 20n, identity, { gRepId: 7 }),
      ],
    },
    { ownerElementId: 20n, geometry: "mesh", nestedInstances: [] },
  ]);
  assert.equal(selector.ok, false);
  if (!selector.ok) assert.match(selector.error, /unsupported GRep selector 7/);

  const cdaSelector = composeRevit2027NestedMesh(10n, [
    {
      ownerElementId: 10n,
      geometry: null,
      nestedInstances: [
        nested(10n, 20n, identity, { cda: 2 }),
      ],
    },
    { ownerElementId: 20n, geometry: "mesh", nestedInstances: [] },
  ]);
  assert.equal(cdaSelector.ok, false);
  if (!cdaSelector.ok) {
    assert.match(cdaSelector.error, /unsupported CDA selector 2/);
  }

  const scaled = composeRevit2027NestedMesh(10n, [
    {
      ownerElementId: 10n,
      geometry: null,
      nestedInstances: [
        nested(10n, 20n, identity, { hasScale: true }),
      ],
    },
    { ownerElementId: 20n, geometry: "mesh", nestedInstances: [] },
  ]);
  assert.equal(scaled.ok, false);
  if (!scaled.ok) {
    assert.match(scaled.error, /scale-bearing symbol resolution/);
  }

  const viewDependent = composeRevit2027NestedMesh(10n, [
    {
      ownerElementId: 10n,
      geometry: null,
      nestedInstances: [
        nested(10n, 20n, identity, { resolveSymbolInView: true }),
      ],
    },
    { ownerElementId: 20n, geometry: "mesh", nestedInstances: [] },
  ]);
  assert.equal(viewDependent.ok, false);
  if (!viewDependent.ok) {
    assert.match(viewDependent.error, /view-dependent symbol resolution/);
  }
});

test("an exact alternate definition closes a missing target without changing the missing-target guard", () => {
  const identity = IDENTITY.matrix;
  const root = {
    ownerElementId: 10n,
    geometry: null,
    nestedInstances: [nested(10n, 20n, identity)],
  };
  const withoutAlternate = composeRevit2027NestedMesh(10n, [root]);
  assert.equal(withoutAlternate.ok, false);
  if (!withoutAlternate.ok) {
    assert.match(withoutAlternate.error, /target 20 is missing/);
  }

  const withAlternate = composeRevit2027NestedMesh(10n, [
    root,
    {
      ownerElementId: 20n,
      geometry: null,
      nestedInstances: [nested(20n, 30n, identity)],
    },
    {
      ownerElementId: 30n,
      geometry: "complete-symbol-mesh",
      nestedInstances: [],
    },
  ]);
  assert.equal(withAlternate.ok, true);
  if (!withAlternate.ok) return;
  assert.deepEqual(
    withAlternate.value.occurrences.map((occurrence) => ({
      owner: occurrence.geometryOwnerElementId,
      geometry: occurrence.geometry,
      depth: occurrence.chain.length,
    })),
    [{
      owner: 30n,
      geometry: "complete-symbol-mesh",
      depth: 2,
    }],
  );
});
