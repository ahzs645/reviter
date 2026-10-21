import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readSchema } from "../lib/reviter/schema-reader.ts";
import { readOriginalCurtainInstanceTypedFifo } from "../lib/reviter/native-source-curtain-instance.ts";
import { readOriginalMullionSymbolTypedFifo } from "../lib/reviter/native-source-mullion-symbol.ts";
import {
  inspectOriginalCurtainCellFrames,
  originalCurtainCellMemberBinding,
} from "../lib/reviter/native-source-curtain-cell-bindings.ts";
import { inspectFilledThresholdFrames } from "../lib/reviter/native-filled-threshold-body.ts";
import { inspectFilledThresholdNativeCorrespondence } from "../lib/reviter/native-filled-threshold-step.ts";
const file = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const sourceSchema = file("native-drawing-reference-source-schema.bin"),
  s = readSchema(sourceSchema);
assert.ok(s.ok);
const schema = s.schema;
const nativeDoor = file("native-curtain-door-2315416-2031.bin"),
  nativeSill = file("native-curtain-sill-2315423-2031.bin");
const frame = (id: number) => {
  const bytes = file(`native-filled-threshold-${id}.bin`);
  return { bytes, nativeElementId: id, sha256: hash(bytes) };
};
function inputs() {
  const sill = readOriginalMullionSymbolTypedFifo(
      nativeSill,
      schema,
      "FamilyInstance",
    ),
    door = readOriginalCurtainInstanceTypedFifo(nativeDoor, schema);
  assert.ok(sill.ok);
  assert.ok(door.ok);
  const h = inspectOriginalCurtainCellFrames(
    sourceSchema,
    file("native-curtain-host-2315413.bin"),
    file("native-curtain-host-2315413-graphics.bin"),
  );
  assert.ok(h.ok);
  // Deliberately untrusted test operands: this pure guard issues no capability.
  const member = {
    nativeHostElementId: 2315413,
    nativePanelElementId: 2315416,
    nativeMullionElementId: 2315423,
    cell: h.cells.find((c) => c.nativePanelElementId === 2315416)!,
  } as ReturnType<typeof originalCurtainCellMemberBinding>;
  return {
    member,
    sill: sill.value,
    door: door.value,
    body: inspectFilledThresholdFrames(frame(2315423), frame(1223587)),
  };
}
test("original native door string metadata fully replays without solving a parameter or omitting a material branch", () => {
  assert.equal(
    hash(nativeDoor),
    "1aa88f8d623458a56674a69f295415371a36f3907f7e2282d159e25394a71fd7",
  );
  assert.equal(
    hash(nativeSill),
    "3988051c09200935b69d506a80b9379472c2302d488a549c3b120daf3a06e363",
  );
  const r = inputs();
  assert.equal(r.door.endOffset, nativeDoor.length - 4);
  assert.deepEqual(
    r.door.entries.find((e) => e.sourceClassName === "ParamValueSetAString")!
      .value.m_paramSet,
    [{ m_paramId: { m_id: { m_id64: -1001203 } }, m_value: "2675" }],
  );
  const changed = structuredClone(schema);
  changed.classes.find((c) => c.name === "ParamValueSetAString")!.name =
    "UnreviewedStringGenerator";
  assert.equal(
    readOriginalCurtainInstanceTypedFifo(nativeDoor, changed).ok,
    false,
  );
});
test("actual native sill/door host, current cell edge, definition and original affine all match reciprocally", () => {
  const r = inputs(),
    out = inspectFilledThresholdNativeCorrespondence(
      r.member,
      r.sill,
      r.door,
      r.body,
    );
  assert.equal(out.ok, true);
  assert.equal(out.sourceAuthorityGranted, false);
  assert.equal(out.routeApproved, false);
});
test("foreign host, stale edge/definition and any dropped nonzero affine operand refuse correspondence", () => {
  for (const defect of [
    "sill-host",
    "door-host",
    "door-reference-host",
    "edge",
    "definition",
    "affine",
  ]) {
    const r = inputs();
    const setId = (v: unknown, n: number) => {
      (v as { m_id: { m_id64: number } }).m_id.m_id64 = n;
    };
    if (defect === "sill-host") setId(r.sill.root.m_hostId, 2315493);
    if (defect === "door-host") setId(r.door.root.m_hostId, 2315493);
    if (defect === "door-reference-host")
      setId(
        r.door.entries.find((e) => e.sourceClassName === "CurtainCellFamRef")!
          .value.m_hostId,
        2315493,
      );
    if (defect === "edge")
      r.sill.entries.find(
        (e) => e.sourceClassName === "MullionFamRef",
      )!.value.m_edgeTag = 62;
    const info = r.sill.entries.find(
      (e) => e.sourceClassName === "InstanceInfo",
    )!.value;
    if (defect === "definition") setId(info.m_symbolId, 1191708);
    if (defect === "affine")
      (info.m_Trf as { m_3x3: number[][] }).m_3x3[0]![2] = 0;
    assert.equal(
      inspectFilledThresholdNativeCorrespondence(
        r.member,
        r.sill,
        r.door,
        r.body,
      ).ok,
      false,
      defect,
    );
  }
});
