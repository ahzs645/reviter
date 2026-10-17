import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readSchema } from "../lib/reviter/schema-reader.ts";
import { readOriginalMullionSymbolTypedFifo } from "../lib/reviter/native-source-mullion-symbol.ts";

function setup() {
  const schema = readSchema(
    readFileSync(
      new URL(
        "./fixtures/native-drawing-reference-source-schema.bin",
        import.meta.url,
      ),
    ),
  );
  assert.ok(schema.ok);
  return {
    schema: schema.schema,
    symbol: readFileSync(
      new URL(
        "./fixtures/native-original-mullion-symbol-2371893.bin",
        import.meta.url,
      ),
    ),
    instance: readFileSync(
      new URL(
        "./fixtures/native-original-mullion-instance-2465315.bin",
        import.meta.url,
      ),
    ),
  };
}
test("the whole original rectangular mullion symbol root and FIFO close without supplying physical absence or an envelope", () => {
  const s = setup(),
    before = Buffer.from(s.symbol),
    r = readOriginalMullionSymbolTypedFifo(s.symbol, s.schema);
  assert.ok(r.ok, r.ok ? undefined : r.error);
  assert.equal(r.value.rootClassName, "SysMullionFamSym");
  assert.equal(r.value.endOffset, s.symbol.length - 4);
  assert.deepEqual(
    r.value.entries.map((e) => e.sourceClassName),
    [
      "ParamValueSetDouble",
      "GeomStepList",
      "GeomTable",
      "CellList",
      "SymbolInfo",
      "FamilyParams",
      "MullionSymFamRef",
      "Matrix",
      "SysRectMullionProfile",
      "BaseFamilySymbolGStep",
      "SysMullionFamSymPatternHelper",
      "GLine",
    ],
  );
  const ref = r.value.entries.find(
      (e) => e.sourceClassName === "MullionSymFamRef",
    )!,
    line = r.value.entries.find((e) => e.sourceClassName === "GLine")!;
  assert.equal(ref.value.m_refDormant, 1);
  const ends = line.value.m_endParams as number[];
  assert.equal(ends[0], ends[1]);
  assert.equal("boundsFeet" in r.value, false);
  assert.equal("physicalAbsenceApproved" in r.value, false);
  assert.equal("routeApproved" in r.value, false);
  assert.deepEqual(s.symbol, before);
});
test("all native instance generators and its explicit host edge remain visible in complete source replay", () => {
  const s = setup(),
    r = readOriginalMullionSymbolTypedFifo(
      s.instance,
      s.schema,
      "FamilyInstance",
    );
  assert.ok(r.ok, r.ok ? undefined : r.error);
  assert.equal(r.value.endOffset, s.instance.length - 4);
  assert.equal(r.value.root.m_instDormant, 1);
  assert.deepEqual(r.value.root.m_pInputInstParams, { omitted: true });
  assert.equal((r.value.root.m_pCurveDriver as { token: number }).token, 0);
  assert.ok(r.value.entries.some((e) => e.sourceClassName === "MullionFamRef"));
  const ref = r.value.entries.find(
    (e) => e.sourceClassName === "MullionFamRef",
  )!;
  assert.equal(ref.value.m_edgeTag, 252);
  assert.deepEqual(
    ref.value.m_hostId,
    r.value.root.m_hostId,
    "host dependency is retained; it does not prove physical containment",
  );
  assert.ok(
    r.value.rootFields.some(
      (f) =>
        f.path === "FamilyInstance.m_pInputInstParams" &&
        f.omitted &&
        f.start === f.end,
    ),
  );
});
test("unknown or changed omitted source storage declarations are never skipped", () => {
  for (const edit of [
    (s: ReturnType<typeof setup>) => {
      s.schema.classes
        .find((c) => c.name === "FamilyInstance")!
        .properties.find((p) => p.name === "m_pInputInstParams")!.loadingMode =
        3;
    },
    (s: ReturnType<typeof setup>) => {
      s.schema.classes
        .find((c) => c.name === "FamilyInstance")!
        .properties.find((p) => p.name === "m_rehostInstance")!.unknownWord = 0;
    },
    (s: ReturnType<typeof setup>) => {
      s.schema.classes
        .find((c) => c.name === "GeomTabEntry")!
        .properties.find((p) => p.name === "m_pGNode")!.unknownWord = 32;
    },
  ]) {
    const s = setup();
    edit(s);
    assert.equal(
      readOriginalMullionSymbolTypedFifo(s.instance, s.schema, "FamilyInstance")
        .ok,
      false,
    );
  }
});
test("wrong root, changed source owner, truncated and unconsumed frames retain a refusal", () => {
  const s = setup();
  assert.equal(
    readOriginalMullionSymbolTypedFifo(s.instance, s.schema).ok,
    false,
  );
  const changed = Buffer.from(s.symbol);
  changed.writeUInt32LE(2371894, 0);
  assert.equal(readOriginalMullionSymbolTypedFifo(changed, s.schema).ok, false);
  assert.equal(
    readOriginalMullionSymbolTypedFifo(s.symbol.subarray(0, -1), s.schema).ok,
    false,
  );
  const extra = Buffer.concat([s.symbol, Buffer.from([0])]);
  assert.equal(readOriginalMullionSymbolTypedFifo(extra, s.schema).ok, false);
});
