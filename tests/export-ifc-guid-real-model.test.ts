/**
 * GlobalId uniqueness and stability over a real project export.
 *
 * The supplied 2027 project is too large to commit, so this runs only when
 * `REVITER_MODEL_2027` names it (about 90 s):
 *
 *   REVITER_MODEL_2027=work/unbc.rvt node --experimental-strip-types \
 *     --test tests/export-ifc-guid-real-model.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { convertRvtBytes } from "../lib/reviter/convert.ts";
import { makeIfc } from "../lib/reviter/export-ifc.ts";
import { ifcGlobalIds, withoutElement } from "./fixtures/ifc-guids.ts";

const MODEL_2027 = process.env.REVITER_MODEL_2027 ?? "";
const WALLS = -2_000_011;

test("a real project's GlobalIds are unique and survive deleting an unrelated wall", (t) => {
  if (!MODEL_2027 || !existsSync(MODEL_2027)) {
    t.skip("set REVITER_MODEL_2027 to run the real-model GlobalId case");
    return;
  }
  const bytes = readFileSync(MODEL_2027);
  const result = convertRvtBytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), "model.rvt");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.uniqueDocumentGuid ?? "", /^[0-9a-f-]{36}$/, "the document states its own GUID");

  const full = ifcGlobalIds(makeIfc(result));
  assert.ok(full.length > 1_000);
  assert.equal(new Set(full).size, full.length, "no GlobalId is issued twice");

  // A wall that hosts nothing and is no stair's part: deleting it in Revit
  // removes its own entities and nothing else's identity.
  const hosts = new Set((result.nativeHostRelations ?? []).map((relation) => relation.hostId));
  const wall = result.elementBounds.find((record) =>
    record.categoryId === WALLS && !hosts.has(record.elementId) &&
    result.meshes.some((mesh) => mesh.elementIds?.includes(record.elementId)))!;
  assert.ok(wall, "the model has an unhosting, drawn wall");
  const fullIds = new Set(full);
  const without = ifcGlobalIds(makeIfc(withoutElement(result, wall.elementId)));
  assert.ok(without.length < full.length);
  assert.deepEqual(without.filter((id) => !fullIds.has(id)), [], "no surviving entity changed its GlobalId");
});
