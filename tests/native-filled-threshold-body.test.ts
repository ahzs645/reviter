import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  inspectFilledThresholdDefinition,
  inspectFilledThresholdFrames,
  thresholdSourceOperands,
  type ThresholdFrameInput,
} from "../lib/reviter/native-filled-threshold-body.ts";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
} from "../lib/reviter/revit-2027-grep-replay.ts";
import type { Revit2027FaceStatic } from "../lib/reviter/revit-2027-face-static.ts";
import type { Revit2027GFilling } from "../lib/reviter/revit-2027-gfilling.ts";
import type { Revit2027GEdgeStatic } from "../lib/reviter/revit-2027-edge-1423.ts";
import { rational } from "../lib/reviter/native-rational-overlay.ts";
const directory = new URL("./fixtures/", import.meta.url);
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function frame(id: number, placed = false): ThresholdFrameInput {
  const kind = placed ? "placed" : "definition";
  const receipt = JSON.parse(
    readFileSync(
      new URL("native-filled-threshold-frames.json", directory),
      "utf8",
    ),
  ) as {
    sourceModelSha256: string;
    schemaSha256: string;
    results: {
      nativeElementId: number;
      kind: string;
      file: string;
      sha256: string;
    }[];
  };
  assert.equal(
    receipt.sourceModelSha256,
    "8c294549ee667ed7aba38f1f4f3a53514dae7544af97f0157ee8187dd8702178",
  );
  assert.equal(
    receipt.schemaSha256,
    "d961c44726fe7fc32bce4425639481a5d5e91acecec7b7fd897610fc369f046f",
  );
  const matches = receipt.results.filter(
    (r) => r.nativeElementId === id && r.kind === kind,
  );
  assert.equal(matches.length, 1);
  const bytes = readFileSync(new URL(matches[0]!.file, directory));
  assert.equal(hash(bytes), matches[0]!.sha256);
  return { bytes, nativeElementId: id, sha256: matches[0]!.sha256 };
}
function replay(): Revit2027GRepReplay {
  const f = frame(1223587),
    v = new DataView(f.bytes.buffer, f.bytes.byteOffset, f.bytes.length);
  const root = decodeRevit2027FramedGRepRoot(
    f.bytes,
    {
      offset: 0,
      elementId: f.nativeElementId,
      marker: 2246,
      objectLength: v.getUint32(12, true),
      typeCode: v.getUint32(18, true),
    },
    2027,
  );
  assert.ok(root.ok);
  const r = replayRevit2027GRepFifo(f.bytes, root.value);
  assert.ok(r.ok);
  return r.value;
}
const face = (r: Revit2027GRepReplay) =>
  r.spans.find((s) => s.readerId === "Revit2027Face")!
    .value as Revit2027FaceStatic;
const fill = (r: Revit2027GRepReplay) =>
  r.spans.find((s) => s.readerId === "Revit2027GFilling")!
    .value as Revit2027GFilling;
const edge = (r: Revit2027GRepReplay) =>
  r.spans.find((s) => s.readerId === "Revit2027GEdge")!
    .value as Revit2027GEdgeStatic;

test("the original six filled faces form an exact closed box without dropping fillings or masking reversed orientation", () => {
  for (const id of [1191708, 1223587, 1439914, 2464392]) {
    const f = frame(id),
      v = new DataView(f.bytes.buffer, f.bytes.byteOffset, f.bytes.length);
    const root = decodeRevit2027FramedGRepRoot(
      f.bytes,
      {
        offset: 0,
        elementId: id,
        marker: 2246,
        objectLength: v.getUint32(12, true),
        typeCode: v.getUint32(18, true),
      },
      2027,
    );
    assert.ok(root.ok);
    const r = replayRevit2027GRepFifo(f.bytes, root.value);
    assert.ok(r.ok);
    const before = thresholdSourceOperands(r.value),
      out = inspectFilledThresholdDefinition(r.value);
    assert.ok(out.ok, JSON.stringify(out.blockers));
    assert.equal(out.exactClosedSixFaceBox, true);
    assert.deepEqual(out.topology, {
      faceCount: 6,
      edgeCount: 12,
      vertexCount: 8,
      eulerCharacteristic: 2,
    });
    assert.deepEqual(
      out.faces.map((f) => f.faceFlags),
      [6, 4, 4, 4, 4, 4],
    );
    assert.equal(new Set(out.faces.map((f) => f.fillingToken)).size, 6);
    assert.deepEqual(out.sourceLedger, before);
    assert.deepEqual(thresholdSourceOperands(r.value), before);
    assert.equal(out.originalSourceAuthorityGranted, false);
    assert.equal(out.walkingSupportApproved, false);
    assert.equal(out.routeApproved, false);
    assert.equal(out.clearanceApproved, false);
    assert.equal(out.wheelchairApproved, false);
  }
});

test("all five original sill placements retain exact affine caps, risers and source operands without route authority", () => {
  for (const [id, definition] of [
    [2315423, 1223587],
    [2311773, 1223587],
    [1505916, 2464392],
    [2042019, 1191708],
    [2465287, 1439914],
  ]) {
    const p = frame(id!, true),
      d = frame(definition!),
      before = hash(p.bytes),
      out = inspectFilledThresholdFrames(p, d);
    assert.ok(out.ok, JSON.stringify(out.blockers));
    assert.equal(out.exactClosedPlacedBox, true);
    assert.equal(out.placedFaces!.length, 6);
    assert.equal(out.sideFaceTokens!.length, 4);
    assert.deepEqual(out.riseFeet, ["92347433304021", "562949953421312"]);
    assert.equal(out.sourceMembershipIndependentlyRevalidated, false);
    assert.equal(out.originalSourceAuthorityGranted, false);
    assert.equal(out.walkingSupportApproved, false);
    assert.equal(out.clearanceApproved, false);
    assert.equal(out.routeApproved, false);
    assert.equal(out.wheelchairApproved, false);
    assert.equal(hash(p.bytes), before);
    // Never round a persisted tiny rotation to zero or substitute native bounds.
    if (id === 2315423) {
      const placement = out.originalPlacement as {
        instance: { transform: { matrix: number[] } };
      };
      assert.equal(
        placement.instance.transform.matrix[5],
        -1.796693428402863e-15,
      );
      assert.equal(
        placement.instance.transform.matrix[8],
        -1.796693428402863e-15,
      );
      const x = out.topCap!.ringFeet[0]![0];
      const q = rational(30.366439035611208);
      assert.notEqual(
        BigInt(x[0]) * q.d - q.n * BigInt(x[1]),
        0n,
        "actual cap corner retains its sub-ULP difference from the envelope",
      );
    }
  }
});

test("missing, foreign, unconsumed and geometric filling operands stay refused", () => {
  const mutations: ((r: Revit2027GRepReplay) => void)[] = [
    (r) => {
      fill(r).data.token = 100;
    },
    (r) => {
      fill(r).faceIdReference = 999;
    },
    (r) => {
      fill(r).flags = 19;
    },
    (r) => {
      fill(r).patternElementId = 999n;
    },
    (r) => {
      r.spans.find(
        (s) => s.readerId === "Revit2027GFilling",
      )!.parentReplayIndex = 0;
    },
    (r) => {
      r.spans.find((s) => s.readerId === "Revit2027GFilling")!.ownerElementId =
        999n;
    },
    (r) => {
      r.spans = r.spans.filter((s) => s.readerId !== "Revit2027GFilling");
    },
    (r) => {
      r.spans = [
        ...r.spans,
        {
          ...r.spans.find((s) => s.readerId === "Revit2027GFilling")!,
          replayIndex: r.spans.length,
          propertyToken: 999,
        },
      ];
    },
  ];
  for (const mutate of mutations) {
    const r = replay();
    mutate(r);
    const out = inspectFilledThresholdDefinition(r);
    assert.equal(out.ok, false, JSON.stringify(out));
    assert.equal(out.routeApproved, false);
  }
});

test("unknown face/curve semantics and arbitrarily small original coedge/twin mismatches cannot be repaired by the reader", () => {
  for (const mutate of [
    (r: Revit2027GRepReplay) => {
      face(r).faceFlags = 134;
    },
    (r: Revit2027GRepReplay) => {
      face(r).faceFlags = 4;
    },
    (r: Revit2027GRepReplay) => {
      edge(r).flags = 8;
    },
    (r: Revit2027GRepReplay) => {
      const e = edge(r);
      e.interiorEdgePoints = [e.firstAndLastEdgePoints[0]];
    },
    (r: Revit2027GRepReplay) => {
      const e = edge(r);
      e.firstAndLastEdgePoints = [
        {
          ...e.firstAndLastEdgePoints[0],
          firstFaceUv: [
            Number.MIN_VALUE,
            e.firstAndLastEdgePoints[0].firstFaceUv[1],
          ],
        },
        e.firstAndLastEdgePoints[1],
      ];
    },
    (r: Revit2027GRepReplay) => {
      edge(r).nextReferences = [999, 999];
    },
  ]) {
    const r = replay();
    mutate(r);
    const before = thresholdSourceOperands(r),
      out = inspectFilledThresholdDefinition(r);
    assert.equal(out.ok, false);
    assert.ok(out.blockers.length);
    assert.deepEqual(thresholdSourceOperands(r), before);
  }
});

test("exact input hashes and original external targets are required; changed tilt/singular placements stay unsupported", () => {
  const p = frame(2315423, true),
    d = frame(1223587);
  assert.equal(
    inspectFilledThresholdFrames({ ...p, sha256: "0".repeat(64) }, d).ok,
    false,
  );
  assert.equal(inspectFilledThresholdFrames(p, frame(1191708)).ok, false);
  assert.equal(
    inspectFilledThresholdFrames({ ...p, nativeElementId: 999 }, d).ok,
    false,
  );
  for (const modify of [
    (v: DataView) => v.setFloat64(260, 1e-12, true), // y-axis Z tilts the original caps.
    (v: DataView) => v.setFloat64(252, 0, true), // zero x-axis makes the transform singular.
    (v: DataView) => v.setBigInt64(300, 1191708n, true), // original external definition target.
  ]) {
    const bytes = Uint8Array.from(p.bytes),
      view = new DataView(bytes.buffer);
    modify(view);
    // Synthetic changed bytes also need a valid original framing checksum, so
    // this exercises the placement predicate rather than a transport rejection.
    let a = 1,
      b = 0;
    for (let i = 16; i < 16 + view.getUint32(12, true); i++) {
      a = (a + bytes[i]!) % 65521;
      b = (b + a) % 65521;
    }
    view.setUint32(8, (b * 65536 + a) >>> 0, true);
    const out = inspectFilledThresholdFrames(
      { ...p, bytes, sha256: hash(bytes) },
      d,
    );
    assert.equal(out.ok, false);
    assert.ok(out.blockers.length);
    assert.equal(out.routeApproved, false);
    assert.doesNotMatch(out.blockers.join("; "), /checksum/);
  }
  const broken = Uint8Array.from(p.bytes);
  broken[204] = broken[204]! ^ 1;
  assert.match(
    inspectFilledThresholdFrames(
      { ...p, bytes: broken, sha256: hash(broken) },
      d,
    ).blockers.join("; "),
    /inner checksum/,
  );
  const short = p.bytes.subarray(0, -1);
  assert.equal(
    inspectFilledThresholdFrames({ ...p, bytes: short, sha256: hash(short) }, d)
      .ok,
    false,
  );
});

test("source ledger serialization retains signed zero and full-width IDs", () => {
  assert.deepEqual(
    thresholdSourceOperands({ value: -0, owner: 9007199254740993n }),
    { value: { binary64: "-0" }, owner: { bigint: "9007199254740993" } },
  );
  assert.throws(
    () => thresholdSourceOperands({ value: Infinity }),
    /Nonfinite/,
  );
});
