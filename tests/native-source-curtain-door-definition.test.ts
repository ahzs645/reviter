import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  inspectOriginalCurtainDoorDefinition,
  inspectOriginalCurrentCurtainDoorDefinition,
} from "../lib/reviter/native-source-curtain-door-definition.ts";
import { readOriginalMullionSymbolTypedFifo } from "../lib/reviter/native-source-mullion-symbol.ts";
import { readSchema } from "../lib/reviter/schema-reader.ts";
const file = (n: string) =>
  readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
const schema = file("native-drawing-reference-source-schema.bin"),
  door = file("native-curtain-door-2315416-2031.bin"),
  symbol = file("native-curtain-door-symbol-2312095.bin");
const source = readSchema(schema);
assert.ok(source.ok);
const parsedSchema = source.schema;
test("complete actual native curtain door profile preserves all four finite lines, tiny direction terms and every constructor role", () => {
  const r = inspectOriginalCurtainDoorDefinition(schema, door, symbol);
  assert.equal(
    createHash("sha256").update(symbol).digest("hex"),
    "04c5473028ef4b93cef8ec46a957e6e9db222990416faceffb8ec16f765bfa88",
  );
  assert.equal(r.nativeDefinitionElementId, 2312095);
  assert.equal(r.nativeHostElementId, 2315413);
  assert.equal(r.originalWidthFeet, 3.708661417322787);
  assert.equal(r.originalHeightFeet, 7.627952755905513);
  assert.equal(r.originalProfileCurves.length, 4);
  assert.equal(r.retainedOriginalJoinEndpointPairs.length, 4);
  assert.equal(
    r.originalProfileCurves[0]!.originalDirection[1],
    -1.619791079244956e-17,
  );
  assert.equal(r.completeOriginalDefinitionByteReplay, true);
  assert.equal(r.completeOriginalDoorNativeByteReplay, true);
  assert.equal(r.sourceApertureApproved, false);
  assert.equal(r.sourceLeafOperationApproved, false);
  assert.equal(r.sourceMaterialOmitted, false);
  const s = readOriginalMullionSymbolTypedFifo(
    symbol,
    parsedSchema,
    "FamilySymbol",
  );
  assert.ok(s.ok);
  assert.equal(s.value.entries.length, 41);
  assert.equal(
    readOriginalMullionSymbolTypedFifo(symbol, parsedSchema).ok,
    false,
  );
});
test("unknown source symbol role, checksum damage, foreign symbol and source JSON refuse", () => {
  const changed = structuredClone(parsedSchema);
  changed.classes.find((c) => c.name === "ControlIcon")!.name =
    "UnreviewedDoorGenerator";
  const result = readOriginalMullionSymbolTypedFifo(
    symbol,
    changed,
    "FamilySymbol",
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /Unsupported dynamic/);
  const corrupt = Uint8Array.from(symbol);
  corrupt[50] ^= 1;
  assert.throws(
    () => inspectOriginalCurtainDoorDefinition(schema, door, corrupt),
    /checksum/,
  );
  const foreign = Uint8Array.from(symbol);
  new DataView(foreign.buffer).setBigInt64(0, 2312096n, true);
  assert.throws(
    () => inspectOriginalCurtainDoorDefinition(schema, door, foreign),
    /identities differ|owner field differs/,
  );
  assert.throws(
    () =>
      inspectOriginalCurrentCurtainDoorDefinition(
        {} as never,
        {} as never,
        2315416,
      ),
    /Untrusted/,
  );
});
