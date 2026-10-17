import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  createOriginalNativeStairPhysicalContext,
  inspectOriginalNativeStairPhysicalInventory,
  originalStairPhysicalHistoryBindings,
  type OriginalNativeStairPhysicalContext,
} from "../lib/reviter/native-source-stair-physical-inventory.ts";

const history = () => [
  { m_id: 4, m_faceHist: { m_keys: [53, 0, -1] } },
  { m_id: 63, m_faceHist: { m_keys: [5, 4, 0] } },
  { m_id: 144, m_faceHist: { m_keys: [5, 4, 1] } },
  { m_id: 40, m_faceHist: { m_keys: [3, 0, 22] } },
  { m_id: 62, m_faceHist: { m_keys: [5, 40, 0] } },
];
const faces = () => [
  { physicalFaceToken: 9, physicalFaceTag: 62 },
  { physicalFaceToken: 10, physicalFaceTag: 63 },
  { physicalFaceToken: 22, physicalFaceTag: 144 },
];

test("persisted pattern operands bind original tread indices while support faces stay separate", () => {
  const h = history(),
    f = faces(),
    before = JSON.stringify([h, f]);
  const result = originalStairPhysicalHistoryBindings(h, f, 2);
  assert.deepEqual(
    result.map((r) => [r.typedIndex, r.physicalFaceToken]),
    [
      [0, 10],
      [1, 22],
    ],
  );
  assert.deepEqual(result[1]!.history, [
    { id: 144, keys: [5, 4, 1] },
    { id: 4, keys: [53, 0, -1] },
  ]);
  assert.equal(JSON.stringify([h, f]), before);
});

test("an uninstantiated original tread keeps its direct source index", () => {
  assert.deepEqual(
    originalStairPhysicalHistoryBindings(
      [{ m_id: 4, m_faceHist: { m_keys: [53, 0, -1] } }],
      [{ physicalFaceToken: 10, physicalFaceTag: 4 }],
      1,
    )[0]!.history,
    [{ id: 4, keys: [53, 0, -1] }],
  );
});

test("missing or duplicated original physical tread faces cannot be replaced by a matching count", () => {
  assert.throws(
    () =>
      originalStairPhysicalHistoryBindings(history(), faces().slice(0, 2), 2),
    /every typed tread/,
  );
  const duplicated = faces();
  duplicated[2] = { physicalFaceToken: 25, physicalFaceTag: 63 };
  assert.throws(
    () => originalStairPhysicalHistoryBindings(history(), duplicated, 2),
    /Duplicate/,
  );
  const h = history();
  h.push({ m_id: 145, m_faceHist: { m_keys: [5, 4, 1] } });
  assert.throws(
    () =>
      originalStairPhysicalHistoryBindings(
        h,
        [...faces(), { physicalFaceToken: 30, physicalFaceTag: 145 }],
        2,
      ),
    /duplicated/,
  );
});

test("out-of-range source index, missing prototype, conflicting history and unsupported role refuse", () => {
  for (const mutation of [
    "index",
    "seed",
    "prototype",
    "conflict",
    "role",
  ] as const) {
    const h = history();
    if (mutation === "index") h[2]!.m_faceHist.m_keys[2] = 2;
    if (mutation === "seed") h[0]!.m_faceHist.m_keys[1] = 2;
    if (mutation === "prototype") h.splice(0, 1);
    if (mutation === "conflict") h.push(structuredClone(h[0]!));
    if (mutation === "role") h[0]!.m_faceHist.m_keys[0] = 54;
    assert.throws(
      () => originalStairPhysicalHistoryBindings(h, faces(), 2),
      mutation,
    );
  }
});

test("a caller-supplied source label cannot create original RVT authority", () => {
  assert.throws(
    () =>
      inspectOriginalNativeStairPhysicalInventory(
        {} as OriginalNativeStairPhysicalContext,
        1,
      ),
    /Untrusted original/,
  );
  assert.throws(
    () =>
      createOriginalNativeStairPhysicalContext(
        new Uint8Array([1, 2, 3]),
        "0".repeat(64),
        [{ nativeStairId: 1, nativeRunId: 2, nativeDefinitionId: 3 }],
      ),
    /RVT checksum mismatch/,
  );
  assert.throws(
    () => originalStairPhysicalHistoryBindings(history(), faces(), 0),
    /Invalid/,
  );
});

const actualPath = process.env.UNBC_ORIGINAL_RVT;
test(
  "actual original bodies bind109 priority/curved tread roles while retaining all source curves and body holds",
  { skip: !actualPath },
  () => {
    const requests = [
      {
        nativeStairId: 1696006,
        nativeRunId: 1696012,
        nativeDefinitionId: 1696013,
      },
      {
        nativeStairId: 1514126,
        nativeRunId: 1514127,
        nativeDefinitionId: 1514128,
      },
      {
        nativeStairId: 1514126,
        nativeRunId: 1514130,
        nativeDefinitionId: 1514131,
      },
      {
        nativeStairId: 1903824,
        nativeRunId: 1903837,
        nativeDefinitionId: 1903838,
      },
      {
        nativeStairId: 2439748,
        nativeRunId: 2439788,
        nativeDefinitionId: 2439789,
      },
      {
        nativeStairId: 1298202,
        nativeRunId: 1298203,
        nativeDefinitionId: 1298204,
      },
    ];
    const originalBytes = readFileSync(actualPath!);
    const context = createOriginalNativeStairPhysicalContext(
      originalBytes,
      "8c294549ee667ed7aba38f1f4f3a53514dae7544af97f0157ee8187dd8702178",
      requests,
    );
    // A caller can edit its original Buffer after construction without
    // changing the private source frame/schema snapshots.
    originalBytes[0] ^= 1;
    assert.equal(context.completeSourcePages, 3666);
    assert.deepEqual(context.missingOriginalRecords, []);
    const rows = requests.map((request) =>
      inspectOriginalNativeStairPhysicalInventory(context, request.nativeRunId),
    );
    assert.deepEqual(
      rows.map((r) => r.sourceFaceCount),
      [286, 138, 90, 288, 174, 378],
    );
    assert.deepEqual(
      rows.map((r) => r.treads.length),
      [23, 11, 7, 23, 14, 31],
    );
    for (const row of rows) {
      assert.equal(
        row.completeOriginalSourceFaceCensus,
        true,
        JSON.stringify(row.blockers),
      );
      assert.equal(
        row.treadHistoryBindingComplete,
        true,
        JSON.stringify(row.blockers),
      );
      assert.equal(row.completeOriginalPhysicalBodyApproved, false);
      assert.equal(row.terminalSupportApproved, false);
      assert.equal(row.ownBodyAndHeadroomClearanceApproved, false);
      assert.equal(row.routeApproved, false);
    }
    const curved = rows.at(-1)!;
    assert.equal(curved.unsupportedPhysicalFaceTokens.length, 126);
    assert.equal(curved.unsupportedPhysicalTreadEdgeTokens.length, 62);
    assert.equal(
      curved.treads.filter((t) =>
        t.coedges.some((c) => c.originalUV.length > 2),
      ).length,
      31,
    );
    assert.ok(curved.blockers.some((b) => b.includes("no chordal trim")));
    const library = rows[0]!;
    assert.equal(
      library.treads.filter((r) => !r.exactHeightMatchesTyped).length,
      6,
    );
    assert.equal(
      library.treads.filter((r) => !r.exactUVCoedgeContinuity).length,
      12,
    );
    assert.deepEqual(library.treads[11]!.history, [
      { id: 1399, keys: [5, 85, 11] },
      { id: 85, keys: [53, 1, -1] },
    ]);
    assert.throws(
      () =>
        inspectOriginalNativeStairPhysicalInventory({ ...context }, 1696012),
      /Untrusted/,
    );
  },
);
