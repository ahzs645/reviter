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
import type { ElementOverride } from "../lib/reviter/element-overrides.ts";

const RECOVERY_IDS = new URL("./fixtures/reviter-recovery.ids", import.meta.url);
const ASSERTION_IDS = new URL("./fixtures/reviter-assertions.ids", import.meta.url);

/** `parseColumnar` takes an `ArrayBuffer`; a Node `Buffer` may be a slice of a pool. */
function exportedIfcBuffer(options?: Parameters<typeof makeIfc>[1]): ArrayBuffer {
  const bytes = new TextEncoder().encode(makeIfc(ifcExportFixture(), options));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * A note on the wall, asserting nothing about what it is.
 *
 * Used where the test needs an asserted export that still contains a wall: the
 * fixture has exactly one, and re-categorising it leaves the recovery
 * document's wall specifications with nothing to match.
 */
const ASSERTED_NOTE: ElementOverride[] = [{
  elementId: 10,
  category: null,
  typeName: null,
  note: "Checked on site",
  author: "reviewer",
  createdAt: "2026-08-19T00:00:00Z",
  updatedAt: "2026-08-19T12:00:00Z",
}];

/** One reviewer assertion, of the kind the 60.1%-inferred categories invite. */
const ASSERTED: ElementOverride[] = [{
  elementId: 10,
  category: { id: -2_000_170, name: "Curtain Panels" },
  typeName: null,
  note: "Misfiled as a wall by the record-code consensus",
  author: "reviewer",
  createdAt: "2026-08-19T00:00:00Z",
  updatedAt: "2026-08-19T12:00:00Z",
}];

async function validate(store: Awaited<ReturnType<typeof parseQuietly>>, document: URL) {
  return validateIDS(
    parseIDS(readFileSync(document, "utf8")),
    createDataAccessor(store),
    {
      modelId: "ifc-export-fixture",
      schemaVersion: store.schemaVersion,
      entityCount: store.entityCount,
    },
    { translator: createTranslationService("en") },
  );
}

/** Every specification matched something and everything it matched passed. */
function assertAllPass(
  report: Awaited<ReturnType<typeof validate>>,
  label: string,
): void {
  assert.ok(report.specificationResults.length > 0, `${label}: no specifications`);
  for (const result of report.specificationResults) {
    // An applicable count of zero would pass vacuously: a specification that
    // matched nothing has not checked the exporter, it has only failed to find
    // it. Both are worth failing on.
    assert.ok(
      (result.applicableCount ?? 0) > 0,
      `${label} — ${result.specification.name}: matched no entities`,
    );
    assert.equal(
      result.passRate,
      100,
      `${label} — ${result.specification.name}: ${result.failedCount ?? "some"} of ${result.applicableCount} failed`,
    );
  }
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
  assertAllPass(await validate(await parseQuietly(exportedIfcBuffer()), RECOVERY_IDS), "recovery");
});

test("an asserted export still satisfies the recovery-evidence IDS", async () => {
  // An assertion must not be able to cost an element the evidence every product
  // is required to carry. Asserted here with a note rather than a category,
  // because re-categorising the fixture's only wall would empty the wall
  // specifications' applicability — see the test below.
  const store = await parseQuietly(exportedIfcBuffer({ overrides: ASSERTED_NOTE }));
  assertAllPass(await validate(store, RECOVERY_IDS), "recovery, asserted");
});

test("re-categorising moves an element out of the old class's requirements", () => {
  // Not a defect, and worth pinning: an asserted category changes which
  // specifications apply to the element. It is the reason the assertion rules
  // live in their own IDS document rather than being folded into the always-on
  // one, whose gate fails a specification that matched nothing.
  const asserted = makeIfc(ifcExportFixture(), { overrides: ASSERTED });
  assert.equal(/IFCWALL\(/.test(asserted), false, "the wall stayed a wall");
  assert.match(asserted, /IFCPLATE\(/);
});

test("an asserted export satisfies the assertion-integrity IDS", async () => {
  const store = await parseQuietly(exportedIfcBuffer({ overrides: ASSERTED }));
  assertAllPass(await validate(store, ASSERTION_IDS), "assertions");
});

test("the assertion IDS matches nothing when nothing was asserted", async () => {
  // Correct behaviour, and the reason this lives in its own document: the
  // always-on gate fails a specification that matched no entities, and this one
  // matches none until a reviewer says something.
  const report = await validate(await parseQuietly(exportedIfcBuffer()), ASSERTION_IDS);
  for (const result of report.specificationResults) {
    assert.equal(result.applicableCount ?? 0, 0, `${result.specification.name} matched an unasserted export`);
  }
});

test("an independent reader sees the assertion and what the decoder said", async () => {
  const store = await parseQuietly(exportedIfcBuffer({ overrides: ASSERTED }));
  const table = store.entities;
  let plate: number | null = null;
  for (let row = 0; row < table.count; row += 1) {
    const expressId = table.expressId[row]!;
    if (table.getTypeName(expressId) === "IfcPlate") plate = expressId;
  }
  // The reviewer said curtain panel, so the file says IfcPlate — an assertion
  // that only renamed the element while leaving it an IfcWall would be a label,
  // not a correction.
  assert.ok(plate, "the asserted category did not change the exported class");

  const recovery = properties(store, plate).get("Reviter_Recovery");
  assert.ok(recovery, "the asserted element carries Reviter_Recovery");
  assert.equal(recovery.get("RevitCategory"), "Curtain Panels");
  assert.equal(recovery.get("CategoryEvidence"), "reviewer-assertion");
  assert.equal(recovery.get("AssertedFields"), "category,note");
  assert.equal(recovery.get("AssertedBy"), "reviewer");
  assert.equal(recovery.get("DecodedRevitCategory"), "Walls");
  assert.equal(recovery.get("DecodedCategoryEvidence"), "native-token");
  // The identity the decoder read is untouched by the assertion.
  assert.equal(recovery.get("RevitElementId"), 10);
});
