/**
 * Read Reviter's IFC export back with a reader that is not `web-ifc`.
 *
 * `export-ifc.test.ts` opens the same export with `web-ifc`, which is the
 * reader the studio itself uses for paired analysis. That check is worth
 * having and it cannot answer one question: whether the file is valid IFC, or
 * merely valid *to the implementation Reviter already depends on*. Two
 * unrelated readers agreeing is a much stronger claim than one reader agreeing
 * with itself.
 *
 * `@ifc-lite/parser` is an independent implementation — a Rust core compiled to
 * WebAssembly with its own STEP tokenizer and its own IFC4 schema registry —
 * so it shares no parsing code with `web-ifc`. It is a devDependency: nothing
 * in `lib/` or `app/` imports it, and the studio's runtime is unchanged.
 *
 * What this does NOT replace: `export-ifc.test.ts`'s `nonConformingNumbers()`.
 * Both readers accept a malformed STEP REAL — a fixture edited from `1.E-5` to
 * `1E-5` parses here with no error and the same entity count — so the textual
 * conformance check remains the only thing standing between the exporter and
 * that whole defect class.
 *
 * The IDS pass is the part that generalises. Every other gate in this
 * repository is fitted to the supplied Revit 2027 project; `reviter-recovery.ids`
 * states the exporter's invariants in a standard, model-neutral form, so the
 * same document runs against this fixture and against a real recovered
 * building. `scripts/audit-ifc-export-independent.ts` is that second run.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { IfcParser, extractPropertiesOnDemand } from "@ifc-lite/parser";
import { parseIDS, validateIDS, createTranslationService } from "@ifc-lite/ids";
import { createDataAccessor } from "@ifc-lite/ids/bridge";

import { makeIfc } from "../lib/reviter/export-ifc.ts";
import { ifcExportFixture } from "./fixtures/ifc-export-fixture.ts";

const RECOVERY_IDS = new URL("./fixtures/reviter-recovery.ids", import.meta.url);

/** `parseColumnar` takes an `ArrayBuffer`; a Node `Buffer` may be a slice of a pool. */
function exportedIfcBuffer(): ArrayBuffer {
  const bytes = new TextEncoder().encode(makeIfc(ifcExportFixture()));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * Parse with the reader's per-phase timings suppressed.
 *
 * `columnar-parser.ts` writes `[parseLite] <phase>: <n>ms` through a bare
 * `console.log` that its own `IFC_DEBUG` switch does not gate, so a parse emits
 * a dozen lines into the TAP stream whatever the environment says. Filtering
 * only that prefix keeps a real warning from the reader visible.
 */
async function parseQuietly(buffer: ArrayBuffer) {
  const log = console.log;
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("[parseLite]")) return;
    log(...args);
  };
  try {
    return await new IfcParser().parseColumnar(buffer);
  } finally {
    console.log = log;
  }
}

/** The property sets an independent reader recovers for one product, flattened. */
function properties(
  store: Awaited<ReturnType<typeof parseQuietly>>,
  expressId: number,
): Map<string, Map<string, unknown>> {
  const sets = new Map<string, Map<string, unknown>>();
  for (const set of extractPropertiesOnDemand(store, expressId) ?? []) {
    const values = new Map<string, unknown>();
    for (const property of set.properties ?? []) values.set(property.name, property.value);
    sets.set(set.name, values);
  }
  return sets;
}

test("an independent reader recovers the exported products, identity and evidence", async () => {
  const store = await parseQuietly(exportedIfcBuffer());

  assert.equal(store.schemaVersion, "IFC4");

  const table = store.entities;
  const byType = new Map<string, number[]>();
  for (let row = 0; row < table.count; row += 1) {
    const expressId = table.expressId[row]!;
    const type = table.getTypeName(expressId);
    byType.set(type, [...(byType.get(type) ?? []), expressId]);
  }

  // The fixture's two elements, their type objects, and the storey they sit on.
  for (const type of ["IfcWall", "IfcDoor", "IfcWallType", "IfcDoorType", "IfcBuildingStorey"]) {
    assert.equal(byType.get(type)?.length, 1, `expected exactly one ${type}`);
  }

  const wall = byType.get("IfcWall")![0]!;
  const door = byType.get("IfcDoor")![0]!;

  // Names carry the Revit family/type/id string the paired export also uses.
  assert.equal(table.getName(wall), "Walls:Exterior Wall - 200mm:10");
  assert.equal(table.getName(door), "Single Flush:0915 x 2134 mm:11");

  // A GUID that another tool can key on, and a body it can find.
  for (const product of [wall, door]) {
    assert.match(table.getGlobalId(product), /^[0-9A-Za-z_$]{22}$/);
    assert.equal(table.hasGeometry(product), true);
  }

  const wallSets = properties(store, wall);
  const recovery = wallSets.get("Reviter_Recovery");
  assert.ok(recovery, "the wall carries Reviter_Recovery");
  assert.equal(recovery.get("RevitElementId"), 10);
  assert.equal(recovery.get("RevitCategory"), "Walls");
  assert.equal(recovery.get("CategoryEvidence"), "native-token");
  assert.equal(recovery.get("GeometryProvenance"), "native");
  assert.equal(recovery.get("GeometryExact"), true);

  // The decoded Revit parameter reaches the file under its enumerator-bearing
  // label, and keeps its value in feet.
  const parameters = wallSets.get("Reviter_RevitInstanceParameters");
  assert.ok(parameters, "the wall carries its decoded instance parameters");
  assert.equal(parameters.get("Unconnected Height [-1001105]"), 3);

  // The door's body is reconstructed, and the export says so rather than
  // claiming the same fidelity as the wall.
  const doorRecovery = properties(store, door).get("Reviter_Recovery");
  assert.ok(doorRecovery, "the door carries Reviter_Recovery");
  assert.equal(doorRecovery.get("GeometryProvenance"), "reconstructed");
  assert.equal(doorRecovery.get("GeometryExact"), false);
});

test("the export satisfies the recovery-evidence IDS", async () => {
  const store = await parseQuietly(exportedIfcBuffer());
  const specification = parseIDS(readFileSync(RECOVERY_IDS, "utf8"));

  const report = await validateIDS(
    specification,
    createDataAccessor(store),
    {
      modelId: "ifc-export-fixture",
      schemaVersion: store.schemaVersion,
      entityCount: store.entityCount,
    },
    { translator: createTranslationService("en") },
  );

  assert.ok(report.specificationResults.length > 0, "the IDS document declares specifications");
  for (const result of report.specificationResults) {
    // An applicable count of zero would pass vacuously: a specification that
    // matched nothing has not checked the exporter, it has only failed to find
    // it. Both are worth failing on.
    assert.ok(
      (result.applicableCount ?? 0) > 0,
      `${result.specification.name}: matched no entities`,
    );
    assert.equal(
      result.passRate,
      100,
      `${result.specification.name}: ${result.failedCount ?? "some"} of ${result.applicableCount} failed`,
    );
  }
});
