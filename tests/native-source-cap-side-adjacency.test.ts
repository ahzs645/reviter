import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "../lib/reviter/revit-2027-grep-replay.ts";
import {
  inspectReciprocalCapSideTopology,
  inspectOriginalNativeStairCapSideTopology,
  inspectOriginalNativeFloorCapSideTopology,
} from "../lib/reviter/native-source-cap-side-adjacency.ts";
const decode = (bytes: Buffer, id: number) => {
  const root = decodeRevit2027FramedGRepRoot(
    bytes,
    {
      offset: 0,
      elementId: id,
      marker: 2246,
      objectLength: bytes.length - 20,
      typeCode: bytes.readUInt32LE(18),
    },
    2027,
  );
  assert.ok(root.ok);
  const p = replayRevit2027GRepFifo(bytes, root.value);
  assert.ok(p.ok);
  return p.value;
};
const stair = () =>
    decode(
      readFileSync(
        new URL(
          "./fixtures/native-original-stair-physical-1696013.bin",
          import.meta.url,
        ),
      ),
      1696013,
    ),
  floor = () =>
    decode(
      Buffer.from(
        JSON.parse(
          readFileSync(
            new URL(
              "./fixtures/native-original-slab-405772.json",
              import.meta.url,
            ),
            "utf8",
          ),
        ).frameHex,
        "hex",
      ),
      405772,
    );
test("actual original first tread cap10 has reciprocal side13 uses inside its complete source component", () => {
  const p = stair(),
    before = JSON.stringify(p, (_k, v) =>
      typeof v === "bigint" ? String(v) : v,
    ),
    r = inspectReciprocalCapSideTopology(p, 10);
  assert.equal(r.completeDeclaredFaceCount, 286);
  assert.equal(r.completeDeclaredEdgeCount, 576);
  assert.equal(r.componentFaceTokens.length, 6);
  assert.equal(r.componentEdgeTokens.length, 12);
  const side = r.adjacentSides.find((s) => s.sideFaceToken === 13);
  assert.ok(side);
  assert.ok(side.sharedEdges.length);
  assert.ok(side.sharedEdges.every((e) => e.capUse.side !== e.sideUse.side));
  assert.equal(r.contactApproved, false);
  assert.equal(r.routeApproved, false);
  assert.equal(
    JSON.stringify(p, (_k, v) => (typeof v === "bigint" ? String(v) : v)),
    before,
  );
});
test("actual upper slab cap5 retains its six holes and reciprocal side92 inside the complete129face component", () => {
  const r = inspectReciprocalCapSideTopology(floor(), 5);
  assert.equal(r.completeDeclaredFaceCount, 129);
  assert.equal(r.componentFaceTokens.length, 129);
  assert.equal(r.componentEdgeTokens.length, 381);
  assert.equal(r.faces.find((f) => f.faceToken === 5)!.loopUses.length, 7);
  assert.ok(r.adjacentSides.some((s) => s.sideFaceToken === 92));
});
test("a different component cannot inherit side13; changed shared face, missing side loop or wrong declaration refuses", () => {
  const other = inspectReciprocalCapSideTopology(stair(), 284);
  assert.ok(!other.adjacentSides.some((s) => s.sideFaceToken === 13));
  for (const defect of ["face", "loop", "declaration"]) {
    const p = stair(),
      r = inspectReciprocalCapSideTopology(p, 10),
      shared = r.adjacentSides.find((s) => s.sideFaceToken === 13)!
        .sharedEdges[0]!;
    if (defect === "face") {
      const e = p.spans.find(
        (s) =>
          s.readerId === "Revit2027GEdge" &&
          s.propertyToken === shared.edgeToken,
      )!.value as { faceReferences: number[] };
      e.faceReferences[shared.sideUse.side] = 284;
    } else if (defect === "loop") {
      const f = p.spans.find(
        (s) => s.readerId === "Revit2027Face" && s.propertyToken === 13,
      )!.value as { firstLoop: { token: number } };
      f.firstLoop.token = 0;
    } else {
      const g = p.spans.find((s) => s.readerId === "Revit2027Geometry")!
        .value as { faces: { count: number } };
      g.faces.count--;
    }
    assert.throws(
      () => inspectReciprocalCapSideTopology(p, 10),
      /Original|original/,
    );
  }
});
test("copied source labels cannot bind original cap-side topology", () => {
  assert.throws(
    () => inspectOriginalNativeStairCapSideTopology({} as never, 1696012, 10),
    /original|Original/,
  );
  assert.throws(
    () => inspectOriginalNativeFloorCapSideTopology({} as never, 405772, 5),
    /original|Original/,
  );
});
