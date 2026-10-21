import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readSchema } from "../lib/reviter/schema-reader.ts";
import { readOriginalCurtainHostTypedFifo } from "../lib/reviter/native-source-curtain-host.ts";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "../lib/reviter/revit-2027-grep-replay.ts";
import {
  inspectOriginalCurtainCellFrames,
  inspectOriginalCurtainCellBindings,
  certifyOriginalCurtainCellBindings,
  originalCurtainCellMemberBinding,
  type OriginalCurtainCellBindingCertificate,
} from "../lib/reviter/native-source-curtain-cell-bindings.ts";
import type { OriginalNativeForeignEnvelopeCensus } from "../lib/reviter/native-source-foreign-envelope-census.ts";
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const schemaBytes = fixture("native-drawing-reference-source-schema.bin"),
  native = fixture("native-curtain-host-2315413.bin"),
  graphics = fixture("native-curtain-host-2315413-graphics.bin");
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function replays() {
  const s = readSchema(schemaBytes);
  assert.ok(s.ok);
  const h = readOriginalCurtainHostTypedFifo(native, s.schema);
  assert.ok(h.ok);
  const v = new DataView(graphics.buffer, graphics.byteOffset, graphics.length),
    root = decodeRevit2027FramedGRepRoot(
      graphics,
      {
        offset: 0,
        elementId: 2315413,
        marker: 2246,
        objectLength: v.getUint32(12, true),
        typeCode: v.getUint32(18, true),
      },
      2027,
    );
  assert.ok(root.ok);
  const g = replayRevit2027GRepFifo(graphics, root.value);
  assert.ok(g.ok);
  return { host: h.value, graphics: g.value };
}
test("original current host binds every panel/cell/coedge and all twelve mullions while retaining wrapper geometry", () => {
  assert.equal(
    hash(native),
    "db935492547f60da02970dad6b946803c40b1bca429638e0ba6eb0d3cc80a9ba",
  );
  assert.equal(
    hash(graphics),
    "5f630ef5db371ac8c782688d4ce71268a5969f1ed1fd70959fbed4379b767f52",
  );
  const r = inspectOriginalCurtainCellFrames(schemaBytes, native, graphics);
  assert.ok(r.ok, r.blockers.join("; "));
  assert.equal(r.cells.length, 4);
  assert.equal(r.currentMullionElementIds.length, 12);
  assert.equal(r.retainedGeometryTokens.length, 6);
  assert.equal(r.retainedFaceTokens.length, 23);
  const door = r.cells.find((c) => c.nativePanelElementId === 2315416)!;
  assert.equal(door.sourceFaceTag, 59);
  assert.equal(door.originalFaceToken, 53);
  assert.equal(door.originalLoopToken, 139);
  assert.deepEqual(door.originalEdgeTags, [60, 56, 69, 62]);
  assert.ok(
    door.edgeMembers.some(
      (m) => m.sourceEdgeTag === 60 && m.nativeMullionElementId === 2315423,
    ),
  );
  assert.equal(r.hostMaterialOmitted, false);
  assert.equal(r.materialAbsenceApproved, false);
  assert.equal(r.routeApproved, false);
  assert.equal(r.sourceAuthorityGranted, false);
});
type CellMutation = {
  second: {
    m_panelId: { m_id: { m_id64: number } };
    m_faceTag: number;
    m_edgeTags: number[];
  };
};
test("foreign owners, duplicate cells, stale face/edge tags, holes and contradictory current membership refuse", () => {
  const mutations: ((r: ReturnType<typeof replays>) => void)[] = [
    (r) => {
      r.graphics.ownerElementId = 2315414n;
    },
    (r) => {
      const e = r.host.entries.find(
        (e) => e.sourceClassName === "CGridDivideFaceGStep",
      )!;
      (e.value.m_cellMap as CellMutation[])[1]!.second.m_panelId.m_id.m_id64 =
        2315414;
    },
    (r) => {
      const e = r.host.entries.find(
        (e) => e.sourceClassName === "CGridDivideFaceGStep",
      )!;
      (e.value.m_cellMap as CellMutation[])[1]!.second.m_faceTag = 999;
    },
    (r) => {
      const e = r.host.entries.find(
        (e) => e.sourceClassName === "CGridDivideFaceGStep",
      )!;
      (e.value.m_cellMap as CellMutation[])[1]!.second.m_edgeTags[0] = 999;
    },
    (r) => {
      const e = r.graphics.spans.find((e) => e.propertyToken === 139)!;
      (e.value as { nextLoop: { token: number } }).nextLoop.token = 999;
    },
    (r) => {
      const e = r.host.entries.find(
        (e) => e.sourceClassName === "CGDriverMullionData",
      )!;
      (e.value.m_mullionsByEdge as unknown[]).pop();
    },
    (r) => {
      const s = r.graphics.spans.find((s) => s.propertyToken === 53)!;
      r.graphics.descriptors.find((d) => d.token === s.propertyToken)!.state =
        "reused";
    },
  ];
  for (const mutate of mutations) {
    const r = replays();
    mutate(r);
    assert.equal(
      inspectOriginalCurtainCellBindings(r.host, r.graphics).ok,
      false,
    );
  }
});
test("changed original frame checksums refuse before semantic replay; JSON cannot mint source capabilities", () => {
  const changed = Buffer.from(native);
  changed[200] = changed[200]! ^ 1;
  assert.throws(
    () => inspectOriginalCurtainCellFrames(schemaBytes, changed, graphics),
    /checksum/,
  );
  assert.throws(
    () =>
      certifyOriginalCurtainCellBindings(
        {} as OriginalNativeForeignEnvelopeCensus,
        2315413,
      ),
    /Untrusted/,
  );
  assert.throws(
    () =>
      originalCurtainCellMemberBinding(
        {} as OriginalCurtainCellBindingCertificate,
        2315416,
        2315423,
      ),
    /Untrusted/,
  );
});
